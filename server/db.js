const { Pool, types } = require('pg');

// BIGINT columns (balances, timestamps) come back as JS numbers instead of strings.
types.setTypeParser(20, v => parseInt(v, 10));

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Add your Neon (or other Postgres) connection string as an environment variable.');
  process.exit(1);
}
const local = /@(localhost|127\.0\.0\.1)|host=\/|sslmode=disable/.test(url);
const pool = new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 10 });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  address TEXT NOT NULL UNIQUE,
  nickname TEXT,
  balance BIGINT NOT NULL,
  elo INTEGER NOT NULL DEFAULT 1200,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  free_packs INTEGER NOT NULL DEFAULT 0,
  last_bonus BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_nickname_ci ON users (LOWER(nickname));
CREATE TABLE IF NOT EXISTS cards (
  uid SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  tpl INTEGER NOT NULL,
  token_no INTEGER NOT NULL,
  created_at BIGINT NOT NULL
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
  expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS nonces (
  address TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  room_id INTEGER NOT NULL,
  p1 INTEGER NOT NULL REFERENCES users(id),
  p2 INTEGER NOT NULL REFERENCES users(id),
  winner_id INTEGER,
  p1_wins INTEGER NOT NULL,
  p2_wins INTEGER NOT NULL,
  stake BIGINT NOT NULL,
  rake BIGINT NOT NULL,
  p1_elo_delta INTEGER NOT NULL,
  p2_elo_delta INTEGER NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS matches_p1 ON matches(p1);
CREATE INDEX IF NOT EXISTS matches_p2 ON matches(p2);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS fusions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  rarity TEXT NOT NULL,
  cards_used INTEGER NOT NULL,
  chance REAL NOT NULL,
  success BOOLEAN NOT NULL,
  result_tpl INTEGER NOT NULL,
  fee BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS fusions_user ON fusions(user_id);
CREATE TABLE IF NOT EXISTS listings (
  id SERIAL PRIMARY KEY,
  seller_id INTEGER NOT NULL REFERENCES users(id),
  card_uid INTEGER NOT NULL REFERENCES cards(uid),
  tpl INTEGER NOT NULL,
  price BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  buyer_id INTEGER REFERENCES users(id),
  created_at BIGINT NOT NULL,
  closed_at BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS listings_one_active_per_card ON listings(card_uid) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS listings_status ON listings(status, created_at);
`;

const init = () => pool.query(SCHEMA);

// Run a query on the pool, or on a transaction client when one is passed.
const query = (text, params, client) => (client || pool).query(text, params);
const one = async (text, params, client) => (await query(text, params, client)).rows[0];
const all = async (text, params, client) => (await query(text, params, client)).rows;

async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); }
}

const addStat = (key, amount, client) =>
  query('INSERT INTO kv(key, value) VALUES($1, $2) ON CONFLICT(key) DO UPDATE SET value = kv.value + EXCLUDED.value', [key, Math.round(amount)], client);
const getStat = async key => ((await one('SELECT value FROM kv WHERE key = $1', [key])) || { value: 0 }).value;

module.exports = { pool, init, query, one, all, tx, addStat, getStat };
