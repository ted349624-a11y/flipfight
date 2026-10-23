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
CREATE TABLE IF NOT EXISTS clans (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  tag TEXT NOT NULL,
  leader_id INTEGER NOT NULL REFERENCES users(id),
  banner TEXT NOT NULL,
  join_mode TEXT NOT NULL DEFAULT 'open',
  season_points INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS clans_name_ci ON clans (LOWER(name));
CREATE UNIQUE INDEX IF NOT EXISTS clans_tag_ci ON clans (LOWER(tag));
ALTER TABLE users ADD COLUMN IF NOT EXISTS clan_id INTEGER;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS plays INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS wins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS owners INTEGER NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS bosses (
  season INTEGER PRIMARY KEY,
  boss TEXT NOT NULL,
  max_hp BIGINT NOT NULL,
  hp BIGINT NOT NULL,
  killed_at BIGINT,
  killer_id INTEGER
);
CREATE TABLE IF NOT EXISTS boss_hits (
  season INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  damage BIGINT NOT NULL DEFAULT 0,
  fights INTEGER NOT NULL DEFAULT 0,
  best BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (season, user_id)
);
CREATE TABLE IF NOT EXISTS boss_attempts (
  user_id INTEGER NOT NULL REFERENCES users(id),
  day TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS boss_badges (
  season INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  place INTEGER NOT NULL,
  boss TEXT NOT NULL,
  PRIMARY KEY (season, user_id)
);
CREATE INDEX IF NOT EXISTS users_clan ON users(clan_id);
CREATE TABLE IF NOT EXISTS clan_invites (
  clan_id INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at BIGINT NOT NULL,
  PRIMARY KEY (clan_id, user_id)
);
CREATE TABLE IF NOT EXISTS clan_requests (
  clan_id INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at BIGINT NOT NULL,
  PRIMARY KEY (clan_id, user_id)
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS season_played INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS season_wins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS season_losses INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS season_draws INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS seasons (
  number INTEGER PRIMARY KEY,
  starts_at BIGINT NOT NULL,
  ends_at BIGINT NOT NULL,
  finalized_at BIGINT
);
CREATE TABLE IF NOT EXISTS season_results (
  season INTEGER NOT NULL REFERENCES seasons(number),
  user_id INTEGER NOT NULL REFERENCES users(id),
  place INTEGER NOT NULL,
  elo INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  losses INTEGER NOT NULL,
  draws INTEGER NOT NULL,
  reward BIGINT NOT NULL,
  seen BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (season, user_id)
);
CREATE INDEX IF NOT EXISTS season_results_user ON season_results(user_id);
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
