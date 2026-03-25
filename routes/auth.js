import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getUserByEmail, createUser } from '../db/database.js';

const router = Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'El email y la contraseña son obligatorios' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, error: 'El email no es válido' });
    }

    const existing = getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ success: false, error: 'Ya existe una cuenta con ese email' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = createUser(email.toLowerCase().trim(), hashedPassword);

    req.session.userId = user.id;
    req.session.userEmail = user.email;

    return res.json({ success: true, user: { id: user.id, email: user.email } });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ success: false, error: 'Error al crear la cuenta' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'El email y la contraseña son obligatorios' });
    }

    const user = getUserByEmail(email.toLowerCase().trim());
    if (!user) {
      return res.status(401).json({ success: false, error: 'Email o contraseña incorrectos' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Email o contraseña incorrectos' });
    }

    req.session.userId = user.id;
    req.session.userEmail = user.email;

    return res.json({ success: true, user: { id: user.id, email: user.email } });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ success: false, error: 'Error al iniciar sesión' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Error al cerrar sesión' });
    }
    res.clearCookie('connect.sid');
    return res.json({ success: true });
  });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  return res.json({ user: { id: req.session.userId, email: req.session.userEmail } });
});

export default router;
