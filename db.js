// db.js — PostgreSQL database layer
'use strict';

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => console.error('[pg] Unexpected pool error:', err));

// ── SCHEMA INIT ───────────────────────────────────────────────
async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      username      TEXT NOT NULL,
      color_index   INTEGER NOT NULL DEFAULT 0,
      coins         INTEGER NOT NULL DEFAULT 0,
      inventory     JSONB NOT NULL DEFAULT '[]',
      outfit        JSONB NOT NULL DEFAULT '{}',
      verified      BOOLEAN NOT NULL DEFAULT FALSE,
      created_at    BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    );
    CREATE TABLE IF NOT EXISTS verify_tokens (
      token      TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reset_tokens (
      token      TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rooms (
      user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      room_name    TEXT NOT NULL DEFAULT 'My Room',
      wallpaper    TEXT NOT NULL DEFAULT 'default',
      flooring     TEXT NOT NULL DEFAULT 'default',
      placed_items JSONB NOT NULL DEFAULT '[]',
      updated_at   BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    );
  `);
  console.log('[db] Schema ready');
}

// ── HELPERS ───────────────────────────────────────────────────
function _parseUser(u) {
  if (!u) return null;
  // pg returns JSONB already parsed; guard against string just in case
  if (typeof u.inventory === 'string') u.inventory = JSON.parse(u.inventory);
  if (typeof u.outfit    === 'string') u.outfit    = JSON.parse(u.outfit);
  u.inventory = u.inventory || [];
  u.outfit    = u.outfit    || {};
  return u;
}

// ── USER QUERIES ──────────────────────────────────────────────
async function createUser({ id, email, passwordHash, username, colorIndex }) {
  await pool.query(
    `INSERT INTO users (id, email, password_hash, username, color_index)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, email.toLowerCase().trim(), passwordHash, username, colorIndex]
  );
  return getUserById(id);
}

async function getUserByEmail(email) {
  const { rows } = await pool.query(
    `SELECT * FROM users WHERE email = $1`,
    [email.toLowerCase().trim()]
  );
  return _parseUser(rows[0] || null);
}

async function getUserById(id) {
  const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
  return _parseUser(rows[0] || null);
}

async function getAllVerifiedUsers() {
  const { rows } = await pool.query(
    `SELECT id, username, color_index FROM users WHERE verified = TRUE ORDER BY username`
  );
  return rows.map(u => ({ id: u.id, username: u.username, colorIndex: u.color_index }));
}

async function setVerified(userId) {
  await pool.query(`UPDATE users SET verified = TRUE WHERE id = $1`, [userId]);
}

async function updatePlayerData({ id, username, colorIndex, coins, inventory, outfit }) {
  await pool.query(
    `UPDATE users SET username=$1, color_index=$2, coins=$3, inventory=$4, outfit=$5 WHERE id=$6`,
    [username, colorIndex, coins,
     JSON.stringify(inventory || []),
     JSON.stringify(outfit    || {}),
     id]
  );
}

// ── TOKEN QUERIES ─────────────────────────────────────────────
async function createVerifyToken(token, userId) {
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // 24 h
  await pool.query(
    `INSERT INTO verify_tokens (token, user_id, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (token) DO UPDATE SET user_id=$2, expires_at=$3`,
    [token, userId, expiresAt]
  );
}

async function getAndDeleteVerifyToken(token) {
  const now = Math.floor(Date.now() / 1000);
  // Delete expired tokens first
  await pool.query(`DELETE FROM verify_tokens WHERE expires_at < $1`, [now]);
  const { rows } = await pool.query(
    `DELETE FROM verify_tokens WHERE token=$1 RETURNING *`, [token]
  );
  const row = rows[0];
  if (!row || row.expires_at < now) return null;
  return row;
}

// ── ROOM QUERIES ──────────────────────────────────────────────
async function getRoom(userId) {
  const { rows } = await pool.query(`SELECT * FROM rooms WHERE user_id=$1`, [userId]);
  if (!rows[0]) return { userId, roomName:'My Room', wallpaper:'default', flooring:'default', placedItems:[] };
  const r = rows[0];
  return {
    userId:      r.user_id,
    roomName:    r.room_name,
    wallpaper:   r.wallpaper,
    flooring:    r.flooring,
    placedItems: typeof r.placed_items === 'string'
                   ? JSON.parse(r.placed_items)
                   : (r.placed_items || []),
  };
}

async function saveRoom({ userId, roomName, wallpaper, flooring, placedItems }) {
  await pool.query(
    `INSERT INTO rooms (user_id, room_name, wallpaper, flooring, placed_items, updated_at)
     VALUES ($1,$2,$3,$4,$5, EXTRACT(EPOCH FROM NOW())::BIGINT)
     ON CONFLICT (user_id) DO UPDATE SET
       room_name=$2, wallpaper=$3, flooring=$4, placed_items=$5,
       updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT`,
    [userId,
     (roomName || 'My Room').substring(0, 32),
     wallpaper || 'default',
     flooring  || 'default',
     JSON.stringify(placedItems || [])]
  );
}

module.exports = {
  initSchema,
  createUser, getUserByEmail, getUserById, getAllVerifiedUsers,
  setVerified, updatePlayerData,
  createVerifyToken, getAndDeleteVerifyToken,
  getRoom, saveRoom,
};
