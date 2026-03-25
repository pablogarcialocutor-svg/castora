// ============================================
// Castora — Auth Page Logic
// ============================================

(function () {
  'use strict';

  // Tab switching
  const tabs = document.querySelectorAll('.login-tab');
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const which = tab.dataset.tab;
      if (which === 'login') {
        loginForm.style.display = '';
        registerForm.style.display = 'none';
      } else {
        loginForm.style.display = 'none';
        registerForm.style.display = '';
      }

      // Clear errors
      document.getElementById('loginError').classList.remove('visible');
      document.getElementById('registerError').classList.remove('visible');
    });
  });

  // Show error helper
  function showError(elementId, message) {
    const el = document.getElementById(elementId);
    el.textContent = message;
    el.classList.add('visible');
  }

  function hideError(elementId) {
    document.getElementById(elementId).classList.remove('visible');
  }

  function setLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    btn.disabled = loading;
    if (loading) {
      btn.dataset.originalText = btn.textContent;
      btn.textContent = 'Cargando...';
    } else {
      btn.textContent = btn.dataset.originalText || btn.textContent;
    }
  }

  // Login form
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError('loginError');

    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!email || !password) {
      showError('loginError', 'Completá todos los campos');
      return;
    }

    setLoading('loginBtn', true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        window.location.href = '/';
      } else {
        showError('loginError', data.error || 'Error al iniciar sesión');
      }
    } catch (err) {
      showError('loginError', 'Error de conexión. Intentá de nuevo.');
    } finally {
      setLoading('loginBtn', false);
    }
  });

  // Register form
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError('registerError');

    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;

    if (!email || !password) {
      showError('registerError', 'Completá todos los campos');
      return;
    }

    if (password.length < 6) {
      showError('registerError', 'La contraseña debe tener al menos 6 caracteres');
      return;
    }

    setLoading('registerBtn', true);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        window.location.href = '/';
      } else {
        showError('registerError', data.error || 'Error al crear la cuenta');
      }
    } catch (err) {
      showError('registerError', 'Error de conexión. Intentá de nuevo.');
    } finally {
      setLoading('registerBtn', false);
    }
  });

  // Allow Enter key to submit
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const activeTab = document.querySelector('.login-tab.active');
      if (activeTab && activeTab.dataset.tab === 'login') {
        loginForm.requestSubmit();
      } else {
        registerForm.requestSubmit();
      }
    }
  });
})();
