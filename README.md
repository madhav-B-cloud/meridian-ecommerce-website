# MERIDIAN — the microservices-ecommerce platform as a working website

This is a **runnable ecommerce website** built on top of the API contract of
[nashinnov8/microservices-ecommerce](../microservices-ecommerce) (the cloned repo sits next to
this folder). That repo is a **backend-only** platform — five Spring Boot services with Kafka,
MySQL and Redis — with no user interface, and it requires Docker + a JDK 21 toolchain to run.

This folder turns that platform into something you can actually open in a browser:

- a **storefront SPA** (home, shop with filters, product detail with variants, cart, checkout,
  live saga order tracking, order history, auth, admin console), and
- a **Node.js API** that mirrors the Java platform's contract — same endpoints, same
  `ApiResponse`/`PageResponse` envelope, same `LoginResponse`/`UserInfo`/`StockInfoResponse`
  shapes, same saga event types — with the Kafka topics replaced by an in-process event bus.

## Run it

```bash
npm install     # already done if node_modules exists
npm start       # http://localhost:3000
```

First boot seeds a demo catalog (28 products, 64 SKUs, inventory, users, one delivered order)
with **real product photography** (sourced from Unsplash, free license, stored locally in
`public/img/products/*.jpg`). Products without a photo fall back to the generated duotone SVG
illustrations in `server/artwork.js`. Prices are in **Indian Rupees (INR)** — formatted with
Indian digit grouping (₹23,999) — and orders default to `currency: INR`. Free shipping over
₹2,000 (₹99 otherwise). `npm run reseed` wipes and reseeds.

**Demo accounts**

| Role | Login | Password |
|---|---|---|
| Customer | `demo` (or `demo@meridian.dev`) | `Customer@123!` |
| Admin | `admin` (or `admin@meridian.dev`) | `Admin@123!` |

Sessions expire after 1 hour (configurable via `JWT_EXPIRATION`) — you'll be redirected to the
sign-in page and returned to where you were after logging in. Reseeding wipes any account you
created; the demo accounts above always work.

## The order saga, live

Place an order and the confirmation screen shows the saga timeline polling in real time:

```
order-service                    inventory-service
─────────────                    ─────────────────
ORDER_CREATED  ────order-events──▶  reserve each SKU
status: PENDING                   ◀──inventory-events──  STOCK_RESERVED
status: STOCK_RESERVED
   pay ──▶ CONFIRMED ──▶ PROCESSING ──▶ SHIPPED ──▶ DELIVERED
```

- If stock can't be reserved, `STOCK_RESERVATION_FAILED` fails the order instead of overselling.
  (Try it: in the admin console set `LUM-TMPO-20KG-DEF` to 0, then order the 20 kg Tempo.)
- Cancelling publishes `ORDER_CANCELLED`, which releases reserved stock back.
- After checkout you land on a **fake payment page** (UPI / card / netbanking / COD). Paying
  calls the demo gateway, which captures the payment and confirms the order — watch the saga
  timeline gain its "Payment captured" step.
- After payment the order **auto-advances** CONFIRMED → PROCESSING → SHIPPED → DELIVERED on a
  fake interval (`FULFILLMENT_STEP_MS`, default 10s) with details per step — packing note, a
  generated courier AWB tracking number, delivery confirmation. The order page polls live and
  shows what each upcoming step will do; the chain resumes after a server restart, and stops
  if the order is cancelled.

Console colors show the three Kafka topics firing: `product-events`, `inventory-events`, `order-events`.

## API (same contract as the Java gateway)

Base `http://localhost:3000`. Success envelope: `{code, message, data, timestamp, traceId}`.

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/refresh-token`, `POST /api/auth/logout` (gateway blacklist), `GET /api/auth/me`, `PUT /api/auth/change-password`, mock `forgot-password` / `reset-password` / `verify-email` |
| Catalog | `GET /api/products` (`pageNumber`, `pageSize`, `search`, `category`, `brand`, `minPrice`, `maxPrice`, `sort`), `GET /api/products/:id`, `GET /api/products/:id/variants`, `GET /api/categories`, `GET /api/brands`; create/delete require ADMIN |
| Inventory | `GET /api/inventory/:sku`, `GET /api/inventory/product/:id`, `GET /api/inventory/alerts/low-stock`, `POST /api/inventory/check-availability`, `PUT /api/inventory/:sku/stock` (`ADD`/`SUBTRACT`/`SET`), `POST /api/inventory`; extra: `GET /api/inventory/all` (admin) |
| Reservations | `POST /api/reservations/reserve`, `POST /api/reservations/bulk-reserve`, `POST /api/reservations/:id/confirm`, `POST /api/reservations/:id/release`, `GET /api/reservations/order/:orderId` |
| Orders | `POST /api/orders`, `GET /api/orders/:id`, `GET /api/orders/number/:num`, `GET /api/orders/my-orders?page=0&size=10`, `POST /api/orders/:id/confirm`, `POST /api/orders/:id/cancel`; admin `…/processing` `…/ship` `…/deliver`, `GET /api/orders/admin/by-status` |
| Payments | `POST /api/payments/checkout` — demo gateway: `{orderId, method: upi\|card\|netbanking\|cod, …instrument}`. Simulates gateway latency, then captures the payment (confirms the order). Declines: card ending `0000`, UPI id starting with `fail` → `402 PAYMENT_DECLINED`. |

| Extras | `GET /actuator/health`, `GET /api/events/recent` (saga event log) |

Password policy is the auth-service regex: min 8 chars with an uppercase letter, a digit and a
special character (`@$!%*?&`).

## Deviations from the original (and why)

- **One Node process instead of five JVM services.** No Docker/Java/Kafka/MySQL needed. The
  service boundaries survive: auth, catalog, inventory and orders each own a private JSON store
  (`data/auth_db.json`, `product_db.json`, `inventory_db.json`, `order_db.json`), and they talk
  only through the event bus.
- **Kafka → EventEmitter, Redis → in-process structures.** The rate limiter is a sliding window;
  the logout blacklist is a persisted set.
- **Catalog `GET`s are public** so visitors can browse without an account (the original gateway
  requires auth for everything). Mutations still require the ADMIN role.
- **Mail flows are mocked** (`forgot-password`, `reset-password`) — they return the same success
  contract without sending email.
- `GET /api/inventory/all` and `GET /api/events/recent` are small demo extras.

## Pointing the storefront at the real Java platform

The frontend speaks the same contract, so on a Docker-capable machine you can start the real
stack (`docker compose -f ../microservices-ecommerce/docker-compose.dev.yml up --build -d`,
gateway on port 7999) and serve this site's frontend from anywhere by setting, before `app.js` loads:

```js
window.MERIDIAN_API_BASE = 'http://localhost:7999';
```

## Layout

```
ecommerce-website/
├── server/
│   ├── server.js               # gateway: static, CORS, rate limit, JWT filter, routes
│   ├── eventbus.js             # Kafka stand-in (3 topics + capped event history)
│   ├── store.js                # JSON-file persistence (database-per-service)
│   ├── artwork.js              # generates the SVG product/category art
│   ├── seed.js                 # demo catalog, users, stock shaping, demo order
│   └── services/
│       ├── authService.js      # register/login/refresh/me (bcrypt + JWT)
│       ├── catalogService.js   # products, variants, categories, brands
│       ├── inventoryService.js # stock, reservations, saga consumer/producer
│       └── orderService.js     # orders + saga orchestrator
├── public/                     # storefront SPA (vanilla JS, hash router)
│   ├── index.html
│   ├── css/styles.css          # MERIDIAN design system (Fraunces + Archivo, paper & ink)
│   ├── js/api.js               # fetch layer — set MERIDIAN_API_BASE here to retarget
│   ├── js/app.js               # router + views (shop, pdp, cart, checkout, saga, admin)
│   └── img/                    # generated SVG art (products, categories)
└── data/                       # seeded JSON stores (git-ignoreable, delete to reseed)
```
