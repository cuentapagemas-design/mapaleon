/* León TOP 20 — front-end. Solo LEE /data/*.json (sin API key, sin localStorage). */
'use strict';

const CATEGORIES = {
  tapeo:   { label: 'Tapear',  file: 'data/tapeo.json',   color: '#d4a017' },
  comida:  { label: 'Cenar',   file: 'data/comida.json',  color: '#b3123b' },
  visitar: { label: 'Visitar', file: 'data/visitar.json', color: '#1aa7a0' },
};

const LEON_CENTER = [42.5987, -5.5671];

// Estado.
const state = {
  active: 'tapeo',
  data: {},            // cat -> { generatedAt, items }
  markers: {},         // rank -> circleMarker
  labels: {},          // rank -> label marker
  layer: L.layerGroup(),
};

// Mapa base CARTO Voyager (sin key).
const map = L.map('map', { center: LEON_CENTER, zoom: 14, zoomControl: true });
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: 'abcd',
  maxZoom: 20,
}).addTo(map);
state.layer.addTo(map);

// El radio escala con el puesto: el nº1 es el más grande.
function radiusForRank(rank, total) {
  const maxR = 26;
  const minR = 10;
  if (total <= 1) return maxR;
  return maxR - ((rank - 1) / (total - 1)) * (maxR - minR);
}

function starsText(rating) {
  return `<span class="star">★</span> ${rating.toFixed(1)}`;
}

function popupHTML(item, catLabel) {
  return (
    `<div class="popup-name">${escapeHTML(item.name)}</div>` +
    `<div class="popup-meta">${starsText(item.rating)} · ${item.reviews.toLocaleString('es-ES')} reseñas</div>` +
    `<div class="popup-rank">Puesto #${item.rank} en ${catLabel}</div>`
  );
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function renderCategory(cat) {
  state.active = cat;
  const { label, color } = CATEGORIES[cat];
  const payload = state.data[cat];

  // Botones.
  document.querySelectorAll('.layer-btn').forEach((b) =>
    b.classList.toggle('is-active', b.dataset.cat === cat)
  );

  // Cabecera del panel.
  document.getElementById('panel-title').textContent = label;
  const updatedEl = document.getElementById('updated');
  if (payload && payload.generatedAt) {
    const d = new Date(payload.generatedAt);
    updatedEl.textContent = 'Actualizado: ' + d.toLocaleString('es-ES', {
      dateStyle: 'long', timeStyle: 'short',
    });
  } else {
    updatedEl.textContent = '';
  }

  // Limpia capa y caches.
  state.layer.clearLayers();
  state.markers = {};
  state.labels = {};

  const list = document.getElementById('ranking-list');
  list.innerHTML = '';

  const items = (payload && payload.items) || [];
  if (items.length === 0) {
    list.innerHTML = '<li style="padding:1rem;color:#6c6760">Sin datos todavía. ' +
      'El ranking se genera a diario mediante GitHub Actions.</li>';
    return;
  }

  const total = items.length;
  const latlngs = [];

  for (const item of items) {
    const r = radiusForRank(item.rank, total);
    const latlng = [item.lat, item.lng];
    latlngs.push(latlng);

    const marker = L.circleMarker(latlng, {
      radius: r,
      color: '#ffffff',
      weight: 2,
      fillColor: color,
      fillOpacity: 0.85,
    });
    marker.bindPopup(popupHTML(item, label));
    marker.on('click', () => selectItem(item.rank, false));
    marker.addTo(state.layer);

    // Número de ranking encima de la burbuja.
    const label2 = L.marker(latlng, {
      icon: L.divIcon({
        className: 'bubble-label',
        html: `<span style="width:${r * 2}px">${item.rank}</span>`,
        iconSize: [r * 2, 0],
        iconAnchor: [r, 6],
      }),
      interactive: false,
      keyboard: false,
    });
    label2.addTo(state.layer);

    state.markers[item.rank] = marker;
    state.labels[item.rank] = label2;

    // Item de la lista.
    const li = document.createElement('li');
    li.className = 'rank-item';
    li.style.color = color;
    li.style.setProperty('--cat-color', color);
    li.dataset.rank = String(item.rank);
    li.innerHTML =
      `<div class="rank-num">${item.rank}</div>` +
      `<div><div class="rank-name">${escapeHTML(item.name)}</div>` +
      `<div class="rank-meta">${starsText(item.rating)} · ${item.reviews.toLocaleString('es-ES')} reseñas</div></div>` +
      `<div class="rank-score">${item.score.toFixed(2)}</div>`;
    li.addEventListener('click', () => selectItem(item.rank, true));
    list.appendChild(li);
  }

  // Encuadra a los puntos cargados.
  if (latlngs.length) {
    map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 16 });
  }
}

// Centra y abre la burbuja de un item; resalta su fila.
function selectItem(rank, pan) {
  const marker = state.markers[rank];
  if (!marker) return;
  if (pan) map.panTo(marker.getLatLng());
  marker.openPopup();

  document.querySelectorAll('.rank-item').forEach((el) =>
    el.classList.toggle('is-selected', el.dataset.rank === String(rank))
  );
}

async function loadAll() {
  await Promise.all(
    Object.entries(CATEGORIES).map(async ([cat, cfg]) => {
      try {
        const res = await fetch(cfg.file, { cache: 'no-cache' });
        if (!res.ok) throw new Error(res.status);
        state.data[cat] = await res.json();
      } catch (e) {
        console.warn(`No se pudo cargar ${cfg.file}:`, e);
        state.data[cat] = { generatedAt: null, items: [] };
      }
    })
  );
  renderCategory(state.active);
}

// Botones de capa.
document.querySelectorAll('.layer-btn').forEach((btn) => {
  btn.addEventListener('click', () => renderCategory(btn.dataset.cat));
});

loadAll();
