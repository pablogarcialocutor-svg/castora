import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = join(__dirname, 'castora.db');

let db = null;
let SQL = null;

// Load sql.js (CommonJS compatible)
async function getSqlJs() {
  if (SQL) return SQL;
  // sql.js exports a factory via CommonJS
  const initSqlJs = require('../node_modules/sql.js/dist/sql-asm.js');
  SQL = await initSqlJs();
  return SQL;
}

// Persist DB to disk
function persist() {
  if (!db) return;
  const data = db.export();
  writeFileSync(DB_PATH, Buffer.from(data));
}

// Initialize database
export async function initDb() {
  const SQL = await getSqlJs();

  if (existsSync(DB_PATH)) {
    const fileBuffer = readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      source TEXT,
      result TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY NOT NULL,
      sess TEXT NOT NULL,
      expired INTEGER NOT NULL
    )
  `);

  persist();
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

// Helper: run a SELECT and return all rows as objects
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// Helper: run a SELECT and return first row
function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows[0] || null;
}

// Helper: run INSERT/UPDATE/DELETE
function execute(sql, params = []) {
  db.run(sql, params);
  // Get last insert rowid
  const result = queryOne('SELECT last_insert_rowid() as id');
  persist();
  return result ? result.id : null;
}

// ==========================================
// USER OPERATIONS
// ==========================================

export function getUserByEmail(email) {
  return queryOne('SELECT * FROM users WHERE email = ?', [email]);
}

export function createUser(email, hashedPassword) {
  const id = execute(
    'INSERT INTO users (email, password) VALUES (?, ?)',
    [email, hashedPassword]
  );
  return { id, email };
}

// ==========================================
// ANALYSIS OPERATIONS
// ==========================================

export function saveAnalysis(userId, url, title, source, result) {
  // Count existing analyses for this user
  const countRow = queryOne('SELECT COUNT(*) as cnt FROM analyses WHERE user_id = ?', [userId]);
  const count = countRow ? countRow.cnt : 0;

  // Delete oldest if over limit (keep max 19, then insert new = 20)
  if (count >= 20) {
    const toDelete = count - 19;
    const oldest = queryAll(
      'SELECT id FROM analyses WHERE user_id = ? ORDER BY created_at ASC LIMIT ?',
      [userId, toDelete]
    );
    oldest.forEach(row => {
      db.run('DELETE FROM analyses WHERE id = ?', [row.id]);
    });
  }

  const id = execute(
    'INSERT INTO analyses (user_id, url, title, source, result, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))',
    [userId, url, title, source, JSON.stringify(result)]
  );

  return id;
}

export function getUserAnalyses(userId) {
  return queryAll(
    'SELECT id, url, title, source, created_at FROM analyses WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
    [userId]
  );
}

export function getRecentMusicFromUser(userId, limit = 5) {
  const rows = queryAll(
    'SELECT result FROM analyses WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    [userId, limit]
  );
  const songs = [];
  for (const row of rows) {
    try {
      const result = JSON.parse(row.result);
      if (result?.musica && Array.isArray(result.musica)) {
        for (const track of result.musica) {
          if (track.artista && track.cancion) {
            songs.push(`${track.artista} — ${track.cancion}`);
          }
        }
      }
    } catch {}
  }
  return [...new Set(songs)];
}

// ==========================================
// SESSION OPERATIONS
// ==========================================

export function sessionGet(sid) {
  const row = queryOne('SELECT sess, expired FROM sessions WHERE sid = ?', [sid]);
  if (!row) return null;
  if (row.expired < Date.now()) {
    db.run('DELETE FROM sessions WHERE sid = ?', [sid]);
    persist();
    return null;
  }
  try { return JSON.parse(row.sess); } catch { return null; }
}

export function sessionSet(sid, sess, maxAge) {
  const expired = Date.now() + (maxAge || 7 * 24 * 60 * 60 * 1000);
  db.run(
    'INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, ?)',
    [sid, JSON.stringify(sess), expired]
  );
  persist();
}

export function sessionDestroy(sid) {
  db.run('DELETE FROM sessions WHERE sid = ?', [sid]);
  persist();
}

export function sessionTouch(sid, sess, maxAge) {
  sessionSet(sid, sess, maxAge);
}

export function getAnalysisById(id, userId) {
  const row = queryOne(
    'SELECT * FROM analyses WHERE id = ? AND user_id = ?',
    [id, userId]
  );
  if (row && row.result) {
    try {
      row.result = JSON.parse(row.result);
    } catch (e) {
      row.result = null;
    }
  }
  return row;
}
