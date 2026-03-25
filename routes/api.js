import { Router } from 'express';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { fetchArticle, analyzeBoletinResumenContexto, analyzeEntrevistas, analyzeMusica, analyzeAnguloStreaming, fetchOtrasFuentes, fetchOpinion, getMoodTags } from '../services/anthropic.js';
import { searchVideos, buildMusicSearchUrl, generateVideoSearchQueries } from '../services/youtube.js';
import { getTopTracksByTags } from '../services/lastfm.js';
import { saveAnalysis, getUserAnalyses, getAnalysisById, getRecentMusicFromUser } from '../db/database.js';

const router = Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'No autenticado. Iniciá sesión para continuar.' });
  }
  next();
}

// GET /api/check-auth
router.get('/check-auth', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ authenticated: false });
  return res.json({ authenticated: true });
});

// POST /api/process — respuesta JSON única al finalizar
router.post('/process', requireAuth, async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'La URL es obligatoria' });
  }
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'La URL no es válida' });
  }

  // Helper: ejecuta un paso y devuelve null si falla, sin romper la cadena
  async function step(name, fn) {
    try {
      const result = await fn();
      console.log(`[process] ✓ ${name}`);
      return result;
    } catch (e) {
      console.error(`[process] ✗ ${name}:`, e.message);
      return null;
    }
  }

  try {
    // Paso 1: Leer el artículo
    console.log('[process] Paso 1: fetch artículo');
    const articleData = await fetchArticle(url);
    const videoSearchData = generateVideoSearchQueries(articleData);

    // Paso 2: Boletín + Resumen + Contexto
    console.log('[process] Paso 2: boletín + resumen + contexto');
    const brc = await step('boletin/resumen/contexto', () => analyzeBoletinResumenContexto(articleData));

    // Paso 3: Entrevistas
    console.log('[process] Paso 3: entrevistas');
    const entrevistasData = await step('entrevistas', () => analyzeEntrevistas(articleData));

    // Paso 4: Música (con enriquecimiento Last.fm)
    console.log('[process] Paso 4: música');
    let lastfmTracks = [];
    let recentSongs = [];
    try { recentSongs = getRecentMusicFromUser(req.session.userId, 5); } catch (e) {}
    try {
      const moodTags = await getMoodTags(articleData);
      console.log(`[lastfm] mood tags: ${moodTags.join(', ')}`);
      lastfmTracks = await getTopTracksByTags(moodTags);
    } catch (e) {
      console.error('[lastfm] enrichment error:', e.message);
    }
    const musicaData = await step('musica', () => analyzeMusica(articleData, lastfmTracks, recentSongs));

    // Paso 5: Ángulo + Streaming
    console.log('[process] Paso 5: ángulo + streaming');
    const anguloStreamingData = await step('angulo/streaming', () => analyzeAnguloStreaming(articleData));

    // Paso 6: Videos YouTube
    console.log('[process] Paso 6: videos');
    const videos = await step('videos', () => searchVideos(videoSearchData));

    // Paso 7: Otras fuentes
    console.log('[process] Paso 7: otras fuentes');
    const otrasFuentesData = await step('otrasFuentes', () =>
      fetchOtrasFuentes({ title: articleData.title, source: articleData.source, url })
    );

    // Paso 8: Opinión
    console.log('[process] Paso 8: opinión');
    const opinionData = await step('opinion', () =>
      fetchOpinion({ title: articleData.title, source: articleData.source })
    );

    // Agregar URLs de YouTube a cada track de música
    let musica = musicaData?.musica || null;
    if (musica && Array.isArray(musica)) {
      musica = musica.map(t => ({
        ...t,
        youtube_url: buildMusicSearchUrl(t.youtube_query || `${t.artista} ${t.cancion}`),
      }));
    }

    const result = {
      title:        brc?.title              || articleData.title,
      source:       brc?.source             || articleData.source,
      resumen:      brc?.resumen            || null,
      boletin:      brc?.boletin            || null,
      contexto:     brc?.contexto           || null,
      angulo:       anguloStreamingData?.angulo    || null,
      entrevistas:  entrevistasData?.entrevistas   || null,
      musica,
      streaming:    anguloStreamingData?.streaming || null,
      videos:       videos                  || { available: false },
      otrasFuentes: otrasFuentesData?.fuentes || (Array.isArray(otrasFuentesData) ? otrasFuentesData : null),
      opinion:      opinionData?.columnas    || (Array.isArray(opinionData) ? opinionData : null),
    };

    const analysisId = saveAnalysis(req.session.userId, url, result.title, result.source, result);
    return res.json({ success: true, id: analysisId, data: result });

  } catch (error) {
    console.error('Process error:', error);
    return res.status(500).json({ error: error.message || 'Error al procesar la noticia. Intentá de nuevo.' });
  }
});

// POST /api/export/boletin — genera .docx del boletín
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

// GET /api/history
router.get('/history', requireAuth, (req, res) => {
  try {
    const analyses = getUserAnalyses(req.session.userId);
    return res.json({ success: true, data: analyses });
  } catch (error) {
    console.error('History error:', error);
    return res.status(500).json({ error: 'Error al obtener el historial' });
  }
});

// GET /api/history/:id
router.get('/history/:id', requireAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const analysis = getAnalysisById(id, req.session.userId);
    if (!analysis) {
      return res.status(404).json({ error: 'Análisis no encontrado' });
    }
    return res.json({ success: true, data: analysis });
  } catch (error) {
    console.error('History item error:', error);
    return res.status(500).json({ error: 'Error al obtener el análisis' });
  }
});

export default router;
