'use strict';
/**
 * Catalog service — mirrors microservices-ecommerce/product-service.
 *
 * Owns `product_db` (categories, brands, products + variants) and publishes
 * PRODUCT_/VARIANT_ events to the `product-events` topic, which the inventory
 * service consumes to auto-create stock records — same as the original.
 */
const crypto = require('crypto');
const store = require('../store');
const { publish } = require('../eventbus');

const db = store.load('product_db', { categories: [], brands: [], products: [] });

function persist() { store.save('product_db', db); }

function apiError(code, message, status) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

/* ── Categories ──────────────────────────────────────────────── */

function toCategoryResponse(c) {
  return {
    id: c.id, name: c.name, description: c.description || null,
    imageUrl: c.imageUrl || null, isActive: c.isActive !== false,
    parentId: c.parentId || null, createdAt: c.createdAt, updatedAt: c.updatedAt,
  };
}

function listCategories() {
  return db.categories.filter(c => c.isActive !== false).map(toCategoryResponse);
}

function createCategory({ name, description, imageUrl, parentId }) {
  if (!name || !String(name).trim()) throw apiError('400', 'Category name is required', 400);
  if (db.categories.some(c => c.name.toLowerCase() === String(name).trim().toLowerCase())) {
    throw apiError('CONFLICT', 'Category already exists', 409);
  }
  const now = new Date().toISOString();
  const category = {
    id: crypto.randomUUID(), name: String(name).trim(),
    description: description || null, imageUrl: imageUrl || null,
    parentId: parentId || null, isActive: true, createdAt: now, updatedAt: now,
  };
  db.categories.push(category);
  persist();
  return toCategoryResponse(category);
}

/* ── Brands ──────────────────────────────────────────────────── */

function toBrandResponse(b) {
  return {
    id: b.id, name: b.name, description: b.description || null,
    logoUrl: b.logoUrl || null, websiteUrl: b.websiteUrl || null,
    isActive: b.isActive !== false, createdAt: b.createdAt, updatedAt: b.updatedAt,
  };
}

function listBrands() {
  return db.brands.filter(b => b.isActive !== false).map(toBrandResponse);
}

function createBrand({ name, description, logoUrl, websiteUrl }) {
  if (!name || !String(name).trim()) throw apiError('400', 'Brand name is required', 400);
  if (db.brands.some(b => b.name.toLowerCase() === String(name).trim().toLowerCase())) {
    throw apiError('CONFLICT', 'Brand already exists', 409);
  }
  const now = new Date().toISOString();
  const brand = {
    id: crypto.randomUUID(), name: String(name).trim(),
    description: description || null, logoUrl: logoUrl || null,
    websiteUrl: websiteUrl || null, isActive: true, createdAt: now, updatedAt: now,
  };
  db.brands.push(brand);
  persist();
  return toBrandResponse(brand);
}

/* ── Products ────────────────────────────────────────────────── */

function toVariantResponse(v) {
  return {
    id: v.id, productId: v.productId, variantSku: v.variantSku,
    size: v.size || null, color: v.color || null, material: v.material || null,
    priceAdjustment: v.priceAdjustment || 0, finalPrice: v.finalPrice,
    imageUrl: v.imageUrl || null, status: v.status || 'ACTIVE',
    createdAt: v.createdAt, updatedAt: v.updatedAt,
  };
}

function toProductResponse(p) {
  const brand = db.brands.find(b => b.id === p.brandId);
  const category = db.categories.find(c => c.id === p.categoryId);
  return {
    id: p.id, name: p.name, description: p.description || null,
    baseSku: p.baseSku, price: p.price,
    brand: brand ? brand.name : null,
    brandId: p.brandId || null,
    categoryName: category ? category.name : null,
    categoryId: p.categoryId || null,
    imageUrl: p.imageUrl || null,
    status: p.status || 'ACTIVE',
    rating: p.rating ?? null,
    ratingCount: p.ratingCount ?? null,
    variants: (p.variants || []).map(toVariantResponse),
    createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

/**
 * Paginated listing. Supports: pageNumber, pageSize, category, brand,
 * search (name/description), minPrice, maxPrice, sort
 * (price_asc | price_desc | name_asc | newest).
 */
function listProducts(query) {
  const pageNumber = Math.max(1, parseInt(query.pageNumber, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize, 10) || 12));

  let items = db.products.filter(p => p.status !== 'DELETED');

  if (query.category) {
    const cat = db.categories.find(c => c.name.toLowerCase() === String(query.category).toLowerCase());
    items = cat ? items.filter(p => p.categoryId === cat.id) : [];
  }
  if (query.brand) {
    const b = db.brands.find(x => x.name.toLowerCase() === String(query.brand).toLowerCase());
    items = b ? items.filter(p => p.brandId === b.id) : [];
  }
  if (query.search) {
    const q = String(query.search).toLowerCase();
    items = items.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      (p.baseSku || '').toLowerCase().includes(q));
  }
  const min = parseFloat(query.minPrice); const max = parseFloat(query.maxPrice);
  if (!Number.isNaN(min)) items = items.filter(p => p.price >= min);
  if (!Number.isNaN(max)) items = items.filter(p => p.price <= max);

  switch (query.sort) {
    case 'price_asc': items.sort((a, b) => a.price - b.price); break;
    case 'price_desc': items.sort((a, b) => b.price - a.price); break;
    case 'name_asc': items.sort((a, b) => a.name.localeCompare(b.name)); break;
    case 'newest': items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); break;
    default: break; // keep insertion order
  }

  const totalElements = items.length;
  const totalPages = Math.max(1, Math.ceil(totalElements / pageSize));
  const start = (pageNumber - 1) * pageSize;
  const content = items.slice(start, start + pageSize).map(toProductResponse);

  return { content, pageNumber, pageSize, totalElements, totalPages, last: pageNumber >= totalPages };
}

function getProduct(id) {
  const p = db.products.find(x => x.id === id && x.status !== 'DELETED');
  if (!p) throw apiError('PRODUCT_NOT_FOUND', `Product not found: ${id}`, 404);
  return toProductResponse(p);
}

function createProduct({ name, description, baseSku, price, imageUrl, categoryId, brandId, rating, ratingCount, variants }) {
  if (!name || !price) throw apiError('400', 'Product name and price are required', 400);
  const now = new Date().toISOString();
  const product = {
    id: crypto.randomUUID(),
    name: String(name).trim(),
    description: description || null,
    baseSku: baseSku || `SKU-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    price: Number(price),
    imageUrl: imageUrl || null,
    categoryId: categoryId || null,
    brandId: brandId || null,
    rating: rating ?? null,
    ratingCount: ratingCount ?? null,
    status: 'ACTIVE',
    variants: [],
    createdAt: now, updatedAt: now,
  };
  (variants || []).forEach(v => product.variants.push(makeVariant(product, v)));
  db.products.push(product);
  persist();
  publish('product-events', {
    eventType: 'PRODUCT_CREATED', productId: product.id, name: product.name,
    baseSku: product.baseSku, price: product.price,
    variants: product.variants.map(v => ({ variantId: v.id, sku: v.variantSku, finalPrice: v.finalPrice })),
    occurredAt: now,
  });
  return toProductResponse(product);
}

function makeVariant(product, v) {
  const now = new Date().toISOString();
  const adjustment = Number(v.priceAdjustment || 0);
  return {
    id: crypto.randomUUID(),
    productId: product.id,
    variantSku: v.variantSku || `${product.baseSku}-${(v.size || 'STD').toString().toUpperCase()}-${(v.color || 'DEF').toString().toUpperCase()}`,
    size: v.size || null, color: v.color || null, material: v.material || null,
    priceAdjustment: adjustment,
    finalPrice: Math.round((Number(product.price) + adjustment) * 100) / 100,
    imageUrl: v.imageUrl || null,
    status: 'ACTIVE',
    createdAt: now, updatedAt: now,
  };
}

function createVariant(productId, body) {
  const p = db.products.find(x => x.id === productId && x.status !== 'DELETED');
  if (!p) throw apiError('PRODUCT_NOT_FOUND', `Product not found: ${productId}`, 404);
  const variant = makeVariant(p, body);
  p.variants.push(variant);
  p.updatedAt = new Date().toISOString();
  persist();
  publish('product-events', {
    eventType: 'VARIANT_CREATED', productId: p.id, variantId: variant.id,
    sku: variant.variantSku, finalPrice: variant.finalPrice,
    occurredAt: variant.createdAt,
  });
  return toVariantResponse(variant);
}

function deleteProduct(id) {
  const p = db.products.find(x => x.id === id && x.status !== 'DELETED');
  if (!p) throw apiError('PRODUCT_NOT_FOUND', `Product not found: ${id}`, 404);
  p.status = 'DELETED';
  p.updatedAt = new Date().toISOString();
  persist();
  publish('product-events', { eventType: 'PRODUCT_DELETED', productId: p.id, occurredAt: p.updatedAt });
  return { message: 'Product deleted' };
}

/** Internal helper for the order saga + inventory syncs. */
function findVariantBySku(sku) {
  for (const p of db.products) {
    const v = (p.variants || []).find(v => v.variantSku === sku);
    if (v) return { product: p, variant: v };
  }
  return null;
}

function countProducts() { return db.products.filter(p => p.status !== 'DELETED').length; }

/** Seeder only. */
function _insertSeed(entities) {
  db.categories.push(...entities.categories);
  db.brands.push(...entities.brands);
  db.products.push(...entities.products);
  persist();
}

module.exports = {
  listCategories, createCategory,
  listBrands, createBrand,
  listProducts, getProduct, createProduct, createVariant, deleteProduct,
  findVariantBySku, countProducts, _insertSeed,
};
