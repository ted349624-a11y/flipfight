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
function drawSprite(cv, seed, el, rarity) {
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
    ctx.fillStyle = v === 2 ? '#0b0916' : (y >= 8 ? shade : (y <= 4 && r() < .35 ? hi : main));
    ctx.fillRect(x, y, 1, 1);
  }
  cv.dataset.ey = ey; cv.dataset.main = main;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(4, ey, 1, 1); ctx.fillRect(7, ey, 1, 1);
  ctx.fillStyle = '#0b0916'; ctx.fillRect(4, ey + 1, 1, 1); ctx.fillRect(7, ey + 1, 1, 1);
  if (rarity === 'legendary') { ctx.fillStyle = '#ffcc33'; [[4, 0], [6, 0], [5, 1], [4, 1], [6, 1], [7, 0]].forEach(([x, y]) => ctx.fillRect(x, y, 1, 1)); }
  if (rarity === 'epic') { ctx.fillStyle = '#e0b8ff'; ctx.fillRect(1, 1, 1, 1); ctx.fillRect(10, 2, 1, 1); }
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

function cardEl(c, opts = {}) {
  const b = document.createElement(opts.static ? 'div' : 'button');
  b.className = 'card' + (opts.static ? ' static' : '');
  b.style.setProperty('--rc', RAR_COLORS[c.rar]);
  if (!opts.static) b.type = 'button';
  b.innerHTML = `<div class="ct"><span class="cost" title="Energy cost: ${rar(c.rar).cost} of your 15 energy"><svg class="bolt" viewBox="0 0 5 8" aria-hidden="true"><path d="M2 0h1v1h-1zM3 0h1v1h-1zM4 0h1v1h-1zM2 1h1v1h-1zM3 1h1v1h-1zM1 2h1v1h-1zM2 2h1v1h-1zM0 3h1v1h-1zM1 3h1v1h-1zM2 3h1v1h-1zM3 3h1v1h-1zM4 3h1v1h-1zM2 4h1v1h-1zM3 4h1v1h-1zM1 5h1v1h-1zM2 5h1v1h-1zM1 6h1v1h-1zM0 7h1v1h-1z" fill="currentColor"/></svg>${rar(c.rar).cost}</span><span class="el e-${c.el}">${elName(c.el)}</span></div>
    <canvas class="art"></canvas><div class="cname">${esc(c.name)}</div>
    <div class="cf"><span class="pow num">${c.pow}</span><span class="tid">${esc(c.tid)}</span></div><span class="rar">${rar(c.rar).name}</span>`;
  drawSprite(b.querySelector('canvas'), spriteSeed(c), c.el, c.rar);
  if (opts.hint) { const h = document.createElement('span'); h.className = 'hint ' + opts.hint.cls; h.textContent = opts.hint.txt; h.title = opts.hint.title; b.appendChild(h); }
  if (opts.isNew) { const n = document.createElement('span'); n.className = 'newtag'; n.textContent = 'NEW'; b.appendChild(n); }
  if (c.listingId && !opts.noListed) { const n = document.createElement('span'); n.className = 'listedtag'; n.textContent = 'LISTED'; b.appendChild(n); }
  if (opts.price != null) { const pr = document.createElement('div'); pr.className = 'pricetag num'; pr.textContent = fmt(opts.price) + ' FLIP'; b.appendChild(pr); }
  b.setAttribute('aria-label', `${c.name}, ${elName(c.el)}, power ${c.pow}, energy ${rar(c.rar).cost}`);
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
  return (founder ? '<span class="founder-tag" title="Flipfight founder">★ FOUNDER</span>' : '') + list.filter(b => b.place).slice(0, 3).map(b => `<span class="trophy" style="color:${PLACE_COL[b.place - 1]}" title="#${b.place} in Season ${b.season}">${TROPHY}<em>S${b.season}</em></span>`).join('');
}

function backEl() { const d = document.createElement('div'); d.className = 'back bigback'; return d; }
function emptySlot(t) { const d = document.createElement('div'); d.className = 'empty'; d.textContent = t; return d; }

// ---------- screens ----------
const SCREENS = ['login', 'nickname', 'island', 'arena', 'deck', 'queue', 'match', 'result', 'collection', 'forge', 'market', 'shop', 'ranks', 'history'];
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
  const want = ['arena', 'deck', 'queue'].includes(current) ? 'lobby' : current === 'market' ? 'market' : '';
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
  const focus = { arena: 'arena', deck: 'arena', queue: 'arena', match: 'arena', result: 'arena', collection: 'collection', forge: 'forge', market: 'market', shop: 'shop', ranks: 'ranks', history: 'history' }[id] || 'plaza';
  const mood = ['deck', 'queue', 'match', 'result'].includes(id) && roomId != null ? ({ 2: 'volcano', 3: 'temple' }[roomId] || 'calm') : 'calm';
  if (id === 'island') Island.backdropOff(); else Island.backdrop(focus, mood);
  FX.ambient(id === 'forge' ? 'forge' : id === 'market' ? 'market' : null);
}
// The guide opens by itself for players who haven't finished a match yet.
let guideAutoOpened = false;
function renderGuide() {
  if (!S.cfg || $('guideCard').firstChild) return;
  $('guideCard').appendChild(cardEl({ uid: 0, tpl: 10, name: 'Abyss Kraken', el: 'water', rar: 'epic', pow: 68, tid: '#0421' }, { static: true }));
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
  ({ island: renderIsland, arena: renderArena, collection: renderCollection, forge: renderForge, market: renderMarket, shop: renderShop, ranks: renderRanks, history: renderHistory })[tab]();
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
  $('hudNick').textContent = (p.founder ? '★ ' : '') + (p.nickname || ''); $('hudBal').textContent = fmt(p.balance);
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
const BUILDING_TAB = { arena: 'arena', ranks: 'ranks', shop: 'shop', market: 'market', forge: 'forge', collection: 'collection', history: 'history' };
let hintTimer = 0;
function renderIsland() {
  show('island');
  Island.mount($('islandView'), {
    socket: S.socket, me: S.me,
    onEnter: id => { SFX.found(); setTab(BUILDING_TAB[id]); },
    onCount: (n, ch, cap) => { $('islandOnline').textContent = `● ISLAND #${ch || 1} · ${n}${cap ? '/' + cap : ''}`; },
  });
  $('islandQuick').innerHTML = Island.BUILDINGS.map(b => `<button type="button" data-b="${b.id}">${b.label}</button>`).join('') +
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
const roomById = id => (id === 0 ? S.cfg.practice : S.cfg.rooms.find(x => x.id === id));
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
  S.sel = []; // the player always chooses their own 5 cards
  $('deckTitle').textContent = rm.name;
  $('deckSub').textContent = rm.id === 0 ? `Free practice vs ${S.cfg.botLevels[S.botLevel].name} bot · pick 5 cards` : `Entry ${fmt(rm.stake)} FLIP · pick 5 cards`;
  renderDeck(); show('deck');
}
function renderDeck() {
  const rm = S.room, cs = S.sel.map(byUid);
  const pow = cs.reduce((a, c) => a + c.pow, 0), en = cs.reduce((a, c) => a + rar(c.rar).cost, 0);
  const box = $('pickGrid'); box.innerHTML = '';
  sortedCards().forEach(c => {
    const el = cardEl(c); const on = S.sel.includes(c.uid);
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
  const enough = S.me.balance >= rm.stake, ready = S.sel.length === 5 && !over && enough;
  $('enter').disabled = !ready;
  $('enter').textContent = rm.id === 0 ? `Start practice · ${S.cfg.botLevels[S.botLevel].name} bot` : `Find opponent · lock ${fmt(rm.stake)} FLIP`;
  $('enterNote').textContent = !enough ? 'Not enough FLIP.' : over ? 'Deck power is over the room cap. Swap a strong card for a weaker one.' : S.sel.length < 5 ? `Choose ${5 - S.sel.length} more card${5 - S.sel.length > 1 ? 's' : ''} to start.` : '';
  $('enterNote').className = 'note' + ((over || !enough) ? ' warn' : '');
}
$('backLobby').onclick = () => { SFX.click(); setTab('arena'); };
$('clearDeck').onclick = () => { S.sel = []; SFX.click(); renderDeck(); };
$('enter').onclick = async () => {
  const btn = $('enter'); btn.disabled = true;
  try {
    await api('/api/deck', { roomId: S.room.id, uids: S.sel });
    S.decks[S.room.id] = S.sel.slice();
    S.lastRoomId = S.room.id;
    SFX.lock();
    if (S.room.id === 0) { await emit('practice:start', { level: S.botLevel }); return; }
    const res = await emit('queue:join', { roomId: S.room.id });
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
  $('queueNote').textContent = `${S.room.name} · ${fmt(S.room.stake)} FLIP locked in escrow · ${S.lobby.online || 1} online · waiting ${secs}s`;
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
    S.matchSel = null; S.seenLog = st.log.length;
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
  li.textContent = `Round ${r.round}: ${r.mine.name} ${r.myPower} vs ${r.theirs.name} ${r.theirPower} → ${r.result === 'win' ? 'you win' : r.result === 'loss' ? 'you lose' : 'tie'}${r.myAuto ? ' (auto-played)' : ''}`;
  $('log').appendChild(li);
}
function drawTimer() {
  const m = S.match; if (!m) return;
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
  $('oppSide').innerHTML = `<b>${esc(m.opp.nickname)} ${trophies(m.opp.badges)}</b><span class="meta num">${m.room.practice ? '' : tierBadge(m.opp.elo, true) + ' '}ELO ${m.opp.elo} · ⚡ ${m.opp.energy}</span>
    <div class="left" title="Elements of their remaining cards">${oppLeft.map(el => `<i class="e-${el}"></i>`).join('')}</div>
    <span class="locked-note">${m.phase === 'pick' && m.opp.locked ? 'LOCKED IN' : ''}</span>`;
  $('mySide').innerHTML = `<b>${trophies(m.you.badges)} ${esc(m.you.nickname)}</b><span class="meta num">${tierBadge(m.you.elo, true)} ELO ${m.you.elo} · ⚡ ${m.you.energy}</span>`;
  $('score').textContent = `${m.opp.wins} : ${m.you.wins}`;
  $('rnd').textContent = `ROUND ${m.round}/5`;
  $('pot').textContent = m.room.practice ? 'PRACTICE · NO STAKES' : `Pot ${fmt(m.room.stake * 2)} FLIP`;
  $('quitPractice').hidden = !m.room.practice;

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
    const note = (c, ex, vs) => [S.cfg.elements[c.el].beats === vs ? 'element +30%' : '', ex ? 'exhausted ×0.5' : ''].filter(Boolean).join(', ');
    const nt = note(last.theirs, last.theirExhausted, last.mine.el), nm = note(last.mine, last.myExhausted, last.theirs.el);
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
    $('verdict').textContent = m.you.pick !== null ? 'LOCKED · WAITING FOR OPPONENT' : '';
    $('verdict').style.color = 'var(--muted)'; $('calc').textContent = '';
  }

  // hand
  const hand = $('hand'); hand.innerHTML = '';
  const canPick = m.phase === 'pick' && m.you.pick === null;
  m.you.hand.forEach(c => {
    const used = m.you.used.includes(c.uid) || m.you.pick === c.uid;
    let hint = null;
    if (!used) {
      const up = oppLeft.filter(e => S.cfg.elements[c.el].beats === e).length;
      const down = oppLeft.filter(e => S.cfg.elements[e].beats === c.el).length;
      if (up > down) hint = { cls: 'up', txt: `▲${up}`, title: `Beats ${up} of their remaining cards` };
      else if (down > up) hint = { cls: 'down', txt: `▼${down}`, title: `Weak to ${down} of their remaining cards` };
    }
    const el = cardEl(c, { hint });
    if (used) { el.classList.add('used'); el.disabled = true; }
    else {
      if (rar(c.rar).cost > m.you.energy) { el.classList.add('dim'); el.title = 'Not enough energy: plays at half power'; }
      if (S.matchSel === c.uid) el.classList.add('sel');
      el.onclick = () => { if (!canPick) return; S.matchSel = c.uid; SFX.click(); renderMatch(); };
    }
    hand.appendChild(el);
  });
  const pc = canPick && m.you.hand.find(c => c.uid === S.matchSel);
  $('lock').disabled = !pc;
  $('lockNote').textContent = m.phase === 'reveal' ? 'Next round starting…' : !canPick ? 'Waiting for your opponent…' :
    !pc ? 'Pick a card. ▲ = strong vs their cards, ▼ = weak.' :
    (rar(pc.rar).cost > m.you.energy ? `${pc.name} will play exhausted (half power).` : `${pc.name} · costs ${rar(pc.rar).cost} energy.`);
}
$('lock').onclick = async () => {
  const m = S.match; if (!m || S.matchSel === null) return;
  $('lock').disabled = true; SFX.lock(); showBoard();
  try { await emit('match:pick', { matchId: m.matchId, uid: S.matchSel }); }
  catch (e) { toast(e.message); $('lock').disabled = false; }
};

// ---------- result ----------
function onMatchEnd(r) {
  clearInterval(timerT); S.match = null; lockTabs(false);
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
  const rows = [`<dt>Your entry</dt><dd class="num">−${fmt(r.stake)}</dd>`];
  if (r.practice) {
    rows.length = 0;
    rows.push(`<dt>Mode</dt><dd>Practice vs ${esc(S.cfg.botLevels[r.level].name)} bot</dd>`, `<dt class="tot">FLIP and ELO</dt><dd class="tot">Unchanged</dd>`);
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
  $('resTitle').textContent = r.out === 'win' ? 'VICTORY' : r.out === 'loss' ? 'DEFEAT' : 'DRAW';
  $('resTitle').style.color = r.out === 'win' ? 'var(--gold)' : r.out === 'loss' ? 'var(--bad)' : 'var(--fg)';
  $('resSub').textContent = r.practice ? `${r.myWins}–${r.oppWins} vs ${r.opponent}` : `${r.myWins}–${r.oppWins} vs ${r.opponent} · ELO ${r.profile.elo} (${r.eloDelta >= 0 ? '+' : ''}${r.eloDelta})`;
  $('again').textContent = r.practice ? 'Practice again' : 'Play again';
  $('ledger').innerHTML = rows.join('');
  drawSprite($('resArt'), r.out === 'win' ? 11 * 31 + 5 : 10 * 31 + 5, r.out === 'win' ? 'fire' : 'water', r.out === 'win' ? 'legendary' : 'epic');
  const rm = roomById(S.lastRoomId);
  $('again').disabled = !rm || S.me.balance < rm.stake;
  show('result');
}
$('again').onclick = () => { const rm = roomById(S.lastRoomId); SFX.click(); if (rm) openDeck(rm); };
$('quitPractice').onclick = async () => {
  try { await emit('match:quit', {}); } catch (e) { toast(e.message); return; }
  clearInterval(timerT); S.match = null; lockTabs(false); toast('Practice ended.'); setTab('arena');
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
  cs.filter(c => S.filter === 'all' || c.el === S.filter || c.rar === S.filter).forEach(c => g.appendChild(cardEl(c, { static: true, isNew: S.newUids.includes(c.uid) })));
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
  wrap.appendChild(cardEl(l.card, { static: true, noListed: true }));
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
  d.querySelector('.mk-sell-card').appendChild(cardEl(c, { static: true }));
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
    <div class="mr-info"><b>${esc(me.nickname)} ${trophies(S.badges)}</b>
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
      <td>${tierBadge(p.elo, true)} ${esc(p.nickname)}${p.id === S.me.id ? ' (you)' : ''} ${trophies(p.badges)}</td><td class="r num">${p.elo}</td>
      <td class="r num">${p.wins}-${p.losses}-${p.draws}</td><td class="r num">${p.qualified ? (p.reward ? fmt(p.reward) : '–') : `<span class="muted" title="Needs ${SN.minMatches - p.played} more ranked match(es)">${p.played}/${SN.minMatches}</span>`}</td></tr>`).join('') +
    '</tbody></table>';
}

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
