# León TOP 20 🦁

Web estática (GitHub Pages) con un mapa de **León (España)** que muestra, en burbujas, el
**TOP 20** de sitios para **TAPEAR** (bares), **CENAR** (restaurantes) y **VISITAR**
(monumentos/museos), rankeados por una puntuación que combina **valoración** y
**nº de reseñas**. UI en español. Sin gamificación.

## Arquitectura (por qué escala y no expone la API key)

Los datos **NO** se piden desde el navegador. Un **GitHub Action** (cron diario) llama a la
**Google Places API (New)**, calcula el ranking y commitea ficheros estáticos en `/data`.
La web **solo LEE** `data/*.json`. Resultado:

- La **API key nunca llega al cliente** (vive solo en GitHub Secrets).
- El **coste de API es fijo** (unas pocas llamadas al día), independiente del nº de visitas.
- La app **escala a muchos usuarios**: solo descargan JSON + teselas de un CDN.

```
/index.html  /app.js  /style.css      front-end (Leaflet 1.9, CARTO Voyager)
/scripts/build-ranking.mjs            Node 20, genera el ranking (fetch nativo, sin deps)
/data/tapeo.json  comida.json  visitar.json
/.github/workflows/ranking.yml        cron diario + commit de /data
```

## El ranking (bayesiano)

Para cada categoría se calcula una **media ponderada** estilo IMDb:

```
score = (v / (v + m)) * R  +  (m / (v + m)) * C
```

- `R` = valoración del sitio (`rating`)
- `v` = nº de reseñas (`userRatingCount`)
- `C` = media de las valoraciones del **pool** de esa categoría
- `m` = umbral de credibilidad (cuántas reseñas hacen falta para fiarse de `R`)

Esto evita que un `4.9` con 100 reseñas aplaste a un `4.5` con 1000.

### Calibración de `m`

El script incluye un **test/assert**: un sitio `A (R=4.5, v=1000)` debe puntuar **más** que
`B (R=4.9, v=100)`. Con la `C` real de León (~4.4) y `m=500` el test **falla** (gana B), así
que `m` parte de **1000** (`M_DEFAULT`) y el script **auto-calibra** subiéndolo si la `C`
concreta de una categoría aún no cumple el test. Puedes validar la matemática sin red:

```bash
node scripts/build-ranking.mjs --selftest
```

## Front-end

- Teselas **CARTO Voyager** (sin key), Leaflet 1.9 desde CDN.
- Centrado en León (`42.5987, -5.5671`), `fitBounds` a los puntos cargados.
- 3 capas: **Tapear** (dorado), **Cenar** (carmesí), **Visitar** (teal). Por defecto Tapear.
- Burbujas `L.circleMarker`: el **radio escala con el puesto** (el nº1 es el más grande) y
  cada burbuja lleva su **número de ranking** encima.
- **Popup**: nombre, ★ valoración, nº de reseñas y "Puesto #N en [categoría]".
- **Panel** con la lista del TOP 20; al tocar un item, centra y abre su burbuja.
- Muestra "Actualizado: {generatedAt}" y atribución a Google + OpenStreetMap/CARTO.
- Sin `localStorage` ni gamificación.

> Los ficheros de `/data` incluidos en el repo son **datos de muestra** para que la web
> funcione desde el primer momento. El cron diario los sustituye por datos reales.

## Puesta en marcha

### 1. Crear la API key (Google Cloud)

1. Crea un proyecto en [Google Cloud Console](https://console.cloud.google.com/).
2. Habilita **Places API (New)** y crea una **API key**.
3. **Restricciones de la key** (importante):
   - **API restrictions** → limita la key **solo** a *Places API (New)*.
   - Pon un **tope de cuota diaria** (Quotas) para evitar sustos en la factura.
   - No hace falta restricción por dominio/IP porque la key se usa **server-side** en el
     Action; nunca se expone al navegador.

### 2. Guardar la key como secret

En el repo: **Settings → Secrets and variables → Actions → New repository secret**
- Nombre: `GOOGLE_MAPS_API_KEY`
- Valor: tu API key

> ⚠️ **SEGURIDAD:** la API key va **SOLO** en GitHub Secrets. **Nunca** en `index.html`,
> `app.js` ni en ningún fichero del cliente. El navegador jamás la ve.

### 3. Activar GitHub Pages

**Settings → Pages → Build and deployment → Source: _Deploy from a branch_**
- Branch: **`main`** · carpeta: **`/ (root)`** · *Save*.

La web quedará publicada en `https://<usuario>.github.io/<repo>/`.

### 4. Generar el ranking

- Automático: el workflow corre cada día a las **04:00 UTC** (`cron "0 4 * * *"`).
- Manual: **Actions → Build ranking → Run workflow** (`workflow_dispatch`).

El Action ejecuta `node scripts/build-ranking.mjs`, y si `/data` cambió, hace commit y push
con el bot `github-actions[bot]`.

## Ejecutar el script en local

```bash
export GOOGLE_MAPS_API_KEY="tu_key"
node scripts/build-ranking.mjs
```

(Requiere **Node 20+**; usa `fetch` nativo y no tiene dependencias.)

## Servir la web en local

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```
