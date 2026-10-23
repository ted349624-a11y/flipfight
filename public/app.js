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

// ---------- api ----------
const API = (window.FLIPFIGHT_API || '').replace(/\/$/, '');
async function api(path, body) {
  let res;
  try {
    res = await fetch(API + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, S.token ? { Authorization: 'Bearer ' + S.token } : {}),
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
let AC = null;
function beep(f, d = .08, type = 'square', v = .05, slide = 0, delay = 0) {
  if (!S.sfx) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const t = AC.currentTime + delay, o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.linearRampToValueAtTime(Math.max(40, f + slide), t + d);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(g).connect(AC.destination); o.start(t); o.stop(t + d + .02);
  } catch (e) {}
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
  b.innerHTML = `<div class="ct"><span class="cost" title="Energy cost">${rar(c.rar).cost}</span><span class="el e-${c.el}">${elName(c.el)}</span></div>
    <canvas class="art"></canvas><div class="cname">${esc(c.name)}</div>
    <div class="cf"><span class="pow num">${c.pow}</span><span class="tid">${esc(c.tid)}</span></div><span class="rar">${rar(c.rar).name}</span>`;
  drawSprite(b.querySelector('canvas'), spriteSeed(c), c.el, c.rar);
  if (opts.hint) { const h = document.createElement('span'); h.className = 'hint ' + opts.hint.cls; h.textContent = opts.hint.txt; h.title = opts.hint.title; b.appendChild(h); }
  if (opts.isNew) { const n = document.createElement('span'); n.className = 'newtag'; n.textContent = 'NEW'; b.appendChild(n); }
  b.setAttribute('aria-label', `${c.name}, ${elName(c.el)}, power ${c.pow}, energy ${rar(c.rar).cost}`);
  return b;
}
function backEl() { const d = document.createElement('div'); d.className = 'back bigback'; return d; }
function emptySlot(t) { const d = document.createElement('div'); d.className = 'empty'; d.textContent = t; return d; }

// ---------- screens ----------
const SCREENS = ['login', 'nickname', 'arena', 'deck', 'queue', 'match', 'result', 'collection', 'shop', 'ranks', 'history'];
let current = null;
function show(id) {
  if (current !== id) window.scrollTo({ top: 0 });
  current = id; SCREENS.forEach(s => ($(s).hidden = s !== id));
  $('guide').hidden = !(id === 'login' || id === 'arena');
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
  ({ arena: renderArena, collection: renderCollection, shop: renderShop, ranks: renderRanks, history: renderHistory })[tab]();
}
$('tabs').onclick = e => { const b = e.target.closest('button'); if (b && !b.disabled) { SFX.click(); setTab(b.dataset.tab); } };
function lockTabs(on) { [...$('tabs').children].forEach(b => { b.disabled = on; b.style.opacity = on ? .45 : 1; }); }

function updateTop() {
  const p = S.me; if (!p) return;
  $('bal').textContent = fmt(p.balance); $('elo').textContent = p.elo;
  $('nick').textContent = p.nickname || ''; $('addr').textContent = shortAddr(p.address);
  $('sfx').setAttribute('aria-pressed', S.sfx); $('sfx').textContent = S.sfx ? 'SFX ON' : 'SFX OFF';
}
$('sfx').onclick = () => { S.sfx = !S.sfx; try { localStorage.setItem('ff-sfx', S.sfx ? '1' : '0'); } catch (e) {} updateTop(); SFX.click(); };

// ---------- wallet sign-in ----------
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
function renderLogin(msg) {
  $('walletBar').hidden = true; $('tabs').hidden = true;
  drawSprite($('loginArt'), 11 * 31 + 5, 'fire', 'legendary');
  const err = $('loginErr'); err.textContent = msg || '';
  const btn = $('connect');
  if (!window.ethereum) {
    btn.textContent = isMobile ? 'Open in MetaMask app' : 'Install MetaMask';
    btn.onclick = () => {
      const url = isMobile ? 'https://metamask.app.link/dapp/' + location.host + location.pathname : 'https://metamask.io/download/';
      window.open(url, '_blank', 'noopener');
    };
  } else {
    btn.textContent = 'Connect MetaMask';
    btn.onclick = connectWallet;
  }
  show('login');
}
async function connectWallet() {
  const btn = $('connect'), err = $('loginErr');
  btn.disabled = true; err.textContent = '';
  try {
    btn.textContent = 'Check MetaMask…';
    const [address] = await window.ethereum.request({ method: 'eth_requestAccounts' });
    if (!address) throw new Error('No account selected in MetaMask.');
    const { message } = await api('/api/nonce?address=' + encodeURIComponent(address));
    btn.textContent = 'Sign the message…';
    const signature = await window.ethereum.request({ method: 'personal_sign', params: [message, address] });
    const res = await api('/api/login', { address, signature });
    saveToken(res.token);
    SFX.coin();
    await boot();
  } catch (e) {
    err.textContent = e && e.code === 4001 ? 'You cancelled the request in MetaMask.' : (e.message || 'Could not connect to MetaMask.');
    btn.textContent = 'Connect MetaMask';
  } finally { btn.disabled = false; }
}
if (window.ethereum && window.ethereum.on) window.ethereum.on('accountsChanged', () => { if (S.token) signOut(false, 'Wallet changed. Sign in with the new account.'); });

function signOut(expired, msg) {
  if (S.token && !expired) api('/api/logout', {}).catch(() => {});
  saveToken(null);
  if (S.socket) { S.socket.disconnect(); S.socket = null; }
  S.me = null; S.match = null; lockTabs(false);
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
  S.me = me.profile; S.cards = me.cards; S.decks = me.decks;
  if (!S.me.nickname) return renderNickname();
  enterApp();
}
async function refreshMe() {
  const me = await api('/api/me');
  S.me = me.profile; S.cards = me.cards; S.decks = me.decks; updateTop();
}
function enterApp() {
  $('walletBar').hidden = false; $('tabs').hidden = false; updateTop();
  connectSocket();
  setTab('arena');
}

// ---------- realtime ----------
function connectSocket() {
  if (S.socket) return;
  const s = API ? io(API, { auth: { token: S.token } }) : io({ auth: { token: S.token } });
  S.socket = s;
  s.on('connect_error', err => {
    if (err.message === 'unauthorized') signOut(true);
    else if (err.message === 'nickname_required') renderNickname();
  });
  s.on('lobby', l => { S.lobby = l; if (current === 'arena') renderRooms(); if (current === 'queue') renderQueueNote(); });
  s.on('match:state', onMatchState);
  s.on('match:end', onMatchEnd);
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
  // practice falls back to the Rookie deck so new players can start with one tap
  S.sel = (S.decks[rm.id] || (rm.id === 0 ? S.decks[1] : null) || []).filter(byUid).slice(0, 5);
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
  $('deckHint').textContent = en > 15 ? `Energy cost is ${en - 15} over 15, so at least one card will play exhausted (half power).` : 'Energy fits: every card can play at full power.';
  const enough = S.me.balance >= rm.stake, ready = S.sel.length === 5 && !over && enough;
  $('enter').disabled = !ready;
  $('enter').textContent = rm.id === 0 ? `Start practice · ${S.cfg.botLevels[S.botLevel].name} bot` : `Find opponent · lock ${fmt(rm.stake)} FLIP`;
  $('enterNote').textContent = !enough ? 'Not enough FLIP.' : over ? 'Deck power is over the room cap.' : S.sel.length < 5 ? `Pick ${5 - S.sel.length} more.` : '';
  $('enterNote').className = 'note' + ((over || !enough) ? ' warn' : '');
}
$('backLobby').onclick = () => { SFX.click(); setTab('arena'); };
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
let lastRevealRound = 0;
function renderMatch() {
  const m = S.match;
  const oppLeft = m.opp.leftElements;
  $('oppSide').innerHTML = `<b>${esc(m.opp.nickname)}</b><span class="meta num">ELO ${m.opp.elo} · ⚡ ${m.opp.energy}</span>
    <div class="left" title="Elements of their remaining cards">${oppLeft.map(el => `<i class="e-${el}"></i>`).join('')}</div>
    <span class="locked-note">${m.phase === 'pick' && m.opp.locked ? 'LOCKED IN' : ''}</span>`;
  $('mySide').innerHTML = `<b>${esc(m.you.nickname)}</b><span class="meta num">ELO ${m.you.elo} · ⚡ ${m.you.energy}</span>`;
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
    if (fresh) { lastRevealRound = last.round; SFX.flip(); setTimeout(() => last.result !== 'tie' && SFX.round(last.result === 'win'), 180); }
  } else {
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
  $('lock').disabled = true; SFX.lock();
  try { await emit('match:pick', { matchId: m.matchId, uid: S.matchSel }); }
  catch (e) { toast(e.message); $('lock').disabled = false; }
};

// ---------- result ----------
function onMatchEnd(r) {
  clearInterval(timerT); S.match = null; lockTabs(false);
  S.me = r.profile; updateTop();
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
async function renderRanks() {
  show('ranks');
  $('rankWrap').innerHTML = '<p class="emptystate">Loading leaderboard…</p>';
  let data;
  try { data = await api('/api/leaderboard'); } catch (e) { $('rankWrap').innerHTML = `<p class="emptystate">${esc(e.message)}</p>`; return; }
  $('rankStats').innerHTML = `<span><b class="num">${fmt(data.totalPlayers)}</b> players</span><span><b class="num">${fmt(data.online)}</b> online</span><span><b class="num">${fmt(data.burned)}</b> FLIP burned</span>`;
  if (!data.players.length) { $('rankWrap').innerHTML = '<p class="emptystate">No players yet.</p>'; return; }
  $('rankWrap').innerHTML = `<table><thead><tr><th>#</th><th>Player</th><th class="r">ELO</th><th class="r">W</th><th class="r">L</th><th class="r">D</th></tr></thead><tbody>` +
    data.players.map(p => `<tr class="${p.id === S.me.id ? 'me' : ''}"><td class="num">${p.rank}</td><td>${esc(p.nickname)}${p.id === S.me.id ? ' (you)' : ''}</td><td class="r num">${p.elo}</td><td class="r num">${p.wins}</td><td class="r num">${p.losses}</td><td class="r num">${p.draws}</td></tr>`).join('') +
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

// ---------- background ----------
(function () {
  const cv = $('bg'), ctx = cv.getContext('2d'), P = 4;
  const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  const BANDS = ['#0c0a1a', '#120e26', '#1a1233', '#251640', '#34194a', '#4a1f50'];
  let stars = [], W = 0, H = 0, base = null;
  function draw() {
    W = Math.ceil(innerWidth / P); H = Math.ceil(innerHeight / P); cv.width = W; cv.height = H;
    const img = ctx.createImageData(W, H), d = img.data;
    const cols = BANDS.map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));
    for (let y = 0; y < H; y++) {
      const t = (y / H) * (cols.length - 1), i = Math.floor(t), f = t - i;
      for (let x = 0; x < W; x++) {
        const c = f * 16 > BAYER[y % 4][x % 4] ? cols[Math.min(i + 1, cols.length - 1)] : cols[i];
        const k = (y * W + x) * 4; d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; d[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const r = rng(77);
    const mx = Math.floor(W * .82), my = Math.floor(H * .16), mr = Math.max(5, Math.floor(Math.min(W, H) * .05));
    for (let y = -mr; y <= mr; y++) for (let x = -mr; x <= mr; x++) if (x * x + y * y <= mr * mr) { ctx.fillStyle = (x + mr * .4) ** 2 + (y - mr * .3) ** 2 < (mr * .35) ** 2 ? '#d9cfa6' : '#f3ecd6'; ctx.fillRect(mx + x, my + y, 1, 1); }
    stars = [];
    for (let i = 0; i < W * H / 140; i++) stars.push([Math.floor(r() * W), Math.floor(r() * H * .6), r() < .15]);
    stars.forEach(([x, y, big]) => { ctx.fillStyle = big ? '#ffffff' : '#8f86c2'; ctx.fillRect(x, y, 1, 1); });
    const ridge = (col, baseY, amp, freq, seed) => {
      const ph = rng(seed)() * 10; ctx.fillStyle = col;
      for (let x = 0; x < W; x++) { const h = Math.sin(x * freq + ph) * amp + Math.sin(x * freq * 2.7 + ph * 2) * amp * .45 + Math.sin(x * freq * 7.1) * amp * .12; const top = Math.floor(baseY - h); ctx.fillRect(x, top, 1, H - top); }
    };
    ridge('#1f1538', H * .78, H * .09, .035, 3); ridge('#150f28', H * .88, H * .07, .06, 9);
    ctx.fillStyle = '#0c0a1a'; ctx.fillRect(0, Math.floor(H * .95), W, H);
    base = ctx.getImageData(0, 0, W, H);
  }
  draw();
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(draw, 150); });
  if (!reduced) setInterval(() => { if (!base) return; ctx.putImageData(base, 0, 0); for (let i = 0; i < 6; i++) { const s = stars[Math.floor(Math.random() * stars.length)]; if (s) { ctx.fillStyle = '#ffcc33'; ctx.fillRect(s[0], s[1], 1, 1); } } }, 700);
})();

drawSprite($('logoArt'), 11 * 31 + 5, 'fire', 'legendary');
boot().catch(e => renderLogin(e.message));
})();
