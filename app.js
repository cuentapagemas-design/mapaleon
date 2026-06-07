/* León TOP 20 — front-end. Solo LEE /data/*.json.
   Favoritos: en localStorage (por dispositivo). Anuncios: desde data/ads.json. */
'use strict';

const CATEGORIES = {
  tapeo:   { label: 'Tapear',  file: 'data/tapeo.json',   color: '#d4a017' },
  comida:  { label: 'Cenar',   file: 'data/comida.json',  color: '#b3123b' },
  visitar: { label: 'Visitar', file: 'data/visitar.json', color: '#6b2c8f' },
};

const FAVS_KEY = 'leon-favs-v1';
const FAV_COLOR = '#e6a700';
const LEON_CENTER = [42.5987, -5.5671];
const BANNER_ROTATE_MS = 7000;

// Estado.
const state = {
  view: 'tapeo',       // 'tapeo' | 'comida' | 'visitar' | 'favoritos'
  data: {},            // cat -> { generatedAt, items }
  ads: [],             // lista de anuncios (data/ads.json)
  markers: {},         // pos -> circleMarker
  favs: loadFavs(),    // Set de place id
  layer: L.layerGroup(),
  bannerTimer: null,
};

// ---------------------------------------------------------------------------
// Favoritos (localStorage, por dispositivo)
// ---------------------------------------------------------------------------
function loadFavs() {
  try {
    const a = JSON.parse(localStorage.getItem(FAVS_KEY) || '[]');
    return new Set(Array.isArray(a) ? a : []);
  } catch {
    return new Set();
  }
}
function saveFavs() {
  try {
    localStorage.setItem(FAVS_KEY, JSON.stringify([...state.favs]));
  } catch { /* almacenamiento no disponible: degradación silenciosa */ }
}
function isFav(id) { return state.favs.has(id); }
function toggleFav(id) {
  if (state.favs.has(id)) state.favs.delete(id);
  else state.favs.add(id);
  saveFavs();
  updateFavButton();
  if (state.view === 'favoritos') {
    renderView('favoritos');   // re-render: la lista cambia
  } else {
    refreshHearts();           // solo actualiza los corazones visibles
  }
}
function updateFavButton() {
  const n = state.favs.size;
  document.getElementById('fav-btn').textContent = n ? `★ Favoritos (${n})` : '★ Favoritos';
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
// Mapa base CARTO Voyager (sin key)
// ---------------------------------------------------------------------------
const map = L.map('map', { center: LEON_CENTER, zoom: 14, zoomControl: true });
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: 'abcd',
  maxZoom: 20,
}).addTo(map);
state.layer.addTo(map);

// ---------------------------------------------------------------------------
// Utilidades de render
// ---------------------------------------------------------------------------
function radiusForPos(pos, total) {
  const maxR = 26, minR = 10;
  if (total <= 1) return maxR;
  return maxR - ((pos - 1) / (total - 1)) * (maxR - minR);
}
function starsText(rating) {
  return `<span class="star">★</span> ${rating.toFixed(1)}`;
}
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
function heartHTML(id) {
  const on = isFav(id);
  return (
    `<button class="fav-btn${on ? ' is-fav' : ''}" type="button" data-id="${escapeHTML(id)}" ` +
    `aria-pressed="${on}" aria-label="${on ? 'Quitar de favoritos' : 'Añadir a favoritos'}">` +
    `${on ? '♥' : '♡'}</button>`
  );
}
function popupHTML(entry) {
  const it = entry.item;
  return (
    `<div class="popup-head"><div class="popup-name">${escapeHTML(it.name)}</div>${heartHTML(it.id)}</div>` +
    `<div class="popup-meta">${starsText(it.rating)} · ${it.reviews.toLocaleString('es-ES')} reseñas</div>` +
    `<div class="popup-rank">Puesto #${it.rank} en ${entry.catLabel}</div>`
  );
}

// Devuelve las "entradas" {item, color, catLabel, cat} a pintar para una vista.
function entriesForView(view) {
  if (CATEGORIES[view]) {
    const { color, label } = CATEGORIES[view];
    const items = (state.data[view] && state.data[view].items) || [];
    return items.map((item) => ({ item, color, catLabel: label, cat: view }));
  }
  // favoritos: agrega los marcados de todas las categorías, ordenados por score.
  const out = [];
  for (const [cat, cfg] of Object.entries(CATEGORIES)) {
    const items = (state.data[cat] && state.data[cat].items) || [];
    for (const item of items) {
      if (isFav(item.id)) out.push({ item, color: cfg.color, catLabel: cfg.label, cat });
    }
  }
  out.sort((a, b) => b.item.score - a.item.score);
  return out;
}

// ---------------------------------------------------------------------------
// Render principal de una vista
// ---------------------------------------------------------------------------
function renderView(view) {
  state.view = view;
  const isFavView = view === 'favoritos';

  // Botones.
  document.querySelectorAll('.layer-btn').forEach((b) =>
    b.classList.toggle('is-active', b.dataset.cat === view)
  );

  // Cabecera del panel.
  document.getElementById('panel-title').textContent = isFavView
    ? '★ Favoritos'
    : CATEGORIES[view].label;

  const updatedEl = document.getElementById('updated');
  if (isFavView) {
    const n = state.favs.size;
    updatedEl.textContent = n
      ? `${n} ${n === 1 ? 'sitio guardado' : 'sitios guardados'} en este dispositivo`
      : '';
  } else {
    const payload = state.data[view];
    if (payload && payload.generatedAt) {
      updatedEl.textContent = 'Actualizado: ' + new Date(payload.generatedAt).toLocaleString('es-ES', {
        dateStyle: 'long', timeStyle: 'short',
      });
    } else {
      updatedEl.textContent = '';
    }
  }

  // Limpia mapa y lista.
  state.layer.clearLayers();
  state.markers = {};
  const list = document.getElementById('ranking-list');
  list.innerHTML = '';

  // Anuncio "Patrocinado" fijado arriba de la lista (placement "list").
  renderSponsored(view, list);

  const entries = entriesForView(view);

  if (entries.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = isFavView
      ? 'No tienes favoritos todavía. Toca el corazón ♡ de un sitio para guardarlo aquí.'
      : 'Sin datos todavía. El ranking se genera a diario mediante GitHub Actions.';
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
      radius: r,
      color: '#ffffff',
      weight: 2,
      fillColor: color,
      fillOpacity: 0.85,
    });
    marker.bindPopup(popupHTML(entry));
    marker.on('click', () => selectPos(pos, false));
    marker.addTo(state.layer);

    // Número encima de la burbuja (posición en la vista actual).
    L.marker(latlng, {
      icon: L.divIcon({
        className: 'bubble-label',
        html: `<span style="width:${r * 2}px">${pos}</span>`,
        iconSize: [r * 2, 0],
        iconAnchor: [r, 6],
      }),
      interactive: false,
      keyboard: false,
    }).addTo(state.layer);

    state.markers[pos] = marker;

    // Item de la lista.
    const li = document.createElement('li');
    li.className = 'rank-item';
    li.style.color = color;
    li.style.setProperty('--cat-color', color);
    li.dataset.pos = String(pos);
    const catTag = isFavView ? `<span class="cat-tag">${catLabel}</span>` : '';
    li.innerHTML =
      `<div class="rank-num">${pos}</div>` +
      `<div><div class="rank-name">${escapeHTML(item.name)} ${catTag}</div>` +
      `<div class="rank-meta">${starsText(item.rating)} · ${item.reviews.toLocaleString('es-ES')} reseñas</div></div>` +
      `<div class="rank-score">${item.score.toFixed(2)}</div>` +
      heartHTML(item.id);
    li.addEventListener('click', (e) => {
      if (e.target.closest('.fav-btn')) return; // el corazón se gestiona aparte
      selectPos(pos, true);
    });
    list.appendChild(li);
  });

  if (latlngs.length) {
    map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 16 });
  }

  renderBanner(view);
}

// Centra y abre la burbuja de una posición; resalta su fila.
function selectPos(pos, pan) {
  const marker = state.markers[pos];
  if (!marker) return;
  if (pan) map.panTo(marker.getLatLng());
  marker.openPopup();
  document.querySelectorAll('.rank-item').forEach((el) =>
    el.classList.toggle('is-selected', el.dataset.pos === String(pos))
  );
}

// ---------------------------------------------------------------------------
// Anuncios (data/ads.json) — degradación limpia si no hay activos
// ---------------------------------------------------------------------------
function adApplies(ad, view) {
  const cats = ad.categories;
  if (!Array.isArray(cats) || cats.length === 0) return true; // vacío = todas
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
  return state.ads.filter(
    (a) => a && a.placement === placement && adLive(a, now) && adApplies(a, view)
  );
}
function weightedPick(ads) {
  const total = ads.reduce((s, a) => s + Math.max(0, Number(a.weight) || 0), 0);
  if (total <= 0) return ads[Math.floor(Math.random() * ads.length)];
  let r = Math.random() * total;
  for (const a of ads) {
    r -= Math.max(0, Number(a.weight) || 0);
    if (r <= 0) return a;
  }
  return ads[ads.length - 1];
}

function bannerHTML(ad) {
  const img = ad.imageUrl
    ? `<img class="ad-img" src="${escapeHTML(ad.imageUrl)}" alt="" loading="lazy">`
    : '';
  return (
    `<a class="ad-banner-link" href="${escapeHTML(ad.linkUrl)}" target="_blank" rel="noopener nofollow sponsored">` +
    `<span class="ad-tag">Publicidad</span>${img}` +
    `<span class="ad-text"><span class="ad-title">${escapeHTML(ad.title)}</span>` +
    `<span class="ad-body">${escapeHTML(ad.body || '')}</span></span></a>`
  );
}

function renderBanner(view) {
  if (state.bannerTimer) { clearInterval(state.bannerTimer); state.bannerTimer = null; }
  const el = document.getElementById('ad-banner');
  const ads = eligibleAds('banner', view);
  if (ads.length === 0) {            // sin anuncios → sin hueco
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  const show = () => { el.innerHTML = bannerHTML(weightedPick(ads)); el.hidden = false; };
  show();
  if (ads.length > 1) {
    state.bannerTimer = setInterval(show, BANNER_ROTATE_MS); // rotación ponderada por weight
  }
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
    `<div class="rank-meta">${escapeHTML(ad.body || '')}</div></div>` +
    `<div></div><div></div>`;
  li.addEventListener('click', () => window.open(ad.linkUrl, '_blank', 'noopener'));
  list.appendChild(li);
}

// ---------------------------------------------------------------------------
// Carga de datos
// ---------------------------------------------------------------------------
async function loadJSON(file, fallback) {
  try {
    const res = await fetch(file, { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch (e) {
    console.warn(`No se pudo cargar ${file}:`, e);
    return fallback;
  }
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
  ]);
  updateFavButton();
  renderView(state.view);
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------
// Corazón (delegado): funciona tanto en popups como en la lista.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.fav-btn');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  toggleFav(btn.dataset.id);
});

// Botones de capa / vista.
document.querySelectorAll('.layer-btn').forEach((btn) => {
  btn.addEventListener('click', () => renderView(btn.dataset.cat));
});

updateFavButton();
loadAll();
