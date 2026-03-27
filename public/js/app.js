// ============================================
// Castora — Main Application Logic
// ============================================

(function () {
  'use strict';

  // ==========================================
  // STATE
  // ==========================================

  let currentData = null;
  let currentUrl = null;    // URL actualmente procesada
  let sectionState = {};    // { sectionKey: 'idle'|'loading'|'loaded' }
  let loadingInterval = null;
  let loadingStep = 0;
  let loadingProgress = 0;

  // Mensajes para la carga inicial (boletín + contexto)
  const LOADING_MESSAGES = [
    'Leyendo la nota...',
    'Construyendo el boletín...',
    'Analizando el contexto...',
  ];

  // Tabs que se cargan en la llamada inicial, sin on-demand
  const INITIAL_TABS = new Set(['boletin', 'contexto']);

  // Mapeo tab → sección del backend
  const TAB_SECTION_MAP = {
    resumen:      'resumen',
    entrevistas:  'entrevistas',
    musica:       'musica',
    videos:       'videos',
    angulo:       'angulo',
    streaming:    'angulo',       // comparte sección con angulo
    otrasfuentes: 'otrasfuentes',
    opinion:      'opinion',
  };

  // Contenedor DOM de cada sección on-demand
  const SECTION_CONTAINERS = {
    resumen:      '#resumenText',
    entrevistas:  '#entrevistasGrid',
    musica:       '#musicaList',
    videos:       '#videosContent',
    angulo:       '#anguloList',
    streaming:    '#streamingSections',
    otrasfuentes: '#fuentesList',
    opinion:      '#opinionList',
  };

  // ==========================================
  // DOM REFERENCES
  // ==========================================

  const urlInput = document.getElementById('urlInput');
  const processBtn = document.getElementById('processBtn');
  const processError = document.getElementById('processError');
  const loadingSection = document.getElementById('loadingSection');
  const loadingStatus = document.getElementById('loadingStatus');
  const loadingBar = document.getElementById('loadingBar');
  const tabsSection = document.getElementById('tabsSection');
  const headerEmail = document.getElementById('headerEmail');
  const logoutBtn = document.getElementById('logoutBtn');
  const historyToggle = document.getElementById('historyToggle');
  const historyPanel = document.getElementById('historyPanel');
  const historyList = document.getElementById('historyList');

  // ==========================================
  // INIT
  // ==========================================

  async function init() {
    await checkAuth();
    setupEventListeners();
    setupTabNav();
    setupCopyButtons();
    uppercaseStaticLabels();
  }

  function uppercaseStaticLabels() {
    document.querySelectorAll('.tab-btn').forEach(el => {
      el.textContent = upperES(el.textContent);
    });
    document.querySelectorAll('.section-label').forEach(el => {
      el.textContent = upperES(el.textContent);
    });
  }

  // ==========================================
  // AUTH CHECK
  // ==========================================

  async function checkAuth() {
    try {
      const res = await fetch('/api/check-auth');
      if (!res.ok) {
        window.location.href = '/login';
        return;
      }
      // Obtener email del usuario
      const me = await fetch('/api/auth/me');
      if (me.ok) {
        const data = await me.json();
        if (data.user) headerEmail.textContent = data.user.email;
      }
    } catch (err) {
      window.location.href = '/login';
    }
  }

  // ==========================================
  // EVENT LISTENERS
  // ==========================================

  function setupEventListeners() {
    processBtn.addEventListener('click', handleProcess);

    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleProcess();
    });

    logoutBtn.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } finally {
        window.location.href = '/login';
      }
    });

    document.getElementById('exportBoletinBtn').addEventListener('click', exportBoletin);

    historyToggle.addEventListener('click', async () => {
      const isVisible = historyPanel.classList.contains('visible');
      if (!isVisible) {
        await loadHistory();
        historyPanel.classList.add('visible');
      } else {
        historyPanel.classList.remove('visible');
      }
    });
  }

  // ==========================================
  // TAB NAVIGATION
  // ==========================================

  function setupTabNav() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabName = btn.dataset.tab;

        // Actualizar estado visual activo
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        const panel = document.getElementById(`tab-${tabName}`);
        if (panel) panel.classList.add('active');

        // On-demand: disparar carga si hay URL activa y la sección no se cargó
        if (!INITIAL_TABS.has(tabName) && currentUrl) {
          const sectionKey = TAB_SECTION_MAP[tabName];
          if (!sectionKey) return;
          const state = sectionState[sectionKey] || 'idle';
          if (state === 'idle') {
            loadSection(tabName, sectionKey);
          }
        }
      });
    });
  }

  // ==========================================
  // ON-DEMAND: CARGAR SECCIÓN
  // ==========================================

  async function loadSection(tabName, sectionKey) {
    if (!currentUrl) return;
    if ((sectionState[sectionKey] || 'idle') !== 'idle') return;

    sectionState[sectionKey] = 'loading';
    renderSectionStatus(tabName, 'loading');
    // angulo y streaming comparten sección — actualizar ambos
    if (sectionKey === 'angulo') renderSectionStatus('streaming', 'loading');

    try {
      const res = await fetch(`/api/section/${sectionKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: currentUrl }),
      });
      const result = await res.json();

      if (!res.ok) throw new Error(result.error || 'Error al generar la sección');

      sectionState[sectionKey] = 'loaded';
      applySection(sectionKey, result.data);

    } catch (err) {
      sectionState[sectionKey] = 'idle'; // permite reintento al hacer clic de nuevo
      renderSectionStatus(tabName, 'error');
      if (sectionKey === 'angulo') renderSectionStatus('streaming', 'error');
      console.error(`[section/${sectionKey}]`, err.message);
    }
  }

  // Aplica los datos de una sección a currentData y la renderiza
  function applySection(sectionKey, data) {
    if (!currentData) currentData = {};
    switch (sectionKey) {
      case 'resumen':
        currentData.resumen = data;
        renderResumen(data);
        break;
      case 'entrevistas':
        currentData.entrevistas = data;
        renderEntrevistas(data);
        break;
      case 'musica':
        currentData.musica = data;
        renderMusica(data);
        break;
      case 'videos':
        currentData.videos = data;
        renderVideos(data);
        break;
      case 'angulo':
        currentData.angulo = data?.angulo || null;
        currentData.streaming = data?.streaming || null;
        renderAngulo(data?.angulo || null);
        renderStreaming(data?.streaming || null);
        break;
      case 'otrasfuentes':
        currentData.otrasFuentes = data;
        renderOtrasFuentes(data);
        break;
      case 'opinion':
        currentData.opinion = data;
        renderOpinion(data);
        break;
    }
  }

  // Muestra estado transitorio en el contenedor de una sección
  function renderSectionStatus(tabName, status) {
    const sel = SECTION_CONTAINERS[tabName];
    if (!sel) return;
    const el = document.querySelector(sel);
    if (!el) return;

    if (tabName === 'resumen') {
      const msgs = {
        loading: 'Generando...',
        error: 'Error al cargar. Hacé clic para reintentar.',
        pending: 'Hacé clic para cargar esta sección.',
      };
      el.textContent = msgs[status] || '';
    } else {
      const msgs = {
        loading: '<p class="seccion-no-disponible">Generando...</p>',
        error: '<p class="seccion-no-disponible">Error al cargar. Hacé clic para reintentar.</p>',
        pending: '<p class="seccion-no-disponible">Hacé clic para cargar esta sección.</p>',
      };
      el.innerHTML = msgs[status] || '';
    }
  }

  // Deja todas las secciones on-demand en estado pendiente
  function resetDemandSections() {
    sectionState = {};
    for (const tabName of Object.keys(SECTION_CONTAINERS)) {
      renderSectionStatus(tabName, 'pending');
    }
  }

  // ==========================================
  // COPY BUTTONS
  // ==========================================

  function setupCopyButtons() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-copy');
      if (!btn) return;

      const copyTarget = btn.dataset.copy;
      if (!copyTarget || !currentData) return;

      const text = buildCopyText(copyTarget);
      if (!text) return;

      navigator.clipboard.writeText(text).then(() => {
        const original = btn.textContent;
        btn.textContent = '¡Copiado!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = original;
          btn.classList.remove('copied');
        }, 2000);
      }).catch(() => {
        const el = document.createElement('textarea');
        el.value = text;
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      });
    });
  }

  function buildCopyText(target) {
    if (!currentData) return '';

    switch (target) {
      case 'resumen':
        return currentData.resumen || '';

      case 'boletin': {
        const b = currentData.boletin;
        if (!b) return '';
        const lines = [b.titulo, ''];
        if (b.bajadas) b.bajadas.forEach(bajada => lines.push(bajada, ''));
        return lines.join('\n').trim();
      }

      case 'contexto': {
        if (!currentData.contexto) return '';
        return currentData.contexto.map(c =>
          `${c.dato}\n→ ${c.traduccion}`
        ).join('\n\n');
      }

      case 'entrevistas': {
        if (!currentData.entrevistas) return '';
        const catLabels = { experto: 'Experto académico', critico: 'Voz crítica', afectado: 'Afectado directo' };
        return currentData.entrevistas.map((e, i) => {
          const cat = e.categoria ? `[${catLabels[e.categoria] || e.categoria}] ` : '';
          return `${i + 1}. ${cat}${e.nombre} — ${e.rol}\n` +
            `Justificación: ${e.justificacion}\n` +
            `Declaración: ${e.declaracion}\n` +
            `Pregunta clave: ${e.pregunta}`;
        }).join('\n\n');
      }

      case 'musica': {
        if (!currentData.musica) return '';
        const catLabels = { sutil: 'Lo sutil', nacional: 'Nacional', internacional: 'Internacional', clasica: 'Clásica / Instrumental', esperada: 'Lo esperado' };
        return currentData.musica.map((m, i) => {
          const meta = [m.anio, m.genero].filter(Boolean).join(', ');
          const cat = m.categoria ? `[${catLabels[m.categoria] || m.categoria}] ` : '';
          return `${i + 1}. ${cat}${m.cancion} — ${m.artista}${meta ? ` (${meta})` : ''}\n${m.conexion}`;
        }).join('\n\n');
      }

      case 'angulo': {
        if (!currentData.angulo) return '';
        const tipoLabels = { critico: 'Ángulo crítico', humano: 'Ángulo humano', inesperado: 'Ángulo inesperado' };
        return currentData.angulo.map((a, i) => {
          const tipo = a.tipo ? tipoLabels[a.tipo] || a.tipo : `Ángulo ${i + 1}`;
          return `${tipo}: ${a.titulo}\n${a.contenido}`;
        }).join('\n\n');
      }

      case 'streaming-gancho': {
        const ganchos = currentData.streaming?.ganchos || (currentData.streaming?.gancho ? [currentData.streaming.gancho] : []);
        return ganchos.join('\n\n');
      }
      case 'streaming-titulo': {
        const titulos = currentData.streaming?.titulos_youtube || (currentData.streaming?.titulo_youtube ? [currentData.streaming.titulo_youtube] : []);
        return titulos.join('\n\n');
      }
      case 'streaming-descripcion':
        return currentData.streaming?.descripcion || '';
      case 'streaming-hashtags':
        return (currentData.streaming?.hashtags || []).join(' ');

      default:
        return '';
    }
  }

  // ==========================================
  // PROCESS ARTICLE
  // ==========================================

  async function handleProcess() {
    const url = urlInput.value.trim();

    if (!url) {
      showError('Ingresá una URL para procesar.');
      return;
    }

    try {
      new URL(url);
    } catch {
      showError('La URL no es válida. Asegurate de incluir https:// al principio.');
      return;
    }

    hideError();
    hideArticleMeta();
    hideTabs();
    showLoading();

    processBtn.disabled = true;
    processBtn.textContent = 'Interpretando...';
    urlInput.disabled = true;

    // Resetear estado completo
    currentData = {};
    currentUrl = url;
    sectionState = {};

    startLoadingAnimation();

    try {
      const response = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Error al procesar la noticia');
      }

      currentData = { ...result.data, id: result.id };

      // Renderizar solo las secciones de la carga inicial
      renderBoletin(currentData.boletin);
      renderContexto(currentData.contexto);

      // Dejar secciones on-demand en estado pendiente
      resetDemandSections();

      showTabs();
      document.querySelector('.tab-btn[data-tab="boletin"]')?.click();
      stopLoadingAnimation(true);

    } catch (err) {
      stopLoadingAnimation(false);
      showError(friendlyError(err.message));
    } finally {
      processBtn.disabled = false;
      processBtn.textContent = 'Interpretar';
      urlInput.disabled = false;
    }
  }

  // ==========================================
  // EXPORT BOLETÍN A .DOCX
  // ==========================================

  async function exportBoletin() {
    if (!currentData?.boletin) return;
    const btn = document.getElementById('exportBoletinBtn');
    const originalText = btn.textContent;
    btn.textContent = 'Generando...';
    btn.disabled = true;

    try {
      const res = await fetch('/api/export/boletin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titulo: currentData.boletin.titulo,
          bajadas: currentData.boletin.bajadas,
          articleTitle: currentData.title,
        }),
      });

      if (!res.ok) throw new Error('Error al generar el archivo');

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = (currentData.title || 'boletin').slice(0, 40).replace(/[^a-z0-9áéíóúñ\s]/gi, '').trim().replace(/\s+/g, '-') + '.docx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      console.error('Export error:', err);
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  }

  function friendlyError(msg) {
    if (!msg) return 'Ocurrió un error inesperado. Intentá de nuevo.';
    if (msg === 'ANÁLISIS_INCOMPLETO')
      return 'El análisis no pudo completarse. Revisá los logs del servidor e intentá de nuevo.';
    if (msg.includes('rate_limit') || msg.includes('429') || msg.includes('límite'))
      return 'Límite de uso alcanzado. El sistema reintentará automáticamente. Si el error persiste, esperá un minuto.';
    if (msg.includes('No se pudo acceder'))
      return 'No se pudo acceder al artículo. Verificá que la URL sea correcta y que el sitio esté disponible.';
    if (msg.includes('No se pudo obtener el contenido'))
      return 'No se pudo leer el contenido del artículo. Probá con otra URL o verificá que el sitio no requiera suscripción.';
    if (msg.includes('JSON') || msg.includes('parse'))
      return 'Error al procesar la respuesta. Intentá de nuevo en unos segundos.';
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('NetworkError'))
      return 'Error de conexión. Verificá tu internet y volvé a intentarlo.';
    if (msg.includes('timeout'))
      return 'La operación tardó demasiado. Intentá de nuevo en unos segundos.';
    // Return the original message if it's already in Spanish and readable
    if (/[áéíóúñü]/i.test(msg) || msg.length < 120) return msg;
    return 'Ocurrió un error al procesar la noticia. Intentá de nuevo.';
  }

  // ==========================================
  // LOADING ANIMATION
  // ==========================================

  function startLoadingAnimation() {
    loadingStep = 0;
    loadingProgress = 5;
    loadingStatus.textContent = LOADING_MESSAGES[0];
    loadingBar.style.width = '5%';

    const stepDuration = 7000;
    const progressStep = 30;

    loadingInterval = setInterval(() => {
      loadingStep = (loadingStep + 1) % LOADING_MESSAGES.length;
      loadingStatus.textContent = LOADING_MESSAGES[loadingStep];
      loadingProgress = Math.min(loadingProgress + progressStep, 90);
      loadingBar.style.width = `${loadingProgress}%`;
    }, stepDuration);
  }

  function stopLoadingAnimation(success) {
    if (loadingInterval) {
      clearInterval(loadingInterval);
      loadingInterval = null;
    }

    if (success) {
      loadingBar.style.width = '100%';
      loadingStatus.textContent = 'Listo.';
      setTimeout(hideLoading, 600);
    } else {
      hideLoading();
    }
  }

  // ==========================================
  // UI STATE HELPERS
  // ==========================================

  function showLoading() { loadingSection.classList.add('visible'); }
  function hideLoading() { loadingSection.classList.remove('visible'); }
  function showError(message) { processError.textContent = message; processError.classList.add('visible'); }
  function hideError() { processError.classList.remove('visible'); }

  function showArticleMeta() {}
  function hideArticleMeta() {}
  function showTabs() { tabsSection.classList.add('visible'); }
  function hideTabs() { tabsSection.classList.remove('visible'); }

  // ==========================================
  // RENDER ALL SECTIONS
  // ==========================================

  function renderAll(data) {
    renderBoletin(data.boletin);
    renderResumen(data.resumen);
    renderContexto(data.contexto);
    renderEntrevistas(data.entrevistas);
    renderMusica(data.musica);
    renderVideos(data.videos);
    renderAngulo(data.angulo);
    renderStreaming(data.streaming);
    renderOtrasFuentes(data.otrasFuentes);
    renderOpinion(data.opinion);
  }

  // ==========================================
  // RENDER: BOLETÍN
  // ==========================================

  function renderBoletin(boletin) {
    if (!boletin) {
      document.getElementById('boletinTitulo').textContent = '';
      document.getElementById('boletinBajadas').innerHTML = '<p class="seccion-no-disponible">No disponible</p>';
      return;
    }

    document.getElementById('boletinTitulo').textContent = upperES(boletin.titulo || '');

    const container = document.getElementById('boletinBajadas');
    container.innerHTML = '';

    if (boletin.bajadas && Array.isArray(boletin.bajadas)) {
      boletin.bajadas.forEach(bajada => {
        const p = document.createElement('p');
        p.className = 'boletin-bajada';
        p.textContent = upperES(bajada);
        container.appendChild(p);
      });
    }
  }

  // ==========================================
  // RENDER: RESUMEN
  // ==========================================

  function renderResumen(resumen) {
    const el = document.getElementById('resumenText');
    el.textContent = resumen || 'No hay resumen disponible.';
  }

  // ==========================================
  // RENDER: CONTEXTO
  // ==========================================

  function renderContexto(contexto) {
    const list = document.getElementById('contextoList');
    if (!list) return;
    list.innerHTML = '';

    if (!contexto || !Array.isArray(contexto) || contexto.length === 0) {
      list.innerHTML = '<div style="color:var(--gray-400);font-size:14px;">No se encontraron datos numéricos para contextualizar.</div>';
      return;
    }

    contexto.forEach(item => {
      const el = document.createElement('div');
      el.className = 'contexto-item';
      el.innerHTML = `
        <div class="contexto-dato">${escapeHtml(upperES(item.dato || ''))}</div>
        <span class="contexto-flecha">↓</span>
        <div class="contexto-traduccion">${escapeHtml(item.traduccion || '')}</div>
      `;
      list.appendChild(el);
    });
  }

  // ==========================================
  // RENDER: ENTREVISTAS
  // ==========================================

  function renderEntrevistas(entrevistas) {
    const grid = document.getElementById('entrevistasGrid');
    grid.innerHTML = '';

    if (!entrevistas || !Array.isArray(entrevistas)) {
      grid.innerHTML = '<p class="seccion-no-disponible">No disponible</p>';
      return;
    }

    const categories = [
      { key: 'experto', label: 'Expertos académicos' },
      { key: 'critico', label: 'Voces críticas' },
      { key: 'afectado', label: 'Afectados directos' },
    ];

    const hasCats = entrevistas.some(e => e.categoria);

    if (hasCats) {
      categories.forEach(cat => {
        const group = entrevistas.filter(e => e.categoria === cat.key);
        if (group.length === 0) return;

        const header = document.createElement('div');
        header.className = 'entrevistas-categoria-header';
        header.textContent = upperES(cat.label);
        grid.appendChild(header);

        const subgrid = document.createElement('div');
        subgrid.className = 'entrevistas-subgrid';
        if (group.length % 2 !== 0) subgrid.classList.add('impar');
        group.forEach(e => subgrid.appendChild(buildEntrevistaCard(e)));
        grid.appendChild(subgrid);
      });

      // Uncategorized fallback
      const uncategorized = entrevistas.filter(e => !e.categoria);
      if (uncategorized.length > 0) {
        const subgrid = document.createElement('div');
        subgrid.className = 'entrevistas-subgrid';
        if (uncategorized.length % 2 !== 0) subgrid.classList.add('impar');
        uncategorized.forEach(e => subgrid.appendChild(buildEntrevistaCard(e)));
        grid.appendChild(subgrid);
      }
    } else {
      const subgrid = document.createElement('div');
      subgrid.className = 'entrevistas-subgrid';
      if (entrevistas.length % 2 !== 0) subgrid.classList.add('impar');
      entrevistas.forEach(e => subgrid.appendChild(buildEntrevistaCard(e)));
      grid.appendChild(subgrid);
    }
  }

  function buildEntrevistaCard(e) {
    const card = document.createElement('div');
    card.className = 'entrevista-card';
    card.innerHTML = `
      <div class="entrevista-nombre">${escapeHtml(e.nombre || '')}</div>
      <div class="entrevista-rol">${escapeHtml(e.rol || '')}</div>
      <div class="entrevista-justificacion">${escapeHtml(e.justificacion || '')}</div>
      <div class="entrevista-declaracion">${escapeHtml(e.declaracion || '')}</div>
      <div class="entrevista-pregunta-label">${upperES('Pregunta clave')}</div>
      <div class="entrevista-pregunta">${escapeHtml(e.pregunta || '')}</div>
    `;
    return card;
  }

  // ==========================================
  // RENDER: MÚSICA
  // ==========================================

  function renderMusica(musica) {
    const list = document.getElementById('musicaList');
    list.innerHTML = '';

    if (!musica || !Array.isArray(musica)) {
      list.innerHTML = '<p class="seccion-no-disponible">No disponible</p>';
      return;
    }

    const CATEGORIAS = [
      { key: 'sutil',          label: 'Lo sutil' },
      { key: 'nacional',       label: 'Nacional' },
      { key: 'internacional',  label: 'Internacional' },
      { key: 'clasica',        label: 'Clásica / Instrumental' },
      { key: 'esperada',       label: 'Lo esperado' },
    ];

    const hasCats = musica.some(t => t.categoria);

    if (hasCats) {
      let globalIndex = 0;
      CATEGORIAS.forEach(cat => {
        const group = musica.filter(t => t.categoria === cat.key);
        if (group.length === 0) return;

        const header = document.createElement('div');
        header.className = cat.key === 'esperada'
          ? 'musica-categoria-header esperada'
          : 'musica-categoria-header';
        if (cat.key === 'esperada') {
          header.innerHTML = `${escapeHtml(upperES(cat.label))}<span class="musica-categoria-subtexto">la opción predecible — usala con criterio</span>`;
        } else {
          header.textContent = upperES(cat.label);
        }
        list.appendChild(header);

        const groupEl = document.createElement('div');
        groupEl.className = cat.key === 'esperada'
          ? 'musica-categoria-group esperada'
          : 'musica-categoria-group';
        group.forEach(track => {
          globalIndex++;
          groupEl.appendChild(buildMusicaItem(track, globalIndex));
        });
        list.appendChild(groupEl);
      });

      // Fallback: sin categoría
      const uncategorized = musica.filter(t => !t.categoria);
      if (uncategorized.length > 0) {
        const groupEl = document.createElement('div');
        groupEl.className = 'musica-categoria-group';
        uncategorized.forEach(track => {
          globalIndex++;
          groupEl.appendChild(buildMusicaItem(track, globalIndex));
        });
        list.appendChild(groupEl);
      }
    } else {
      const groupEl = document.createElement('div');
      groupEl.className = 'musica-categoria-group';
      musica.forEach((track, i) => groupEl.appendChild(buildMusicaItem(track, i + 1)));
      list.appendChild(groupEl);
    }
  }

  function buildMusicaItem(track, index) {
    const item = document.createElement('div');
    item.className = 'musica-item';

    const searchUrl = track.youtube_url ||
      `https://www.youtube.com/results?search_query=${encodeURIComponent(track.youtube_query || `${track.artista} ${track.cancion}`)}`;

    const metaParts = [track.anio, track.genero].filter(Boolean);
    const metaHtml = metaParts.length
      ? ` <span class="musica-meta">${escapeHtml(metaParts.join(' · '))}</span>`
      : '';

    const lastfmBtn = track.lastfm_url
      ? `<a href="${escapeHtml(track.lastfm_url)}" target="_blank" rel="noopener noreferrer" class="btn-lastfm">Last.fm</a>`
      : '';

    item.innerHTML = `
      <div class="musica-num">${index}</div>
      <div class="musica-info">
        <div class="musica-track">${escapeHtml(track.cancion || '')}</div>
        <div class="musica-artista">${escapeHtml(track.artista || '')}${metaHtml}</div>
        <div class="musica-conexion">${escapeHtml(track.conexion || '')}</div>
      </div>
      <div class="musica-links">
        <a href="${escapeHtml(searchUrl)}" target="_blank" rel="noopener noreferrer" class="btn-youtube">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-2.75 12.37 12.37 0 0 0-1.82-.17C8.2 3.77 5 7.23 5 12s3.2 8.23 9 8.23 9-3.47 9-8.23a8.05 8.05 0 0 0-.54-2.9 4.84 4.84 0 0 1-2.87-2.41zM10 15.5V8.5l6 3.5-6 3.5z"/>
          </svg>
          YouTube
        </a>
        ${lastfmBtn}
      </div>
    `;
    return item;
  }

  // ==========================================
  // RENDER: VIDEOS
  // ==========================================

  function renderVideos(videos) {
    const container = document.getElementById('videosContent');
    container.innerHTML = '';

    if (!videos || !videos.available) {
      container.innerHTML = `
        <div class="videos-unavailable">
          <div style="font-size:32px;margin-bottom:12px;">📺</div>
          <div style="font-weight:600;color:var(--black);margin-bottom:6px;">Videos no disponibles</div>
          <div>Configurá una YouTube API Key en el archivo .env para ver videos relacionados</div>
        </div>
      `;
      return;
    }

    if (videos.noResults) {
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(videos.suggestedQuery || '')}`;
      container.innerHTML = `
        <div class="videos-unavailable">
          <div style="font-size:32px;margin-bottom:12px;">📺</div>
          <div style="font-weight:600;color:var(--black);margin-bottom:8px;">No encontramos videos sobre esta noticia.</div>
          <div>Buscá en YouTube: <a href="${escapeHtml(searchUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--yellow);text-decoration:underline;">${escapeHtml(videos.suggestedQuery || '')}</a></div>
        </div>
      `;
      return;
    }

    if (!videos.videos || videos.videos.length === 0) {
      container.innerHTML = `<div class="videos-unavailable">No se encontraron videos relacionados con esta noticia.</div>`;
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'videos-grid';

    videos.videos.forEach(video => {
      const card = document.createElement('div');
      card.className = 'video-card';
      card.innerHTML = `
        <img
          class="video-thumbnail"
          src="${escapeHtml(video.thumbnail)}"
          alt="${escapeHtml(video.title)}"
          loading="lazy"
          onerror="this.style.background='var(--gray-50)';this.style.height='148px'"
        />
        <div class="video-info">
          <div class="video-title">${escapeHtml(video.title)}</div>
          <div class="video-channel">${escapeHtml(video.channelTitle)}</div>
          <a href="${escapeHtml(video.url)}" target="_blank" rel="noopener noreferrer" class="btn-watch">
            Ver en YouTube
          </a>
        </div>
      `;
      grid.appendChild(card);
    });

    container.appendChild(grid);
  }

  // ==========================================
  // RENDER: ÁNGULO
  // ==========================================

  function renderAngulo(angulo) {
    const list = document.getElementById('anguloList');
    list.innerHTML = '';

    if (!angulo || !Array.isArray(angulo)) {
      list.innerHTML = '<p class="seccion-no-disponible">No disponible</p>';
      return;
    }

    const tipoLabels = {
      critico: 'Ángulo crítico',
      humano: 'Ángulo humano',
      inesperado: 'Ángulo inesperado',
    };

    angulo.forEach((a, i) => {
      const item = document.createElement('div');
      item.className = 'angulo-item';
      const tipoLabel = a.tipo ? (tipoLabels[a.tipo] || a.tipo) : `Ángulo ${i + 1}`;
      item.innerHTML = `
        <div class="angulo-tipo-badge">${escapeHtml(upperES(tipoLabel))}</div>
        <div class="angulo-titulo">${escapeHtml(a.titulo || '')}</div>
        <div class="angulo-contenido">${escapeHtml(a.contenido || '')}</div>
      `;
      list.appendChild(item);
    });
  }

  // ==========================================
  // RENDER: STREAMING
  // ==========================================

  function renderStreaming(streaming) {
    const container = document.getElementById('streamingSections');
    container.innerHTML = '';

    if (!streaming) {
      container.innerHTML = '<p class="seccion-no-disponible">No disponible</p>';
      return;
    }

    // Backward compat: handle both old (gancho/titulo_youtube) and new (ganchos/titulos_youtube)
    const ganchos = streaming.ganchos || (streaming.gancho ? [streaming.gancho] : []);
    const titulos = streaming.titulos_youtube || (streaming.titulo_youtube ? [streaming.titulo_youtube] : []);
    const tags = streaming.hashtags || [];

    const sections = [
      {
        label: `Gancho de apertura`,
        copyKey: 'streaming-gancho',
        html: ganchos.map((g, i) => `
          <div class="streaming-opcion-label">${upperES(`Opción ${i + 1}`)}</div>
          <div class="streaming-gancho">${escapeHtml(g)}</div>
        `).join(''),
      },
      {
        label: 'Título para YouTube',
        copyKey: 'streaming-titulo',
        html: titulos.map((t, i) => `
          <div class="streaming-opcion-label">${upperES(`Opción ${i + 1}`)}</div>
          <div class="streaming-titulo">${escapeHtml(t)}</div>
        `).join(''),
      },
      {
        label: 'Descripción optimizada',
        copyKey: 'streaming-descripcion',
        html: `<div class="streaming-descripcion">${escapeHtml(streaming.descripcion || '')}</div>`,
      },
      {
        label: `Hashtags (${tags.length})`,
        copyKey: 'streaming-hashtags',
        html: `<div class="hashtags-container">${tags.map(tag => `<span class="hashtag-tag">${escapeHtml(tag)}</span>`).join('')}</div>`,
      },
    ];

    sections.forEach(section => {
      const block = document.createElement('div');
      block.className = 'streaming-block';
      block.innerHTML = `
        <div class="streaming-block-header">
          <span class="streaming-block-label">${upperES(section.label)}</span>
          <button class="btn-copy" data-copy="${section.copyKey}">Copiar</button>
        </div>
        <div class="streaming-block-body">${section.html}</div>
      `;
      container.appendChild(block);
    });
  }

  // ==========================================
  // RENDER: OTRAS FUENTES
  // ==========================================

  function renderOtrasFuentes(fuentes) {
    const list = document.getElementById('fuentesList');
    list.innerHTML = '';

    if (!fuentes || !Array.isArray(fuentes) || fuentes.length === 0) {
      list.innerHTML = '<div class="fuentes-unavailable">No se encontraron otras fuentes disponibles.</div>';
      return;
    }

    fuentes.forEach(f => {
      const card = document.createElement('a');
      card.className = 'fuente-card';
      card.href = escapeHtml(f.url || '#');
      card.target = '_blank';
      card.rel = 'noopener noreferrer';
      card.innerHTML = `
        <div class="fuente-medio">${escapeHtml(f.medio || '')}</div>
        <div class="fuente-titulo">${escapeHtml(f.titulo || '')}</div>
        ${f.fecha ? `<div class="fuente-fecha">${escapeHtml(f.fecha)}</div>` : ''}
        <div class="fuente-arrow">Abrir artículo →</div>
      `;
      list.appendChild(card);
    });
  }

  // ==========================================
  // RENDER: OPINIÓN
  // ==========================================

  function renderOpinion(columnas) {
    const list = document.getElementById('opinionList');
    list.innerHTML = '';

    if (!columnas || !Array.isArray(columnas) || columnas.length === 0) {
      list.innerHTML = '<div class="opinion-unavailable">No encontramos columnas de opinión sobre este tema. Probá con una noticia de mayor repercusión mediática.</div>';
      return;
    }

    columnas.forEach(c => {
      const card = document.createElement('a');
      card.className = 'opinion-card';
      card.href = escapeHtml(c.url || '#');
      card.target = '_blank';
      card.rel = 'noopener noreferrer';
      card.innerHTML = `
        <div class="opinion-columnista">${escapeHtml(c.columnista || '')}</div>
        <div class="opinion-titulo">${escapeHtml(c.titulo || '')}</div>
        <div class="opinion-medio-fecha">
          ${c.medio ? `<span class="opinion-medio">${escapeHtml(c.medio)}</span>` : ''}
          ${c.fecha ? `<span class="opinion-fecha">${escapeHtml(c.fecha)}</span>` : ''}
        </div>
        <div class="opinion-arrow">Leer columna →</div>
      `;
      list.appendChild(card);
    });
  }

  // ==========================================
  // HISTORY
  // ==========================================

  async function loadHistory() {
    try {
      const res = await fetch('/api/history');
      if (!res.ok) return;
      const data = await res.json();
      renderHistory(data.data || []);
    } catch (err) {
      console.error('Error loading history:', err);
    }
  }

  function renderHistory(items) {
    historyList.innerHTML = '';

    if (!items || items.length === 0) {
      historyList.innerHTML = '<div class="history-empty">No hay análisis previos</div>';
      return;
    }

    items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'history-item';

      const date = new Date(item.created_at);
      const dateStr = date.toLocaleDateString('es-AR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });

      el.innerHTML = `
        <div style="flex:1;min-width:0;">
          <div class="history-item-title">${escapeHtml(item.title || item.url)}</div>
          <div class="history-item-meta">${item.source ? escapeHtml(item.source) + ' · ' : ''}${dateStr}</div>
        </div>
        <span class="history-item-arrow">›</span>
      `;

      el.addEventListener('click', () => loadHistoryItem(item.id));
      historyList.appendChild(el);
    });
  }

  async function loadHistoryItem(id) {
    try {
      const res = await fetch(`/api/history/${id}`);
      if (!res.ok) return;

      const data = await res.json();
      if (data.data && data.data.result) {
        currentData = data.data.result;
        currentUrl = data.data.url || null;
        urlInput.value = currentUrl || '';

        // Marcar como loaded las secciones que ya tienen datos en el historial
        sectionState = {};
        if (currentData.resumen)     sectionState['resumen']      = 'loaded';
        if (currentData.entrevistas) sectionState['entrevistas']  = 'loaded';
        if (currentData.musica)      sectionState['musica']       = 'loaded';
        if (currentData.videos)      sectionState['videos']       = 'loaded';
        if (currentData.angulo || currentData.streaming) sectionState['angulo'] = 'loaded';
        if (currentData.otrasFuentes) sectionState['otrasfuentes'] = 'loaded';
        if (currentData.opinion)     sectionState['opinion']      = 'loaded';

        renderAll(currentData);
        // Secciones faltantes quedan en 'idle' — se cargan on-demand al hacer clic
        for (const tabName of Object.keys(SECTION_CONTAINERS)) {
          const key = TAB_SECTION_MAP[tabName];
          if (key && !sectionState[key]) {
            renderSectionStatus(tabName, 'pending');
          }
        }

        showTabs();
        historyPanel.classList.remove('visible');
        document.querySelector('.tab-btn[data-tab="boletin"]')?.click();
        document.querySelector('.tabs-nav')?.scrollIntoView({ behavior: 'smooth' });
      }
    } catch (err) {
      console.error('Error loading history item:', err);
    }
  }

  // ==========================================
  // UTILITIES
  // ==========================================

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function upperES(str) {
    if (typeof str !== 'string') return '';
    return str.toLocaleUpperCase('es-AR');
  }

  // ==========================================
  // START
  // ==========================================

  init();

})();
