// Flipfight Island: the shared hub. Walk your pixel character around, see other players live,
// and walk into a building to open that part of the game.
(function () {
'use strict';
const T = 16, MW = 52, MH = 38;             // tile size and map size in tiles
const WW = MW * T, WH = MH * T;
const SPEED = 80;                           // world px per second
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const OUT = '#1a1426';                      // outline colour used everywhere

// ---------- helpers ----------
function hash(x, y) { let h = (x | 0) * 374761393 + (y | 0) * 668265263; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function smooth(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const px = (c, col, x, y, w = 1, h = 1) => { c.fillStyle = col; c.fillRect(x | 0, y | 0, w | 0, h | 0); };
const dither = (c, a, b, x, y, w, h) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(c, (i + j) % 2 ? a : b, x + i, y + j); };
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
// Draws a sprite on its own canvas and adds a 1px dark outline around everything opaque.
function sprite(w, h, draw, outline = OUT) {
  const cv = canvas(w + 2, h + 2), c = cv.getContext('2d');
  c.save(); c.translate(1, 1); draw(c); c.restore();
  if (!outline) return cv;
  const d = c.getImageData(0, 0, w + 2, h + 2), a = d.data, W = w + 2, H = h + 2, mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = a[i * 4 + 3] > 40;
  c.fillStyle = outline;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (mask[y * W + x]) continue;
    if ((x > 0 && mask[y * W + x - 1]) || (x < W - 1 && mask[y * W + x + 1]) || (y > 0 && mask[(y - 1) * W + x]) || (y < H - 1 && mask[(y + 1) * W + x])) c.fillRect(x, y, 1, 1);
  }
  return cv;
}

// ---------- map ----------
const DEEP = 0, SHALLOW = 1, SAND = 2, GRASS = 3, PATH = 4, PLAZA = 6;
const BUILDINGS = [
  { id: 'arena', label: 'ARENA', x: 21, y: 4, w: 10, h: 6, sign: '#ffcc33' },
  { id: 'ranks', label: 'RANKS', x: 36, y: 7, w: 5, h: 6, sign: '#ffcc33' },
  { id: 'shop', label: 'SHOP', x: 9, y: 12, w: 6, h: 4, sign: '#ff8a5b' },
  { id: 'market', label: 'MARKET', x: 36, y: 18, w: 8, h: 4, sign: '#8fe3ff' },
  { id: 'forge', label: 'FORGE', x: 10, y: 23, w: 6, h: 4, sign: '#ff8a5b' },
  { id: 'collection', label: 'CARDS', x: 29, y: 26, w: 6, h: 4, sign: '#c79bff' },
  { id: 'history', label: 'HISTORY', x: 18, y: 18, w: 3, h: 2, sign: '#c9c3e6', board: true },
];
BUILDINGS.forEach(b => { b.door = { x: (b.x + Math.floor(b.w / 2)) * T + T / 2, y: (b.y + b.h) * T + 6 }; });
const PLAZA_C = { x: 26, y: 18 };
const SPAWN = { x: PLAZA_C.x * T + 8, y: (PLAZA_C.y + 3) * T + 4 };

const map = [], solid = [], props = [], lights = [];
(function buildMap() {
  const cx = MW / 2, cy = MH / 2 + .5;
  for (let y = 0; y < MH; y++) {
    map.push([]); solid.push([]);
    for (let x = 0; x < MW; x++) {
      const d = Math.hypot((x + .5 - cx) / (MW * .45), (y + .5 - cy) / (MH * .44)) + (smooth(x / 5, y / 5) - .5) * .18 + (smooth(x / 2, y / 2) - .5) * .05;
      const k = d < .84 ? GRASS : d < .93 ? SAND : d < 1.02 ? SHALLOW : DEEP;
      map[y].push(k); solid[y].push(k === DEEP || k === SHALLOW);
    }
  }
  for (let y = PLAZA_C.y - 2; y <= PLAZA_C.y + 3; y++) for (let x = PLAZA_C.x - 4; x <= PLAZA_C.x + 3; x++) map[y][x] = PLAZA;
  const setPath = (x, y) => { if (map[y][x] !== PLAZA && map[y][x] !== SHALLOW && map[y][x] !== DEEP) map[y][x] = PATH; };
  const path = (x0, y0, x1, y1) => {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) setPath(x, y0);
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) setPath(x1, y);
  };
  BUILDINGS.forEach(b => path(PLAZA_C.x, PLAZA_C.y + 1, Math.floor(b.door.x / T), Math.floor(b.door.y / T)));
  // path to the pier at the south shore
  let py = PLAZA_C.y; while (py < MH - 1 && map[py + 1][PLAZA_C.x] !== SHALLOW && map[py + 1][PLAZA_C.x] !== DEEP) { py++; setPath(PLAZA_C.x, py); }
  props.push({ k: 'pier', x: PLAZA_C.x, y: py + 1 });
  for (let y = py + 1; y < Math.min(MH, py + 4); y++) solid[y][PLAZA_C.x] = false;
  BUILDINGS.forEach(b => { for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) solid[y][x] = true; });
  for (let y = PLAZA_C.y - 1; y <= PLAZA_C.y; y++) for (let x = PLAZA_C.x - 1; x <= PLAZA_C.x; x++) solid[y][x] = true; // fountain
  // lamp posts along the paths
  const free = (x, y) => y > 0 && y < MH - 1 && x > 0 && x < MW - 1 && map[y][x] === GRASS && !solid[y][x];
  let n = 0;
  for (let y = 1; y < MH - 1; y++) for (let x = 1; x < MW - 1; x++) {
    if (map[y][x] !== PATH) continue;
    if (++n % 7) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (free(x + dx, y + dy)) { props.push({ k: 'lamp', x: x + dx, y: y + dy }); solid[y + dy][x + dx] = true; lights.push({ x: (x + dx) * T + 8, y: (y + dy) * T - 14, r: 52, c: [255, 196, 110], flicker: .06 }); break; }
  }
  // trees, bushes, rocks, flowers on free grass
  for (let y = 1; y < MH - 1; y++) for (let x = 1; x < MW - 1; x++) {
    if (!free(x, y)) continue;
    const nearB = BUILDINGS.some(b => x >= b.x - 1 && x <= b.x + b.w && y >= b.y - 2 && y <= b.y + b.h + 1);
    const nearP = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => map[y + dy][x + dx] === PATH || map[y + dy][x + dx] === PLAZA);
    const h = hash(x * 3, y * 7), edge = [[0, 1], [1, 0], [0, -1], [-1, 0]].some(([dx, dy]) => map[y + dy][x + dx] === SAND);
    if (nearB || nearP) { if (h > .9 && !nearB) props.push({ k: 'flowers', x, y }); continue; }
    const forest = smooth(x / 4.5 + 9, y / 4.5 + 3);
    if (!edge && (h < .06 || (forest > .6 && h < .5))) { props.push({ k: hash(x, y * 5) < (forest > .6 ? .6 : .4) ? 'pine' : 'tree', x, y }); solid[y][x] = true; }
    else if (h < .1) { props.push({ k: 'bush', x, y }); solid[y][x] = true; }
    else if (h > .93) props.push({ k: 'flowers', x, y });
    else if (h > .885) props.push({ k: 'tuft', x, y });
  }
  for (let y = 1; y < MH - 1; y++) for (let x = 1; x < MW - 1; x++) {
    if (map[y][x] !== SAND || solid[y][x]) continue;
    const r = hash(x * 11, y * 13), nearPath = [[0, 1], [1, 0], [0, -1], [-1, 0]].some(([dx, dy]) => map[y + dy][x + dx] === PATH);
    if (nearPath) continue;
    if (r < .045) { props.push({ k: 'rock', x, y }); solid[y][x] = true; }
    else if (r > .94) { props.push({ k: 'palm', x, y }); solid[y][x] = true; }
    else if (r > .9) props.push({ k: 'shell', x, y });
  }
  // building decorations and their lights
  const deco = (k, x, y, s = true) => { props.push({ k, x, y }); if (s) solid[y][x] = true; };
  const sh = BUILDINGS[2]; deco('crate', sh.x - 1, sh.y + 3); deco('barrel', sh.x + sh.w, sh.y + 3);
  const mk = BUILDINGS[3]; deco('crate', mk.x - 1, mk.y + 3); deco('crate', mk.x + mk.w, mk.y + 3); deco('barrel', mk.x + mk.w, mk.y + 2);
  const fg = BUILDINGS[4]; deco('anvil', fg.x + fg.w, fg.y + 3); deco('barrel', fg.x - 1, fg.y + 3);
  const ar = BUILDINGS[0]; deco('banner', ar.x - 1, ar.y + 5); deco('banner', ar.x + ar.w, ar.y + 5);
})();
const walkable = (x, y) => { const tx = Math.floor(x / T), ty = Math.floor(y / T); return tx >= 0 && ty >= 0 && tx < MW && ty < MH && !solid[ty][tx]; };
const isWater = (x, y) => x < 0 || y < 0 || x >= MW || y >= MH || map[y][x] <= SHALLOW;

// ---------- tiles ----------
const P = {
  deep: '#173063', deep2: '#1b386f', deepHi: '#2c5596',
  shallow: '#24548f', shallowHi: '#3a75b3', foam: '#cfe6ff',
  sand: '#d8b77a', sand2: '#c9a466', sandShade: '#a8844f', sandHi: '#ead2a0',
  grass: '#4e9a4f', grass2: '#438a46', grassDark: '#36703b', grassHi: '#6bb860', grassEdge: '#2c5a33',
  path: '#a99db8', path2: '#968aa7', pathGap: '#6f6584', pathHi: '#c3b9d0',
  plaza: '#b5abc4', plaza2: '#a297b4', plazaGap: '#7a7090', plazaHi: '#cdc4da',
};
function drawTile(c, x, y) {
  const k = map[y][x], X = x * T, Y = y * T, h = i => hash(x * 31 + i, y * 17 + i * 7);
  if (k === DEEP) { px(c, P.deep, X, Y, T, T); if (h(1) < .5) px(c, P.deep2, X + Math.floor(h(2) * 8), Y + Math.floor(h(3) * 14), 6, 1); return; }
  if (k === SHALLOW) { px(c, P.shallow, X, Y, T, T); if (h(1) < .6) px(c, P.shallowHi, X + Math.floor(h(2) * 8), Y + Math.floor(h(3) * 14), 5, 1); return; }
  if (k === SAND) {
    px(c, P.sand, X, Y, T, T);
    for (let i = 0; i < 7; i++) px(c, h(i) < .5 ? P.sand2 : P.sandHi, X + Math.floor(h(i + 9) * 15), Y + Math.floor(h(i + 19) * 15));
    if (h(40) < .25) { px(c, P.sandShade, X + 5, Y + 9, 3, 2); px(c, P.sandHi, X + 5, Y + 9); }
    return;
  }
  if (k === GRASS) {
    px(c, P.grass, X, Y, T, T);
    for (let i = 0; i < 5; i++) px(c, P.grass2, X + Math.floor(h(i) * 14), Y + Math.floor(h(i + 5) * 14), 2, 2);
    for (let i = 0; i < 3; i++) { const gx = X + 1 + Math.floor(h(i + 10) * 13), gy = Y + 3 + Math.floor(h(i + 20) * 11); px(c, P.grassDark, gx, gy, 1, 2); px(c, P.grassDark, gx + 2, gy, 1, 2); px(c, P.grassHi, gx + 1, gy - 1, 1, 2); }
    return;
  }
  if (k === PATH) {
    px(c, P.pathGap, X, Y, T, T);
    // cobblestones
    const stones = [[0, 0, 7, 5], [8, 0, 8, 5], [0, 6, 4, 4], [5, 6, 6, 4], [12, 6, 4, 4], [0, 11, 8, 5], [9, 11, 7, 5]];
    stones.forEach(([sx, sy, sw, sh], i) => { const col = h(i) < .5 ? P.path : P.path2; px(c, col, X + sx + 1, Y + sy + 1, sw - 1, sh - 1); px(c, P.pathHi, X + sx + 1, Y + sy + 1, sw - 2, 1); });
    return;
  }
  if (k === PLAZA) {
    px(c, P.plazaGap, X, Y, T, T);
    const col = (x + y) % 2 ? P.plaza : P.plaza2;
    px(c, col, X + 1, Y + 1, T - 1, T - 1); px(c, P.plazaHi, X + 1, Y + 1, T - 2, 1); px(c, P.plazaHi, X + 1, Y + 1, 1, T - 2);
    if (h(3) < .2) px(c, P.plaza2, X + 4 + Math.floor(h(4) * 6), Y + 5 + Math.floor(h(5) * 6), 2, 1);
  }
}
// soft edges where grass meets sand, sand meets water, etc.
function drawEdges(c, x, y) {
  const k = map[y][x], X = x * T, Y = y * T;
  const nb = (dx, dy) => (x + dx < 0 || y + dy < 0 || x + dx >= MW || y + dy >= MH) ? DEEP : map[y + dy][x + dx];
  if (k === GRASS || k === PATH || k === PLAZA) {
    // grass overhang onto neighbouring sand with an irregular dark lip
    [[0, 1], [1, 0], [-1, 0], [0, -1]].forEach(([dx, dy]) => {
      if (nb(dx, dy) !== SAND || k !== GRASS) return;
      for (let i = 0; i < T; i++) {
        const lip = 1 + Math.floor(hash(x * 7 + i, y * 5 + dx * 3 + dy) * 3);
        if (dy === 1) { px(c, P.grass, X + i, Y + T, 1, lip - 1); px(c, P.grassEdge, X + i, Y + T + lip - 1, 1, 1); }
        if (dy === -1) { px(c, P.grassEdge, X + i, Y - 1, 1, 1); }
        if (dx === 1) { px(c, P.grass, X + T, Y + i, lip - 1, 1); px(c, P.grassEdge, X + T + lip - 1, Y + i, 1, 1); }
        if (dx === -1) { px(c, P.grass, X - lip + 1, Y + i, lip - 1, 1); px(c, P.grassEdge, X - lip, Y + i, 1, 1); }
      }
    });
  }
  if (k === SAND) {
    // wet sand line next to water
    [[0, 1], [1, 0], [-1, 0], [0, -1]].forEach(([dx, dy]) => {
      if (nb(dx, dy) > SHALLOW) return;
      if (dy === 1) px(c, P.sand2, X, Y + T - 2, T, 2); if (dy === -1) px(c, P.sand2, X, Y, T, 2);
      if (dx === 1) px(c, P.sand2, X + T - 2, Y, 2, T); if (dx === -1) px(c, P.sand2, X, Y, 2, T);
    });
  }
  // round off outer corners so coastlines and lawns don't look like stairs
  const corner = (fill, edge, r) => [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([dx, dy]) => {
    const a = nb(dx, 0), b = nb(0, dy);
    if (!(fill(a) && fill(b))) return;
    const cx = dx < 0 ? X : X + T, cy = dy < 0 ? Y : Y + T, col = P[{ [SHALLOW]: 'shallow', [DEEP]: 'deep', [SAND]: 'sand' }[a] || 'shallow'];
    for (let j = 0; j < r; j++) for (let i = 0; i < r; i++) {
      const ox = dx < 0 ? i : -1 - i, oy = dy < 0 ? j : -1 - j, d = Math.hypot(r - i - .5, r - j - .5);
      if (d > r) px(c, col, cx + ox, cy + oy); else if (edge && d > r - 1.2) px(c, edge, cx + ox, cy + oy);
    }
  });
  if (k === SAND) corner(n => n <= SHALLOW, P.sand2, 7);
  if (k === GRASS) corner(n => n === SAND, P.grassEdge, 6);
  if (k === SHALLOW) {
    // shallow water fades to deep
    [[0, 1], [1, 0], [-1, 0], [0, -1]].forEach(([dx, dy]) => {
      if (nb(dx, dy) !== DEEP) return;
      for (let i = 0; i < T; i += 2) {
        if (dy === 1) px(c, P.deep, X + i + (y % 2), Y + T - 2, 1, 2); if (dy === -1) px(c, P.deep, X + i + (y % 2), Y, 1, 2);
        if (dx === 1) px(c, P.deep, X + T - 2, Y + i + (x % 2), 2, 1); if (dx === -1) px(c, P.deep, X, Y + i + (x % 2), 2, 1);
      }
    });
  }
}

// ---------- props ----------
const SPR = {};
function makeProps() {
  SPR.tree = sprite(30, 34, c => {
    px(c, '#5b3a26', 13, 22, 5, 11); px(c, '#7a5034', 13, 22, 2, 11); px(c, '#3f281a', 17, 24, 1, 9);
    const blob = (cx, cy, r, col) => { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * .6) px(c, col, cx + x, cy + y); };
    blob(15, 14, 11, '#2f6b3a'); blob(9, 17, 7, '#2f6b3a'); blob(21, 17, 7, '#2f6b3a');
    blob(14, 12, 9, '#3f8a45'); blob(9, 15, 5, '#3f8a45'); blob(20, 14, 6, '#3f8a45');
    blob(12, 9, 5, '#58a650'); blob(18, 11, 3, '#58a650');
    for (let i = 0; i < 9; i++) px(c, '#7cc66a', 8 + Math.floor(hash(i, 3) * 12), 5 + Math.floor(hash(i, 7) * 8));
    for (let i = 0; i < 6; i++) px(c, '#245530', 6 + Math.floor(hash(i, 9) * 18), 18 + Math.floor(hash(i, 4) * 6));
  });
  SPR.pine = sprite(24, 38, c => {
    px(c, '#5b3a26', 10, 30, 4, 7);
    for (let t = 0; t < 4; t++) {
      const top = 2 + t * 7, wdt = 6 + t * 4;
      for (let r = 0; r < 10; r++) { const half = Math.min(wdt, 2 + r * 1.2 + t); px(c, r < 3 ? '#4a9450' : r < 7 ? '#357a40' : '#285e33', 12 - half, top + r, half * 2, 1); }
      px(c, '#6fbd62', 11 - t, top + 2, 2, 1);
    }
    px(c, '#285e33', 4, 31, 16, 1);
  });
  SPR.bush = sprite(16, 11, c => {
    const blob = (cx, cy, r, col) => { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * .5) px(c, col, cx + x, cy + y); };
    blob(5, 6, 4, '#2f6b3a'); blob(10, 6, 5, '#2f6b3a'); blob(9, 5, 4, '#3f8a45'); blob(5, 5, 3, '#3f8a45'); px(c, '#6bb860', 8, 2, 2, 1); px(c, '#ff7ab0', 4, 4); px(c, '#ff7ab0', 12, 5);
  });
  SPR.palm = sprite(30, 36, c => {
    for (let i = 0; i < 22; i++) { const x = 14 + Math.round(Math.sin(i / 7) * 3); px(c, i % 4 === 0 ? '#7a5034' : '#9a6a3c', x, 13 + i, 3, 1); }
    const frond = (dx, dy, col) => { for (let i = 0; i < 12; i++) { const x = 15 + Math.round(dx * i), y = 11 + Math.round(dy * i + (i * i) * .06); px(c, col, x, y, 2, 2); if (i > 2 && i % 2) px(c, col, x, y + 2, 1, 1); } };
    frond(-1.1, -.3, '#2f6b3a'); frond(1.1, -.3, '#2f6b3a'); frond(-.9, .3, '#3f8a45'); frond(.9, .3, '#3f8a45'); frond(-.3, -.8, '#58a650'); frond(.4, -.7, '#58a650');
    px(c, '#5b3a26', 14, 12, 4, 3); px(c, '#7a5034', 14, 12, 1, 1);
  });
  SPR.shell = sprite(5, 3, c => { px(c, '#f4d6e0', 0, 1, 5, 2); px(c, '#ffffff', 1, 0, 3, 1); px(c, '#d8a8b8', 2, 1, 1, 2); }, null);
  SPR.rock = sprite(12, 8, c => { px(c, '#8b84a0', 1, 2, 10, 6); px(c, '#a9a2bd', 2, 1, 7, 3); px(c, '#6d6684', 1, 6, 10, 2); px(c, '#c9c3da', 3, 2, 2, 1); });
  SPR.lamp = sprite(6, 26, c => {
    px(c, '#3a3150', 2, 6, 2, 19); px(c, '#4d4366', 0, 23, 6, 2);
    px(c, '#3a3150', 0, 0, 6, 2); px(c, '#ffe9a8', 1, 2, 4, 4); px(c, '#ffd166', 1, 5, 4, 1); px(c, '#3a3150', 0, 6, 6, 1);
  });
  SPR.crate = sprite(14, 12, c => { px(c, '#9a6a3c', 0, 0, 14, 12); px(c, '#b8844c', 1, 1, 12, 2); px(c, '#6e4826', 0, 5, 14, 1); px(c, '#6e4826', 6, 0, 1, 12); px(c, '#c99a5c', 2, 7, 3, 1); });
  SPR.barrel = sprite(12, 14, c => { px(c, '#8a5a32', 1, 0, 10, 14); px(c, '#a8703e', 2, 0, 3, 14); px(c, '#5b5470', 0, 3, 12, 2); px(c, '#5b5470', 0, 10, 12, 2); px(c, '#7d7694', 1, 3, 3, 1); });
  SPR.anvil = sprite(16, 10, c => { px(c, '#6d6684', 0, 0, 14, 3); px(c, '#8b84a0', 1, 0, 10, 1); px(c, '#6d6684', 12, 1, 4, 1); px(c, '#4d4366', 4, 3, 6, 4); px(c, '#3a3150', 2, 7, 10, 3); });
  SPR.banner = sprite(10, 30, c => { px(c, '#cfc6b0', 4, 0, 2, 30); px(c, '#ff6b35', 6, 2, 4, 12); px(c, '#ffcc33', 6, 6, 4, 2); px(c, '#c44a24', 6, 12, 2, 2); });
  SPR.flowers = sprite(14, 8, c => {
    [[2, 3, '#ff7ab0'], [7, 1, '#ffd166'], [11, 4, '#8fe3ff'], [5, 6, '#ffffff']].forEach(([x, y, col]) => { px(c, '#2c5a33', x, y + 1, 1, 2); px(c, col, x - 1, y, 3, 1); px(c, col, x, y - 1, 1, 3); px(c, '#ffe9a8', x, y); });
  }, null);
  SPR.tuft = sprite(10, 6, c => { [[1, 2], [4, 0], [7, 2]].forEach(([x, y]) => { px(c, '#2c5a33', x, y + 1, 1, 5 - y); px(c, '#6bb860', x, y, 1, 2); }); }, null);
  SPR.pier = sprite(16, 54, c => {
    px(c, '#3f281a', 1, 6, 2, 48); px(c, '#3f281a', 13, 6, 2, 48);
    for (let i = 0; i < 12; i++) { px(c, i % 2 ? '#8a5a32' : '#9a6a3c', 0, i * 4, 16, 3); px(c, '#b8844c', 0, i * 4, 16, 1); }
  });
  SPR.boat = sprite(26, 12, c => { px(c, '#8a5a32', 2, 4, 22, 6); px(c, '#a8703e', 0, 3, 26, 2); px(c, '#6e4826', 4, 9, 18, 2); px(c, '#cfe6ff', 6, 6, 3, 1); }, OUT);
}

// ---------- buildings ----------
function wall(c, x, y, w, h, base, hi, sh) { px(c, base, x, y, w, h); px(c, hi, x, y, w, 2); px(c, sh, x, y + h - 2, w, 2); }
function bricks(c, x, y, w, h, col) { for (let j = 0; j < h; j += 5) for (let i = (j / 5) % 2 ? 3 : 0; i < w; i += 7) px(c, col, x + i, y + j, 1, 4), px(c, col, x, y + j + 4, w, 1); }
function window_(c, x, y, w, h, frame) { px(c, frame, x - 1, y - 1, w + 2, h + 2); px(c, '#ffd27a', x, y, w, h); px(c, '#fff0b8', x, y, Math.ceil(w / 2), Math.ceil(h / 2)); px(c, frame, x + Math.floor(w / 2), y, 1, h); }
function door(c, x, y, w, h, wood = '#5b3a26') { px(c, OUT, x - 1, y - 1, w + 2, h + 1); px(c, wood, x, y, w, h); px(c, '#7a5034', x + 1, y + 1, w - 2, 1); px(c, '#3f281a', x + Math.floor(w / 2), y, 1, h); px(c, '#ffcc33', x + w - 3, y + Math.floor(h / 2), 1, 1); }
function roofRows(c, x, y, w, h, a, b, edge) { for (let j = 0; j < h; j++) px(c, j % 3 === 2 ? b : a, x, y + j, w, 1); px(c, edge, x, y + h - 1, w, 1); for (let j = 0; j < h; j += 3) for (let i = (j / 3) % 2 ? 2 : 6; i < w; i += 8) px(c, b, x + i, y + j, 1, 2); }

const BLD = {};
function makeBuildings() {
  BUILDINGS.forEach(b => {
    const W = b.w * T, H = b.h * T, up = b.id === 'arena' ? 26 : b.id === 'ranks' ? 40 : 22;
    b.sprite = sprite(W, H + up, c => { c.translate(0, up); BLD[b.id](c, W, H, b); });
    b.up = up;
  });
}
BLD.arena = (c, W, H, b) => {
  const st = '#c2b8d4', st2 = '#a99fbd', st3 = '#8b81a1', dark = '#2a2238';
  // upper tier
  wall(c, 6, -14, W - 12, 34, st2, st, st3);
  for (let i = 0; i < 9; i++) { const ax = 12 + i * 16; px(c, dark, ax, -6, 8, 12); px(c, dark, ax + 1, -8, 6, 2); }
  for (let i = 0; i < W - 12; i += 6) px(c, st, 6 + i, -18, 4, 4); // crenellations
  // lower tier with big arches
  wall(c, 0, 18, W, H - 18, st, '#d6cde4', st3);
  bricks(c, 0, 22, W, H - 26, st2);
  for (let i = 0; i < 7; i++) {
    const ax = 8 + i * 21; if (Math.abs(ax + 6 - W / 2) < 16) continue;
    px(c, dark, ax, 30, 13, 26); px(c, dark, ax + 2, 27, 9, 3); px(c, '#4a3a2a', ax, 52, 13, 4); px(c, '#ffb347', ax + 2, 50, 9, 2);
    px(c, st, ax - 3, 26, 2, H - 30); // pillars
  }
  // grand gate
  px(c, dark, W / 2 - 13, 24, 26, H - 24); px(c, dark, W / 2 - 10, 20, 20, 4);
  for (let i = 0; i < 5; i++) px(c, '#6d6684', W / 2 - 11 + i * 5, 26, 1, H - 30); px(c, '#6d6684', W / 2 - 12, 40, 24, 1); px(c, '#6d6684', W / 2 - 12, 56, 24, 1);
  px(c, '#ffb347', W / 2 - 12, H - 6, 24, 3);
  // banner over gate
  px(c, '#b0322a', W / 2 - 18, 6, 36, 10); px(c, '#ffcc33', W / 2 - 18, 6, 36, 1); px(c, '#ffcc33', W / 2 - 2, 9, 4, 4);
  // flags
  [8, W / 2 - 1, W - 10].forEach((fx, i) => { px(c, '#e8e0cc', fx, -26, 2, 14); px(c, ['#ff6b35', '#ffcc33', '#4f8dff'][i], fx + 2, -26, 8, 5); px(c, '#00000033', fx + 2, -22, 8, 1); });
};
BLD.ranks = (c, W, H) => {
  const st = '#b9aec9', st2 = '#9a8fae', st3 = '#7a6f8e';
  wall(c, 8, 0, W - 16, H, st, '#d0c6de', st3); bricks(c, 8, 4, W - 16, H - 8, st2);
  px(c, st3, 6, H - 10, W - 12, 10); px(c, st, 6, H - 10, W - 12, 2);
  // gold dome and spire
  for (let r = 0; r < 14; r++) { const half = Math.floor(Math.sqrt(14 * 14 - (13 - r) ** 2)); px(c, r < 5 ? '#ffe28a' : r < 10 ? '#ffcc33' : '#d9a21c', W / 2 - half, -14 + r, half * 2, 1); }
  px(c, '#fff3c4', W / 2 - 6, -12, 3, 3);
  px(c, '#ffcc33', W / 2 - 1, -38, 2, 24); px(c, '#ffe28a', W / 2 - 3, -40, 6, 4);
  // trophy emblem and windows
  px(c, '#ffcc33', W / 2 - 5, 8, 10, 6); px(c, '#ffcc33', W / 2 - 2, 14, 4, 4); px(c, '#ffcc33', W / 2 - 4, 18, 8, 2); px(c, '#fff3c4', W / 2 - 4, 9, 2, 2);
  window_(c, W / 2 - 3, 30, 6, 9, st3); window_(c, W / 2 - 3, 50, 6, 9, st3);
  door(c, W / 2 - 6, H - 18, 12, 18, '#6a4a2a');
  [12, W - 16].forEach(x => { px(c, '#b0322a', x, 4, 4, 22); px(c, '#ffcc33', x, 4, 4, 1); px(c, '#ffcc33', x + 1, 12, 2, 2); });
};
BLD.shop = (c, W, H) => {
  wall(c, 4, 16, W - 8, H - 16, '#9a6a3c', '#b8844c', '#6e4826');
  for (let j = 20; j < H - 2; j += 4) px(c, '#8a5a32', 4, j, W - 8, 1);
  // striped awning
  for (let i = 0; i < W; i += 8) { px(c, (i / 8) % 2 ? '#f4ecd8' : '#e0484e', i, 4, 8, 14); px(c, (i / 8) % 2 ? '#d8cdb2' : '#b0322a', i, 16, 8, 2); }
  for (let i = 0; i < W; i += 8) px(c, (i / 8) % 2 ? '#f4ecd8' : '#e0484e', i + 2, 18, 4, 3);
  px(c, '#6e4826', 0, 2, W, 2);
  // counter with goods
  px(c, '#c99a5c', 8, 34, W - 16, 4); px(c, '#6e4826', 8, 38, W - 16, 2);
  [['#ff6bd6', 12], ['#5fd38d', 22], ['#4f8dff', 32], ['#ffcc33', 60], ['#ff6b35', 70]].forEach(([col, x]) => { px(c, col, x, 28, 6, 6); px(c, '#ffffff88', x + 1, 29, 2, 2); });
  door(c, W / 2 - 6, H - 20, 12, 20);
  // hanging coin sign
  px(c, '#3f281a', W - 18, 22, 1, 6); px(c, '#ffcc33', W - 22, 28, 9, 9); px(c, '#d9a21c', W - 20, 30, 5, 5); px(c, '#fff3c4', W - 21, 29, 2, 2);
};
BLD.market = (c, W, H) => {
  const tents = [['#8fe3ff', '#4fb3d6'], ['#c79bff', '#9a6bd6'], ['#ffcc33', '#d9a21c'], ['#5fd38d', '#3fa86a']];
  const tw = Math.floor(W / 3.4);
  [0, 1, 2].forEach(i => {
    const tx = 2 + i * (tw + 6), [a, b] = tents[i];
    px(c, '#3a2a22', tx + 2, 22, tw - 4, H - 22); px(c, '#2a1d14', tx + 4, 26, tw - 8, H - 30);
    for (let r = 0; r < 20; r++) { const half = Math.floor(4 + r * (tw / 2 - 4) / 19); for (let s = -half; s < half; s++) px(c, Math.floor((s + 40) / 4) % 2 ? a : '#f4ecd8', tx + tw / 2 + s, 4 + r); }
    px(c, b, tx, 23, tw, 2); for (let s = 0; s < tw; s += 4) px(c, s % 8 ? '#f4ecd8' : a, tx + s, 25, 3, 3);
    px(c, '#e8e0cc', tx + tw / 2 - 1, 0, 2, 5);
    [['#ff6b35', 6], ['#ffd166', 12], ['#8fe3ff', 18]].forEach(([col, x]) => x < tw - 6 && px(c, col, tx + x, H - 16, 4, 4));
  });
  px(c, '#9a3a5a', 10, H - 6, W - 20, 6); for (let i = 12; i < W - 12; i += 6) px(c, '#ffcc33', i, H - 4, 2, 2);
};
BLD.forge = (c, W, H) => {
  wall(c, 2, 14, W - 4, H - 14, '#6d6684', '#8b84a0', '#4d4366'); bricks(c, 2, 18, W - 4, H - 22, '#5b5470');
  roofRows(c, -2, 2, W + 4, 14, '#3a3150', '#2a2340', '#1a1426');
  // chimney with glowing top
  px(c, '#4d4366', W - 22, -20, 14, 36); bricks(c, W - 22, -18, 14, 32, '#3a3150'); px(c, '#ff8a3a', W - 20, -22, 10, 3); px(c, '#ffd166', W - 18, -22, 6, 1);
  // open furnace
  px(c, '#2a1d14', 8, 26, 30, 30); px(c, '#ff6b35', 11, 36, 24, 18); px(c, '#ffb347', 14, 40, 18, 12); px(c, '#ffe9a8', 18, 44, 10, 6);
  px(c, '#3a3150', 8, 24, 30, 3);
  door(c, W - 30, H - 22, 14, 22, '#4a3020');
  // hammer sign
  px(c, '#cfc6b0', W - 28, 20, 10, 4); px(c, '#8a5a32', W - 24, 24, 2, 8);
};
BLD.collection = (c, W, H) => {
  // timber-framed library
  wall(c, 4, 22, W - 8, H - 22, '#e8dcc0', '#f4ecd8', '#c9b892');
  [4, W / 2 - 1, W - 6].forEach(x => px(c, '#6e4826', x, 22, 2, H - 22)); px(c, '#6e4826', 4, 22, W - 8, 2); px(c, '#6e4826', 4, 42, W - 8, 2);
  for (let r = 0; r < 24; r++) { const inset = Math.max(0, 24 - r) * 1.1 - 6; px(c, r % 3 === 2 ? '#6a3a7a' : '#8a4a9a', Math.max(-2, inset), r - 2, W - 2 * Math.max(-2, inset), 1); }
  px(c, '#4a2a5a', -2, 21, W + 4, 2);
  window_(c, 14, 28, 12, 10, '#6e4826'); window_(c, W - 26, 28, 12, 10, '#6e4826');
  // round attic window
  for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) if (x * x + y * y <= 16) px(c, x * x + y * y > 9 ? '#4a2a5a' : '#ffd27a', W / 2 + x, 8 + y);
  door(c, W / 2 - 6, H - 20, 12, 20, '#6a3a7a');
  // book sign
  px(c, '#c79bff', W / 2 + 10, 46, 12, 9); px(c, '#f4ecd8', W / 2 + 11, 47, 4, 7); px(c, '#f4ecd8', W / 2 + 17, 47, 4, 7);
};
BLD.history = (c, W, H) => {
  px(c, '#5b3a26', 6, 10, 3, H - 10); px(c, '#5b3a26', W - 9, 10, 3, H - 10);
  px(c, '#9a6a3c', 0, 0, W, 22); px(c, '#b8844c', 0, 0, W, 2); px(c, '#6e4826', 0, 20, W, 2);
  [[3, 4, 10, 8, '#f4ecd8'], [16, 3, 9, 11, '#ffe9a8'], [28, 5, 14, 7, '#cfe6ff'], [5, 13, 13, 5, '#ffd6e8'], [30, 13, 12, 5, '#f4ecd8']].forEach(([x, y, w, h, col]) => {
    if (x + w > W) return; px(c, col, x, y, w, h); px(c, '#e0484e', x + Math.floor(w / 2), y, 1, 1); for (let j = 2; j < h - 1; j += 2) px(c, '#00000044', x + 2, y + j, w - 4, 1);
  });
};

// building lights (windows, torches, furnace) in world coordinates
function buildingLights() {
  const at = (b, x, y, r, c, f = 0) => lights.push({ x: b.x * T + x, y: (b.y + b.h) * T - b.h * T + y, r, c, flicker: f });
  const B = id => BUILDINGS.find(b => b.id === id);
  const ar = B('arena'); at(ar, ar.w * T / 2 - 20, ar.h * T - 10, 46, [255, 170, 90], .12); at(ar, ar.w * T / 2 + 20, ar.h * T - 10, 46, [255, 170, 90], .12); at(ar, ar.w * T / 2, ar.h * T - 30, 60, [255, 150, 70], .06);
  const rk = B('ranks'); at(rk, rk.w * T / 2, -14, 50, [255, 220, 120], .03); at(rk, rk.w * T / 2, 34, 30, [255, 210, 140]);
  const sh = B('shop'); at(sh, sh.w * T / 2, 30, 50, [255, 200, 130]);
  const mk = B('market'); [0.2, .5, .8].forEach(f => at(mk, mk.w * T * f, 40, 36, [255, 190, 140], .04));
  const fg = B('forge'); at(fg, 24, 46, 64, [255, 120, 50], .22); at(fg, fg.w * T - 15, -22, 34, [255, 140, 60], .2);
  const co = B('collection'); at(co, 20, 32, 38, [255, 210, 140]); at(co, co.w * T - 20, 32, 38, [255, 210, 140]); at(co, co.w * T / 2, 8, 26, [255, 210, 140]);
  const hi = B('history'); at(hi, hi.w * T / 2, 10, 30, [200, 200, 255]);
  lights.push({ x: PLAZA_C.x * T, y: PLAZA_C.y * T - 4, r: 56, c: [120, 180, 255], flicker: .04 }); // fountain
}

// ---------- static layer ----------
let ground = null; // tiles + flat details, drawn once
const sortables = []; // things drawn with depth sorting: { y, img, x, oy }
function buildStatic() {
  makeProps(); makeBuildings(); buildingLights();
  ground = canvas(WW, WH);
  const c = ground.getContext('2d');
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) drawTile(c, x, y);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) drawEdges(c, x, y);
  // fountain basin (flat, on the plaza)
  const fx = (PLAZA_C.x - 1) * T, fy = (PLAZA_C.y - 1) * T;
  const fountain = sprite(36, 32, c2 => {
    const ell = (cx, cy, rx, ry, col) => { for (let y = -ry; y <= ry; y++) { const w = Math.round(rx * Math.sqrt(1 - (y / (ry + .5)) ** 2)); px(c2, col, cx - w, cy + y, w * 2, 1); } };
    ell(18, 25, 17, 5, '#6d6684');            // front wall of the basin
    ell(18, 22, 17, 7, '#c2b8d4');            // rim
    ell(18, 21, 17, 6, '#d6cde4');
    ell(18, 22, 14, 5, '#2f6ab0');            // water
    ell(18, 23, 12, 3, '#3a7cc4');
    px(c2, '#9cc3f0', 9, 21, 4, 1); px(c2, '#9cc3f0', 24, 24, 3, 1); px(c2, '#cfe6ff', 12, 23, 2, 1);
    px(c2, '#8b81a1', 15, 8, 6, 15); px(c2, '#c2b8d4', 16, 8, 2, 15); px(c2, '#6d6684', 20, 8, 1, 15); // pillar
    ell(18, 8, 7, 2, '#c2b8d4'); ell(18, 8, 5, 1, '#3a7cc4'); px(c2, '#8b81a1', 11, 10, 14, 1);          // top bowl
    px(c2, '#d6cde4', 17, 2, 2, 5); px(c2, '#ffcc33', 16, 0, 4, 3); px(c2, '#fff3c4', 16, 0, 1, 1);     // gold finial
    px(c2, '#7fb0e8', 11, 11, 1, 9); px(c2, '#7fb0e8', 24, 11, 1, 9); px(c2, '#cfe6ff', 11, 11, 1, 3); px(c2, '#cfe6ff', 24, 11, 1, 3); // falling water
  });
  sortables.push({ img: fountain, x: fx - 3, y: fy - 2, base: fy + 28 });
  props.forEach(p => {
    const X = p.x * T, Y = p.y * T;
    if (p.k === 'flowers' || p.k === 'tuft' || p.k === 'shell') { c.drawImage(SPR[p.k], X + 1 + Math.floor(hash(p.x, p.y) * 4), Y + 4 + Math.floor(hash(p.y, p.x) * 4)); return; }
    if (p.k === 'pier') { c.drawImage(SPR.pier, X - 1, Y - 6); c.drawImage(SPR.boat, X + 16, Y + 22); c.drawImage(SPR.boat, X - 28, Y + 34); return; }
    const img = SPR[p.k], off = { palm: [-7, -22], tree: [-7, -22], pine: [-4, -24], bush: [0, 4], rock: [2, 6], lamp: [5, -12], crate: [1, 3], barrel: [2, 2], anvil: [0, 6], banner: [3, -16] }[p.k] || [0, 0];
    // little shadow
    c.fillStyle = 'rgba(10,8,30,.35)'; c.fillRect(X + 2, Y + 12, 12, 3);
    sortables.push({ img, x: X + off[0], y: Y + off[1], base: Y + T });
  });
  BUILDINGS.forEach(b => {
    c.fillStyle = 'rgba(10,8,30,.4)'; c.fillRect(b.x * T + 4, (b.y + b.h) * T - 3, b.w * T, 6);
    sortables.push({ img: b.sprite, x: b.x * T - 1, y: b.y * T - b.up - 1, base: (b.y + b.h) * T });
  });
  sortables.sort((a, b) => a.base - b.base);
  // shoreline tiles for animated foam
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) if (map[y][x] === SHALLOW) {
    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]].filter(([dx, dy]) => !isWater(x + dx, y + dy));
    if (dirs.length) shore.push({ x, y, dirs });
  }
}
const shore = [];

// ---------- characters ----------
// Chibi sprites from pixel templates. o outline, h hair, H hair shade, s skin, S skin shade, e eye,
// t shirt, T shirt shade, p pants, b boots, w white (eye shine), c cap
const BODY_FRONT = [
  '.....oooo.....',
  '...oohhhhoo...',
  '..ohhhhhhhho..',
  '.ohhhHhhhHhho.',
  '.ohhhhhhhhhho.',
  '.ohsssssssSho.',
  '.osswesswessSo',
  '.osseesseessSo',
  '..ossssssSSo..',
  '...oossssoo...',
  '..ottttttTto..',
  '.osttttttTtso.',
  '.osttttttTtso.',
  '..oTTTTTTTTo..',
  '..opppppppo...',
];
const BODY_BACK = [
  '.....oooo.....',
  '...oohhhhoo...',
  '..ohhhhhhhho..',
  '.ohhhHhhhHhho.',
  '.ohhhhhhhhhho.',
  '.ohhhhhhhhhho.',
  '.ohhhHhhhhhho.',
  '.oHhhhhhhhhHo.',
  '..oHHhhhhHHo..',
  '...oossssoo...',
  '..ottttttTto..',
  '.osttttttTtso.',
  '.osttttttTtso.',
  '..oTTTTTTTTo..',
  '..opppppppo...',
];
const BODY_SIDE = [
  '.....oooo.....',
  '...oohhhhoo...',
  '..ohhhhhhhho..',
  '.ohhhhhHhhhho.',
  '.ohhhhhhhhhho.',
  '.osssshhhhhho.',
  '.oswesshhhhho.',
  '.oseesshhhho..',
  '..ossssShho...',
  '...oossso.....',
  '...ottttTo....',
  '...otsttTo....',
  '...otsttTo....',
  '...oTTTTTo....',
  '...opppppo....',
];
const LEGS = {
  stand: ['...opo..opo...', '...opo..opo...', '...obo..obo...', '...ooo..ooo...'],
  walkA: ['...opo..opo...', '..opo...obo...', '..obo...ooo...', '..ooo.........'],
  walkB: ['...opo..opo...', '...obo...opo..', '...ooo...obo..', '.........ooo..'],
  sideStand: ['....opopo.....', '....opopo.....', '....obobo.....', '....ooooo.....'],
  sideA: ['....opo.po....', '...opo..opo...', '...obo..obo...', '...ooo..ooo...'],
  sideB: ['....oppo......', '....opo.......', '....obbo......', '....oooo......'],
};
const SKIN = ['#f6d0ae', '#e8b48c', '#c98a62', '#9a6240', '#6e4428'];
const HAIR = ['#2a1d14', '#5a3a22', '#e0b860', '#d84f3a', '#f3ecd6', '#4f8dff', '#b26bff', '#5fd38d', '#ff7ab0'];
const SHIRT = ['#ff6b35', '#4f8dff', '#5fd38d', '#b26bff', '#ffcc33', '#ff5d6c', '#4fd3d3', '#d39552'];
const PANTS = ['#3a3150', '#4a3a2a', '#23408f', '#2f5a3a', '#5a3a5a'];
const shade = (hex, f) => '#' + [1, 3, 5].map(i => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * f))).toString(16).padStart(2, '0')).join('');
function lookOf(addr) {
  const s = String(addr || '0x0').toLowerCase().replace(/^0x/, '');
  const n = i => parseInt(s.slice(i * 2, i * 2 + 2) || '0', 16) || 0;
  return { skin: SKIN[n(1) % SKIN.length], hair: HAIR[n(2) % HAIR.length], shirt: SHIRT[n(3) % SHIRT.length], pants: PANTS[n(4) % PANTS.length], cap: n(5) % 3 === 0 ? SHIRT[(n(6) + 3) % SHIRT.length] : null, key: s.slice(0, 12) };
}
const sheets = new Map();
// sheet: 4 directions x 3 frames, each 16x22
function sheetFor(L) {
  if (sheets.has(L.key)) return sheets.get(L.key);
  const FW = 16, FH = 22, cv = canvas(FW * 3, FH * 4), c = cv.getContext('2d');
  const col = { o: OUT, h: L.hair, H: shade(L.hair, .72), s: L.skin, S: shade(L.skin, .8), e: OUT, w: '#ffffff', t: L.shirt, T: shade(L.shirt, .75), p: L.pants, b: '#3a2a22' };
  const paint = (rows, ox, oy, flip) => rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== '.' && col[ch]) px(c, col[ch], ox + (flip ? 13 - x : x) + 1, oy + y); }));
  const dirs = [[BODY_FRONT, 'stand', 'walkA', 'walkB', false], [BODY_SIDE, 'sideStand', 'sideA', 'sideB', true], [BODY_SIDE, 'sideStand', 'sideA', 'sideB', false], [BODY_BACK, 'stand', 'walkA', 'walkB', false]];
  dirs.forEach(([body, s0, s1, s2, flip], d) => [s0, s1, s2].forEach((legs, f) => {
    const ox = f * FW, oy = d * FH, bob = f ? 1 : 0;
    paint(body, ox, oy + 2 + bob, flip); paint(LEGS[legs], ox, oy + 17, flip);
    if (L.cap) { const cc = L.cap; px(c, OUT, ox + 4, oy + bob, 8, 1); px(c, cc, ox + 4, oy + 1 + bob, 8, 2); px(c, shade(cc, .7), ox + 4, oy + 3 + bob, 8, 1); if (d !== 3) px(c, cc, ox + (flip ? 1 : d === 2 ? 10 : 3), oy + 3 + bob, d === 0 ? 10 : 5, 1); }
  }));
  sheets.set(L.key, cv);
  return cv;
}
function drawChar(c, p) {
  const sh = sheetFor(p.look), frame = p.anim ? 1 + (Math.floor(p.anim) % 2) : 0;
  c.fillStyle = 'rgba(10,8,30,.45)'; c.fillRect(Math.round(p.x) - 5, Math.round(p.y) - 1, 10, 3); c.fillRect(Math.round(p.x) - 4, Math.round(p.y) - 2, 8, 5);
  c.drawImage(sh, frame * 16, p.dir * 22, 16, 22, Math.round(p.x) - 8, Math.round(p.y) - 21, 16, 22);
}

// ---------- state ----------
const I = {
  mounted: false, canvas: null, ctx: null, light: null, lctx: null, scale: 2, vw: 0, vh: 0, cam: { x: 0, y: 0 },
  me: null, others: new Map(), socket: null, onEnter: null, keys: {}, raf: 0, last: 0,
  path: [], pending: null, lastSent: 0, sentKey: '', inside: null, cooldownDoor: null, flies: [],
};
const EMOTE_TEXT = { hi: 'HI!', gg: 'GG', wow: 'WOW', lol: 'LOL', fire: '!!', heart: '<3' };

// ---------- pathfinding ----------
function findPath(sx, sy, tx, ty) {
  const s = [Math.floor(sx / T), Math.floor(sy / T)];
  let g = [Math.floor(tx / T), Math.floor(ty / T)];
  if (g[0] < 0 || g[1] < 0 || g[0] >= MW || g[1] >= MH) return [];
  if (solid[g[1]][g[0]]) {
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
      if (dx && dy && (solid[cy][nx] || solid[ny][cx])) continue;
      const n = ny * MW + nx; if (prev[n] !== -2) continue; prev[n] = cur; q.push(n);
    }
  }
  if (prev[goal] === -2) return [];
  const out = [{ x: tx, y: ty }];
  for (let n = prev[goal]; n >= 0 && n !== q[0]; n = prev[n]) { const x = n % MW; out.unshift({ x: x * T + 8, y: (n - x) / MW * T + 10 }); }
  return out;
}

// ---------- update ----------
function moveMe(dt) {
  const me = I.me, k = I.keys; let vx = 0, vy = 0;
  if (k.ArrowLeft || k.a) vx -= 1; if (k.ArrowRight || k.d) vx += 1; if (k.ArrowUp || k.w) vy -= 1; if (k.ArrowDown || k.s) vy += 1;
  if (vx || vy) { I.path = []; I.pending = null; }
  else if (I.path.length) { const wp = I.path[0], dx = wp.x - me.x, dy = wp.y - me.y, d = Math.hypot(dx, dy); if (d < 2) I.path.shift(); else { vx = dx / d; vy = dy / d; } }
  const len = Math.hypot(vx, vy);
  me.moving = len > 0;
  if (me.moving) {
    vx /= len; vy /= len;
    const nx = me.x + vx * SPEED * dt, ny = me.y + vy * SPEED * dt;
    const foot = (x, y) => walkable(x - 4, y) && walkable(x + 4, y) && walkable(x - 4, y - 3) && walkable(x + 4, y - 3);
    if (foot(nx, me.y)) me.x = nx; if (foot(me.x, ny)) me.y = ny;
    me.dir = Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? 1 : 2) : (vy < 0 ? 3 : 0);
    me.anim += dt * 7;
  } else me.anim = 0;
  const at = BUILDINGS.find(b => Math.abs(me.x - b.door.x) < 10 && Math.abs(me.y - b.door.y) < 9);
  if (!at) I.cooldownDoor = null;
  else if (at.id !== I.cooldownDoor && (me.moving || I.pending === at.id)) { I.cooldownDoor = at.id; I.pending = null; I.path = []; enter(at); }
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

// ---------- render ----------
function waterFx(c, t, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (x < 0 || y < 0 || x >= MW || y >= MH || map[y][x] > SHALLOW) continue;
    const h = hash(x, y * 3), ph = t * 1.4 + h * 6.28;
    const wx = x * T + ((Math.floor(t * 4 + h * 16)) % T), wy = y * T + 4 + Math.floor(h * 8);
    if (Math.sin(ph) > .35) px(c, map[y][x] === DEEP ? P.deepHi : P.shallowHi, wx - 3, wy, 5, 1);
    if (Math.sin(ph * 1.3 + 2) > .8) px(c, '#9cc3f0', x * T + Math.floor(h * 12), y * T + 10, 2, 1);
  }
  // breaking foam along the shore
  for (const s of shore) {
    if (s.x < x0 - 1 || s.x > x1 + 1 || s.y < y0 - 1 || s.y > y1 + 1) continue;
    const X = s.x * T, Y = s.y * T, w = Math.sin(t * 2 + s.x * .7 + s.y * .4);
    const off = Math.round(2 + w * 2);
    for (const [dx, dy] of s.dirs) {
      for (let i = 0; i < T; i += 1) {
        if (hash(s.x * 5 + i, s.y) < .25) continue;
        if (dy === -1) px(c, P.foam, X + i, Y + off); if (dy === 1) px(c, P.foam, X + i, Y + T - 1 - off);
        if (dx === -1) px(c, P.foam, X + off, Y + i); if (dx === 1) px(c, P.foam, X + T - 1 - off, Y + i);
      }
    }
  }
}
// Draws the world (tiles, water, props, buildings, characters, lighting) into view V.
// V = { c, L, light, vw, vh, cx, cy, chars, flies, glowAt?, night? }
function renderWorld(now, V) {
  const { c, vw, vh, cx, cy, chars } = V, t = reduced ? 0 : now / 1000;
  c.fillStyle = P.deep; c.fillRect(0, 0, vw, vh);
  c.drawImage(ground, Math.max(0, cx), Math.max(0, cy), vw, vh, Math.max(0, -cx), Math.max(0, -cy), vw, vh);
  c.save(); c.translate(-cx, -cy);
  const x0 = Math.floor(cx / T) - 1, y0 = Math.floor(cy / T) - 1, x1 = x0 + Math.ceil(vw / T) + 2, y1 = y0 + Math.ceil(vh / T) + 2;
  waterFx(c, t, x0, y0, x1, y1);
  // depth-sorted scene: props, buildings, players
  const items = sortables.filter(s => s.x < cx + vw + 40 && s.x + s.img.width > cx - 40 && s.y < cy + vh + 40 && s.y + s.img.height > cy - 60);
  chars.forEach(p => items.push({ char: p, base: p.y }));
  items.sort((a, b) => a.base - b.base);
  for (const it of items) { if (it.char) drawChar(c, it.char); else c.drawImage(it.img, it.x, it.y); }
  // fountain water spray and forge smoke
  if (!reduced) {
    const fx = PLAZA_C.x * T - 1, fy = (PLAZA_C.y - 1) * T + 3;
    for (let i = 0; i < 10; i++) { const ph = (t * 1.6 + i / 10) % 1, ang = (i / 10) * Math.PI * 2; px(c, ph < .5 ? '#cfe6ff' : '#7fb0e8', fx + Math.round(Math.cos(ang) * ph * 9), fy - Math.round(Math.sin(ph * Math.PI) * 9) + Math.round(ph * 8), 1, 1); }
    const fb = BUILDINGS.find(b => b.id === 'forge');
    for (let i = 0; i < 7; i++) { const ph = (t * .35 + i / 7) % 1; const s = 2 + Math.floor(ph * 4); c.fillStyle = `rgba(120,110,140,${.6 * (1 - ph)})`; c.fillRect((fb.x + fb.w) * T - 16 + Math.round(Math.sin(t * .8 + i) * 6 * ph), fb.y * T - 44 - ph * 50, s, s); }
  }
  // fireflies
  const flies = V.flies;
  if (!reduced) {
    if (flies.length < 26) flies.push({ x: cx + Math.random() * vw, y: cy + Math.random() * vh, ph: Math.random() * 6, vx: (Math.random() - .5) * .3, vy: (Math.random() - .5) * .2 });
    flies.forEach(f => { f.ph += .05; f.x += f.vx + Math.sin(f.ph) * .15; f.y += f.vy + Math.cos(f.ph * .7) * .1; if (f.x < cx - 20 || f.x > cx + vw + 20 || f.y < cy - 20 || f.y > cy + vh + 20) { f.x = cx + Math.random() * vw; f.y = cy + Math.random() * vh; } });
  }
  c.restore();
  // night lighting: multiply by a light map, then add glows
  const L = V.L;
  L.globalCompositeOperation = 'source-over'; L.fillStyle = V.night || '#8487c4'; L.fillRect(0, 0, vw, vh);
  L.globalCompositeOperation = 'lighter';
  const glow = (x, y, r, col, a) => { const g = L.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${a})`); g.addColorStop(.55, `rgba(${col[0]},${col[1]},${col[2]},${a * .45})`); g.addColorStop(1, 'rgba(0,0,0,0)'); L.fillStyle = g; L.fillRect(x - r, y - r, r * 2, r * 2); };
  for (const l of lights) {
    const x = l.x - cx, y = l.y - cy; if (x < -l.r || y < -l.r || x > vw + l.r || y > vh + l.r) continue;
    const fl = l.flicker ? 1 - l.flicker + Math.sin(t * 13 + l.x) * l.flicker * .6 + Math.sin(t * 7.3 + l.y) * l.flicker * .4 : 1;
    glow(x, y, l.r * fl, l.c, .75);
  }
  if (V.glowAt) glow(V.glowAt.x - cx, V.glowAt.y - cy - 8, 40, [180, 170, 220], .35); // a little light around you
  if (!reduced) flies.forEach(f => { const x = f.x - cx, y = f.y - cy; if (Math.sin(f.ph * 2) > 0) glow(x, y, 7, [200, 255, 120], .5); });
  c.globalCompositeOperation = 'multiply'; c.drawImage(V.light, 0, 0);
  c.globalCompositeOperation = 'source-over';
  c.save(); c.translate(-cx, -cy);
  if (!reduced) flies.forEach(f => { if (Math.sin(f.ph * 2) > 0) px(c, '#e8ff9a', Math.round(f.x), Math.round(f.y)); });
  c.restore();
}
function drawSign(c, b) {
  const sx = b.door.x, sy = b.y * T - b.up + (b.board ? 14 : 6);
  const w = Math.round(c.measureText(b.label).width + 10);
  px(c, OUT, sx - w / 2 - 1, sy - 12, w + 2, 16); px(c, '#2a2240', sx - w / 2, sy - 11, w, 14); px(c, b.sign, sx - w / 2, sy + 2, w, 1);
  c.fillStyle = b.sign; c.fillText(b.label, sx, sy);
}
function render(now) {
  const c = I.ctx, vw = I.vw, vh = I.vh, me = I.me;
  const tx = Math.max(0, Math.min(WW - vw, me.x - vw / 2)), ty = Math.max(0, Math.min(WH - vh, me.y - vh / 2));
  I.cam.x += (tx - I.cam.x) * .15; I.cam.y += (ty - I.cam.y) * .15;
  if (WW < vw) I.cam.x = (WW - vw) / 2; if (WH < vh) I.cam.y = (WH - vh) / 2;
  const cx = Math.round(I.cam.x), cy = Math.round(I.cam.y);
  const chars = [];
  I.others.forEach(o => { o.x += (o.tx - o.x) * .2; o.y += (o.ty - o.y) * .2; o.anim = o.moving ? o.anim + .12 : 0; chars.push(o); });
  chars.push(me);
  renderWorld(now, { c, L: I.lctx, light: I.light, vw, vh, cx, cy, chars, flies: I.flies, glowAt: me });
  // signs, names and bubbles stay readable on top of the darkness
  c.save(); c.translate(-cx, -cy);
  c.font = '8px "Press Start 2P", monospace'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  BUILDINGS.forEach(b => {
    const sx = b.door.x, sy = b.y * T - b.up;
    if (sx < cx - 60 || sx > cx + vw + 60 || sy < cy - 30 || sy > cy + vh + 30) return;
    drawSign(c, b);
    if (Math.hypot(me.x - b.door.x, me.y - b.door.y) < 48 && (reduced || Math.floor(now / 350) % 2)) { // door hint arrow
      px(c, b.sign, b.door.x - 3, b.door.y - 10, 7, 1); px(c, b.sign, b.door.x - 2, b.door.y - 9, 5, 1); px(c, b.sign, b.door.x - 1, b.door.y - 8, 3, 1); px(c, b.sign, b.door.x, b.door.y - 7, 1, 1);
    }
  });
  for (const p of chars) {
    const name = p.nick, nw = Math.round(c.measureText(name).width);
    const nx = Math.round(p.x), ny = Math.round(p.y) - 26;
    px(c, 'rgba(20,15,35,.75)', nx - nw / 2 - 3, ny - 9, nw + 6, 11);
    c.fillStyle = p === me ? '#ffcc33' : '#f3ecd6'; c.fillText(name, nx, ny);
    const em = p === me ? (now - (I.myEmoteAt || 0) < 3000 ? I.myEmote : '') : p.emote;
    if (em) {
      const txt = EMOTE_TEXT[em] || em, bw = Math.round(c.measureText(txt).width + 10), by = ny - 26;
      px(c, OUT, nx - bw / 2 - 1, by - 1, bw + 2, 16); px(c, '#f4ecd8', nx - bw / 2, by, bw, 14); px(c, '#f4ecd8', nx - 1, by + 14, 3, 2); px(c, OUT, nx - 1, by + 16, 3, 1);
      c.fillStyle = '#1a1306'; c.fillText(txt, nx, by + 11);
    }
  }
  if (I.path.length && !reduced) { const g = I.path[I.path.length - 1], r = 3 + (Math.floor(now / 140) % 3); c.strokeStyle = '#ffcc33'; c.lineWidth = 1; c.strokeRect(Math.round(g.x - r) + .5, Math.round(g.y - r / 2) + .5, r * 2, r); }
  c.restore();
}

// ---------- backdrop: the island behind every other screen ----------
// The camera rests on the building you are in (it drifts a little), a few islanders stroll around,
// and a mood colours the light: 'volcano' for room 2, 'temple' for room 3.
const MOODS = {
  calm: { night: '#8487c4', wash: 'rgba(12,9,28,.3)' },
  volcano: { night: '#a86a6a', wash: 'rgba(40,8,8,.3)', embers: true },
  temple: { night: '#7c95c8', wash: 'rgba(8,16,40,.3)', sparks: true },
};
const BD = { canvas: null, ctx: null, light: null, lctx: null, focus: 'plaza', mood: 'calm', vw: 0, vh: 0, scale: 3, cam: null, flies: [], parts: [], npcs: [], raf: 0, last: 0, on: false };
function focusPoint(id) {
  const b = BUILDINGS.find(x => x.id === id);
  return b ? { x: b.door.x, y: b.door.y - b.h * T * .45 } : { x: PLAZA_C.x * T, y: PLAZA_C.y * T + 8 };
}
function bdResize() {
  if (!BD.canvas) return;
  const cssW = innerWidth, cssH = innerHeight;
  BD.scale = Math.max(2, Math.min(4, Math.round(Math.min(cssW / (T * 26), cssH / (T * 18)))));
  BD.vw = Math.ceil(cssW / BD.scale); BD.vh = Math.ceil(cssH / BD.scale);
  BD.canvas.width = BD.vw; BD.canvas.height = BD.vh; BD.light.width = BD.vw; BD.light.height = BD.vh;
  BD.ctx.imageSmoothingEnabled = false;
}
// a handful of islanders who wander between the buildings
const NPC_ADDR = ['0x7a31c9e2b4d8', '0x13f0aa51c7e9', '0xc84e2290f1b3', '0x5be71d03a9c6', '0x9d2c64f8e017', '0x2f8b3ea6c4d1'];
function npcTick(n, dt) {
  if (!n.path.length) {
    if ((n.wait -= dt) > 0) { n.moving = false; n.anim = 0; return; }
    const pick = Math.random() < .7 ? BUILDINGS[Math.floor(Math.random() * BUILDINGS.length)].door : { x: PLAZA_C.x * T + (Math.random() - .5) * 90, y: (PLAZA_C.y + 3) * T + (Math.random() - .5) * 30 };
    n.path = findPath(n.x, n.y, pick.x, pick.y + 10); n.wait = 1.5 + Math.random() * 4;
    if (!n.path.length) return;
  }
  const wp = n.path[0], dx = wp.x - n.x, dy = wp.y - n.y, d = Math.hypot(dx, dy);
  if (d < 2) { n.path.shift(); return; }
  const v = SPEED * .55 * dt; n.x += dx / d * Math.min(v, d); n.y += dy / d * Math.min(v, d);
  n.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 2) : (dy < 0 ? 3 : 0); n.moving = true; n.anim += dt * 6;
}
function bdLoop(now) {
  if (!BD.on) return;
  BD.raf = requestAnimationFrame(bdLoop);
  if (document.hidden || now - BD.last < 45) return; // ~22 fps is plenty for a backdrop
  const dt = Math.min(.1, (now - (BD.last || now)) / 1000); BD.last = now;
  const m = MOODS[BD.mood] || MOODS.calm, f = focusPoint(BD.focus), t = reduced ? 0 : now / 1000;
  const want = { x: f.x - BD.vw / 2 + Math.sin(t * .07) * 18, y: f.y - BD.vh * .42 + Math.cos(t * .05) * 10 };
  want.x = Math.max(0, Math.min(WW - BD.vw, want.x)); want.y = Math.max(0, Math.min(WH - BD.vh, want.y));
  if (WW < BD.vw) want.x = (WW - BD.vw) / 2; if (WH < BD.vh) want.y = (WH - BD.vh) / 2;
  if (!BD.cam) BD.cam = { ...want };
  BD.cam.x += (want.x - BD.cam.x) * .06; BD.cam.y += (want.y - BD.cam.y) * .06;
  if (!reduced) BD.npcs.forEach(n => npcTick(n, dt));
  const c = BD.ctx, cx = Math.round(BD.cam.x), cy = Math.round(BD.cam.y), vw = BD.vw, vh = BD.vh;
  renderWorld(now, { c, L: BD.lctx, light: BD.light, vw, vh, cx, cy, chars: BD.npcs, flies: BD.flies, night: m.night });
  c.save(); c.translate(-cx, -cy);
  c.font = '8px "Press Start 2P", monospace'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  const b = BUILDINGS.find(x => x.id === BD.focus); if (b) drawSign(c, b);
  c.restore();
  // mood particles in screen space
  if (!reduced) {
    const ps = BD.parts;
    if (m.embers && Math.random() < .6) ps.push({ k: 'e', x: Math.random() * vw, y: vh + 2, vx: (Math.random() - .5) * .4, vy: -(.4 + Math.random() * .8), life: 90 + Math.random() * 120 });
    if (m.sparks && Math.random() < .25) ps.push({ k: 's', x: Math.random() * vw, y: Math.random() * vh, life: 18 + Math.random() * 20, ph: 0 });
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i]; if (--p.life <= 0 || p.y < -4) { ps.splice(i, 1); continue; }
      if (p.k === 'e') { p.x += p.vx + Math.sin(p.life * .1) * .2; p.y += p.vy; px(c, p.life > 80 ? '#ffd166' : p.life > 30 ? '#ff6b35' : '#a8331b', p.x, p.y); }
      else { p.ph++; if (p.ph % 6 < 3) { px(c, '#ffe28a', p.x, p.y); if (p.ph % 12 < 3) { px(c, '#ffe28a', p.x - 1, p.y, 3, 1); px(c, '#ffe28a', p.x, p.y - 1, 1, 3); } } }
    }
  }
  // darken and vignette so panels on top stay easy to read
  c.fillStyle = m.wash; c.fillRect(0, 0, vw, vh);
  const g = c.createRadialGradient(vw / 2, vh * .45, Math.min(vw, vh) * .3, vw / 2, vh * .45, Math.max(vw, vh) * .75);
  g.addColorStop(0, 'rgba(8,6,18,0)'); g.addColorStop(1, 'rgba(8,6,18,.55)'); c.fillStyle = g; c.fillRect(0, 0, vw, vh);
}
function backdrop(focus, mood = 'calm') {
  if (!ground) buildStatic();
  if (!BD.canvas) {
    BD.canvas = document.createElement('canvas'); BD.canvas.className = 'island-backdrop'; BD.canvas.setAttribute('aria-hidden', 'true');
    BD.ctx = BD.canvas.getContext('2d'); BD.light = canvas(10, 10); BD.lctx = BD.light.getContext('2d');
    document.body.prepend(BD.canvas);
    addEventListener('resize', bdResize);
    BD.npcs = NPC_ADDR.map((a, i) => { const d = BUILDINGS[i % BUILDINGS.length].door; return { nick: '', x: d.x, y: d.y + 12, dir: 0, moving: false, anim: 0, look: lookOf(a), path: [], wait: Math.random() * 3 }; });
    bdResize();
  }
  if (BD.focus !== focus) { BD.focus = focus; }
  if (BD.mood !== mood) { BD.mood = mood; BD.parts = []; }
  BD.canvas.hidden = false;
  if (!BD.on) { BD.on = true; BD.last = 0; BD.raf = requestAnimationFrame(bdLoop); }
}
function backdropOff() { BD.on = false; cancelAnimationFrame(BD.raf); if (BD.canvas) BD.canvas.hidden = true; }

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
  const b = BUILDINGS.find(b => wx >= b.x * T && wx < (b.x + b.w) * T && wy >= b.y * T - b.up && wy < (b.y + b.h) * T + 4);
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
  const cssW = I.canvas.clientWidth || innerWidth, cssH = I.canvas.clientHeight || innerHeight;
  // show a big piece of the island: about 30 tiles across on a wide screen, the full width of a phone at 2x
  I.scale = I.zoom || Math.max(2, Math.min(4, Math.round(Math.min(cssW / (T * 30), cssH / (T * 20)))));
  I.vw = Math.ceil(cssW / I.scale); I.vh = Math.ceil(cssH / I.scale);
  I.canvas.width = I.vw; I.canvas.height = I.vh;
  I.light.width = I.vw; I.light.height = I.vh;
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
  BUILDINGS, lookOf, sheetFor, backdrop, backdropOff,
  backdropState: () => ({ on: BD.on, focus: BD.focus, mood: BD.mood, scale: BD.scale }),
  mount(container, { socket, me, onEnter, onCount }) {
    I.onEnter = onEnter; I.onCount = onCount; I.socket = socket;
    if (!ground) buildStatic();
    if (!I.canvas) {
      I.canvas = document.createElement('canvas'); I.canvas.className = 'island-canvas';
      I.canvas.setAttribute('aria-label', 'Flipfight Island. Tap somewhere to walk, walk into a building to enter it.');
      I.ctx = I.canvas.getContext('2d');
      I.light = canvas(10, 10); I.lctx = I.light.getContext('2d');
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
    requestAnimationFrame(resize); // the canvas may only get its final size after layout
  },
  unmount() {
    if (!I.mounted) return;
    I.mounted = false; cancelAnimationFrame(I.raf);
    if (I.me && !I.inside) { try { localStorage.setItem('ff-island-pos', JSON.stringify({ x: I.me.x, y: I.me.y })); } catch (e) {} }
    if (I.socket) I.socket.emit('island:leave');
    I.others.clear();
  },
  emote(e) { if (!I.mounted) return; I.myEmote = e; I.myEmoteAt = performance.now(); if (I.socket) I.socket.emit('island:emote', e); },
  goTo(id) { const b = BUILDINGS.find(x => x.id === id); if (b && I.mounted) { I.pending = b.id; I.cooldownDoor = null; I.path = findPath(I.me.x, I.me.y, b.door.x, b.door.y + 2); } },
  resize,
  zoom(n) { I.zoom = n || 0; resize(); },
  state: () => ({ me: I.me && { x: Math.round(I.me.x), y: Math.round(I.me.y), dir: I.me.dir }, others: [...I.others.values()].map(o => ({ nick: o.nick, x: Math.round(o.tx), y: Math.round(o.ty), emote: o.emote })), path: I.path.length, scale: I.scale, view: [I.vw, I.vh] }),
};
})();
