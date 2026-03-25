const LASTFM_API_KEY = process.env.LASTFM_API_KEY;
const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0/';

/**
 * Para un tag dado, devuelve los top tracks de Last.fm.
 */
async function getTagTopTracks(tag, limit = 15) {
  if (!LASTFM_API_KEY) return [];

  const params = new URLSearchParams({
    method: 'tag.getTopTracks',
    tag,
    api_key: LASTFM_API_KEY,
    format: 'json',
    limit: String(limit),
  });

  try {
    const res = await fetch(`${LASTFM_BASE}?${params}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.tracks?.track || []).map(t => ({
      name: t.name,
      artist: t.artist?.name || '',
      url: t.url || null,
    }));
  } catch (err) {
    console.error(`[lastfm] Error tag "${tag}":`, err.message);
    return [];
  }
}

/**
 * Recibe un array de mood tags en inglés, busca tracks para cada uno en paralelo,
 * combina y deduplica por artista+canción. Devuelve máx 50 tracks.
 */
export async function getTopTracksByTags(tags) {
  if (!LASTFM_API_KEY || !tags || tags.length === 0) return [];

  const results = await Promise.all(tags.map(tag => getTagTopTracks(tag, 15)));

  const seen = new Set();
  const tracks = [];

  for (const tagTracks of results) {
    for (const track of tagTracks) {
      if (!track.artist || !track.name) continue;
      const key = `${track.artist.toLowerCase()}||${track.name.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        tracks.push(track);
      }
    }
  }

  console.log(`[lastfm] ${tags.join(', ')} → ${tracks.length} tracks encontrados`);
  return tracks.slice(0, 50);
}
