import { Router } from 'express';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import {
  fetchArticle, analyzeBoletinContexto, analyzeDisparadores,
  analyzeEntrevistas, analyzeMusica, analyzeAnguloStreaming,
  fetchOtrasFuentes, fetchOpinion, getMoodTags, translateText,
} from '../services/anthropic.js';
import { searchVideos, buildMusicSearchUrl, generateVideoSearchQueries } from '../services/youtube.js';
import { getTopTracksByTags } from '../services/lastfm.js';
import { saveAnalysis, getUserAnalyses, getAnalysisById, getRecentMusicFromUser } from '../db/database.js';

const router = Router();

// ==========================================
// AUTH MIDDLEWARE
// ==========================================

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'No autenticado. Iniciá sesión para continuar.' });
  }
  next();
}

// ==========================================
// URL CACHE — artículo y secciones por URL normalizada
// Estructura: key → { articleData, videoSearchData, sections: {}, id }
// ==========================================

const urlCache = new Map();

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch { return url; }
}

// ==========================================
// LOGGING — cada llamada a la API
// ==========================================

function logApiCall(section, url, startTime, tokensEst) {
  const elapsed = Date.now() - startTime;
  const ts = new Date().toISOString();
  console.log(`[api] ${ts} | ${section} | ${url.slice(0, 60)} | ~${tokensEst}tok | ${elapsed}ms`);
}

// ==========================================
// GET /api/check-auth
// ==========================================

router.get('/check-auth', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ authenticated: false });
  return res.json({ authenticated: true });
});

// ==========================================
// POST /api/process — carga inicial: Boletín + Contexto únicamente
// ==========================================

router.post('/process', requireAuth, async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'La URL es obligatoria' });
  }
  try { new URL(url); } catch {
    return res.status(400).json({ error: 'La URL no es válida' });
  }

  const key = normalizeUrl(url);
  const cached = urlCache.get(key);

  // Cache hit: ya se procesó esta URL, devolver sin llamar a la API
  if (cached?.sections?.boletin !== undefined) {
    console.log(`[process] cache hit: ${key}`);
    return res.json({
      success: true,
      id: cached.id || null,
      data: {
        title: cached.articleData.title,
        source: cached.articleData.source,
        boletin: cached.sections.boletin,
        contexto: cached.sections.contexto,
      },
    });
  }

  try {
    const t0 = Date.now();

    // Paso 1: Leer el artículo
    console.log(`[process] fetch: ${key}`);
    const articleData = await fetchArticle(url);
    const videoSearchData = generateVideoSearchQueries(articleData);

    // Paso 2: Boletín + Contexto (única llamada a Anthropic en la carga inicial)
    console.log(`[process] boletin+contexto: ${key}`);
    let brc = null;
    try {
      brc = await analyzeBoletinContexto(articleData);
      logApiCall('boletin+contexto', url, t0, 1800);
    } catch (e) {
      console.error('[process] boletin+contexto error:', e.message);
    }

    // Guardar en cache
    const entry = {
      articleData,
      videoSearchData,
      sections: {
        boletin: brc?.boletin || null,
        contexto: brc?.contexto || null,
      },
      id: null,
    };
    urlCache.set(key, entry);

    const result = {
      title: brc?.title || articleData.title,
      source: brc?.source || articleData.source,
      boletin: entry.sections.boletin,
      contexto: entry.sections.contexto,
    };

    const analysisId = saveAnalysis(req.session.userId, url, result.title, result.source, result);
    entry.id = analysisId;

    return res.json({ success: true, id: analysisId, data: result });

  } catch (error) {
    console.error('[process] error:', error);
    return res.status(500).json({ error: error.message || 'Error al procesar la noticia. Intentá de nuevo.' });
  }
});

// ==========================================
// POST /api/section/:name — generación bajo demanda
// Body: { url }
// Secciones: disparadores, entrevistas, musica, videos, angulo, otrasfuentes, opinion
// ==========================================

const VALID_SECTIONS = ['disparadores', 'entrevistas', 'musica', 'videos', 'angulo', 'otrasfuentes', 'opinion', 'traducir'];

router.post('/section/:name', requireAuth, async (req, res) => {
  const { name } = req.params;
  const { url, text } = req.body;

  if (!VALID_SECTIONS.includes(name)) {
    return res.status(400).json({ error: 'Sección inválida' });
  }

  // Traducción: no necesita URL ni caché
  if (name === 'traducir') {
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Texto requerido' });
    }
    try {
      const translated = await translateText(text);
      return res.json({ success: true, data: translated });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Error al traducir' });
    }
  }

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL requerida' });
  }

  const key = normalizeUrl(url);
  let entry = urlCache.get(key);

  // Cache hit: sección ya generada
  if (entry?.sections?.[name] !== undefined) {
    console.log(`[section/${name}] cache hit: ${key}`);
    return res.json({ success: true, cached: true, data: entry.sections[name] });
  }

  // Sin articleData en cache: re-fetchear el artículo
  if (!entry?.articleData) {
    try {
      console.log(`[section/${name}] re-fetch artículo: ${key}`);
      const articleData = await fetchArticle(url);
      const videoSearchData = generateVideoSearchQueries(articleData);
      entry = { articleData, videoSearchData, sections: {}, id: null };
      urlCache.set(key, entry);
    } catch (e) {
      return res.status(500).json({ error: 'No se pudo obtener el artículo: ' + e.message });
    }
  }

  const { articleData, videoSearchData } = entry;
  const t0 = Date.now();

  try {
    let sectionData = null;

    switch (name) {
      case 'disparadores': {
        const result = await analyzeDisparadores(articleData);
        sectionData = result?.disparadores || null;
        logApiCall('disparadores', url, t0, 800);
        break;
      }

      case 'entrevistas': {
        const result = await analyzeEntrevistas(articleData);
        sectionData = result?.entrevistas || null;
        logApiCall('entrevistas', url, t0, 2500);
        break;
      }

      case 'musica': {
        let lastfmTracks = [], recentSongs = [];
        try { recentSongs = getRecentMusicFromUser(req.session.userId, 5); } catch {}
        try {
          const moodTags = await getMoodTags(articleData);
          console.log(`[lastfm] mood tags: ${moodTags.join(', ')}`);
          lastfmTracks = await getTopTracksByTags(moodTags);
        } catch (e) { console.error('[lastfm]', e.message); }
        const result = await analyzeMusica(articleData, lastfmTracks, recentSongs);
        let musica = result?.musica || null;
        if (musica) {
          musica = musica.map(t => ({
            ...t,
            youtube_url: buildMusicSearchUrl(t.youtube_query || `${t.artista} ${t.cancion}`),
          }));
        }
        sectionData = musica;
        logApiCall('musica', url, t0, 3000);
        break;
      }

      case 'videos': {
        sectionData = await searchVideos(videoSearchData);
        logApiCall('videos', url, t0, 0);
        break;
      }

      case 'angulo': {
        // Genera ángulo + streaming en una sola llamada
        const result = await analyzeAnguloStreaming(articleData);
        sectionData = {
          angulo: result?.angulo || null,
          streaming: result?.streaming || null,
        };
        logApiCall('angulo+streaming', url, t0, 2000);
        break;
      }

      case 'otrasfuentes': {
        const result = await fetchOtrasFuentes({ title: articleData.title, source: articleData.source, url });
        sectionData = result?.fuentes || (Array.isArray(result) ? result : null);
        logApiCall('otrasFuentes', url, t0, 1200);
        break;
      }

      case 'opinion': {
        const result = await fetchOpinion({ title: articleData.title, source: articleData.source });
        sectionData = result?.columnas || (Array.isArray(result) ? result : null);
        logApiCall('opinion', url, t0, 1200);
        break;
      }
    }

    entry.sections[name] = sectionData;
    urlCache.set(key, entry);
    return res.json({ success: true, cached: false, data: sectionData });

  } catch (error) {
    console.error(`[section/${name}] error:`, error.message);
    return res.status(500).json({ error: error.message || 'Error al generar la sección' });
  }
});

// ==========================================
// POST /api/export/boletin — genera .docx
// ==========================================

router.post('/export/boletin', requireAuth, async (req, res) => {
  const { titulo, bajadas, articleTitle } = req.body;
  if (!titulo) return res.status(400).json({ error: 'Sin contenido para exportar' });

  const children = [
    new Paragraph({
      children: [new TextRun({ text: titulo, bold: true, size: 36, allCaps: true })],
      spacing: { after: 400 },
    }),
    ...(Array.isArray(bajadas) ? bajadas : []).map(bajada =>
      new Paragraph({
        children: [new TextRun({ text: bajada, size: 24 })],
        spacing: { after: 240 },
      })
    ),
  ];

  const doc = new Document({ sections: [{ properties: {}, children }] });
  const buffer = await Packer.toBuffer(doc);

  const safe = (articleTitle || 'boletin').slice(0, 40).replace(/[^a-z0-9áéíóúñ\s]/gi, '').trim().replace(/\s+/g, '-');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}.docx"`);
  res.send(buffer);
});

// ==========================================
// GET /api/history
// ==========================================

router.get('/history', requireAuth, (req, res) => {
  try {
    const analyses = getUserAnalyses(req.session.userId);
    return res.json({ success: true, data: analyses });
  } catch (error) {
    console.error('History error:', error);
    return res.status(500).json({ error: 'Error al obtener el historial' });
  }
});

// ==========================================
// GET /api/history/:id
// ==========================================

router.get('/history/:id', requireAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

    const analysis = getAnalysisById(id, req.session.userId);
    if (!analysis) return res.status(404).json({ error: 'Análisis no encontrado' });

    return res.json({ success: true, data: analysis });
  } catch (error) {
    console.error('History item error:', error);
    return res.status(500).json({ error: 'Error al obtener el análisis' });
  }
});

export default router;
