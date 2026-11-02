require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const hasDatabase = Boolean(process.env.DATABASE_URL);
const port = Number(process.env.PORT || 3000);
const cookieName = 'defender_session';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : undefined,
});

if (isProduction && hasDatabase && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  console.error('SESSION_SECRET must be set to a random value of at least 32 characters in production.');
  process.exit(1);
}

const sessionSecret = process.env.SESSION_SECRET || 'local-development-secret-change-me';
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '20kb' }));
const publicDirectory = path.join(__dirname, 'public');
app.get(['/', '/index.html', '/styles.css', '/game.js'], (req, res, next) => {
  const fileName = req.path === '/' ? 'index.html' : path.basename(req.path);
  const filePath = [path.join(__dirname, fileName), path.join(publicDirectory, fileName)].find(fs.existsSync);
  if (!filePath) return next();
  res.sendFile(filePath, (error) => {
    if (error) next(error);
  });
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Give it a moment and try again.' },
});

function makeSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
  return crypto.createHmac('sha256', sessionSecret).update(token).digest('hex');
}

function setSessionCookie(res, token) {
  res.cookie(cookieName, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function readCookie(req, name) {
  const rawCookie = req.headers.cookie || '';
  const entry = rawCookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
}

async function requireUser(req, res, next) {
  try {
    if (!hasDatabase) return res.status(503).json({ error: 'Account services need DATABASE_URL. Guest play is available.' });
    const token = readCookie(req, cookieName);
    if (!token) return res.status(401).json({ error: 'Sign in to continue.' });

    const result = await pool.query(
      `SELECT users.id, users.username, users.best_score, users.best_wave
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = $1 AND sessions.expires_at > NOW()`,
      [hashToken(token)],
    );
    if (!result.rows[0]) return res.status(401).json({ error: 'Your session expired. Sign in again.' });

    req.user = result.rows[0];
    next();
  } catch (error) {
    next(error);
  }
}

app.get('/api/health', async (_req, res) => {
  if (!hasDatabase) return res.json({ ok: true, database: false });
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.post('/api/register', authLimiter, requireDatabase, async (req, res, next) => {
  try {
    const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!/^[a-zA-Z0-9_]{3,18}$/.test(username)) {
      return res.status(400).json({ error: 'Use 3–18 letters, numbers, or underscores for your callsign.' });
    }
    if (password.length < 8 || password.length > 72) {
      return res.status(400).json({ error: 'Password must be between 8 and 72 characters.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const created = await client.query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, best_score, best_wave',
        [username, passwordHash],
      );
      const token = makeSessionToken();
      await client.query(
        'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'30 days\')',
        [created.rows[0].id, hashToken(token)],
      );
      await client.query('COMMIT');
      setSessionCookie(res, token);
      res.status(201).json({ user: created.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') return res.status(409).json({ error: 'That callsign is already taken.' });
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

app.post('/api/login', authLimiter, requireDatabase, async (req, res, next) => {
  try {
    const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const result = await pool.query(
      'SELECT id, username, password_hash, best_score, best_wave FROM users WHERE LOWER(username) = LOWER($1)',
      [username],
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'That callsign and password do not match.' });
    }

    const token = makeSessionToken();
    await pool.query(
      'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'30 days\')',
      [user.id, hashToken(token)],
    );
    setSessionCookie(res, token);
    const { password_hash: _passwordHash, ...safeUser } = user;
    res.json({ user: safeUser });
  } catch (error) {
    next(error);
  }
});

app.post('/api/logout', async (req, res, next) => {
  try {
    const token = readCookie(req, cookieName);
    if (token && hasDatabase) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
    res.clearCookie(cookieName, { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/' });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/me', requireUser, (req, res) => {
  res.json({ user: req.user });
});

app.post('/api/run', requireUser, async (req, res, next) => {
  try {
    const score = Number(req.body.score);
    const wave = Number(req.body.wave);
    if (!Number.isSafeInteger(score) || score < 0 || score > 100000000 ||
        !Number.isSafeInteger(wave) || wave < 1 || wave > 10000) {
      return res.status(400).json({ error: 'That run data is not valid.' });
    }

    const result = await pool.query(
      `UPDATE users SET
         best_score = GREATEST(best_score, $2),
         best_wave = CASE WHEN $2 > best_score THEN $3 ELSE GREATEST(best_wave, $3) END
       WHERE id = $1
       RETURNING id, username, best_score, best_wave`,
      [req.user.id, score, wave],
    );
    res.json({ user: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/leaderboard', async (_req, res, next) => {
  if (!hasDatabase) return res.json({ players: [] });
  try {
    const result = await pool.query(
      'SELECT username, best_score, best_wave FROM users WHERE best_score > 0 ORDER BY best_score DESC, best_wave DESC LIMIT 10',
    );
    res.json({ players: result.rows });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error.code === '23505') return res.status(409).json({ error: 'That callsign is already taken.' });
  res.status(500).json({ error: 'The defense network hit a snag. Try again shortly.' });
});

async function start() {
  if (hasDatabase) await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(18) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      best_score INTEGER NOT NULL DEFAULT 0,
      best_wave INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash CHAR(64) NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (LOWER(username));
    CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at);
  `);
  app.listen(port, () => console.log(`Project Defenders online on port ${port}`));
}

function requireDatabase(_req, res, next) {
  if (!hasDatabase) return res.status(503).json({ error: 'Account services need DATABASE_URL. Guest play is available.' });
  next();
}

start().catch((error) => {
  console.error('Could not initialize the database:', error);
  process.exit(1);
});
