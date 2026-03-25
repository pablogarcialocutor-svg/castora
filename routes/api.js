import { Router } from 'express';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { fetchArticle, analyzePartA, analyzePartB, fetchOtrasFuentes, fetchOpinion, getMoodTags } from '../services/anthropic.js';
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

  try {
    const articleData = await fetchArticle(url);

    const videoSearchData = generateVideoSearchQueries(articleData);

    // partB necesita mood tags + Last.fm antes de arrancar
    const partBPromise = (async () => {
      let lastfmTracks = [];
      let recentSongs = [];
      try {
        recentSongs = getRecentMusicFromUser(req.session.userId, 5);
      } catch (e) {
        console.error('[db] getRecentMusicFromUser error:', e.message);
      }
      try {
        const moodTags = await getMoodTags(articleData);
        console.log(`[lastfm] mood tags: ${moodTags.join(', ')}`);
        lastfmTracks = await getTopTracksByTags(moodTags);
      } catch (e) {
        console.error('[lastfm] enrichment error:', e.message);
      }
      return analyzePartB(articleData, lastfmTracks, recentSongs);
    })();

    // ── Tanda 1: análisis principal (más pesado en tokens) ──
    console.log('[process] Tanda 1: partA + partB');
    const [resA, resB] = await Promise.allSettled([
      analyzePartA(articleData),
      partBPromise,
    ]);

    if (resA.status === 'rejected') console.error('[partA] falló:', resA.reason?.message);
    if (resB.status === 'rejected') console.error('[partB] falló:', resB.reason?.message);

    // ── Pausa entre tandas para liberar el contador de tokens/min ──
    console.log('[process] Pausa 15s entre tandas...');
    await new Promise(r => setTimeout(r, 15000));

    // ── Tanda 2: fuentes externas + videos (web_search, menos tokens) ──
    console.log('[process] Tanda 2: otrasFuentes + opinión + videos');
    const [resOF, resOP, resVideos] = await Promise.allSettled([
      fetchOtrasFuentes({ title: articleData.title, source: articleData.source, url }),
      fetchOpinion({ title: articleData.title, source: articleData.source }),
      searchVideos(videoSearchData),
    ]);

    // Extraer valores o null si fallaron
    const partA        = resA.status      === 'fulfilled' ? resA.value      : null;
    const partB        = resB.status      === 'fulfilled' ? resB.value      : null;
    const otrasFuentes = resOF.status     === 'fulfilled' ? resOF.value     : null;
    const opinion      = resOP.status     === 'fulfilled' ? resOP.value     : null;
    const videos       = resVideos.status === 'fulfilled' ? resVideos.value : null;

    // Loguear errores de tanda 2
    if (resOF.status     === 'rejected') console.error('[otrasFuentes] falló:', resOF.reason?.message);
    if (resOP.status     === 'rejected') console.error('[opinion] falló:', resOP.reason?.message);
    if (resVideos.status === 'rejected') console.error('[videos] falló:', resVideos.reason?.message);

    // Agregar URLs de YouTube a cada track de música
    if (partB?.musica && Array.isArray(partB.musica)) {
      partB.musica = partB.musica.map(t => ({
        ...t,
        youtube_url: buildMusicSearchUrl(t.youtube_query || `${t.artista} ${t.cancion}`),
      }));
    }

    const result = {
      title:        partA?.title        || articleData.title,
      source:       partA?.source       || articleData.source,
      resumen:      partA?.resumen      || null,
      boletin:      partA?.boletin      || null,
      contexto:     partA?.contexto     || null,
      angulo:       partA?.angulo       || null,
      entrevistas:  partB?.entrevistas  || null,
      musica:       partB?.musica       || null,
      streaming:    partB?.streaming    || null,
      videos:       videos              || { available: false },
      otrasFuentes: otrasFuentes?.fuentes || (Array.isArray(otrasFuentes) ? otrasFuentes : null),
      opinion:      opinion?.columnas   || (Array.isArray(opinion) ? opinion : null),
    };

    const analysisId = saveAnalysis(
      req.session.userId,
      url,
      result.title,
      result.source,
      result
    );

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
