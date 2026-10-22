require('dotenv').config();
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { verifyMessage, getAddress } = require('ethers');
const { db, addStat, getStat } = require('./db');
const G = require('../shared/game');
const { createMatchmaker } = require('./match');

const PORT = Number(process.env.PORT) || 3000;
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const NONCE_MS = 10 * 60 * 1000;

// Sites allowed to call this server from another domain (e.g. the Vercel frontend).
// Comma-separated, e.g. ALLOWED_ORIGINS=https://flipfight.vercel.app,https://flipfight.gg
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);

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
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- helpers ----------
const now = () => Date.now();
const randomTokenNo = () => crypto.randomInt(1000, 10000);
const fail = (res, status, error) => res.status(status).json({ error });

const q = {
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  userByAddress: db.prepare('SELECT * FROM users WHERE address = ?'),
  insertUser: db.prepare('INSERT INTO users(address, balance, free_packs, created_at) VALUES(?, ?, ?, ?)'),
  insertCard: db.prepare('INSERT INTO cards(owner_id, tpl, token_no, created_at) VALUES(?, ?, ?, ?)'),
  cardsOf: db.prepare('SELECT uid, tpl, token_no FROM cards WHERE owner_id = ? ORDER BY uid'),
  decksOf: db.prepare('SELECT room_id, card_uids FROM decks WHERE user_id = ?'),
  upsertDeck: db.prepare('INSERT INTO decks(user_id, room_id, card_uids) VALUES(?, ?, ?) ON CONFLICT(user_id, room_id) DO UPDATE SET card_uids = excluded.card_uids'),
  session: db.prepare('SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?'),
  insertSession: db.prepare('INSERT INTO sessions(token, user_id, expires_at) VALUES(?, ?, ?)'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  putNonce: db.prepare('INSERT INTO nonces(address, message, expires_at) VALUES(?, ?, ?) ON CONFLICT(address) DO UPDATE SET message = excluded.message, expires_at = excluded.expires_at'),
  getNonce: db.prepare('SELECT message FROM nonces WHERE address = ? AND expires_at > ?'),
  deleteNonce: db.prepare('DELETE FROM nonces WHERE address = ?'),
  setNickname: db.prepare('UPDATE users SET nickname = ? WHERE id = ?'),
  nicknameTaken: db.prepare('SELECT id FROM users WHERE nickname = ? COLLATE NOCASE AND id != ?'),
  addBalance: db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?'),
  spendBalance: db.prepare('UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?'),
  useFreePack: db.prepare('UPDATE users SET free_packs = free_packs - 1 WHERE id = ? AND free_packs > 0'),
  claimBonus: db.prepare('UPDATE users SET balance = balance + ?, last_bonus = ? WHERE id = ? AND last_bonus <= ?'),
  leaderboard: db.prepare(`SELECT id, nickname, elo, wins, losses, draws FROM users WHERE nickname IS NOT NULL
                           ORDER BY elo DESC, wins DESC, id ASC LIMIT 100`),
  history: db.prepare(`SELECT m.*, u1.nickname AS n1, u2.nickname AS n2 FROM matches m
                       JOIN users u1 ON u1.id = m.p1 JOIN users u2 ON u2.id = m.p2
                       WHERE m.p1 = ? OR m.p2 = ? ORDER BY m.created_at DESC LIMIT 20`),
  playerCount: db.prepare('SELECT COUNT(*) AS n FROM users WHERE nickname IS NOT NULL'),
};

function createUser(address) {
  return db.transaction(() => {
    const info = q.insertUser.run(address, G.ECONOMY.startBalance, G.ECONOMY.startFreePacks, now());
    const id = info.lastInsertRowid;
    for (const tpl of G.ECONOMY.starterTemplates) q.insertCard.run(id, tpl, randomTokenNo(), now());
    const starter = q.cardsOf.all(id).map(c => c.uid);
    // sensible default decks: 2 commons + 3 rares fit room 1, strongest legal mix for others
    q.upsertDeck.run(id, 1, JSON.stringify([starter[0], starter[3], starter[5], starter[6], starter[4]]));
    q.upsertDeck.run(id, 2, JSON.stringify([starter[11], starter[9], starter[6], starter[8], starter[0]]));
    q.upsertDeck.run(id, 3, JSON.stringify([starter[11], starter[9], starter[10], starter[6], starter[8]]));
    return q.userById.get(id);
  })();
}

function publicProfile(u) {
  const left = u.last_bonus + G.ECONOMY.dailyBonusMs - now();
  return {
    id: u.id, address: u.address, nickname: u.nickname, balance: u.balance, elo: u.elo,
    wins: u.wins, losses: u.losses, draws: u.draws, freePacks: u.free_packs,
    bonusReadyIn: Math.max(0, left),
  };
}

function ownedCards(userId) { return q.cardsOf.all(userId).map(G.cardView); }
function decksOf(userId) {
  const out = {};
  for (const d of q.decksOf.all(userId)) out[d.room_id] = JSON.parse(d.card_uids);
  return out;
}

// Validates a deck for a room; returns the card objects or throws a message.
function validateDeck(userId, roomId, uids) {
  const room = G.ROOMS.find(r => r.id === roomId);
  if (!room) throw new Error('Unknown room.');
  if (!Array.isArray(uids) || uids.length !== G.MATCH.deckSize) throw new Error(`Pick exactly ${G.MATCH.deckSize} cards.`);
  if (new Set(uids).size !== uids.length) throw new Error('Each card can be used once per deck.');
  const owned = new Map(ownedCards(userId).map(c => [c.uid, c]));
  const cards = uids.map(u => owned.get(u));
  if (cards.some(c => !c)) throw new Error('You do not own one of these cards.');
  const power = cards.reduce((a, c) => a + c.pow, 0);
  if (room.limit !== null && power > room.limit) throw new Error(`Deck power ${power} is over the room cap of ${room.limit}.`);
  return { room, cards };
}

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const row = token && q.session.get(token, now());
  if (!row) return fail(res, 401, 'Please sign in again.');
  req.user = q.userById.get(row.user_id);
  req.token = token;
  next();
}

// ---------- auth ----------
function normalizeAddress(a) {
  try { return getAddress(String(a)).toLowerCase(); } catch { return null; }
}

app.get('/api/nonce', (req, res) => {
  const address = normalizeAddress(req.query.address);
  if (!address) return fail(res, 400, 'That is not a valid wallet address.');
  const nonce = crypto.randomBytes(16).toString('hex');
  const message = [
    'Sign in to Flipfight',
    '',
    `Wallet: ${getAddress(address)}`,
    `Nonce: ${nonce}`,
    `Issued: ${new Date().toISOString()}`,
    '',
    'This signature is free. It does not send a transaction or move any tokens.',
  ].join('\n');
  q.putNonce.run(address, message, now() + NONCE_MS);
  res.json({ message });
});

app.post('/api/login', (req, res) => {
  const address = normalizeAddress(req.body.address);
  const signature = String(req.body.signature || '');
  if (!address || !signature) return fail(res, 400, 'Missing wallet address or signature.');
  const row = q.getNonce.get(address, now());
  if (!row) return fail(res, 400, 'Sign-in request expired. Please try again.');
  let recovered;
  try { recovered = verifyMessage(row.message, signature).toLowerCase(); } catch { recovered = null; }
  if (recovered !== address) return fail(res, 401, 'Signature does not match this wallet.');
  q.deleteNonce.run(address);
  const user = q.userByAddress.get(address) || createUser(address);
  const token = crypto.randomBytes(32).toString('hex');
  q.insertSession.run(token, user.id, now() + SESSION_MS);
  res.json({ token, profile: publicProfile(user) });
});

app.post('/api/logout', auth, (req, res) => { q.deleteSession.run(req.token); res.json({ ok: true }); });

// ---------- profile ----------
app.get('/api/config', (req, res) => {
  res.json({ elements: G.ELEMENTS, rarities: G.RARITIES, rooms: G.ROOMS, packs: G.PACKS, match: G.MATCH, economy: { dailyBonus: G.ECONOMY.dailyBonus, feeSplit: G.ECONOMY.feeSplit } });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ profile: publicProfile(req.user), cards: ownedCards(req.user.id), decks: decksOf(req.user.id), activeMatch: matchmaker.activeMatchOf(req.user.id) });
});

app.post('/api/nickname', auth, (req, res) => {
  const nick = String(req.body.nickname || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(nick)) return fail(res, 400, 'Use 3–16 letters, numbers or underscores.');
  if (req.user.nickname) return fail(res, 400, 'Your nickname is already set.');
  if (q.nicknameTaken.get(nick, req.user.id)) return fail(res, 409, 'That nickname is taken. Try another one.');
  q.setNickname.run(nick, req.user.id);
  res.json({ profile: publicProfile(q.userById.get(req.user.id)) });
});

app.post('/api/deck', auth, (req, res) => {
  const roomId = Number(req.body.roomId);
  try {
    validateDeck(req.user.id, roomId, req.body.uids);
    q.upsertDeck.run(req.user.id, roomId, JSON.stringify(req.body.uids));
    res.json({ ok: true });
  } catch (e) { fail(res, 400, e.message); }
});

app.post('/api/bonus', auth, (req, res) => {
  const t = now();
  const info = q.claimBonus.run(G.ECONOMY.dailyBonus, t, req.user.id, t - G.ECONOMY.dailyBonusMs);
  if (!info.changes) return fail(res, 400, 'Your daily bonus is not ready yet.');
  res.json({ profile: publicProfile(q.userById.get(req.user.id)) });
});

function rollRarity(odds) {
  let x = crypto.randomInt(0, 10000) / 100;
  for (const [k, v] of Object.entries(odds)) { if (x < v) return k; x -= v; }
  return Object.keys(odds).find(k => odds[k] > 0);
}

app.post('/api/pack', auth, (req, res) => {
  const pack = G.PACKS.find(p => p.id === req.body.packId);
  if (!pack) return fail(res, 400, 'Unknown pack.');
  const free = !!req.body.useFree;
  try {
    const uids = db.transaction(() => {
      if (free) {
        if (!q.useFreePack.run(req.user.id).changes) throw new Error('You have no free packs left.');
      } else {
        if (!q.spendBalance.run(pack.price, req.user.id, pack.price).changes) throw new Error('Not enough FLIP for this pack.');
        addStat('burned', pack.price * 0.5);
        addStat('treasury', pack.price * 0.5);
      }
      const out = [];
      for (let i = 0; i < pack.n; i++) {
        const rar = rollRarity(pack.odds);
        const pool = G.TEMPLATES.map((t, idx) => ({ t, idx })).filter(o => o.t[2] === rar);
        const tpl = pool[crypto.randomInt(0, pool.length)].idx;
        out.push(q.insertCard.run(req.user.id, tpl, randomTokenNo(), now()).lastInsertRowid);
      }
      return out;
    })();
    const all = ownedCards(req.user.id);
    res.json({ pulled: all.filter(c => uids.includes(c.uid)), profile: publicProfile(q.userById.get(req.user.id)) });
  } catch (e) { fail(res, 400, e.message); }
});

app.get('/api/leaderboard', (req, res) => {
  res.json({
    players: q.leaderboard.all().map((u, i) => ({ rank: i + 1, id: u.id, nickname: u.nickname, elo: u.elo, wins: u.wins, losses: u.losses, draws: u.draws })),
    totalPlayers: q.playerCount.get().n,
    burned: getStat('burned'),
    seasonPool: getStat('season'),
    online: matchmaker.onlineCount(),
  });
});

app.get('/api/history', auth, (req, res) => {
  const me = req.user.id;
  res.json({
    matches: q.history.all(me, me).map(m => {
      const mine = m.p1 === me;
      const out = m.winner_id === null ? 'draw' : m.winner_id === me ? 'win' : 'loss';
      const net = out === 'win' ? m.stake * 2 - m.rake - m.stake : out === 'loss' ? -m.stake : 0;
      return {
        id: m.id, at: m.created_at, room: (G.ROOMS.find(r => r.id === m.room_id) || {}).name,
        opponent: mine ? m.n2 : m.n1, score: mine ? `${m.p1_wins}–${m.p2_wins}` : `${m.p2_wins}–${m.p1_wins}`,
        out, net, eloDelta: mine ? m.p1_elo_delta : m.p2_elo_delta,
      };
    }),
  });
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

// ---------- realtime ----------
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : false } });

io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  const row = token && q.session.get(String(token), now());
  if (!row) return next(new Error('unauthorized'));
  const user = q.userById.get(row.user_id);
  if (!user.nickname) return next(new Error('nickname_required'));
  socket.data.userId = user.id;
  next();
});

const matchmaker = createMatchmaker({ io, db, q, G, addStat, validateDeck, publicProfile });
io.on('connection', socket => matchmaker.onConnection(socket));

// periodic cleanup of expired sessions and nonces
setInterval(() => {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
  db.prepare('DELETE FROM nonces WHERE expires_at < ?').run(now());
}, 60 * 60 * 1000).unref();

server.listen(PORT, () => console.log(`Flipfight running on http://localhost:${PORT}`));
