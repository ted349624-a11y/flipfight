const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const file = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'flipfight.db');
fs.mkdirSync(path.dirname(file), { recursive: true });

const db = new Database(file);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL UNIQUE,
  nickname TEXT UNIQUE COLLATE NOCASE,
  balance INTEGER NOT NULL,
  elo INTEGER NOT NULL DEFAULT 1200,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  free_packs INTEGER NOT NULL DEFAULT 0,
  last_bonus INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cards (
  uid INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  tpl INTEGER NOT NULL,
  token_no INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cards_owner ON cards(owner_id);
CREATE TABLE IF NOT EXISTS decks (
  user_id INTEGER NOT NULL REFERENCES users(id),
  room_id INTEGER NOT NULL,
  card_uids TEXT NOT NULL,
  PRIMARY KEY (user_id, room_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS nonces (
  address TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  room_id INTEGER NOT NULL,
  p1 INTEGER NOT NULL REFERENCES users(id),
  p2 INTEGER NOT NULL REFERENCES users(id),
  winner_id INTEGER,
  p1_wins INTEGER NOT NULL,
  p2_wins INTEGER NOT NULL,
  stake INTEGER NOT NULL,
  rake INTEGER NOT NULL,
  p1_elo_delta INTEGER NOT NULL,
  p2_elo_delta INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS matches_p1 ON matches(p1);
CREATE INDEX IF NOT EXISTS matches_p2 ON matches(p2);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
`);

const addKv = db.prepare(`INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = value + excluded.value`);
const getKv = db.prepare(`SELECT value FROM kv WHERE key = ?`);

module.exports = {
  db,
  addStat: (key, amount) => addKv.run(key, Math.round(amount)),
  getStat: key => (getKv.get(key) || { value: 0 }).value,
};
