'use strict';
/**
 * API gateway — mirrors microservices-ecommerce/api-gateway (port 7999).
 *
 * Same responsibilities, minus the network hops:
 *  - single entry point for every /api route (route table below)
 *  - JWT validation filter, forwarding identity as the gateway's
 *    X-User-Id / X-User-Role headers would
 *  - Redis-backed rate limiter  -> in-process sliding window
 *  - Redis logout blacklist     -> in-memory token blacklist (persisted)
 *  - global CORS, health endpoint, ApiResponse-wrapped errors
 */
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const store = require('./store');
const { recent: recentEvents } = require('./eventbus');
const auth = require('./services/authService');
const catalog = require('./services/catalogService');
const inventory = require('./services/inventoryService');
const orders = require('./services/orderService');
const { seed } = require('./seed');

const PORT = Number(process.env.PORT || 3000);

/* ── ApiResponse wrapper (same shape as common/ApiResponse.java) ── */
function ok(code, message, data, status = 200) {
  return { __status: status, body: { code, message, data, timestamp: new Date().toISOString(), traceId: crypto.randomUUID() } };
}
function fail(code, message, status = 400) {
  return ok(code, message, null, status);
}
const wrap = (res, r) => res.status(r.__status).json(r.body);

/* ── Token blacklist (gateway-local, persisted) ── */
const blacklist = new Set(store.load('gateway_db', { blacklisted: [] }).blacklisted);
function blacklistSave() {
  store.save('gateway_db', { blacklisted: [...blacklist] });
}

/* ── Rate limiter (sliding window, per IP) ── */
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MIN || 300);
const hits = new Map();
function rateLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const windowStart = now - 60000;
  const list = (hits.get(key) || []).filter(t => t > windowStart);
  list.push(now);
  hits.set(key, list);
  if (list.length > RATE_LIMIT) {
    return wrap(res, fail('429', 'Rate limit exceeded — too many requests, slow down', 429));
  }
  next();
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit);

/* Global CORS — same "all origins, all methods" as the gateway config */
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ── JWT authentication filter ─────────────────────────────────
 * Public paths mirror the gateway route table, with one pragmatic
 * deviation: catalog GETs are public so visitors can browse the
 * storefront without an account (mutations still require ADMIN). */
const PUBLIC_PATHS = new Set([
  '/api/auth/register', '/api/auth/login', '/api/auth/refresh-token',
  '/api/auth/forgot-password', '/api/auth/reset-password', '/api/auth/verify-email',
]);
const PUBLIC_GET_PREFIXES = ['/api/products', '/api/categories', '/api/brands'];

app.use('/api', (req, res, next) => {
  // req.path is mount-relative here ("/products"), so compare on originalUrl
  const fullPath = req.originalUrl.split('?')[0];
  if (PUBLIC_PATHS.has(fullPath)) return next();
  if (req.method === 'GET' && PUBLIC_GET_PREFIXES.some(p => fullPath.startsWith(p))) return next();
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return wrap(res, fail('401', 'Missing or malformed Authorization header', 401));
  if (blacklist.has(token)) return wrap(res, fail('401', 'Token has been revoked (logged out)', 401));
  const claims = auth.verifyAccessToken(token);
  if (!claims) return wrap(res, fail('401', 'Access token is invalid or expired', 401));
  // the gateway forwards these headers to downstream services
  req.user = { userId: claims.userId, username: claims.username, role: claims.role };
  req.token = token;
  next();
});

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'ADMIN') return wrap(res, fail('403', 'ADMIN role required', 403));
  next();
};

const handler = fn => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (data && data.__status && data.body) return wrap(res, data); // already wrapped
    wrap(res, ok('200', 'Success', data));
  } catch (err) {
    if (err.code && err.status) return wrap(res, fail(err.code, err.message, err.status));
    console.error('[gateway] unhandled error:', err);
    wrap(res, fail('500', err.message || 'Internal server error', 500));
  }
};

/* ── Auth routes ─────────────────────────────────────────────── */
app.post('/api/auth/register', handler(req => ok('201', 'Registration successful', auth.register(req.body), 201)));
app.post('/api/auth/login', handler(req => ok('200', 'Login successful', auth.login(req.body))));
app.post('/api/auth/refresh-token', handler(req => ok('200', 'Token refreshed', auth.refresh(req.body.refreshToken))));
app.get('/api/auth/me', handler(req => ok('200', 'Success', auth.me(req.user.userId))));
app.put('/api/auth/change-password', handler(req => ok('200', 'Password changed', auth.changePassword(req.user.userId, req.body))));
// gateway-local logout: blacklist the presented token (Redis in the original)
app.post('/api/auth/logout', handler(req => {
  blacklist.add(req.token);
  blacklistSave();
  return ok('200', 'Logged out', { message: 'Token blacklisted' });
}));
// mail-backed flows return the same success contract without sending email
app.post('/api/auth/forgot-password', handler(() => ok('200', 'If that account exists, a reset link has been sent', { message: 'Email dispatch is mocked in this demo' })));
app.post('/api/auth/reset-password', handler(() => ok('200', 'Password reset successful', { message: 'Password reset is mocked in this demo' })));
app.post('/api/auth/verify-email', handler(() => ok('200', 'Email verified', { verified: true })));

/* ── Catalog routes (product service) ────────────────────────── */
app.get('/api/products', handler(req => catalog.listProducts(req.query)));
app.get('/api/categories', handler(() => catalog.listCategories()));
app.get('/api/brands', handler(() => catalog.listBrands()));
app.get('/api/products/:id', handler(req => catalog.getProduct(req.params.id)));
app.get('/api/products/:id/variants', handler(req => catalog.getProduct(req.params.id).variants));
app.post('/api/products', requireAdmin, handler(req => ok('201', 'Product created', catalog.createProduct(req.body), 201)));
app.post('/api/products/:id/variants', requireAdmin, handler(req => ok('201', 'Variant created', catalog.createVariant(req.params.id, req.body), 201)));
app.delete('/api/products/:id', requireAdmin, handler(req => catalog.deleteProduct(req.params.id)));
app.post('/api/categories', requireAdmin, handler(req => ok('201', 'Category created', catalog.createCategory(req.body), 201)));
app.post('/api/brands', requireAdmin, handler(req => ok('201', 'Brand created', catalog.createBrand(req.body), 201)));

/* ── Inventory routes ────────────────────────────────────────── */
app.get('/api/inventory/alerts/low-stock', handler(() => inventory.lowStock()));
app.get('/api/inventory/all', requireAdmin, handler(() => inventory.listAll()));
app.get('/api/inventory/product/:productId', handler(req => inventory.getByProduct(req.params.productId)));
app.get('/api/inventory/:sku', handler(req => inventory.getBySku(req.params.sku)));
app.post('/api/inventory/check-availability', handler(req => inventory.checkAvailability(req.body.items || [])));
app.post('/api/inventory', requireAdmin, handler(req => ok('201', 'Inventory created', inventory.createInventory(req.body), 201)));
app.put('/api/inventory/:sku/stock', requireAdmin, handler(req => inventory.updateStock(req.params.sku, req.body)));

/* ── Reservation routes ──────────────────────────────────────── */
app.post('/api/reservations/check-availability', handler(req => inventory.checkAvailability(req.body.items || [])));
app.post('/api/reservations/reserve', handler(req => ok('201', 'Stock reserved', inventory.reserveSingle(req.body), 201)));
app.post('/api/reservations/bulk-reserve', handler(req => ok('201', 'Stock reserved', inventory.bulkReserve(req.body), 201)));
app.get('/api/reservations/order/:orderId', handler(req => inventory.reservationsByOrder(req.params.orderId)));
app.post('/api/reservations/:id/confirm', handler(req => inventory.confirmReservation(req.params.id)));
app.post('/api/reservations/:id/release', handler(req => inventory.releaseReservation(req.params.id)));

/* ── Order routes ────────────────────────────────────────────── */
app.post('/api/orders', handler(req => ok('201', 'Order created', orders.createOrder(req.user.userId, req.body), 201)));
app.get('/api/orders/my-orders', handler(req => orders.myOrders(req.user.userId, req.query.page, req.query.size)));
app.get('/api/orders/number/:orderNumber', handler(req => orders.getOrder(req.params.orderNumber)));
app.get('/api/orders/admin/by-status', requireAdmin, handler(req => orders.listByStatus(req.query.status || 'PENDING', req.query.page, req.query.size)));
app.post('/api/orders/:id/confirm', handler(req => orders.confirmOrder(req.params.id, req.user.userId, req.user.role)));
app.post('/api/orders/:id/cancel', handler(req => orders.cancelOrder(req.params.id, req.user.userId, req.user.role, req.body && req.body.reason)));
app.post('/api/orders/:id/processing', requireAdmin, handler(req => orders.advanceStatus(req.params.id, 'PROCESSING')));
app.post('/api/orders/:id/ship', requireAdmin, handler(req => orders.advanceStatus(req.params.id, 'SHIPPED')));
app.post('/api/orders/:id/deliver', requireAdmin, handler(req => orders.advanceStatus(req.params.id, 'DELIVERED')));
app.get('/api/orders/:id', handler(req => orders.getOrder(req.params.id)));

/* ── Fake payment gateway (demo extra) ─────────────────────────
 * Simulates a PSP: validates the (fake) instrument, processes with
 * latency, then captures the payment by confirming the order.
 * Declines: card ending 0000, UPI id starting with "fail".      */
const PAY_METHODS = ['upi', 'card', 'netbanking', 'cod'];
app.post('/api/payments/checkout', (req, res) => {
  const respond = (r) => res.status(r.__status).json(r.body);
  try {
    const { orderId, method } = req.body || {};
    if (!PAY_METHODS.includes(method)) return respond(fail('400', 'method must be one of ' + PAY_METHODS.join(', '), 400));

    let order;
    try { order = orders.getOrder(orderId); }
    catch { return respond(fail('ORDER_NOT_FOUND', `Order not found: ${orderId}`, 404)); }
    if (order.userId !== req.user.userId && req.user.role !== 'ADMIN') {
      return respond(fail('403', 'You do not own this order', 403));
    }
    if (['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'].includes(order.status)) {
      return respond(fail('ALREADY_PAID', 'This order has already been paid', 409));
    }
    if (order.status !== 'STOCK_RESERVED') {
      return respond(fail('INVALID_ORDER_STATE', `Order is not awaiting payment (currently ${order.status})`, 409));
    }

    // validate the fake instrument
    const body = req.body || {};
    let instrument = '';
    let declined = false;
    if (method === 'card') {
      const digits = String(body.cardNumber || '').replace(/\D/g, '');
      if (digits.length !== 16) return respond(fail('INVALID_CARD', 'Card number must be 16 digits', 400));
      if (!/^\d{2}\/\d{2}$/.test(String(body.expiry || ''))) return respond(fail('INVALID_CARD', 'Expiry must be MM/YY', 400));
      if (!/^\d{3,4}$/.test(String(body.cvv || ''))) return respond(fail('INVALID_CARD', 'CVV must be 3-4 digits', 400));
      if (!String(body.cardName || '').trim()) return respond(fail('INVALID_CARD', 'Cardholder name is required', 400));
      instrument = 'Card •••• ' + digits.slice(-4);
      declined = digits.endsWith('0000');
    } else if (method === 'upi') {
      const upi = String(body.upiId || '').trim();
      if (!/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(upi)) return respond(fail('INVALID_UPI', 'UPI ID must look like name@bank', 400));
      instrument = 'UPI ' + upi;
      declined = upi.toLowerCase().startsWith('fail');
    } else if (method === 'netbanking') {
      const bank = String(body.bank || '').trim();
      if (!bank) return respond(fail('INVALID_BANK', 'Choose a bank to continue', 400));
      instrument = 'Netbanking — ' + bank;
    } else {
      instrument = 'Cash on Delivery';
    }

    // simulate gateway latency, then capture or decline
    setTimeout(() => {
      if (declined) {
        console.log(`[payments] DECLINED ${method} for ${order.orderNumber}`);
        return respond(fail('PAYMENT_DECLINED', 'The bank declined this payment. Try another method or instrument.', 402));
      }
      const detail = method === 'cod'
        ? 'Cash on Delivery — pay when it arrives'
        : `Payment captured via ${instrument}`;
      const confirmed = orders.confirmOrder(orderId, req.user.userId, req.user.role, detail);
      const txn = (method === 'cod' ? 'COD-' : 'TXN-') +
        Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
      console.log(`[payments] CAPTURED ${txn} (${instrument}) for ${order.orderNumber}`);
      respond(ok('200', 'Payment captured', {
        transactionId: txn, method, instrument,
        amount: confirmed.totalAmount, currency: confirmed.currency, paidAt: confirmed.updatedAt,
        order: confirmed,
      }));
    }, 1400);
  } catch (err) {
    if (err.code && err.status) return respond(fail(err.code, err.message, err.status));
    console.error('[payments] error:', err);
    respond(fail('500', err.message || 'Payment failed', 500));
  }
});

/* ── Saga observability (demo extra) ─────────────────────────── */
app.get('/api/events/recent', handler(() => recentEvents(60)));

/* ── Health ──────────────────────────────────────────────────── */
app.get('/actuator/health', (req, res) => res.json({ status: 'UP' }));
app.get('/api/actuator/health', (req, res) => res.json({ status: 'UP' }));

/* Unknown API route -> ApiResponse 404 */
app.use('/api', (req, res) => wrap(res, fail('404', `No route for ${req.method} ${req.path}`, 404)));

/* ── Static storefront + self-hosted fonts + SPA fallback ────── */
app.use('/fonts/fraunces', express.static(path.join(__dirname, '..', 'node_modules', '@fontsource', 'fraunces')));
app.use('/fonts/archivo', express.static(path.join(__dirname, '..', 'node_modules', '@fontsource', 'archivo')));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

/* Final error handler (body parse errors etc.) */
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[gateway]', err.message);
  wrap(res, fail('400', err.message || 'Bad request', 400));
});

/* ── Boot ────────────────────────────────────────────────────── */
seed()
  .then(() => {
    app.listen(PORT, () => {
      console.log('');
      console.log('  MERIDIAN gateway listening on http://localhost:' + PORT);
      console.log('  Health:    http://localhost:' + PORT + '/actuator/health');
      console.log('  Storefront: http://localhost:' + PORT + '/');
      console.log('  Demo login: admin@meridian.dev / Admin@123!  ·  demo@meridian.dev / Customer@123!');
      console.log('');
    });
  })
  .catch(err => {
    console.error('Failed to seed/start:', err);
    process.exit(1);
  });
