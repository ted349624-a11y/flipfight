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
const { createSeasons } = require('./season');
const { createIsland } = require('./island');

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

// Founder: wallets listed in FOUNDER_ADDRESSES (comma-separated) get the royal character, a FOUNDER badge
// and, if FOUNDER_NICK is set, that nickname (reserved so nobody else can take it).
const FOUNDERS = new Set((process.env.FOUNDER_ADDRESSES || '').split(',').map(a => a.trim().toLowerCase()).filter(a => /^0x[0-9a-f]{40}$/.test(a)));
const FOUNDER_NICK = /^[A-Za-z0-9_]{3,16}$/.test((process.env.FOUNDER_NICK || '').trim()) ? process.env.FOUNDER_NICK.trim() : '';
const founderIds = new Set(); // user ids of founder wallets, filled at startup and on sign-in
const isFounder = u => !!u && FOUNDERS.has(String(u.address).toLowerCase());
// Names only the founder may use, so nobody can pose as staff.
const RESERVED = /^(admin|administrator|dev|developer|founder|official|support|moderator|mod|staff|system)$|flipfight/i;
const reservedNick = n => RESERVED.test(n) || (FOUNDER_NICK && n.toLowerCase() === FOUNDER_NICK.toLowerCase());

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
// Text files (scripts, styles, pages) are gzipped once at startup and served with an ETag, so each visit
// downloads about a quarter of the bytes and repeat visits only get a tiny "not modified" reply.
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PACKED = new Map();
for (const f of require('fs').readdirSync(PUBLIC_DIR)) {
  if (!/\.(js|css|html|svg|json|txt)$/i.test(f)) continue;
  const raw = require('fs').readFileSync(path.join(PUBLIC_DIR, f));
  PACKED.set('/' + f, { raw, gz: require('zlib').gzipSync(raw, { level: 9 }), etag: '"' + crypto.createHash('sha1').update(raw).digest('base64url').slice(0, 16) + '"', ext: path.extname(f) });
}
PACKED.set('/', PACKED.get('/index.html'));
app.use((req, res, next) => {
  const f = (req.method === 'GET' || req.method === 'HEAD') && PACKED.get(req.path);
  if (!f) return next();
  res.type(f.ext); res.setHeader('ETag', f.etag); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Vary', 'Accept-Encoding');
  if (req.headers['if-none-match'] === f.etag) return res.status(304).end();
  const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (gz) res.setHeader('Content-Encoding', 'gzip');
  res.send(gz ? f.gz : f.raw);
});
app.use(express.static(PUBLIC_DIR));

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
  cardsOf: (id, c) => db.all(`SELECT c.uid, c.tpl, c.token_no, l.id AS listing_id, l.price AS listing_price FROM cards c
      LEFT JOIN listings l ON l.card_uid = c.uid AND l.status = 'active' WHERE c.owner_id = $1 ORDER BY c.uid`, [id], c),
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
    id: u.id, address: u.address, nickname: u.nickname, founder: isFounder(u), balance: u.balance, elo: u.elo, tier: G.tierOf(u.elo).id,
    wins: u.wins, losses: u.losses, draws: u.draws, freePacks: u.free_packs,
    season: { played: u.season_played || 0, wins: u.season_wins || 0, losses: u.season_losses || 0, draws: u.season_draws || 0 },
    bonusReadyIn: Math.max(0, u.last_bonus + G.ECONOMY.dailyBonusMs - now()),
  };
}
// Top-3 season finishes, as permanent badges: { userId: [{ season, place }] }
async function badgesOf(ids) {
  const out = {};
  for (const id of ids) if (founderIds.has(id)) out[id] = [{ founder: true }];
  if (!ids.length) return out;
  for (const r of await db.all('SELECT user_id, season, place FROM season_results WHERE place <= 3 AND user_id = ANY($1::int[]) ORDER BY season DESC', [ids]))
    (out[r.user_id] = out[r.user_id] || []).push({ season: r.season, place: r.place });
  return out;
}
const ownedCards = async userId => (await q.cardsOf(userId)).map(r => Object.assign(G.cardView(r), r.listing_id ? { listingId: r.listing_id, listPrice: r.listing_price } : {}));
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
  if (cards.some(c => c.listingId)) throw new Error('One of these cards is listed on the Market. Cancel the listing to use it.');
  const power = cards.reduce((a, c) => a + c.pow, 0);
  if (room.limit !== null && power > room.limit) throw new Error(`Deck power ${power} is over the room cap of ${room.limit}.`);
  return { room, cards };
}

// Session lookups are cached in memory for a few minutes so most requests skip one database query
// (fewer queries keep the database small and cheap). Sign-out removes the entry right away.
const SESSION_CACHE_MS = 5 * 60 * 1000;
const sessionCache = new Map(); // token -> { userId, expiresAt, until }
async function sessionUser(token) {
  if (!token) return null;
  token = String(token);
  let hit = sessionCache.get(token);
  if (!hit || hit.until < now() || hit.expiresAt < now()) {
    const row = await db.one('SELECT user_id, expires_at FROM sessions WHERE token = $1 AND expires_at > $2', [token, now()]);
    if (!row) { sessionCache.delete(token); return null; }
    hit = { userId: row.user_id, expiresAt: Number(row.expires_at), until: now() + SESSION_CACHE_MS };
    if (sessionCache.size > 20000) sessionCache.clear(); // simple bound on memory
    sessionCache.set(token, hit);
  }
  return q.userById(hit.userId);
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
  let user = (await q.userByAddress(address)) || (await createUser(address));
  if (isFounder(user)) {
    founderIds.add(user.id);
    if (FOUNDER_NICK && user.nickname !== FOUNDER_NICK) {
      try { await db.query('UPDATE users SET nickname = $1 WHERE id = $2', [FOUNDER_NICK, user.id]); user = await q.userById(user.id); }
      catch (e) { if (e.code === '23505') console.warn(`FOUNDER_NICK "${FOUNDER_NICK}" is already used by another player.`); else throw e; }
    }
  }
  const token = crypto.randomBytes(32).toString('hex');
  await db.query('INSERT INTO sessions(token, user_id, expires_at) VALUES($1,$2,$3)', [token, user.id, now() + SESSION_MS]);
  res.json({ token, profile: publicProfile(user) });
}));

app.post('/api/logout', auth, route(async (req, res) => {
  await db.query('DELETE FROM sessions WHERE token = $1', [req.token]);
  sessionCache.delete(req.token);
  res.json({ ok: true });
}));

// ---------- profile ----------
app.get('/api/config', (req, res) => {
  res.json({ season: G.SEASON, tiers: G.TIERS, rewards: Array.from({ length: G.SEASON.paidPlaces }, (_, i) => G.seasonReward(i + 1)), market: G.MARKET, fusion: G.FUSION, practice: G.PRACTICE, botLevels: G.BOT_LEVELS, elements: G.ELEMENTS, rarities: G.RARITIES, rooms: G.ROOMS, packs: G.PACKS, match: G.MATCH, economy: { dailyBonus: G.ECONOMY.dailyBonus, feeSplit: G.ECONOMY.feeSplit },
    walletConnectId: (process.env.WALLETCONNECT_PROJECT_ID || '').trim() || null, chainId: G.CHAIN_ID });
});

app.get('/api/me', auth, route(async (req, res) => {
  const unseen = await db.one(`SELECT r.*, (SELECT COUNT(*)::int FROM season_results x WHERE x.season = r.season) AS field
                               FROM season_results r WHERE r.user_id = $1 AND NOT r.seen ORDER BY r.season DESC LIMIT 1`, [req.user.id]);
  res.json({ profile: publicProfile(req.user), badges: (await badgesOf([req.user.id]))[req.user.id] || [], cards: await ownedCards(req.user.id),
    decks: await decksOf(req.user.id), activeMatch: matchmaker.activeMatchOf(req.user.id),
    seasonResult: !unseen ? null : { season: unseen.season, place: unseen.place, of: unseen.field, reward: unseen.reward, elo: unseen.elo,
      wins: unseen.wins, losses: unseen.losses, draws: unseen.draws, newElo: req.user.elo } });
}));

app.post('/api/nickname', auth, route(async (req, res) => {
  const nick = String(req.body.nickname || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(nick)) return fail(res, 400, 'Use 3–16 letters, numbers or underscores.');
  if (req.user.nickname) return fail(res, 400, 'Your nickname is already set.');
  if (reservedNick(nick) && !isFounder(req.user)) return fail(res, 400, 'That nickname is reserved. Try another one.');
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

// ---------- fusion (the Forge) ----------
app.post('/api/fuse', auth, route(async (req, res) => {
  const uids = req.body.uids;
  const F = G.FUSION;
  if (!Array.isArray(uids) || uids.length < F.minCards || uids.length > F.maxCards || !uids.every(Number.isInteger))
    return fail(res, 400, `Choose ${F.minCards} to ${F.maxCards} cards to fuse.`);
  if (new Set(uids).size !== uids.length) return fail(res, 400, 'Each card can only be used once.');
  if (matchmaker.isBusy(req.user.id)) return fail(res, 400, 'Finish your match or cancel your search before fusing.');
  let out;
  try {
    out = await db.tx(async c => {
      // lock the player's cards so two fusions can't use the same card
      const owned = await db.all(`SELECT c.uid, c.tpl, l.id AS listing_id FROM cards c LEFT JOIN listings l ON l.card_uid = c.uid AND l.status = 'active'
                                  WHERE c.owner_id = $1 FOR UPDATE OF c`, [req.user.id], c);
      const used = uids.map(u => owned.find(o => o.uid === u));
      if (used.some(x => !x)) throw new Error('You no longer own one of these cards.');
      if (used.some(x => x.listing_id)) throw new Error('One of these cards is listed on the Market. Cancel the listing first.');
      const rarities = new Set(used.map(x => G.TEMPLATES[x.tpl][2]));
      if (rarities.size !== 1) throw new Error('All cards in a fusion must have the same rarity.');
      const rarity = [...rarities][0];
      const tier = F.tiers[rarity];
      if (!tier) throw new Error('Legendary cards are already the highest rarity.');
      if (owned.filter(x => !x.listing_id).length - uids.length + 1 < F.keepAtLeast) throw new Error(`You need to keep at least ${F.keepAtLeast} cards for a deck.`);
      if (!(await q.spendBalance(req.user.id, tier.fee, c))) throw new Error(`Not enough FLIP. This fusion costs ${tier.fee.toLocaleString('en-US')} FLIP.`);
      await db.addStat('burned', tier.fee, c);
      await db.query('DELETE FROM cards WHERE owner_id = $1 AND uid = ANY($2::int[])', [req.user.id, uids], c);
      await db.query('DELETE FROM decks WHERE user_id = $1', [req.user.id], c); // old saved decks may reference fused cards
      const chance = G.fusionChance(rarity, uids.length);
      const success = crypto.randomInt(0, 1000000) < Math.round(chance * 1000000);
      const resultRarity = success ? tier.to : rarity;
      const pool = G.TEMPLATES.map((t, i) => i).filter(i => G.TEMPLATES[i][2] === resultRarity);
      const tpl = pool[crypto.randomInt(0, pool.length)];
      const card = await q.insertCard(req.user.id, tpl, c);
      await db.query(`INSERT INTO fusions(user_id, rarity, cards_used, chance, success, result_tpl, fee, created_at)
                      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [req.user.id, rarity, uids.length, chance, success, tpl, tier.fee, now()], c);
      return { success, chance, rarity, resultUid: card.uid, fee: tier.fee };
    });
  } catch (e) { return fail(res, 400, e.message); }
  const cards = await ownedCards(req.user.id);
  res.json({ ...out, card: cards.find(x => x.uid === out.resultUid), consumed: uids, profile: publicProfile(await q.userById(req.user.id)) });
}));

app.get('/api/fusion-stats', route(async (req, res) => {
  const rows = await db.all(`SELECT rarity, cards_used, COUNT(*)::int AS tries, SUM(CASE WHEN success THEN 1 ELSE 0 END)::int AS wins
                             FROM fusions GROUP BY rarity, cards_used ORDER BY rarity, cards_used`);
  res.json({ stats: rows });
}));

// ---------- marketplace ----------
const M = G.MARKET;
const listingView = (r, me) => ({
  id: r.id, price: r.price, createdAt: r.created_at, seller: r.seller_name, mine: me != null && r.seller_id === me,
  card: G.cardView({ uid: r.card_uid, tpl: r.tpl, token_no: r.token_no }),
});
const LISTING_SQL = `SELECT l.*, u.nickname AS seller_name, c.token_no FROM listings l
                     JOIN users u ON u.id = l.seller_id JOIN cards c ON c.uid = l.card_uid`;
async function marketBroadcast(kind, listingId, extra) {
  // everyone on the Market screen gets the change live
  const row = await db.one(`${LISTING_SQL} WHERE l.id = $1`, [listingId]);
  io.to('w:market').emit('market:update', { kind, listing: row && listingView(row, null), ...extra }); // only players looking at the Market
}

app.get('/api/market', auth, route(async (req, res) => {
  const rows = await db.all(`${LISTING_SQL} WHERE l.status = 'active' ORDER BY l.created_at DESC LIMIT 500`);
  const sales = await db.all(`${LISTING_SQL} WHERE l.status = 'sold' ORDER BY l.closed_at DESC LIMIT 15`);
  const avg = await db.all(`SELECT tpl, ROUND(AVG(price))::bigint AS avg, COUNT(*)::int AS n FROM
                            (SELECT tpl, price, ROW_NUMBER() OVER (PARTITION BY tpl ORDER BY closed_at DESC) AS k FROM listings WHERE status = 'sold') t
                            WHERE k <= 10 GROUP BY tpl`);
  res.json({
    listings: rows.map(r => listingView(r, req.user.id)),
    recent: sales.map(r => ({ ...listingView(r, req.user.id), soldAt: r.closed_at })),
    avgPrice: Object.fromEntries(avg.map(a => [a.tpl, { avg: a.avg, n: a.n }])),
  });
}));

app.post('/api/market/list', auth, route(async (req, res) => {
  const uid = Number(req.body.uid), price = Math.round(Number(req.body.price));
  if (!Number.isFinite(price) || price < M.minPrice || price > M.maxPrice)
    return fail(res, 400, `Set a price between ${M.minPrice.toLocaleString('en-US')} and ${M.maxPrice.toLocaleString('en-US')} FLIP.`);
  if (matchmaker.isBusy(req.user.id)) return fail(res, 400, 'Finish your match or cancel your search before listing cards.');
  let id;
  try {
    id = await db.tx(async c => {
      const owned = await db.all(`SELECT c.uid, c.tpl, l.id AS listing_id FROM cards c LEFT JOIN listings l ON l.card_uid = c.uid AND l.status = 'active'
                                  WHERE c.owner_id = $1 FOR UPDATE OF c`, [req.user.id], c);
      const card = owned.find(x => x.uid === uid);
      if (!card) throw new Error('You do not own this card.');
      if (card.listing_id) throw new Error('This card is already listed.');
      const listed = owned.filter(x => x.listing_id).length;
      if (listed >= M.maxListings) throw new Error(`You can have at most ${M.maxListings} cards listed at once.`);
      if (owned.length - listed - 1 < G.FUSION.keepAtLeast) throw new Error(`Keep at least ${G.FUSION.keepAtLeast} unlisted cards so you can still build a deck.`);
      return (await db.one(`INSERT INTO listings(seller_id, card_uid, tpl, price, created_at) VALUES($1,$2,$3,$4,$5) RETURNING id`,
        [req.user.id, uid, card.tpl, price, now()], c)).id;
    });
  } catch (e) { return fail(res, 400, e.message); }
  await marketBroadcast('listed', id);
  res.json({ ok: true, listingId: id });
}));

app.post('/api/market/cancel', auth, route(async (req, res) => {
  const r = await db.query(`UPDATE listings SET status = 'cancelled', closed_at = $1 WHERE id = $2 AND seller_id = $3 AND status = 'active'`,
    [now(), Number(req.body.listingId), req.user.id]);
  if (!r.rowCount) return fail(res, 400, 'This listing is no longer active.');
  await marketBroadcast('cancelled', Number(req.body.listingId));
  res.json({ ok: true });
}));

app.post('/api/market/buy', auth, route(async (req, res) => {
  const listingId = Number(req.body.listingId);
  let sale;
  try {
    sale = await db.tx(async c => {
      // claiming the listing is atomic: only one buyer can ever flip it from active to sold
      const l = await db.one(`UPDATE listings SET status = 'sold', buyer_id = $1, closed_at = $2
                              WHERE id = $3 AND status = 'active' AND seller_id <> $1 RETURNING *`, [req.user.id, now(), listingId], c);
      if (!l) {
        const x = await db.one('SELECT seller_id, status FROM listings WHERE id = $1', [listingId], c);
        throw new Error(x && x.seller_id === req.user.id && x.status === 'active' ? 'You cannot buy your own card.' : 'Someone else just bought this card, or it was taken off the market.');
      }
      if (!(await q.spendBalance(req.user.id, l.price, c))) throw new Error('Not enough FLIP to buy this card.');
      const moved = await db.query('UPDATE cards SET owner_id = $1 WHERE uid = $2 AND owner_id = $3', [req.user.id, l.card_uid, l.seller_id], c);
      if (moved.rowCount !== 1) throw new Error('This card is no longer available.');
      const fee = Math.round(l.price * M.fee);
      await q.addBalance(l.seller_id, l.price - fee, c);
      await db.addStat('burned', fee / 2, c);
      await db.addStat('treasury', fee / 2, c);
      await db.addStat('market_volume', l.price, c);
      return { ...l, fee };
    });
  } catch (e) { return fail(res, 400, e.message); }
  const buyer = await q.userById(req.user.id);
  const card = G.cardView({ uid: sale.card_uid, tpl: sale.tpl, token_no: 0 });
  await marketBroadcast('sold', listingId, { buyer: buyer.nickname });
  const seller = await q.userById(sale.seller_id);
  matchmaker.notify(sale.seller_id, 'market:sold', { card: card.name, price: sale.price, received: sale.price - sale.fee, buyer: buyer.nickname, profile: publicProfile(seller) });
  res.json({ ok: true, card: (await ownedCards(req.user.id)).find(x => x.uid === sale.card_uid), price: sale.price, profile: publicProfile(buyer) });
}));

app.post('/api/season/seen', auth, route(async (req, res) => {
  await db.query('UPDATE season_results SET seen = TRUE WHERE user_id = $1', [req.user.id]);
  res.json({ ok: true });
}));

// Season leaderboard: everyone who played a ranked match this season, ordered by rating.
// Reward places count only qualified players (min matches), so the projected reward is shown per row.
app.get('/api/leaderboard', route(async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const viewer = token ? await sessionUser(token) : null;
  const season = seasons.current() || await seasons.load();
  const rows = await db.all(`SELECT id, nickname, elo, season_played AS played, season_wins AS wins, season_losses AS losses, season_draws AS draws
                             FROM users WHERE nickname IS NOT NULL AND season_played > 0 ORDER BY elo DESC, season_wins DESC, id ASC`);
  let q2 = 0;
  const ranked = rows.map((u, i) => {
    const qualified = u.played >= G.SEASON.minMatches;
    const place = qualified ? ++q2 : null;
    return { rank: i + 1, ...u, tier: G.tierOf(u.elo).id, qualified, place, reward: place ? G.seasonReward(place) : 0 };
  });
  const top = ranked.slice(0, 100);
  const meRow = viewer && ranked.find(r => r.id === viewer.id);
  const badges = await badgesOf([...new Set(top.map(r => r.id).concat(meRow ? [meRow.id] : []))]);
  top.forEach(r => (r.badges = badges[r.id] || []));
  if (meRow) meRow.badges = badges[meRow.id] || [];
  const last = await db.one('SELECT number FROM seasons WHERE finalized_at IS NOT NULL ORDER BY number DESC LIMIT 1');
  const podium = last ? await db.all(`SELECT r.place, r.elo, r.reward, u.nickname FROM season_results r JOIN users u ON u.id = r.user_id
                                      WHERE r.season = $1 AND r.place <= 3 ORDER BY r.place`, [last.number]) : [];
  const total = await db.one('SELECT COUNT(*)::int AS n FROM users WHERE nickname IS NOT NULL');
  res.json({
    season: { number: season.number, startsAt: Number(season.starts_at), endsAt: Number(season.ends_at), serverNow: Date.now() },
    players: top, me: meRow || (viewer ? { id: viewer.id, nickname: viewer.nickname, elo: viewer.elo, tier: G.tierOf(viewer.elo).id, played: viewer.season_played, rank: null } : null),
    ranked: ranked.length, totalPlayers: total.n, lastSeason: last && { number: last.number, podium },
    burned: await db.getStat('burned'), online: matchmaker.onlineCount(),
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

const matchmaker = createMatchmaker({ io, db, q, G, validateDeck, publicProfile, badgesOf });
const seasons = createSeasons({ db, G, io });
const island = createIsland({ io, q, G, isFounderId: id => founderIds.has(id) });
// Live feeds are only sent to players looking at the screen that shows them.
const WATCH = { lobby: 'w:lobby', market: 'w:market' };
io.on('connection', socket => {
  matchmaker.onConnection(socket); island.onConnection(socket);
  socket.on('watch', (what, fn) => {
    for (const r of Object.values(WATCH)) socket.leave(r);
    if (WATCH[what]) socket.join(WATCH[what]);
    if (what === 'lobby') socket.emit('lobby', matchmaker.lobbySnapshot());
    if (typeof fn === 'function') fn({ ok: true });
  });
});

setInterval(() => {
  db.query('DELETE FROM sessions WHERE expires_at < $1', [now()]).catch(() => {});
  db.query('DELETE FROM nonces WHERE expires_at < $1', [now()]).catch(() => {});
}, 60 * 60 * 1000).unref();

db.init()
  .then(async () => { if (FOUNDERS.size) for (const r of await db.all('SELECT id FROM users WHERE address = ANY($1::text[])', [[...FOUNDERS]])) founderIds.add(r.id); })
  .then(() => seasons.start())
  .then(() => server.listen(PORT, () => console.log(`Flipfight running on http://localhost:${PORT}`)))
  .catch(err => { console.error('Could not connect to the database:', err.message); process.exit(1); });
