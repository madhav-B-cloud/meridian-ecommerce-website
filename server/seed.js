'use strict';
/**
 * Seeds the boutique catalog, demo users and inventory, and generates the
 * SVG product artwork used by the storefront. Runs automatically on first
 * boot; `node server/seed.js --force` wipes data and reseeds.
 */
const store = require('./store');
const { makeProductSvg, makeCategorySvg } = require('./artwork');
// Service modules are loaded inside seed() AFTER any wipe, so their in-memory
// databases always match what is on disk (a --force reseed must not reuse
// state loaded before the wipe). In the server-boot path (no force) these
// resolve to the same module instances the gateway is already using.
let authService, catalog, inventory, orders;

const CATEGORIES = [
  { key: 'audio', name: 'Audio & Sound', description: 'Headphones, speakers and listening objects' },
  { key: 'workspace', name: 'Workspace', description: 'Desks, tools and paper goods for deep work' },
  { key: 'home', name: 'Home & Living', description: 'Ceramics, textiles and light' },
  { key: 'carry', name: 'Everyday Carry', description: 'Bags, leather goods and hydration' },
  { key: 'fitness', name: 'Fitness & Wellness', description: 'Mats, weights and recovery' },
];

const BRANDS = [
  { name: 'Auriga', description: 'Sound instruments, tuned by hand' },
  { name: 'Kanto Works', description: 'Workspace tools built to outlast trends' },
  { name: 'Nordvik', description: 'Quiet objects for calm interiors' },
  { name: 'Ferro & Co.', description: 'Canvas and leather, carried daily' },
  { name: 'Lumina', description: 'Light, considered' },
];

// variant: [size, color, adjustment]
const PRODUCTS = [
  { cat: 'audio', brand: 'Auriga', name: 'Halo Over-Ear Headphones', price: 23999, baseSku: 'AUR-HALO',
    rating: 4.7, ratingCount: 342,
    description: 'Closed-back over-ear headphones with a warm, roomy signature. Memory-foam earcups wrapped in soft lambskin, a machined aluminium yoke, and a 40-hour battery.',
    variants: [[null, 'Graphite', 0], [null, 'Ivory', 0], [null, 'Terracotta', 1000]] },
  { cat: 'audio', brand: 'Auriga', name: 'Pebble Bluetooth Speaker', price: 10499, baseSku: 'AUR-PEBL',
    rating: 4.5, ratingCount: 289,
    description: 'A palm-sized speaker with a full, unhurried voice. Woven fabric grille, a passive bass radiator, and a braided lanyard for the kitchen counter or the campsite.',
    variants: [[null, 'Charcoal', 0], [null, 'Sand', 0], [null, 'Moss', 700]] },
  { cat: 'audio', brand: 'Auriga', name: 'Cadence Wireless Earbuds', price: 14499, baseSku: 'AUR-CADN',
    rating: 4.4, ratingCount: 167,
    description: 'Featherweight earbuds with adaptive transparency and a sculpted charging pebble. Tuned for long sessions, not spec sheets.',
    variants: [[null, 'Ink', 0], [null, 'Bone', 0]] },
  { cat: 'audio', brand: 'Auriga', name: 'Slate Turntable', price: 36999, baseSku: 'AUR-TURN',
    rating: 4.8, ratingCount: 96,
    description: 'A belt-drive turntable in oiled walnut with a machined platter and a pre-fitted cartridge. It sounds like the room it sits in.',
    variants: [[null, 'Walnut', 0], [null, 'Black', 1300]] },
  { cat: 'audio', brand: 'Auriga', name: 'Bower Desk Monitors (Pair)', price: 26999, baseSku: 'AUR-MON',
    rating: 4.6, ratingCount: 128,
    description: 'A pair of near-field monitors with a soft dome tweeter and a rear port that forgives bad rooms. Sold as a pair, naturally.',
    variants: [[null, 'Charcoal', 0], [null, 'Cream', 900]] },

  { cat: 'workspace', brand: 'Kanto Works', name: 'Slate Mechanical Keyboard', price: 15499, baseSku: 'KAN-SLAT',
    rating: 4.6, ratingCount: 231,
    description: 'A gasket-mounted mechanical keyboard with a reassuringly low ping. PBT keycaps, hot-swap sockets and a rotary volume wheel.',
    variants: [['65%', 'Graphite', 0], ['Full', 'Graphite', 2500], ['65%', 'Bone', 900]] },
  { cat: 'workspace', brand: 'Kanto Works', name: 'Alder Desk Lamp', price: 7799, baseSku: 'KAN-ALDR',
    rating: 4.3, ratingCount: 154,
    description: 'A warm, dimmable task lamp with a solid alder arm and a friction hinge that stays exactly where you leave it.',
    variants: [[null, 'Black', 0], [null, 'Cream', 400]] },
  { cat: 'workspace', brand: 'Kanto Works', name: 'Field Notebook Set', price: 1999, baseSku: 'KAN-FLDN',
    rating: 4.5, ratingCount: 402,
    description: 'Three slim notebooks with 100gsm cream paper that refuses to feather. Stitched spines, soft covers, pocket-sized.',
    variants: [['A5', null, 0], ['A6', null, -400]] },
  { cat: 'workspace', brand: 'Kanto Works', name: 'Meridian Desk Organizer', price: 4799, baseSku: 'KAN-MRDO',
    rating: 4.4, ratingCount: 98,
    description: 'A low tray in oiled walnut with a felt-lined base and a hidden channel for cables. Everything within reach; nothing on display.',
    variants: [[null, 'Walnut', 0], [null, 'Slate', 0]] },
  { cat: 'workspace', brand: 'Kanto Works', name: 'Nib Fountain Pen', price: 5599, baseSku: 'KAN-PEN',
    rating: 4.7, ratingCount: 187,
    description: 'A brass-bodied fountain pen with a steel medium nib that starts every time. Posts securely, weighs almost nothing, ages beautifully.',
    variants: [[null, 'Brass', 0], [null, 'Ink', 700]] },
  { cat: 'workspace', brand: 'Kanto Works', name: 'Meridian Desk Pad', price: 3599, baseSku: 'KAN-PAD',
    rating: 4.2, ratingCount: 76,
    description: 'Full-grain leather over a thin felt core — firm enough to write on, soft enough to keep. Edges painted, never stitched.',
    variants: [['Compact', null, 0], ['Full', null, 1000]] },
  { cat: 'workspace', brand: 'Kanto Works', name: 'Ash Monitor Riser', price: 6699, baseSku: 'KAN-RISE',
    rating: 4.5, ratingCount: 88,
    description: 'A solid ash plinth that lifts your screen to eye level and swallows a keyboard underneath. Cable slot at the back, no tools to assemble.',
    variants: [[null, 'Ash', 0], [null, 'Walnut', 800]] },

  { cat: 'home', brand: 'Nordvik', name: 'Ember Ceramic Mug', price: 2599, baseSku: 'NOR-EMBR',
    rating: 4.6, ratingCount: 344,
    description: 'Hand-thrown stoneware with a reactive glaze, so no two are alike. Holds 350ml and keeps coffee hot noticeably longer.',
    variants: [[null, 'Clay', 0], [null, 'Fog', 0], [null, 'Charcoal', 300]] },
  { cat: 'home', brand: 'Nordvik', name: 'Dune Linen Throw', price: 9599, baseSku: 'NOR-DUNE',
    rating: 4.7, ratingCount: 156,
    description: 'Stonewashed European flax with a loose, breathable weave. Gets softer every wash; frays a little, on purpose.',
    variants: [[null, 'Oat', 0], [null, 'Rust', 0]] },
  { cat: 'home', brand: 'Lumina', name: 'Lumen Table Lamp', price: 11799, baseSku: 'LUM-LUMN',
    rating: 4.5, ratingCount: 203,
    description: 'A mushroom-domed table lamp with a satin diffuser and a tap dimmer. Glows like late afternoon, not like an office.',
    variants: [[null, 'Brass', 1300], [null, 'Matte Black', 0]] },
  { cat: 'home', brand: 'Nordvik', name: 'Terra Incense Set', price: 2999, baseSku: 'NOR-TERR',
    rating: 4.4, ratingCount: 267,
    description: 'Three scents — cedar, hinoki, vetiver — pressed into slow-burning sticks. One burns clean for about 45 minutes.',
    variants: [['Cedar', null, 0], ['Hinoki', null, 0], ['Vetiver', null, 100]] },
  { cat: 'home', brand: 'Lumina', name: 'Hearth Candle', price: 2899, baseSku: 'LUM-CAND',
    rating: 4.6, ratingCount: 178,
    description: 'Coconut-soy wax in a reusable glass jar, poured by hand in small batches. Sixty hours of unhurried light.',
    variants: [['Ember', null, 0], ['Fig', null, 0], ['Smoke', null, 100]] },
  { cat: 'home', brand: 'Nordvik', name: 'Cascade Carafe Set', price: 5999, baseSku: 'LUM-CARA',
    rating: 4.3, ratingCount: 94,
    description: 'A hand-blown carafe with two tumblers that stack as a stopper. Water on the table, always.',
    variants: [[null, 'Clear', 0], [null, 'Smoke', 500]] },

  { cat: 'carry', brand: 'Ferro & Co.', name: 'Voyager Canvas Backpack', price: 13499, baseSku: 'FER-VOYA',
    rating: 4.7, ratingCount: 312,
    description: '20 litres of waxed canvas with a padded 16" laptop sleeve, magnetic buckles that open one-handed, and a base that shrugs off rain.',
    variants: [[null, 'Olive', 0], [null, 'Navy', 0], [null, 'Black', 0]] },
  { cat: 'carry', brand: 'Ferro & Co.', name: 'Cardinal Leather Wallet', price: 6199, baseSku: 'FER-CARD',
    rating: 4.6, ratingCount: 245,
    description: 'Six cards, folded notes, nothing more. Vegetable-tanned leather that darkens with use and sits flat in a back pocket.',
    variants: [[null, 'Tan', 0], [null, 'Espresso', 0]] },
  { cat: 'carry', brand: 'Tessa', name: 'Atlas Insulated Bottle', price: 3399, baseSku: 'TES-ATLS',
    rating: 4.5, ratingCount: 421,
    description: 'Double-walled steel that keeps cold 24h and hot 12h. A ceramic-coated interior so water never tastes like metal.',
    variants: [['500ml', 'Steel', 0], ['750ml', 'Steel', 500]] },
  { cat: 'carry', brand: 'Ferro & Co.', name: 'Meridian Weekender', price: 19999, baseSku: 'FER-WEEK',
    rating: 4.8, ratingCount: 134,
    description: 'A two-night bag in waxed canvas with bridle leather handles and a base that stands up on its own. Cabin-friendly, decades-friendly.',
    variants: [[null, 'Olive', 0], [null, 'Chocolate', 0], [null, 'Black', 0]] },
  { cat: 'carry', brand: 'Ferro & Co.', name: 'Transit Passport Sleeve', price: 3899, baseSku: 'FER-PASS',
    rating: 4.4, ratingCount: 167,
    description: 'Holds a passport, two cards and a boarding pass. Slim enough to forget it is there until you need it.',
    variants: [[null, 'Tan', 0], [null, 'Navy', 0]] },
  { cat: 'carry', brand: 'Tessa', name: 'Loop Key Organizer', price: 2799, baseSku: 'TES-KEY',
    rating: 4.2, ratingCount: 143,
    description: 'A folded steel loop that keeps keys flat, quiet and ordered. Takes exactly four keys, which is a feature.',
    variants: [[null, 'Steel', 0], [null, 'Brass', 400]] },

  { cat: 'fitness', brand: 'Kanto Works', name: 'Balance Yoga Mat', price: 7199, baseSku: 'KAN-BALN',
    rating: 4.6, ratingCount: 238,
    description: 'A 5mm natural-rubber mat with a suede top that grips harder as your hands get warmer. No PVC, no smell, no slipping.',
    variants: [[null, 'Sage', 0], [null, 'Dusk', 0]] },
  { cat: 'fitness', brand: 'Lumina', name: 'Tempo Adjustable Dumbbell', price: 18999, baseSku: 'LUM-TMPO',
    rating: 4.7, ratingCount: 176,
    description: 'One dumbbell, fifteen weights: twist the handle and the plates lock in with a click you can trust. Sold as a single.',
    variants: [['10kg', null, 0], ['20kg', null, 6000]] },
  { cat: 'fitness', brand: 'Lumina', name: 'Pulse Weighted Rope', price: 2399, baseSku: 'LUM-ROPE',
    rating: 4.3, ratingCount: 209,
    description: 'A weighted steel-core rope with knurled handles that spin on sealed bearings. The cheapest cardio you will ever keep up.',
    variants: [['9ft', null, 0], ['10ft', null, 200]] },
  { cat: 'fitness', brand: 'Kanto Works', name: 'Core Foam Roller', price: 4399, baseSku: 'LUM-ROLL',
    rating: 4.4, ratingCount: 117,
    description: 'A high-density roller with a gentle Peak pattern — enough pressure to matter, not so much you stop using it.',
    variants: [['45cm', null, 0], ['60cm', null, 800]] },
];

function svgFilename(baseSku) { return `${baseSku.toLowerCase()}.svg`; }

/** Real photo when one has been sourced into public/img/products/<sku>.jpg,
 *  otherwise the generated SVG illustration. */
function imageFilename(baseSku) {
  const fs = require('fs');
  const jpg = require('path').join(__dirname, '..', 'public', 'img', 'products', `${baseSku.toLowerCase()}.jpg`);
  return fs.existsSync(jpg) ? `${baseSku.toLowerCase()}.jpg` : svgFilename(baseSku);
}

async function seed({ force = false } = {}) {
  if (force) {
    ['auth_db', 'product_db', 'inventory_db', 'order_db', 'gateway_db'].forEach(name => store.reset(name));
    // drop cached service/store modules so they reload from the wiped files
    for (const id of Object.keys(require.cache)) {
      if (/[\\/]server[\\/](store|eventbus)\.js$/.test(id) || /[\\/]services[\\/]\w+Service\.js$/.test(id)) {
        delete require.cache[id];
      }
    }
    console.log('[seed] wiped all data stores');
  }

  authService = require('./services/authService');
  catalog = require('./services/catalogService');
  inventory = require('./services/inventoryService');
  orders = require('./services/orderService');

  // wire saga listeners before seeding so PRODUCT_CREATED auto-creates inventory
  inventory.initListeners();
  orders.initListeners();

  if (authService.countUsers() > 0) {
    console.log('[seed] data already present — skipping (use --force to reseed)');
    return false;
  }

  console.log('[seed] creating users…');
  authService._createSeedUser({
    id: 'u-admin-0001', username: 'admin', email: 'admin@meridian.dev',
    fullName: 'Meridian Admin', role: 'ADMIN', password: 'Admin@123!',
  });
  authService._createSeedUser({
    id: 'u-demo-0001', username: 'demo', email: 'demo@meridian.dev',
    fullName: 'Demo Customer', role: 'USER', password: 'Customer@123!',
  });

  console.log('[seed] creating categories & brands…');
  const catIds = {};
  const fs = require('fs');
  const catDir = require('path').join(__dirname, '..', 'public', 'img', 'categories');
  for (const c of CATEGORIES) {
    const created = catalog.createCategory({ name: c.name, description: c.description });
    catIds[c.key] = created.id;
    fs.writeFileSync(require('path').join(catDir, `${c.key}.svg`), makeCategorySvg(c.name));
  }
  const brandIds = {};
  for (const b of BRANDS) {
    brandIds[b.name] = catalog.createBrand({ name: b.name, description: b.description }).id;
  }

  console.log('[seed] creating products (inventory auto-created via product-events)…');
  const publicDir = require('path').join(__dirname, '..', 'public', 'img', 'products');
  for (const p of PRODUCTS) {
    const created = catalog.createProduct({
      name: p.name,
      description: p.description,
      baseSku: p.baseSku,
      price: p.price,
      imageUrl: `/img/products/${imageFilename(p.baseSku)}`,
      categoryId: catIds[p.cat],
      brandId: brandIds[p.brand],
      rating: p.rating,
      ratingCount: p.ratingCount,
      variants: p.variants.map(([size, color, adj]) => ({
        size: size || null, color: color || null, priceAdjustment: adj,
      })),
    });
    fs.writeFileSync(require('path').join(publicDir, svgFilename(p.baseSku)),
      makeProductSvg(p.name, p.baseSku, p.cat));
  }

  // let queued product-events drain so inventory records exist
  await new Promise(r => setTimeout(r, 80));

  console.log('[seed] shaping stock levels…');
  // low stock on a few SKUs, one sold out (so a FAILED saga can be demoed)
  inventory.updateStock('AUR-HALO-STD-IVORY', { operation: 'SET', quantity: 3, reference: 'seed-low' });
  inventory.updateStock('NOR-DUNE-STD-RUST', { operation: 'SET', quantity: 2, reference: 'seed-low' });
  inventory.updateStock('FER-CARD-STD-ESPRESSO', { operation: 'SET', quantity: 4, reference: 'seed-low' });
  inventory.updateStock('LUM-TMPO-20KG-DEF', { operation: 'SET', quantity: 0, reference: 'seed-soldout' });
  inventory.updateStock('TES-ATLS-750ML-STEEL', { operation: 'SET', quantity: 60, reference: 'seed-high' });
  inventory.updateStock('KAN-FLDN-A5-DEF', { operation: 'SET', quantity: 80, reference: 'seed-high' });
  inventory.updateStock('AUR-MON-STD-CREAM', { operation: 'SET', quantity: 3, reference: 'seed-low' });
  inventory.updateStock('FER-WEEK-STD-CHOCOLATE', { operation: 'SET', quantity: 2, reference: 'seed-low' });
  inventory.updateStock('KAN-PEN-STD-BRASS', { operation: 'SET', quantity: 60, reference: 'seed-high' });
  inventory.updateStock('LUM-CAND-EMBER-DEF', { operation: 'SET', quantity: 70, reference: 'seed-high' });

  console.log('[seed] inserting a delivered demo order…');
  const halo = catalog.listProducts({ search: 'Halo' }).content[0];
  const ivory = halo.variants.find(v => v.variantSku === 'AUR-HALO-STD-IVORY') || halo.variants[0];
  const t0 = new Date(Date.now() - 6 * 86400000).toISOString();
  orders._insertSeed([{
    id: 'o-seed-0001', orderNumber: 'ORD-SEED0001-DEMO', userId: 'u-demo-0001',
    status: 'DELIVERED', totalAmount: ivory.finalPrice * 1, currency: 'INR',
    shippingAddressLine1: '18 Harbor Lane', shippingAddressLine2: null,
    shippingCity: 'Portland', shippingState: 'OR', shippingZipCode: '97201',
    shippingCountry: 'US', notes: null, cancelledReason: null,
    items: [{
      id: 'oi-seed-0001', sku: ivory.variantSku, productId: halo.id, variantId: ivory.id,
      productName: halo.name, variantName: 'Ivory', quantity: 1, unitPrice: ivory.finalPrice,
    }],
    sagaEvents: [
      { type: 'ORDER_CREATED', detail: 'Order placed with 1 item(s)', at: t0 },
      { type: 'STOCK_RESERVED', detail: 'Stock reserved across inventory service', at: t0 },
      { type: 'ORDER_CONFIRMED', detail: 'Payment captured; order confirmed', at: t0 },
      { type: 'ORDER_PROCESSING', detail: 'Warehouse is preparing the shipment', at: t0 },
      { type: 'ORDER_SHIPPED', detail: 'Handed to carrier', at: t0 },
      { type: 'ORDER_DELIVERED', detail: 'Delivered to customer', at: t0 },
    ],
    createdAt: t0, updatedAt: t0,
  }]);

  console.log(`[seed] done: ${authService.countUsers()} users, ${catalog.countProducts()} products, ${inventory.countInventory()} inventory records, ${orders.countOrders()} orders`);
  return true;
}

if (require.main === module) {
  seed({ force: process.argv.includes('--force') })
    // store writes are debounced; give them a moment to flush before exit
    .then(async () => { await new Promise(r => setTimeout(r, 500)); process.exit(0); })
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { seed };
