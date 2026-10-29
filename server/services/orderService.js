'use strict';
/**
 * Order service — mirrors microservices-ecommerce/order-service.
 *
 * Owns `order_db`. Orchestrates the order Saga exactly like the original:
 *
 *   create order (PENDING) ──publish ORDER_CREATED──▶ inventory reserves
 *     ◀── STOCK_RESERVED  ──▶ status PENDING -> STOCK_RESERVED
 *     ◀── STOCK_RESERVATION_FAILED ──▶ status FAILED (reason recorded)
 *   confirm  -> CONFIRMED, cancel -> CANCELLED + publish ORDER_CANCELLED
 *   processing -> PROCESSING, ship -> SHIPPED, deliver -> DELIVERED
 *
 * Order numbers follow the same "ORD-<date>-<random>" format.
 * Each order also records a `sagaEvents` timeline for the storefront UI.
 */
const crypto = require('crypto');
const store = require('../store');
const { publish, subscribe } = require('../eventbus');

const db = store.load('order_db', { orders: [] });

function persist() { store.save('order_db', db); }

function apiError(code, message, status) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

/* ── Auto-fulfillment simulator (demo) ─────────────────────────
 * After payment confirms an order, it advances on its own:
 * CONFIRMED -> PROCESSING -> SHIPPED -> DELIVERED, one fake
 * interval per step. Timers live in memory; on boot the chain
 * resumes for any order caught mid-lifecycle.                 */
const FULFILLMENT_STEP_MS = Number(process.env.FULFILLMENT_STEP_MS || 10000);
const fulfillmentTimers = new Map();
const FULFILLMENT_NEXT = { CONFIRMED: 'PROCESSING', PROCESSING: 'SHIPPED', SHIPPED: 'DELIVERED' };

function generateAwb() {
  return 'AWB ' + crypto.randomBytes(5).toString('hex').toUpperCase().replace(/(.{4})/g, '$1 ').trim();
}

function scheduleFulfillment(orderId) {
  const o = findOrder(orderId);
  if (!o) return;
  const next = FULFILLMENT_NEXT[o.status];
  if (!next) { fulfillmentTimers.delete(orderId); return; } // terminal (or not yet paid)
  clearTimeout(fulfillmentTimers.get(orderId));
  fulfillmentTimers.set(orderId, setTimeout(() => {
    fulfillmentTimers.delete(orderId);
    try { advanceStatus(orderId, next); }
    catch { /* cancelled, or an admin already moved it — re-sync below */ }
    scheduleFulfillment(orderId); // chain to the next step (no-op when terminal)
  }, FULFILLMENT_STEP_MS));
}

function resumeFulfillment() {
  const inflight = db.orders.filter(o => FULFILLMENT_NEXT[o.status]);
  inflight.forEach(o => scheduleFulfillment(o.id));
  if (inflight.length) console.log(`[fulfillment] resuming auto-lifecycle for ${inflight.length} order(s)`);
}

const STATUSES = ['PENDING', 'STOCK_RESERVED', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'FAILED'];
const TERMINAL = new Set(['DELIVERED', 'CANCELLED', 'FAILED']);
const CANCELLABLE = new Set(['PENDING', 'STOCK_RESERVED', 'CONFIRMED', 'PROCESSING']);

function generateOrderNumber() {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
  let orderNumber = `ORD-${datePart}-${randomPart}`;
  while (db.orders.some(o => o.orderNumber === orderNumber)) {
    orderNumber = `ORD-${datePart}-${crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6)}`;
  }
  return orderNumber;
}

function toOrderItemResponse(i) {
  return {
    id: i.id, sku: i.sku, productId: i.productId, variantId: i.variantId,
    productName: i.productName, variantName: i.variantName || null,
    quantity: i.quantity, unitPrice: i.unitPrice,
    totalPrice: Math.round(i.unitPrice * i.quantity * 100) / 100,
  };
}

function toOrderResponse(o) {
  return {
    id: o.id, orderNumber: o.orderNumber, userId: o.userId,
    status: o.status, totalAmount: o.totalAmount, currency: o.currency,
    shippingAddressLine1: o.shippingAddressLine1,
    shippingAddressLine2: o.shippingAddressLine2 || null,
    shippingCity: o.shippingCity, shippingState: o.shippingState,
    shippingZipCode: o.shippingZipCode, shippingCountry: o.shippingCountry,
    notes: o.notes || null, cancelledReason: o.cancelledReason || null,
    trackingNumber: o.trackingNumber || null,
    items: o.items.map(toOrderItemResponse),
    sagaEvents: o.sagaEvents || [],
    createdAt: o.createdAt, updatedAt: o.updatedAt,
  };
}

function toOrderSummary(o) {
  return {
    id: o.id, orderNumber: o.orderNumber, status: o.status,
    totalAmount: o.totalAmount, currency: o.currency,
    itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
    createdAt: o.createdAt,
  };
}

function addSagaEvent(order, type, detail) {
  order.sagaEvents = order.sagaEvents || [];
  order.sagaEvents.push({ type, detail: detail || null, at: new Date().toISOString() });
}

/* ── Commands ────────────────────────────────────────────────── */

function createOrder(userId, req) {
  const items = req.items || [];
  if (!Array.isArray(items) || items.length === 0) throw apiError('400', 'Order must have at least one item', 400);
  for (const f of ['shippingAddressLine1', 'shippingCity', 'shippingState', 'shippingZipCode', 'shippingCountry']) {
    if (!req[f] || !String(req[f]).trim()) throw apiError('400', `Shipping address is required (missing ${f})`, 400);
  }

  const now = new Date().toISOString();
  const order = {
    id: crypto.randomUUID(),
    orderNumber: generateOrderNumber(),
    userId,
    status: 'PENDING',
    totalAmount: Math.round(items.reduce((s, i) => s + Number(i.unitPrice) * Number(i.quantity), 0) * 100) / 100,
    currency: (req.currency && String(req.currency).toUpperCase().slice(0, 3)) || 'INR',
    shippingAddressLine1: req.shippingAddressLine1,
    shippingAddressLine2: req.shippingAddressLine2 || null,
    shippingCity: req.shippingCity,
    shippingState: req.shippingState,
    shippingZipCode: req.shippingZipCode,
    shippingCountry: req.shippingCountry,
    notes: req.notes || null,
    cancelledReason: null,
    items: items.map(i => ({
      id: crypto.randomUUID(),
      sku: String(i.sku),
      productId: i.productId || null,
      variantId: i.variantId || null,
      productName: String(i.productName || i.sku),
      variantName: i.variantName || null,
      quantity: Math.max(1, Number(i.quantity) || 1),
      unitPrice: Number(i.unitPrice) || 0,
    })),
    sagaEvents: [],
    createdAt: now, updatedAt: now,
  };
  addSagaEvent(order, 'ORDER_CREATED', `Order placed with ${order.items.length} item(s)`);
  db.orders.push(order);
  persist();

  publish('order-events', {
    eventType: 'ORDER_CREATED',
    orderId: order.id,
    orderNumber: order.orderNumber,
    userId,
    items: order.items.map(i => ({ sku: i.sku, productId: i.productId, variantId: i.variantId, quantity: i.quantity })),
    totalAmount: order.totalAmount, currency: order.currency,
    occurredAt: now,
  });
  return toOrderResponse(order);
}

function findOrder(idOrNumber) {
  return db.orders.find(o => o.id === idOrNumber || o.orderNumber === idOrNumber);
}

function getOrder(idOrNumber) {
  const o = findOrder(idOrNumber);
  if (!o) throw apiError('ORDER_NOT_FOUND', `Order not found: ${idOrNumber}`, 404);
  return toOrderResponse(o);
}

/** Paginate a list of orders with PageResponse semantics (page is 0-based here,
 *  matching GET /api/orders/my-orders?page=0&size=10). */
function pageOf(list, page, size) {
  const pageNumber = Math.max(0, parseInt(page, 10) || 0);
  const pageSize = Math.min(100, Math.max(1, parseInt(size, 10) || 10));
  const totalElements = list.length;
  const totalPages = Math.max(1, Math.ceil(totalElements / pageSize));
  const start = pageNumber * pageSize;
  return {
    content: list.slice(start, start + pageSize).map(toOrderSummary),
    pageNumber, pageSize, totalElements, totalPages, last: pageNumber >= totalPages - 1,
  };
}

function myOrders(userId, page, size) {
  return pageOf(db.orders.filter(o => o.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)), page, size);
}

function listByStatus(status, page, size) {
  if (!STATUSES.includes(status)) throw apiError('BAD_REQUEST', `Unknown status: ${status}`, 400);
  return pageOf(db.orders.filter(o => o.status === status)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)), page, size);
}

function assertTransition(order, target) {
  if (TERMINAL.has(order.status)) {
    throw apiError('INVALID_ORDER_STATE', `Order is ${order.status} (terminal); cannot move to ${target}`, 409);
  }
}

function confirmOrder(idOrNumber, userId, role, detail) {
  const o = findOrder(idOrNumber);
  if (!o) throw apiError('ORDER_NOT_FOUND', `Order not found: ${idOrNumber}`, 404);
  if (role !== 'ADMIN' && o.userId !== userId) throw apiError('403', 'You do not own this order', 403);
  if (o.status !== 'STOCK_RESERVED') {
    throw apiError('INVALID_ORDER_STATE', `Order must be STOCK_RESERVED to confirm (currently ${o.status})`, 409);
  }
  o.status = 'CONFIRMED';
  o.updatedAt = new Date().toISOString();
  addSagaEvent(o, 'ORDER_CONFIRMED', detail || 'Payment captured; order confirmed');
  persist();
  scheduleFulfillment(o.id); // demo: auto-advance PROCESSING -> SHIPPED -> DELIVERED
  return toOrderResponse(o);
}

function cancelOrder(idOrNumber, userId, role, reason) {
  const o = findOrder(idOrNumber);
  if (!o) throw apiError('ORDER_NOT_FOUND', `Order not found: ${idOrNumber}`, 404);
  if (role !== 'ADMIN' && o.userId !== userId) throw apiError('403', 'You do not own this order', 403);
  if (!CANCELLABLE.has(o.status)) {
    throw apiError('INVALID_ORDER_STATE', `Order in status ${o.status} cannot be cancelled`, 409);
  }
  o.status = 'CANCELLED';
  o.cancelledReason = reason || 'Cancelled by customer';
  o.updatedAt = new Date().toISOString();
  addSagaEvent(o, 'ORDER_CANCELLED', o.cancelledReason);
  clearTimeout(fulfillmentTimers.get(o.id)); // stop any pending auto-advance
  fulfillmentTimers.delete(o.id);
  persist();

  publish('order-events', {
    eventType: 'ORDER_CANCELLED', orderId: o.id, orderNumber: o.orderNumber,
    userId: o.userId, reason: o.cancelledReason, occurredAt: o.updatedAt,
  });
  return toOrderResponse(o);
}

/** Admin lifecycle transitions: PROCESSING -> SHIPPED -> DELIVERED. */
function advanceStatus(idOrNumber, target) {
  const o = findOrder(idOrNumber);
  if (!o) throw apiError('ORDER_NOT_FOUND', `Order not found: ${idOrNumber}`, 404);
  if (!STATUSES.includes(target)) throw apiError('BAD_REQUEST', `Unknown status: ${target}`, 400);
  assertTransition(o, target);

  const allowed = {
    PROCESSING: ['STOCK_RESERVED', 'CONFIRMED'],
    SHIPPED: ['PROCESSING'],
    DELIVERED: ['SHIPPED'],
  };
  if (!allowed[target] || !allowed[target].includes(o.status)) {
    throw apiError('INVALID_ORDER_STATE', `Cannot move order from ${o.status} to ${target}`, 409);
  }
  o.status = target;
  o.updatedAt = new Date().toISOString();
  let detail;
  if (target === 'PROCESSING') {
    detail = 'Picked, quality-checked and packed at the Mumbai warehouse';
  } else if (target === 'SHIPPED') {
    o.trackingNumber = o.trackingNumber || generateAwb();
    detail = `Handed to the courier — tracking ${o.trackingNumber}`;
  } else {
    detail = 'Delivered to the shipping address — signed by the customer';
  }
  addSagaEvent(o, `ORDER_${target}`, detail);
  persist();

  if (target === 'DELIVERED') {
    publish('order-events', {
      eventType: 'ORDER_COMPLETED', orderId: o.id, orderNumber: o.orderNumber,
      userId: o.userId, occurredAt: o.updatedAt,
    });
  }
  return toOrderResponse(o);
}

/* ── Saga listener ───────────────────────────────────────────── */

function initListeners() {
  resumeFulfillment(); // pick up any order caught mid-lifecycle by a restart
  subscribe('inventory-events', event => {
    const order = event.orderId ? db.orders.find(o => o.id === event.orderId) : null;
    if (!order) return;
    if (event.eventType === 'STOCK_RESERVED' && order.status === 'PENDING') {
      order.status = 'STOCK_RESERVED';
      order.updatedAt = new Date().toISOString();
      addSagaEvent(order, 'STOCK_RESERVED', 'Stock reserved across inventory service');
      persist();
    } else if (event.eventType === 'STOCK_RESERVATION_FAILED' && order.status === 'PENDING') {
      order.status = 'FAILED';
      order.cancelledReason = event.reason || 'Stock reservation failed';
      order.updatedAt = new Date().toISOString();
      addSagaEvent(order, 'STOCK_RESERVATION_FAILED', order.cancelledReason);
      persist();
    }
  });
}

function countOrders() { return db.orders.length; }

/** Seeder only. */
function _insertSeed(orders) {
  db.orders.push(...orders);
  persist();
}

module.exports = {
  createOrder, getOrder, myOrders, listByStatus,
  confirmOrder, cancelOrder, advanceStatus,
  initListeners, countOrders, _insertSeed,
};
