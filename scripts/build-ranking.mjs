#!/usr/bin/env node
// @ts-check
/**
 * build-ranking.mjs — genera el TOP 20 de TAPEAR, CENAR y VISITAR en León (España).
 *
 * Node 20+, fetch nativo, SIN dependencias.
 *
 * Arquitectura (clave): este script se ejecuta en un GitHub Action (cron diario),
 * NO en el navegador. Llama a Google Places API (New), calcula un ranking bayesiano
 * y escribe ficheros estáticos en /data. La web solo LEE esos JSON, así la API key
 * nunca se expone al cliente y el coste de API es fijo aunque escale a muchos usuarios.
 *
 * Uso:
 *   GOOGLE_MAPS_API_KEY=... node scripts/build-ranking.mjs
 *   node scripts/build-ranking.mjs --selftest   (solo valida la calibración, sin red)
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'data');

// ---------------------------------------------------------------------------
// Configuración geográfica: bounding box de la ciudad de León.
// ---------------------------------------------------------------------------
const BBOX = {
  low: { latitude: 42.560, longitude: -5.610 },
  high: { latitude: 42.625, longitude: -5.535 },
};

const MIN_REVIEWS = 20;     // descartamos sitios con < 20 reseñas (ruido)
const TOP_N = 20;           // TOP 20 por categoría

// ---------------------------------------------------------------------------
// RANKING BAYESIANO (media ponderada / "True Bayesian estimate", estilo IMDb):
//
//     score = (v / (v + m)) * R  +  (m / (v + m)) * C
//
//   v = nº de reseñas (userRatingCount)
//   R = valoración media del sitio (rating)
//   C = media de las valoraciones del pool de esa categoría (se calcula en runtime)
//   m = umbral de credibilidad (cuántas reseñas hacen falta para "fiarse" de R)
//
// Intuición: un sitio con pocas reseñas se "tira" hacia la media C; cuanto más
// reseñas, más pesa su R real. Así un 4.9 con 100 reseñas no aplasta a un 4.5
// con 1000 reseñas.
//
// CALIBRACIÓN DE m
// ----------------
// Requisito de diseño: un sitio A (R=4.5, v=1000) debe puntuar MÁS que uno
// B (R=4.9, v=100). La diferencia es:
//
//   score(A) - score(B) = w_A*(R_A - C) - w_B*(R_B - C),
//   con w = v/(v+m).
//
// Con la C real del pool (en León ~4.3–4.4 para tapas/restaurantes) y m=500,
// el test FALLA: por ejemplo con C=4.4, score(A)=4.467 < score(B)=4.483, gana B.
// Subiendo m damos más peso al volumen de reseñas; el cociente w_A/w_B crece
// con m (hacia 10 en el límite), de modo que un m mayor hace ganar a A.
// Calibrando contra C≈4.4 hace falta m>800, así que partimos de m=1000.
//
// Como C real no se conoce hasta tener el pool, el script AUTO-CALIBRA: si con
// el m por defecto el test no se cumple para la C concreta de una categoría,
// sube m hasta cumplirlo (o avisa si es matemáticamente imposible, lo que ocurre
// solo si C está pegadísima a 4.5). Ver calibrateM().
// ---------------------------------------------------------------------------
export const M_DEFAULT = 1000; // umbral de credibilidad calibrado (ver arriba)

/** Estimación bayesiana de la puntuación. */
export function bayesianScore(R, v, C, m) {
  return (v / (v + m)) * R + (m / (v + m)) * C;
}

/**
 * El test de calibración: A(4.5, 1000) debe puntuar más que B(4.9, 100).
 * Devuelve true si se cumple con la C y m dados.
 */
export function calibrationHolds(C, m) {
  const a = bayesianScore(4.5, 1000, C, m);
  const b = bayesianScore(4.9, 100, C, m);
  return a > b;
}

/**
 * Devuelve un m >= mStart que cumpla el test de calibración para la C dada.
 * Si subiendo m no se logra (C demasiado cerca de 4.5), devuelve null.
 */
export function calibrateM(C, mStart = M_DEFAULT) {
  let m = mStart;
  for (let i = 0; i < 1000; i++) {
    if (calibrationHolds(C, m)) return m;
    m += 100;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Consultas Text Search por categoría (varias para ampliar el pool; luego dedup).
// ---------------------------------------------------------------------------
const QUERIES = {
  tapeo: ['bares de tapas en León', 'tabernas León', 'bar de pinchos León'],
  comida: ['restaurantes para cenar en León', 'asador León', 'cocina leonesa restaurante'],
  visitar: ['qué visitar en León', 'monumentos León', 'museos León'],
};

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.formattedAddress',
  'places.primaryType',
  'places.regularOpeningHours', // horario semanal (para "abierto ahora" y la ficha)
  'places.utcOffsetMinutes',    // desfase UTC del sitio (para su hora local)
  // ---- Datos para la ficha de sitio (se bajan 1 vez/día, sin coste por usuario) ----
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.priceLevel',
  'places.editorialSummary',    // (quítalo para bajar de SKU "Atmosphere" a "Enterprise")
  'nextPageToken',
].join(',');

// priceLevel (enum de Google) → número 0..4
const PRICE_MAP = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

/** Extrae los datos extra de la ficha de un place. */
function parseExtras(p) {
  return {
    address: p.formattedAddress || null,
    phone: p.nationalPhoneNumber || null,
    web: p.websiteUri || null,
    maps: p.googleMapsUri || null,
    price: (p.priceLevel && p.priceLevel in PRICE_MAP) ? PRICE_MAP[p.priceLevel] : null,
    summary: (p.editorialSummary && p.editorialSummary.text) || null,
    type: p.primaryType || null,
    // Horario legible de la semana (cadenas localizadas de Google).
    week: Array.isArray(p.regularOpeningHours && p.regularOpeningHours.weekdayDescriptions)
      ? p.regularOpeningHours.weekdayDescriptions : null,
  };
}

/**
 * Llama a Places API (New) Text Search, paginando con nextPageToken (máx ~60).
 * @returns {Promise<Array<object>>} lista de places crudos.
 */
async function textSearch(textQuery, apiKey) {
  const out = [];
  let pageToken = undefined;

  do {
    const body = {
      textQuery,
      languageCode: 'es',
      regionCode: 'ES',
      locationRestriction: { rectangle: { low: BBOX.low, high: BBOX.high } },
    };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Places API ${res.status} para "${textQuery}": ${txt}`);
    }

    const json = await res.json();
    if (Array.isArray(json.places)) out.push(...json.places);

    pageToken = json.nextPageToken;
    // La nueva API admite usar el token de inmediato, pero damos un respiro.
    if (pageToken) await new Promise((r) => setTimeout(r, 1500));
  } while (pageToken && out.length < 60);

  return out;
}

/** ¿Está el punto dentro del bbox de León? */
function inBBox(lat, lng) {
  return (
    lat >= BBOX.low.latitude &&
    lat <= BBOX.high.latitude &&
    lng >= BBOX.low.longitude &&
    lng <= BBOX.high.longitude
  );
}

const WEEK_MIN = 7 * 24 * 60; // 10080

/**
 * Convierte regularOpeningHours de Places API (New) en intervalos compactos
 * en "minutos de la semana" (día*1440 + hora*60 + min; día 0 = domingo).
 * Devuelve { tz, hours } donde:
 *   - hours = null            → horario desconocido
 *   - hours = [[ini,fin], …]  → intervalos (fin puede superar 10080 si cruza medianoche)
 *   - 24h se representa como [[0, 10080]]
 * Así el navegador solo compara la hora actual con estos intervalos (sin más API).
 */
function parseHours(place) {
  const tz = typeof place.utcOffsetMinutes === 'number' ? place.utcOffsetMinutes : null;
  const roh = place.regularOpeningHours;
  if (!roh || !Array.isArray(roh.periods) || roh.periods.length === 0) {
    return { tz, hours: null };
  }
  const intervals = [];
  for (const p of roh.periods) {
    if (!p || !p.open) continue;
    // 24 horas: un periodo "open" sin "close".
    if (!p.close) return { tz, hours: [[0, WEEK_MIN]] };
    const start = p.open.day * 1440 + (p.open.hour || 0) * 60 + (p.open.minute || 0);
    let end = p.close.day * 1440 + (p.close.hour || 0) * 60 + (p.close.minute || 0);
    if (end <= start) end += WEEK_MIN; // cruza medianoche / fin de semana
    intervals.push([start, end]);
  }
  return { tz, hours: intervals.length ? intervals : null };
}

/**
 * Construye el ranking de una categoría a partir de su pool de places.
 * @returns {{ generatedAt: string, items: Array<object> }}
 */
function buildCategory(rawPlaces) {
  // Dedup por place id.
  const byId = new Map();
  for (const p of rawPlaces) {
    if (!p || !p.id) continue;
    if (!byId.has(p.id)) byId.set(p.id, p);
  }

  // Normaliza y filtra: dentro del bbox y con userRatingCount >= MIN_REVIEWS.
  const pool = [];
  for (const p of byId.values()) {
    const lat = p.location?.latitude;
    const lng = p.location?.longitude;
    const rating = p.rating;
    const reviews = p.userRatingCount;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    if (typeof rating !== 'number' || typeof reviews !== 'number') continue;
    if (reviews < MIN_REVIEWS) continue;
    if (!inBBox(lat, lng)) continue;
    const { tz, hours } = parseHours(p);
    pool.push({
      id: p.id,
      name: p.displayName?.text ?? '(sin nombre)',
      lat,
      lng,
      rating,
      reviews,
      tz,
      hours,
      ...parseExtras(p),
    });
  }

  if (pool.length === 0) {
    return { generatedAt: new Date().toISOString(), items: [] };
  }

  // C = media de las valoraciones del pool de esta categoría.
  const C = pool.reduce((s, x) => s + x.rating, 0) / pool.length;

  // Calibra m para que el test (A > B) se cumpla con esta C concreta.
  const m = calibrateM(C, M_DEFAULT);
  if (m === null) {
    // Solo ocurre si C está pegadísima a 4.5; usamos el default y avisamos.
    console.warn(`⚠️  No se pudo calibrar m para C=${C.toFixed(3)}; uso m=${M_DEFAULT}.`);
  }
  const mUsed = m ?? M_DEFAULT;
  if (mUsed !== M_DEFAULT) {
    console.log(`   calibración: C=${C.toFixed(3)} → m=${mUsed} (subido desde ${M_DEFAULT})`);
  } else {
    console.log(`   calibración: C=${C.toFixed(3)} → m=${mUsed}`);
  }

  // Puntúa, ordena desc y toma TOP 20.
  const ranked = pool
    .map((x) => ({ ...x, score: bayesianScore(x.rating, x.reviews, C, mUsed) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N)
    .map((x, i) => ({
      rank: i + 1,
      id: x.id,
      name: x.name,
      lat: x.lat,
      lng: x.lng,
      rating: x.rating,
      reviews: x.reviews,
      score: Number(x.score.toFixed(4)),
      tz: x.tz,
      hours: x.hours,
      price: x.price,
      type: x.type,
      address: x.address,
      phone: x.phone,
      web: x.web,
      maps: x.maps,
      summary: x.summary,
      week: x.week,
    }));

  return { generatedAt: new Date().toISOString(), items: ranked };
}

/** Recoge el pool de una categoría lanzando todas sus consultas. */
async function fetchCategory(name, apiKey) {
  console.log(`▶ ${name}: ${QUERIES[name].length} consultas…`);
  const all = [];
  for (const q of QUERIES[name]) {
    const places = await textSearch(q, apiKey);
    console.log(`   "${q}" → ${places.length} resultados`);
    all.push(...places);
  }
  return all;
}

// ---------------------------------------------------------------------------
// Self-test de la calibración (sin red): valida la matemática del ranking.
// ---------------------------------------------------------------------------
function selfTest() {
  // Con una C representativa del pool de León (~4.4), el m calibrado debe hacer
  // que A(4.5, 1000) gane a B(4.9, 100).
  const C = 4.4;
  const m = calibrateM(C, M_DEFAULT);
  if (m === null) throw new Error('Self-test: imposible calibrar para C=4.4');
  const a = bayesianScore(4.5, 1000, C, m);
  const b = bayesianScore(4.9, 100, C, m);
  console.log(`Self-test C=${C}: m=${m}  score(A=4.5,1000)=${a.toFixed(4)}  score(B=4.9,100)=${b.toFixed(4)}`);
  if (!(a > b)) throw new Error('Self-test FALLÓ: A no supera a B');
  // Confirmamos también que el m=500 original NO cumplía (de ahí la calibración).
  if (calibrationHolds(C, 500)) {
    console.warn('Nota: con C=4.4 el test ya se cumpliría con m=500 (revisa la calibración).');
  } else {
    console.log('Confirmado: con m=500 el test NO se cumple → por eso M_DEFAULT=1000.');
  }
  console.log('✅ Self-test OK');
}

async function main() {
  if (process.argv.includes('--selftest')) {
    selfTest();
    return;
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error('❌ Falta GOOGLE_MAPS_API_KEY en el entorno.');
    process.exit(1);
  }

  // Validamos la matemática antes de gastar cuota de API.
  selfTest();

  await mkdir(DATA_DIR, { recursive: true });

  const categories = [
    ['tapeo', 'tapeo.json'],
    ['comida', 'comida.json'],
    ['visitar', 'visitar.json'],
  ];

  for (const [name, file] of categories) {
    const raw = await fetchCategory(name, apiKey);
    const result = buildCategory(raw);
    const path = resolve(DATA_DIR, file);
    await writeFile(path, JSON.stringify(result, null, 2) + '\n', 'utf8');
    console.log(`✔ ${file}: ${result.items.length} sitios (de un pool de ${
      new Set(raw.map((p) => p?.id).filter(Boolean)).size
    } únicos)`);
  }

  console.log('🏁 Listo.');
}

// Solo ejecuta main() cuando se invoca como script (no al importarlo como módulo).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
