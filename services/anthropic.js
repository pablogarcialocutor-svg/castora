import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ==========================================
// BROWSER HEADERS — simula Chrome en Windows
// ==========================================

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-AR,es;q=0.9,es-419;q=0.8,en-US;q=0.7,en;q=0.6',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'DNT': '1',
};

// ==========================================
// FETCH DIRECTO CON HEADERS DE NAVEGADOR
// ==========================================

async function fetchUrlDirect(url) {
  const parsedUrl = new URL(url);
  const headers = {
    ...BROWSER_HEADERS,
    'Referer': `https://www.google.com/search?q=${encodeURIComponent(parsedUrl.hostname + ' ' + parsedUrl.pathname.split('/').pop())}`,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.text();
}

// ==========================================
// EXTRACCIÓN DE TEXTO DESDE HTML
// ==========================================

function extractTitleFromHtml(html) {
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{5,}?)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']{5,}?)["'][^>]+property=["']og:title["']/i);
  if (ogTitle) return ogTitle[1].trim();

  const titleTag = html.match(/<title[^>]*>([^<]{5,}?)<\/title>/i);
  if (titleTag) return titleTag[1].split(/[|\-–—]/)[0].trim();

  const h1 = html.match(/<h1[^>]*>([^<]{5,}?)<\/h1>/i);
  if (h1) return h1[1].trim();

  return '';
}

function extractTextFromHtml(html) {
  let text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&ntilde;/g, 'ñ')
    .replace(/&aacute;/g, 'á')
    .replace(/&eacute;/g, 'é')
    .replace(/&iacute;/g, 'í')
    .replace(/&oacute;/g, 'ó')
    .replace(/&uacute;/g, 'ú');

  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ==========================================
// RETRY CON BACKOFF PARA RATE LIMIT
// ==========================================

async function callWithRetry(fn, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isRateLimit = error?.status === 429 || error?.message?.includes('rate_limit');
      if (isRateLimit && attempt < maxRetries) {
        console.log(`[retry] Rate limit — intento ${attempt + 1}/${maxRetries + 1}, esperando 30s...`);
        await new Promise(r => setTimeout(r, 30000));
        continue;
      }
      throw error;
    }
  }
}

// ==========================================
// PARSEO DE JSON DESDE RESPUESTA DE LA API
// ==========================================

function parseJsonResponse(text) {
  let jsonText = text.trim();
  if (jsonText.startsWith('```json')) jsonText = jsonText.slice(7);
  else if (jsonText.startsWith('```')) jsonText = jsonText.slice(3);
  if (jsonText.endsWith('```')) jsonText = jsonText.slice(0, -3);
  jsonText = jsonText.trim();

  try {
    return JSON.parse(jsonText);
  } catch {
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    throw new Error('La respuesta de la IA no es un JSON válido');
  }
}

// ==========================================
// FETCH DEL ARTÍCULO: DIRECTO → FALLBACK API
// ==========================================

async function fetchArticleContent(url) {
  try {
    console.log(`[fetch] Intentando fetch directo: ${url}`);
    const html = await fetchUrlDirect(url);
    const text = extractTextFromHtml(html);

    if (text.length > 400) {
      const title = extractTitleFromHtml(html);
      const source = new URL(url).hostname.replace(/^www\./, '');
      const content = `TÍTULO: ${title}\nFUENTE: ${source}\nCONTENIDO: ${text.slice(0, 9000)}`;
      console.log(`[fetch] Fetch directo exitoso (${text.length} chars)`);
      return { content, title, source };
    }
    throw new Error('Contenido insuficiente en fetch directo');
  } catch (err) {
    console.log(`[fetch] Fetch directo falló (${err.message}), usando web_search...`);
  }

  const fetchResponse = await callWithRetry(() => client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{
      role: 'user',
      content: `Leé este artículo y devolvé exactamente:\nTÍTULO: [título]\nFUENTE: [medio]\nCONTENIDO: [texto completo]\n\nURL: ${url}`,
    }],
  }));

  let content = '';
  for (const block of fetchResponse.content) {
    if (block.type === 'text') content += block.text;
  }

  const titleMatch = content.match(/TÍTULO:\s*(.+?)(?:\n|FUENTE:)/s);
  const sourceMatch = content.match(/FUENTE:\s*(.+?)(?:\n|CONTENIDO:)/s);

  return {
    content,
    title: titleMatch ? titleMatch[1].trim() : '',
    source: sourceMatch ? sourceMatch[1].trim() : '',
  };
}

// ==========================================
// EXPORT: FETCH ARTÍCULO
// ==========================================

export async function fetchArticle(url) {
  try {
    const result = await fetchArticleContent(url);
    if (!result.content || result.content.length < 100) {
      throw new Error('No se pudo obtener el contenido del artículo. Verificá que la URL sea correcta y accesible.');
    }
    return result;
  } catch (error) {
    if (error.message.startsWith('No se pudo')) throw error;
    throw new Error(`No se pudo acceder al artículo: ${error.message}`);
  }
}

// ==========================================
// PASO 2 — Boletín + Contexto (carga inicial)
// ==========================================

export async function analyzeBoletinContexto({ content, title: articleTitle, source: articleSource }) {
  const prompt = `Producción periodística radio/streaming. Devolvé SOLO JSON válido, sin markdown.

NOTICIA:
${content.slice(0, 4000)}

JSON:
{"title":"","source":"","boletin":{"titulo":"TÍTULO EN MAYÚSCULAS","bajadas":["BAJADA 1","BAJADA 2"]},"contexto":[{"dato":"cifra/fecha/% exacto","traduccion":"comparación cotidiana concreta"}]}

REGLAS BOLETÍN:
- titulo: ≤15 palabras, EL/LA/LOS+sujeto+verbo pasado/presente, sin adjetivos valorativos
- bajadas: 2-3, ≤200 car c/u, S+V+P, solo hechos verificables
- Estructura obligatoria: título=hecho central / bajada1=contexto / bajada2=consecuencia o dato nuevo / bajada3 si existe=perspectiva o reacción
- PROHIBIDO repetir palabras clave, nombres propios o conceptos entre título y bajadas, o entre bajadas
- El protagonista principal se nombra solo una vez en todo el boletín — las demás referencias usan pronombre o cargo
- PROHIBIDO repetir el mismo verbo en distintas bajadas

REGLAS CONTEXTO:
- 3-6 items, cada uno con un dato numérico distinto (cifra, %, fecha, monto)
- La traducción es una comparación cotidiana concreta (precios, tiempos, distancias conocidas)
- PROHIBIDO repetir ningún dato numérico entre items
- PROHIBIDO que dos items mencionen la misma magnitud o concepto

Español rioplatense.`;

  const response = await callWithRetry(() => client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1800,
    messages: [{ role: 'user', content: prompt }],
  }));

  let rawText = '';
  for (const block of response.content) {
    if (block.type === 'text') rawText += block.text;
  }

  const parsed = parseJsonResponse(rawText);
  if (!parsed.title && articleTitle) parsed.title = articleTitle;
  if (!parsed.source && articleSource) parsed.source = articleSource;
  return parsed;
}

// ==========================================
// SECCIÓN BAJO DEMANDA — Resumen editorial
// ==========================================

export async function analyzeResumen({ content }) {
  const prompt = `Producción periodística. Devolvé SOLO JSON puro, sin markdown.

NOTICIA:
${content.slice(0, 4000)}

{"resumen":"texto aquí"}

REGLAS: 4-6 líneas. Subtexto e implicancias reales, no descripción mecánica de los hechos. Qué hay detrás, qué significa, qué puede pasar. Español rioplatense.`;

  const response = await callWithRetry(() => client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  }));

  let rawText = '';
  for (const block of response.content) {
    if (block.type === 'text') rawText += block.text;
  }

  return parseJsonResponse(rawText);
}

// ==========================================
// PASO 3 — Entrevistas
// ==========================================

export async function analyzeEntrevistas({ content }) {
  const prompt = `Producción periodística. Devolvé SOLO JSON puro, sin markdown.

NOTICIA:
${content.slice(0, 3500)}

{"entrevistas":[{"nombre":"","rol":"","categoria":"experto","justificacion":"perspectiva única que aporta","declaracion":"declaración real con fecha","pregunta":"pregunta específica no obvia"}]}

REGLAS: 10 personas — 3-4 "experto" (académicos/especialistas), 3 "critico" (voces alternativas), 3 "afectado" (impactados directamente). NUNCA protagonistas obvios del hecho. Español rioplatense.`;

  const response = await callWithRetry(() => client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2500,
    messages: [{ role: 'user', content: prompt }],
  }));

  let rawText = '';
  for (const block of response.content) {
    if (block.type === 'text') rawText += block.text;
  }

  return parseJsonResponse(rawText);
}

// ==========================================
// PASO 4 — Música
// ==========================================

export async function analyzeMusica({ content }, lastfmTracks = [], recentSongs = []) {
  const prompt = `Producción periodística radio/streaming. Devolvé SOLO JSON puro, sin markdown.

NOTICIA:
${content.slice(0, 3000)}

{"musica":[{"artista":"","cancion":"","anio":"","genero":"","categoria":"sutil","conexion":"emoción/textura, nunca relación temática","youtube_query":"artista cancion","lastfm_url":null}]}

REGLAS: LA MÚSICA CREA CLIMA EMOCIONAL, NO ILUSTRA EL TEMA. 5 categorías (≥2 canciones c/u, sin repetir artistas): sutil(jazz/tango exp/electrónica/world), nacional(folklore/cumbia/tango/indie, no solo rock), internacional(criterio autoral), clasica(instrumental), esperada(clichés predecibles, conexion empieza "Opción obvia:"). En sutil/nacional/internacional/clasica prohibido título=tema o clichés de protesta. Rioplatense.${lastfmTracks.length > 0 ? `

POOL LAST.FM — priorizá si encajan emocionalmente. Copiá lastfm_url exacto, null si no usás:
${lastfmTracks.slice(0, 20).map(t => `${t.artist} — ${t.name}${t.url ? ` | ${t.url}` : ''}`).join('\n')}` : ''}${recentSongs.length > 0 ? `

NO REPETIR:
${recentSongs.slice(0, 15).join('\n')}` : ''}`;

  const response = await callWithRetry(() => client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }],
  }));

  let rawText = '';
  for (const block of response.content) {
    if (block.type === 'text') rawText += block.text;
  }

  return parseJsonResponse(rawText);
}

// ==========================================
// PASO 5 — Ángulo + Streaming
// ==========================================

export async function analyzeAnguloStreaming({ content }) {
  const prompt = `Producción periodística radio/streaming. Devolvé SOLO JSON puro, sin markdown.

NOTICIA:
${content.slice(0, 3500)}

{"angulo":[{"tipo":"critico","titulo":"","contenido":""},{"tipo":"humano","titulo":"","contenido":""},{"tipo":"inesperado","titulo":"","contenido":""}],"streaming":{"ganchos":["opción 1","opción 2"],"titulos_youtube":["título 1","título 2"],"descripcion":"SEO 3-4 oraciones","hashtags":["#tag1"]}}

REGLAS: angulo: exactamente 3, genuinamente distintos entre sí. streaming: 2 ganchos, 2 títulos YouTube, ≥8 hashtags. Español rioplatense.`;

  const response = await callWithRetry(() => client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  }));

  let rawText = '';
  for (const block of response.content) {
    if (block.type === 'text') rawText += block.text;
  }

  return parseJsonResponse(rawText);
}

// ==========================================
// MOOD TAGS — extracción rápida para Last.fm
// ==========================================

export async function getMoodTags({ content, title }) {
  const response = await callWithRetry(() => client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 150,
    messages: [{
      role: 'user',
      content: `Analizá esta noticia y devolvé 4 tags de mood/emoción en inglés para buscar música en Last.fm.

NOTICIA: ${title}
${content.slice(0, 800)}

Devolvé SOLO un array JSON de strings, sin markdown. Los tags deben describir el clima emocional que evoca la noticia — no el tema, sino la textura emocional. Ejemplos válidos: ["melancholy", "tension", "resistance", "irony"], ["anxiety", "urgency", "loss", "anger"], ["hope", "reflection", "nostalgia", "uncertainty"]`,
    }],
  }));

  let text = '';
  for (const block of response.content) {
    if (block.type === 'text') text += block.text;
  }

  try {
    let clean = text.trim().replace(/```json?|```/g, '').trim();
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.slice(0, 4).map(t => String(t).toLowerCase().trim());
    }
  } catch {}
  return ['melancholy', 'tension'];
}


// ==========================================
// OTRAS FUENTES — cobertura del mismo hecho en otros medios
// ==========================================

export async function fetchOtrasFuentes({ title, source, url }) {
  const response = await callWithRetry(() => client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{
      role: 'user',
      content: `Buscá en la web esta noticia cubierta por medios distintos a "${source}".

NOTICIA: ${title}
URL ORIGINAL: ${url}

Devolvé SOLO JSON puro, sin markdown:
{"fuentes":[{"medio":"nombre del medio","titulo":"título exacto del artículo","fecha":"fecha de publicación","url":"URL del artículo"}]}

REGLAS:
- Mínimo 4 fuentes, máximo 8
- Excluir completamente el medio "${source}" y cualquier subdominio suyo
- Solo artículos que cubren esta noticia específica, no notas relacionadas genéricas
- Incluir la fecha de publicación
- Ordenar por relevancia e importancia del medio`,
    }],
  }));

  let text = '';
  for (const block of response.content) {
    if (block.type === 'text') text += block.text;
  }

  return parseJsonResponse(text);
}

// ==========================================
// OPINIÓN — columnas firmadas por periodistas reconocidos
// ==========================================

export async function fetchOpinion({ title, source }) {
  const response = await callWithRetry(() => client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{
      role: 'user',
      content: `Buscá columnas de opinión y análisis firmados sobre este tema:

NOTICIA: ${title}

Devolvé SOLO JSON puro, sin markdown:
{"columnas":[{"columnista":"nombre completo del columnista","medio":"nombre del medio","titulo":"título de la columna","fecha":"fecha de publicación","url":"URL de la columna"}]}

REGLAS ESTRICTAS:
- Mínimo 4 columnas, máximo 8
- PROHIBIDO repetir autor — cada columnista debe aparecer una sola vez
- Solo columnas de opinión o análisis firmados por una persona, no notas informativas ni editoriales sin firma
- El tema debe ser específicamente sobre esta noticia o su contexto directo
- Priorizar en este orden: (1) periodistas argentinos reconocidos como Jorge Lanata, Martín Caparrós, María O'Donnell, Nelson Castro, Beatriz Sarlo, Graciela Mochkofsky, Martín Sivak, Gabriela Cerruti, Luciana Peker, Sergio Kiernan, Horacio Verbitsky, Eduardo van der Kooy; (2) otros columnistas latinoamericanos de referencia; (3) columnistas internacionales en inglés de medios como NYT, The Guardian, The Economist solo si el tema lo justifica
- Incluir fecha de publicación
- Ordenar por relevancia y trayectoria del columnista`,
    }],
  }));

  let text = '';
  for (const block of response.content) {
    if (block.type === 'text') text += block.text;
  }

  return parseJsonResponse(text);
}
