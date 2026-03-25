import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import authRouter from './routes/auth.js';
import apiRouter from './routes/api.js';
import { initDb, sessionGet, sessionSet, sessionDestroy, sessionTouch } from './db/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ==========================================
// SESSION STORE — persiste sesiones en SQLite
// ==========================================

class SqliteSessionStore extends session.Store {
  get(sid, cb) {
    try { cb(null, sessionGet(sid)); } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try { sessionSet(sid, sess, sess.cookie?.maxAge); cb(null); } catch (e) { cb(e); }
  }
  destroy(sid, cb) {
    try { sessionDestroy(sid); cb(null); } catch (e) { cb(e); }
  }
  touch(sid, sess, cb) {
    try { sessionTouch(sid, sess, sess.cookie?.maxAge); cb(null); } catch (e) { cb(e); }
  }
}

// ==========================================
// APP
// ==========================================

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new SqliteSessionStore(),
  secret: process.env.SESSION_SECRET || 'castora-dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

// Auth guard: intercepta index.html antes que express.static
app.use((req, res, next) => {
  if ((req.path === '/' || req.path === '/index.html') && !req.session.userId) {
    return res.redirect('/login');
  }
  next();
});

// Static files
app.use(express.static(join(__dirname, 'public')));

// Routes
app.use('/api/auth', authRouter);
app.use('/api', apiRouter);

// Serve login page
app.get('/login', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'login.html'));
});

// Serve main app
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ==========================================
// START
// ==========================================

async function start() {
  try {
    await initDb();
    console.log('Base de datos inicializada');

    app.listen(PORT, () => {
      console.log(`\nCastora corriendo en http://localhost:${PORT}`);
      console.log(`Presiona Ctrl+C para detener\n`);
    });
  } catch (err) {
    console.error('Error al iniciar la aplicación:', err);
    process.exit(1);
  }
}

start();
