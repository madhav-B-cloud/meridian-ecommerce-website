'use strict';
/* MERIDIAN storefront — hash-routed SPA, no framework. */

(function () {
  const { api, session } = window;
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  const money = n => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtDate = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const fmtTime = iso => new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const IMG_FALLBACK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='1000'%3E%3Crect width='800' height='1000' fill='%23EFE7D6'/%3E%3Ccircle cx='400' cy='440' r='150' fill='none' stroke='%23B9AD97' stroke-width='10'/%3E%3C/svg%3E";

  const CATEGORY_KEYS = {
    'Audio & Sound': 'audio', 'Workspace': 'workspace', 'Home & Living': 'home',
    'Everyday Carry': 'carry', 'Fitness & Wellness': 'fitness',
  };
  const catImg = name => `/img/categories/${CATEGORY_KEYS[name] || 'home'}.svg`;

  /* ── toasts ── */
  function toast(message, kind = 'ok') {
    const el = document.createElement('div');
    el.className = 'toast' + (kind === 'err' ? ' toast--err' : kind === 'info' ? ' toast--info' : '');
    el.textContent = message;
    $('#toast-stack').appendChild(el);
    setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 450); }, 3400);
  }

  /* ── cart state ── */
  const cart = {
    read() { try { return JSON.parse(localStorage.getItem('m_cart') || '[]'); } catch { return []; } },
    write(items) { localStorage.setItem('m_cart', JSON.stringify(items)); updateCartBadge(); },
    add(item) {
      const items = this.read();
      const existing = items.find(i => i.sku === item.sku);
      if (existing) existing.qty = Math.min(99, existing.qty + item.qty);
      else items.push(item);
      this.write(items);
    },
    setQty(sku, qty) {
      let items = this.read();
      if (qty <= 0) items = items.filter(i => i.sku !== sku);
      else items = items.map(i => (i.sku === sku ? { ...i, qty } : i));
      this.write(items);
    },
    remove(sku) { this.write(this.read().filter(i => i.sku !== sku)); },
    clear() { this.write([]); },
    count() { return this.read().reduce((n, i) => n + i.qty, 0); },
    subtotal() { return this.read().reduce((n, i) => n + i.unitPrice * i.qty, 0); },
  };

  function updateCartBadge() {
    const n = cart.count();
    const badge = $('#cart-count');
    badge.hidden = n === 0;
    if (n > 0) { badge.textContent = n > 99 ? '99+' : n; }
  }

  /* ── header chrome ── */
  function renderChrome() {
    const user = session.user;
    $('#nav-admin').hidden = !session.isAdmin;
    $('#account-btn').setAttribute('href', session.isLoggedIn ? '#/account' : '#/login');
    document.body.dataset.auth = session.isLoggedIn ? 'in' : 'out';
    const tickerText = session.isLoggedIn && user
      ? `Signed in as ${user.fullName} <i>✳</i> `
      : '';
    $('#ticker-track').innerHTML = (
      `${tickerText}Complimentary shipping over ₹2,000 <i>✳</i> Stock reserved by an event saga before payment <i>✳</i> ` +
      `New — the Terra incense set <i>✳</i> Designed in Vancouver, made to last <i>✳</i> `
    ).repeat(2);
  }

  /* ═══════════════════ VIEWS ═══════════════════ */

  function productCard(p, flags = {}) {
    const img = p.imageUrl || IMG_FALLBACK;
    return `
      <a class="p-card reveal" href="#/product/${p.id}">
        <div class="p-card__media">
          ${flags.soldOut ? '<span class="p-card__flag p-card__flag--out">Sold out</span>'
            : flags.low ? '<span class="p-card__flag p-card__flag--low">Low stock</span>' : ''}
          <img src="${esc(img)}" alt="${esc(p.name)}" loading="lazy" onerror="this.src='${IMG_FALLBACK}'"/>
          <span class="p-card__view">View object</span>
        </div>
        <span class="p-card__brand">${esc(p.brand || 'Meridian')}</span>
        <span class="p-card__name">${esc(p.name)}</span>
        <span class="p-card__price">${money(p.price)}</span>
      </a>`;
  }

  const skeletonGrid = (n = 8) => `<div class="product-grid">${'<div class="skel"></div>'.repeat(n)}</div>`;

  /* ── home ── */
  async function viewHome(main) {
    main.innerHTML = `
      <section class="hero">
        <div class="hero__ring"></div>
        <div class="hero__inner">
          <div>
            <span class="eyebrow eyebrow--accent reveal">Est. 2026 — a small shop for considered objects</span>
            <h1 class="reveal d1">Objects with<br/>a <em>point of view.</em></h1>
            <p class="hero__sub reveal d2">Sound, light, paper and leather — a short catalog of things made slowly and sold honestly. Every order reserves real stock before your payment is captured.</p>
            <div class="hero__cta reveal d3">
              <a class="btn" href="#/shop">Shop the collection</a>
              <a class="link-underline" href="#/saga">How our orders work</a>
            </div>
          </div>
          <figure class="hero__art reveal d2">
            <img src="/img/products/aur-halo.jpg" alt="Halo over-ear headphones" onerror="this.onerror=null;this.src='/img/products/aur-halo.svg'"/>
            <figcaption><i>№ 01</i> — Halo Over-Ear</figcaption>
          </figure>
        </div>
      </section>
      <div class="marquee"><div class="marquee__track" id="brand-marquee"></div></div>
      <section class="cats"><div class="wrap">
        <div class="sect-head">
          <h2><span class="eyebrow">Departments</span>Five rooms of <em>the house.</em></h2>
          <a class="link-underline" href="#/shop">Browse everything</a>
        </div>
        <div class="cats__grid" id="cats-grid">${'<div class="skel" style="aspect-ratio:4/4.6"></div>'.repeat(5)}</div>
      </div></section>
      <section class="products" style="padding-top:20px"><div class="wrap">
        <div class="sect-head">
          <h2><span class="eyebrow">Featured objects</span>Chosen for <em>keeping.</em></h2>
          <a class="link-underline" href="#/shop?sort=newest">See all new</a>
        </div>
        <div id="featured-grid">${skeletonGrid(8)}</div>
      </div></section>
      <section class="saga-band"><div class="wrap saga-band__grid">
        <div>
          <span class="eyebrow eyebrow--light">Under the hood</span>
          <h2>Your order is a <em>saga</em>, not a leap of faith.</h2>
          <p>When you check out, the order service publishes an <b>ORDER_CREATED</b> event. The inventory service hears it and physically reserves your items; only when stock is safely held does the storefront invite you to pay.</p>
          <p>If anything fails along the way, the order fails loudly instead of quietly overselling. No phantom purchases. No vanishing stock.</p>
          <p style="margin-top:26px"><a class="link-underline" style="color:var(--cream-on-dark);border-color:var(--cream-on-dark)" href="#/saga">Read the full story</a></p>
        </div>
        <div class="saga-steps">
          <div class="saga-step"><b>1 · Order placed</b><span>Order service persists a PENDING order and emits the event.</span></div>
          <div class="saga-step"><b>2 · Stock reserved</b><span>Inventory service holds each SKU — or fails the order.</span> <i>order-events → inventory-events</i></div>
          <div class="saga-step"><b>3 · Payment captured</b><span>Only with stock in hand is the order confirmed.</span></div>
          <div class="saga-step"><b>4 · Packed, shipped, delivered</b><span>Admin advances the lifecycle; every step is audited.</span></div>
        </div>
      </div></section>`;

    // brands marquee
    try {
      const brands = await api.brands();
      const items = brands.map(b => `<span>${esc(b.name)}</span> <i>✳</i>`).join(' ');
      $('#brand-marquee').innerHTML = items + ' ' + items;
    } catch { $('#brand-marquee').innerHTML = '<span>Auriga</span> <i>✳</i> <span>Kanto Works</span> <i>✳</i> <span>Nordvik</span> <i>✳</i> <span>Ferro &amp; Co.</span> <i>✳</i> <span>Lumina</span> <i>✳</i>'; }

    // categories
    try {
      const cats = await api.categories();
      $('#cats-grid').innerHTML = cats.map((c, i) => `
        <a class="cat-tile reveal" style="animation-delay:${i * 0.07}s" href="#/shop?category=${encodeURIComponent(c.name)}">
          <img src="${catImg(c.name)}" alt="${esc(c.name)}" loading="lazy"/>
          <span class="cat-tile__label"><span>0${i + 1}</span><b>${esc(c.name)}</b></span>
        </a>`).join('');
    } catch { $('#cats-grid').innerHTML = '<p>Could not load categories.</p>'; }

    // featured products (with live stock flags when signed in)
    try {
      const page = await api.products({ pageNumber: 1, pageSize: 8 });
      $('#featured-grid').innerHTML = `<div class="product-grid">${page.content.map(p => productCard(p)).join('')}</div>`;
    } catch (e) {
      $('#featured-grid').innerHTML = `<div class="empty-state"><h3>Shop unreachable</h3><p>${esc(e.message)}</p></div>`;
    }
  }

  /* ── shop ── */
  async function viewShop(main, query) {
    const state = {
      q: query.get('q') || '',
      category: query.get('category') || '',
      brand: query.get('brand') || '',
      min: query.get('min') || '',
      max: query.get('max') || '',
      sort: query.get('sort') || '',
      page: parseInt(query.get('page') || '1', 10),
    };

    main.innerHTML = `
      <div class="shop"><div class="wrap">
        <div class="shop__head">
          <span class="eyebrow eyebrow--accent">The collection</span>
          <h1>${state.category ? esc(state.category) : 'All <em>objects.</em>'}</h1>
        </div>
        <div class="shop__body">
          <aside class="filters" id="filters">
            <div class="filter-group"><h4>Category</h4><div id="f-cats"><label class="filter-opt"><input type="radio" name="f-cat" value="" ${!state.category ? 'checked' : ''}/><span>All</span></label></div></div>
            <div class="filter-group"><h4>Brand</h4><div id="f-brands"></div></div>
            <div class="filter-group"><h4>Price</h4>
              <div class="price-inputs"><input id="f-min" type="number" min="0" placeholder="Min" value="${esc(state.min)}"/><span>—</span><input id="f-max" type="number" min="0" placeholder="Max" value="${esc(state.max)}"/></div>
              <button class="btn--quiet btn" id="f-price-apply" style="margin-top:10px">Apply price</button>
            </div>
            <div class="filter-group"><button class="btn--quiet btn" id="f-clear">Clear all filters</button></div>
          </aside>
          <div>
            <div class="shop__toolbar">
              <div class="search-box">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/></svg>
                <input id="shop-q" placeholder="Search objects…" value="${esc(state.q)}"/>
              </div>
              <select class="select" id="shop-sort">
                <option value="">Sort — featured</option>
                <option value="newest" ${state.sort === 'newest' ? 'selected' : ''}>Newest</option>
                <option value="price_asc" ${state.sort === 'price_asc' ? 'selected' : ''}>Price ↑</option>
                <option value="price_desc" ${state.sort === 'price_desc' ? 'selected' : ''}>Price ↓</option>
                <option value="name_asc" ${state.sort === 'name_asc' ? 'selected' : ''}>A–Z</option>
              </select>
              <span class="shop__meta" id="shop-meta"></span>
            </div>
            <div id="shop-grid">${skeletonGrid(9)}</div>
            <div class="pager" id="pager" hidden>
              <button class="btn--quiet btn" id="pg-prev">← Prev</button>
              <span class="pager__info" id="pg-info"></span>
              <button class="btn--quiet btn" id="pg-next">Next →</button>
            </div>
          </div>
        </div>
      </div></div>`;

    const navigate = patch => {
      const next = { ...state, ...patch };
      const qs = new URLSearchParams();
      Object.entries(next).forEach(([k, v]) => { if (v !== '' && v != null) qs.set(k, v); });
      location.hash = '#/shop' + (qs.toString() ? '?' + qs.toString() : '');
    };

    // filters
    try {
      const [cats, brands] = await Promise.all([api.categories(), api.brands()]);
      $('#f-cats').insertAdjacentHTML('beforeend', cats.map(c =>
        `<label class="filter-opt"><input type="radio" name="f-cat" value="${esc(c.name)}" ${state.category === c.name ? 'checked' : ''}/><span>${esc(c.name)}</span></label>`).join(''));
      $('#f-brands').innerHTML = brands.map(b =>
        `<label class="filter-opt"><input type="radio" name="f-brand" value="${esc(b.name)}" ${state.brand === b.name ? 'checked' : ''}/><span>${esc(b.name)}</span></label>`).join('');
    } catch { /* filters optional */ }

    $('#f-cats').addEventListener('change', e => navigate({ category: e.target.value, page: 1 }));
    $('#f-brands').addEventListener('change', e => navigate({ brand: e.target.value, page: 1 }));
    $('#f-price-apply').addEventListener('click', () => navigate({ min: $('#f-min').value, max: $('#f-max').value, page: 1 }));
    $('#f-clear').addEventListener('click', () => { location.hash = '#/shop'; });
    $('#shop-sort').addEventListener('change', e => navigate({ sort: e.target.value, page: 1 }));

    let searchTimer;
    $('#shop-q').addEventListener('input', e => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => navigate({ q: e.target.value.trim(), page: 1 }), 350);
    });

    // load products
    try {
      const page = await api.products({
        pageNumber: state.page, pageSize: 9,
        search: state.q, category: state.category, brand: state.brand,
        minPrice: state.min, maxPrice: state.max, sort: state.sort,
      });
      $('#shop-meta').textContent = `${page.totalElements} object${page.totalElements === 1 ? '' : 's'}`;
      $('#shop-grid').innerHTML = page.content.length
        ? `<div class="product-grid">${page.content.map(p => productCard(p)).join('')}</div>`
        : `<div class="empty-state"><h3>Nothing here (yet).</h3><p>No objects match those filters — loosen them up a little.</p><a class="btn btn--ghost" href="#/shop">Clear filters</a></div>`;

      $('#pager').hidden = page.totalPages <= 1;
      if (page.totalPages > 1) {
        $('#pg-info').textContent = `Page ${page.pageNumber} of ${page.totalPages}`;
        $('#pg-prev').disabled = page.pageNumber <= 1;
        $('#pg-next').disabled = page.last;
        $('#pg-prev').onclick = () => navigate({ page: page.pageNumber - 1 });
        $('#pg-next').onclick = () => navigate({ page: page.pageNumber + 1 });
      }
    } catch (e) {
      $('#shop-grid').innerHTML = `<div class="empty-state"><h3>Shop unreachable</h3><p>${esc(e.message)}</p></div>`;
    }
  }

  /* ── product detail ── */
  async function viewProduct(main, id) {
    main.innerHTML = '<div class="pd"><div class="wrap"><div class="pd__grid"><div><div class="skel" style="aspect-ratio:4/5"></div></div><div><div class="skel" style="height:60px;aspect-ratio:auto"></div><div class="skel" style="height:120px;aspect-ratio:auto;margin-top:14px"></div></div></div></div></div>';

    let p, stockMap = null;
    try {
      p = await api.product(id);
    } catch (e) {
      main.innerHTML = `<div class="pd"><div class="wrap"><div class="empty-state"><h3>Object not found</h3><p>${esc(e.message)}</p><a class="btn" href="#/shop">Back to the shop</a></div></div></div>`;
      return;
    }
    if (session.isLoggedIn) {
      try {
        const inv = await api.inventoryForProduct(id);
        stockMap = Object.fromEntries(inv.map(i => [i.sku, i]));
      } catch { stockMap = null; }
    }

    const variants = p.variants || [];
    const dims = { color: variants.some(v => v.color), size: variants.some(v => v.size) };
    const sel = { color: dims.color ? variants[0].color : null, size: dims.size ? variants[0].size : null };

    main.innerHTML = `
      <div class="pd"><div class="wrap">
        <nav class="crumbs"><a href="#/">Home</a><i>/</i><a href="#/shop">Shop</a>${p.categoryName ? `<i>/</i><a href="#/shop?category=${encodeURIComponent(p.categoryName)}">${esc(p.categoryName)}</a>` : ''}<i>/</i>${esc(p.name)}</nav>
        <div class="pd__grid">
          <figure class="pd__media reveal">
            <img id="pd-img" src="${esc(p.imageUrl || IMG_FALLBACK)}" alt="${esc(p.name)}" onerror="this.src='${IMG_FALLBACK}'"/>
            <figcaption><span>${esc(p.baseSku)}</span><span>Meridian archive № ${esc(p.baseSku.slice(-4))}</span></figcaption>
          </figure>
          <div class="pd__info reveal d1">
            <span class="p-card__brand">${esc(p.brand || 'Meridian')}${p.categoryName ? ` — ${esc(p.categoryName)}` : ''}</span>
            <h1>${esc(p.name)}</h1>
            <div class="pd__price" id="pd-price">${money(p.price)}</div>
            <p class="pd__desc">${esc(p.description || 'A considered object, made to last.')}</p>

            <div class="stock-line" id="pd-stock"><span class="stock-dot stock-dot--unknown"></span><span id="pd-stock-text">${session.isLoggedIn ? 'Checking availability…' : 'Sign in to see live stock'}</span></div>
            <hr class="pd__divider"/>

            ${dims.color ? `
            <div class="opt-group">
              <div class="opt-label"><span class="eyebrow">Color</span><span id="sel-color-label"></span></div>
              <div class="chip-row" id="opt-color">
                ${[...new Set(variants.map(v => v.color))].map(c => `<button class="chip" data-color="${esc(c)}">${esc(c)}</button>`).join('')}
              </div>
            </div>` : ''}
            ${dims.size ? `
            <div class="opt-group">
              <div class="opt-label"><span class="eyebrow">Size</span><span id="sel-size-label"></span></div>
              <div class="chip-row" id="opt-size">
                ${[...new Set(variants.map(v => v.size))].map(s => `<button class="chip" data-size="${esc(s)}">${esc(s)}</button>`).join('')}
              </div>
            </div>` : ''}

            <div class="opt-group">
              <div class="opt-label"><span class="eyebrow">Quantity</span></div>
              <div class="qty-row">
                <div class="qty">
                  <button id="qty-minus" aria-label="Decrease">−</button>
                  <b id="qty-val">1</b>
                  <button id="qty-plus" aria-label="Increase">+</button>
                </div>
                <button class="btn" id="add-to-cart" style="flex:1">Add to cart</button>
              </div>
            </div>

            <div class="pd__meta">
              <details><summary>Details &amp; materials</summary><p>${esc(p.description || '—')}</p></details>
              <details><summary>Shipping &amp; returns</summary><p>Ships in 2–4 business days from our Mumbai warehouse. Complimentary shipping on orders over ₹2,000. 30-day returns, no questions asked.</p></details>
              <details><summary>SKUs</summary><p class="pd__skus">${variants.map(v => esc(v.variantSku)).join(' · ')}</p></details>
            </div>
          </div>
        </div>
      </div></div>
      <div class="related" id="related" hidden><div class="wrap">
        <div class="sect-head"><h2><span class="eyebrow">Pairs well with</span>From the same <em>room.</em></h2></div>
        <div class="product-grid" id="related-grid"></div>
      </div></div>`;

    let qty = 1;
    const updateChipUI = () => {
      $$('#opt-color .chip').forEach(c => c.classList.toggle('is-active', c.dataset.color === sel.color));
      $$('#opt-size .chip').forEach(c => c.classList.toggle('is-active', c.dataset.size === sel.size));
      if ($('#sel-color-label')) $('#sel-color-label').textContent = sel.color || '';
      if ($('#sel-size-label')) $('#sel-size-label').textContent = sel.size || '';
    };
    if (dims.color) {
      updateChipUI();
      $('#opt-color').addEventListener('click', e => {
        const b = e.target.closest('.chip'); if (!b) return;
        sel.color = b.dataset.color; updateChipUI(); refreshSelection();
      });
    }
    if (dims.size) {
      if (!dims.color) updateChipUI();
      $('#opt-size').addEventListener('click', e => {
        const b = e.target.closest('.chip'); if (!b) return;
        sel.size = b.dataset.size; updateChipUI(); refreshSelection();
      });
    }

    function currentVariant() {
      return variants.find(v => (!dims.color || v.color === sel.color) && (!dims.size || v.size === sel.size));
    }

    function refreshSelection() {
      const v = currentVariant();
      if (!v) return;
      $('#pd-price').textContent = money(v.finalPrice);
      refreshStock(v);
    }

    function refreshStock(v) {
      const el = $('#pd-stock');
      if (!el) return;
      const info = stockMap && stockMap[v.variantSku];
      if (!session.isLoggedIn) {
        el.innerHTML = '<span class="stock-dot stock-dot--unknown"></span><span>Sign in to see live stock</span>';
      } else if (!info) {
        el.innerHTML = '<span class="stock-dot stock-dot--unknown"></span><span>Availability unknown</span>';
      } else if (info.availableStock <= 0) {
        el.innerHTML = '<span class="stock-dot stock-dot--out"></span><span>Out of stock — try another variant</span>';
      } else if (info.lowStock) {
        el.innerHTML = `<span class="stock-dot stock-dot--low"></span><span>Low stock — only ${info.availableStock} left</span>`;
      } else {
        el.innerHTML = `<span class="stock-dot stock-dot--ok"></span><span>In stock — ${info.availableStock} available</span>`;
      }
    }

    if (dims.color || dims.size) refreshSelection();
    else if (variants[0]) refreshStock(variants[0]);

    $('#qty-minus').addEventListener('click', () => { qty = Math.max(1, qty - 1); $('#qty-val').textContent = qty; });
    $('#qty-plus').addEventListener('click', () => { qty = Math.min(99, qty + 1); $('#qty-val').textContent = qty; });

    $('#add-to-cart').addEventListener('click', () => {
      const v = variants.length ? currentVariant() : null;
      if (variants.length && !v) { toast('Pick a variant first', 'err'); return; }
      if (stockMap && v && stockMap[v.variantSku] && stockMap[v.variantSku].availableStock < qty) {
        toast('Not enough stock for that quantity', 'err'); return;
      }
      cart.add({
        sku: v ? v.variantSku : p.baseSku,
        productId: p.id,
        variantId: v ? v.id : null,
        productName: p.name,
        variantName: v ? [v.color, v.size].filter(Boolean).join(' / ') : null,
        unitPrice: v ? v.finalPrice : p.price,
        qty,
        imageUrl: p.imageUrl || IMG_FALLBACK,
      });
      toast(`${p.name} added to your cart`);
    });

    // related
    if (p.categoryName) {
      try {
        const rel = await api.products({ category: p.categoryName, pageSize: 8 });
        const others = rel.content.filter(x => x.id !== p.id).slice(0, 4);
        if (others.length) {
          $('#related').hidden = false;
          $('#related-grid').innerHTML = others.map(x => productCard(x)).join('');
        }
      } catch { /* related is optional */ }
    }
  }

  /* ── cart ── */
  function viewCart(main) {
    const items = cart.read();
    if (!items.length) {
      main.innerHTML = `
        <div class="cart"><div class="wrap">
          <span class="eyebrow eyebrow--accent">Your cart</span>
          <h1>Nothing in it <em>yet.</em></h1>
          <div class="empty-state">
            <p>Your cart is a quiet room. Fill it with something good.</p>
            <a class="btn" href="#/shop">Browse the collection</a>
          </div>
        </div></div>`;
      return;
    }
    const subtotal = cart.subtotal();
    const FREE = 2000;
    main.innerHTML = `
      <div class="cart"><div class="wrap">
        <span class="eyebrow eyebrow--accent">Your cart</span>
        <h1>${items.length} line${items.length === 1 ? '' : 's'}, <em>chosen well.</em></h1>
        <div class="cart__grid">
          <div id="cart-lines">
            ${items.map(i => `
              <div class="cart-line" data-sku="${esc(i.sku)}">
                <img src="${esc(i.imageUrl)}" alt="" onerror="this.src='${IMG_FALLBACK}'"/>
                <div>
                  <div class="cart-line__name">${esc(i.productName)}</div>
                  ${i.variantName ? `<div class="cart-line__variant">${esc(i.variantName)} · ${esc(i.sku)}</div>` : `<div class="cart-line__variant">${esc(i.sku)}</div>`}
                  <div class="cart-line__price">${money(i.unitPrice)} each</div>
                </div>
                <div class="cart-line__right">
                  <div class="qty">
                    <button data-act="minus" aria-label="Decrease">−</button><b>${i.qty}</b><button data-act="plus" aria-label="Increase">+</button>
                  </div>
                  <button class="cart-line__remove" data-act="remove">Remove</button>
                </div>
              </div>`).join('')}
          </div>
          <aside class="summary">
            <h3>Summary</h3>
            <div class="summary-row"><span>Subtotal</span><b>${money(subtotal)}</b></div>
            <div class="summary-row"><span>Shipping</span><b>${subtotal >= FREE ? 'Free' : money(99)}</b></div>
            <div class="free-ship-bar"><i style="width:${Math.min(100, subtotal / FREE * 100)}%"></i></div>
            <div class="summary-row note" style="border:0;padding-top:2px">${subtotal >= FREE ? 'Complimentary shipping unlocked.' : `${money(FREE - subtotal)} away from free shipping.`}</div>
            <div class="summary-row summary-row--total"><span>Total</span><b>${money(subtotal + (subtotal >= FREE ? 0 : 9))}</b></div>
            <a class="btn btn--accent btn--wide" href="#/checkout" style="margin-top:18px">Reserve &amp; check out</a>
            <p class="note">Checking out reserves stock through the inventory saga before payment is captured.</p>
          </aside>
        </div>
      </div></div>`;

    $('#cart-lines').addEventListener('click', e => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const sku = btn.closest('.cart-line').dataset.sku;
      const item = cart.read().find(i => i.sku === sku);
      if (btn.dataset.act === 'plus') cart.setQty(sku, item.qty + 1);
      if (btn.dataset.act === 'minus') cart.setQty(sku, item.qty - 1);
      if (btn.dataset.act === 'remove') cart.remove(sku);
      viewCart(main);
    });
  }

  /* ── checkout ── */
  function viewCheckout(main) {
    if (!session.isLoggedIn) {
      location.hash = '#/login?next=' + encodeURIComponent('#/checkout');
      return;
    }
    const items = cart.read();
    if (!items.length) { location.hash = '#/cart'; return; }

    const subtotal = cart.subtotal();
    const shipping = subtotal >= 2000 ? 0 : 99;
    main.innerHTML = `
      <div class="checkout"><div class="wrap">
        <span class="eyebrow eyebrow--accent">Checkout</span>
        <h1>Reserve, then <em>pay.</em></h1>
        <div class="checkout__grid">
          <section>
            <h2>Shipping address</h2>
            <form id="checkout-form" class="form-grid" novalidate>
              <div class="field span-2"><label for="ad1">Address line 1</label><input id="ad1" required placeholder="18 Harbor Lane"/></div>
              <div class="field span-2"><label for="ad2">Address line 2 <i style="font-style:normal;opacity:.5">(optional)</i></label><input id="ad2" placeholder="Apt, suite"/></div>
              <div class="field"><label for="city">City</label><input id="city" required placeholder="Portland"/></div>
              <div class="field"><label for="state">State / province</label><input id="state" required placeholder="OR"/></div>
              <div class="field"><label for="zip">ZIP / postal code</label><input id="zip" required placeholder="97201"/></div>
              <div class="field"><label for="country">Country</label>
                <select id="country">
                  <option value="US" selected>United States</option><option value="CA">Canada</option>
                  <option value="GB">United Kingdom</option><option value="DE">Germany</option>
                  <option value="IN">India</option><option value="VN">Vietnam</option><option value="AU">Australia</option>
                </select></div>
              <div class="field span-2"><label for="notes">Notes for the packing team <i style="font-style:normal;opacity:.5">(optional)</i></label><textarea id="notes" rows="3" placeholder="Leave with the neighbor…"></textarea></div>
            </form>
          </section>
          <aside class="summary">
            <h3>Your order</h3>
            ${items.map(i => `
              <div class="mini-line">
                <img src="${esc(i.imageUrl)}" alt="" onerror="this.src='${IMG_FALLBACK}'"/>
                <div class="mini-line__n">${esc(i.productName)}<span>× ${i.qty}${i.variantName ? ` — ${esc(i.variantName)}` : ''}</span></div>
                <span class="mini-line__p">${money(i.unitPrice * i.qty)}</span>
              </div>`).join('')}
            <div class="summary-row" style="margin-top:14px"><span>Subtotal</span><b>${money(subtotal)}</b></div>
            <div class="summary-row"><span>Shipping</span><b>${shipping === 0 ? 'Free' : money(shipping)}</b></div>
            <div class="summary-row summary-row--total"><span>Total</span><b>${money(subtotal + shipping)}</b></div>
            <button class="btn btn--accent btn--wide" id="place-order" style="margin-top:18px">Place order — reserve stock</button>
            <p class="note">Placing the order publishes <b>ORDER_CREATED</b>. Inventory has ~1 second to reserve your items; you'll watch it happen live on the next screen.</p>
          </aside>
        </div>
      </div></div>`;

    $('#place-order').addEventListener('click', async () => {
      const req = {
        items: items.map(i => ({
          sku: i.sku, productId: i.productId, variantId: i.variantId,
          productName: i.productName, variantName: i.variantName,
          quantity: i.qty, unitPrice: i.unitPrice,
        })),
        shippingAddressLine1: $('#ad1').value.trim(),
        shippingAddressLine2: $('#ad2').value.trim() || undefined,
        shippingCity: $('#city').value.trim(),
        shippingState: $('#state').value.trim(),
        shippingZipCode: $('#zip').value.trim(),
        shippingCountry: $('#country').value,
        currency: 'INR',
        notes: $('#notes').value.trim() || undefined,
      };
      for (const f of [req.shippingAddressLine1, req.shippingCity, req.shippingState, req.shippingZipCode]) {
        if (!f) { toast('Please complete the shipping address', 'err'); return; }
      }
      const btn = $('#place-order');
      btn.disabled = true; btn.textContent = 'Reserving stock…';
      try {
        const order = await api.createOrder(req);
        cart.clear();
        location.hash = `#/pay/${order.id}`;
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Place order — reserve stock';
        toast(e.message, 'err');
      }
    });
  }

  /* ── order detail with live saga timeline ── */
  const SAGA_FLOW = ['ORDER_CREATED', 'STOCK_RESERVED', 'ORDER_CONFIRMED', 'ORDER_PROCESSING', 'ORDER_SHIPPED', 'ORDER_DELIVERED'];
  const SAGA_LABEL = {
    ORDER_CREATED: 'Order placed', STOCK_RESERVED: 'Stock reserved', ORDER_CONFIRMED: 'Payment captured',
    ORDER_PROCESSING: 'Processing', ORDER_SHIPPED: 'Shipped', ORDER_DELIVERED: 'Delivered',
    STOCK_RESERVATION_FAILED: 'Stock reservation failed', ORDER_CANCELLED: 'Cancelled',
  };
  const SAGA_PREVIEW = {
    STOCK_RESERVED: 'Waiting for the inventory service…',
    ORDER_CONFIRMED: 'Waiting for your payment',
    ORDER_PROCESSING: 'Next: packing at the Mumbai warehouse',
    ORDER_SHIPPED: 'Next: handed to the courier',
    ORDER_DELIVERED: 'Next: final-mile delivery',
  };
  const SAGA_TERMINAL = ['DELIVERED', 'CANCELLED', 'FAILED'];
  const SAGA_AUTO = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED'];

  async function viewOrder(main, id) {
    const mySeq = renderSeq; // stop polling if the user navigates elsewhere
    if (!session.isLoggedIn) { location.hash = '#/login?next=' + encodeURIComponent('#/order/' + id); return; }
    main.innerHTML = '<div class="cart"><div class="wrap"><div class="skel" style="aspect-ratio:auto;height:300px"></div></div></div>';
    let pollTimer = null;

    const render = async () => {
      let o;
      try { o = await api.order(id); }
      catch (e) {
        main.innerHTML = `<div class="cart"><div class="wrap"><div class="empty-state"><h3>Order not found</h3><p>${esc(e.message)}</p><a class="btn" href="#/orders">My orders</a></div></div></div>`;
        return false;
      }

      const doneTypes = new Set((o.sagaEvents || []).map(e => e.type));
      const failed = o.status === 'FAILED';
      const cancelled = o.status === 'CANCELLED';
      const flow = failed ? ['ORDER_CREATED', 'STOCK_RESERVATION_FAILED']
        : cancelled ? ['ORDER_CREATED', 'ORDER_CANCELLED'] : SAGA_FLOW;

      const timeline = flow.map(type => {
        const ev = (o.sagaEvents || []).filter(e => e.type === type).pop();
        const cls = failed && type === 'STOCK_RESERVATION_FAILED' ? 'is-fail'
          : cancelled && type === 'ORDER_CANCELLED' ? 'is-fail'
          : ev ? 'is-done' : 'is-ghost';
        const isLive = !ev && !failed && !cancelled && SAGA_FLOW.indexOf(type) === nextStepIndex(doneTypes);
        return `
          <div class="tl-item ${cls} ${isLive ? 'is-live' : ''}">
            <b>${SAGA_LABEL[type] || type}</b>
            ${ev ? `<span>${esc(ev.detail || '')}</span><time>${fmtTime(ev.at)}</time>` : `<span>${SAGA_PREVIEW[type] || ''}</span>`}
          </div>`;
      }).join('');

      const canPay = o.status === 'STOCK_RESERVED';
      const canCancel = ['PENDING', 'STOCK_RESERVED', 'CONFIRMED', 'PROCESSING'].includes(o.status);

      main.innerHTML = `
        <div class="cart"><div class="wrap">
          <span class="eyebrow eyebrow--accent">${o.status === 'PENDING' ? 'Placing your order' : failed ? 'Order failed' : cancelled ? 'Order cancelled' : 'Thank you'}</span>
          <h1>${failed ? 'We couldn\u2019t <em>reserve it.</em>' : cancelled ? 'Order <em>cancelled.</em>' : 'Your order is <em>in motion.</em>'}</h1>
          <div class="checkout__grid">
            <div class="saga-panel">
              <div class="saga-panel__head">
                <h3>Saga timeline</h3>
                <span class="live-dot ${SAGA_TERMINAL.includes(o.status) ? 'done' : ''}" id="live-dot">${SAGA_TERMINAL.includes(o.status) ? 'Settled' : 'Live'}</span>
              </div>
              <div class="timeline">${timeline}</div>
              ${failed ? `<div class="pay-note">The inventory service couldn't hold all the items, so the order was failed rather than oversold. Nothing was charged. <a href="#/shop" class="link-underline" style="margin-left:6px">Back to the shop</a></div>` : ''}
              ${canPay ? `<div class="pay-note">Stock is safely reserved. This is the moment of payment in the saga — <a class="link-underline" style="color:var(--accent)" href="#/pay/${esc(o.id)}">pay now to confirm</a></div>` : ''}
              ${cancelled && o.cancelledReason ? `<div class="pay-note">${esc(o.cancelledReason)}.</div>` : ''}
            </div>
            <aside>
              <div class="summary" style="position:static">
                <h3>${esc(o.orderNumber)}</h3>
                <div class="summary-row"><span>Status</span><span class="status-chip st-${esc(o.status)}">${esc(o.status.replace('_', ' '))}</span></div>
                <div class="summary-row"><span>Placed</span><b>${fmtDate(o.createdAt)}</b></div>
                ${o.items.map(i => `
                  <div class="mini-line">
                    <img src="${esc('/img/products/' + i.sku.toLowerCase().split('-').slice(0, 2).join('-') + '.jpg')}" alt="" onerror="this.onerror=null;this.src='${IMG_FALLBACK}'"/>
                    <div class="mini-line__n">${esc(i.productName)}<span>× ${i.quantity}${i.variantName ? ` — ${esc(i.variantName)}` : ''}</span></div>
                    <span class="mini-line__p">${money(i.unitPrice * i.quantity)}</span>
                  </div>`).join('')}
                <div class="summary-row summary-row--total"><span>Total</span><b>${money(o.totalAmount)}</b></div>
                <div class="summary-row"><span>Ship to</span><b style="text-align:right;max-width:60%;font-size:13px">${esc(o.shippingAddressLine1)}, ${esc(o.shippingCity)} ${esc(o.shippingState)} ${esc(o.shippingZipCode)}, ${esc(o.shippingCountry)}</b></div>
                <div class="order-card__actions" style="margin-top:20px">
                  ${canPay ? `<a class="btn btn--accent" href="#/pay/${esc(o.id)}">Pay now</a>` : ''}
                  ${canCancel ? '<button class="btn btn--danger" id="cancel-btn">Cancel order</button>' : ''}
                  <a class="btn btn--ghost" href="#/orders">My orders</a>
                  <a class="btn btn--ghost" href="#/shop">Keep shopping</a>
                </div>
              </div>
            </aside>
          </div>
        </div></div>`;

      $('#cancel-btn')?.addEventListener('click', async () => {
        try {
          await api.cancelOrder(o.id, 'Cancelled from the storefront');
          toast('Order cancelled — stock will be released', 'info');
          render();
        } catch (e) { toast(e.message, 'err'); }
      });

      // keep polling while the saga is in flight or auto-advancing
      return SAGA_AUTO.includes(o.status);
    };

    function nextStepIndex(done) {
      for (let i = 0; i < SAGA_FLOW.length; i++) if (!done.has(SAGA_FLOW[i])) return i;
      return -1;
    }

    let attempts = 0;
    const tick = async () => {
      if (mySeq !== renderSeq) return; // navigated away — stop re-rendering this page
      const active = await render();
      if (active && attempts++ < 80) pollTimer = setTimeout(tick, 1500);
    };
    clearTimeout(pollTimer);
    await tick();
  }

  /* ── my orders ── */
  async function viewOrders(main) {
    if (!session.isLoggedIn) { location.hash = '#/login?next=' + encodeURIComponent('#/orders'); return; }
    main.innerHTML = '<div class="orders"><div class="wrap"><div class="skel" style="aspect-ratio:auto;height:220px"></div></div></div>';
    let page = 0;
    const render = async () => {
      const res = await api.myOrders(page, 10);
      main.innerHTML = `
        <div class="orders"><div class="wrap">
          <span class="eyebrow eyebrow--accent">Your account</span>
          <h1>Orders, <em>on record.</em></h1>
          ${res.content.length ? res.content.map(o => `
            <div class="order-card">
              <div class="order-card__head">
                <span class="order-card__num">${esc(o.orderNumber)}</span>
                <span class="status-chip st-${esc(o.status)}">${esc(o.status.replace('_', ' '))}</span>
                <span class="order-card__date">${fmtDate(o.createdAt)} · ${o.itemCount} item${o.itemCount === 1 ? '' : 's'}</span>
                <span class="order-card__total" style="margin-left:auto">${money(o.totalAmount)}</span>
              </div>
              <div class="order-card__body">
                <div class="order-card__actions">
                  <a class="btn btn--quiet" href="#/order/${o.id}">View saga</a>
                  ${['PENDING', 'STOCK_RESERVED'].includes(o.status) ? `<a class="btn btn--accent" href="#/pay/${o.id}">Pay now</a>` : ''}
                </div>
              </div>
            </div>`).join('')
          : `<div class="empty-state"><h3>No orders yet.</h3><p>Your saga history is waiting to be written.</p><a class="btn" href="#/shop">Start shopping</a></div>`}
          ${res.totalPages > 1 ? `
            <div class="pager">
              <button class="btn--quiet btn" id="pg-prev" ${page === 0 ? 'disabled' : ''}>← Prev</button>
              <span class="pager__info">Page ${res.pageNumber + 1} of ${res.totalPages}</span>
              <button class="btn--quiet btn" id="pg-next" ${res.last ? 'disabled' : ''}>Next →</button>
            </div>` : ''}
        </div></div>`;

      $('#pg-prev')?.addEventListener('click', () => { page--; render(); });
      $('#pg-next')?.addEventListener('click', () => { page++; render(); });
    };
    try { await render(); }
    catch (e) {
      main.innerHTML = `<div class="orders"><div class="wrap"><div class="empty-state"><h3>Could not load orders</h3><p>${esc(e.message)}</p></div></div></div>`;
    }
  }

  /* ── auth views ── */
  function viewLogin(main, query) {
    if (session.isLoggedIn) { location.hash = '#/'; return; }
    const next = query.get('next') || '#/';
    main.innerHTML = `
      <div class="auth"><div class="auth__card">
        <span class="eyebrow eyebrow--accent">Welcome back</span>
        <h1>Sign in.</h1>
        <p>Your cart and orders are waiting.</p>
        <form class="auth__form" id="login-form">
          <div class="auth-err" id="auth-err" hidden></div>
          <div class="field"><label for="lg-user">Username or email</label><input id="lg-user" autocomplete="username" required placeholder="demo"/></div>
          <div class="field"><label for="lg-pass">Password</label><input id="lg-pass" type="password" autocomplete="current-password" required placeholder="••••••••"/></div>
          <button class="btn btn--wide" type="submit">Sign in</button>
        </form>
        <p class="auth__swap">New here? <a href="#/register${next !== '#/' ? '?next=' + encodeURIComponent(next) : ''}">Create an account</a></p>
        <div class="demo-hint"><b>Demo accounts</b><br/>
          Customer — <code>demo</code> / <code>Customer@123!</code><br/>
          Admin — <code>admin</code> / <code>Admin@123!</code> (unlocks the Admin console)
        </div>
      </div></div>`;
    $('#login-form').addEventListener('submit', async e => {
      e.preventDefault();
      const errEl = $('#auth-err');
      errEl.hidden = true;
      try {
        const data = await api.login({ username: $('#lg-user').value.trim(), password: $('#lg-pass').value });
        toast(`Welcome back, ${data.user.fullName}`);
        renderChrome();
        location.hash = next;
      } catch (err) {
        errEl.hidden = false;
        errEl.textContent = err.message + ' — demo login: demo / Customer@123!';
      }
    });
  }

  function viewRegister(main, query) {
    if (session.isLoggedIn) { location.hash = '#/'; return; }
    const next = query.get('next') || '#/';
    main.innerHTML = `
      <div class="auth"><div class="auth__card">
        <span class="eyebrow eyebrow--accent">Join Meridian</span>
        <h1>Create account.</h1>
        <p>A minute of your time, years of good objects.</p>
        <form class="auth__form" id="reg-form">
          <div class="auth-err" id="reg-err" hidden></div>
          <div class="field"><label for="rg-user">Username</label><input id="rg-user" autocomplete="username" required placeholder="3–50 characters"/></div>
          <div class="field"><label for="rg-email">Email</label><input id="rg-email" type="email" autocomplete="email" required placeholder="you@example.com"/></div>
          <div class="field"><label for="rg-pass">Password</label><input id="rg-pass" type="password" autocomplete="new-password" required placeholder="••••••••"/>
            <p class="pw-hint">Min 8 characters with an uppercase letter, a digit and a special character (@$!%*?&amp;) — the same policy as the auth service.</p></div>
          <button class="btn btn--wide" type="submit">Create account</button>
        </form>
        <p class="auth__swap">Already have an account? <a href="#/login${next !== '#/' ? '?next=' + encodeURIComponent(next) : ''}">Sign in</a></p>
      </div></div>`;
    $('#reg-form').addEventListener('submit', async e => {
      e.preventDefault();
      const errEl = $('#reg-err');
      errEl.hidden = true;
      try {
        await api.register({ username: $('#rg-user').value.trim(), email: $('#rg-email').value.trim(), password: $('#rg-pass').value });
        await api.login({ username: $('#rg-user').value.trim(), password: $('#rg-pass').value });
        toast('Account created — welcome to Meridian');
        renderChrome();
        location.hash = next;
      } catch (err) {
        errEl.hidden = false;
        errEl.textContent = err.message;
      }
    });
  }

  /* ── account ── */
  function viewAccount(main) {
    if (!session.isLoggedIn) { location.hash = '#/login?next=%23%2Faccount'; return; }
    const u = session.user;
    main.innerHTML = `
      <div class="auth"><div class="auth__card">
        <span class="eyebrow eyebrow--accent">Your account</span>
        <h1>Hello, <em>${esc(u.fullName.split(' ')[0])}.</em></h1>
        <div class="summary" style="position:static;margin-top:20px">
          <div class="summary-row"><span>Name</span><b>${esc(u.fullName)}</b></div>
          <div class="summary-row"><span>Email</span><b>${esc(u.email)}</b></div>
          <div class="summary-row"><span>Role</span><b>${esc(u.role)}</b></div>
          <div class="summary-row"><span>User ID</span><b style="font-size:12px">${esc(u.id)}</b></div>
        </div>
        <div class="order-card__actions" style="margin-top:24px">
          <a class="btn" href="#/orders">My orders</a>
          ${session.isAdmin ? '<a class="btn btn--ghost" href="#/admin">Admin console</a>' : ''}
          <button class="btn btn--danger" id="logout-btn">Sign out</button>
        </div>
      </div></div>`;
    $('#logout-btn').addEventListener('click', async () => {
      await api.logout();
      renderChrome();
      toast('Signed out — your token was blacklisted at the gateway', 'info');
      location.hash = '#/';
      renderChrome();
    });
  }

  /* ── saga explainer ── */
  async function viewSaga(main) {
    let logHtml = '<span class="top">waiting for events…</span>';
    try {
      const events = await (session.isLoggedIn ? api.recentEvents() : Promise.resolve([]));
      if (events.length) {
        logHtml = events.map(e =>
          `<div><span class="t">[${esc(e.topic)}]</span> ${esc(e.eventType)}${e.payload && e.payload.orderNumber ? ' <span class="top">' + esc(e.payload.orderNumber) + '</span>' : ''}</div>`
        ).join('');
      } else if (!session.isLoggedIn) {
        logHtml = '<span class="top">sign in to watch the live event log</span>';
      }
    } catch { /* optional */ }

    main.innerHTML = `
      <div class="prose"><div class="wrap wrap--narrow">
        <span class="eyebrow eyebrow--accent">Under the hood</span>
        <h1>Every order is a <em>saga.</em></h1>
        <p>This storefront is a working interface onto a microservices platform. Your cart, your checkout, and this page's timeline are all driven by the same event flow the backend platform uses — the <b>Saga pattern</b> for distributed transactions.</p>
        <h3>The flow</h3>
        <p>When you place an order, the <code>order-service</code> saves it as <code>PENDING</code> and publishes an <code>ORDER_CREATED</code> event. The <code>inventory-service</code> consumes that event and tries to reserve every SKU in the order. It answers on a second topic:</p>
        <div class="event-log event-table">${logHtml}</div>
        <p><code>STOCK_RESERVED</code> moves your order to <code>STOCK_RESERVED</code> — only then can payment be captured. <code>STOCK_RESERVATION_FAILED</code> fails the order outright. Cancelling publishes <code>ORDER_CANCELLED</code>, which releases the reserved stock back. No step is ever assumed; every step is observed.</p>
        <h3>Where it comes from</h3>
        <p>The reference platform is <a class="link-underline" href="https://github.com/nashinnov8/microservices-ecommerce" target="_blank" rel="noopener">nashinnov8/microservices-ecommerce</a> — five Spring Boot services (gateway, auth, product, inventory, order) with MySQL per service, Kafka topics for the saga, Redis for rate limiting and token blacklists, and Resilience4j circuit breakers at the edge. This website mirrors that API contract end to end so it can also run against the real Java gateway.</p>
      </div></div>`;
  }

  /* ── admin console ── */
  async function viewAdmin(main, query) {
    if (!session.isLoggedIn) { location.hash = '#/login?next=%23%2Fadmin'; return; }
    if (!session.isAdmin) {
      main.innerHTML = `<div class="admin"><div class="wrap"><div class="empty-state"><h3>Admins only.</h3><p>Sign in with the admin demo account — <code>admin</code> / <code>Admin@123!</code>.</p><a class="btn" href="#/login?next=%23%2Fadmin">Sign in as admin</a></div></div></div>`;
      return;
    }
    const tab = query.get('tab') || 'orders';
    main.innerHTML = `
      <div class="admin"><div class="wrap">
        <span class="eyebrow eyebrow--accent">Operations</span>
        <h1>Admin <em>console.</em></h1>
        <p class="admin__sub">Advance the order lifecycle, watch stock levels, and push the saga around by hand.</p>
        <div class="tabs">
          <a class="tab ${tab === 'orders' ? 'is-active' : ''}" href="#/admin?tab=orders">Orders</a>
          <a class="tab ${tab === 'inventory' ? 'is-active' : ''}" href="#/admin?tab=inventory">Inventory</a>
        </div>
        <div id="admin-body"></div>
      </div></div>`;
    if (tab === 'inventory') await renderAdminInventory();
    else await renderAdminOrders();

    async function renderAdminOrders() {
      const body = $('#admin-body');
      body.innerHTML = '<div class="skel" style="aspect-ratio:auto;height:200px"></div>';
      const status = query.get('status') || 'ALL';
      const wrapTable = (rows) => `
        <div class="shop__toolbar" style="border:0;padding:0;margin-bottom:16px">
          <select class="select" id="ad-status">
            <option value="ALL" ${status === 'ALL' ? 'selected' : ''}>All statuses</option>
            ${['PENDING', 'STOCK_RESERVED', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'FAILED'].map(s => `<option value="${s}" ${status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
          <span class="shop__meta">${rows.length} order${rows.length === 1 ? '' : 's'}</span>
        </div>
        <div class="table-wrap"><table class="admin-table">
          <thead><tr><th>Order</th><th>Status</th><th>Items</th><th class="num">Total</th><th>Placed</th><th>Actions</th></tr></thead>
          <tbody>
            ${rows.map(o => `
              <tr>
                <td><b>${esc(o.orderNumber)}</b></td>
                <td><span class="status-chip st-${esc(o.status)}">${esc(o.status.replace('_', ' '))}</span></td>
                <td>${o.itemCount}</td>
                <td class="num">${money(o.totalAmount)}</td>
                <td>${fmtDate(o.createdAt)}</td>
                <td><div class="row-actions">
                  <a class="btn btn--quiet" href="#/order/${o.id}">View</a>
                  ${o.status === 'STOCK_RESERVED' ? `<button class="btn btn--quiet" data-adv="confirm" data-id="${o.id}">Confirm</button>` : ''}
                  ${['STOCK_RESERVED', 'CONFIRMED'].includes(o.status) ? `<button class="btn btn--quiet" data-adv="processing" data-id="${o.id}">→ Processing</button>` : ''}
                  ${o.status === 'PROCESSING' ? `<button class="btn btn--quiet" data-adv="ship" data-id="${o.id}">→ Ship</button>` : ''}
                  ${o.status === 'SHIPPED' ? `<button class="btn btn--quiet" data-adv="deliver" data-id="${o.id}">→ Deliver</button>` : ''}
                  ${['PENDING', 'STOCK_RESERVED', 'CONFIRMED', 'PROCESSING'].includes(o.status) ? `<button class="btn btn--danger" data-cancel="${o.id}">Cancel</button>` : ''}
                </div></td>
              </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--ink-faint);padding:34px">No orders with this status.</td></tr>'}
          </tbody>
        </table></div>`;

      try {
        let orders;
        if (status === 'ALL') {
          const statuses = ['PENDING', 'STOCK_RESERVED', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'FAILED'];
          const results = await Promise.all(statuses.map(s => api.ordersByStatus(s, 0, 50).catch(() => ({ content: [] }))));
          const seen = new Set(); const merged = [];
          results.forEach(r => r.content.forEach(o => { if (!seen.has(o.id)) { seen.add(o.id); merged.push(o); } }));
          merged.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          orders = merged;
        } else {
          orders = (await api.ordersByStatus(status, 0, 50)).content;
        }
        body.innerHTML = wrapTable(orders);

        $('#ad-status').addEventListener('change', e => { location.hash = `#/admin?tab=orders&status=${e.target.value}`; });
        $$('button[data-adv]', body).forEach(b => b.addEventListener('click', async () => {
          try { await api.advanceOrder(b.dataset.id, b.dataset.adv); toast('Order advanced'); viewAdmin(main, query); }
          catch (e) { toast(e.message, 'err'); }
        }));
        $$('button[data-cancel]', body).forEach(b => b.addEventListener('click', async () => {
          try { await api.cancelOrder(b.dataset.cancel, 'Cancelled by admin'); toast('Order cancelled — stock releasing'); viewAdmin(main, query); }
          catch (e) { toast(e.message, 'err'); }
        }));
      } catch (e) {
        body.innerHTML = `<div class="empty-state"><h3>Could not load orders</h3><p>${esc(e.message)}</p></div>`;
      }
    }

    async function renderAdminInventory() {
      const body = $('#admin-body');
      body.innerHTML = '<div class="skel" style="aspect-ratio:auto;height:200px"></div>';
      try {
        const [inv, low] = await Promise.all([api.inventoryAll(), api.lowStock()]);
        const lowSkus = new Set(low.map(i => i.sku));
        body.innerHTML = `
          <div class="shop__toolbar" style="border:0;padding:0;margin-bottom:16px">
            <span class="shop__meta">${inv.length} SKUs · ${low.length} low-stock alert${low.length === 1 ? '' : 's'}</span>
          </div>
          <div class="table-wrap"><table class="admin-table">
            <thead><tr><th>SKU</th><th>Product</th><th class="num">Available</th><th class="num">Reserved</th><th class="num">Reorder pt</th><th>Adjust</th></tr></thead>
            <tbody>
              ${inv.map(i => `
                <tr>
                  <td><b>${esc(i.sku)}</b>${lowSkus.has(i.sku) ? ' <span class="low-flag">● LOW</span>' : ''}</td>
                  <td>${esc(i.productName || '—')}${i.variantName ? ` <span style="color:var(--ink-faint)">(${esc(i.variantName)})</span>` : ''}</td>
                  <td class="num">${i.availableStock}</td>
                  <td class="num">${i.reservedStock}</td>
                  <td class="num">${i.reorderPoint}</td>
                  <td><span class="stock-adjust" data-sku="${esc(i.sku)}">
                    <input type="number" min="0" value="${i.availableStock}" aria-label="New stock for ${esc(i.sku)}"/>
                    <button class="btn btn--quiet" data-set>Set</button>
                  </span></td>
                </tr>`).join('')}
            </tbody>
          </table></div>
          <p class="note" style="margin-top:14px;color:var(--ink-faint);font-size:12px">Tip: set a SKU to 0, then place an order for it from the storefront — you'll watch the saga fail gracefully instead of overselling.</p>`;

        $$('button[data-set]', body).forEach(b => b.addEventListener('click', async () => {
          const row = b.closest('.stock-adjust');
          const sku = row.dataset.sku;
          const val = parseInt($('input', row).value, 10);
          if (!Number.isInteger(val) || val < 0) { toast('Enter a non-negative quantity', 'err'); return; }
          try { await api.updateStock(sku, { operation: 'SET', quantity: val, reference: 'admin-console' }); toast(`${sku} → ${val}`); renderAdminInventory(); }
          catch (e) { toast(e.message, 'err'); }
        }));
      } catch (e) {
        body.innerHTML = `<div class="empty-state"><h3>Could not load inventory</h3><p>${esc(e.message)}</p></div>`;
      }
    }
  }

  /* ── payment page (fake gateway) ── */
  const BANKS = ['HDFC Bank', 'ICICI Bank', 'State Bank of India', 'Axis Bank', 'Kotak Mahindra'];

  async function viewPay(main, id) {
    const mySeq = renderSeq; // stop polling if the user navigates elsewhere
    if (!session.isLoggedIn) { location.hash = '#/login?next=' + encodeURIComponent('#/pay/' + id); return; }
    let o;
    try { o = await api.order(id); }
    catch (e) {
      main.innerHTML = `<div class="cart"><div class="wrap"><div class="empty-state"><h3>Order not found</h3><p>${esc(e.message)}</p><a class="btn" href="#/orders">My orders</a></div></div></div>`;
      return;
    }
    if (['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'].includes(o.status)) {
      toast('This order is already paid', 'info');
      location.hash = '#/order/' + id;
      return;
    }

    main.innerHTML = `
      <div class="pay"><div class="wrap wrap--narrow">
        <span class="eyebrow eyebrow--accent">Secure checkout</span>
        <h1>Payment.</h1>
        <p class="pay__sub">Order <b>${esc(o.orderNumber)}</b> · ${o.items.length} item${o.items.length === 1 ? '' : 's'} · <b>${money(o.totalAmount)}</b></p>
        <div id="pay-body"></div>
      </div></div>`;
    const body = $('#pay-body');

    const renderFailed = failed => {
      body.innerHTML = `<div class="empty-state"><h3>We couldn’t reserve your items.</h3><p>${esc(failed.cancelledReason || 'The saga failed before payment could begin.')}</p><a class="btn" href="#/shop">Back to the shop</a></div>`;
    };

    if (o.status === 'FAILED') { renderFailed(o); return; }

    if (o.status === 'PENDING') {
      body.innerHTML = `<div class="saga-panel" style="text-align:center;padding:46px 30px">
        <div class="pay-spinner" style="margin:0 auto 18px"></div>
        <b style="letter-spacing:.14em;text-transform:uppercase;font-size:12px">The inventory saga is reserving your items…</b>
        <p class="note" style="margin-top:8px">Payment opens the moment stock is safely held.</p>
      </div>`;
      let tries = 0;
      const poll = async () => {
        if (mySeq !== renderSeq) return; // navigated away
        let cur;
        try { cur = await api.order(id); } catch { return; }
        if (cur.status === 'STOCK_RESERVED') renderPayment(cur);
        else if (cur.status === 'FAILED') renderFailed(cur);
        else if (cur.status === 'PENDING' && tries++ < 20) setTimeout(poll, 800);
      };
      setTimeout(poll, 700);
      return;
    }

    renderPayment(o);

    function renderPayment(order) {
      let method = 'upi';
      body.innerHTML = `
        <div class="pay__grid">
          <section class="pay__panel">
            <div class="pay-methods" id="pay-methods">
              <button type="button" data-m="upi" class="is-active">UPI</button>
              <button type="button" data-m="card">Card</button>
              <button type="button" data-m="netbanking">Netbanking</button>
              <button type="button" data-m="cod">COD</button>
            </div>
            <div id="pay-form"></div>
            <div class="pay-error" id="pay-error" hidden></div>
            <button class="btn btn--accent btn--wide" id="pay-submit" style="margin-top:20px"></button>
            <p class="pay-secure">Demo gateway — no real money moves. Declines: card ending 0000, or a UPI ID starting with “fail”.</p>
          </section>
          <aside class="summary" style="position:static">
            <h3>${esc(order.orderNumber)}</h3>
            ${order.items.map(i => `
              <div class="mini-line">
                <img src="${esc('/img/products/' + i.sku.toLowerCase().split('-').slice(0, 2).join('-') + '.jpg')}" alt="" onerror="this.onerror=null;this.src='${IMG_FALLBACK}'"/>
                <div class="mini-line__n">${esc(i.productName)}<span>× ${i.quantity}${i.variantName ? ` — ${esc(i.variantName)}` : ''}</span></div>
                <span class="mini-line__p">${money(i.unitPrice * i.quantity)}</span>
              </div>`).join('')}
            <div class="summary-row summary-row--total" style="margin-top:12px"><span>Amount payable</span><b>${money(order.totalAmount)}</b></div>
            <div class="summary-row"><span>Ship to</span><b style="text-align:right;max-width:60%;font-size:13px">${esc(order.shippingAddressLine1)}, ${esc(order.shippingCity)} ${esc(order.shippingState)} ${esc(order.shippingZipCode)}</b></div>
          </aside>
        </div>`;

      const formEl = $('#pay-form');
      const errEl = $('#pay-error');
      const submit = $('#pay-submit');
      const showErr = msg => { errEl.hidden = false; errEl.textContent = msg; };
      const clearErr = () => { errEl.hidden = true; };

      const forms = {
        upi: () => `
          <div class="field"><label for="upi-id">UPI ID</label><input id="upi-id" placeholder="yourname@okhdfc" autocomplete="off"/>
          <p class="pw-hint">You’ll get a collect request in your (imaginary) UPI app.</p></div>`,
        card: () => `
          <div class="field"><label for="cc-num">Card number</label><input id="cc-num" inputmode="numeric" placeholder="4111 1111 1111 1111" autocomplete="off"/></div>
          <div class="field" style="margin-top:14px"><label for="cc-name">Name on card</label><input id="cc-name" placeholder="DEMO CUSTOMER" autocomplete="off"/></div>
          <div class="form-grid" style="margin-top:14px">
            <div class="field"><label for="cc-exp">Expiry (MM/YY)</label><input id="cc-exp" inputmode="numeric" placeholder="12/29" autocomplete="off"/></div>
            <div class="field"><label for="cc-cvv">CVV</label><input id="cc-cvv" inputmode="numeric" type="password" placeholder="•••" autocomplete="off"/></div>
          </div>`,
        netbanking: () => `
          <div class="field"><label for="nb-bank">Choose your bank</label>
            <select id="nb-bank"><option value="">— Select —</option>${BANKS.map(b => `<option>${esc(b)}</option>`).join('')}</select></div>
          <p class="pw-hint" style="margin-top:10px">You’ll be redirected to your bank’s (imaginary) portal.</p>`,
        cod: () => `
          <div class="pay-cod">Pay <b>${money(order.totalAmount)}</b> in cash or UPI when the courier hands over your parcel. Your items stay reserved and the order is confirmed right away.</div>`,
      };

      const setMethod = m => {
        method = m; clearErr();
        $$('#pay-methods button').forEach(b => b.classList.toggle('is-active', b.dataset.m === m));
        formEl.innerHTML = forms[m]();
        submit.textContent = `${m === 'cod' ? 'Place COD order' : 'Pay'} ${money(order.totalAmount)} securely`;
        if (m === 'card') {
          $('#cc-num').addEventListener('input', e => {
            const d = e.target.value.replace(/\D/g, '').slice(0, 16);
            e.target.value = d.replace(/(\d{4})(?=\d)/g, '$1 ');
          });
          $('#cc-exp').addEventListener('input', e => {
            const d = e.target.value.replace(/\D/g, '').slice(0, 4);
            e.target.value = d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d;
          });
        }
      };
      $('#pay-methods').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (b) setMethod(b.dataset.m);
      });
      setMethod('upi');

      const collect = () => {
        if (method === 'upi') {
          const upiId = $('#upi-id').value.trim();
          if (!/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(upiId)) return { err: 'Enter a UPI ID like name@okhdfc' };
          return { payload: { upiId } };
        }
        if (method === 'card') {
          const cardNumber = $('#cc-num').value.replace(/\s/g, '');
          const cardName = $('#cc-name').value.trim();
          const expiry = $('#cc-exp').value.trim();
          const cvv = $('#cc-cvv').value.trim();
          if (cardNumber.length !== 16) return { err: 'Card number must be 16 digits' };
          if (!cardName) return { err: 'Enter the name on the card' };
          if (!/^\d{2}\/\d{2}$/.test(expiry) || +expiry.slice(0, 2) < 1 || +expiry.slice(0, 2) > 12) return { err: 'Expiry must be a valid MM/YY' };
          if (!/^\d{3,4}$/.test(cvv)) return { err: 'CVV must be 3–4 digits' };
          return { payload: { cardNumber, cardName, expiry, cvv } };
        }
        if (method === 'netbanking') {
          const bank = $('#nb-bank').value;
          if (!bank) return { err: 'Choose a bank to continue' };
          return { payload: { bank } };
        }
        return { payload: {} };
      };

      const overlay = show => {
        $('#pay-overlay')?.remove();
        if (!show) return;
        const dest = method === 'upi' ? 'your UPI app' : method === 'netbanking' ? 'your bank' : 'the card network';
        document.body.insertAdjacentHTML('beforeend', `
          <div class="pay-overlay" id="pay-overlay"><div class="pay-box">
            <div class="pay-spinner"></div>
            <b>Contacting the payment gateway…</b>
            <ul class="pay-steps">
              <li class="on">Encrypting payment details</li>
              <li id="pay-step-2">Reaching ${dest}</li>
              <li id="pay-step-3">Verifying the payment</li>
            </ul>
          </div></div>`);
        setTimeout(() => $('#pay-step-2')?.classList.add('on'), 700);
        setTimeout(() => $('#pay-step-3')?.classList.add('on'), 1400);
      };
      const overlaySuccess = txn => {
        const box = $('#pay-overlay .pay-box');
        if (!box) return; // user navigated away mid-payment; nothing to update
        box.innerHTML = `
          <div class="pay-success">✓</div>
          <b>Payment successful</b>
          <p class="note" style="margin-top:6px">${money(txn.amount)} · ${esc(txn.transactionId)}</p>
          <p class="note">Taking you to your order…</p>`;
      };

      submit.addEventListener('click', async () => {
        clearErr();
        const c = collect();
        if (c.err) { showErr(c.err); return; }
        submit.disabled = true;
        overlay(true);
        try {
          const res = await api.pay({ orderId: order.id, method, ...c.payload });
          overlaySuccess(res);
          setTimeout(() => {
            $('#pay-overlay')?.remove();
            // only yank the user to the order page if they're still on this payment screen
            if (location.hash === '#/pay/' + order.id) location.hash = '#/order/' + order.id;
          }, 2200);
        } catch (e) {
          overlay(false);
          submit.disabled = false;
          showErr(e.message);
        }
      });
    }
  }

  /* ═══════════════════ ROUTER ═══════════════════ */

  function parseHash() {
    const raw = location.hash.replace(/^#/, '') || '/';
    const [pathPart, queryPart] = raw.split('?');
    const query = new URLSearchParams(queryPart || '');
    const segs = pathPart.split('/').filter(Boolean);
    return { pathPart, segs, query };
  }

  let renderSeq = 0;
  async function route() {
    $('#pay-overlay')?.remove(); // never let a payment overlay outlive its screen
    const main = $('#main');
    const { segs, query } = parseHash();
    const seq = ++renderSeq;
    const guard = async fn => {
      // ignore stale renders if the hash changed while awaiting
      const mine = seq;
      await fn();
      if (mine !== renderSeq) main.innerHTML = ''; // superseded
    };

    // active nav state
    $$('.site-nav a').forEach(a => a.classList.remove('is-active'));
    const navKey = segs[0] || '';
    const navMap = { '': '', shop: 'shop', orders: 'orders', admin: 'admin' };
    if (navKey in navMap && navMap[navKey]) { $(`[data-nav="${navMap[navKey]}"]`)?.classList.add('is-active'); }
    if (segs[0] === 'shop' && query.get('category')) {
      const key = CATEGORY_KEYS[query.get('category')];
      if (key) $(`[data-nav="${key}"]`)?.classList.add('is-active');
    }

    window.scrollTo({ top: 0 });

    const [head] = segs;
    try {
      if (!head) await guard(() => viewHome(main));
      else if (head === 'shop') await guard(() => viewShop(main, query));
      else if (head === 'product' && segs[1]) await guard(() => viewProduct(main, segs[1]));
      else if (head === 'cart') viewCart(main);
      else if (head === 'checkout') viewCheckout(main);
      else if (head === 'order' && segs[1]) await guard(() => viewOrder(main, segs[1]));
      else if (head === 'pay' && segs[1]) await guard(() => viewPay(main, segs[1]));
      else if (head === 'orders') await guard(() => viewOrders(main));
      else if (head === 'login') viewLogin(main, query);
      else if (head === 'register') viewRegister(main, query);
      else if (head === 'account') viewAccount(main);
      else if (head === 'admin') await guard(() => viewAdmin(main, query));
      else if (head === 'saga') await guard(() => viewSaga(main));
      else {
        main.innerHTML = `<div class="cart"><div class="wrap"><div class="empty-state"><h3>Lost in the archive.</h3><p>That page doesn't exist.</p><a class="btn" href="#/">Back home</a></div></div></div>`;
      }
    } catch (e) {
      console.error(e);
      main.innerHTML = `<div class="cart"><div class="wrap"><div class="empty-state"><h3>Something went wrong</h3><p>${esc(e.message || e)}</p><a class="btn" href="#/">Back home</a></div></div></div>`;
    }
  }

  /* ── boot ── */
  window.addEventListener('hashchange', route);
  window.addEventListener('meridian:session-expired', () => {
    renderChrome();
    toast('Your session expired — please sign in again', 'info');
  });
  $('#nav-toggle').addEventListener('click', () => {
    const nav = $('#site-nav');
    const open = nav.classList.toggle('open');
    $('#nav-toggle').setAttribute('aria-expanded', String(open));
  });
  $('#site-nav').addEventListener('click', e => {
    if (e.target.tagName === 'A') { $('#site-nav').classList.remove('open'); $('#nav-toggle').setAttribute('aria-expanded', 'false'); }
  });
  $('#search-btn').addEventListener('click', () => {
    if (!location.hash.startsWith('#/shop')) location.hash = '#/shop';
    setTimeout(() => $('#shop-q')?.focus(), 150);
  });

  renderChrome();
  updateCartBadge();
  if (!location.hash) location.hash = '#/';
  route();
})();
