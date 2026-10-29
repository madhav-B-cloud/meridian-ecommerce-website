'use strict';
/**
 * Inventory service — mirrors microservices-ecommerce/inventory-service.
 *
 * Owns `inventory_db` (stock per SKU, reservations, stock movements).
 *
 * Saga participation (identical topics/event types as the original):
 *  - consumes `order-events`   ORDER_CREATED     -> reserve stock -> publishes
 *                                STOCK_RESERVED | STOCK_RESERVATION_FAILED
 *                              ORDER_CANCELLED   -> release stock -> publishes STOCK_RELEASED
 *  - consumes `product-events` PRODUCT_CREATED / VARIANT_CREATED -> auto-create inventory
 *  - produces  `inventory-events` and appends a full stock-movement audit trail.
 */
const crypto = require('crypto');
const store = require('../store');
const { publish, subscribe } = require('../eventbus');

const RESERVATION_TTL_MS = 15 * 60 * 1000; // same 15-minute reservation window

const db = store.load('inventory_db', { inventory: [], reservations: [], movements: [] });

function persist() { store.save('inventory_db', db); }

function apiError(code, message, status) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

const findInventory = sku => db.inventory.find(i => i.sku === sku);

function toStockInfo(i) {
  return {
    id: i.id, sku: i.sku, variantId: i.variantId || null, productId: i.productId || null,
    productName: i.productName || null, variantName: i.variantName || null,
    availableStock: i.availableStock, reservedStock: i.reservedStock,
    totalStock: i.availableStock + i.reservedStock,
    lowStock: i.availableStock <= i.reorderPoint,
    reorderPoint: i.reorderPoint, minStockLevel: i.minStockLevel, maxStockLevel: i.maxStockLevel,
    isActive: i.isActive !== false, createdAt: i.createdAt, updatedAt: i.updatedAt,
  };
}

function toReservationResponse(r) {
  return {
    id: r.id, orderId: r.orderId || null, sku: r.sku, variantId: r.variantId || null,
    quantity: r.quantity, status: r.status,
    expiresAt: r.expiresAt, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

function recordMovement(inventory, type, quantityChange, reference) {
  db.movements.push({
    id: crypto.randomUUID(),
    inventoryId: inventory.id, sku: inventory.sku,
    type, quantityChange,
    resultingAvailable: inventory.availableStock,
    reference: reference || null,
    createdAt: new Date().toISOString(),
  });
}

function maybeLowStockAlert(inventory, reference) {
  if (inventory.availableStock <= inventory.reorderPoint) {
    publish('inventory-events', {
      eventType: 'LOW_STOCK_ALERT', sku: inventory.sku,
      availableStock: inventory.availableStock, reorderPoint: inventory.reorderPoint,
      occurredAt: new Date().toISOString(), reference: reference || null,
    });
  }
}

/* ── Query endpoints ─────────────────────────────────────────── */

function getBySku(sku) {
  const i = findInventory(sku);
  if (!i) throw apiError('INVENTORY_NOT_FOUND', `No inventory record for SKU ${sku}`, 404);
  return toStockInfo(i);
}

function getByProduct(productId) {
  return db.inventory.filter(i => i.productId === productId).map(toStockInfo);
}

function lowStock() {
  return db.inventory.filter(i => i.isActive !== false && i.availableStock <= i.reorderPoint)
    .map(toStockInfo);
}

/** Demo extra beyond the original contract: full stock list for the admin console. */
function listAll() {
  return db.inventory.filter(i => i.isActive !== false).map(toStockInfo);
}

/* ── Mutations ───────────────────────────────────────────────── */

function createInventory({ sku, variantId, productId, productName, variantName, totalStock, reorderPoint, minStockLevel, maxStockLevel }) {
  if (!sku) throw apiError('400', 'SKU is required', 400);
  if (findInventory(sku)) throw apiError('DUPLICATE_INVENTORY', `Inventory already exists for SKU ${sku}`, 409);
  const now = new Date().toISOString();
  const inventory = {
    id: crypto.randomUUID(), sku,
    variantId: variantId || null, productId: productId || null,
    productName: productName || null, variantName: variantName || null,
    availableStock: Number.isInteger(totalStock) && totalStock >= 0 ? totalStock : 0,
    reservedStock: 0,
    reorderPoint: reorderPoint ?? 5,
    minStockLevel: minStockLevel ?? 0,
    maxStockLevel: maxStockLevel ?? 100000,
    isActive: true, createdAt: now, updatedAt: now,
  };
  db.inventory.push(inventory);
  recordMovement(inventory, 'INITIALIZE', inventory.availableStock, 'inventory-create');
  persist();
  publish('inventory-events', {
    eventType: 'STOCK_UPDATED', sku, availableStock: inventory.availableStock,
    occurredAt: now, reference: 'inventory-create',
  });
  return toStockInfo(inventory);
}

/** operation: ADD | SUBTRACT | SET */
function updateStock(sku, { operation, quantity, reference }) {
  const i = findInventory(sku);
  if (!i) throw apiError('INVENTORY_NOT_FOUND', `No inventory record for SKU ${sku}`, 404);
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 0) throw apiError('INVALID_STOCK_OPERATION', 'Quantity must be a non-negative integer', 400);

  const before = i.availableStock;
  switch (String(operation || '').toUpperCase()) {
    case 'ADD': i.availableStock += qty; break;
    case 'SUBTRACT':
      if (qty > i.availableStock) throw apiError('INSUFFICIENT_STOCK', `Cannot subtract ${qty}; only ${i.availableStock} available`, 409);
      i.availableStock -= qty; break;
    case 'SET': i.availableStock = qty; break;
    default: throw apiError('INVALID_STOCK_OPERATION', 'Operation must be ADD, SUBTRACT or SET', 400);
  }
  i.updatedAt = new Date().toISOString();
  recordMovement(i, operation.toUpperCase(), i.availableStock - before, reference || 'manual-update');
  persist();
  publish('inventory-events', {
    eventType: 'STOCK_UPDATED', sku, availableStock: i.availableStock,
    previousStock: before, occurredAt: i.updatedAt, reference: reference || null,
  });
  maybeLowStockAlert(i, reference);
  return toStockInfo(i);
}

/* ── Availability ────────────────────────────────────────────── */

function checkAvailability(items) {
  return (items || []).map(({ sku, quantity }) => {
    const i = findInventory(sku);
    const available = i ? i.availableStock : 0;
    return {
      sku, requestedQuantity: quantity, availableStock: available,
      sufficient: available >= quantity,
    };
  });
}

/* ── Reservations ────────────────────────────────────────────── */

function reserveSingle({ sku, quantity, orderId, variantId }) {
  const i = findInventory(sku);
  if (!i) throw apiError('INVENTORY_NOT_FOUND', `No inventory record for SKU ${sku}`, 404);
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) throw apiError('400', 'Quantity must be at least 1', 400);
  if (i.availableStock < qty) {
    throw apiError('INSUFFICIENT_STOCK', `Insufficient stock for ${sku}: requested ${qty}, available ${i.availableStock}`, 409);
  }
  return doReserve(i, qty, orderId, variantId);
}

function doReserve(inventory, quantity, orderId, variantId) {
  const now = new Date().toISOString();
  inventory.availableStock -= quantity;
  inventory.reservedStock += quantity;
  inventory.updatedAt = now;
  const reservation = {
    id: crypto.randomUUID(), orderId: orderId || null,
    sku: inventory.sku, variantId: variantId || inventory.variantId || null,
    quantity, status: 'RESERVED',
    expiresAt: new Date(Date.now() + RESERVATION_TTL_MS).toISOString(),
    createdAt: now, updatedAt: now,
  };
  db.reservations.push(reservation);
  recordMovement(inventory, 'RESERVE', -quantity, orderId ? `order:${orderId}` : 'direct-reserve');
  persist();
  return reservation;
}

function bulkReserve({ orderId, items }) {
  const checked = checkAvailability(items);
  const insufficient = checked.filter(c => !c.sufficient);
  if (insufficient.length > 0) {
    throw apiError('INSUFFICIENT_STOCK',
      `Insufficient stock for: ${insufficient.map(i => `${i.sku} (requested ${i.requestedQuantity}, available ${i.availableStock})`).join('; ')}`, 409);
  }
  const reservations = items.map(({ sku, quantity }) => {
    const i = findInventory(sku);
    return doReserve(i, quantity, orderId, i.variantId);
  });
  return { orderId: orderId || null, reservations: reservations.map(toReservationResponse) };
}

function confirmReservation(id) {
  const r = db.reservations.find(x => x.id === id);
  if (!r) throw apiError('RESERVATION_NOT_FOUND', `Reservation not found: ${id}`, 404);
  if (r.status !== 'RESERVED') throw apiError('INVALID_RESERVATION_STATE', `Reservation is ${r.status}, cannot confirm`, 409);
  const i = findInventory(r.sku);
  if (i) {
    i.reservedStock = Math.max(0, i.reservedStock - r.quantity);
    i.updatedAt = new Date().toISOString();
    recordMovement(i, 'CONFIRM', -r.quantity, `reservation:${r.id}`);
  }
  r.status = 'CONFIRMED';
  r.updatedAt = new Date().toISOString();
  persist();
  return toReservationResponse(r);
}

function releaseReservation(id, reason) {
  const r = db.reservations.find(x => x.id === id);
  if (!r) throw apiError('RESERVATION_NOT_FOUND', `Reservation not found: ${id}`, 404);
  if (r.status !== 'RESERVED') throw apiError('INVALID_RESERVATION_STATE', `Reservation is ${r.status}, cannot release`, 409);
  r.status = 'RELEASED';
  r.updatedAt = new Date().toISOString();
  const i = findInventory(r.sku);
  if (i) {
    i.reservedStock = Math.max(0, i.reservedStock - r.quantity);
    i.availableStock += r.quantity;
    i.updatedAt = new Date().toISOString();
    recordMovement(i, 'RELEASE', r.quantity, reason || `reservation:${r.id}`);
  }
  persist();
  return toReservationResponse(r);
}

function reservationsByOrder(orderId) {
  return db.reservations.filter(r => r.orderId === orderId).map(toReservationResponse);
}

/* ── Saga listeners ──────────────────────────────────────────── */

/** Small artificial latency so the PENDING -> STOCK_RESERVED saga transition
 *  is visible in the UI timeline, like watching real Kafka consumers work. */
const SAGA_LATENCY_MS = Number(process.env.SAGA_LATENCY_MS || 700);

function onOrderCreated(event) {
  const { orderId, orderNumber, items } = event;
  setTimeout(() => {
    try {
      const checked = checkAvailability(items.map(i => ({ sku: i.sku, quantity: i.quantity })));
      const insufficient = checked.filter(c => !c.sufficient);
      if (insufficient.length > 0) {
        publish('inventory-events', {
          eventType: 'STOCK_RESERVATION_FAILED', orderId, orderNumber,
          reason: insufficient.map(i => `${i.sku}: requested ${i.requestedQuantity}, available ${i.availableStock}`).join('; '),
          items, occurredAt: new Date().toISOString(),
        });
        return;
      }
      const reservations = items.map(i => doReserve(findInventory(i.sku), i.quantity, orderId, i.variantId));
      publish('inventory-events', {
        eventType: 'STOCK_RESERVED', orderId, orderNumber,
        items: reservations.map(r => ({ sku: r.sku, quantity: r.quantity, reservationId: r.id })),
        occurredAt: new Date().toISOString(),
      });
    } catch (err) {
      publish('inventory-events', {
        eventType: 'STOCK_RESERVATION_FAILED', orderId, orderNumber,
        reason: err.message, items: items || [], occurredAt: new Date().toISOString(),
      });
    }
  }, SAGA_LATENCY_MS);
}

function onOrderCancelled(event) {
  const { orderId, orderNumber, reason } = event;
  setTimeout(() => {
    const active = db.reservations.filter(r => r.orderId === orderId && r.status === 'RESERVED');
    active.forEach(r => releaseReservation(r.id, reason || `order-cancelled:${orderNumber || orderId}`));
    publish('inventory-events', {
      eventType: 'STOCK_RELEASED', orderId, orderNumber,
      releasedCount: active.length, occurredAt: new Date().toISOString(),
    });
  }, SAGA_LATENCY_MS);
}

function onProductEvent(event) {
  const now = new Date().toISOString();
  if (event.eventType === 'PRODUCT_CREATED') {
    (event.variants || []).forEach(v => {
      if (!findInventory(v.sku)) {
        createInventory({ sku: v.sku, variantId: v.variantId, productId: event.productId, productName: event.name, totalStock: 25, reorderPoint: 5 });
      }
    });
  } else if (event.eventType === 'VARIANT_CREATED') {
    if (!findInventory(event.sku)) {
      createInventory({ sku: event.sku, variantId: event.variantId, productId: event.productId, totalStock: 25, reorderPoint: 5 });
    }
  } else if (event.eventType === 'PRODUCT_DELETED') {
    db.inventory.forEach(i => { if (i.productId === event.productId) { i.isActive = false; i.updatedAt = now; } });
    persist();
  }
}

function initListeners() {
  subscribe('order-events', event => {
    if (event.eventType === 'ORDER_CREATED') onOrderCreated(event);
    if (event.eventType === 'ORDER_CANCELLED') onOrderCancelled(event);
  });
  subscribe('product-events', onProductEvent);
}

function countInventory() { return db.inventory.length; }

/** Seeder only. */
function _insertSeed(records) {
  db.inventory.push(...records);
  persist();
}

module.exports = {
  getBySku, getByProduct, lowStock, listAll, createInventory, updateStock,
  checkAvailability, reserveSingle, bulkReserve, confirmReservation, releaseReservation,
  reservationsByOrder, initListeners, countInventory, _insertSeed,
};
