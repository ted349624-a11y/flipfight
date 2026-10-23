require('dotenv').config();
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { verifyMessage, getAddress } = require('ethers');
const db = require('./db');
const G = require('../shared/game');
const { createMatchmaker } = require('./match');

const PORT = Number(process.env.PORT) || 3000;
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const NONCE_MS = 10 * 60 * 1000;

// Sites allowed to call this server from another domain. Comma-separated. Not needed when everything runs on one host.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);

// Coming-soon mode: visitors see a teaser page while the game keeps running behind it.
// On by default. Set COMING_SOON=off on the host to open the game to everyone.
// Anyone who opens /?preview=<PREVIEW_KEY> gets in. The key is kept in a cookie and also in the
// page's local storage (sent as a header), so it still works in wallet browsers that drop cookies.
const COMING_SOON = !/^(off|false|0|no)$/i.test(process.env.COMING_SOON || 'on');
const PREVIEW_KEY = (process.env.PREVIEW_KEY || '').trim();
const PREVIEW_COOKIE = 'ff_preview';
function readCookie(header, name) {
  const m = (header || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}
const keyOk = k => !!PREVIEW_KEY && String(k || '').trim() === PREVIEW_KEY;
const hasPreview = (cookieHeader, headerKey) => keyOk(readCookie(cookieHeader, PREVIEW_COOKIE)) || keyOk(headerKey);
const GAME_PAGES = new Set(['/', '/index.html']);

const app = express();
app.set('trust proxy', 1);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
// Tolerate doubled slashes in typed URLs (e.g. "site.com//healthz").
app.use((req, res, next) => { if (req.url.includes('//')) req.url = req.url.replace(/\/{2,}/g, '/'); next(); });
app.use(express.json({ limit: '20kb' }));

if (COMING_SOON) {
  app.use((req, res, next) => {
    if (req.path === '/healthz') return next();
    // Scripts, styles and images are not secret (the game code is public); only the game page and the API are gated.
    if (!GAME_PAGES.has(req.path) && !req.path.startsWith('/api/') && /\.[a-z0-9]+$/i.test(req.path)) return next();
    if (keyOk(req.query.preview)) {
      res.setHeader('Set-Cookie', `${PREVIEW_COOKIE}=${encodeURIComponent(PREVIEW_KEY)}; Path=/; Max-Age=${60 * 60 * 24 * 90}; SameSite=Lax${req.secure ? '; Secure' : ''}`);
      res.setHeader('Cache-Control', 'no-store');
      return res.sendFile(path.join(__dirname, '..', 'public', 'index.html')); // serve the game right away, no redirect
    }
    if (hasPreview(req.headers.cookie, req.get('x-preview-key'))) return next();
    if (req.path.startsWith('/api/')) return res.status(503).json({ error: 'Flipfight is coming soon.' });
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, '..', 'public', 'coming-soon.html'));
  });
}
app.use(express.static(path.join(__dirname, '..', 'public')));

const now = () => Date.now();
const randomTokenNo = () => crypto.randomInt(1000, 10000);
const fail = (res, status, error) => res.status(status).json({ error });
// Wrap async route handlers so errors become a clean 500 instead of a crash.
const route = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(err => {
  console.error(err);
  if (!res.headersSent) fail(res, 500, 'Server error. Please try again.');
});

// ---------- data access ----------
const q = {
  userById: (id, c) => db.one('SELECT * FROM users WHERE id = $1', [id], c),
  userByAddress: a => db.one('SELECT * FROM users WHERE address = $1', [a]),
  cardsOf: (id, c) => db.all('SELECT uid, tpl, token_no FROM cards WHERE owner_id = $1 ORDER BY uid', [id], c),
  insertCard: (owner, tpl, c) => db.one('INSERT INTO cards(owner_id, tpl, token_no, created_at) VALUES($1,$2,$3,$4) RETURNING uid', [owner, tpl, randomTokenNo(), now()], c),
  upsertDeck: (uid, room, uids, c) => db.query(`INSERT INTO decks(user_id, room_id, card_uids) VALUES($1,$2,$3)
      ON CONFLICT(user_id, room_id) DO UPDATE SET card_uids = EXCLUDED.card_uids`, [uid, room, JSON.stringify(uids)], c),
  deckOf: (uid, room) => db.one('SELECT card_uids FROM decks WHERE user_id = $1 AND room_id = $2', [uid, room]),
  addBalance: (id, amount, c) => db.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amount, id], c),
  // atomic: only succeeds when the balance covers it
  spendBalance: async (id, amount, c) => (await db.query('UPDATE users SET balance = balance - $1 WHERE id = $2 AND balance >= $1', [amount, id], c)).rowCount === 1,
};

async function createUser(address) {
  return db.tx(async c => {
    const u = await db.one('INSERT INTO users(address, balance, free_packs, created_at) VALUES($1,$2,$3,$4) ON CONFLICT(address) DO NOTHING RETURNING *',
      [address, G.ECONOMY.startBalance, G.ECONOMY.startFreePacks, now()], c);
    if (!u) return db.one('SELECT * FROM users WHERE address = $1', [address], c); // created by a parallel login
    const uids = [];
    for (const tpl of G.ECONOMY.starterTemplates) uids.push((await q.insertCard(u.id, tpl, c)).uid);
    // no pre-built decks: players choose their own 5 cards before every match
    return u;
  });
}

function publicProfile(u) {
  return {
    id: u.id, address: u.address, nickname: u.nickname, balance: u.balance, elo: u.elo,
    wins: u.wins, losses: u.losses, draws: u.draws, freePacks: u.free_packs,
    bonusReadyIn: Math.max(0, u.last_bonus + G.ECONOMY.dailyBonusMs - now()),
  };
}
const ownedCards = async userId => (await q.cardsOf(userId)).map(G.cardView);
async function decksOf(userId) {
  const out = {};
  for (const d of await db.all('SELECT room_id, card_uids FROM decks WHERE user_id = $1', [userId])) out[d.room_id] = JSON.parse(d.card_uids);
  return out;
}

// Validates a deck for a room; returns { room, cards } or throws a player-facing message.
async function validateDeck(userId, roomId, uids) {
  const room = roomId === G.PRACTICE.id ? G.PRACTICE : G.ROOMS.find(r => r.id === roomId);
  if (!room) throw new Error('Unknown room.');
  if (!Array.isArray(uids) || uids.length !== G.MATCH.deckSize) throw new Error(`Pick exactly ${G.MATCH.deckSize} cards.`);
  if (new Set(uids).size !== uids.length) throw new Error('Each card can be used once per deck.');
  const owned = new Map((await ownedCards(userId)).map(c => [c.uid, c]));
  const cards = uids.map(u => owned.get(u));
  if (cards.some(c => !c)) throw new Error('You do not own one of these cards.');
  const power = cards.reduce((a, c) => a + c.pow, 0);
  if (room.limit !== null && power > room.limit) throw new Error(`Deck power ${power} is over the room cap of ${room.limit}.`);
  return { room, cards };
}

async function sessionUser(token) {
  if (!token) return null;
  const row = await db.one('SELECT user_id FROM sessions WHERE token = $1 AND expires_at > $2', [String(token), now()]);
  return row ? q.userById(row.user_id) : null;
}
const auth = route(async (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const user = await sessionUser(token);
  if (!user) return fail(res, 401, 'Please sign in again.');
  req.user = user; req.token = token;
  next();
});

// ---------- auth ----------
function normalizeAddress(a) { try { return getAddress(String(a)).toLowerCase(); } catch { return null; } }

app.get('/api/nonce', route(async (req, res) => {
  const address = normalizeAddress(req.query.address);
  if (!address) return fail(res, 400, 'That is not a valid wallet address.');
  // Sign-In with Ethereum (EIP-4361) format, so wallets can verify the site's domain.
  const host = req.get('host');
  const message = [
    `${host} wants you to sign in with your Ethereum account:`,
    getAddress(address),
    '',
    'Sign in to Flipfight. This signature is free. It does not send a transaction or move any tokens.',
    '',
    `URI: ${req.protocol}://${host}`,
    'Version: 1',
    `Chain ID: ${G.CHAIN_ID}`,
    `Nonce: ${crypto.randomBytes(12).toString('hex')}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join('\n');
  await db.query(`INSERT INTO nonces(address, message, expires_at) VALUES($1,$2,$3)
    ON CONFLICT(address) DO UPDATE SET message = EXCLUDED.message, expires_at = EXCLUDED.expires_at`, [address, message, now() + NONCE_MS]);
  res.json({ message });
}));

app.post('/api/login', route(async (req, res) => {
  const address = normalizeAddress(req.body.address);
  const signature = String(req.body.signature || '');
  if (!address || !signature) return fail(res, 400, 'Missing wallet address or signature.');
  const row = await db.one('SELECT message FROM nonces WHERE address = $1 AND expires_at > $2', [address, now()]);
  if (!row) return fail(res, 400, 'Sign-in request expired. Please try again.');
  let recovered = null;
  try { recovered = verifyMessage(row.message, signature).toLowerCase(); } catch {}
  if (recovered !== address) return fail(res, 401, 'Signature does not match this wallet.');
  await db.query('DELETE FROM nonces WHERE address = $1', [address]);
  const user = (await q.userByAddress(address)) || (await createUser(address));
  const token = crypto.randomBytes(32).toString('hex');
  await db.query('INSERT INTO sessions(token, user_id, expires_at) VALUES($1,$2,$3)', [token, user.id, now() + SESSION_MS]);
  res.json({ token, profile: publicProfile(user) });
}));

app.post('/api/logout', auth, route(async (req, res) => {
  await db.query('DELETE FROM sessions WHERE token = $1', [req.token]);
  res.json({ ok: true });
}));

// ---------- profile ----------
app.get('/api/config', (req, res) => {
  res.json({ practice: G.PRACTICE, botLevels: G.BOT_LEVELS, elements: G.ELEMENTS, rarities: G.RARITIES, rooms: G.ROOMS, packs: G.PACKS, match: G.MATCH, economy: { dailyBonus: G.ECONOMY.dailyBonus, feeSplit: G.ECONOMY.feeSplit } });
});

app.get('/api/me', auth, route(async (req, res) => {
  res.json({ profile: publicProfile(req.user), cards: await ownedCards(req.user.id), decks: await decksOf(req.user.id), activeMatch: matchmaker.activeMatchOf(req.user.id) });
}));

app.post('/api/nickname', auth, route(async (req, res) => {
  const nick = String(req.body.nickname || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(nick)) return fail(res, 400, 'Use 3–16 letters, numbers or underscores.');
  if (req.user.nickname) return fail(res, 400, 'Your nickname is already set.');
  try {
    await db.query('UPDATE users SET nickname = $1 WHERE id = $2 AND nickname IS NULL', [nick, req.user.id]);
  } catch (e) {
    if (e.code === '23505') return fail(res, 409, 'That nickname is taken. Try another one.');
    throw e;
  }
  res.json({ profile: publicProfile(await q.userById(req.user.id)) });
}));

app.post('/api/deck', auth, route(async (req, res) => {
  const roomId = Number(req.body.roomId);
  try { await validateDeck(req.user.id, roomId, req.body.uids); }
  catch (e) { return fail(res, 400, e.message); }
  await q.upsertDeck(req.user.id, roomId, req.body.uids);
  res.json({ ok: true });
}));

app.post('/api/bonus', auth, route(async (req, res) => {
  const t = now();
  const r = await db.query('UPDATE users SET balance = balance + $1, last_bonus = $2 WHERE id = $3 AND last_bonus <= $4',
    [G.ECONOMY.dailyBonus, t, req.user.id, t - G.ECONOMY.dailyBonusMs]);
  if (!r.rowCount) return fail(res, 400, 'Your daily bonus is not ready yet.');
  res.json({ profile: publicProfile(await q.userById(req.user.id)) });
}));

function rollRarity(odds) {
  let x = crypto.randomInt(0, 10000) / 100;
  for (const [k, v] of Object.entries(odds)) { if (x < v) return k; x -= v; }
  return Object.keys(odds).find(k => odds[k] > 0);
}

app.post('/api/pack', auth, route(async (req, res) => {
  const pack = G.PACKS.find(p => p.id === req.body.packId);
  if (!pack) return fail(res, 400, 'Unknown pack.');
  const free = !!req.body.useFree;
  let uids;
  try {
    uids = await db.tx(async c => {
      if (free) {
        const r = await db.query('UPDATE users SET free_packs = free_packs - 1 WHERE id = $1 AND free_packs > 0', [req.user.id], c);
        if (!r.rowCount) throw new Error('You have no free packs left.');
      } else {
        if (!(await q.spendBalance(req.user.id, pack.price, c))) throw new Error('Not enough FLIP for this pack.');
        await db.addStat('burned', pack.price * 0.5, c);
        await db.addStat('treasury', pack.price * 0.5, c);
      }
      const out = [];
      for (let i = 0; i < pack.n; i++) {
        const rar = rollRarity(pack.odds);
        const pool = G.TEMPLATES.map((t, idx) => ({ t, idx })).filter(o => o.t[2] === rar);
        out.push((await q.insertCard(req.user.id, pool[crypto.randomInt(0, pool.length)].idx, c)).uid);
      }
      return out;
    });
  } catch (e) { return fail(res, 400, e.message); }
  const all = await ownedCards(req.user.id);
  res.json({ pulled: all.filter(c => uids.includes(c.uid)), profile: publicProfile(await q.userById(req.user.id)) });
}));

app.get('/api/leaderboard', route(async (req, res) => {
  const players = await db.all(`SELECT id, nickname, elo, wins, losses, draws FROM users WHERE nickname IS NOT NULL
                                ORDER BY elo DESC, wins DESC, id ASC LIMIT 100`);
  const total = await db.one('SELECT COUNT(*)::int AS n FROM users WHERE nickname IS NOT NULL');
  res.json({
    players: players.map((u, i) => ({ rank: i + 1, ...u })),
    totalPlayers: total.n, burned: await db.getStat('burned'), seasonPool: await db.getStat('season'),
    online: matchmaker.onlineCount(),
  });
}));

app.get('/api/history', auth, route(async (req, res) => {
  const me = req.user.id;
  const rows = await db.all(`SELECT m.*, u1.nickname AS n1, u2.nickname AS n2 FROM matches m
                             JOIN users u1 ON u1.id = m.p1 JOIN users u2 ON u2.id = m.p2
                             WHERE m.p1 = $1 OR m.p2 = $1 ORDER BY m.created_at DESC LIMIT 20`, [me]);
  res.json({
    matches: rows.map(m => {
      const mine = m.p1 === me;
      const out = m.winner_id === null ? 'draw' : m.winner_id === me ? 'win' : 'loss';
      return {
        id: m.id, at: m.created_at, room: (G.ROOMS.find(r => r.id === m.room_id) || {}).name,
        opponent: mine ? m.n2 : m.n1, score: mine ? `${m.p1_wins}–${m.p2_wins}` : `${m.p2_wins}–${m.p1_wins}`,
        out, net: out === 'win' ? m.stake * 2 - m.rake - m.stake : out === 'loss' ? -m.stake : 0,
        eloDelta: mine ? m.p1_elo_delta : m.p2_elo_delta,
      };
    }),
  });
}));

app.get('/healthz', (req, res) => res.json({ ok: true, comingSoon: COMING_SOON, previewKeySet: !!PREVIEW_KEY }));

// ---------- realtime ----------
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : false } });

io.use((socket, next) => {
  if (COMING_SOON && !hasPreview(socket.handshake.headers.cookie, socket.handshake.auth && socket.handshake.auth.preview)) return next(new Error('coming_soon'));
  sessionUser(socket.handshake.auth && socket.handshake.auth.token).then(user => {
    if (!user) return next(new Error('unauthorized'));
    if (!user.nickname) return next(new Error('nickname_required'));
    socket.data.userId = user.id;
    next();
  }).catch(() => next(new Error('unavailable')));
});

const matchmaker = createMatchmaker({ io, db, q, G, validateDeck, publicProfile });
io.on('connection', socket => matchmaker.onConnection(socket));

setInterval(() => {
  db.query('DELETE FROM sessions WHERE expires_at < $1', [now()]).catch(() => {});
  db.query('DELETE FROM nonces WHERE expires_at < $1', [now()]).catch(() => {});
}, 60 * 60 * 1000).unref();

db.init()
  .then(() => server.listen(PORT, () => console.log(`Flipfight running on http://localhost:${PORT}`)))
  .catch(err => { console.error('Could not connect to the database:', err.message); process.exit(1); });
