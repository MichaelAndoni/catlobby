// db.js — SQLite database setup using better-sqlite3
'use strict';

const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './catlobby.db';
const db = new Database(path.resolve(DB_PATH));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── SCHEMA ────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    username      TEXT NOT NULL,
    color_index   INTEGER NOT NULL DEFAULT 0,
    coins         INTEGER NOT NULL DEFAULT 0,
    inventory     TEXT NOT NULL DEFAULT '[]',
    outfit        TEXT NOT NULL DEFAULT '{}',
    verified      INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS verify_tokens (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reset_tokens (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS rooms (
    user_id      TEXT PRIMARY KEY,
    room_name    TEXT NOT NULL DEFAULT 'My Room',
    wallpaper    TEXT NOT NULL DEFAULT 'default',
    flooring     TEXT NOT NULL DEFAULT 'default',
    placed_items TEXT NOT NULL DEFAULT '[]',
    updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Add outfit column to existing databases that don't have it yet
try { db.exec(`ALTER TABLE users ADD COLUMN outfit TEXT NOT NULL DEFAULT '{}'`); } catch(e) {}

// Ensure rooms table exists for databases created before room system was added
try {
  db.exec(`CREATE TABLE IF NOT EXISTS rooms (
    user_id      TEXT PRIMARY KEY,
    room_name    TEXT NOT NULL DEFAULT 'My Room',
    wallpaper    TEXT NOT NULL DEFAULT 'default',
    flooring     TEXT NOT NULL DEFAULT 'default',
    placed_items TEXT NOT NULL DEFAULT '[]',
    updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
} catch(e) { console.error('[db migration rooms]', e.message); }

// ── STATEMENTS ────────────────────────────────────────────────
const stmts = {
  createUser: db.prepare(`
    INSERT INTO users (id, email, password_hash, username, color_index, coins, inventory, outfit)
    VALUES (@id, @email, @password_hash, @username, @color_index, 0, '[]', '{}')
  `),
  getUserByEmail:  db.prepare(`SELECT * FROM users WHERE email = ?`),
  getUserById:     db.prepare(`SELECT * FROM users WHERE id = ?`),
  getAllVerified:  db.prepare(`SELECT id, username, color_index FROM users WHERE verified = 1 ORDER BY username`),
  setVerified:     db.prepare(`UPDATE users SET verified = 1 WHERE id = ?`),
  updatePlayerData: db.prepare(`
    UPDATE users SET username = @username, color_index = @colorIndex,
                     coins = @coins, inventory = @inventory, outfit = @outfit
    WHERE id = @id
  `),

  createVerifyToken:  db.prepare(`INSERT OR REPLACE INTO verify_tokens (token, user_id, expires_at) VALUES (?, ?, ?)`),
  getVerifyToken:     db.prepare(`SELECT * FROM verify_tokens WHERE token = ?`),
  deleteVerifyToken:  db.prepare(`DELETE FROM verify_tokens WHERE token = ?`),
  cleanExpiredVerify: db.prepare(`DELETE FROM verify_tokens WHERE expires_at < unixepoch()`),

  getRoom: db.prepare(`SELECT * FROM rooms WHERE user_id = ?`),
  upsertRoom: db.prepare(`
    INSERT INTO rooms (user_id, room_name, wallpaper, flooring, placed_items, updated_at)
    VALUES (@userId, @roomName, @wallpaper, @flooring, @placedItems, unixepoch())
    ON CONFLICT(user_id) DO UPDATE SET
      room_name    = excluded.room_name,
      wallpaper    = excluded.wallpaper,
      flooring     = excluded.flooring,
      placed_items = excluded.placed_items,
      updated_at   = unixepoch()
  `),
};

// ── USER HELPERS ─────────────────────────────────────────────
function createUser({ id, email, passwordHash, username, colorIndex }) {
  stmts.createUser.run({ id, email: email.toLowerCase().trim(), password_hash: passwordHash, username, color_index: colorIndex });
  return stmts.getUserById.get(id);
}
function _parseUser(u) {
  if (!u) return null;
  u.inventory = JSON.parse(u.inventory || '[]');
  u.outfit    = JSON.parse(u.outfit    || '{}');
  return u;
}
function getUserByEmail(email) { return _parseUser(stmts.getUserByEmail.get(email.toLowerCase().trim())); }
function getUserById(id)       { return _parseUser(stmts.getUserById.get(id)); }
function getAllVerifiedUsers()  { return stmts.getAllVerified.all().map(u => ({ id: u.id, username: u.username, colorIndex: u.color_index })); }
function setVerified(userId)   { stmts.setVerified.run(userId); }

function updatePlayerData({ id, username, colorIndex, coins, inventory, outfit }) {
  stmts.updatePlayerData.run({
    id, username, colorIndex, coins,
    inventory: JSON.stringify(inventory || []),
    outfit:    JSON.stringify(outfit    || {}),
  });
}

function createVerifyToken(token, userId) {
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
  stmts.createVerifyToken.run(token, userId, expiresAt);
}
function getAndDeleteVerifyToken(token) {
  stmts.cleanExpiredVerify.run();
  const row = stmts.getVerifyToken.get(token);
  if (!row) return null;
  if (row.expires_at < Math.floor(Date.now() / 1000)) { stmts.deleteVerifyToken.run(token); return null; }
  stmts.deleteVerifyToken.run(token);
  return row;
}

// ── ROOM HELPERS ─────────────────────────────────────────────
function getRoom(userId) {
  const r = stmts.getRoom.get(userId);
  if (!r) return { userId, roomName: 'My Room', wallpaper: 'default', flooring: 'default', placedItems: [] };
  return { userId: r.user_id, roomName: r.room_name, wallpaper: r.wallpaper, flooring: r.flooring, placedItems: JSON.parse(r.placed_items || '[]') };
}
function saveRoom({ userId, roomName, wallpaper, flooring, placedItems }) {
  stmts.upsertRoom.run({ userId, roomName: (roomName||'My Room').substring(0,32), wallpaper: wallpaper||'default', flooring: flooring||'default', placedItems: JSON.stringify(placedItems||[]) });
}

module.exports = {
  createUser, getUserByEmail, getUserById, getAllVerifiedUsers,
  setVerified, updatePlayerData, createVerifyToken, getAndDeleteVerifyToken,
  getRoom, saveRoom,
};
