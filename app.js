/* León TOP 20 — app móvil. Solo LEE /data/*.json.
   Favoritos en localStorage (por dispositivo). Anuncios desde data/ads.json. */
'use strict';

const CATEGORIES = {
  tapeo:   { label: 'Tapear',  file: 'data/tapeo.json',   color: '#d4a017' },
  comida:  { label: 'Cenar',   file: 'data/comida.json',  color: '#b3123b' },
  visitar: { label: 'Visitar', file: 'data/visitar.json', color: '#6b2c8f' },
};

const FAVS_KEY = 'leon-favs-v1';
const LEON_CENTER = [42.5987, -5.5671];
const BANNER_ROTATE_MS = 7000;

const state = {
  view: 'tapeo',
  data: {},
  ads: [],
  markers: {},
  favs: loadFavs(),
  openNow: false,      // filtro "abierto ahora"
  discounts: [],       // ofertas (Supabase o data/descuentos.json)
  saved: new Set(),    // descuentos guardados (en la nube, si hay sesión)
  savedOnly: false,    // filtro "★ Guardados"
  user: null,          // usuario de Supabase (null = no logueado)
  layer: L.layerGroup(),
  bannerTimer: null,
};

const WEEK_MIN = 7 * 24 * 60; // 10080

// ---------------------------------------------------------------------------
// "Abierto ahora": se calcula en el cliente a partir del horario que el cron
// dejó en cada item (item.hours + item.tz). Cero peticiones a Google por usuario.
// ---------------------------------------------------------------------------
function nowWeekMin(tz) {
  // Hora local del sitio = epoch + su desfase UTC; leemos los campos en UTC.
  const ms = Date.now() + (typeof tz === 'number' ? tz : 0) * 60000;
  const d = new Date(ms);
  return d.getUTCDay() * 1440 + d.getUTCHours() * 60 + d.getUTCMinutes();
}
function openInfo(item) {
  const hours = item.hours;
  if (!Array.isArray(hours) || hours.length === 0) return { known: false, open: false };
  const w = nowWeekMin(item.tz);
  for (const [s, e] of hours) {
    if ((w >= s && w < e) || (w + WEEK_MIN >= s && w + WEEK_MIN < e)) {
      return { known: true, open: true, closesAt: e % 1440 };
    }
  }
  let best = Infinity, opensAt = null;
  for (const [s] of hours) {
    let d = s - w; if (d < 0) d += WEEK_MIN;
    if (d < best) { best = d; opensAt = s % 1440; }
  }
  return { known: true, open: false, opensAt };
}
function hm(min) {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
function statusHTML(item) {
  const info = openInfo(item);
  if (!info.known) return '';
  if (info.open) {
    return `<span class="st st-open">● Abierto</span>` +
      (info.closesAt != null ? ` · cierra ${hm(info.closesAt)}` : '');
  }
  return `<span class="st st-closed">● Cerrado</span>` +
    (info.opensAt != null ? ` · abre ${hm(info.opensAt)}` : '');
}

// ---------------------------------------------------------------------------
// Favoritos (localStorage, por dispositivo)
// ---------------------------------------------------------------------------
function loadFavs() {
  try {
    const a = JSON.parse(localStorage.getItem(FAVS_KEY) || '[]');
    return new Set(Array.isArray(a) ? a : []);
  } catch { return new Set(); }
}
function saveFavs() {
  try { localStorage.setItem(FAVS_KEY, JSON.stringify([...state.favs])); } catch { /* noop */ }
}
function isFav(id) { return state.favs.has(id); }
function toggleFav(id) {
  const adding = !state.favs.has(id);
  if (adding) state.favs.add(id); else state.favs.delete(id);
  saveFavs();
  updateFavBadge();
  // Si hay sesión, sincroniza el cambio con la nube (no bloquea la UI).
  if (state.user && window.Cloud) {
    (adding ? Cloud.addFavorite(id) : Cloud.removeFavorite(id));
  }
  if (state.view === 'favoritos') renderView('favoritos');
  else refreshHearts();
}
function updateFavBadge() {
  const n = state.favs.size;
  const b = document.getElementById('fav-badge');
  if (n > 0) { b.hidden = false; b.textContent = n > 99 ? '99+' : String(n); }
  else b.hidden = true;
}
function refreshHearts() {
  document.querySelectorAll('.fav-btn[data-id]').forEach((b) => {
    const on = isFav(b.dataset.id);
    b.classList.toggle('is-fav', on);
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? 'Quitar de favoritos' : 'Añadir a favoritos');
    b.textContent = on ? '♥' : '♡';
  });
}

// ---------------------------------------------------------------------------
// Mapa
// ---------------------------------------------------------------------------
const map = L.map('map', {
  center: LEON_CENTER, zoom: 14,
  zoomControl: false, attributionControl: false,
});
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  subdomains: 'abcd', maxZoom: 20,
}).addTo(map);
state.layer.addTo(map);
// Sin botones de zoom: en móvil se usa el pellizco (pinch-to-zoom).

// ---------------------------------------------------------------------------
// Utilidades de render
// ---------------------------------------------------------------------------
function radiusForPos(pos, total) {
  const maxR = 24, minR = 9;
  if (total <= 1) return maxR;
  return maxR - ((pos - 1) / (total - 1)) * (maxR - minR);
}
function starsText(rating) { return `<span class="star">★</span> ${rating.toFixed(1)}`; }
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function heartHTML(id) {
  const on = isFav(id);
  return `<button class="fav-btn${on ? ' is-fav' : ''}" type="button" data-id="${escapeHTML(id)}" ` +
    `aria-pressed="${on}" aria-label="${on ? 'Quitar de favoritos' : 'Añadir a favoritos'}">${on ? '♥' : '♡'}</button>`;
}
function popupHTML(entry) {
  const it = entry.item;
  const st = statusHTML(it);
  return `<div class="popup-head"><div class="popup-name">${escapeHTML(it.name)}</div>${heartHTML(it.id)}</div>` +
    `<div class="popup-meta">${starsText(it.rating)} · ${it.reviews.toLocaleString('es-ES')} reseñas</div>` +
    (st ? `<div class="popup-status">${st}</div>` : '') +
    `<div class="popup-rank">Puesto #${it.rank} en ${entry.catLabel}</div>`;
}

function entriesForView(view) {
  if (CATEGORIES[view]) {
    const { color, label } = CATEGORIES[view];
    const items = (state.data[view] && state.data[view].items) || [];
    return items.map((item) => ({ item, color, catLabel: label, cat: view }));
  }
  const out = [];
  for (const [cat, cfg] of Object.entries(CATEGORIES)) {
    const items = (state.data[cat] && state.data[cat].items) || [];
    for (const item of items) if (isFav(item.id)) out.push({ item, color: cfg.color, catLabel: cfg.label, cat });
  }
  out.sort((a, b) => b.item.score - a.item.score);
  return out;
}

// ---------------------------------------------------------------------------
// Render de una vista
// ---------------------------------------------------------------------------
function renderView(view) {
  state.view = view;
  const isFavView = view === 'favoritos';

  document.querySelectorAll('.tab').forEach((b) =>
    b.classList.toggle('is-active', b.dataset.cat === view));

  // Chips de la cabecera según la vista.
  document.getElementById('open-toggle').hidden = (view === 'descuentos');
  document.getElementById('saved-toggle').hidden = (view !== 'descuentos');

  if (view === 'descuentos') { renderDiscounts(); return; }

  document.getElementById('panel-title').textContent = isFavView ? '★ Favoritos' : CATEGORIES[view].label;

  const updatedEl = document.getElementById('updated');
  if (isFavView) {
    const n = state.favs.size;
    updatedEl.textContent = n ? `${n} ${n === 1 ? 'sitio guardado' : 'sitios guardados'} en este dispositivo` : '';
  } else {
    const payload = state.data[view];
    updatedEl.textContent = payload && payload.generatedAt
      ? 'Actualizado: ' + new Date(payload.generatedAt).toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' })
      : '';
  }

  state.layer.clearLayers();
  state.markers = {};
  const list = document.getElementById('ranking-list');
  list.innerHTML = '';
  renderSponsored(view, list);

  let entries = entriesForView(view);
  const hadEntries = entries.length > 0;
  if (state.openNow) entries = entries.filter((e) => openInfo(e.item).open);

  if (entries.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    if (state.openNow && hadEntries) {
      li.textContent = isFavView
        ? 'Ninguno de tus favoritos está abierto ahora mismo.'
        : 'Ningún sitio de esta categoría está abierto ahora mismo.';
    } else {
      li.textContent = isFavView
        ? 'No tienes favoritos todavía. Toca el corazón ♡ de un sitio para guardarlo aquí.'
        : 'Sin datos todavía. El ranking se genera a diario mediante GitHub Actions.';
    }
    list.appendChild(li);
    renderBanner(view);
    return;
  }

  const total = entries.length;
  const latlngs = [];

  entries.forEach((entry, i) => {
    const pos = i + 1;
    const { item, color, catLabel } = entry;
    const r = radiusForPos(pos, total);
    const latlng = [item.lat, item.lng];
    latlngs.push(latlng);

    const marker = L.circleMarker(latlng, {
      radius: r, color: '#fff', weight: 2, fillColor: color, fillOpacity: 0.85,
    });
    marker.bindPopup(popupHTML(entry));
    marker.on('click', () => selectPos(pos, false));
    marker.addTo(state.layer);

    L.marker(latlng, {
      icon: L.divIcon({
        className: 'bubble-label',
        html: `<span style="width:${r * 2}px">${pos}</span>`,
        iconSize: [r * 2, 0], iconAnchor: [r, 6],
      }),
      interactive: false, keyboard: false,
    }).addTo(state.layer);

    state.markers[pos] = marker;

    const li = document.createElement('li');
    li.className = 'rank-item';
    li.style.color = color;
    li.style.setProperty('--cat-color', color);
    li.dataset.pos = String(pos);
    const catTag = isFavView ? `<span class="cat-tag">${catLabel}</span>` : '';
    const st = statusHTML(item);
    li.innerHTML =
      `<div class="rank-num">${pos}</div>` +
      `<div><div class="rank-name">${escapeHTML(item.name)} ${catTag}</div>` +
      `<div class="rank-meta">${starsText(item.rating)} · ${item.reviews.toLocaleString('es-ES')} reseñas</div>` +
      (st ? `<div class="rank-status">${st}</div>` : '') + `</div>` +
      `<div class="rank-score">${item.score.toFixed(2)}</div>` +
      heartHTML(item.id);
    li.addEventListener('click', (e) => {
      if (e.target.closest('.fav-btn')) return;
      selectPos(pos, true);
    });
    list.appendChild(li);
  });

  if (latlngs.length) {
    map.fitBounds(L.latLngBounds(latlngs), {
      paddingTopLeft: [26, 70],
      paddingBottomRight: [26, 240],
      maxZoom: 16,
    });
  }
  renderBanner(view);
}

function selectPos(pos, fromList) {
  const marker = state.markers[pos];
  if (!marker) return;
  if (fromList) setSheet('peek');          // baja la hoja para ver el mapa
  map.panTo(marker.getLatLng());
  marker.openPopup();
  document.querySelectorAll('.rank-item').forEach((el) =>
    el.classList.toggle('is-selected', el.dataset.pos === String(pos)));
}

// ---------------------------------------------------------------------------
// Anuncios
// ---------------------------------------------------------------------------
function adApplies(ad, view) {
  const cats = ad.categories;
  if (!Array.isArray(cats) || cats.length === 0) return true;
  return cats.includes(view);
}
function adLive(ad, now) {
  if (!ad || ad.active !== true) return false;
  if (ad.start && now < Date.parse(ad.start)) return false;
  if (ad.end && now > Date.parse(ad.end)) return false;
  return true;
}
function eligibleAds(placement, view) {
  const now = Date.now();
  return state.ads.filter((a) => a && a.placement === placement && adLive(a, now) && adApplies(a, view));
}
function weightedPick(ads) {
  const total = ads.reduce((s, a) => s + Math.max(0, Number(a.weight) || 0), 0);
  if (total <= 0) return ads[Math.floor(Math.random() * ads.length)];
  let r = Math.random() * total;
  for (const a of ads) { r -= Math.max(0, Number(a.weight) || 0); if (r <= 0) return a; }
  return ads[ads.length - 1];
}
function bannerHTML(ad) {
  const img = ad.imageUrl ? `<img class="ad-img" src="${escapeHTML(ad.imageUrl)}" alt="" loading="lazy">` : '';
  return `<a class="ad-banner-link" href="${escapeHTML(ad.linkUrl)}" target="_blank" rel="noopener nofollow sponsored">` +
    `<span class="ad-tag">Publicidad</span>${img}` +
    `<span class="ad-text"><span class="ad-title">${escapeHTML(ad.title)}</span>` +
    `<span class="ad-body">${escapeHTML(ad.body || '')}</span></span></a>`;
}
function renderBanner(view) {
  if (state.bannerTimer) { clearInterval(state.bannerTimer); state.bannerTimer = null; }
  const el = document.getElementById('ad-banner');
  const ads = eligibleAds('banner', view);
  if (ads.length === 0) { el.hidden = true; el.innerHTML = ''; return; }
  const show = () => { el.innerHTML = bannerHTML(weightedPick(ads)); el.hidden = false; };
  show();
  if (ads.length > 1) state.bannerTimer = setInterval(show, BANNER_ROTATE_MS);
}
function renderSponsored(view, list) {
  const ads = eligibleAds('list', view);
  if (ads.length === 0) return;
  const ad = weightedPick(ads);
  const li = document.createElement('li');
  li.className = 'rank-item sponsored';
  li.innerHTML =
    `<div class="rank-num">★</div>` +
    `<div><div class="rank-name">${escapeHTML(ad.title)} <span class="spon-tag">Patrocinado</span></div>` +
    `<div class="rank-meta">${escapeHTML(ad.body || '')}</div></div><div></div><div></div>`;
  li.addEventListener('click', () => window.open(ad.linkUrl, '_blank', 'noopener'));
  list.appendChild(li);
}

// ---------------------------------------------------------------------------
// Descuentos / Ofertas
// ---------------------------------------------------------------------------
const DISCOUNT_COLOR = '#d4a017';

function isSaved(id) { return state.saved.has(id); }

function discountCardHTML(d) {
  const saved = isSaved(d.id);
  const label = d.discount_label ? `<span class="disc-badge">${escapeHTML(d.discount_label)}</span>` : '';
  const code = d.code ? `<button class="disc-code" type="button" data-code="${escapeHTML(d.code)}" title="Copiar código">${escapeHTML(d.code)} ⧉</button>` : '';
  const link = d.link_url ? `<a class="disc-link" href="${escapeHTML(d.link_url)}" target="_blank" rel="noopener">Ver más</a>` : '';
  const terms = d.terms ? `<div class="disc-terms">${escapeHTML(d.terms)}</div>` : '';
  return (
    `<div class="disc-main">` +
      `<div class="disc-top">${label}<div class="disc-title">${escapeHTML(d.title)}</div></div>` +
      `<div class="disc-biz">${escapeHTML(d.business || '')}</div>` +
      (d.description ? `<div class="disc-desc">${escapeHTML(d.description)}</div>` : '') +
      terms +
      `<div class="disc-actions">${code}${link}</div>` +
    `</div>` +
    `<button class="save-btn${saved ? ' is-saved' : ''}" type="button" data-id="${escapeHTML(d.id)}" ` +
      `aria-pressed="${saved}" aria-label="${saved ? 'Quitar de guardados' : 'Guardar oferta'}">${saved ? '★' : '☆'}</button>`
  );
}

function renderDiscounts() {
  document.getElementById('panel-title').textContent = 'Ofertas';
  const updatedEl = document.getElementById('updated');

  state.layer.clearLayers();
  state.markers = {};
  const list = document.getElementById('ranking-list');
  list.innerHTML = '';

  let items = state.discounts.slice();
  if (state.savedOnly) items = items.filter((d) => isSaved(d.id));

  updatedEl.textContent = state.user
    ? `Sesión iniciada · ${state.saved.size} guardadas`
    : 'Inicia sesión para guardar tus ofertas';

  if (items.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    if (state.savedOnly) {
      li.textContent = state.user
        ? 'No has guardado ninguna oferta todavía. Toca la ★ de una oferta.'
        : 'Inicia sesión (botón de cuenta, arriba) para guardar y ver tus ofertas.';
    } else {
      li.textContent = 'Aún no hay ofertas disponibles.';
    }
    list.appendChild(li);
    renderBanner('descuentos');
    return;
  }

  const latlngs = [];
  items.forEach((d, i) => {
    // Pin en el mapa si la oferta tiene ubicación.
    if (typeof d.lat === 'number' && typeof d.lng === 'number') {
      const latlng = [d.lat, d.lng];
      latlngs.push(latlng);
      const marker = L.circleMarker(latlng, {
        radius: 13, color: '#fff', weight: 2, fillColor: DISCOUNT_COLOR, fillOpacity: 0.9,
      });
      marker.bindPopup(
        `<div class="popup-name">${escapeHTML(d.business || d.title)}</div>` +
        `<div class="popup-meta">${escapeHTML(d.discount_label || '')} · ${escapeHTML(d.title)}</div>`
      );
      marker.addTo(state.layer);
      L.marker(latlng, {
        icon: L.divIcon({ className: 'bubble-label', html: `<span style="width:26px">%</span>`, iconSize: [26, 0], iconAnchor: [13, 6] }),
        interactive: false, keyboard: false,
      }).addTo(state.layer);
      const idx = latlngs.length;
      marker.on('click', () => marker.openPopup());
      state.markers[idx] = marker;
    }
    const li = document.createElement('li');
    li.className = 'rank-item disc-item';
    li.innerHTML = discountCardHTML(d);
    list.appendChild(li);
  });

  if (latlngs.length) {
    map.fitBounds(L.latLngBounds(latlngs), { paddingTopLeft: [26, 70], paddingBottomRight: [26, 240], maxZoom: 16 });
  }
  renderBanner('descuentos');
}

function toggleSave(id) {
  if (!state.user) { openAuthModal('Inicia sesión para guardar tus ofertas favoritas.'); return; }
  const adding = !state.saved.has(id);
  if (adding) state.saved.add(id); else state.saved.delete(id);
  if (window.Cloud) (adding ? Cloud.saveDiscount(id) : Cloud.unsaveDiscount(id));
  if (state.view === 'descuentos') renderDiscounts();
}

// ---------------------------------------------------------------------------
// Cuenta / autenticación (Supabase, opcional)
// ---------------------------------------------------------------------------
function updateAccountBtn() {
  const btn = document.getElementById('account-btn');
  btn.classList.toggle('is-logged', !!state.user);
}

function openAuthModal(message) {
  const body = document.getElementById('auth-body');
  if (!window.Cloud || !Cloud.enabled) {
    body.innerHTML =
      `<h3 id="auth-title">Cuentas no configuradas</h3>` +
      `<p class="auth-msg">El inicio de sesión todavía no está activo. Cuando se configure Supabase ` +
      `podrás guardar tus favoritos y ofertas en la nube y sincronizarlos entre dispositivos.</p>`;
  } else if (state.user) {
    body.innerHTML =
      `<h3 id="auth-title">Tu cuenta</h3>` +
      `<p class="auth-msg">Sesión iniciada como <b>${escapeHTML(state.user.email || '')}</b>.</p>` +
      `<button class="auth-btn" id="auth-signout" type="button">Cerrar sesión</button>`;
    document.getElementById('auth-signout').addEventListener('click', async () => {
      await Cloud.signOut();
      closeAuthModal();
    });
  } else {
    body.innerHTML =
      `<h3 id="auth-title">Entrar / Crear cuenta</h3>` +
      (message ? `<p class="auth-msg">${escapeHTML(message)}</p>` : '') +
      `<p class="auth-msg">Te enviamos un <b>enlace mágico</b> a tu email. Sin contraseñas.</p>` +
      `<form id="auth-form"><input type="email" id="auth-email" placeholder="tu@email.com" required autocomplete="email" inputmode="email" />` +
      `<button class="auth-btn" type="submit">Enviar enlace</button></form>` +
      `<p class="auth-feedback" id="auth-feedback" hidden></p>`;
    document.getElementById('auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('auth-email').value.trim();
      const fb = document.getElementById('auth-feedback');
      if (!email) return;
      fb.hidden = false; fb.textContent = 'Enviando…';
      const { error } = await Cloud.signInWithEmail(email);
      fb.textContent = error
        ? 'No se pudo enviar: ' + (error.message || 'inténtalo de nuevo')
        : '✅ Revisa tu email y abre el enlace para entrar.';
    });
  }
  document.getElementById('auth-modal').hidden = false;
}
function closeAuthModal() { document.getElementById('auth-modal').hidden = true; }

async function onUserChange(user) {
  state.user = user || null;
  updateAccountBtn();
  if (state.user && window.Cloud) {
    try {
      await Cloud.mergeFavorites([...state.favs]);      // sube los locales una vez
      const cloud = await Cloud.fetchFavorites();
      if (cloud) {
        state.favs = new Set([...state.favs, ...cloud]); // unión local + nube
        saveFavs();
        updateFavBadge();
      }
      state.saved = new Set(await Cloud.fetchSaved());
    } catch (e) { console.warn('sync de sesión', e); }
  } else {
    state.saved = new Set();
  }
  renderView(state.view);
}

async function initCloud() {
  updateAccountBtn();
  if (!window.Cloud || !Cloud.enabled) return;
  await Cloud.init();
  Cloud.onAuth((user) => { onUserChange(user); });
  if (Cloud.user) await onUserChange(Cloud.user);
}

// ---------------------------------------------------------------------------
// Hoja inferior deslizable (bottom sheet)
// ---------------------------------------------------------------------------
const sheet = document.getElementById('sheet');
const sheetHandle = document.getElementById('sheet-handle');
const sheetHead = document.getElementById('sheet-head');
let sheetState = 'peek';
let peekY = 0, fullY = 0, liveY = 0, dragging = false, startPointerY = 0, startY = 0;

function computeSheetBounds() {
  const h = sheet.offsetHeight;
  const peekVisible = sheetHandle.offsetHeight + sheetHead.offsetHeight + 6;
  peekY = Math.max(0, h - peekVisible);
  fullY = 0;
  applySheet(false);
}
function applySheet(animate) {
  sheet.classList.toggle('dragging', !animate);
  liveY = sheetState === 'full' ? fullY : peekY;
  sheet.style.setProperty('--sheet-y', liveY + 'px');
  sheet.dataset.state = sheetState;
  document.getElementById('app').dataset.sheet = sheetState; // CSS oculta el banner si 'full'
}
function setSheet(s) { sheetState = s; applySheet(true); }
function toggleSheet() { setSheet(sheetState === 'full' ? 'peek' : 'full'); }

function onPointerDown(e) {
  if (e.target.closest('.open-chip')) return; // el chip no arrastra la hoja
  dragging = true;
  startPointerY = e.clientY;
  startY = liveY;
  sheet.classList.add('dragging');
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
}
function onPointerMove(e) {
  if (!dragging) return;
  liveY = Math.max(fullY, Math.min(peekY, startY + (e.clientY - startPointerY)));
  sheet.style.setProperty('--sheet-y', liveY + 'px');
}
function onPointerUp(e) {
  if (!dragging) return;
  dragging = false;
  const moved = Math.abs(e.clientY - startPointerY);
  if (moved < 6) { toggleSheet(); return; }   // toque = alternar
  sheetState = liveY < (peekY + fullY) / 2 ? 'full' : 'peek';
  applySheet(true);
}
[sheetHandle, sheetHead].forEach((el) => el.addEventListener('pointerdown', onPointerDown));
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('pointercancel', onPointerUp);
window.addEventListener('resize', () => { computeSheetBounds(); map.invalidateSize(); });

// ---------------------------------------------------------------------------
// Carga de datos
// ---------------------------------------------------------------------------
async function loadJSON(file, fallback) {
  try {
    const res = await fetch(file, { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch (e) { console.warn(`No se pudo cargar ${file}:`, e); return fallback; }
}
async function loadAll() {
  await Promise.all([
    ...Object.entries(CATEGORIES).map(async ([cat, cfg]) => {
      state.data[cat] = await loadJSON(cfg.file, { generatedAt: null, items: [] });
    }),
    (async () => {
      const ads = await loadJSON('data/ads.json', { ads: [] });
      state.ads = Array.isArray(ads.ads) ? ads.ads : [];
    })(),
    loadDiscounts(),
  ]);
  updateFavBadge();
  renderView(state.view);
  computeSheetBounds();
}

// Ofertas: de Supabase si está configurado; si no, de data/descuentos.json.
async function loadDiscounts() {
  let list = null;
  if (window.Cloud && Cloud.enabled) {
    try { await Cloud.init(); list = await Cloud.fetchDiscounts(); } catch (e) { /* degrada */ }
  }
  if (!list) {
    const j = await loadJSON('data/descuentos.json', { discounts: [] });
    list = Array.isArray(j.discounts) ? j.discounts : [];
  }
  state.discounts = list.filter((d) => d && d.active !== false);
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------
// Delegación: corazón de favoritos, estrella de guardar oferta y copiar código.
document.addEventListener('click', (e) => {
  const fav = e.target.closest('.fav-btn');
  if (fav) { e.preventDefault(); e.stopPropagation(); toggleFav(fav.dataset.id); return; }
  const save = e.target.closest('.save-btn');
  if (save) { e.preventDefault(); e.stopPropagation(); toggleSave(save.dataset.id); return; }
  const code = e.target.closest('.disc-code');
  if (code) {
    e.preventDefault(); e.stopPropagation();
    if (navigator.clipboard) navigator.clipboard.writeText(code.dataset.code).catch(() => {});
    const prev = code.textContent; code.textContent = '¡Copiado!';
    setTimeout(() => { code.textContent = prev; }, 1200);
  }
});
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => renderView(btn.dataset.cat));
});

// Filtro "Abierto ahora"
const openToggle = document.getElementById('open-toggle');
openToggle.addEventListener('click', () => {
  state.openNow = !state.openNow;
  openToggle.classList.toggle('is-on', state.openNow);
  openToggle.setAttribute('aria-pressed', String(state.openNow));
  renderView(state.view);
});

// Filtro "★ Guardados" (vista Ofertas)
const savedToggle = document.getElementById('saved-toggle');
savedToggle.addEventListener('click', () => {
  state.savedOnly = !state.savedOnly;
  savedToggle.classList.toggle('is-on', state.savedOnly);
  savedToggle.setAttribute('aria-pressed', String(state.savedOnly));
  renderDiscounts();
});

// Cuenta / acceso
document.getElementById('account-btn').addEventListener('click', () => openAuthModal());
document.getElementById('auth-close').addEventListener('click', closeAuthModal);
document.getElementById('auth-modal').addEventListener('click', (e) => {
  if (e.target.id === 'auth-modal') closeAuthModal(); // toca fuera = cerrar
});

// Init
updateFavBadge();
computeSheetBounds();
setTimeout(() => map.invalidateSize(), 60);
loadAll();
initCloud();

// PWA: service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
