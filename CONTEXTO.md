# Castora — Contexto del proyecto

## Qué es

Castora es una herramienta web de asistencia para producción periodística de radio, streaming y podcast. El usuario pega la URL de una noticia y el sistema genera automáticamente:

- Boletín radial (título + bajadas en mayúsculas, listo para leer al aire)
- Resumen editorial (subtexto e implicancias, no descripción mecánica)
- Datos en contexto (cifras del artículo traducidas a comparaciones cotidianas)
- Ángulos alternativos (crítico, humano, inesperado)
- Posibles entrevistados (10 perfiles: expertos, voces críticas, afectados)
- Música sugerida (5 categorías: sutil, nacional, internacional, clásica, esperada)
- Videos de YouTube relacionados (búsqueda por 3 niveles de especificidad)
- Otras fuentes (cobertura del mismo hecho en otros medios)
- Columnas de opinión (columnistas reconocidos sobre el tema)
- Material para streaming (ganchos, títulos YouTube, descripción SEO, hashtags)

El sistema está pensado para ser usado por un productor/a antes de entrar al aire o preparar un episodio. Toda la respuesta llega en un único JSON al finalizar, sin streaming progresivo.

---

## Stack técnico

| Capa | Tecnología |
|---|---|
| Runtime | Node.js v24 |
| Framework | Express 4 (ES modules, `"type": "module"`) |
| IA | Anthropic claude-sonnet-4-6 vía `@anthropic-ai/sdk` |
| Búsqueda web | Claude web_search_20250305 (tool use nativo) |
| Videos | YouTube Data API v3 |
| Música | Last.fm API (tag.getTopTracks) |
| Base de datos | sql.js (SQLite en WASM, persiste en `db/castora.db`) |
| Sesiones | express-session con SqliteSessionStore custom (sin dependencias extra) |
| Autenticación | bcryptjs para hashing de contraseñas |
| Export | docx (genera .docx para el boletín) |
| Frontend | HTML + CSS + JS vanilla (sin frameworks) |
| Fuentes | Nunito Sans (Google Fonts) |

---

## Variables de entorno (.env)

```
ANTHROPIC_API_KEY=    # Clave de API de Anthropic (obligatoria)
YOUTUBE_API_KEY=      # Clave de YouTube Data API v3 (opcional, sin ella el tab Videos queda deshabilitado)
LASTFM_API_KEY=       # Clave de Last.fm API (opcional, sin ella la música no usa el pool de Last.fm)
SESSION_SECRET=       # String aleatorio para firmar cookies de sesión (obligatorio en producción)
PORT=3001             # Puerto del servidor (por defecto 3000)
```

El archivo `.env.example` en la raíz del proyecto tiene la estructura lista para copiar.

---

## Estructura de archivos

```
castora/
├── server.js                   # Entry point: Express, sesiones, rutas, auth guard
├── package.json                # Dependencias y scripts (start / dev)
├── .env                        # Variables de entorno (no commitear)
├── .env.example                # Plantilla de variables de entorno
│
├── routes/
│   ├── api.js                  # Rutas principales: /api/process, /api/history, /api/export/boletin
│   └── auth.js                 # Rutas de auth: /api/auth/register, /login, /logout, /me
│
├── services/
│   ├── anthropic.js            # Toda la lógica de IA y fetch de artículos
│   ├── youtube.js              # Búsqueda de videos con sistema de 3 niveles + scoring
│   └── lastfm.js               # Pool de tracks por mood tags para enriquecer música
│
├── db/
│   ├── database.js             # sql.js: init, users, analyses, sessions
│   └── castora.db              # Archivo SQLite generado automáticamente (no commitear)
│
└── public/
    ├── index.html              # App principal (protegida, requiere sesión)
    ├── login.html              # Pantalla de login/registro
    ├── css/
    │   └── styles.css          # Estilos completos de la app
    ├── js/
    │   ├── app.js              # Lógica del frontend principal
    │   └── auth.js             # Lógica del formulario de login
    └── images/
        └── logo_nuevo_II.png   # Logo de Castora
```

---

## Flujo de procesamiento

```
Usuario pega URL
       ↓
POST /api/process
       ↓
fetchArticle(url)
  ├─ Intento 1: fetch directo con headers de Chrome (sin API)
  └─ Intento 2 (fallback): Claude web_search para leer el artículo
       ↓
generateVideoSearchQueries(articleData)  ← extrae sustantivos propios y keywords
       ↓
Promise.allSettled([                     ← todo en paralelo
  analyzePartA(),         → boletín, resumen, contexto, ángulo
  partBPromise,           → entrevistas, música, streaming
                              ├─ getMoodTags() → tags emocionales
                              └─ getTopTracksByTags() → pool Last.fm
  searchVideos(),         → YouTube 3 niveles + scoring
  fetchOtrasFuentes(),    → Claude web_search otros medios
  fetchOpinion(),         → Claude web_search columnas de opinión
])
       ↓
Construye resultado final (null si la sección falló)
       ↓
saveAnalysis() → SQLite
       ↓
res.json({ success, id, data })
       ↓
Frontend renderiza todas las solapas
```

---

## Base de datos (SQLite)

### Tablas

**users**
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
email TEXT UNIQUE NOT NULL
password TEXT NOT NULL          -- bcrypt hash
created_at DATETIME
```

**analyses**
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
user_id INTEGER NOT NULL
url TEXT NOT NULL
title TEXT
source TEXT
result TEXT                     -- JSON stringificado del resultado completo
created_at DATETIME
```
Límite: 20 análisis por usuario (los más viejos se borran automáticamente).

**sessions**
```sql
sid TEXT PRIMARY KEY NOT NULL
sess TEXT NOT NULL              -- JSON de la sesión
expired INTEGER NOT NULL        -- timestamp Unix en ms
```

---

## API endpoints

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/check-auth` | No | Devuelve `{authenticated: true/false}`, el frontend lo usa al cargar |
| POST | `/api/process` | Sí | Procesa una URL y devuelve el análisis completo |
| GET | `/api/history` | Sí | Lista los últimos 20 análisis del usuario |
| GET | `/api/history/:id` | Sí | Devuelve un análisis guardado por ID |
| POST | `/api/export/boletin` | Sí | Genera y descarga el boletín como .docx |
| POST | `/api/auth/register` | No | Crea cuenta nueva, inicia sesión automáticamente |
| POST | `/api/auth/login` | No | Inicia sesión |
| POST | `/api/auth/logout` | No | Cierra sesión y destruye cookie |
| GET | `/api/auth/me` | No | Devuelve id y email del usuario autenticado |

---

## Lógica de IA (services/anthropic.js)

### fetchArticle(url)
Intenta obtener el contenido del artículo en dos pasos:
1. Fetch directo con headers de Chrome + timeout de 15s (sin consumir tokens)
2. Si falla o el texto es < 400 chars: usa Claude con `web_search_20250305`

### analyzePartA(articleData)
Genera boletín, resumen, contexto y ángulos en una sola llamada.
- Modelo: claude-sonnet-4-6
- max_tokens: 3500
- Prompt estructurado en español rioplatense con reglas editoriales estrictas

### analyzePartB(articleData, lastfmTracks, recentSongs)
Genera entrevistas, música y material de streaming.
- Modelo: claude-sonnet-4-6
- max_tokens: 5000
- Incluye pool de Last.fm (hasta 30 tracks) como sugerencia de música
- Incluye canciones usadas recientemente por el usuario para no repetir

### getMoodTags(articleData)
Extrae 4 tags emocionales en inglés (ej: "melancholy", "tension") para buscar en Last.fm.
- max_tokens: 150

### fetchOtrasFuentes({ title, source, url })
Busca en la web cobertura del mismo hecho en medios distintos al original.
- max_tokens: 1200, usa web_search

### fetchOpinion({ title, source })
Busca columnas de opinión firmadas sobre el tema.
- max_tokens: 1200, usa web_search
- Prioriza periodistas argentinos reconocidos

### callWithRetry(fn)
Wrapper que reintenta una vez tras 10 segundos si el error es rate_limit (HTTP 429).

---

## Lógica de YouTube (services/youtube.js)

### generateVideoSearchQueries(articleData)
Construye 3 queries de búsqueda con diferentes niveles de especificidad:
- Nivel 1: protagonistas + hecho + país + año (más específico)
- Nivel 2: protagonistas + país
- Nivel 3: sector/industria + país + año (más amplio)

### searchVideos({ levels, relevanceTerms, suggestedQuery })
Sistema de 4 niveles de fallback:
1. Busca con query nivel 1, filtra por relevanceTerms en el título
2. Si no hay resultados relevantes, prueba nivel 2
3. Si tampoco, prueba nivel 3
4. Si ninguno da resultados: devuelve `noResults: true` con link de búsqueda manual

Para los videos relevantes encontrados:
- Obtiene estadísticas (viewCount) vía YouTube API
- Asigna score según: canal prioritario (+100), nombre de canal conocido (+50), log de views (*5), términos de relevancia en el título (+30 c/u)
- Devuelve top 3

Canales con prioridad: Infobae, TN, La Nación, C5N, CNN en Español, BBC Mundo.

---

## Lógica de Last.fm (services/lastfm.js)

### getTopTracksByTags(tags)
Para cada mood tag, busca los top 15 tracks en Last.fm (`tag.getTopTracks`).
Combina los resultados de todos los tags en paralelo, deduplica por artista+canción y devuelve hasta 50 tracks con su URL de Last.fm.

---

## Frontend (public/js/app.js)

### Flujo principal
1. Al cargar: `checkAuth()` → llama `/api/check-auth`. Si 401, redirige a `/login`
2. Usuario pega URL y presiona "Interpretar"
3. Se activa animación de carga con mensajes rotativos
4. `POST /api/process` espera la respuesta JSON completa
5. Al recibir: renderiza todas las solapas, muestra la sección Boletín por defecto

### Solapas
| Tab | Contenido |
|---|---|
| Boletín | Título en mayúsculas + bajadas. Botones Copiar y Exportar (.docx) |
| Contexto | Datos del artículo traducidos a comparaciones cotidianas |
| Resumen | Síntesis editorial (4-6 líneas) |
| Entrevistas | 10 perfiles con justificación, declaración real y pregunta sugerida |
| Música | Lista con artista, canción, año, género, conexión emocional y link YouTube |
| Videos | Hasta 3 videos de YouTube con thumbnail, título y canal |
| Ángulo | 3 ángulos alternativos (crítico, humano, inesperado) |
| Streaming | Ganchos, títulos YouTube, descripción SEO, hashtags |
| Otras fuentes | Links a la misma noticia en otros medios |
| Opinión | Columnas de opinión firmadas con link directo |

### Historial
Panel lateral que muestra los últimos 20 análisis del usuario. Al hacer clic en uno, carga el resultado guardado desde la base de datos sin volver a llamar a la IA.

### Manejo de errores
Si una sección falla en el backend (Promise.allSettled), el frontend muestra "No disponible" en lugar de romper toda la respuesta. Errores conocidos se mapean a mensajes amigables en español.

---

## Autenticación

- Registro y login con email + contraseña (bcrypt, 10 rounds)
- Sesiones con express-session + SqliteSessionStore (implementación custom sobre sql.js)
- Las sesiones persisten en la base de datos SQLite y sobreviven reinicios del servidor
- Cookie httpOnly, 7 días de duración
- Guard middleware en server.js intercepta `/` y `/index.html` antes que express.static
- `/login` es la única ruta pública además de los assets

---

## Scripts

```bash
npm start       # node server.js (producción)
npm run dev     # node --watch server.js (desarrollo con auto-reload)
```

---

## Estado actual del desarrollo (marzo 2026)

### Funcional y estable
- Procesamiento completo de noticias (todas las secciones)
- Sistema de fetch directo + fallback a Claude web_search
- Generación de boletines en formato radial con reglas editoriales estrictas
- Música con 5 categorías y enriquecimiento via Last.fm
- Videos de YouTube con 3 niveles de fallback y scoring
- Otras fuentes y columnas de opinión via web_search
- Autenticación con registro/login/logout
- Sesiones persistentes en SQLite (sobreviven reinicios)
- Historial de los últimos 20 análisis por usuario
- Export del boletín a .docx
- Manejo de errores por sección (una sección que falla no rompe las demás)

### Limitaciones conocidas
- Una sola instancia de base de datos en memoria (sql.js). No escala horizontalmente.
- Rate limit de Anthropic: 30.000 tokens/min en plan actual. El sistema reintenta una vez tras 10 segundos.
- Sin paginación en el historial (máximo 20 análisis por usuario, los más viejos se borran).
- YouTube API tiene cuota diaria limitada (10.000 unidades/día en plan gratuito).

### Pendiente / posibles mejoras
- Soporte multi-idioma (actualmente solo español rioplatense)
- Modo offline / caché de análisis recientes
- Migrar sql.js a better-sqlite3 para mejor performance en escrituras frecuentes
- Panel de administración de usuarios
- Compartir análisis entre usuarios del mismo equipo
