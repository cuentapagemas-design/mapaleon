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

## Dulce (con temporada)

Categoría **Dulce** = confiterías, pastelerías, **heladerías** y **churrerías/chocolaterías**
(consultas propias en el cron → `data/dulce.json`). Cada sitio lleva un campo `season` que el
cron deduce por tipo/nombre:

- **`season: 'summer'`** (heladerías, `ice_cream_shop`): **fuera de verano** (configurable:
  abril–octubre, `SEASON_MONTHS` en `app.js`) se tratan como **cerradas** → muestran
  **"🍦 Solo en verano"** y el filtro "Abierto ahora" (y el Sorpréndeme con ese filtro) las
  oculta. En verano salen como **"🍦 De temporada"**.
- **`season: 'winter'`** (churrerías/chocolaterías, `chocolate_shop`/"churrería"): **abiertas
  todo el año**, pero en **invierno** (nov–mar) se destacan con **"🍫 Ideal en invierno"**.
- Confiterías y pastelerías: sin temporada, todo el año.

## Solo CIUDAD de León (no provincia)

La búsqueda se acota con un rectángulo en la API y, **además**, en código se descarta todo lo
que esté a más de **`MAX_RADIUS_KM` (3,5 km) del centro** de la ciudad (Haversine). Así se
evita colar sitios de la **provincia** (p. ej. asadores famosos en pueblos a 30–40 km que se
anuncian "en León"). Ajusta el radio en `scripts/build-ranking.mjs`.

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

## "Abierto ahora" (sin peticiones extra)

Filtro tipo Google para ver solo lo que está **abierto en este momento**, resuelto **sin
peticiones por usuario**:
- El **cron** pide el horario una vez al día (campos `places.regularOpeningHours` y
  `places.utcOffsetMinutes` en el mismo `searchText`, **no** hay llamadas extra) y guarda en
  cada item un horario **compacto**: `tz` (desfase UTC) y `hours` = intervalos en "minutos de
  la semana" (`[[inicio,fin], …]`; 24 h = `[[0,10080]]`; `null` = desconocido).
- El **navegador** calcula abierto/cerrado comparando la hora actual con esos intervalos. Por
  eso el coste de API es fijo (~9 peticiones/día) aunque haya miles de usuarios.
- En la app: chip **"Abierto ahora"** en la cabecera de la hoja (filtra lista y mapa) y una
  etiqueta **● Abierto · cierra HH:MM** / **● Cerrado · abre HH:MM** en cada sitio y en su popup.

## Buscar · ordenar · filtrar · ficha · descubrir (todo sin peticiones extra)

Funciones de descubrimiento, resueltas con **lógica de cliente** o con **campos que el cron
baja una vez al día** (cero llamadas a Google por usuario):

- **Buscar**: filtro de texto instantáneo por nombre (sin tildes).
- **Ordenar**: *Ranking* (por defecto), *Mejor valorados*, *Más reseñas*, *A–Z*.
- **Filtrar**: chips de **precio** (€/€€/€€€) y **Abierto ahora**. El buscador, el orden y los
  filtros afectan a la **lista y al mapa** a la vez. El nº de la burbuja siempre es el **puesto
  del TOP 20** (no cambia al reordenar).
- **Ficha de sitio** (al tocar un sitio o "Ver ficha" en el popup): valoración, precio, tipo,
  estado abierto/cerrado, descripción, **Cómo llegar / Llamar / Web**, **horario de toda la
  semana** (con el día de hoy resaltado), dirección y favorito.
- **🎲 Sorpréndeme**: ruleta **totalmente aleatoria** entre **todas las categorías** (uniforme,
  no sesgada al nº1 → salen sitios inesperados). Anima pasando nombres, se frena en uno y abre
  su ficha. Toca la ruleta para parar antes. **Respeta el presupuesto**: si has marcado chips de
  precio (€/€€/€€€) solo sortea en ese rango, y si "Abierto ahora" está activo, solo abiertos
  (avisa si no hay nada en ese presupuesto).

> 💶 **Coste:** pedir horario + contacto + descripción sube el `searchText` al SKU
> *Enterprise + Atmosphere* de Places API (New), más caro **por petición**, pero el **número de
> peticiones no cambia** (sigue siendo el cron diario, ~9/día). Para abaratar, quita
> `places.editorialSummary` del `FIELD_MASK` (baja a *Enterprise*). Mantén el tope de cuota en
> Google Cloud.

Esquema de cada item del ranking:
`{ rank, id, name, lat, lng, rating, reviews, score, tz, hours, price, type, address, phone, web, maps, summary, week }`.

## Identidad visual (León)

La estética es moderna pero con guiños a la ciudad, sin recargar:
- **León rampante** (el del blasón del antiguo Reino de León) como logo SVG y favicon, más una
  marca de agua muy sutil en el panel.
- Las **tres categorías usan los colores del blasón**: **oro** (corona) para *Tapear*,
  **carmesí** (pendón) para *Cenar* y **púrpura** (el león) para *Visitar*. Un fino **filete
  tricolor** bajo la cabecera remata el guiño.
- Wordmark "León" en serif (aire de heritage) sobre fondo piedra/marfil. Navegación con
  pastillas de categoría de alto contraste para que sea intuitiva.

## App móvil (PWA)

Está diseñada como **app móvil**, con patrón tipo mapa nativo:
- **Mapa a pantalla completa** (teselas CARTO Voyager sin key, Leaflet 1.9).
- **Hoja inferior deslizable** (bottom sheet) con la lista del TOP 20: arrástrala o toca el
  asa para desplegar/contraer. Al tocar un sitio, baja la hoja y centra su burbuja.
- **Barra de categorías inferior** (al alcance del pulgar): Tapear · Cenar · Visitar · **Dulce** · Favoritos.
- En **escritorio** se muestra centrada como un teléfono (no hay versión de escritorio aparte).

**Instalable (PWA):** incluye `manifest.webmanifest`, iconos e `sw.js` (service worker).
- En móvil: menú del navegador → **"Añadir a pantalla de inicio"**; se abre a pantalla
  completa como una app.
- El service worker cachea el *app shell* y los `/data/*.json` para arranque rápido y un
  **offline básico** (las teselas del mapa siguen necesitando red).
- Requiere **HTTPS** (GitHub Pages lo da). Las rutas son **relativas**, así funciona bajo
  el subpath `usuario.github.io/repo/`.

**Detalles de la lista/mapa:**
- Burbujas `L.circleMarker`: el **radio escala con el puesto** (el nº1 es el más grande) y
  cada burbuja lleva su **número** encima.
- **Popup**: nombre, ★ valoración, nº de reseñas, "Puesto #N en [categoría]" y corazón de favorito.
- "Actualizado: {generatedAt}" y atribución a Google + OpenStreetMap/CARTO en la hoja. Sin gamificación.

> Los ficheros de `/data` incluidos en el repo son **datos de muestra** para que la app
> funcione desde el primer momento. El cron diario los sustituye por datos reales.

## Favoritos (por dispositivo)

- Un **corazón** ♡ en el popup de cada burbuja y en cada item de la lista permite guardar sitios.
- Se persisten en `localStorage` con la clave **`leon-favs-v1`** (array de place id).
- La vista **★ Favoritos** filtra y muestra solo los sitios marcados, **de cualquier
  categoría**, sobre el mapa y en la lista.

> ⚠️ Sin cuenta, los favoritos son **POR DISPOSITIVO/NAVEGADOR** (`localStorage`). Con una
> cuenta (ver Supabase, abajo) se **sincronizan en la nube** entre dispositivos.

## Cuentas y descuentos (Supabase, opcional)

Estas funciones añaden un backend ligero **opcional** (Supabase). **Si no lo configuras, la
app sigue funcionando igual**: favoritos por dispositivo y ofertas de solo lectura desde
`data/descuentos.json`.

Qué aportan:
- **Cuentas** con **enlace mágico por email** (sin contraseñas). Botón de cuenta arriba a la derecha.
- **Favoritos en la nube**: al iniciar sesión, tus favoritos locales se suben y se sincronizan
  entre dispositivos.
- **Ofertas** (pestaña "Ofertas"): locales con descuentos. Navegables sin cuenta; con sesión
  puedes **guardarlas** (★) y filtrarlas con el chip **"★ Guardados"**.

### Puesta en marcha de Supabase
1. Crea un proyecto gratis en [supabase.com](https://supabase.com).
2. **SQL Editor → New query →** pega `supabase/schema.sql` **→ Run** (crea tablas + RLS).
3. **Authentication → Providers → Email:** deja activado el inicio por enlace mágico. En
   **Authentication → URL Configuration** pon tu **Site URL** (la de GitHub Pages) para que el
   enlace redirija bien.
4. **Project Settings → API:** copia **Project URL** y **anon public** y pégalas en **`config.js`**.
5. **Ofertas:** créalas en **Table editor → `discounts`** (o sigue usando `data/descuentos.json`).

> 🔐 **Seguridad:** la **anon key** es **pública y segura** para el navegador (la protege RLS:
> cada usuario solo accede a SUS datos). **Nunca** pongas la `service_role` key en el cliente.
> Las ofertas son de **lectura pública**; su escritura queda para el panel/`service_role`.
>
> ⚖️ **RGPD:** al haber cuentas y datos personales (email, favoritos guardados) necesitas
> **política de privacidad** y, si añades analítica, **consentimiento de cookies**.

## Anuncios (git-based, serverless)

Los anuncios viven en **`data/ads.json`** (ruta independiente del ranking: **el cron no lo
toca**). Esquema:

```jsonc
{ "updatedAt": "ISO", "ads": [{
    "id", "title", "body", "imageUrl", "linkUrl",   // linkUrl con parámetros UTM
    "placement": "banner" | "list",                 // banner inferior o item patrocinado en la lista
    "categories": ["tapeo","comida","visitar"],     // capas donde aparece; vacío = todas
    "weight": 1,                                     // prioridad en la rotación
    "start": "ISO|null", "end": "ISO|null",          // programación (solo en fechas)
    "active": true
}]}
```

**Front-end público** (`app.js`):
- Slot **banner** fijo (zona inferior del mapa) que **rota** entre los anuncios activos y en
  fecha, ponderando por `weight`. Si no hay ninguno elegible, **no se muestra hueco**.
- Item **"Patrocinado"** fijado arriba de la lista cuando hay un anuncio `placement: "list"`
  para la categoría activa.
- Los clics abren `linkUrl` en **pestaña nueva**. No hay tracking propio: la medición se hace
  por **UTM** en el destino.

### Back-office `/admin.html`

Página aparte y **serverless** para crear / editar / borrar anuncios con **vista previa en vivo**:
1. Configura **owner**, **repo** y **rama** (precargados a `cuentapagemas-design/mapaleon` / `main`).
2. Pega un **PAT fino** (ver seguridad abajo) y pulsa **Cargar anuncios actuales**.
3. Edita la lista. Al **Publicar**, el panel hace `GET` del `sha` actual de `data/ads.json` y
   luego `PUT` a la Contents API (`PUT /repos/{owner}/{repo}/contents/data/ads.json`) con el
   JSON en **base64**.
4. Tras publicar, **GitHub Pages tarda ~1 min** en propagar el cambio.

> 🔐 **Seguridad de los anuncios**
> - El **PAT** se guarda **solo en `sessionStorage`** (se borra al cerrar la pestaña).
>   **Nunca** en el código ni en `localStorage`.
> - Usa un **PAT fino (fine-grained)** con permiso **Contents: Read and write** restringido
>   **a ESTE repositorio**. Esa es la **seguridad real**.
> - La página tiene una **contraseña en JS** (`ADMIN_PASSCODE`) como **mera fricción visual**
>   para evitar aperturas accidentales — **NO es seguridad** (cualquiera puede leerla en el
>   código). Cámbiala o ponla a `''` para desactivarla.

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
