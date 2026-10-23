// Flipfight Island: the shared hub. Walk your pixel character around, see other players live,
// and walk into a building to open that part of the game.
(function () {
'use strict';
const T = 16, MW = 48, MH = 34;             // tile size and map size in tiles
const WW = MW * T, WH = MH * T;
const SPEED = 78;                           // world px per second
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- map ----------
// tile kinds
const DEEP = 0, SHALLOW = 1, SAND = 2, GRASS = 3, PATH = 4, FLOWER = 5, PLAZA = 6;
const BUILDINGS = [
  { id: 'arena', label: 'ARENA', x: 19, y: 4, w: 10, h: 6, sign: '#ffcc33' },
  { id: 'ranks', label: 'RANKS', x: 33, y: 6, w: 5, h: 6, sign: '#ffcc33' },
  { id: 'shop', label: 'SHOP', x: 8, y: 11, w: 6, h: 4, sign: '#ff6b35' },
  { id: 'market', label: 'MARKET', x: 34, y: 16, w: 7, h: 4, sign: '#8fe3ff' },
  { id: 'forge', label: 'FORGE', x: 9, y: 21, w: 6, h: 4, sign: '#ff6b35' },
  { id: 'collection', label: 'CARDS', x: 27, y: 24, w: 6, h: 4, sign: '#b26bff' },
  { id: 'history', label: 'HISTORY', x: 16, y: 16, w: 2, h: 2, sign: '#9d96c6', board: true },
];
BUILDINGS.forEach(b => { b.door = { x: (b.x + Math.floor(b.w / 2)) * T + T / 2, y: (b.y + b.h) * T + 6 }; });
const PLAZA_C = { x: 24, y: 17 };
const SPAWN = { x: PLAZA_C.x * T + 8, y: (PLAZA_C.y + 3) * T };

function hash(x, y) { let h = x * 374761393 + y * 668265263; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function smooth(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const map = [], solid = [];
const trees = [];
(function buildMap() {
  const cx = MW / 2, cy = MH / 2 + .5;
  for (let y = 0; y < MH; y++) {
    map.push([]); solid.push([]);
    for (let x = 0; x < MW; x++) {
      const d = Math.hypot((x + .5 - cx) / (MW * .44), (y + .5 - cy) / (MH * .43)) + (smooth(x / 4, y / 4) - .5) * .16;
      const k = d < .86 ? GRASS : d < .95 ? SAND : d < 1.04 ? SHALLOW : DEEP;
      map[y].push(k); solid[y].push(k === DEEP || k === SHALLOW);
    }
  }
  // plaza
  for (let y = PLAZA_C.y - 2; y <= PLAZA_C.y + 3; y++) for (let x = PLAZA_C.x - 3; x <= PLAZA_C.x + 3; x++) map[y][x] = PLAZA;
  // paths from the plaza to every door (L-shaped)
  const path = (x0, y0, x1, y1) => {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) if (map[y0][x] !== PLAZA) map[y0][x] = PATH;
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) if (map[y][x1] !== PLAZA) map[y][x1] = PATH;
  };
  BUILDINGS.forEach(b => path(PLAZA_C.x, PLAZA_C.y, Math.floor(b.door.x / T), Math.floor(b.door.y / T)));
  path(PLAZA_C.x, PLAZA_C.y, PLAZA_C.x, MH - 4); // to the pier
  // buildings are solid
  BUILDINGS.forEach(b => { for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) solid[y][x] = true; });
  // fountain
  for (let y = PLAZA_C.y - 1; y <= PLAZA_C.y; y++) for (let x = PLAZA_C.x - 1; x <= PLAZA_C.x; x++) solid[y][x] = true;
  // trees and flowers on free grass
  for (let y = 1; y < MH - 1; y++) for (let x = 1; x < MW - 1; x++) {
    if (map[y][x] !== GRASS || solid[y][x]) continue;
    const near = BUILDINGS.some(b => x >= b.x - 1 && x <= b.x + b.w && y >= b.y - 1 && y <= b.y + b.h + 1);
    const nearPath = [[0, 1], [1, 0], [0, -1], [-1, 0]].some(([dx, dy]) => map[y + dy][x + dx] === PATH || map[y + dy][x + dx] === PLAZA);
    const h = hash(x * 3, y * 7);
    if (!near && !nearPath && h < .085) { trees.push({ x, y }); solid[y][x] = true; }
    else if (h > .93) map[y][x] = FLOWER;
  }
})();
const walkable = (px, py) => {
  const tx = Math.floor(px / T), ty = Math.floor(py / T);
  return tx >= 0 && ty >= 0 && tx < MW && ty < MH && !solid[ty][tx];
};

// ---------- static layer (drawn once) ----------
const PAL = {
  deep: ['#0d1638', '#101c45'], shallow: ['#1b3a72', '#21468a'], sand: ['#8a7a5a', '#9a8a66', '#7a6a4c'],
  grass: ['#1f4a33', '#23553a', '#1a3f2c'], path: ['#5a4e66', '#655874', '#4e4359'], plaza: ['#4a4560', '#544e6c'],
  flower: ['#ff7ab0', '#ffd166', '#8fe3ff'],
};
let staticLayer = null;
function px(c, col, x, y, w = 1, h = 1) { c.fillStyle = col; c.fillRect(x, y, w, h); }
function drawTile(c, k, x, y) {
  const X = x * T, Y = y * T, h = hash(x, y);
  const fill = cols => { px(c, cols[0], X, Y, T, T); for (let i = 0; i < 6; i++) px(c, cols[1 + (i % (cols.length - 1))], X + Math.floor(hash(x + i, y * 3) * T), Y + Math.floor(hash(x * 5, y + i) * T), 1 + (i % 2), 1); };
  if (k === DEEP) { px(c, PAL.deep[0], X, Y, T, T); if (h < .3) px(c, PAL.deep[1], X + 3, Y + 7, 6, 1); }
  else if (k === SHALLOW) { px(c, PAL.shallow[0], X, Y, T, T); if (h < .5) px(c, PAL.shallow[1], X + 2, Y + 5, 8, 1); }
  else if (k === SAND) fill(PAL.sand);
  else if (k === GRASS || k === FLOWER) { fill(PAL.grass); if (k === FLOWER) for (let i = 0; i < 3; i++) { const fx = X + 2 + Math.floor(hash(x + i, y) * 11), fy = Y + 2 + Math.floor(hash(x, y + i) * 11); px(c, PAL.flower[i], fx, fy); px(c, '#2f6a44', fx, fy + 1); } }
  else if (k === PATH) { fill(PAL.path); }
  else if (k === PLAZA) { px(c, PAL.plaza[(x + y) % 2], X, Y, T, T); px(c, '#3c3852', X, Y + T - 1, T, 1); px(c, '#3c3852', X + T - 1, Y, 1, T); }
}
function drawTree(c, t) {
  const X = t.x * T, Y = t.y * T;
  px(c, 'rgba(0,0,0,.28)', X + 2, Y + 12, 12, 3);
  px(c, '#4a3020', X + 7, Y + 6, 3, 8);
  const g = ['#16402a', '#1f5537', '#2a6a44'];
  px(c, g[0], X + 1, Y - 6, 14, 12); px(c, g[1], X + 2, Y - 8, 12, 12); px(c, g[2], X + 4, Y - 8, 6, 4); px(c, g[0], X + 3, Y - 10, 10, 3);
}
function drawBuilding(c, b) {
  const X = b.x * T, Y = b.y * T, W = b.w * T, H = b.h * T, dx = b.door.x;
  px(c, 'rgba(0,0,0,.3)', X + 4, Y + H - 2, W, 6);
  if (b.id === 'arena') {
    // colosseum: stone ring with arches and flags
    px(c, '#6b6480', X, Y + 10, W, H - 10); px(c, '#7d7694', X, Y + 10, W, 4); px(c, '#575069', X, Y + H - 6, W, 6);
    for (let i = 0; i < 8; i++) { const ax = X + 6 + i * 19; px(c, '#2a2540', ax, Y + 22, 9, 14); px(c, '#2a2540', ax + 1, Y + 20, 7, 2); px(c, '#ffb347', ax + 3, Y + 30, 3, 6); }
    for (let i = 0; i < 9; i++) { const ax = X + 4 + i * 17; px(c, '#2a2540', ax, Y + 48, 7, 8); }
    [X + 4, X + W - 8].forEach((fx, i) => { px(c, '#cfc6b0', fx, Y - 6, 2, 18); px(c, i ? '#4f8dff' : '#ff6b35', fx + 2, Y - 6, 8, 5); });
    px(c, '#1a1630', dx - 10, Y + H - 22, 20, 22); px(c, '#ffb347', dx - 8, Y + H - 20, 16, 2);
  } else if (b.id === 'ranks') {
    px(c, '#5b5470', X + 8, Y + 10, W - 16, H - 10); px(c, '#6d6684', X + 8, Y + 10, 4, H - 10);
    px(c, '#ffcc33', X + 6, Y + 6, W - 12, 6); px(c, '#ffcc33', X + W / 2 - 3, Y - 8, 6, 14); px(c, '#fff3b0', X + W / 2 - 1, Y - 6, 2, 4);
    for (let i = 0; i < 3; i++) px(c, '#ffe28a', X + W / 2 - 3, Y + 22 + i * 14, 6, 8);
    px(c, '#1a1630', dx - 7, Y + H - 16, 14, 16);
  } else if (b.id === 'shop') {
    px(c, '#6a4a3a', X + 4, Y + 18, W - 8, H - 18); px(c, '#3a2a22', X + 4, Y + H - 4, W - 8, 4);
    for (let i = 0; i < W / 8; i++) px(c, i % 2 ? '#f3ecd6' : '#ff5d6c', X + i * 8, Y + 8, 8, 12);
    px(c, '#c9a96a', X + 8, Y + 26, W - 16, 4); [0, 1, 2].forEach(i => px(c, ['#ffcc33', '#5fd38d', '#4f8dff'][i], X + 14 + i * 22, Y + 22, 6, 4));
    px(c, '#1a1630', dx - 7, Y + H - 16, 14, 16);
  } else if (b.id === 'market') {
    ['#8fe3ff', '#b26bff', '#ffcc33'].forEach((col, i) => {
      const tx = X + 4 + i * 36;
      for (let r = 0; r < 14; r++) px(c, r % 4 < 2 ? col : '#f3ecd6', tx + 14 - r, Y + 10 + r, r * 2 + 4, 1);
      px(c, '#3a2a22', tx + 2, Y + 24, 28, H - 24);
      px(c, '#ffd166', tx + 8, Y + 34, 4, 4); px(c, '#ff6bd6', tx + 18, Y + 36, 4, 3);
    });
    px(c, '#1a1630', dx - 6, Y + H - 14, 12, 14);
  } else if (b.id === 'forge') {
    px(c, '#3b3646', X + 2, Y + 12, W - 4, H - 12); px(c, '#4a4458', X + 2, Y + 12, W - 4, 4);
    px(c, '#2a2532', X + W - 20, Y - 12, 12, 26); // chimney
    px(c, '#ff6b35', X + 12, Y + 32, 18, 12); px(c, '#ffd166', X + 16, Y + 36, 10, 6); // furnace glow
    px(c, '#9d96c6', X + 46, Y + 40, 26, 6); px(c, '#9d96c6', X + 52, Y + 46, 12, 8); // anvil
    px(c, '#1a1630', dx - 7, Y + H - 16, 14, 16);
  } else if (b.id === 'collection') {
    for (let r = 0; r < 16; r++) px(c, '#6a3a5a', X + 16 - r, Y + r, W - 32 + r * 2, 1); // roof
    px(c, '#8a7aa6', X + 4, Y + 16, W - 8, H - 16); px(c, '#7a6a96', X + 4, Y + 16, W - 8, 3);
    [X + 12, X + W - 26].forEach(wx => { px(c, '#ffe28a', wx, Y + 26, 14, 12); px(c, '#6a5a86', wx + 6, Y + 26, 2, 12); });
    px(c, '#b26bff', X + W / 2 - 8, Y + 4, 16, 10); px(c, '#f3ecd6', X + W / 2 - 6, Y + 6, 12, 6); // book sign
    px(c, '#1a1630', dx - 7, Y + H - 18, 14, 18);
  } else if (b.board) {
    px(c, '#4a3020', X + 4, Y + 16, 3, 16); px(c, '#4a3020', X + W - 7, Y + 16, 3, 16);
    px(c, '#6a4a3a', X, Y + 2, W, 18); px(c, '#f3ecd6', X + 4, Y + 5, 9, 6); px(c, '#ffd166', X + 16, Y + 6, 10, 8); px(c, '#8fe3ff', X + 6, Y + 13, 12, 4);
  }
}
function drawFountain(c) {
  const X = (PLAZA_C.x - 1) * T, Y = (PLAZA_C.y - 1) * T;
  px(c, 'rgba(0,0,0,.3)', X, Y + 26, 32, 6);
  px(c, '#7d7694', X, Y + 8, 32, 22); px(c, '#2f6ab0', X + 3, Y + 11, 26, 15); px(c, '#9d96c6', X + 13, Y + 2, 6, 22);
}
function buildStatic() {
  staticLayer = document.createElement('canvas'); staticLayer.width = WW; staticLayer.height = WH;
  const c = staticLayer.getContext('2d');
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) drawTile(c, map[y][x], x, y);
  // pier at the bottom of the path
  px(c, '#6a4a3a', PLAZA_C.x * T + 2, (MH - 4) * T, 12, 3 * T); for (let i = 0; i < 6; i++) px(c, '#4a3020', PLAZA_C.x * T + 2, (MH - 4) * T + i * 8, 12, 1);
  drawFountain(c);
  // y-sorted so trees and buildings overlap correctly
  [...trees.map(t => ({ y: t.y * T + T, d: () => drawTree(c, t) })), ...BUILDINGS.map(b => ({ y: (b.y + b.h) * T, d: () => drawBuilding(c, b) }))]
    .sort((a, b) => a.y - b.y).forEach(o => o.d());
}

// ---------- characters ----------
// Look comes from the wallet address so every player is recognisable and stays the same.
const SKIN = ['#f1c9a5', '#e0a882', '#c68660', '#9a6240', '#6e4428'];
const HAIR = ['#2a1d14', '#5a3a22', '#c9a96a', '#d84f3a', '#f3ecd6', '#4f8dff', '#b26bff', '#5fd38d'];
const SHIRT = ['#ff6b35', '#4f8dff', '#5fd38d', '#b26bff', '#ffcc33', '#ff5d6c', '#8fe3ff', '#d39552'];
const PANTS = ['#2a2540', '#3a2a22', '#23408f', '#1f4a33', '#4a3a5a'];
function lookOf(addr) {
  const s = String(addr || '0x0').toLowerCase().replace(/^0x/, '');
  const n = i => parseInt(s.slice(i * 2, i * 2 + 2) || '0', 16) || 0;
  return { skin: SKIN[n(1) % SKIN.length], hair: HAIR[n(2) % HAIR.length], shirt: SHIRT[n(3) % SHIRT.length], pants: PANTS[n(4) % PANTS.length], hat: n(5) % 4 === 0 };
}
// dir: 0 down, 1 left, 2 right, 3 up; frame 0 stand, 1/2 walk
function drawChar(c, x, y, L, dir, frame) {
  const X = Math.round(x) - 6, Y = Math.round(y) - 18;
  px(c, 'rgba(0,0,0,.35)', X + 1, Y + 16, 10, 3);
  const step = frame === 1 ? 1 : frame === 2 ? -1 : 0;
  // legs
  px(c, L.pants, X + 3, Y + 12, 2, 4 + (step > 0 ? -1 : 0)); px(c, L.pants, X + 7, Y + 12, 2, 4 + (step < 0 ? -1 : 0));
  px(c, '#1a1630', X + 3, Y + 15 + (step > 0 ? -1 : 0), 2, 1); px(c, '#1a1630', X + 7, Y + 15 + (step < 0 ? -1 : 0), 2, 1);
  // body and arms
  px(c, L.shirt, X + 2, Y + 7, 8, 6);
  px(c, L.skin, X + 1, Y + 8 + (step > 0 ? 1 : 0), 1, 4); px(c, L.skin, X + 10, Y + 8 + (step < 0 ? 1 : 0), 1, 4);
  // head
  px(c, L.skin, X + 3, Y + 2, 6, 5);
  px(c, L.hair, X + 3, Y + 1, 6, 2);
  if (dir === 3) px(c, L.hair, X + 3, Y + 2, 6, 4);
  else if (dir === 1) { px(c, L.hair, X + 6, Y + 2, 3, 3); px(c, '#0b0916', X + 4, Y + 4, 1, 1); }
  else if (dir === 2) { px(c, L.hair, X + 3, Y + 2, 3, 3); px(c, '#0b0916', X + 7, Y + 4, 1, 1); }
  else { px(c, L.hair, X + 3, Y + 2, 1, 2); px(c, L.hair, X + 8, Y + 2, 1, 2); px(c, '#0b0916', X + 4, Y + 4, 1, 1); px(c, '#0b0916', X + 7, Y + 4, 1, 1); }
  if (L.hat) { px(c, '#ffcc33', X + 2, Y, 8, 2); px(c, '#ffcc33', X + 4, Y - 2, 4, 2); }
}

// ---------- state ----------
const I = {
  mounted: false, canvas: null, ctx: null, scale: 2, vw: 0, vh: 0, cam: { x: 0, y: 0 },
  me: null, others: new Map(), socket: null, onEnter: null, keys: {}, raf: 0, last: 0,
  path: [], pending: null, lastSent: 0, sentKey: '', inside: null, cooldownDoor: null, bubbles: new Map(), flash: 0,
};
const EMOTE_TEXT = { hi: 'HI!', gg: 'GG', wow: 'WOW', lol: 'LOL', fire: '!!', heart: '<3' };

// ---------- pathfinding (BFS on the tile grid) ----------
function findPath(sx, sy, tx, ty) {
  const s = [Math.floor(sx / T), Math.floor(sy / T)];
  let g = [Math.floor(tx / T), Math.floor(ty / T)];
  if (g[0] < 0 || g[1] < 0 || g[0] >= MW || g[1] >= MH) return [];
  if (solid[g[1]][g[0]]) { // tapped on something solid: walk to the nearest free tile
    let best = null, bd = 1e9;
    for (let y = Math.max(0, g[1] - 3); y <= Math.min(MH - 1, g[1] + 3); y++) for (let x = Math.max(0, g[0] - 3); x <= Math.min(MW - 1, g[0] + 3); x++)
      if (!solid[y][x]) { const d = (x - g[0]) ** 2 + (y - g[1]) ** 2; if (d < bd) { bd = d; best = [x, y]; } }
    if (!best) return []; g = best; tx = g[0] * T + 8; ty = g[1] * T + 10;
  }
  const prev = new Int32Array(MW * MH).fill(-2), q = [s[1] * MW + s[0]];
  prev[q[0]] = -1;
  const goal = g[1] * MW + g[0];
  for (let i = 0; i < q.length && prev[goal] === -2; i++) {
    const cur = q[i], cx = cur % MW, cy = (cur - cx) / MW;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= MW || ny >= MH || solid[ny][nx]) continue;
      if (dx && dy && (solid[cy][nx] || solid[ny][cx])) continue; // no corner cutting
      const n = ny * MW + nx; if (prev[n] !== -2) continue; prev[n] = cur; q.push(n);
    }
  }
  if (prev[goal] === -2) return [];
  const out = [{ x: tx, y: ty }];
  for (let n = prev[goal]; n >= 0 && n !== q[0]; n = prev[n]) { const x = n % MW; out.unshift({ x: x * T + 8, y: (n - x) / MW * T + 10 }); }
  return out;
}

// ---------- update + render ----------
function moveMe(dt) {
  const me = I.me; let vx = 0, vy = 0;
  const k = I.keys;
  if (k.ArrowLeft || k.a) vx -= 1; if (k.ArrowRight || k.d) vx += 1; if (k.ArrowUp || k.w) vy -= 1; if (k.ArrowDown || k.s) vy += 1;
  if (vx || vy) { I.path = []; I.pending = null; }
  else if (I.path.length) {
    const wp = I.path[0], dx = wp.x - me.x, dy = wp.y - me.y, d = Math.hypot(dx, dy);
    if (d < 2) { I.path.shift(); } else { vx = dx / d; vy = dy / d; }
  }
  const len = Math.hypot(vx, vy);
  me.moving = len > 0;
  if (me.moving) {
    vx /= len; vy /= len;
    const nx = me.x + vx * SPEED * dt, ny = me.y + vy * SPEED * dt;
    const foot = (x, y) => walkable(x - 4, y) && walkable(x + 4, y) && walkable(x - 4, y - 3) && walkable(x + 4, y - 3);
    if (foot(nx, me.y)) me.x = nx; if (foot(me.x, ny)) me.y = ny;
    me.dir = Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? 1 : 2) : (vy < 0 ? 3 : 0);
    me.anim += dt * 8;
  } else me.anim = 0;
  // doors
  const at = BUILDINGS.find(b => Math.abs(me.x - b.door.x) < 10 && Math.abs(me.y - b.door.y) < 9);
  if (!at) I.cooldownDoor = null;
  else if (at.id !== I.cooldownDoor && (me.moving || (I.pending && I.pending === at.id))) { I.cooldownDoor = at.id; I.pending = null; I.path = []; enter(at); }
}
function enter(b) {
  I.inside = b.id;
  try { localStorage.setItem('ff-island-pos', JSON.stringify({ x: b.door.x, y: b.door.y + 18 })); } catch (e) {}
  if (I.onEnter) I.onEnter(b.id);
}
function sendPosition(now) {
  if (!I.socket || now - I.lastSent < 110) return;
  const me = I.me, key = `${Math.round(me.x)},${Math.round(me.y)},${me.dir},${me.moving ? 1 : 0}`;
  if (key === I.sentKey) return;
  I.sentKey = key; I.lastSent = now;
  I.socket.emit('island:move', { x: Math.round(me.x), y: Math.round(me.y), dir: me.dir, moving: me.moving });
}
function render(now) {
  const c = I.ctx, vw = I.vw, vh = I.vh, me = I.me;
  // camera follows the player
  const tx = Math.max(0, Math.min(WW - vw, me.x - vw / 2)), ty = Math.max(0, Math.min(WH - vh, me.y - vh / 2));
  I.cam.x += (tx - I.cam.x) * .18; I.cam.y += (ty - I.cam.y) * .18;
  if (WW < vw) I.cam.x = (WW - vw) / 2; if (WH < vh) I.cam.y = (WH - vh) / 2;
  const cx = Math.round(I.cam.x), cy = Math.round(I.cam.y);
  c.fillStyle = '#0d1638'; c.fillRect(0, 0, vw, vh);
  c.drawImage(staticLayer, cx, cy, vw, vh, 0, 0, vw, vh);
  c.save(); c.translate(-cx, -cy);
  // animated water glints and fountain spray
  if (!reduced) {
    const t = now / 1000;
    for (let i = 0; i < 40; i++) {
      const wx = Math.floor(hash(i, 1) * MW), wy = Math.floor(hash(i, 2) * MH);
      if (map[wy][wx] > SHALLOW) continue;
      if (Math.sin(t * 2 + i) > .55) px(c, '#5a7ad0', wx * T + Math.floor(hash(i, 3) * 10), wy * T + 7, 4, 1);
    }
    const fx = PLAZA_C.x * T, fy = (PLAZA_C.y - 1) * T + 2;
    for (let i = 0; i < 6; i++) { const ph = (t * 2 + i / 6) % 1; px(c, '#a9d1ff', fx - 1 + Math.round(Math.sin(i * 2.1) * ph * 10), fy + Math.round(-8 * Math.sin(ph * Math.PI)) + 2, 1, 1); }
    // forge smoke
    const fb = BUILDINGS.find(b => b.id === 'forge');
    for (let i = 0; i < 5; i++) { const ph = (t * .4 + i / 5) % 1; px(c, `rgba(150,140,170,${.55 * (1 - ph)})`, (fb.x + fb.w) * T - 15 + Math.round(Math.sin(t + i) * 4 * ph), fb.y * T - 12 - ph * 40, 3, 3); }
  }
  // building signs and lit door hints
  c.font = '8px "Press Start 2P", monospace'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  BUILDINGS.forEach(b => {
    const sx = b.door.x, sy = b.y * T - (b.board ? 2 : 6);
    const w = c.measureText(b.label).width + 8;
    px(c, 'rgba(11,9,22,.85)', Math.round(sx - w / 2), sy - 10, Math.round(w), 13);
    px(c, b.sign, Math.round(sx - w / 2), sy + 2, Math.round(w), 1);
    c.fillStyle = b.sign; c.fillText(b.label, sx, sy);
    const near = Math.hypot(me.x - b.door.x, me.y - b.door.y) < 44;
    if (near && !reduced && Math.floor(now / 300) % 2) { px(c, b.sign, b.door.x - 1, b.door.y - 3, 3, 3); }
  });
  // characters, y-sorted, with smoothing for other players
  const list = [];
  I.others.forEach(o => { o.x += (o.tx - o.x) * .2; o.y += (o.ty - o.y) * .2; if (o.moving) o.anim += .25; else o.anim = 0; list.push(o); });
  list.push(me);
  list.sort((a, b) => a.y - b.y);
  for (const p of list) {
    const frame = p.anim ? 1 + (Math.floor(p.anim) % 2) : 0;
    drawChar(c, p.x, p.y, p.look, p.dir, frame);
    const name = p === me ? p.nick : p.nick;
    c.font = '8px "Press Start 2P", monospace';
    const nw = c.measureText(name).width;
    px(c, 'rgba(11,9,22,.6)', Math.round(p.x - nw / 2 - 2), Math.round(p.y - 33), Math.round(nw + 4), 10);
    c.fillStyle = p === me ? '#ffcc33' : '#f3ecd6'; c.fillText(name, Math.round(p.x), Math.round(p.y - 25));
    const em = p === me ? I.myEmote : p.emote;
    if (em && (p !== me || now - I.myEmoteAt < 3000)) {
      const txt = EMOTE_TEXT[em] || em; const bw = c.measureText(txt).width + 8, bx = Math.round(p.x - bw / 2), by = Math.round(p.y - 50);
      px(c, '#f3ecd6', bx, by, Math.round(bw), 13); px(c, '#f3ecd6', Math.round(p.x) - 1, by + 13, 3, 2);
      c.fillStyle = '#1a1306'; c.fillText(txt, Math.round(p.x), by + 10);
    }
  }
  // tap target marker
  if (I.path.length && !reduced) { const g = I.path[I.path.length - 1]; const r = 2 + (Math.floor(now / 150) % 3); c.strokeStyle = '#ffcc33'; c.lineWidth = 1; c.strokeRect(Math.round(g.x - r), Math.round(g.y - r / 2), r * 2, r); }
  c.restore();
}
function loop(now) {
  if (!I.mounted) return;
  const dt = Math.min(.05, (now - (I.last || now)) / 1000); I.last = now;
  moveMe(dt);
  if (I.mounted) { sendPosition(now); render(now); }
  I.raf = requestAnimationFrame(loop);
}

// ---------- input ----------
function onPointer(e) {
  const r = I.canvas.getBoundingClientRect();
  const wx = I.cam.x + (e.clientX - r.left) / r.width * I.vw, wy = I.cam.y + (e.clientY - r.top) / r.height * I.vh;
  const b = BUILDINGS.find(b => wx >= b.x * T && wx < (b.x + b.w) * T && wy >= b.y * T - 14 && wy < (b.y + b.h) * T + 4);
  if (b) { I.pending = b.id; I.cooldownDoor = null; I.path = findPath(I.me.x, I.me.y, b.door.x, b.door.y + 2); }
  else { I.pending = null; I.path = findPath(I.me.x, I.me.y, wx, wy); }
}
const keyName = e => (e.key.length === 1 ? e.key.toLowerCase() : e.key);
const KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'w', 'a', 's', 'd'];
function onKey(e) {
  if (!I.mounted || /input|textarea|select/i.test((e.target && e.target.tagName) || '')) return;
  const k = keyName(e); if (!KEYS.includes(k)) return;
  I.keys[k] = e.type === 'keydown'; e.preventDefault();
}
addEventListener('keydown', onKey); addEventListener('keyup', onKey);
addEventListener('blur', () => (I.keys = {}));

function resize() {
  if (!I.canvas) return;
  const box = I.canvas.parentElement.getBoundingClientRect();
  const cssW = Math.max(240, box.width), cssH = Math.max(300, Math.min(innerHeight * .72, 720));
  I.scale = cssW < 1300 ? 2 : 3; // show more of the island on wide screens
  I.vw = Math.ceil(cssW / I.scale); I.vh = Math.ceil(cssH / I.scale);
  I.canvas.width = I.vw; I.canvas.height = I.vh;
  I.canvas.style.height = cssH + 'px';
  I.ctx.imageSmoothingEnabled = false;
}

// ---------- network ----------
function applyState(list, myId) {
  const seen = new Set();
  for (const [id, nick, x, y, dir, moving, addr, elo, emote] of list) {
    if (id === myId) continue;
    seen.add(id);
    let o = I.others.get(id);
    if (!o) { o = { id, nick, x, y, tx: x, ty: y, dir, moving: !!moving, anim: 0, look: lookOf(addr), elo }; I.others.set(id, o); }
    o.tx = x; o.ty = y; o.dir = dir; o.moving = !!moving; o.emote = emote; o.nick = nick;
  }
  for (const id of [...I.others.keys()]) if (!seen.has(id)) I.others.delete(id);
  if (I.onCount) I.onCount(seen.size + 1);
}

window.Island = {
  BUILDINGS,
  mount(container, { socket, me, onEnter, onCount }) {
    I.onEnter = onEnter; I.onCount = onCount; I.socket = socket;
    if (!staticLayer) buildStatic();
    if (!I.canvas) {
      I.canvas = document.createElement('canvas'); I.canvas.className = 'island-canvas';
      I.canvas.setAttribute('aria-label', 'Flipfight Island. Tap somewhere to walk, walk into a building to enter it.');
      I.ctx = I.canvas.getContext('2d');
      I.canvas.addEventListener('pointerdown', onPointer);
      addEventListener('resize', resize);
    }
    container.appendChild(I.canvas);
    let start = SPAWN;
    try { const s = JSON.parse(localStorage.getItem('ff-island-pos') || 'null'); if (s && walkable(s.x, s.y)) start = s; } catch (e) {}
    I.me = { id: me.id, nick: me.nickname, x: start.x, y: start.y, dir: 0, moving: false, anim: 0, look: lookOf(me.address) };
    I.path = []; I.pending = null; I.inside = null; I.keys = {};
    I.cooldownDoor = (BUILDINGS.find(b => Math.abs(start.x - b.door.x) < 10 && Math.abs(start.y - b.door.y) < 9) || {}).id || null;
    resize();
    I.cam.x = Math.max(0, Math.min(WW - I.vw, I.me.x - I.vw / 2)); I.cam.y = Math.max(0, Math.min(WH - I.vh, I.me.y - I.vh / 2));
    I.mounted = true; I.last = 0; I.sentKey = '';
    if (socket) {
      socket.off('island:state'); socket.on('island:state', d => applyState(d.players, me.id));
      socket.emit('island:enter', { x: I.me.x, y: I.me.y }, r => { if (r && r.ok) applyState(r.players, me.id); });
    }
    cancelAnimationFrame(I.raf); I.raf = requestAnimationFrame(loop);
  },
  unmount() {
    if (!I.mounted) return;
    I.mounted = false; cancelAnimationFrame(I.raf);
    if (I.me && !I.inside) { try { localStorage.setItem('ff-island-pos', JSON.stringify({ x: I.me.x, y: I.me.y })); } catch (e) {} }
    if (I.socket) I.socket.emit('island:leave');
    I.others.clear();
  },
  emote(e) {
    if (!I.mounted) return;
    I.myEmote = e; I.myEmoteAt = performance.now();
    if (I.socket) I.socket.emit('island:emote', e);
  },
  goTo(id) { const b = BUILDINGS.find(x => x.id === id); if (b && I.mounted) { I.pending = b.id; I.cooldownDoor = null; I.path = findPath(I.me.x, I.me.y, b.door.x, b.door.y + 2); } },
  // for tests
  state: () => ({ me: I.me && { x: Math.round(I.me.x), y: Math.round(I.me.y), dir: I.me.dir }, others: [...I.others.values()].map(o => ({ nick: o.nick, x: Math.round(o.tx), y: Math.round(o.ty), emote: o.emote })), path: I.path.length }),
};
})();
