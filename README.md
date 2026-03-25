# Castora

Herramienta de asistencia para producción periodística de radio, streaming y podcast. Pegás la URL de una noticia y genera automáticamente el material editorial completo.

## Qué genera

- **Boletín radial** — título en mayúsculas + bajadas listas para leer al aire, exportable a .docx
- **Resumen editorial** — subtexto e implicancias, no descripción mecánica
- **Datos en contexto** — cifras del artículo traducidas a comparaciones cotidianas
- **Entrevistados sugeridos** — 10 perfiles con justificación, declaración y pregunta clave
- **Música** — 5 categorías por clima emocional, con links a YouTube y Last.fm
- **Videos de YouTube** — los más relevantes sobre la noticia
- **Otras fuentes** — cobertura del mismo hecho en otros medios
- **Columnas de opinión** — columnistas reconocidos sobre el tema
- **Material para streaming** — ganchos, títulos SEO, descripción y hashtags

## Stack

- Node.js + Express (ES modules)
- Anthropic claude-sonnet-4-6 con web_search
- YouTube Data API v3
- Last.fm API
- SQLite (sql.js) para usuarios, historial y sesiones
- HTML + CSS + JS vanilla

## Variables de entorno

Crear un archivo `.env` en la raíz con:

```
ANTHROPIC_API_KEY=
YOUTUBE_API_KEY=
LASTFM_API_KEY=
SESSION_SECRET=
PORT=3001
```

Solo `ANTHROPIC_API_KEY` es obligatoria. Sin YouTube API los videos no aparecen. Sin Last.fm API la música se genera igual pero sin el pool de tracks por mood.

## Correr localmente

```bash
npm install
npm start        # producción
npm run dev      # desarrollo con auto-reload
```

## Deploy en Render

1. Conectar el repositorio en [render.com](https://render.com)
2. Render detecta `render.yaml` automáticamente
3. Configurar las variables de entorno en el dashboard de Render
4. `SESSION_SECRET` se genera automáticamente
