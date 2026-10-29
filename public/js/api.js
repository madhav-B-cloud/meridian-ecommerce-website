'use strict';
/* MERIDIAN API client.
 * Same-origin by default; point window.MERIDIAN_API_BASE at the Java API
 * gateway (http://localhost:7999) and the storefront talks to the real
 * Spring Boot services — the contract is identical. */

(function () {
  const BASE = (window.MERIDIAN_API_BASE || '').replace(/\/$/, '');

  const TOKEN_KEY = 'm_token';
  const REFRESH_KEY = 'm_refresh';
  const USER_KEY = 'm_user';

  const session = {
    get token() { return localStorage.getItem(TOKEN_KEY) || ''; },
    get refreshToken() { return localStorage.getItem(REFRESH_KEY) || ''; },
    get user() {
      try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
    },
    set(login) {
      localStorage.setItem(TOKEN_KEY, login.accessToken);
      localStorage.setItem(REFRESH_KEY, login.refreshToken);
      localStorage.setItem(USER_KEY, JSON.stringify(login.user));
    },
    setUser(user) { localStorage.setItem(USER_KEY, JSON.stringify(user)); },
    clear() {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_KEY);
      localStorage.removeItem(USER_KEY);
    },
    get isLoggedIn() { return !!localStorage.getItem(TOKEN_KEY); },
    get isAdmin() { return this.user && this.user.role === 'ADMIN'; },
  };

  /** Low-level request; resolves with ApiResponse.data, rejects with {code, message, status}. */
  async function request(method, path, body) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (session.token) headers.Authorization = `Bearer ${session.token}`;

    let res;
    try {
      res = await fetch(BASE + path, {
        method, headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw { code: 'NETWORK', message: 'Cannot reach the store. Is the server running?', status: 0 };
    }

    let json = null;
    try { json = await res.json(); } catch { /* non-JSON */ }

    if (res.status === 401 && !path.startsWith('/api/auth/login') && !path.startsWith('/api/auth/register')) {
      // expired/revoked token -> drop the session
      session.clear();
      window.dispatchEvent(new CustomEvent('meridian:session-expired'));
    }
    if (!res.ok || (json && json.data === null && res.status >= 400)) {
      throw {
        code: (json && json.code) || String(res.status),
        message: (json && json.message) || `Request failed (${res.status})`,
        status: res.status,
      };
    }
    if (json && typeof json === 'object' && 'data' in json) return json.data;
    return json;
  }

  const api = {
    session,

    /* auth */
    register: (body) => request('POST', '/api/auth/register', body),
    login: async (body) => {
      const data = await request('POST', '/api/auth/login', body);
      session.set(data);
      return data;
    },
    logout: async () => {
      try { await request('POST', '/api/auth/logout'); } catch { /* best effort */ }
      session.clear();
    },
    me: () => request('GET', '/api/auth/me'),
    changePassword: (body) => request('PUT', '/api/auth/change-password', body),

    /* catalog */
    products: (query = {}) => request('GET', '/api/products?' + qs(query)),
    product: (id) => request('GET', `/api/products/${id}`),
    categories: () => request('GET', '/api/categories'),
    brands: () => request('GET', '/api/brands'),

    /* inventory */
    inventoryForProduct: (productId) => request('GET', `/api/inventory/product/${productId}`),
    inventoryBySku: (sku) => request('GET', `/api/inventory/${encodeURIComponent(sku)}`),
    inventoryAll: () => request('GET', '/api/inventory/all'),
    checkAvailability: (items) => request('POST', '/api/inventory/check-availability', { items }),
    updateStock: (sku, body) => request('PUT', `/api/inventory/${encodeURIComponent(sku)}/stock`, body),
    lowStock: () => request('GET', '/api/inventory/alerts/low-stock'),

    /* orders */
    createOrder: (body) => request('POST', '/api/orders', body),
    order: (id) => request('GET', `/api/orders/${id}`),
    myOrders: (page = 0, size = 10) => request('GET', `/api/orders/my-orders?page=${page}&size=${size}`),
    confirmOrder: (id) => request('POST', `/api/orders/${id}/confirm`),
    cancelOrder: (id, reason) => request('POST', `/api/orders/${id}/cancel`, { reason }),
    pay: (body) => request('POST', '/api/payments/checkout', body),
    ordersByStatus: (status, page = 0, size = 20) =>
      request('GET', `/api/orders/admin/by-status?status=${status}&page=${page}&size=${size}`),
    advanceOrder: (id, action) => request('POST', `/api/orders/${id}/${action}`),

    /* saga observability */
    recentEvents: () => request('GET', '/api/events/recent'),

  };

  function qs(params) {
    return Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
  }

  window.api = api;
  window.session = session;
})();
