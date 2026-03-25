const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

const PRIORITY_CHANNELS = new Set([
  'UCu4A-pPOy4sGN8jyFBKqNlA', // Infobae
  'UCBo3gHxP1OIrQVyGTLJGZDg', // TN - Todo Noticias
  'UCqnbDFdCpuN8CMEg0VuEBqA', // La Nación
  'UCxkqDKi04qJt7dz7bV_W_GQ', // C5N
  'UCrBsZAaAnLFnCZSi34fyOGQ', // CNN en Español
  'UCgGHiivA72PVf4tKFOOenBw', // BBC Mundo
]);

const PRIORITY_CHANNEL_NAMES = [
  'infobae', 'todo noticias', 'tn ', 'la nacion', 'la nación',
  'c5n', 'cnn en español', 'bbc mundo', 'clarin', 'clarín',
  'canal 26', 'cronica', 'crónica', 'telam', 'télam',
];

const STOPWORDS = new Set([
  'que', 'los', 'las', 'una', 'con', 'por', 'para', 'del', 'sus', 'esta',
  'este', 'pero', 'como', 'más', 'hay', 'ser', 'fue', 'son', 'está', 'han',
  'van', 'un', 'en', 'el', 'la', 'de', 'a', 'y', 'o', 'se', 'lo', 'al',
  'no', 'si', 'su', 'ya', 'le', 'me', 'te', 'ni', 'mi', 'muy', 'sin',
  'sobre', 'tras', 'ante', 'bajo', 'desde', 'hasta', 'entre', 'según',
  'durante', 'mediante', 'también', 'cuando', 'donde', 'quien', 'cuyo',
  'porque', 'aunque', 'sino', 'sido', 'todo', 'todos', 'todas', 'años',
  'año', 'esta', 'este', 'estos', 'estas', 'ser', 'puede', 'tiene',
]);

function extractProperNouns(text, max = 6) {
  if (!text) return [];
  const cleaned = text.replace(/["'«»\[\]():]/g, ' ');
  const matches = cleaned.match(/\b[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñA-ZÁÉÍÓÚÜÑ]+(?:\s+[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñA-ZÁÉÍÓÚÜÑ]+)*\b/g) || [];
  const seen = new Set();
  return matches
    .map(m => m.trim())
    .filter(m => {
      const lower = m.toLowerCase();
      if (STOPWORDS.has(lower)) return false;
      if (m.length < 3) return false;
      if (seen.has(lower)) return false;
      seen.add(lower);
      return true;
    })
    .slice(0, max);
}

function extractTopicKeywords(text, max = 4) {
  if (!text) return [];
  return text
    .normalize('NFC')
    .replace(/[^a-záéíóúüñA-ZÁÉÍÓÚÜÑ0-9$%\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 4 && !STOPWORDS.has(w.toLowerCase()))
    .slice(0, max);
}

/**
 * Genera 3 niveles de queries + términos de relevancia.
 * Nivel 1: protagonistas + hecho + país + año (específico)
 * Nivel 2: protagonistas + país (sin hecho)
 * Nivel 3: sector/industria + país + año (amplio)
 */
export function generateVideoSearchQueries({ title, content, source }) {
  const currentYear = new Date().getFullYear();
  const cleanTitle = (title || '').replace(/["'«»:]/g, '').trim();

  const contentBody = content
    ? content.replace(/^[\s\S]*?CONTENIDO:\s*/i, '').slice(0, 700)
    : '';

  const allProperNouns = extractProperNouns(cleanTitle, 6);
  const fullNames = allProperNouns.filter(n => n.includes(' ')); // "Javier Milei", "Arcor Danone"
  const singleNouns = allProperNouns.filter(n => !n.includes(' ')); // "Mastellone"
  const protagonists = [...fullNames, ...singleNouns].slice(0, 4);

  const topicKeywords = extractTopicKeywords(contentBody, 4);

  const countryMatch = (cleanTitle + ' ' + contentBody.slice(0, 300))
    .match(/\b(Argentina|Brasil|Chile|Uruguay|México|España|Estados Unidos|Colombia|Venezuela|Perú|Bolivia)\b/i);
  const country = countryMatch ? countryMatch[1] : '';

  // Nivel 1: ESPECÍFICO — todos los protagonistas + hecho + país + año
  // "Arcor Danone Mastellone compra Argentina 2026"
  const l1 = [
    ...protagonists.slice(0, 3),
    topicKeywords[0] || '',
    country,
    String(currentYear),
  ].filter(Boolean).join(' ');

  // Nivel 2: PROTAGONISTAS — nombres solos + país
  // "Arcor Danone Mastellone" o "Mastellone Argentina"
  const l2 = protagonists.length > 0
    ? [...protagonists.slice(0, 2), country].filter(Boolean).join(' ')
    : topicKeywords.slice(0, 2).join(' ') + ' ' + currentYear;

  // Nivel 3: SECTOR — palabras clave del tema + país + año
  // "industria láctea Argentina 2026"
  const l3 = [
    ...topicKeywords.slice(0, 2),
    country,
    String(currentYear),
  ].filter(Boolean).join(' ');

  // Términos de relevancia: palabras individuales de protagonistas y keywords (min 4 chars)
  const relevanceTerms = [
    ...protagonists.flatMap(n => n.split(' ')),
    ...topicKeywords,
  ].filter(t => t.length > 3).map(t => t.toLowerCase());

  return {
    levels: [
      { label: '1-específica', query: l1 },
      { label: '2-protagonistas', query: l2 },
      { label: '3-sector', query: l3 },
    ],
    relevanceTerms,
    suggestedQuery: l1,
  };
}

// ==========================================
// HELPERS INTERNOS
// ==========================================

async function fetchYoutubeResults(query, maxResults = 10) {
  const publishedAfter = new Date();
  publishedAfter.setFullYear(publishedAfter.getFullYear() - 1); // último año
  const publishedAfterParam = publishedAfter.toISOString();

  const params = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    maxResults: String(maxResults),
    relevanceLanguage: 'es',
    regionCode: 'AR',
    publishedAfter: publishedAfterParam,
    order: 'relevance',
    key: YOUTUBE_API_KEY,
  });

  let response = await fetch(`${YOUTUBE_API_BASE}/search?${params}`, {
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok && response.status === 400) {
    params.delete('publishedAfter');
    response = await fetch(`${YOUTUBE_API_BASE}/search?${params}`, {
      signal: AbortSignal.timeout(10000),
    });
  }

  if (!response.ok) return [];
  const data = await response.json();
  if (!data.items) return [];

  return data.items
    .filter(item => item.id?.videoId)
    .map(item => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channelId: item.snippet.channelId,
      channelTitle: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt,
      thumbnail: `https://i.ytimg.com/vi/${item.id.videoId}/mqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
    }));
}

function filterByRelevance(videos, relevanceTerms) {
  if (!relevanceTerms || relevanceTerms.length === 0) return videos;
  return videos.filter(v =>
    relevanceTerms.some(t => v.title.toLowerCase().includes(t))
  );
}

async function scoreAndSelect(videos, relevanceTerms, max = 3) {
  if (videos.length === 0) return [];

  const ids = videos.map(v => v.videoId).join(',');
  let statsMap = {};
  try {
    const statsParams = new URLSearchParams({
      part: 'statistics',
      id: ids,
      key: YOUTUBE_API_KEY,
    });
    const statsRes = await fetch(`${YOUTUBE_API_BASE}/videos?${statsParams}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (statsRes.ok) {
      const statsData = await statsRes.json();
      for (const item of (statsData.items || [])) {
        statsMap[item.id] = parseInt(item.statistics?.viewCount || '0', 10);
      }
    }
  } catch (err) {
    console.error('[youtube] Stats error:', err.message);
  }

  return videos
    .filter(v => {
      const views = statsMap[v.videoId] ?? 0;
      return views >= 500 || statsMap[v.videoId] === undefined;
    })
    .map(v => {
      const views = statsMap[v.videoId] ?? 0;
      let score = 0;
      if (PRIORITY_CHANNELS.has(v.channelId)) score += 100;
      const chLower = v.channelTitle.toLowerCase();
      if (PRIORITY_CHANNEL_NAMES.some(n => chLower.includes(n))) score += 50;
      if (views > 0) score += Math.log10(views) * 5;
      const titleLower = v.title.toLowerCase();
      score += (relevanceTerms || []).filter(t => titleLower.includes(t)).length * 30;
      return { ...v, views, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ score, views, ...v }) => v);
}

// ==========================================
// BÚSQUEDA PRINCIPAL — 4 niveles de fallback
// ==========================================

/**
 * Intenta cada nivel en orden. Se detiene al primer nivel que encuentra
 * videos con al menos una palabra clave en el título.
 * Si ningún nivel encuentra resultados relevantes, devuelve noResults=true
 * con la query sugerida del nivel 1.
 */
export async function searchVideos({ levels, relevanceTerms = [], suggestedQuery = '' }) {
  if (!YOUTUBE_API_KEY) {
    return { available: false, message: 'YouTube API no configurada' };
  }

  for (const level of levels) {
    if (!level.query?.trim()) continue;

    let candidates;
    try {
      candidates = await fetchYoutubeResults(level.query, 10);
    } catch (err) {
      console.error(`[youtube] Error ${level.label}:`, err.message);
      continue;
    }

    if (candidates.length === 0) {
      console.log(`[youtube] ${level.label}: sin resultados`);
      continue;
    }

    const relevant = filterByRelevance(candidates, relevanceTerms);
    console.log(`[youtube] ${level.label}: ${candidates.length} resultados, ${relevant.length} relevantes`);

    if (relevant.length === 0) continue;

    const top3 = await scoreAndSelect(relevant, relevanceTerms, 3);
    if (top3.length > 0) {
      console.log(`[youtube] Éxito en ${level.label} con ${top3.length} videos`);
      return { available: true, videos: top3 };
    }
  }

  // Ningún nivel encontró resultados relevantes → nivel 4: mensaje con link
  console.log('[youtube] Sin resultados relevantes en ningún nivel');
  return {
    available: true,
    videos: [],
    noResults: true,
    suggestedQuery,
  };
}

export function buildMusicSearchUrl(youtubeQuery) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(youtubeQuery)}`;
}
