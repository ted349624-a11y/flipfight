(function () {
'use strict';
const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString('en-US');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = ms => new Promise(r => setTimeout(r, reduced ? Math.min(ms, 250) : ms));
const shortAddr = a => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';

const EL_COLORS = {
  fire: ['#ff6b35', '#a8331b', '#ffd166'], wind: ['#8fe3ff', '#3e8fb0', '#ffffff'],
  earth: ['#d39552', '#7a4a22', '#f1d29a'], water: ['#4f8dff', '#23408f', '#a9d1ff'],
};
const RAR_COLORS = { common: '#a7a3c2', rare: '#4fa3ff', epic: '#b26bff', legendary: '#ffcc33' };

const S = {
  token: null, cfg: null, me: null, cards: [], decks: {}, socket: null,
  lobby: { waiting: {}, online: 0 }, room: null, sel: [], tab: 'arena', filter: 'all',
  match: null, matchSel: null, seenLog: 0, newUids: [], lastRoomId: null,
  sfx: true, botLevel: 'normal',
};
try { S.token = localStorage.getItem('ff-token'); S.sfx = localStorage.getItem('ff-sfx') !== '0'; S.botLevel = localStorage.getItem('ff-bot') || 'normal'; } catch (e) {}
const saveToken = t => { S.token = t; try { t ? localStorage.setItem('ff-token', t) : localStorage.removeItem('ff-token'); } catch (e) {} };

// ---------- preview access (coming-soon mode) ----------
// A ?preview=KEY link is remembered in local storage and sent with every request,
// so testers stay in even if the wallet's browser drops cookies.
let PREVIEW = '';
try {
  const u = new URL(location.href), k = u.searchParams.get('preview');
  if (k) { localStorage.setItem('ff-preview', k); u.searchParams.delete('preview'); history.replaceState(null, '', u.pathname + u.search + u.hash); }
  PREVIEW = localStorage.getItem('ff-preview') || '';
} catch (e) {}

// ---------- api ----------
const API = (window.FLIPFIGHT_API || '').replace(/\/$/, '');
async function api(path, body) {
  let res;
  try {
    res = await fetch(API + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, S.token ? { Authorization: 'Bearer ' + S.token } : {}, PREVIEW ? { 'X-Preview-Key': PREVIEW } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) { throw new Error('Cannot reach the game server. Check your connection and try again.'); }
  return handle(res);
}
async function handle(res) {
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && S.token) { signOut(true); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

let toastT;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3500); }

// ---------- sound ----------
function beep(f, d = .08, type = 'square', v = .05, slide = 0, delay = 0) {
  if (!S.sfx) return;
  FX.beep(f, d, type, v, slide, delay);
}
const SFX = {
  click: () => beep(660, .04), lock: () => beep(330, .12, 'square', .05, -140), flip: () => beep(880, .06, 'triangle', .07),
  tick: () => beep(1200, .03, 'square', .03), coin: () => { beep(988, .06); beep(1319, .12, 'square', .05, 0, .06); },
  found: () => [440, 660, 880].forEach((f, i) => beep(f, .09, 'square', .05, 0, i * .08)),
  win: () => [523, 659, 784, 1047].forEach((f, i) => beep(f, .12, 'square', .05, 0, i * .1)),
  lose: () => [392, 330, 262, 196].forEach((f, i) => beep(f, .16, 'triangle', .07, 0, i * .12)),
  legend: () => [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => beep(f, .1, 'square', .045, 0, i * .07)),
  round: w => w ? beep(784, .1, 'square', .05, 200) : beep(220, .14, 'sawtooth', .04, -80),
};

// ---------- pixel art ----------
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function drawSprite(cv, seed, el, rarity, stage = 1) {
  const N = 12, r = rng(seed * 7919 + 13), ctx = cv.getContext('2d');
  cv.width = N; cv.height = N; ctx.clearRect(0, 0, N, N);
  const g = [...Array(N)].map(() => Array(N).fill(0));
  for (let y = 2; y < 11; y++) for (let x = 2; x < 6; x++) { const d = Math.abs(y - 6.5) / 5 + (5 - x) / 6; if (r() < .9 - d * .75) g[y][x] = 1; }
  for (let y = 3; y < 10; y++) g[y][5] = 1;
  for (let y = 0; y < N; y++) for (let x = 0; x < 6; x++) g[y][11 - x] = g[y][x];
  const o = g.map(row => row.slice());
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!g[y][x]) {
    if ((g[y - 1] && g[y - 1][x] === 1) || (g[y + 1] && g[y + 1][x] === 1) || g[y][x - 1] === 1 || g[y][x + 1] === 1) o[y][x] = 2;
  }
  const [main, shade, hi] = EL_COLORS[el];
  const ey = 4 + Math.floor(r() * 2);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = o[y][x]; if (!v) continue;
    ctx.fillStyle = v === 2 ? (stage >= 3 ? '#ffcc33' : stage === 2 ? hi : '#0b0916') : (y >= 8 ? shade : (y <= 4 && r() < .35 ? hi : main));
    ctx.fillRect(x, y, 1, 1);
  }
  cv.dataset.ey = ey; cv.dataset.main = main;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(4, ey, 1, 1); ctx.fillRect(7, ey, 1, 1);
  ctx.fillStyle = '#0b0916'; ctx.fillRect(4, ey + 1, 1, 1); ctx.fillRect(7, ey + 1, 1, 1);
  if (rarity === 'legendary') { ctx.fillStyle = '#ffcc33'; [[4, 0], [6, 0], [5, 1], [4, 1], [6, 1], [7, 0]].forEach(([x, y]) => ctx.fillRect(x, y, 1, 1)); }
  if (rarity === 'epic') { ctx.fillStyle = '#e0b8ff'; ctx.fillRect(1, 1, 1, 1); ctx.fillRect(10, 2, 1, 1); }
  if (stage >= 3) { ctx.fillStyle = '#fff3c4'; [[0, 0], [11, 1], [0, 10], [11, 11], [1, 5]].forEach(([x, y]) => ctx.fillRect(x, y, 1, 1)); } // evolved sparkle
}
function drawPack(cv, el, premium) {
  const W = 12, H = 16, ctx = cv.getContext('2d'); cv.width = W; cv.height = H;
  const [m, s, h] = EL_COLORS[el];
  ctx.fillStyle = '#0b0916'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = s; ctx.fillRect(1, 1, W - 2, H - 2);
  ctx.fillStyle = m; ctx.fillRect(2, 3, W - 4, H - 6);
  ctx.fillStyle = '#0b0916'; for (let x = 1; x < W - 1; x += 2) { ctx.fillRect(x, 1, 1, 1); ctx.fillRect(x + 1, H - 2, 1, 1); }
  ctx.fillStyle = premium ? '#ffcc33' : h;
  [[5, 6], [6, 6], [4, 7], [7, 7], [4, 8], [7, 8], [5, 9], [6, 9], [5, 7], [6, 8]].forEach(([x, y]) => ctx.fillRect(x, y, 1, 1));
}
const spriteSeed = c => c.tpl * 31 + 5;
const elName = el => S.cfg.elements[el].name;
const rar = r => S.cfg.rarities[r];

// Every card has two sides. opts.face: 1 shows the back. A card that was played in a round carries its final
// side (name/el/pow/ab already set, plus face and flipped) and is shown as is.
const abName = ab => (ab && S.cfg.abilities && S.cfg.abilities[ab] ? S.cfg.abilities[ab].name : '');
const abText = ab => (ab && S.cfg.abilities && S.cfg.abilities[ab] ? S.cfg.abilities[ab].text : '');
const sideOf = (c, face) => (face === 1 && c.back ? c.back : { name: c.name, el: c.el, pow: c.pow, ab: null });
function cardEl(c, opts = {}) {
  const playedCard = c.face !== undefined && c.chosenFace !== undefined;
  const face = playedCard ? c.face : opts.face === 1 && c.back ? 1 : 0;
  const s = playedCard ? { name: c.name, el: c.el, pow: c.pow, ab: c.ab } : sideOf(c, face);
  const other = !playedCard && c.back ? sideOf(c, 1 - face) : null;
  const b = document.createElement(opts.static ? 'div' : 'button');
  const life = c.life, stage = life ? life.stage : 1;
  b.className = 'card' + (opts.static ? ' static' : '') + (face ? ' is-back' : '') + (playedCard && c.flipped ? ' trapped' : '') + (stage > 1 ? ' st' + stage : '');
  b.style.setProperty('--rc', RAR_COLORS[c.rar]);
  if (!opts.static) b.type = 'button';
  b.innerHTML = `<div class="ct"><span class="cost" title="Energy cost: ${rar(c.rar).cost} of your 15 energy"><svg class="bolt" viewBox="0 0 5 8" aria-hidden="true"><path d="M2 0h1v1h-1zM3 0h1v1h-1zM4 0h1v1h-1zM2 1h1v1h-1zM3 1h1v1h-1zM1 2h1v1h-1zM2 2h1v1h-1zM0 3h1v1h-1zM1 3h1v1h-1zM2 3h1v1h-1zM3 3h1v1h-1zM4 3h1v1h-1zM2 4h1v1h-1zM3 4h1v1h-1zM1 5h1v1h-1zM2 5h1v1h-1zM1 6h1v1h-1zM0 7h1v1h-1z" fill="currentColor"/></svg>${rar(c.rar).cost}</span><span class="el e-${s.el}">${elName(s.el)}</span></div>
    <div class="artwrap"><canvas class="art"></canvas>${s.ab ? `<span class="abil" title="${esc(abText(s.ab))}">${esc(abName(s.ab))}</span>` : ''}${face ? '<span class="sidetag">BACK</span>' : ''}${stage > 1 ? `<span class="stagetag" title="Evolved: ${life.wins} round wins">${'★'.repeat(stage - 1)}</span>` : ''}</div><div class="cname">${esc(s.name)}</div>
    <div class="cf"><span class="pow num">${s.pow}</span><span class="tid">${esc(c.tid)}</span></div>
    ${life && (life.plays || life.owners > 1) ? `<div class="life" title="${life.plays} rounds played and ${life.wins} won in ranked matches · ${life.owners} owner${life.owners > 1 ? 's' : ''}${stage > 1 ? ' · evolved' : ''}">${life.wins}W/${life.plays}${life.owners > 1 ? ` · ${life.owners} own` : ''}</div>` : ''}
    ${other ? `<div class="other" title="Other side: ${esc(other.name)}, ${elName(other.el)} ${other.pow}${other.ab ? ', ' + esc(abName(other.ab)) : ''}">↻ <i class="e-${other.el}"></i>${other.pow}${other.ab ? ' ' + esc(abName(other.ab)) : ''}</div>` : ''}<span class="rar">${rar(c.rar).name}</span>`;
  drawSprite(b.querySelector('canvas'), spriteSeed(c) + (face ? 7777 : 0), s.el, c.rar, stage);
  if (opts.flip && c.back) {
    const f = document.createElement('span'); f.className = 'flipbtn'; f.setAttribute('role', 'button'); f.tabIndex = 0; f.textContent = '↻';
    f.title = 'Show the other side'; f.setAttribute('aria-label', 'Show the other side');
    const go = e => { e.stopPropagation(); e.preventDefault(); SFX.click(); const n = cardEl(c, { ...opts, face: 1 - face }); if (b.onclick) n.onclick = b.onclick; n.className = b.className.replace(/\s*is-back/, '') + (face ? '' : ' is-back'); if (b.disabled) n.disabled = true; b.replaceWith(n); n.querySelector('.flipbtn').focus(); };
    f.onclick = go; f.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') go(e); };
    b.appendChild(f);
  }
  if (opts.hint) { const h = document.createElement('span'); h.className = 'hint ' + opts.hint.cls; h.textContent = opts.hint.txt; h.title = opts.hint.title; b.appendChild(h); }
  if (opts.isNew) { const n = document.createElement('span'); n.className = 'newtag'; n.textContent = 'NEW'; b.appendChild(n); }
  if (c.listingId && !opts.noListed) { const n = document.createElement('span'); n.className = 'listedtag'; n.textContent = 'LISTED'; b.appendChild(n); }
  if (opts.price != null) { const pr = document.createElement('div'); pr.className = 'pricetag num'; pr.textContent = fmt(opts.price) + ' FLIP'; b.appendChild(pr); }
  b.setAttribute('aria-label', `${s.name}, ${elName(s.el)}, power ${s.pow}${s.ab ? ', ' + abName(s.ab) : ''}, energy ${rar(c.rar).cost}${other ? `. Other side: ${other.name}, ${elName(other.el)} ${other.pow}` : ''}`);
  return b;
}
// ---------- tiers and badges ----------
const tierOf = elo => { let t = S.cfg.tiers[0]; for (const x of S.cfg.tiers) if (elo >= x.min) t = x; return t; };
const nextTier = elo => S.cfg.tiers.find(x => x.min > elo);
const SHIELD = '<svg viewBox="0 0 7 8" aria-hidden="true"><path d="M0 0h7v5H6v1H5v1H4v1H3V7H2V6H1V5H0z" fill="currentColor"/><path d="M1 1h5v3H5v1H4v1H3V5H2V4H1z" fill="#0b0916" opacity=".35"/></svg>';
const TROPHY = '<svg viewBox="0 0 7 7" aria-hidden="true"><path d="M1 0h5v1h1v2H6v1H5v1H4v1h1v1H2V6h1V5H2V4H1V3H0V1h1z" fill="currentColor"/></svg>';
function tierBadge(elo, compact) {
  const t = tierOf(elo);
  return `<span class="tier-badge" style="color:${t.color}" title="${t.name} tier">${SHIELD}${compact ? '' : `<em>${t.name.toUpperCase()}</em>`}</span>`;
}
const PLACE_COL = ['#ffcc33', '#d6dde8', '#d38a52'];
function trophies(badges) {
  const list = badges || [], founder = list.some(b => b.founder);
  const bossName = id => ((S.cfg.bosses || []).find(x => x.id === id) || { name: 'the boss' }).name;
  return (founder ? '<span class="founder-tag" title="Flipfight founder">★ FOUNDER</span>' : '') + list.filter(b => b.place).slice(0, 3).map(b => `<span class="trophy" style="color:${PLACE_COL[b.place - 1]}" title="#${b.place} in Season ${b.season}">${TROPHY}<em>S${b.season}</em></span>`).join('')
    + list.filter(b => b.bossPlace).slice(0, 2).map(b => `<span class="trophy boss-badge" title="#${b.bossPlace} damage dealer against ${esc(bossName(b.boss))} (week ${b.season})">☠<em>W${b.season}</em></span>`).join('');
}

// clan banner next to a nickname
const bannerURLs = new Map();
function bannerURL(b) {
  const k = `${b.bg}.${b.fg}.${b.sym}.${b.pat}`;
  if (!bannerURLs.has(k)) bannerURLs.set(k, Island.bannerSprite(b).toDataURL());
  return bannerURLs.get(k);
}
const clanFlag = cl => (cl && cl.banner ? `<img class="cflag" src="${bannerURL(cl.banner)}" alt="" title="[${esc(cl.tag)}] ${esc(cl.name || '')}"><span class="ctag">${esc(cl.tag)}</span>` : '');
function backEl() { const d = document.createElement('div'); d.className = 'back bigback'; return d; }
function emptySlot(t) { const d = document.createElement('div'); d.className = 'empty'; d.textContent = t; return d; }

// ---------- screens ----------
const SCREENS = ['login', 'nickname', 'island', 'arena', 'deck', 'queue', 'match', 'result', 'collection', 'forge', 'market', 'shop', 'ranks', 'clans', 'boss', 'history'];
let current = null;
function show(id) {
  if (current !== id) window.scrollTo({ top: 0 });
  if (id !== 'island') Island.unmount();
  current = id; SCREENS.forEach(s => ($(s).hidden = s !== id));
  document.body.classList.toggle('on-island', id === 'island');
  watchFeed();
  if (S.me && S.me.nickname && id !== 'login' && id !== 'nickname') $('tabs').hidden = id === 'island';
  if (id !== 'forge') $('fgBar').hidden = true;
  atmosphere(id);
  $('guide').hidden = !(id === 'login' || id === 'arena');
}
// Ask the server only for the live feed this screen shows (room counts or market changes).
function watchFeed() {
  const want = ['arena', 'deck', 'queue'].includes(current) ? 'lobby' : current === 'market' ? 'market' : current === 'boss' ? 'boss' : '';
  if (S.socket && S.socket.connected && S.watching !== want) { S.watching = want; S.socket.emit('watch', want); }
}
// World scene, music and ambience for each screen
const roomScene = id => (id === 2 ? 'volcano' : id === 3 ? 'temple' : 'meadow');
function atmosphere(id) {
  const roomId = id === 'match' && S.match ? S.match.room.id : S.room ? S.room.id : null;
  if (['deck', 'queue', 'match'].includes(id) && roomId != null) FX.scene(roomScene(roomId));
  else if (id !== 'result') FX.scene('night');
  if (id !== 'match') FX.music('lobby');
  // the island itself is the backdrop of every screen: the camera rests on the building you are in
  const bossFight = roomId === 9 && ['deck', 'match', 'result'].includes(id);
  const focus = bossFight ? 'boss' : { arena: 'arena', deck: 'arena', queue: 'arena', match: 'arena', result: 'arena', collection: 'collection', forge: 'forge', market: 'market', shop: 'shop', ranks: 'ranks', clans: 'clans', boss: 'boss', history: 'history' }[id] || 'plaza';
  const mood = ['deck', 'queue', 'match', 'result'].includes(id) && roomId != null ? ({ 2: 'volcano', 3: 'temple' }[roomId] || 'calm') : 'calm';
  if (id === 'island') Island.backdropOff(); else Island.backdrop(focus, mood);
  FX.ambient(id === 'forge' ? 'forge' : id === 'market' ? 'market' : null);
}
// The guide opens by itself for players who haven't finished a match yet.
let guideAutoOpened = false;
function renderGuide() {
  if (!S.cfg || $('guideCard').firstChild) return;
  $('guideCard').appendChild(cardEl({ uid: 0, tpl: 10, name: 'Abyss Kraken', el: 'water', rar: 'epic', pow: 68, tid: '#0421', back: { name: 'Kraken Lord', el: 'earth', pow: 63, ab: 'trap' } }, { static: true, flip: true }));
}
function maybeOpenGuide() {
  if (guideAutoOpened || !S.me) return;
  guideAutoOpened = true;
  if (S.me.wins + S.me.losses + S.me.draws === 0) $('guide').open = true;
}
function setTab(tab) {
  if (S.match) return;
  S.tab = tab;
  [...$('tabs').children].forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab));
  ({ island: renderIsland, arena: renderArena, collection: renderCollection, forge: renderForge, market: renderMarket, shop: renderShop, ranks: renderRanks, clans: renderClans, boss: renderBoss, history: renderHistory })[tab]();
}
$('tabs').onclick = e => { const b = e.target.closest('button'); if (b && !b.disabled) { SFX.click(); setTab(b.dataset.tab); } };
function lockTabs(on) { [...$('tabs').children].forEach(b => { b.disabled = on; b.style.opacity = on ? .45 : 1; }); }

function updateTop() {
  const p = S.me; if (!p) return;
  $('bal').textContent = fmt(p.balance); $('elo').textContent = p.elo;
  if (S.cfg) $('tierTop').innerHTML = `${tierBadge(p.elo)}`;
  $('nick').textContent = (p.founder ? '★ ' : '') + (p.nickname || ''); $('addr').textContent = shortAddr(p.address);
  $('sfx').setAttribute('aria-pressed', S.sfx); $('sfx').textContent = S.sfx ? 'SFX ON' : 'SFX OFF';
  $('musicBtn').setAttribute('aria-pressed', FX.musicOn()); $('musicBtn').textContent = FX.musicOn() ? 'MUSIC ON' : 'MUSIC OFF';
  $('hudNick').innerHTML = clanFlag(p.clan) + esc((p.founder ? '★ ' : '') + (p.nickname || '')); $('hudBal').textContent = fmt(p.balance);
  if (S.cfg) $('hudTier').innerHTML = `${tierBadge(p.elo)} <span class="num">${p.elo}</span>`;
  $('hudMusic').setAttribute('aria-pressed', FX.musicOn());
  const sb = document.querySelector('#islandQuick [data-act=sfx]'); if (sb) sb.textContent = S.sfx ? 'SOUND FX: ON' : 'SOUND FX: OFF';
}
$('hudMusic').onclick = () => { FX.setMusic(!FX.musicOn()); updateTop(); SFX.click(); };
$('musicBtn').onclick = () => { FX.setMusic(!FX.musicOn()); updateTop(); SFX.click(); };
$('sfx').onclick = () => { S.sfx = !S.sfx; try { localStorage.setItem('ff-sfx', S.sfx ? '1' : '0'); } catch (e) {} updateTop(); SFX.click(); };

// ---------- wallet sign-in (any EVM wallet) ----------
// Browser wallets announce themselves with EIP-6963, so several can live side by side (MetaMask, Rabby,
// Coinbase Wallet, OKX, Phantom, Trust...). Old-style wallets that only set window.ethereum still work,
// phones without a wallet get "open in wallet app" links, and WalletConnect covers everything else
// (QR code or mobile app) when a project ID is configured on the server.
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const WALLETS = new Map(); // rdns -> { info: { name, icon, rdns }, provider }
const W = { provider: null, name: '', onChange: null, wc: null }; // the wallet used to sign in
addEventListener('eip6963:announceProvider', e => {
  const d = e.detail; if (!d || !d.info || !d.provider) return;
  WALLETS.set(d.info.rdns || d.info.uuid || d.info.name, d);
  if (!$('walletModal').hidden) renderWalletList();
  if (S.token && !W.provider && d.info.rdns === lastWallet()) watchWallet(d.provider, d.info.name);
});
dispatchEvent(new Event('eip6963:requestProvider'));
const lastWallet = () => { try { return localStorage.getItem('ff-wallet') || ''; } catch (e) { return ''; } };
const safeIcon = i => (typeof i === 'string' && /^data:image\/(svg\+xml|png|jpeg|webp|gif)[;,]/i.test(i) ? i : '');
// wallet apps whose built-in browser can open the game (used on phones without a wallet)
function previewSuffix() { let k = ''; try { k = localStorage.getItem('ff-preview') || ''; } catch (e) {} return k ? '?preview=' + encodeURIComponent(k) : ''; }
function walletLinks() {
  const url = location.origin + location.pathname + previewSuffix(), bare = location.host + location.pathname + previewSuffix(), enc = encodeURIComponent(url);
  return [
    ['MetaMask', 'https://metamask.app.link/dapp/' + bare],
    ['Trust Wallet', 'https://link.trustwallet.com/open_url?coin_id=60&url=' + enc],
    ['Coinbase Wallet', 'https://go.cb-w.com/dapp?cb_url=' + enc],
    ['OKX Wallet', 'okx://wallet/dapp/url?dappUrl=' + enc],
    ['Phantom', 'https://phantom.app/ul/browse/' + enc + '?ref=' + encodeURIComponent(location.origin)],
  ];
}
function renderLogin(msg) {
  $('walletBar').hidden = true; $('tabs').hidden = true;
  drawSprite($('loginArt'), 11 * 31 + 5, 'fire', 'legendary');
  $('loginErr').textContent = msg || '';
  const btn = $('connect');
  btn.textContent = 'Connect wallet'; btn.disabled = false;
  btn.onclick = openWalletPicker;
  show('login');
}
async function openWalletPicker() {
  SFX.click();
  dispatchEvent(new Event('eip6963:requestProvider'));
  if (!S.cfg) { try { S.cfg = await api('/api/config'); } catch (e) {} }
  $('walletModal').hidden = false; renderWalletList();
  const first = $('wmList').querySelector('button'); if (first) first.focus();
}
function closeWalletPicker() { $('walletModal').hidden = true; }
$('wmClose').onclick = closeWalletPicker;
$('walletModal').onclick = e => { if (e.target === $('walletModal')) closeWalletPicker(); };
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('walletModal').hidden) closeWalletPicker(); });
function renderWalletList() {
  const last = lastWallet(), list = [...WALLETS.values()].sort((a, b) => (b.info.rdns === last) - (a.info.rdns === last));
  const opt = (id, name, icon, tag) => `<button type="button" class="wallet-opt" data-w="${esc(id)}">${icon ? `<img src="${icon}" alt="">` : '<span class="wi">◆</span>'}<span>${esc(name)}</span>${tag ? `<em>${tag}</em>` : ''}</button>`;
  let html = list.map(d => opt('6963:' + (d.info.rdns || d.info.uuid || d.info.name), d.info.name || 'Wallet', safeIcon(d.info.icon), d.info.rdns === last ? 'LAST USED' : 'DETECTED')).join('');
  if (!list.length && window.ethereum) html += opt('injected', 'Browser wallet', '', 'DETECTED');
  if (S.cfg && S.cfg.walletConnectId) html += opt('walletconnect', 'WalletConnect' + (isMobile ? ' (any wallet app)' : ' (scan with phone)'), '', 'QR');
  if (!list.length && !window.ethereum) {
    if (isMobile) html += '<h3>OPEN FLIPFIGHT IN YOUR WALLET APP</h3>' + walletLinks().map(([n, u]) => `<a class="wallet-opt" href="${esc(u)}" rel="noopener"><span class="wi">↗</span><span>${esc(n)}</span></a>`).join('');
    else html += `<p class="note">No browser wallet found. Install one (for example <a href="https://metamask.io/download/" target="_blank" rel="noopener">MetaMask</a> or <a href="https://rabby.io" target="_blank" rel="noopener">Rabby</a>) and reload this page${S.cfg && S.cfg.walletConnectId ? ', or use WalletConnect with a wallet on your phone' : ''}.</p>`;
  }
  $('wmList').innerHTML = html;
}
$('wmList').onclick = async e => {
  const b = e.target.closest('button[data-w]'); if (!b) return;
  const id = b.dataset.w;
  [...$('wmList').querySelectorAll('button')].forEach(x => (x.disabled = true));
  try {
    let provider, name, rdns = '';
    if (id.startsWith('6963:')) { const d = WALLETS.get(id.slice(5)); provider = d.provider; name = d.info.name; rdns = d.info.rdns || ''; }
    else if (id === 'injected') { provider = window.ethereum; name = 'your wallet'; }
    else { b.querySelector('span:not(.wi)').textContent = 'Loading WalletConnect…'; provider = await walletConnectProvider(); name = 'your wallet app'; rdns = 'walletconnect'; }
    closeWalletPicker();
    await connectWallet(provider, name, rdns);
  } catch (err) {
    closeWalletPicker();
    $('loginErr').textContent = walletError(err, 'the wallet');
  }
};
// WalletConnect is loaded only when picked (it is large) from jsDelivr, pinned to a version.
async function walletConnectProvider() {
  if (W.wc) return W.wc;
  const { EthereumProvider } = await import('https://cdn.jsdelivr.net/npm/@walletconnect/ethereum-provider@2.17.0/+esm');
  const wc = await EthereumProvider.init({
    projectId: S.cfg.walletConnectId, showQrModal: true, optionalChains: [1, S.cfg.chainId || 4663],
    metadata: { name: 'Flipfight', description: 'Pixel NFT card duels', url: location.origin, icons: [] },
  });
  await wc.connect();
  W.wc = wc;
  return wc;
}
const walletError = (e, name) => e && (e.code === 4001 || /reject|denied|cancel/i.test(e.message || '')) ? `You cancelled the request in ${name}.`
  : e && e.code === -32002 ? `${name[0].toUpperCase() + name.slice(1)} already has a request open. Open it to finish.` : (e && e.message) || 'Could not connect to the wallet.';
const toHexUtf8 = str => '0x' + [...new TextEncoder().encode(str)].map(x => x.toString(16).padStart(2, '0')).join('');
async function connectWallet(provider, name, rdns) {
  const btn = $('connect'), err = $('loginErr');
  btn.disabled = true; err.textContent = '';
  try {
    btn.textContent = `Check ${name}…`;
    const [address] = await provider.request({ method: 'eth_requestAccounts' });
    if (!address) throw new Error(`No account selected in ${name}.`);
    const { message } = await api('/api/nonce?address=' + encodeURIComponent(address));
    btn.textContent = 'Sign the message…';
    // hex-encoded text is what every wallet accepts for personal_sign; it still shows as readable text
    const signature = await provider.request({ method: 'personal_sign', params: [toHexUtf8(message), address] });
    const res = await api('/api/login', { address, signature });
    saveToken(res.token);
    try { localStorage.setItem('ff-wallet', rdns || ''); } catch (e) {}
    watchWallet(provider, name);
    SFX.coin();
    await boot();
  } catch (e) {
    err.textContent = walletError(e, name);
    btn.textContent = 'Connect wallet';
  } finally { btn.disabled = false; }
}
// Sign out when the account in the wallet that signed in changes.
function watchWallet(provider, name) {
  if (W.provider && W.onChange && W.provider.removeListener) W.provider.removeListener('accountsChanged', W.onChange);
  W.provider = provider; W.name = name;
  W.onChange = accs => { if (provider !== W.provider) return; if (S.token && S.me && (!accs || !accs[0] || String(accs[0]).toLowerCase() !== String(S.me.address).toLowerCase())) signOut(false, 'Wallet changed. Sign in with the new account.'); };
  if (provider && provider.on) provider.on('accountsChanged', W.onChange);
}
// after a page reload the session is still valid; reattach the account watcher to the wallet used last
if (!lastWallet() && window.ethereum) setTimeout(() => { if (S.token && !W.provider) watchWallet(window.ethereum, 'your wallet'); }, 1500);

function signOut(expired, msg) {
  if (S.token && !expired) api('/api/logout', {}).catch(() => {});
  saveToken(null);
  if (W.wc && !expired) { W.wc.disconnect().catch(() => {}); W.wc = null; }
  if (S.socket) { S.socket.disconnect(); S.socket = null; }
  Island.unmount(); S.me = null; S.match = null; lockTabs(false);
  renderLogin(msg || (expired ? 'Your session ended. Please sign in again.' : ''));
}
$('logout').onclick = () => signOut(false);

// ---------- nickname ----------
function renderNickname() {
  $('walletBar').hidden = false; $('tabs').hidden = true; updateTop();
  $('nickErr').textContent = ''; show('nickname'); $('nickInput').focus();
}
$('nickForm').onsubmit = async e => {
  e.preventDefault();
  try {
    const res = await api('/api/nickname', { nickname: $('nickInput').value.trim() });
    S.me = res.profile; SFX.coin(); enterApp();
  } catch (err) { $('nickErr').textContent = err.message; }
};

// ---------- boot ----------
async function boot() {
  if (!S.cfg) S.cfg = await api('/api/config');
  if (S.cfg.clan) Island.setClanColors(S.cfg.clan.colors);
  renderGuide();
  if (!S.token) return renderLogin();
  let me;
  try { me = await api('/api/me'); } catch (e) { return renderLogin(S.token ? e.message : ''); }
  if (!S.token) return;
  S.me = me.profile; S.cards = me.cards; S.decks = me.decks; S.badges = me.badges; S.seasonResult = me.seasonResult;
  if (!S.me.nickname) return renderNickname();
  enterApp();
}
async function refreshMe() {
  const me = await api('/api/me');
  S.me = me.profile; S.cards = me.cards; S.decks = me.decks; S.badges = me.badges; S.seasonResult = me.seasonResult; updateTop();
  maybeSeasonModal();
}
function enterApp() {
  $('walletBar').hidden = false; $('tabs').hidden = false; updateTop();
  connectSocket();
  setTab('island');
  maybeSeasonModal();
}
// ---------- season end popup ----------
function maybeSeasonModal() {
  const r = S.seasonResult;
  if (!r || S.match || !$('seasonModal').hidden) return;
  const top3 = r.place <= 3;
  $('smTitle').textContent = `SEASON ${r.season} IS OVER`;
  $('smBody').innerHTML = `<div class="sm-place num" style="color:${top3 ? PLACE_COL[r.place - 1] : 'var(--fg)'}">#${r.place}</div>
    <p class="note">You finished ${ordinal(r.place)} of ${fmt(r.of)} qualified players with ${r.elo} ELO (${r.wins}W ${r.losses}L ${r.draws}D).</p>
    ${r.reward ? `<p class="sm-reward num">+${fmt(r.reward)} FLIP</p>` : '<p class="note">Only the top 100 earn FLIP. Climb higher next week!</p>'}
    ${top3 ? `<p class="sm-badge">${trophies([{ season: r.season, place: r.place }])} New badge unlocked</p>` : ''}
    <p class="note">Your rating moved from ${r.elo} to ${r.newElo} for the new season.</p>`;
  drawSprite($('smArt'), top3 ? 11 * 31 + 5 : 9 * 31 + 5, top3 ? 'fire' : 'wind', top3 ? 'legendary' : 'epic');
  $('seasonModal').hidden = false;
  r.reward ? (top3 ? SFX.legend() : SFX.win()) : SFX.flip();
}
const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
$('smOk').onclick = () => { $('seasonModal').hidden = true; S.seasonResult = null; api('/api/season/seen', {}).catch(() => {}); SFX.click(); };

// ---------- realtime ----------
function connectSocket() {
  if (S.socket) return;
  const auth = { token: S.token, preview: PREVIEW };
  const s = API ? io(API, { auth }) : io({ auth });
  S.socket = s;
  s.on('connect', () => { S.watching = null; watchFeed(); if (current === 'island') renderIsland(); }); // rejoin feeds and the island after a reconnect
  s.on('connect_error', err => {
    if (err.message === 'unauthorized') signOut(true);
    else if (err.message === 'nickname_required') renderNickname();
  });
  s.on('lobby', l => { S.lobby = l; if (current === 'arena') renderRooms(); if (current === 'queue') renderQueueNote(); });
  s.on('match:state', onMatchState);
  s.on('match:end', onMatchEnd);
  s.on('market:update', onMarketUpdate);
  s.on('boss:update', st => { Island.setBoss(st); if (BS.data) { BS.data.boss = st; if (current === 'boss') drawBossHero(); } });
  s.on('season:ended', d => { toast(`Season ${d.season} is over. Season ${d.next} has started!`); refreshMe().then(() => { if (current === 'ranks') renderRanks(); }).catch(() => {}); });
  s.on('market:sold', d => {
    S.me = d.profile; updateTop(); SFX.coin();
    toast(`${d.buyer} bought your ${d.card} for ${fmt(d.price)} FLIP. You received ${fmt(d.received)} FLIP.`);
    refreshMe().then(() => { if (current === 'market') drawMarket(); }).catch(() => {});
  });
  s.on('match:error', e => { clearInterval(radarT); S.match = null; lockTabs(false); toast(e.error); refreshMe().catch(() => {}).then(() => setTab('arena')); });
  s.on('session:replaced', () => { S.socket = null; toast('You opened Flipfight in another tab. This tab is now paused.'); });
}
function emit(ev, data) {
  return new Promise((resolve, reject) => {
    if (!S.socket || !S.socket.connected) return reject(new Error('Connection lost. Reconnecting…'));
    S.socket.timeout(8000).emit(ev, data, (err, res) => {
      if (err) return reject(new Error('The server did not answer. Try again.'));
      res && res.ok ? resolve(res) : reject(new Error((res && res.error) || 'Request failed.'));
    });
  });
}

// ---------- island (home) ----------
const BUILDING_TAB = { arena: 'arena', ranks: 'ranks', shop: 'shop', market: 'market', forge: 'forge', collection: 'collection', clans: 'clans', boss: 'boss', history: 'history' };
let hintTimer = 0;
function renderIsland() {
  show('island');
  Island.mount($('islandView'), {
    socket: S.socket, me: S.me,
    onEnter: id => { SFX.found(); setTab(BUILDING_TAB[id]); },
    onCount: (n, ch, cap) => { $('islandOnline').textContent = `● ISLAND #${ch || 1} · ${n}${cap ? '/' + cap : ''}`; },
  });
  $('islandQuick').innerHTML = Island.BUILDINGS.map(b => `<button type="button" data-b="${b.id}">${b.label}</button>`).join('') + '<button type="button" data-b="boss">WORLD BOSS</button>' +
    '<hr><button type="button" data-act="sfx"></button><button type="button" class="muted" data-act="out">SIGN OUT</button>';
  closeIslandMenu(); updateTop();
  $('islandHint').classList.remove('gone'); clearTimeout(hintTimer); hintTimer = setTimeout(() => $('islandHint').classList.add('gone'), 6000);
}
function closeIslandMenu() {
  $('islandQuick').hidden = true; $('islandMenu').setAttribute('aria-expanded', false);
  $('chanMenu').hidden = true; $('islandOnline').setAttribute('aria-expanded', false);
}
// Island channels: copies of the island with up to 50 players each
$('islandOnline').onclick = () => {
  const open = $('chanMenu').hidden; closeIslandMenu(); SFX.click();
  if (!open) return;
  $('chanMenu').hidden = false; $('islandOnline').setAttribute('aria-expanded', true);
  $('chanMenu').innerHTML = '<p>Loading channels…</p>';
  Island.channels(r => {
    if (!r) { $('chanMenu').innerHTML = '<p>Could not load channels.</p>'; return; }
    const cur = Island.state().channel, chans = r.channels.slice();
    let n = 1; while (chans.some(c => c.id === n)) n++;
    chans.push({ id: n, players: 0, cap: r.cap, fresh: true });
    $('chanMenu').innerHTML = '<p>Each island holds up to ' + r.cap + ' players.</p>' + chans.map(c =>
      `<button type="button" class="chan" data-ch="${c.id}" aria-current="${c.id === cur}" ${c.players >= c.cap && c.id !== cur ? 'disabled' : ''}>ISLAND #${c.id}<span>${c.fresh ? 'NEW' : c.players + '/' + c.cap}</span></button>`).join('');
  });
};
$('chanMenu').onclick = e => {
  const b = e.target.closest('[data-ch]'); if (!b || b.disabled) return;
  SFX.click(); closeIslandMenu(); Island.switchChannel(Number(b.dataset.ch));
};
$('islandMenu').onclick = () => {
  const open = $('islandQuick').hidden; closeIslandMenu(); $('islandQuick').hidden = !open; $('islandMenu').setAttribute('aria-expanded', open); SFX.click();
};
$('islandQuick').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  SFX.click();
  if (b.dataset.b) { closeIslandMenu(); setTab(BUILDING_TAB[b.dataset.b]); }
  else if (b.dataset.act === 'sfx') { $('sfx').click(); }
  else if (b.dataset.act === 'out') { closeIslandMenu(); $('logout').click(); }
};
$('islandView').addEventListener('pointerdown', closeIslandMenu);
$('emotes').onclick = e => { const b = e.target.closest('[data-e]'); if (b) { Island.emote(b.dataset.e); SFX.click(); } };

// ---------- arena ----------
const roomById = id => (id === 0 ? S.cfg.practice : id === 9 ? S.cfg.bossRoom : S.cfg.rooms.find(x => x.id === id));
function practiceCard() {
  const d = document.createElement('div'); d.className = 'frame practice';
  const levels = Object.entries(S.cfg.botLevels);
  d.innerHTML = `<div class="p-info"><span class="tier">PRACTICE · VS BOT</span>
      <span class="p-title">Learn the game for free</span>
      <span class="cap">No entry fee · no ELO change · always available</span></div>
    <div class="p-actions"><div class="p-levels" role="radiogroup" aria-label="Bot difficulty">${levels.map(([k, v]) =>
      `<button type="button" role="radio" data-level="${k}" aria-checked="${S.botLevel === k}">${v.name.toUpperCase()}</button>`).join('')}</div>
    <button class="btn" type="button" id="practiceGo">Practice ›</button></div>`;
  d.querySelectorAll('[data-level]').forEach(b => b.onclick = () => {
    S.botLevel = b.dataset.level; try { localStorage.setItem('ff-bot', S.botLevel); } catch (e) {}
    SFX.click(); renderRooms();
  });
  d.querySelector('#practiceGo').onclick = () => { SFX.click(); openDeck(S.cfg.practice); };
  return d;
}
function renderRooms() {
  const box = $('rooms'); box.innerHTML = '';
  box.appendChild(practiceCard());
  S.cfg.rooms.forEach(rm => {
    if (rm.ante) {
      const b = document.createElement('button'); b.className = 'room ante-room'; b.type = 'button';
      b.innerHTML = `<span class="tier">${rm.name}</span><span class="cap">Stake</span><span class="stake">ONE CARD</span>
        <span class="win">Win their card</span><span class="cap">Paired by card rarity · ranked</span>
        <span class="waiting">${(S.lobby.waiting[rm.id] || 0) ? S.lobby.waiting[rm.id] + ' waiting now' : 'Nobody waiting'}</span><span class="go">PLAY ›</span>`;
      b.onclick = () => { SFX.click(); openDeck(rm); };
      box.appendChild(b); return;
    }
    const ok = S.me.balance >= rm.stake;
    const b = document.createElement('button'); b.className = 'room' + (ok ? '' : ' locked'); b.type = 'button';
    const net = rm.stake * 2 * (1 - rm.rake) - rm.stake;
    const waiting = S.lobby.waiting[rm.id] || 0;
    b.innerHTML = `<span class="tier">${rm.name}</span>
      <span class="cap">Entry</span><span class="stake num">${fmt(rm.stake)} FLIP</span>
      <span class="win num">Win +${fmt(net)}</span>
      <span class="cap">Deck cap: ${rm.limit === null ? 'none' : rm.limit + ' power'}</span>
      <span class="waiting">${waiting ? waiting + ' waiting now' : 'Nobody waiting'}</span>
      <span class="go">${ok ? 'PLAY ›' : 'NOT ENOUGH FLIP'}</span>`;
    b.onclick = () => { SFX.click(); openDeck(rm); };
    box.appendChild(b);
  });
  $('lobbyLine').textContent = `${S.lobby.online || 1} online · ${S.lobby.playing || 0} in matches · win 3 of 5 rounds to take the pot`;
}
function renderArena() {
  updateTop(); renderRooms();
  $('bonusBox').hidden = S.me.bonusReadyIn > 0;
  show('arena');
  maybeOpenGuide();
}
$('claim').onclick = async () => {
  try { const r = await api('/api/bonus', {}); S.me = r.profile; SFX.coin(); toast('+25,000 FLIP added.'); renderArena(); }
  catch (e) { toast(e.message); }
};

// ---------- deck ----------
const byUid = uid => S.cards.find(c => c.uid === uid);
const sortedCards = () => S.cards.slice().sort((a, b) => rar(b.rar).rank - rar(a.rar).rank || b.pow - a.pow);
function openDeck(rm) {
  S.room = rm;
  S.sel = []; S.anteUid = null; // the player always chooses their own 5 cards
  $('deckTitle').textContent = rm.name;
  $('deckSub').textContent = rm.id === 0 ? `Free practice vs ${S.cfg.botLevels[S.botLevel].name} bot · pick 5 cards` : rm.id === 9 ? 'Free fight · no deck cap · pick your 5 hardest hitters' : rm.ante ? 'No FLIP entry · pick 5 cards, then put one of them on the line' : `Entry ${fmt(rm.stake)} FLIP · pick 5 cards`;
  renderDeck(); show('deck');
}
function renderDeck() {
  const rm = S.room, cs = S.sel.map(byUid);
  const pow = cs.reduce((a, c) => a + c.pow, 0), en = cs.reduce((a, c) => a + rar(c.rar).cost, 0);
  const box = $('pickGrid'); box.innerHTML = '';
  sortedCards().forEach(c => {
    const el = cardEl(c, { flip: true }); const on = S.sel.includes(c.uid);
    if (on) el.classList.add('sel');
    if (c.listingId) { el.classList.add('dim'); el.disabled = true; el.title = 'Listed on the Market'; box.appendChild(el); return; }
    el.setAttribute('aria-pressed', on);
    el.onclick = () => { if (on) S.sel = S.sel.filter(x => x !== c.uid); else if (S.sel.length < 5) S.sel.push(c.uid); SFX.click(); renderDeck(); };
    box.appendChild(el);
  });
  const lim = rm.limit, over = lim !== null && pow > lim;
  $('mCount').textContent = `${S.sel.length} / 5`; $('bCount').style.width = (S.sel.length / 5 * 100) + '%';
  $('mPow').textContent = lim === null ? `${pow} / ∞` : `${pow} / ${lim}`;
  $('mPow').className = 'num' + (over ? ' warn' : '');
  $('bPow').style.width = (lim === null ? Math.min(pow / 450, 1) : Math.min(pow / lim, 1)) * 100 + '%';
  $('bPow').style.background = over ? 'var(--bad)' : 'var(--good)';
  $('mEn').textContent = `${en} / 15`; $('mEn').className = 'num' + (en > 15 ? ' warn' : '');
  $('bEn').style.width = Math.min(en / 15, 1) * 100 + '%'; $('bEn').style.background = en > 15 ? 'var(--gold)' : 'var(--wind)';
  const need = 5 - S.sel.length;
  $('pcSlots').innerHTML = [0, 1, 2, 3, 4].map(i => { const c = cs[i]; return `<i class="${c ? 'on e-' + c.el : ''}"></i>`; }).join('');
  $('pickCall').classList.toggle('done', need === 0);
  $('pcTitle').textContent = need === 0 ? 'DECK READY' : need === 5 ? 'CHOOSE 5 CARDS' : `CHOOSE ${need} MORE CARD${need > 1 ? 'S' : ''}`;
  $('pcSub').textContent = need === 0 ? 'Tap a selected card to swap it out, or start the match.' : need === 5 ? 'Tap cards below to add them to your deck. Each card can be used once per match.' : 'Tap a card to add it, tap again to remove it.';
  $('clearDeck').hidden = S.sel.length === 0;
  $('deckHint').hidden = S.sel.length === 0;
  $('deckHint').textContent = en > 15 ? `Energy cost is ${en - 15} over 15, so at least one card will play exhausted (half power).` : 'Energy fits: every card can play at full power.';
  // ante room: choose which of the 5 cards goes on the line
  if (S.anteUid && !S.sel.includes(S.anteUid)) S.anteUid = null;
  $('antePick').hidden = !rm.ante;
  if (rm.ante) {
    $('antePick').innerHTML = `<b>YOUR ANTE CARD</b><p class="note">${S.sel.length < 5 ? 'Pick your 5 cards first, then choose one to put on the line.' : 'You only meet players who ante a card of the same rarity. Win and you take their card; lose and they take yours.'}</p>
      <div class="ante-row">${cs.map(c => `<button type="button" data-ante="${c.uid}" aria-pressed="${S.anteUid === c.uid}"><i class="e-${c.el}"></i>${esc(c.name)} <span class="ctag" style="color:${RAR_COLORS[c.rar]}">${rar(c.rar).name}</span></button>`).join('')}</div>`;
  }
  const enough = S.me.balance >= rm.stake, ready = S.sel.length === 5 && !over && enough && (!rm.ante || !!S.anteUid);
  $('enter').disabled = !ready;
  $('enter').textContent = rm.id === 0 ? `Start practice · ${S.cfg.botLevels[S.botLevel].name} bot` : rm.id === 9 ? 'Fight the boss' : rm.ante ? (S.anteUid ? `Find opponent · ante ${byUid(S.anteUid).name}` : 'Choose your ante card') : `Find opponent · lock ${fmt(rm.stake)} FLIP`;
  $('enterNote').textContent = !enough ? 'Not enough FLIP.' : over ? 'Deck power is over the room cap. Swap a strong card for a weaker one.' : S.sel.length < 5 ? `Choose ${5 - S.sel.length} more card${5 - S.sel.length > 1 ? 's' : ''} to start.` : '';
  $('enterNote').className = 'note' + ((over || !enough) ? ' warn' : '');
}
$('backLobby').onclick = () => { SFX.click(); setTab(S.room && S.room.id === 9 ? 'boss' : 'arena'); };
$('antePick').onclick = e => { const b = e.target.closest('[data-ante]'); if (!b) return; S.anteUid = Number(b.dataset.ante); SFX.click(); renderDeck(); };
$('clearDeck').onclick = () => { S.sel = []; SFX.click(); renderDeck(); };
$('enter').onclick = async () => {
  const btn = $('enter'); btn.disabled = true;
  try {
    await api('/api/deck', { roomId: S.room.id, uids: S.sel });
    S.decks[S.room.id] = S.sel.slice();
    S.lastRoomId = S.room.id;
    SFX.lock();
    if (S.room.id === 0) { await emit('practice:start', { level: S.botLevel }); return; }
    if (S.room.id === 9) { await emit('boss:start', {}); return; }
    const res = await emit('queue:join', { roomId: S.room.id, ante: S.room.ante ? S.anteUid : undefined });
    S.me = res.profile; updateTop();
    if (!S.match) startQueueScreen();
  } catch (e) { toast(e.message); btn.disabled = false; }
};

// ---------- queue ----------
let radarT;
function drawRadar(cv, t) {
  const ctx = cv.getContext('2d'), N = 24; ctx.fillStyle = '#0e0c1a'; ctx.fillRect(0, 0, N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = x - 11.5, dy = y - 11.5, d = Math.hypot(dx, dy);
    if (Math.abs(d - 10) < .6 || Math.abs(d - 6) < .5) { ctx.fillStyle = '#3d3668'; ctx.fillRect(x, y, 1, 1); }
    let a = Math.atan2(dy, dx) - t; a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (d < 10.5 && a > Math.PI * 2 - .6) { ctx.fillStyle = a > Math.PI * 2 - .2 ? '#5fd38d' : '#2f7a50'; ctx.fillRect(x, y, 1, 1); }
  }
}
let queueStart = 0;
function startQueueScreen() {
  lockTabs(true); queueStart = Date.now();
  $('searchTitle').textContent = 'Finding an opponent';
  renderQueueNote();
  let t = 0; clearInterval(radarT); radarT = setInterval(() => { t += .35; drawRadar($('radar'), t); if (t % 3.5 < .35) renderQueueNote(); }, 90);
  show('queue');
}
function renderQueueNote() {
  if (!S.room) return;
  const secs = Math.floor((Date.now() - queueStart) / 1000);
  const an = S.room.ante && S.anteUid && byUid(S.anteUid);
  $('queueNote').textContent = an ? `${S.room.name} · ante ${an.name} (${rar(an.rar).name.toLowerCase()}) · looking for a ${rar(an.rar).name.toLowerCase()} ante · waiting ${secs}s`
    : `${S.room.name} · ${fmt(S.room.stake)} FLIP locked in escrow · ${S.lobby.online || 1} online · waiting ${secs}s`;
}
$('cancelQueue').onclick = async () => {
  try { const r = await emit('queue:leave', {}); S.me = r.profile; } catch (e) { toast(e.message); }
  clearInterval(radarT); lockTabs(false); toast('Search cancelled. Your entry was refunded.'); setTab('arena');
};

// ---------- match ----------
let timerT = null, clockSkew = 0;
function onMatchState(st) {
  const first = !S.match || S.match.matchId !== st.matchId;
  clockSkew = st.serverNow - Date.now();
  S.match = st;
  if (first) {
    clearInterval(radarT); lockTabs(true); SFX.found();
    S.matchSel = null; S.matchFace = 0; S.seenLog = st.log.length;
    lastRevealRound = st.phase === 'reveal' && st.log.length ? st.log[st.log.length - 1].round : 0; lastBannerRound = 0; FX.clearBattle();
    $('log').innerHTML = '';
    st.log.forEach(addLogLine);
  }
  if (st.phase === 'pick' && S.matchSel !== null && (st.you.used.includes(S.matchSel) || !st.you.hand.some(c => c.uid === S.matchSel))) S.matchSel = null;
  if (st.log.length > S.seenLog) { st.log.slice(S.seenLog).forEach(addLogLine); S.seenLog = st.log.length; }
  renderMatch(first);
  clearInterval(timerT); timerT = setInterval(drawTimer, 250); drawTimer();
  show('match');
}
function addLogLine(r) {
  const li = document.createElement('span'); li.className = r.result === 'win' ? 'w' : r.result === 'loss' ? 'l' : '';
  const ev = r.myEvents.concat(r.theirEvents).includes('trap') ? ' · flip trap!' : '';
  li.textContent = `Round ${r.round}: ${r.mine.name} ${r.myPower} vs ${r.theirs.name} ${r.theirPower} → ${r.result === 'win' ? 'you win' : r.result === 'loss' ? 'you lose' : 'tie'}${ev}${r.myAuto ? ' (auto-played)' : ''}`;
  $('log').appendChild(li);
}
function drawTimer() {
  const m = S.match; if (!m) return;
  if (m.phase === 'flip' && m.flipCall) {
    const l = Math.max(0, Math.ceil((m.flipCall.deadline - (Date.now() + clockSkew)) / 1000));
    $('timer').textContent = `FLIP ${l}s`; $('faTimer').textContent = `${l}s · no answer = accept`; return;
  }
  if (m.phase !== 'pick') { $('timer').textContent = ''; return; }
  const left = Math.max(0, Math.ceil((m.deadline - (Date.now() + clockSkew)) / 1000));
  const txt = `⏱ ${left}s`;
  if ($('timer').textContent !== txt && left <= 5 && left > 0 && m.you.pick === null) SFX.tick();
  $('timer').textContent = txt; $('timer').className = 'timer num' + (left <= 5 ? ' low' : '');
}
let lastRevealRound = 0, lastBannerRound = 0;
// keep the battlefield on screen for the reveal (on phones the hand sits below it)
function showBoard() {
  const b = document.querySelector('#match .board'); if (!b) return;
  const r = b.getBoundingClientRect();
  if (r.top < 0 || r.bottom > innerHeight) b.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}
function renderMatch() {
  const m = S.match;
  const oppLeft = m.opp.leftElements;
  $('oppSide').innerHTML = `<b>${clanFlag(m.opp.clan)}${esc(m.opp.nickname)} ${trophies(m.opp.badges)}</b><span class="meta num">${m.room.practice ? '' : tierBadge(m.opp.elo, true) + ' '}ELO ${m.opp.elo} · ⚡ ${m.opp.energy}</span>
    <div class="left" title="Their remaining cards: front and back element">${(m.opp.leftSides || oppLeft.map(e => [e, e])).map(([f, b]) => `<i class="pair"><b class="e-${f}"></b><b class="e-${b}"></b></i>`).join('')}</div>${m.opp.bonus ? `<span class="rally-note">RALLY +${m.opp.bonus}</span>` : ''}
    <span class="locked-note">${m.phase === 'pick' && m.opp.locked ? 'LOCKED IN' : ''}</span>`;
  $('mySide').innerHTML = `<b>${trophies(m.you.badges)} ${clanFlag(m.you.clan)}${esc(m.you.nickname)}</b><span class="meta num">${tierBadge(m.you.elo, true)} ELO ${m.you.elo} · ⚡ ${m.you.energy}</span>${m.you.bonus ? `<span class="rally-note">RALLY +${m.you.bonus} on your next card</span>` : ''}`;
  $('score').textContent = `${m.opp.wins} : ${m.you.wins}`;
  $('rnd').textContent = `ROUND ${m.round}/5`;
  $('pot').textContent = m.ante ? `ON THE LINE: ${m.ante.mine.name} ⇄ ${m.ante.theirs.name}` : m.room.boss ? `WORLD BOSS · deal damage` : m.room.practice ? `PRACTICE · NO STAKES${m.mult > 1 ? ' · ×' + m.mult : ''}` : `Pot ${fmt(m.entry * 2)} FLIP${m.mult > 1 ? ' · ×' + m.mult : ''}`;
  $('pot').classList.toggle('doubled', m.mult > 1);
  // FLIP! call: button, answer panel, banner when it's accepted
  $('flipCall').hidden = !m.canCall;
  $('flipCall').textContent = `FLIP! ×${m.mult * 2}`;
  const ask = m.phase === 'flip' && m.flipCall && !m.flipCall.mine;
  $('flipAsk').hidden = !ask;
  if (ask) {
    const afford = m.room.practice || S.me.balance >= m.flipCall.extra;
    $('faText').innerHTML = `${esc(m.opp.nickname)} wants to double the stakes to <b>×${m.mult * 2}</b>.` +
      (m.room.practice ? ' (Practice: nothing to pay.)' : ` Accepting costs <b class="num">${fmt(m.flipCall.extra)} FLIP</b>; folding loses this match now and your <b class="num">${fmt(m.entry)} FLIP</b> entry.`);
    $('faAccept').disabled = !afford; $('faAccept').textContent = afford ? 'Accept' : 'Not enough FLIP';
    if (S.flipAskShown !== m.flipCall.deadline) { S.flipAskShown = m.flipCall.deadline; SFX.found(); showBoard(); }
  }
  if (m.lastFlip && S.flipBannerAt !== m.lastFlip.at) {
    S.flipBannerAt = m.lastFlip.at;
    if (Date.now() + clockSkew - m.lastFlip.at < 6000) { FX.banner(document.querySelector('#match .board'), `FLIP! ×${m.lastFlip.mult}`, '#c79bff', m.lastFlip.mine ? 'They accepted' : 'You accepted'); SFX.legend(); }
  }
  $('quitPractice').hidden = !m.room.practice;
  $('quitPractice').textContent = m.room.boss ? 'Give up (no damage)' : 'Quit practice';

  // slots + verdict
  const last = m.log[m.log.length - 1];
  if (m.phase === 'reveal' && last) {
    const fresh = lastRevealRound !== last.round;
    const mc = cardEl(last.mine, { static: true }), oc = cardEl(last.theirs, { static: true });
    if (fresh) { mc.classList.add('flip'); oc.classList.add('flip'); }
    $('mySlot').replaceChildren(mc); $('oppSlot').replaceChildren(oc);
    const v = $('verdict');
    if (last.result === 'win') { v.textContent = 'ROUND WON'; v.style.color = 'var(--good)'; if (fresh) mc.classList.add('win-glow'); }
    else if (last.result === 'loss') { v.textContent = 'ROUND LOST'; v.style.color = 'var(--bad)'; if (fresh) oc.classList.add('win-glow'); }
    else { v.textContent = 'TIE'; v.style.color = 'var(--gold)'; }
    const EV = { trap: 'flip trap', rallied: `rally +${S.cfg.abilityNum.rally}`, ambush: `ambush +${S.cfg.abilityNum.ambush}`, shield: 'shield takes the tie', drain: `drain −${S.cfg.abilityNum.drain}⚡`, rally: 'rally next' };
    const note = (c, ex, vs, evs, flipped) => [flipped ? `flipped −${S.cfg.abilityNum.trapStun}` : '', ...evs.filter(e => EV[e]).map(e => EV[e]),
      S.cfg.elements[c.el].beats === vs ? (evs.includes('echo') ? 'echo +60%' : 'element +30%') : '', ex ? 'exhausted ×0.5' : ''].filter(Boolean).join(', ');
    const nt = note(last.theirs, last.theirExhausted, last.mine.el, last.theirEvents, last.theirs.flipped), nm = note(last.mine, last.myExhausted, last.theirs.el, last.myEvents, last.mine.flipped);
    $('calc').textContent = `${last.theirPower}${nt ? ' (' + nt + ')' : ''} – ${last.myPower}${nm ? ' (' + nm + ')' : ''}${last.myAuto ? ' · auto-played' : ''}`;
    if (fresh) {
      lastRevealRound = last.round; SFX.flip(); showBoard();
      const els = S.cfg.elements;
      FX.battle(document.querySelector('#match .board'), {
        myCard: mc, oppCard: oc, mine: last.mine, theirs: last.theirs, result: last.result,
        myPower: last.myPower, theirPower: last.theirPower,
        myBonus: els[last.mine.el].beats === last.theirs.el, theirBonus: els[last.theirs.el].beats === last.mine.el,
        myExhausted: last.myExhausted, theirExhausted: last.theirExhausted,
      });
      setTimeout(() => last.result !== 'tie' && SFX.round(last.result === 'win'), 1150);
      if (last.mine.flipped || last.theirs.flipped) setTimeout(() => FX.banner(document.querySelector('#match .board'), 'FLIP TRAP!', '#c79bff',
        last.mine.flipped && last.theirs.flipped ? 'Both cards flipped' : last.mine.flipped ? 'Your card was flipped' : 'You flipped their card'), 450);
    }
  } else {
    if (m.phase === 'pick' && m.round !== lastBannerRound) {
      lastBannerRound = m.round;
      const final = m.round === 5 || (m.you.wins === 2 && m.opp.wins === 2), point = m.you.wins === 2 || m.opp.wins === 2;
      const board = document.querySelector('#match .board');
      if (final) FX.banner(board, 'FINAL ROUND', '#ff5d6c', 'Winner takes all');
      else if (point) FX.banner(board, 'MATCH POINT', '#ffcc33', m.you.wins === 2 ? 'One more to win' : 'Hold the line');
      else FX.banner(board, `ROUND ${m.round}`, '#8fe3ff', m.round === 1 ? 'FIGHT!' : '');
      FX.music(final || point ? 'final' : 'arena');
    }
    $('oppSlot').replaceChildren(m.opp.locked ? backEl() : emptySlot('Opponent'));
    $('mySlot').replaceChildren(m.you.pick !== null ? backEl() : emptySlot('Your card'));
    $('verdict').textContent = m.folded ? (m.folded.me ? 'YOU FOLDED' : 'THEY FOLDED') : m.phase === 'flip' ? (m.flipCall.mine ? `FLIP! CALLED · WAITING FOR ${m.opp.nickname.toUpperCase()}` : 'FLIP! CALLED')
      : m.you.pick !== null ? 'LOCKED · WAITING FOR OPPONENT' : '';
    $('verdict').style.color = 'var(--muted)'; $('calc').textContent = '';
  }

  // hand
  const hand = $('hand'); hand.innerHTML = '';
  const canPick = m.phase === 'pick' && m.you.pick === null;
  $('lock').hidden = m.phase === 'flip';
  m.you.hand.forEach(c => {
    const used = m.you.used.includes(c.uid) || m.you.pick === c.uid;
    let hint = null;
    if (!used) {
      const up = oppLeft.filter(e => S.cfg.elements[c.el].beats === e).length;
      const down = oppLeft.filter(e => S.cfg.elements[e].beats === c.el).length;
      if (up > down) hint = { cls: 'up', txt: `▲${up}`, title: `Beats ${up} of their remaining cards` };
      else if (down > up) hint = { cls: 'down', txt: `▼${down}`, title: `Weak to ${down} of their remaining cards` };
    }
    const face = S.matchSel === c.uid ? S.matchFace : m.you.pick === c.uid ? m.you.face : 0;
    const el = cardEl(c, { hint, face });
    if (used) { el.classList.add('used'); el.disabled = true; }
    else {
      if (rar(c.rar).cost > m.you.energy) { el.classList.add('dim'); el.title = 'Not enough energy: plays at half power'; }
      if (S.matchSel === c.uid) el.classList.add('sel');
      el.onclick = () => { if (!canPick) return; if (S.matchSel !== c.uid) { S.matchSel = c.uid; S.matchFace = 0; } SFX.click(); renderMatch(); };
    }
    hand.appendChild(el);
  });
  const pc = canPick && m.you.hand.find(c => c.uid === S.matchSel);
  // choose the side that faces up
  const fp = $('facePick');
  fp.hidden = !pc;
  if (pc) {
    const opt = f => { const sd = sideOf(pc, f); return `<button type="button" class="face-opt${S.matchFace === f ? ' on' : ''}" data-face="${f}" aria-pressed="${S.matchFace === f}">
      <span class="fo-top">${f ? '↻ BACK' : 'FRONT'}</span><span class="fo-name">${esc(sd.name)}</span>
      <span class="fo-stats"><span class="el e-${sd.el}">${elName(sd.el)}</span> <b class="num">⚔ ${sd.pow}</b></span>
      <span class="fo-ab">${sd.ab ? `<b>${esc(abName(sd.ab))}</b> ${esc(abText(sd.ab))}` : 'No ability'}</span></button>`; };
    fp.innerHTML = `<p class="fp-q">Which side faces up?</p><div class="fp-row">${opt(0)}${opt(1)}</div>`;
  }
  $('lock').disabled = !pc;
  const ps = pc && sideOf(pc, S.matchFace);
  $('lockNote').textContent = m.phase === 'reveal' ? 'Next round starting…' : !canPick ? 'Waiting for your opponent…' :
    !pc ? 'Pick a card, then choose its side. ▲ = strong vs their cards, ▼ = weak.' :
    (rar(pc.rar).cost > m.you.energy ? `${ps.name} will play exhausted (half power).` : `${ps.name} · costs ${rar(pc.rar).cost} energy.`);
}
$('facePick').onclick = e => { const b = e.target.closest('[data-face]'); if (!b || !S.match) return; S.matchFace = Number(b.dataset.face); SFX.click(); renderMatch(); };
$('flipCall').onclick = async () => {
  const m = S.match; if (!m) return;
  $('flipCall').disabled = true; SFX.lock();
  try { await emit('match:flip', { matchId: m.matchId }); } catch (e) { toast(e.message); }
  finally { $('flipCall').disabled = false; }
};
const answerFlip = async accept => {
  const m = S.match; if (!m) return;
  $('faAccept').disabled = $('faFold').disabled = true; SFX.click();
  try { await emit('match:flip-answer', { matchId: m.matchId, accept }); } catch (e) { toast(e.message); }
  finally { $('faAccept').disabled = $('faFold').disabled = false; }
};
$('faAccept').onclick = () => answerFlip(true);
$('faFold').onclick = () => answerFlip(false);
$('lock').onclick = async () => {
  const m = S.match; if (!m || S.matchSel === null) return;
  $('lock').disabled = true; SFX.lock(); showBoard();
  try { await emit('match:pick', { matchId: m.matchId, uid: S.matchSel, face: S.matchFace || 0 }); }
  catch (e) { toast(e.message); $('lock').disabled = false; }
};

// ---------- result ----------
function onMatchEnd(r) {
  clearInterval(timerT); S.match = null; lockTabs(false);
  if (r.ante) refreshMe().catch(() => {}); // a card changed hands
  const oldElo = S.me.elo;
  S.me = r.profile; updateTop();
  setTimeout(() => {
    const a = tierOf(oldElo), b = tierOf(r.profile.elo);
    if (!r.practice && a.id !== b.id) {
      const up = b.min > a.min;
      $('resSub').insertAdjacentHTML('afterend', `<p class="promo ${up ? 'up' : 'down'}">${up ? 'PROMOTED TO' : 'DROPPED TO'} ${tierBadge(r.profile.elo)}</p>`);
      if (up) SFX.legend();
    }
  }, 0);
  document.querySelectorAll('#result .promo').forEach(e => e.remove());
  setTimeout(maybeSeasonModal, 2500);
  const rows = [`<dt>Your entry${r.mult > 1 ? ` (×${r.mult})` : ''}</dt><dd class="num">−${fmt(r.stake)}</dd>`];
  if (r.boss) {
    rows.length = 0;
    rows.push(`<dt>Boss</dt><dd>${esc(r.boss.name)}</dd>`, `<dt>Your damage</dt><dd class="num boss-hit">${fmt(r.boss.damage)}</dd>`,
      r.boss.hp != null ? `<dt>Boss health</dt><dd class="num">${fmt(r.boss.hp)} / ${fmt(r.boss.maxHp)}</dd>` : '',
      r.boss.killed ? `<dt class="tot">FINAL BLOW!</dt><dd class="tot">The boss has fallen. Rewards are paid.</dd>` : `<dt class="tot">FLIP and ELO</dt><dd class="tot">Unchanged</dd>`);
    r.boss.killed ? SFX.legend() : SFX.round(true);
  } else if (r.practice) {
    rows.length = 0;
    rows.push(`<dt>Mode</dt><dd>Practice vs ${esc(S.cfg.botLevels[r.level].name)} bot</dd>`, `<dt class="tot">FLIP and ELO</dt><dd class="tot">Unchanged</dd>`);
    r.out === 'win' ? SFX.win() : r.out === 'loss' ? SFX.lose() : null;
  } else if (r.ante) {
    rows.length = 0;
    rows.push(`<dt>Your ante</dt><dd>${esc(r.ante.mine.name)}</dd>`, `<dt>Their ante</dt><dd>${esc(r.ante.theirs.name)}</dd>`,
      r.out === 'win' ? `<dt class="tot">You won</dt><dd class="tot">${esc(r.ante.theirs.name)} is now yours</dd>` : r.out === 'loss' ? `<dt class="tot">You lost</dt><dd class="tot">${esc(r.ante.mine.name)} went to ${esc(r.opponent)}</dd>` : `<dt class="tot">Draw</dt><dd class="tot">Both keep their cards</dd>`);
    r.out === 'win' ? SFX.win() : r.out === 'loss' ? SFX.lose() : null;
  } else if (r.out === 'win') {
    rows.push(`<dt>Pot</dt><dd class="num">${fmt(r.pot)}</dd>`, `<dt>House fee</dt><dd class="num">−${fmt(r.rake)}</dd>`,
      `<dt class="tot">Net profit</dt><dd class="tot num">+${fmt(r.net)} FLIP</dd>`);
    SFX.win();
  } else if (r.out === 'loss') {
    rows.push(`<dt>Pot paid to ${esc(r.opponent)}</dt><dd class="num">${fmt(r.pot - r.rake)}</dd>`, `<dt class="tot">Net</dt><dd class="tot num">−${fmt(r.stake)} FLIP</dd>`);
    SFX.lose();
  } else {
    rows.push(`<dt>Refund</dt><dd class="num">+${fmt(r.stake)}</dd>`, `<dt class="tot">Net</dt><dd class="tot num">0 FLIP</dd>`);
  }
  if (r.rake) rows.push(`<dt>Fee split</dt><dd class="num">${fmt(r.split.burn)} burned · ${fmt(r.split.treasury)} treasury · ${fmt(r.split.season)} season</dd>`);
  if (r.mult > 1) rows.splice(1, 0, `<dt>FLIP! stakes</dt><dd class="num">×${r.mult}</dd>`);
  if (r.folded) rows.push(`<dt>Ended by</dt><dd>${r.folded === 'me' ? 'You folded a FLIP! call' : `${esc(r.opponent)} folded your FLIP! call`}</dd>`);
  $('resTitle').textContent = r.boss ? (r.boss.killed ? 'BOSS DOWN!' : `${fmt(r.boss.damage)} DAMAGE`) : r.out === 'win' ? 'VICTORY' : r.out === 'loss' ? 'DEFEAT' : 'DRAW';
  $('resTitle').style.color = r.out === 'win' ? 'var(--gold)' : r.out === 'loss' ? 'var(--bad)' : 'var(--fg)';
  $('resSub').textContent = r.practice ? `${r.myWins}–${r.oppWins} vs ${r.opponent}` : `${r.myWins}–${r.oppWins} vs ${r.opponent} · ELO ${r.profile.elo} (${r.eloDelta >= 0 ? '+' : ''}${r.eloDelta})`;
  $('again').textContent = r.boss ? 'Back to the boss' : r.practice ? 'Practice again' : 'Play again';
  $('ledger').innerHTML = rows.join('');
  drawSprite($('resArt'), r.out === 'win' ? 11 * 31 + 5 : 10 * 31 + 5, r.out === 'win' ? 'fire' : 'water', r.out === 'win' ? 'legendary' : 'epic');
  const rm = roomById(S.lastRoomId);
  $('again').disabled = !rm || S.me.balance < rm.stake;
  show('result');
}
$('again').onclick = () => { const rm = roomById(S.lastRoomId); SFX.click(); if (rm && rm.id === 9) return setTab('boss'); if (rm) openDeck(rm); };
$('quitPractice').onclick = async () => {
  const wasBoss = S.match && S.match.room.boss;
  try { await emit('match:quit', {}); } catch (e) { toast(e.message); return; }
  clearInterval(timerT); S.match = null; lockTabs(false); toast(wasBoss ? 'You backed away from the boss.' : 'Practice ended.'); setTab(wasBoss ? 'boss' : 'arena');
};
$('toLobby').onclick = () => { SFX.click(); setTab('arena'); };

// ---------- collection ----------
async function renderCollection() {
  try { await refreshMe(); } catch (e) {}
  const cs = sortedCards();
  $('collStats').innerHTML = `<div><b class="num">${cs.length}</b><span>Cards owned</span></div>` +
    Object.entries(S.cfg.rarities).map(([k, v]) => `<div><b class="num" style="color:${RAR_COLORS[k]}">${cs.filter(c => c.rar === k).length}</b><span>${v.name}</span></div>`).join('');
  const f = $('filters'); f.innerHTML = '';
  [['all', 'ALL'], ...Object.entries(S.cfg.elements).map(([k, v]) => [k, v.name]), ...Object.entries(S.cfg.rarities).map(([k, v]) => [k, v.name])].forEach(([k, label]) => {
    const b = document.createElement('button'); b.textContent = label; b.setAttribute('aria-pressed', S.filter === k);
    b.onclick = () => { S.filter = k; SFX.click(); renderCollection(); }; f.appendChild(b);
  });
  const g = $('collGrid'); g.innerHTML = '';
  cs.filter(c => S.filter === 'all' || c.el === S.filter || c.back.el === S.filter || c.rar === S.filter).forEach(c => g.appendChild(cardEl(c, { static: true, flip: true, isNew: S.newUids.includes(c.uid) })));
  show('collection');
}

// ---------- market ----------
const MK = { listings: [], recent: [], avgPrice: {}, view: 'buy', rar: 'all', el: 'all', sort: 'new', confirm: null, sellUid: null, busy: false };
const ago = t => { const s = Math.max(1, Math.round((Date.now() - t) / 1000)); return s < 60 ? s + 's ago' : s < 3600 ? Math.round(s / 60) + 'm ago' : s < 86400 ? Math.round(s / 3600) + 'h ago' : Math.round(s / 86400) + 'd ago'; };
async function renderMarket() {
  show('market');
  $('mkBody').innerHTML = '<p class="emptystate">Loading the market…</p>';
  try {
    const [m] = await Promise.all([api('/api/market'), refreshMe()]);
    MK.listings = m.listings; MK.recent = m.recent; MK.avgPrice = m.avgPrice;
  } catch (e) { $('mkBody').innerHTML = `<p class="emptystate">${esc(e.message)}</p>`; return; }
  drawMarket();
}
function onMarketUpdate(u) {
  const L = u.listing;
  if (!L) return;
  L.mine = !!S.me && L.seller === S.me.nickname; // broadcasts are shared, so work out ownership here
  if (u.kind === 'listed') { if (!MK.listings.some(x => x.id === L.id)) MK.listings.unshift(L); }
  else {
    MK.listings = MK.listings.filter(x => x.id !== L.id);
    if (u.kind === 'sold') { MK.recent.unshift({ ...L, soldAt: Date.now(), buyer: u.buyer }); MK.recent = MK.recent.slice(0, 15); }
    if (MK.confirm === L.id) MK.confirm = null;
  }
  if (current === 'market') { drawMarket(); flashListing(u.kind === 'listed' ? L.id : null); }
}
function flashListing(id) { if (!id) return; const el = document.querySelector(`[data-listing="${id}"]`); if (el) el.classList.add('mk-new'); }
function marketFilters(withSort) {
  const btn = (key, val, label) => `<button type="button" data-f="${key}" data-v="${val}" aria-pressed="${MK[key] === val}">${label}</button>`;
  return `<div class="filters">${btn('rar', 'all', 'ALL')}${Object.entries(S.cfg.rarities).map(([k, v]) => btn('rar', k, v.name)).join('')}</div>
    <div class="filters">${btn('el', 'all', 'ANY ELEMENT')}${Object.entries(S.cfg.elements).map(([k, v]) => btn('el', k, v.name)).join('')}</div>` +
    (withSort ? `<div class="filters">${btn('sort', 'new', 'NEWEST')}${btn('sort', 'low', 'PRICE ↑')}${btn('sort', 'high', 'PRICE ↓')}${btn('sort', 'power', 'POWER')}</div>` : '');
}
function drawMarket() {
  [...$('mkTabs').children].forEach(b => b.setAttribute('aria-selected', b.dataset.v === MK.view));
  const mine = MK.listings.filter(l => l.mine);
  $('mkCount').textContent = `${MK.listings.length} card${MK.listings.length === 1 ? '' : 's'} for sale · fee ${Math.round(S.cfg.market.fee * 100)}% paid by the seller`;
  $('mkMineCount').textContent = mine.length ? ` (${mine.length})` : '';
  const body = $('mkBody'); body.innerHTML = '';
  const pass = c => (MK.rar === 'all' || c.rar === MK.rar) && (MK.el === 'all' || c.el === MK.el);
  if (MK.view === 'buy') {
    body.insertAdjacentHTML('beforeend', marketFilters(true));
    let ls = MK.listings.filter(l => !l.mine && pass(l.card));
    ls.sort(MK.sort === 'low' ? (a, b) => a.price - b.price : MK.sort === 'high' ? (a, b) => b.price - a.price : MK.sort === 'power' ? (a, b) => b.card.pow - a.card.pow : (a, b) => b.createdAt - a.createdAt);
    const grid = document.createElement('div'); grid.className = 'cards mk-grid';
    if (!ls.length) grid.innerHTML = `<p class="emptystate">${MK.listings.filter(l => !l.mine).length ? 'No cards match these filters.' : 'Nothing for sale yet. Be the first to list a card in the Sell tab.'}</p>`;
    ls.forEach(l => grid.appendChild(listingTile(l)));
    body.appendChild(grid);
  } else if (MK.view === 'sell') {
    const sellable = sortedCards().filter(c => !c.listingId);
    const listed = S.cards.filter(c => c.listingId).length;
    const room = sellable.length - S.cfg.fusion.keepAtLeast;
    body.insertAdjacentHTML('beforeend', `<p class="note">${room > 0 ? 'Tap a card to set a price. You keep at least ' + S.cfg.fusion.keepAtLeast + ' unlisted cards so you can always build a deck.' : 'You need more than ' + S.cfg.fusion.keepAtLeast + ' unlisted cards to sell one. Open a pack in the Shop to get more.'}</p>`);
    if (MK.sellUid && sellable.some(c => c.uid === MK.sellUid)) body.appendChild(sellPanel(byUid(MK.sellUid)));
    const grid = document.createElement('div'); grid.className = 'cards mk-grid';
    sellable.forEach(c => {
      const el = cardEl(c);
      if (MK.sellUid === c.uid) el.classList.add('sel');
      if (room <= 0 || listed >= S.cfg.market.maxListings) { el.classList.add('dim'); el.disabled = true; }
      else el.onclick = () => { MK.sellUid = MK.sellUid === c.uid ? null : c.uid; SFX.click(); drawMarket(); if (MK.sellUid) $('mkBody').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }); };
      grid.appendChild(el);
    });
    body.appendChild(grid);
  } else if (MK.view === 'mine') {
    const grid = document.createElement('div'); grid.className = 'cards mk-grid';
    if (!mine.length) grid.innerHTML = '<p class="emptystate">You have no cards listed. Use the Sell tab to list one.</p>';
    mine.forEach(l => grid.appendChild(listingTile(l)));
    body.appendChild(grid);
  } else {
    if (!MK.recent.length) { body.innerHTML = '<p class="emptystate">No sales yet.</p>'; return; }
    body.insertAdjacentHTML('beforeend', `<div class="tblwrap"><table class="g-table"><thead><tr><th>Card</th><th>Seller</th><th class="r">Price</th><th class="r">When</th></tr></thead><tbody>` +
      MK.recent.map(r => `<tr><td><span style="color:${RAR_COLORS[r.card.rar]}">${esc(r.card.name)}</span></td><td>${esc(r.seller)}</td><td class="r num">${fmt(r.price)}</td><td class="r">${ago(r.soldAt)}</td></tr>`).join('') + '</tbody></table></div>');
  }
  body.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { MK[b.dataset.f] = b.dataset.v; SFX.click(); drawMarket(); });
}
function listingTile(l) {
  const wrap = document.createElement('div'); wrap.className = 'mk-tile'; wrap.dataset.listing = l.id;
  wrap.appendChild(cardEl(l.card, { static: true, noListed: true, flip: true }));
  const info = document.createElement('div'); info.className = 'mk-info';
  const avg = MK.avgPrice[l.card.tpl];
  info.innerHTML = `<b class="num">${fmt(l.price)} FLIP</b><span>${l.mine ? 'Your listing' : 'by ' + esc(l.seller)} · ${ago(l.createdAt)}</span>` +
    (avg ? `<span class="mk-avg">Avg sale ${fmt(avg.avg)}</span>` : '');
  const btn = document.createElement('button'); btn.type = 'button';
  if (l.mine) { btn.className = 'btn ghost'; btn.textContent = 'Cancel listing'; btn.onclick = () => cancelListing(l); }
  else if (MK.confirm === l.id) {
    btn.className = 'btn'; btn.textContent = `Confirm · ${fmt(l.price)}`; btn.onclick = () => buyListing(l);
    const no = document.createElement('button'); no.type = 'button'; no.className = 'linkbtn'; no.textContent = 'Not now';
    no.onclick = () => { MK.confirm = null; drawMarket(); }; info.appendChild(no);
  } else {
    btn.className = 'btn'; btn.textContent = 'Buy';
    btn.disabled = S.me.balance < l.price || MK.busy;
    if (S.me.balance < l.price) btn.title = 'Not enough FLIP';
    btn.onclick = () => { MK.confirm = l.id; SFX.click(); drawMarket(); };
  }
  info.appendChild(btn);
  wrap.appendChild(info);
  return wrap;
}
function sellPanel(c) {
  const M = S.cfg.market, avg = MK.avgPrice[c.tpl];
  const suggested = avg ? avg.avg : M.suggested[c.rar];
  const d = document.createElement('form'); d.className = 'frame mk-sell';
  d.innerHTML = `<div class="mk-sell-card"></div>
    <div class="mk-sell-form">
      <h3>LIST ${esc(c.name.toUpperCase())}</h3>
      <label class="note" for="mkPrice">Price in FLIP</label>
      <input id="mkPrice" inputmode="numeric" autocomplete="off" value="${suggested}">
      <span class="note">${avg ? `Recent average for this card: ${fmt(avg.avg)} FLIP (${avg.n} sale${avg.n > 1 ? 's' : ''})` : `Suggested for a ${rar(c.rar).name.toLowerCase()}: ${fmt(M.suggested[c.rar])} FLIP`}</span>
      <dl class="fg-out"><dt>Fee ${Math.round(M.fee * 100)}%</dt><dd id="mkFee"></dd><dt class="g-good">You get</dt><dd id="mkGet"></dd></dl>
      <div class="row" style="gap:8px"><button class="btn" type="submit" id="mkListBtn">List for sale</button><button class="btn ghost" type="button" id="mkSellCancel">Cancel</button></div>
      <p class="err" id="mkSellErr" role="alert"></p>
    </div>`;
  d.querySelector('.mk-sell-card').appendChild(cardEl(c, { static: true, flip: true }));
  const inp = d.querySelector('#mkPrice');
  const upd = () => {
    const p = Math.round(Number(String(inp.value).replace(/[^0-9]/g, '')) || 0);
    d.querySelector('#mkFee').textContent = fmt(p * M.fee) + ' FLIP';
    d.querySelector('#mkGet').textContent = fmt(p - p * M.fee) + ' FLIP';
    const bad = p < M.minPrice || p > M.maxPrice;
    d.querySelector('#mkListBtn').disabled = bad || MK.busy;
    d.querySelector('#mkSellErr').textContent = bad ? `Price must be between ${fmt(M.minPrice)} and ${fmt(M.maxPrice)} FLIP.` : '';
    return p;
  };
  inp.oninput = upd; upd();
  d.querySelector('#mkSellCancel').onclick = () => { MK.sellUid = null; drawMarket(); };
  d.onsubmit = async e => {
    e.preventDefault(); if (MK.busy) return;
    const price = upd(); MK.busy = true; d.querySelector('#mkListBtn').disabled = true;
    try {
      await api('/api/market/list', { uid: c.uid, price });
      SFX.coin(); toast(`${c.name} is listed for ${fmt(price)} FLIP.`);
      MK.sellUid = null; await refreshMe(); MK.view = 'mine';
    } catch (err) { d.querySelector('#mkSellErr').textContent = err.message; }
    MK.busy = false; drawMarket();
  };
  return d;
}
async function buyListing(l) {
  if (MK.busy) return; MK.busy = true; drawMarket();
  try {
    const r = await api('/api/market/buy', { listingId: l.id });
    S.me = r.profile; updateTop(); SFX.win();
    toast(`You bought ${l.card.name} for ${fmt(l.price)} FLIP. It's in your collection.`);
    await refreshMe();
  } catch (e) { toast(e.message); SFX.lose(); }
  MK.busy = false; MK.confirm = null; drawMarket();
}
async function cancelListing(l) {
  if (MK.busy) return; MK.busy = true;
  try { await api('/api/market/cancel', { listingId: l.id }); toast(`${l.card.name} is back in your collection.`); await refreshMe(); }
  catch (e) { toast(e.message); }
  MK.busy = false; drawMarket();
}
$('mkTabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; MK.view = b.dataset.v; MK.confirm = null; SFX.click(); drawMarket(); };

// ---------- forge (fusion) ----------
let fgSel = [], fgBusy = false;
const pct = p => (p * 100 >= 10 ? (p * 100).toFixed(0) : (p * 100).toFixed(1)) + '%';
function fusionChance(rarity, n) {
  const F = S.cfg.fusion, t = F.tiers[rarity];
  if (!t || n < F.minCards || n > F.maxCards) return 0;
  return 1 - Math.pow(1 - t.base, n - 1);
}
async function renderForge() {
  show('forge');
  try { await refreshMe(); } catch (e) {}
  fgSel = fgSel.filter(byUid);
  drawForge();
}
function drawForge() {
  const F = S.cfg.fusion;
  const picked = fgSel.map(byUid);
  const rarity = picked.length ? picked[0].rar : null;
  const tier = rarity && F.tiers[rarity];
  const n = picked.length;
  // slots
  const slots = $('fgSlots'); slots.innerHTML = '';
  for (let i = 0; i < F.maxCards; i++) {
    const c = picked[i];
    if (c) { const el = cardEl(c, { static: true }); el.classList.add('fg-in'); slots.appendChild(el); }
    else { const e = emptySlot(i < F.minCards ? 'Card ' + (i + 1) : 'Optional +' + Math.round((tier ? tier.base : .4) * 100) + '%'); e.classList.add('fg-empty'); slots.appendChild(e); }
  }
  // odds
  const p = tier ? fusionChance(rarity, n) : 0;
  $('fgChance').textContent = tier && n >= F.minCards ? pct(p) : '–';
  $('fgChance').style.color = !tier || n < F.minCards ? 'var(--muted)' : p >= .5 ? 'var(--good)' : p >= .25 ? 'var(--gold)' : 'var(--bad)';
  if (tier) {
    $('fgWin').innerHTML = `1 random <b style="color:${RAR_COLORS[tier.to]}">${rar(tier.to).name}</b> card`;
    $('fgLose').innerHTML = `1 random <b style="color:${RAR_COLORS[rarity]}">${rar(rarity).name}</b> card back`;
    $('fgFee').textContent = `${fmt(tier.fee)} FLIP (burned)`;
  } else { $('fgWin').textContent = 'Pick cards to see the outcome.'; $('fgLose').textContent = '–'; $('fgFee').textContent = '–'; }
  const keepOk = S.cards.filter(c => !c.listingId).length - n + 1 >= F.keepAtLeast;
  const enough = !tier || S.me.balance >= tier.fee;
  const ready = tier && n >= F.minCards && keepOk && enough && !fgBusy;
  $('fgGo').disabled = !ready;
  $('fgGo').textContent = tier && n >= F.minCards ? `Fuse ${n} cards · ${fmt(tier.fee)} FLIP` : 'Fuse';
  $('fgClear').hidden = n === 0;
  $('fgBar').hidden = n === 0 || current !== 'forge';
  $('fgBarChance').textContent = $('fgChance').textContent; $('fgBarChance').style.color = $('fgChance').style.color;
  $('fgBarText').textContent = tier ? `${n} ${rar(rarity).name.toLowerCase()} card${n > 1 ? 's' : ''} → ${rar(tier.to).name.toLowerCase()}` : '';
  $('fgBarGo').disabled = $('fgGo').disabled; $('fgBarGo').textContent = n >= F.minCards ? `Fuse · ${fmt(tier.fee)}` : `Add ${F.minCards - n} more`;
  $('fgNote').className = 'note' + ((!keepOk || !enough) ? ' warn' : '');
  $('fgNote').textContent = !n ? 'Tap cards below. The first card you pick sets the rarity.'
    : !keepOk ? `You need to keep at least ${F.keepAtLeast} cards for a deck. Remove a card or open a pack first.`
    : !enough ? 'Not enough FLIP for this fusion.'
    : n < F.minCards ? `Add ${F.minCards - n} more ${rar(rarity).name.toLowerCase()} card to fuse.`
    : n < F.maxCards ? `Add another ${rar(rarity).name.toLowerCase()} card to raise the chance to ${pct(fusionChance(rarity, n + 1))}.`
    : 'Maximum cards. Ready to fuse.';
  // grid
  const g = $('fgGrid'); g.innerHTML = '';
  sortedCards().forEach(c => {
    const on = fgSel.includes(c.uid);
    const fusable = !!F.tiers[c.rar];
    const fits = !rarity || c.rar === rarity;
    const el = cardEl(c);
    if (on) el.classList.add('sel');
    if (!on && (c.listingId || !fusable || !fits || n >= F.maxCards)) { el.classList.add('dim'); el.disabled = true; el.title = c.listingId ? 'Listed on the Market' : !fusable ? 'Legendary cards cannot be fused' : !fits ? 'All cards must have the same rarity' : 'Maximum 4 cards'; }
    el.setAttribute('aria-pressed', on);
    el.onclick = () => { if (fgBusy) return; fgSel = on ? fgSel.filter(x => x !== c.uid) : fgSel.concat(c.uid); SFX.click(); $('fgReveal').hidden = true; drawForge(); };
    g.appendChild(el);
  });
  // odds table
  $('fgTable').innerHTML = `<thead><tr><th>Fuse</th>${[2, 3, 4].map(k => `<th class="r">${k} cards</th>`).join('')}<th class="r">Fee</th></tr></thead><tbody>` +
    Object.entries(F.tiers).map(([r, t]) => `<tr><td><span style="color:${RAR_COLORS[r]}">${rar(r).name}</span> → <span style="color:${RAR_COLORS[t.to]}">${rar(t.to).name}</span></td>${[2, 3, 4].map(k => `<td class="r num">${pct(fusionChance(r, k))}</td>`).join('')}<td class="r num">${fmt(t.fee)}</td></tr>`).join('') + '</tbody>';
}
$('fgClear').onclick = () => { fgSel = []; SFX.click(); drawForge(); };
$('fgBarGo').onclick = () => { $('forge').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }); $('fgGo').click(); };
$('fgGo').onclick = async () => {
  if (fgBusy) return;
  fgBusy = true; drawForge(); SFX.lock();
  let res;
  try { res = await api('/api/fuse', { uids: fgSel }); }
  catch (e) { fgBusy = false; toast(e.message); drawForge(); return; }
  // fusion animation: the cards in the slots shake and burn away
  const ins = [...$('fgSlots').querySelectorAll('.fg-in')];
  ins.forEach(el => el.classList.add('fg-shake'));
  for (let i = 0; i < 6; i++) beep(300 + i * 90, .07, 'square', .04, 0, i * .09);
  await sleep(900);
  ins.forEach(el => el.classList.add('fg-burn'));
  await sleep(450);
  S.me = res.profile; updateTop();
  try { await refreshMe(); } catch (e) {}
  fgSel = []; fgBusy = false; drawForge();
  const rv = $('fgReveal'); rv.hidden = false;
  rv.classList.toggle('fg-win', res.success); rv.classList.toggle('fg-lose', !res.success);
  $('fgRevealTitle').textContent = res.success ? 'FUSION SUCCESS!' : 'FUSION FAILED';
  const card = cardEl(res.card, { static: true, isNew: true }); card.classList.add('flip');
  if (res.success) card.classList.add('flash');
  $('fgRevealCard').replaceChildren(card);
  $('fgRevealNote').textContent = res.success
    ? `Your ${res.consumed.length} ${rar(res.rarity).name.toLowerCase()} cards became ${res.card.name}. The chance was ${pct(res.chance)}.`
    : `The ${pct(res.chance)} roll missed. You got ${res.card.name} back.`;
  res.success ? (res.card.rar === 'legendary' ? SFX.legend() : SFX.win()) : SFX.lose();
  rv.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
};

// ---------- shop ----------
const PACK_EL = { basic: 'earth', premium: 'fire' };
const PACK_BLURB = { basic: 'Three cards. Mostly commons, a shot at something shiny.', premium: 'Three cards, every one rare or better.' };
function renderShop() {
  updateTop();
  const box = $('packs'); box.innerHTML = '';
  S.cfg.packs.forEach(p => {
    const d = document.createElement('div'); d.className = 'frame pack';
    const free = S.me.freePacks;
    d.innerHTML = `<canvas></canvas><div class="body"><h3>${p.name}</h3><p class="note">${PACK_BLURB[p.id] || ''}</p>
      <dl class="odds">${Object.entries(p.odds).filter(([, v]) => v > 0).map(([k, v]) => `<dt style="color:${RAR_COLORS[k]}">${rar(k).name}</dt><dd class="num">${v}%</dd>`).join('')}</dl>
      <div class="btns">${free > 0 ? `<button class="btn" type="button" data-free="1">Open free · ${free} left</button>` : ''}
      <button class="btn ${free > 0 ? 'ghost' : ''}" type="button" data-free="0">Buy · ${fmt(p.price)} FLIP</button></div></div>`;
    drawPack(d.querySelector('canvas'), PACK_EL[p.id] || 'water', p.id === 'premium');
    d.querySelectorAll('button').forEach(btn => {
      const useFree = btn.dataset.free === '1';
      if (!useFree) btn.disabled = S.me.balance < p.price;
      btn.onclick = () => openPack(p, useFree);
    });
    box.appendChild(d);
  });
  show('shop');
}
async function openPack(p, useFree) {
  $('packs').querySelectorAll('button').forEach(b => (b.disabled = true));
  let res;
  try { res = await api('/api/pack', { packId: p.id, useFree }); }
  catch (e) { toast(e.message); renderShop(); return; }
  SFX.coin();
  S.me = res.profile; S.newUids = res.pulled.map(c => c.uid); updateTop();
  const rv = $('reveal'); rv.hidden = false; $('revealTitle').textContent = `Opening ${p.name}…`; $('revealNote').textContent = '';
  const rc = $('revealCards'); rc.replaceChildren(...res.pulled.map(backEl));
  rv.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  let best = 'common';
  for (let i = 0; i < res.pulled.length; i++) {
    await sleep(700);
    const c = res.pulled[i]; const el = cardEl(c, { static: true, isNew: true }); el.classList.add('flip');
    if (c.rar === 'legendary' || c.rar === 'epic') el.classList.add('flash');
    rc.replaceChild(el, rc.children[i]);
    if (rar(c.rar).rank > rar(best).rank) best = c.rar;
    c.rar === 'legendary' ? SFX.legend() : SFX.flip();
  }
  $('revealTitle').textContent = best === 'legendary' ? 'LEGENDARY PULL!' : best === 'epic' ? 'Epic pull!' : 'Pack opened';
  $('revealNote').textContent = useFree ? 'Free pack used. The cards are in your collection.' : 'The cards are in your collection. Half the price was burned as a token sink.';
  try { await refreshMe(); } catch (e) {}
  const keep = rv.hidden; renderShop(); rv.hidden = keep;
}

// ---------- ranks ----------
let seasonClockT = null;
function startSeasonClock(endsAt, skew) {
  clearInterval(seasonClockT);
  const draw = () => {
    if (current !== 'ranks') return clearInterval(seasonClockT);
    const ms = Math.max(0, endsAt - (Date.now() + skew));
    const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4), s = Math.floor(ms % 6e4 / 1e3);
    $('seasonClock').textContent = ms ? `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s` : 'Ending…';
  };
  draw(); seasonClockT = setInterval(draw, 1000);
}
async function renderRanks() {
  show('ranks');
  $('rankWrap').innerHTML = '<p class="emptystate">Loading leaderboard…</p>';
  let data;
  try { data = await api('/api/leaderboard'); } catch (e) { $('rankWrap').innerHTML = `<p class="emptystate">${esc(e.message)}</p>`; return; }
  const SN = S.cfg.season, me = data.me;
  $('seasonTitle').textContent = `Season ${data.season.number}`;
  startSeasonClock(data.season.endsAt, data.season.serverNow - Date.now());
  $('minMatches').textContent = SN.minMatches;
  // your standing
  const need = Math.max(0, SN.minMatches - (me.played || 0));
  const nt = nextTier(me.elo);
  $('myRank').innerHTML = `<div class="mr-place"><span class="num">${me.rank ? '#' + me.rank : '–'}</span><small>${me.rank ? 'OF ' + fmt(data.ranked) : 'NOT RANKED YET'}</small></div>
    <div class="mr-info"><b>${clanFlag(S.me.clan)}${esc(me.nickname)} ${trophies(S.badges)}</b>
      <span>${tierBadge(me.elo)} <span class="num">${me.elo} ELO</span>${nt ? ` · <span class="muted">${nt.min - me.elo} to ${nt.name}</span>` : ''}</span>
      <span class="muted num">This season: ${me.wins || 0}W ${me.losses || 0}L ${me.draws || 0}D</span></div>
    <div class="mr-reward">${need ? `<b>PLAY ${need} MORE</b><small>RANKED MATCH${need > 1 ? 'ES' : ''} TO QUALIFY</small>`
      : me.reward ? `<b class="num">+${fmt(me.reward)}</b><small>FLIP IF THE SEASON ENDED NOW</small>` : `<b>TOP 100 PAY</b><small>CLIMB TO EARN FLIP</small>`}</div>`;
  // rewards
  const R = S.cfg.rewards;
  $('rewardGrid').innerHTML = [1, 2, 3, 4, 5, 10, 20, 50, 100].map(p => `<div class="${p <= 3 ? 'rw-top' : ''}" ${p <= 3 ? `style="--c:${PLACE_COL[p - 1]}"` : ''}><span>${p <= 3 ? TROPHY : ''}#${p}</span><b class="num">${fmt(R[p - 1])}</b></div>`).join('');
  $('tierRow').innerHTML = S.cfg.tiers.map(t => `<span class="tier-badge" style="color:${t.color}">${SHIELD}<em>${t.name.toUpperCase()}</em><small class="num">${t.min ? t.min + '+' : '<' + S.cfg.tiers[1].min}</small></span>`).join('');
  // last season podium
  const pod = data.lastSeason && data.lastSeason.podium;
  $('podium').hidden = !(pod && pod.length);
  if (pod && pod.length) $('podium').innerHTML = `<h3 class="muted">SEASON ${data.lastSeason.number} CHAMPIONS</h3><div class="pod-row">` +
    pod.map(p => `<div class="pod" style="--c:${PLACE_COL[p.place - 1]}">${TROPHY}<b>${esc(p.nickname)}</b><span class="num">#${p.place} · ${p.elo} ELO</span><span class="num">+${fmt(p.reward)} FLIP</span></div>`).join('') + '</div>';
  $('rankStats').innerHTML = `<span><b class="num">${fmt(data.ranked)}</b> ranked</span><span><b class="num">${fmt(data.online)}</b> online</span>`;
  if (!data.players.length) { $('rankWrap').innerHTML = '<p class="emptystate">Nobody has played a ranked match this season yet. Be the first!</p>'; return; }
  $('rankWrap').innerHTML = `<table class="lb"><thead><tr><th>#</th><th>Player</th><th class="r">ELO</th><th class="r">W-L-D</th><th class="r">Reward</th></tr></thead><tbody>` +
    data.players.map(p => `<tr class="${p.id === S.me.id ? 'me' : ''}${p.place && p.place <= 3 ? ' top' + p.place : ''}"><td class="num">${p.rank}</td>
      <td>${tierBadge(p.elo, true)} ${clanFlag(p.clan)}${esc(p.nickname)}${p.id === S.me.id ? ' (you)' : ''} ${trophies(p.badges)}</td><td class="r num">${p.elo}</td>
      <td class="r num">${p.wins}-${p.losses}-${p.draws}</td><td class="r num">${p.qualified ? (p.reward ? fmt(p.reward) : '–') : `<span class="muted" title="Needs ${SN.minMatches - p.played} more ranked match(es)">${p.played}/${SN.minMatches}</span>`}</td></tr>`).join('') +
    '</tbody></table>';
}

// ---------- clans ----------
const CL = { list: [], open: null, editor: null, confirm: null, q: '' };
const clanApi = (path, body) => api('/api/clan/' + path, body);
async function renderClans() {
  show('clans');
  const cost = S.cfg.clan.createCost;
  $('clanFound').textContent = `Found a clan · ${fmt(cost)} FLIP`;
  $('clanFound').hidden = !!S.me.clan;
  $('clanList').innerHTML = '<p class="emptystate">Loading clans…</p>';
  try {
    await refreshMe();
    const r = await api('/api/clans' + (CL.q ? '?q=' + encodeURIComponent(CL.q) : ''));
    CL.list = r.clans;
    if (S.me.clan && !CL.open) CL.open = S.me.clan.id;
    drawClanList();
    if (CL.open) await openClan(CL.open); else $('clanView').innerHTML = '';
  } catch (e) { $('clanList').innerHTML = `<p class="emptystate">${esc(e.message)}</p>`; }
  $('clanFound').hidden = !!S.me.clan;
}
function drawClanList() {
  const mine = S.me.clan && S.me.clan.id;
  if (!CL.list.length) { $('clanList').innerHTML = `<p class="emptystate">${CL.q ? 'No clan matches that search.' : 'No clans yet. Found the first one!'}</p>`; return; }
  $('clanList').innerHTML = CL.list.map(c => {
    let act = '';
    if (c.id === mine) act = '<span class="ctag">YOUR CLAN</span>';
    else if (!mine) act = c.members >= S.cfg.clan.maxMembers ? '<span class="ctag">FULL</span>'
      : c.requested ? `<button class="btn ghost" type="button" data-cancel="${c.id}">Requested · cancel</button>`
      : `<button class="btn" type="button" data-join="${c.id}">${c.joinMode === 'open' ? 'Join' : 'Ask to join'}</button>`;
    return `<div class="clan-row${c.id === mine ? ' mine' : ''}" tabindex="0" role="button" data-open="${c.id}" aria-label="${esc(c.name)} clan">
      <span class="rk num">#${c.rank}</span><img class="bn" src="${bannerURL(c.banner)}" alt="">
      <span class="nm"><b><span class="ctag">${esc(c.tag)}</span>${esc(c.name)}</b><span class="num">${c.members}/${S.cfg.clan.maxMembers} members · ${c.points} pts this season · ${c.joinMode === 'open' ? 'open' : 'by approval'}</span></span>
      <span class="act">${act}</span></div>`;
  }).join('');
}
$('clanList').onclick = async e => {
  const j = e.target.closest('[data-join]'), c = e.target.closest('[data-cancel]'), o = e.target.closest('[data-open]');
  try {
    if (j) { SFX.click(); const r = await clanApi('join', { clanId: Number(j.dataset.join) }); toast(r.joined ? 'Welcome to the clan!' : 'Request sent. The leader will decide.'); if (r.joined) { SFX.coin(); CL.open = Number(j.dataset.join); } return renderClans(); }
    if (c) { SFX.click(); await clanApi('cancel-request', { clanId: Number(c.dataset.cancel) }); return renderClans(); }
    if (o) { SFX.click(); CL.open = Number(o.dataset.open); await openClan(CL.open); $('clanView').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); }
  } catch (err) { toast(err.message); }
};
$('clanList').onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-open]')) { e.preventDefault(); e.target.click(); } };
let clanSearchT = null;
$('clanSearch').oninput = () => { clearTimeout(clanSearchT); clanSearchT = setTimeout(() => { CL.q = $('clanSearch').value.trim(); renderClans(); }, 300); };

async function openClan(id) {
  let d;
  try { d = await api('/api/clan/' + id); } catch (e) { CL.open = null; $('clanView').innerHTML = ''; return; }
  const cl = d.clan, max = cl.max, rank = (CL.list.find(x => x.id === cl.id) || {}).rank;
  const confirmBtn = (key, label, sure, cls = '') => `<button class="btn ${cls}" type="button" data-act="${key}">${CL.confirm === key ? sure : label}</button>`;
  const actions = [];
  if (d.isLeader) actions.push('<button class="btn ghost" type="button" data-act="edit">Edit banner & settings</button>', confirmBtn('disband', 'Disband clan', 'Click again to disband', 'ghost'));
  else if (d.isMember) actions.push(confirmBtn('leave', 'Leave clan', 'Click again to leave', 'ghost'));
  else if (!S.me.clan) actions.push(d.requested ? `<button class="btn ghost" type="button" data-act="cancel">Requested · cancel</button>`
    : cl.members >= max ? '<span class="ctag">THIS CLAN IS FULL</span>' : `<button class="btn" type="button" data-act="join">${cl.joinMode === 'open' ? 'Join clan' : 'Ask to join'}</button>`);
  if (!d.isMember) actions.push('<button class="btn ghost" type="button" data-act="close">Close</button>');
  const memberRow = m => `<tr><td>${tierBadge(m.elo, true)} ${esc(m.nickname)}${m.leader ? '<span class="lead">♛ LEADER</span>' : ''}${m.id === S.me.id ? ' (you)' : ''}</td>
    <td class="r num">${m.elo}</td><td class="r num">${m.seasonWins}</td>
    <td class="r">${d.isLeader && !m.leader ? `<button type="button" data-lead="${m.id}">${CL.confirm === 'lead' + m.id ? 'SURE?' : 'MAKE LEADER'}</button><button type="button" class="danger" data-kick="${m.id}">${CL.confirm === 'kick' + m.id ? 'SURE?' : 'KICK'}</button>` : ''}</td></tr>`;
  $('clanView').innerHTML = `<div class="frame clan-panel">
      <img class="big" src="${bannerURL(cl.banner)}" alt="${esc(cl.name)} banner">
      <div><h3><span class="ctag">${esc(cl.tag)}</span>${esc(cl.name)}<em>${cl.joinMode === 'open' ? 'OPEN' : 'BY APPROVAL'}</em></h3>
        <div class="clan-stats"><span><b class="num">${cl.members}/${max}</b> members</span><span><b class="num">${cl.points}</b> season points</span>${rank ? `<span>rank <b class="num">#${rank}</b></span>` : ''}</div>
        <div class="clan-actions">${actions.join('')}</div></div>
      ${d.requests.length ? `<div class="clan-members"><h3>JOIN REQUESTS</h3><table><tbody>${d.requests.map(r => `<tr><td>${tierBadge(r.elo, true)} ${esc(r.nickname)}</td><td class="r num">${r.elo}</td>
        <td class="r"><button type="button" data-approve="${r.id}">APPROVE</button><button type="button" class="danger" data-reject="${r.id}">REJECT</button></td></tr>`).join('')}</tbody></table></div>` : ''}
      <div class="clan-members"><h3>MEMBERS</h3><table><thead><tr><th>Player</th><th class="r">ELO</th><th class="r">Season wins</th><th></th></tr></thead>
        <tbody>${d.members.map(memberRow).join('')}</tbody></table></div>
    </div>`;
  CL.detail = d;
}
$('clanView').onclick = async e => {
  const b = e.target.closest('button'); if (!b) return;
  const d = CL.detail; if (!d) return;
  const id = d.clan.id, act = b.dataset.act;
  const twoStep = key => { if (CL.confirm === key) { CL.confirm = null; return true; } CL.confirm = key; openClan(id); setTimeout(() => { if (CL.confirm === key) { CL.confirm = null; openClan(id); } }, 4000); return false; };
  SFX.click();
  try {
    if (act === 'edit') return openClanEditor(d.clan);
    if (act === 'close') { CL.open = null; $('clanView').innerHTML = ''; return; }
    if (act === 'join') { const r = await clanApi('join', { clanId: id }); toast(r.joined ? 'Welcome to the clan!' : 'Request sent. The leader will decide.'); return renderClans(); }
    if (act === 'cancel') { await clanApi('cancel-request', { clanId: id }); return renderClans(); }
    if (act === 'leave') { if (!twoStep('leave')) return; await clanApi('leave', {}); toast('You left the clan.'); CL.open = null; return renderClans(); }
    if (act === 'disband') { if (!twoStep('disband')) return; await clanApi('disband', {}); toast('The clan was disbanded.'); CL.open = null; return renderClans(); }
    if (b.dataset.kick) { if (!twoStep('kick' + b.dataset.kick)) return; await clanApi('kick', { userId: Number(b.dataset.kick) }); return renderClans(); }
    if (b.dataset.lead) { if (!twoStep('lead' + b.dataset.lead)) return; await clanApi('transfer', { userId: Number(b.dataset.lead) }); toast('Leadership handed over.'); return renderClans(); }
    if (b.dataset.approve) { await clanApi('approve', { userId: Number(b.dataset.approve) }); return renderClans(); }
    if (b.dataset.reject) { await clanApi('reject', { userId: Number(b.dataset.reject) }); return openClan(id); }
  } catch (err) { toast(err.message); }
};

// banner editor: used to found a clan and (for the leader) to edit it
function openClanEditor(existing) {
  const pick = (n, not) => { let v; do { v = Math.floor(Math.random() * n); } while (v === not); return v; };
  const bg = pick(S.cfg.clan.colors.length - 1);
  CL.editor = existing ? { edit: true, name: existing.name, tag: existing.tag, banner: { ...existing.banner }, joinMode: existing.joinMode }
    : { edit: false, name: '', tag: '', banner: { bg, fg: pick(S.cfg.clan.colors.length, bg), sym: pick(S.cfg.clan.symbols.length), pat: 0 }, joinMode: 'open' };
  drawClanEditor();
  $('clanEditor').hidden = false; $('clanEditor').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}
function drawClanEditor() {
  const E = CL.editor, b = E.banner, cols = S.cfg.clan.colors;
  const sw = (key, i) => { const off = (key === 'fg' && i === b.bg) || (key === 'bg' && i === b.fg);
    return `<button type="button" class="sw" style="background:${cols[i]}${off ? ';opacity:.25' : ''}" data-${key}="${i}" aria-pressed="${b[key] === i}" aria-label="Colour ${i + 1}"${off ? ' disabled' : ''}></button>`; };
  $('clanEditor').innerHTML = `
    ${E.edit ? '' : `<div class="fld"><label class="note" for="ceName">Clan name (3–20)</label><input type="text" id="ceName" maxlength="20" value="${esc(E.name)}" placeholder="Pixel Kings"></div>
    <div class="fld"><label class="note" for="ceTag">Tag (2–4 letters or numbers)</label><input type="text" id="ceTag" maxlength="4" value="${esc(E.tag)}" placeholder="PK" style="text-transform:uppercase;width:120px"></div>`}
    <div class="fld"><span class="note">Banner colour</span><div class="swatches">${cols.map((_, i) => sw('bg', i)).join('')}</div></div>
    <div class="fld"><span class="note">Symbol colour</span><div class="swatches">${cols.map((_, i) => sw('fg', i)).join('')}</div></div>
    <div class="fld"><span class="note">Symbol</span><div class="syms">${S.cfg.clan.symbols.map((n, i) => `<button type="button" class="sym" data-sym="${i}" aria-pressed="${b.sym === i}" title="${n}"><img src="${bannerURL({ ...b, sym: i })}" alt="${n}"></button>`).join('')}</div></div>
    <div class="fld"><span class="note">Pattern</span><div class="pats">${S.cfg.clan.patterns.map((n, i) => `<button type="button" class="pat" data-pat="${i}" aria-pressed="${b.pat === i}" title="${n}"><img src="${bannerURL({ ...b, pat: i })}" alt="${n}"></button>`).join('')}</div></div>
    <div class="fld"><span class="note">Who can join</span><div class="modes"><button type="button" data-mode="open" aria-pressed="${E.joinMode === 'open'}">OPEN · ANYONE</button><button type="button" data-mode="approval" aria-pressed="${E.joinMode === 'approval'}">BY APPROVAL</button></div></div>
    <div class="preview"><img src="${bannerURL(b)}" alt="Banner preview"><b><span class="ctag">${esc(E.tag.toUpperCase() || 'TAG')}</span>${esc(E.name || 'Your clan')}</b><span class="note">${clanFlag({ tag: E.tag.toUpperCase() || 'TAG', name: E.name, banner: b })}${esc(S.me.nickname)}</span></div>
    <div class="foot"><button class="btn" type="button" id="ceSave">${E.edit ? 'Save changes' : `Found clan · ${fmt(S.cfg.clan.createCost)} FLIP`}</button><button class="btn ghost" type="button" id="ceCancel">Cancel</button><p class="err" id="ceErr" role="alert"></p></div>`;
}
$('clanEditor').oninput = e => {
  if (e.target.id === 'ceName') CL.editor.name = e.target.value;
  if (e.target.id === 'ceTag') CL.editor.tag = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const pv = $('clanEditor').querySelector('.preview b'); if (pv) pv.innerHTML = `<span class="ctag">${esc(CL.editor.tag || 'TAG')}</span>${esc(CL.editor.name || 'Your clan')}`;
};
$('clanEditor').onclick = async e => {
  const t = e.target.closest('button'); if (!t || t.disabled) return;
  const E = CL.editor; SFX.click();
  for (const k of ['bg', 'fg', 'sym', 'pat']) if (t.dataset[k] !== undefined) { E.banner[k] = Number(t.dataset[k]); return drawClanEditor(); }
  if (t.dataset.mode) { E.joinMode = t.dataset.mode; return drawClanEditor(); }
  if (t.id === 'ceCancel') { $('clanEditor').hidden = true; CL.editor = null; return; }
  if (t.id === 'ceSave') {
    t.disabled = true; $('ceErr').textContent = '';
    try {
      if (E.edit) { await clanApi('update', { banner: E.banner, joinMode: E.joinMode }); toast('Clan updated.'); }
      else { const r = await clanApi('create', { name: E.name, tag: E.tag, banner: E.banner, joinMode: E.joinMode }); CL.open = r.clanId; SFX.legend(); toast(`[${E.tag}] ${E.name} is founded!`); }
      $('clanEditor').hidden = true; CL.editor = null; renderClans();
    } catch (err) { $('ceErr').textContent = err.message; t.disabled = false; }
  }
};
$('clanFound').onclick = () => { SFX.click(); if (S.me.balance < S.cfg.clan.createCost) return toast(`Founding a clan costs ${fmt(S.cfg.clan.createCost)} FLIP.`); openClanEditor(null); };

// ---------- world boss ----------
const BS = { data: null, clock: null };
async function renderBoss() {
  show('boss');
  try { BS.data = await api('/api/boss'); BS.skew = BS.data.serverNow - Date.now(); } catch (e) { $('bossName').textContent = e.message; return; }
  const d = BS.data, r = d.rules;
  Island.setBoss(d.boss);
  drawBossHero();
  $('bossTop').innerHTML = d.top.length ? d.top.map(t => `<li>${clanFlag(t.clan)}${esc(t.nickname)}${t.id === S.me.id ? ' (you)' : ''} <b class="num">${fmt(t.damage)}</b></li>`).join('') : '<li>No hits yet. Be the first!</li>';
  $('bossMine').textContent = d.me.fights ? `You: ${fmt(d.me.damage)} damage in ${d.me.fights} fight${d.me.fights > 1 ? 's' : ''} · best hit ${fmt(d.me.best)}` : 'You haven\'t hit this boss yet.';
  $('bossRules').innerHTML = [
    `Everyone gets <b>${r.fightsPerDay} free fights a day</b> (UTC). No entry fee, no ELO change.`,
    `Damage = <b>${r.damage.perPower} × the total power</b> of your cards + <b>${fmt(r.damage.perRound)}</b> per round won + <b>${fmt(r.damage.win)}</b> for winning the match.`,
    `If the boss falls this week, everyone who hit it gets <b>${fmt(r.rewards.all)} FLIP</b>.`,
    `The top 3 damage dealers get <b>${r.rewards.top.map(fmt).join(' / ')} FLIP</b> more and a permanent ☠ badge.`,
    'The boss plays its own five cards with extra energy. A new boss arrives with every season.',
  ].map(x => `<li>${x}</li>`).join('');
  $('bossDeck').replaceChildren(...d.deck.map(c => cardEl(c, { static: true, flip: true })));
  clearInterval(BS.clock); BS.clock = setInterval(() => { if (current === 'boss') drawBossHero(true); else clearInterval(BS.clock); }, 1000);
}
function drawBossHero(clockOnly) {
  const d = BS.data; if (!d) return;
  const b = d.boss, left = Math.max(0, b.endsAt - (Date.now() + (BS.skew || 0)));
  const h = Math.floor(left / 3600000), mi = Math.floor(left / 60000) % 60;
  $('bossNote').textContent = b.killedAt ? 'Defeated! A new boss comes with the next season.' : `${d.hitters} player${d.hitters === 1 ? '' : 's'} fighting · escapes in ${Math.floor(h / 24)}d ${h % 24}h ${mi}m`;
  if (clockOnly) return;
  const cv = $('bossArt'), x = cv.getContext('2d'), img = Island.bossSprite(b.el);
  cv.width = img.width; cv.height = img.height; x.imageSmoothingEnabled = false; x.clearRect(0, 0, cv.width, cv.height); x.drawImage(img, 0, 0);
  $('bossTag').textContent = `WORLD BOSS · WEEK ${b.season} · ${elName(b.el)}`;
  $('bossName').textContent = b.name;
  const f = b.maxHp ? b.hp / b.maxHp : 0;
  $('bossHp').style.width = `calc(${(f * 100).toFixed(2)}% - 4px)`; $('bossHp').className = f > .5 ? '' : f > .2 ? 'mid' : 'low';
  $('bossHpTxt').textContent = `${fmt(b.hp)} / ${fmt(b.maxHp)}`;
  $('bossMeter').setAttribute('aria-valuenow', b.hp); $('bossMeter').setAttribute('aria-valuemax', b.maxHp);
  const left2 = d.me.attemptsLeft;
  $('bossFight').disabled = !!b.killedAt || left2 <= 0;
  $('bossFight').textContent = b.killedAt ? 'Defeated' : left2 > 0 ? 'Fight the boss' : 'No fights left today';
  $('bossLeft').textContent = b.killedAt ? '' : `${left2} of ${d.rules.fightsPerDay} fights left today`;
}
$('bossFight').onclick = () => { SFX.click(); openDeck(S.cfg.bossRoom); };

// ---------- history ----------
async function renderHistory() {
  show('history');
  const w = $('histWrap'); w.innerHTML = '<p class="emptystate">Loading…</p>';
  let data;
  try { data = await api('/api/history'); } catch (e) { w.innerHTML = `<p class="emptystate">${esc(e.message)}</p>`; return; }
  if (!data.matches.length) { w.innerHTML = '<p class="emptystate">No matches yet. Pick a room in the Arena tab to play your first duel.</p>'; return; }
  w.innerHTML = `<table><thead><tr><th>Result</th><th>Room</th><th>Opponent</th><th class="r">Score</th><th class="r">ELO</th><th class="r">Net FLIP</th></tr></thead><tbody>` +
    data.matches.map(h => `<tr><td><span class="badge ${h.out[0]}">${h.out.toUpperCase()}</span></td><td>${esc(h.room || '')}</td><td>${esc(h.opponent)}</td><td class="r num">${h.score}</td>
      <td class="r num">${h.eloDelta >= 0 ? '+' : ''}${h.eloDelta}</td><td class="r num" style="color:${h.net > 0 ? 'var(--good)' : h.net < 0 ? 'var(--bad)' : 'var(--muted)'}">${h.net > 0 ? '+' : ''}${fmt(h.net)}</td></tr>`).join('') +
    `</tbody></table><p class="note" style="padding:12px">Record ${S.me.wins}W – ${S.me.losses}L – ${S.me.draws}D</p>`;
}

// ---------- atmosphere (music, world scenes, battle effects live in fx.js) ----------
FX.init();

drawSprite($('logoArt'), 11 * 31 + 5, 'fire', 'legendary');
boot().catch(e => renderLogin(e.message));
})();
