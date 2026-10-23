// Flipfight atmosphere: chiptune music, animated world scenes and battle effects.
// Everything is generated in the browser (Web Audio + canvas); no asset files.
(function () {
'use strict';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

// =====================================================================
// AUDIO: one context, separate buses for music and sound effects
// =====================================================================
let AC = null, musicBus = null, sfxBus = null, noiseBuf = null;
function ac() {
  if (AC) return AC;
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    musicBus = AC.createGain(); musicBus.gain.value = 0; musicBus.connect(AC.destination);
    sfxBus = AC.createGain(); sfxBus.gain.value = 1; sfxBus.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { AC = null; }
  return AC;
}
function tone(bus, f, t, dur, { type = 'square', vol = .05, slide = 0, attack = .004, decay = null, vib = 0 } = {}) {
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.linearRampToValueAtTime(Math.max(30, f + slide), t + dur);
  if (vib) { const l = AC.createOscillator(), lg = AC.createGain(); l.frequency.value = vib; lg.gain.value = f * .012; l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + dur + .05); }
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(.0001, t + (decay || dur));
  o.connect(g).connect(bus); o.start(t); o.stop(t + Math.max(dur, decay || 0) + .03);
}
function noise(bus, t, dur, { vol = .05, hp = 0, lp = 0 } = {}) {
  const s = AC.createBufferSource(), g = AC.createGain(); s.buffer = noiseBuf;
  let node = s;
  if (hp) { const f = AC.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; node.connect(f); node = f; }
  if (lp) { const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f); node = f; }
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  node.connect(g).connect(bus); s.start(t, Math.random() * .5); s.stop(t + dur + .02);
}
const kick = (t, v = .5) => { const o = AC.createOscillator(), g = AC.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + .12); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.0001, t + .16); o.connect(g).connect(musicBus); o.start(t); o.stop(t + .18); };
const snare = (t, v = .18) => { noise(musicBus, t, .12, { vol: v, hp: 900 }); tone(musicBus, 190, t, .07, { type: 'triangle', vol: v * .7 }); };
const hat = (t, open, v = .045) => noise(musicBus, t, open ? .09 : .025, { vol: v, hp: 6000 });

// ---------- music ----------
const N = n => 440 * Math.pow(2, (n - 69) / 12); // midi -> Hz
// chords as midi roots + triad, four bars per loop
const TRACKS = {
  lobby: { bpm: 88, gain: .55, prog: [[57, 0, 3, 7], [53, 0, 4, 7], [48, 0, 4, 7], [55, 0, 4, 7]],
    lead: [76, 0, 74, 72, 0, 0, 71, 0, 72, 0, 0, 0, 74, 0, 0, 0, 77, 0, 76, 74, 0, 0, 72, 0, 71, 0, 0, 0, 0, 0, 0, 0,
           72, 0, 74, 76, 0, 0, 79, 0, 76, 0, 0, 0, 74, 0, 0, 0, 74, 0, 72, 71, 0, 0, 72, 0, 74, 0, 0, 0, 0, 0, 0, 0],
    step(i, t, d) {
      const [root, ...tri] = this.prog[Math.floor(i / 16) % 4], s = i % 16;
      if (s % 4 === 0) tone(musicBus, N(root - 12), t, d * 3.6, { type: 'triangle', vol: .13 });
      if (s % 2 === 0) tone(musicBus, N(root + 12 + tri[(s / 2) % 3]), t, d * 1.6, { type: 'square', vol: .022 });
      const l = this.lead[i % 64]; if (l) tone(musicBus, N(l), t, d * 3, { type: 'square', vol: .03, vib: 5, decay: d * 4 });
      if (s === 8) hat(t, true, .02);
    } },
  arena: { bpm: 140, gain: .5, prog: [[52, 0, 3, 7], [48, 0, 4, 7], [55, 0, 4, 7], [50, 0, 4, 7]],
    lead: [76, 0, 74, 76, 79, 0, 76, 74, 71, 0, 72, 74, 76, 0, 0, 0, 74, 0, 72, 74, 76, 0, 79, 81, 78, 0, 76, 74, 74, 0, 0, 0,
           79, 0, 78, 79, 83, 0, 79, 78, 76, 0, 74, 76, 79, 0, 0, 0, 81, 0, 79, 78, 76, 0, 74, 71, 74, 0, 76, 78, 79, 0, 0, 0],
    step(i, t, d) {
      const [root, ...tri] = this.prog[Math.floor(i / 16) % 4], s = i % 16;
      if (s % 2 === 0) tone(musicBus, N(root - 12 + (s % 4 ? 12 : 0)), t, d * 1.8, { type: 'square', vol: .045 });
      if (s % 4 === 0) kick(t, .42); if (s === 4 || s === 12) snare(t);
      if (s % 2 === 1) hat(t, s === 7 || s === 15);
      if (s % 4 === 3) tone(musicBus, N(root + 24 + tri[s % 3]), t, d, { type: 'square', vol: .016 });
      if (i >= 64) { const l = this.lead[i % 64]; if (l) tone(musicBus, N(l), t, d * 1.9, { type: 'square', vol: .03, vib: 6 }); }
    }, length: 128 },
  final: { bpm: 162, gain: .5, prog: [[50, 0, 3, 7], [46, 0, 4, 7], [43, 0, 3, 7], [45, 0, 4, 7]],
    step(i, t, d) {
      const [root, ...tri] = this.prog[Math.floor(i / 16) % 4], s = i % 16;
      tone(musicBus, N(root - 12 + (s % 2 ? 12 : 0)), t, d * .9, { type: 'square', vol: .04 });
      if (s % 4 === 0) kick(t, .5); if (s === 4 || s === 12) snare(t, .2); if (s === 14 || s === 15) snare(t, .1);
      hat(t, false, .03);
      if (s % 4 === 2) tone(musicBus, N(root + 24 + tri[(s / 2) % 3]), t, d * 1.5, { type: 'square', vol: .022 });
      if (s === 0) tone(musicBus, N(root + 12 + tri[2]), t, d * 7, { type: 'sawtooth', vol: .02, vib: 7, decay: d * 8 });
    } },
};
const M = { on: true, track: null, want: null, step: 0, next: 0, timer: null, unlocked: false };
try { M.on = localStorage.getItem('ff-music') !== '0'; } catch (e) {}
function schedule() {
  const tr = TRACKS[M.track]; if (!tr) return;
  const d = 60 / tr.bpm / 4;
  while (M.next < AC.currentTime + .15) {
    if (M.want !== M.track && M.step % 16 === 0) return switchNow(); // change track on a bar line
    try { tr.step(M.step, M.next, d); } catch (e) {}
    M.next += d; M.step = (M.step + 1) % (tr.length || 64);
  }
}
function switchNow() {
  const tr = TRACKS[M.want];
  M.track = M.want; M.step = 0; M.next = AC.currentTime + .05;
  if (tr) musicBus.gain.setTargetAtTime(M.on ? tr.gain * .32 : 0, AC.currentTime, .4);
}
function music(name) {
  M.want = name;
  if (!M.unlocked || !ac()) return;
  if (!M.timer) { M.timer = setInterval(schedule, 30); }
  if (!M.track) switchNow();
}
function setMusic(on) {
  M.on = on; try { localStorage.setItem('ff-music', on ? '1' : '0'); } catch (e) {}
  if (AC && musicBus) { const tr = TRACKS[M.track]; musicBus.gain.setTargetAtTime(on && tr ? tr.gain * .32 : 0, AC.currentTime, .2); }
}
// browsers only allow sound after the first tap
function unlock() {
  if (M.unlocked) return; M.unlocked = true;
  if (ac() && AC.state === 'suspended') AC.resume();
  if (M.want) music(M.want);
}
['pointerdown', 'keydown', 'touchstart'].forEach(ev => addEventListener(ev, unlock, { capture: true, passive: true }));
document.addEventListener('visibilitychange', () => { if (!AC) return; document.hidden ? AC.suspend() : AC.resume(); });

// ---------- sound effects (used by the game and by battle effects) ----------
const sfxOn = () => { try { return localStorage.getItem('ff-sfx') !== '0'; } catch (e) { return true; } };
function sfx(fn) { if (!sfxOn() || !ac()) return; try { fn(AC.currentTime); } catch (e) {} }
function beep(f, d = .08, type = 'square', v = .05, slide = 0, delay = 0) { sfx(t => tone(sfxBus, f, t + delay, d, { type, vol: v, slide })); }
const ELEMENT_SFX = {
  fire: t => { noise(sfxBus, t, .35, { vol: .16, lp: 1800 }); tone(sfxBus, 180, t, .3, { type: 'sawtooth', vol: .05, slide: -90 }); },
  water: t => { tone(sfxBus, 900, t, .18, { type: 'sine', vol: .14, slide: -620 }); tone(sfxBus, 1300, t + .08, .14, { type: 'sine', vol: .08, slide: -800 }); },
  wind: t => { noise(sfxBus, t, .45, { vol: .12, hp: 2500 }); tone(sfxBus, 520, t, .4, { type: 'triangle', vol: .04, slide: 700 }); },
  earth: t => { tone(sfxBus, 90, t, .3, { type: 'square', vol: .12, slide: -40 }); noise(sfxBus, t, .25, { vol: .14, lp: 500 }); },
};
const impactSfx = (power, el) => sfx(t => {
  const v = Math.min(1, .45 + power / 160);
  tone(sfxBus, 120, t, .18, { type: 'square', vol: .16 * v, slide: -70 }); noise(sfxBus, t, .2, { vol: .2 * v, lp: 2600 });
  if (el && ELEMENT_SFX[el]) ELEMENT_SFX[el](t + .03);
});
const shatterSfx = () => sfx(t => { for (let i = 0; i < 6; i++) tone(sfxBus, rnd(700, 1600), t + i * .035, .06, { type: 'square', vol: .03 }); noise(sfxBus, t, .3, { vol: .06, hp: 3000 }); });

// ---------- ambient loops for some screens ----------
let ambT = null;
function ambient(kind) {
  clearInterval(ambT); ambT = null;
  if (kind === 'forge') ambT = setInterval(() => { if (!document.hidden && M.on) sfx(t => { for (let i = 0; i < 3; i++) noise(sfxBus, t + rnd(0, .3), rnd(.01, .04), { vol: rnd(.015, .04), hp: 1500 }); }); }, 260);
  if (kind === 'market') ambT = setInterval(() => { if (!document.hidden && M.on && Math.random() < .35) sfx(t => { tone(sfxBus, pick([1568, 1760, 2093]), t, .12, { type: 'sine', vol: .018 }); tone(sfxBus, 2637, t + .07, .1, { type: 'sine', vol: .012 }); }); }, 2600);
}

// =====================================================================
// WORLD SCENES: animated pixel backgrounds
// =====================================================================
const P = 4; // one scene pixel = 4 screen pixels
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
const SCENES = {
  night: { sky: ['#0c0a1a', '#120e26', '#1a1233', '#251640', '#34194a', '#4a1f50'], ridges: ['#1f1538', '#150f28'], moon: true, stars: 1 },
  meadow: { sky: ['#1b1440', '#3b1f5c', '#7a3b6e', '#c4606a', '#f0935a', '#f7c06b'], ridges: ['#3b5b3a', '#24402c', '#162a1f'], sun: true, stars: .25, trees: true },
  volcano: { sky: ['#0b0507', '#1c0a0d', '#3a1012', '#5e1712', '#8a2a12', '#b8481a'], ridges: ['#2a0f10', '#160709'], volcano: true, stars: .05 },
  temple: { sky: ['#071026', '#0b1b3d', '#12305c', '#1d4a7a', '#2f6a96', '#5a93b5'], ridges: [], islands: true, stars: .7, clouds: true },
};
const W = { canvas: null, ctx: null, name: 'night', base: null, w: 0, h: 0, parts: [], t: 0, timer: null, stars: [] };
function band(ctx, w, h, cols, y0 = 0, y1 = h) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data, c = cols.map(hex);
  for (let y = y0; y < y1; y++) {
    const tt = (y - y0) / (y1 - y0) * (c.length - 1), i = Math.floor(tt), f = tt - i;
    for (let x = 0; x < w; x++) { const k = (y * w + x) * 4, col = f * 16 > BAYER[y % 4][x % 4] ? c[Math.min(i + 1, c.length - 1)] : c[i]; d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = 255; }
  }
  ctx.putImageData(img, 0, 0);
}
function seeded(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
function ridge(ctx, w, h, col, base, amp, freq, ph) {
  ctx.fillStyle = col;
  for (let x = 0; x < w; x++) { const y = Math.floor(base - (Math.sin(x * freq + ph) * amp + Math.sin(x * freq * 2.7 + ph * 2) * amp * .45 + Math.sin(x * freq * 7.1) * amp * .12)); ctx.fillRect(x, y, 1, h - y); }
}
function paintBase() {
  const sc = SCENES[W.name], w = W.w, h = W.h;
  const off = document.createElement('canvas'); off.width = w; off.height = h;
  const c = off.getContext('2d');
  band(c, w, h, sc.sky);
  const r = seeded(77);
  W.stars = [];
  const nStars = Math.floor(w * h / 140 * sc.stars);
  for (let i = 0; i < nStars; i++) { const x = Math.floor(r() * w), y = Math.floor(r() * h * .6), big = r() < .15; W.stars.push([x, y]); c.fillStyle = big ? '#ffffff' : '#8f86c2'; c.fillRect(x, y, 1, 1); }
  if (sc.moon || sc.sun) {
    const mx = Math.floor(w * .8), my = Math.floor(h * (sc.sun ? .55 : .14)), mr = Math.max(5, Math.floor(Math.min(w, h) * (sc.sun ? .09 : .05)));
    for (let y = -mr; y <= mr; y++) for (let x = -mr; x <= mr; x++) if (x * x + y * y <= mr * mr) {
      c.fillStyle = sc.sun ? ((y > mr * .3 && (y + mr) % 3 === 0) ? '#f7c06b' : '#ffe2a0') : ((x + mr * .4) ** 2 + (y - mr * .3) ** 2 < (mr * .35) ** 2 ? '#d9cfa6' : '#f3ecd6');
      c.fillRect(mx + x, my + y, 1, 1);
    }
  }
  if (sc.volcano) {
    const vx = Math.floor(w * .62), top = Math.floor(h * .42), base = Math.floor(h * .9);
    for (let y = top; y < h; y++) { const half = Math.floor((y - top) * .9) + 6; c.fillStyle = '#1f0a0b'; c.fillRect(vx - half, y, half * 2, 1); }
    c.fillStyle = '#ff6b35'; c.fillRect(vx - 6, top, 12, 2); c.fillStyle = '#ffd166'; c.fillRect(vx - 3, top, 6, 1);
    for (let i = 0; i < 3; i++) { let x = vx + (i - 1) * 3; for (let y = top + 2; y < base; y++) { x += Math.round(rnd(-1, 1) * .6); c.fillStyle = y % 5 ? '#c4401a' : '#ff8a3a'; c.fillRect(x, y, 1, 1); } }
    W.crater = [vx, top];
  }
  sc.ridges.forEach((col, i) => ridge(c, w, h, col, h * (.78 + i * .07), h * (.08 - i * .015), .03 + i * .025, 1.7 + i * 3.1));
  if (sc.trees) {
    const tr = seeded(9);
    for (let i = 0; i < 9; i++) {
      const x = Math.floor(tr() * w), base = Math.floor(h * (.86 + tr() * .06)), ht = 6 + Math.floor(tr() * 6);
      c.fillStyle = '#10201a'; c.fillRect(x, base - ht, 1, ht);
      for (let k = 0; k < ht - 2; k++) { const half = Math.max(1, Math.floor((ht - k) / 3)); c.fillRect(x - half, base - ht + k, half * 2 + 1, 1); }
    }
  }
  if (sc.islands) {
    const ir = seeded(5);
    [[.18, .48, 22], [.72, .36, 30], [.48, .7, 18]].forEach(([fx, fy, sz]) => {
      const x = Math.floor(w * fx), y = Math.floor(h * fy);
      c.fillStyle = '#3d4a7a'; for (let k = 0; k < sz / 2; k++) c.fillRect(x - sz / 2 + k, y + k, sz - k * 2, 1);
      c.fillStyle = '#5b6aa0'; c.fillRect(x - sz / 2, y - 1, sz, 2);
      c.fillStyle = '#d8d0b0'; for (let p = -sz / 3; p <= sz / 3; p += sz / 3) { c.fillRect(Math.floor(x + p), y - 9, 2, 8); }
      c.fillRect(x - sz / 3 - 1, y - 10, Math.floor(sz * .66) + 4, 1);
      c.fillStyle = '#ffcc33'; c.fillRect(x, y - 13, 1, 2); if (ir() < 2) c.fillRect(x - 1, y - 12, 3, 1);
    });
  }
  W.base = c.getImageData(0, 0, w, h);
}
function spawn(kind) {
  const w = W.w, h = W.h;
  if (kind === 'shoot') return { k: kind, x: rnd(w * .1, w * .9), y: rnd(2, h * .3), vx: rnd(-3.2, -2), vy: rnd(.7, 1.2), life: 18 };
  if (kind === 'firefly') return { k: kind, x: rnd(0, w), y: rnd(h * .55, h * .95), vx: rnd(-.25, .25), vy: rnd(-.15, .15), ph: rnd(0, 6), life: rnd(160, 400) };
  if (kind === 'ember') { const [cx, cy] = W.crater || [w / 2, h / 2]; return { k: kind, x: cx + rnd(-6, 6), y: cy, vx: rnd(-.4, .4), vy: rnd(-1.2, -.5), life: rnd(40, 90) }; }
  if (kind === 'ash') return { k: kind, x: rnd(0, w), y: -2, vx: rnd(-.15, .15), vy: rnd(.2, .45), life: 400 };
  if (kind === 'cloud') return { k: kind, x: -30, y: rnd(h * .05, h * .6), vx: rnd(.12, .3), w: Math.floor(rnd(14, 34)), life: 4000 };
  if (kind === 'spark') return { k: kind, x: rnd(0, w), y: rnd(0, h * .7), life: rnd(10, 24), ph: 0 };
}
function stepWorld() {
  if (!W.base) return;
  const sc = SCENES[W.name], ctx = W.ctx, w = W.w, h = W.h, ps = W.parts;
  W.t++;
  ctx.putImageData(W.base, 0, 0);
  // twinkle
  for (let i = 0; i < 6 && W.stars.length; i++) { const s = W.stars[(W.t * 7 + i * 131) % W.stars.length]; ctx.fillStyle = (W.t + i) % 3 ? '#ffcc33' : '#ffffff'; ctx.fillRect(s[0], s[1], 1, 1); }
  // spawn by scene
  if (W.name === 'night' && Math.random() < .012) ps.push(spawn('shoot'));
  if (W.name === 'meadow' && ps.filter(p => p.k === 'firefly').length < 26) ps.push(spawn('firefly'));
  if (W.name === 'volcano') { if (Math.random() < .5) ps.push(spawn('ember')); if (ps.filter(p => p.k === 'ash').length < 50) ps.push(spawn('ash')); }
  if (W.name === 'temple') { if (ps.filter(p => p.k === 'cloud').length < 6 && Math.random() < .02) ps.push(spawn('cloud')); if (Math.random() < .15) ps.push(spawn('spark')); }
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i]; p.life--;
    if (p.life <= 0 || p.x < -40 || p.x > w + 40 || p.y > h + 4) { ps.splice(i, 1); continue; }
    if (p.k === 'shoot') { p.x += p.vx; p.y += p.vy; for (let k = 0; k < 6; k++) { ctx.fillStyle = k ? (k < 3 ? '#f3ecd6' : '#8f86c2') : '#ffffff'; ctx.fillRect(Math.round(p.x - p.vx * k * .6), Math.round(p.y - p.vy * k * .6), 1, 1); } }
    else if (p.k === 'firefly') { p.ph += .12; p.x += p.vx + Math.sin(p.ph * .7) * .15; p.y += p.vy + Math.cos(p.ph * .5) * .1; if (Math.sin(p.ph) > -.2) { ctx.fillStyle = Math.sin(p.ph) > .6 ? '#fbff9a' : '#b8e05a'; ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1); } }
    else if (p.k === 'ember') { p.x += p.vx + rnd(-.2, .2); p.y += p.vy; p.vy += .008; ctx.fillStyle = p.life > 50 ? '#ffd166' : p.life > 25 ? '#ff6b35' : '#a8331b'; ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1); }
    else if (p.k === 'ash') { p.x += p.vx + Math.sin((W.t + i) * .05) * .1; p.y += p.vy; ctx.fillStyle = '#5a4a48'; ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1); }
    else if (p.k === 'cloud') { p.x += p.vx; ctx.fillStyle = 'rgba(214,226,240,.55)'; ctx.fillRect(Math.round(p.x), Math.round(p.y), p.w, 2); ctx.fillRect(Math.round(p.x + p.w * .2), Math.round(p.y - 2), Math.floor(p.w * .5), 2); ctx.fillStyle = 'rgba(214,226,240,.3)'; ctx.fillRect(Math.round(p.x + 2), Math.round(p.y + 2), p.w - 4, 1); }
    else if (p.k === 'spark') { p.ph++; const on = p.ph % 6 < 3; if (on) { ctx.fillStyle = '#ffe28a'; const x = Math.round(p.x), y = Math.round(p.y); ctx.fillRect(x, y, 1, 1); if (p.ph % 12 < 3) { ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3); } } }
  }
}
function resizeWorld() {
  W.w = Math.ceil(innerWidth / P); W.h = Math.ceil(innerHeight / P);
  W.canvas.width = W.w; W.canvas.height = W.h; W.parts = [];
  paintBase(); stepWorld();
}
function scene(name) {
  if (!SCENES[name] || !W.canvas) return;
  if (W.name === name && W.base) return;
  W.name = name; W.parts = [];
  W.canvas.classList.remove('scene-in'); void W.canvas.offsetWidth; W.canvas.classList.add('scene-in');
  paintBase(); stepWorld();
}
function initWorld() {
  W.canvas = document.getElementById('bg'); if (!W.canvas) return;
  W.ctx = W.canvas.getContext('2d');
  resizeWorld();
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(resizeWorld, 150); });
  if (!reduced) W.timer = setInterval(() => { if (!document.hidden) stepWorld(); }, 70);
}

// ---------- creatures blink and breathe ----------
function blinkSome() {
  if (document.hidden || reduced) return;
  const arts = [...document.querySelectorAll('canvas.art[data-ey]')].filter(c => c.offsetParent);
  for (let n = 0; n < 3 && arts.length; n++) {
    const cv = arts.splice(Math.floor(Math.random() * arts.length), 1)[0];
    const ctx = cv.getContext('2d'), ey = +cv.dataset.ey;
    const saved = ctx.getImageData(0, ey, 12, 2);
    ctx.fillStyle = cv.dataset.main; [4, 7].forEach(x => ctx.fillRect(x, ey, 1, 2));
    ctx.fillStyle = '#0b0916'; [4, 7].forEach(x => ctx.fillRect(x, ey + 1, 1, 1));
    setTimeout(() => ctx.putImageData(saved, 0, ey), 140);
  }
}

// =====================================================================
// BATTLE EFFECTS
// =====================================================================
const B = { canvas: null, ctx: null, board: null, scale: 3, parts: [], sprites: [], texts: [], raf: 0, freezeUntil: 0 };
const EL_PART = {
  fire: ['#ffd166', '#ff6b35', '#a8331b'], water: ['#a9d1ff', '#4f8dff', '#23408f'],
  wind: ['#ffffff', '#8fe3ff', '#3e8fb0'], earth: ['#f1d29a', '#d39552', '#7a4a22'],
};
function ensureCanvas(board) {
  if (B.board !== board) {
    B.board = board;
    B.canvas = document.createElement('canvas'); B.canvas.className = 'fx-canvas'; B.canvas.setAttribute('aria-hidden', 'true');
    board.appendChild(B.canvas); B.ctx = B.canvas.getContext('2d');
  }
  const r = board.getBoundingClientRect();
  B.canvas.width = Math.ceil(r.width / B.scale); B.canvas.height = Math.ceil(r.height / B.scale);
}
function local(el) {
  const b = B.board.getBoundingClientRect(), r = el.getBoundingClientRect();
  return { x: (r.left + r.width / 2 - b.left) / B.scale, y: (r.top + r.height / 2 - b.top) / B.scale, w: r.width / B.scale };
}
function burst(x, y, el, n, speed) {
  const cols = EL_PART[el] || EL_PART.fire;
  for (let i = 0; i < n; i++) {
    const a = rnd(0, Math.PI * 2), v = rnd(.4, 1) * speed;
    const p = { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, col: pick(cols), life: rnd(18, 40), g: .06, size: Math.random() < .25 ? 2 : 1 };
    if (el === 'fire') { p.vy -= rnd(.5, 1.4); p.g = -.03; }
    if (el === 'water') { p.vy -= rnd(.8, 1.6); p.g = .12; }
    if (el === 'wind') { p.spin = rnd(.12, .22) * (Math.random() < .5 ? -1 : 1); p.r = rnd(2, 10); p.a = a; p.cx = x; p.cy = y; p.g = 0; }
    if (el === 'earth') { p.g = .16; p.size = Math.random() < .5 ? 2 : 1; }
    B.parts.push(p);
  }
}
function shatter(sp) {
  // turn every pixel of the creature into a flying particle
  const src = sp.img.getContext('2d').getImageData(0, 0, 12, 12).data, s = sp.s;
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
    const k = (y * 12 + x) * 4; if (src[k + 3] < 10) continue;
    B.parts.push({ x: sp.x + (x - 6) * s, y: sp.y + (y - 6) * s, vx: (x - 6) * rnd(.05, .18) + sp.dir * rnd(.2, .9), vy: rnd(-1.6, -.2), g: .09,
      col: `rgb(${src[k]},${src[k + 1]},${src[k + 2]})`, life: rnd(26, 50), size: Math.max(1, Math.round(s)) });
  }
  sp.dead = true;
}
function floatText(x, y, text, color, big) { B.texts.push({ x, y, text, color, life: 52, big }); }
function frame(now) {
  B.raf = 0;
  const ctx = B.ctx, w = B.canvas.width, h = B.canvas.height;
  ctx.clearRect(0, 0, w, h);
  const frozen = now < B.freezeUntil;
  // sprites
  for (const sp of B.sprites) {
    if (sp.dead) continue;
    if (!frozen && sp.path) {
      const k = Math.min(1, (now - sp.t0) / sp.dur), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      sp.x = sp.from.x + (sp.to.x - sp.from.x) * e; sp.y = sp.from.y + (sp.to.y - sp.from.y) * e - Math.sin(k * Math.PI) * (sp.hop || 0);
      sp.s = sp.s0 + (sp.s1 - sp.s0) * e;
      if (k >= 1) { sp.path = false; if (sp.onDone) { const f = sp.onDone; sp.onDone = null; f(); } }
    }
    const size = 12 * sp.s;
    ctx.save(); ctx.imageSmoothingEnabled = false;
    if (sp.flash && now < sp.flash) ctx.filter = 'brightness(3)';
    if (sp.dir < 0) { ctx.translate(Math.round(sp.x), 0); ctx.scale(-1, 1); ctx.drawImage(sp.img, Math.round(-size / 2), Math.round(sp.y - size / 2), size, size); }
    else ctx.drawImage(sp.img, Math.round(sp.x - size / 2), Math.round(sp.y - size / 2), size, size);
    ctx.restore();
  }
  // particles
  for (let i = B.parts.length - 1; i >= 0; i--) {
    const p = B.parts[i];
    if (!frozen) {
      p.life--;
      if (p.spin) { p.a += p.spin; p.r += .35; p.x = p.cx + Math.cos(p.a) * p.r; p.y = p.cy + Math.sin(p.a) * p.r * .6; }
      else { p.x += p.vx; p.y += p.vy; p.vy += p.g; p.vx *= .98; }
    }
    if (p.life <= 0 || p.y > h + 4) { B.parts.splice(i, 1); continue; }
    ctx.globalAlpha = Math.min(1, p.life / 12); ctx.fillStyle = p.col; ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
  }
  ctx.globalAlpha = 1;
  // floating texts
  for (let i = B.texts.length - 1; i >= 0; i--) {
    const t = B.texts[i]; if (!frozen) { t.life--; t.y -= .35; }
    if (t.life <= 0) { B.texts.splice(i, 1); continue; }
    ctx.globalAlpha = Math.min(1, t.life / 12);
    ctx.font = `${t.big ? 8 : 6}px "Press Start 2P", monospace`; ctx.textAlign = 'center';
    ctx.fillStyle = '#0b0916'; ctx.fillText(t.text, Math.round(t.x) + 1, Math.round(t.y) + 1);
    ctx.fillStyle = t.color; ctx.fillText(t.text, Math.round(t.x), Math.round(t.y));
  }
  ctx.globalAlpha = 1;
  if (B.parts.length || B.texts.length || B.sprites.some(s => !s.dead && (s.path || s.hold > now))) B.raf = requestAnimationFrame(frame);
}
const kickFrame = () => { if (!B.raf) B.raf = requestAnimationFrame(frame); };
function shake(power) {
  if (reduced || !B.board) return;
  B.board.style.setProperty('--shake', Math.min(6, 1.5 + power / 25).toFixed(1) + 'px');
  B.board.classList.remove('shake'); void B.board.offsetWidth; B.board.classList.add('shake');
}
function spriteFrom(cardEl, dir) {
  const art = cardEl && cardEl.querySelector('canvas.art');
  const img = document.createElement('canvas'); img.width = 12; img.height = 12;
  if (art) img.getContext('2d').drawImage(art, 0, 0);
  const p = local(art || cardEl);
  return { img, x: p.x, y: p.y, s: p.w / 12, s0: p.w / 12, s1: p.w / 12, dir, dead: false };
}
// r: { myCard, oppCard (elements), mine, theirs (card data), result 'win'|'loss'|'tie', myPower, theirPower, myBonus, theirBonus, myExhausted, theirExhausted }
function battle(board, r) {
  if (reduced) { impactSfx(Math.max(r.myPower, r.theirPower), r.result === 'win' ? r.mine.el : r.result === 'loss' ? r.theirs.el : null); return; }
  ensureCanvas(board);
  B.parts = []; B.texts = []; B.sprites = [];
  let me, op, mid, gap, big;
  const go = (sp, to, dur, extra) => Object.assign(sp, { path: true, t0: performance.now(), dur, from: { x: sp.x, y: sp.y }, to, s0: sp.s, s1: extra && extra.s || sp.s, hop: extra && extra.hop || 0 }, extra && extra.cb ? { onDone: extra.cb } : {});
  setTimeout(() => {
    // measured after the card flip finishes, so positions and sizes are final
    if (!B.board.isConnected) return;
    ensureCanvas(board);
    me = spriteFrom(r.myCard, -1); op = spriteFrom(r.oppCard, 1); // opponent on the left faces right; mine faces left
    B.sprites.push(op, me);
    mid = { x: (me.x + op.x) / 2, y: (me.y + op.y) / 2 };
    gap = Math.max(10, me.s * 7);
    big = Math.max(me.s * 1.15, 3.2);
    // both creatures leap out of their cards towards the middle
    go(op, { x: mid.x - gap, y: mid.y }, 300, { s: big, hop: 10 });
    go(me, { x: mid.x + gap, y: mid.y }, 300, { s: big, hop: 10, cb: impact });
    kickFrame();
  }, 400);
  function impact() {
    const now = performance.now();
    const winner = r.result === 'win' ? me : r.result === 'loss' ? op : null, loser = winner === me ? op : winner === op ? me : null;
    const wEl = winner === me ? r.mine.el : winner === op ? r.theirs.el : null;
    B.freezeUntil = now + 110; // hit-stop
    [me, op].forEach(s => (s.flash = now + 90));
    shake(Math.abs(r.myPower - r.theirPower) + Math.max(r.myPower, r.theirPower) / 3);
    impactSfx(Math.max(r.myPower, r.theirPower), wEl);
    if (winner) burst(mid.x, mid.y, wEl, 46, 2.2); else { burst(mid.x, mid.y, r.mine.el, 22, 1.6); burst(mid.x, mid.y, r.theirs.el, 22, 1.6); }
    floatText(op.x, op.y - op.s * 6.5, String(r.theirPower), r.result === 'loss' ? '#5fd38d' : '#f3ecd6', true);
    floatText(me.x, me.y - me.s * 6.5, String(r.myPower), r.result === 'win' ? '#5fd38d' : '#f3ecd6', true);
    if (r.myBonus) floatText(me.x, me.y + me.s * 9, 'SUPER EFFECTIVE!', EL_PART[r.mine.el][0]);
    if (r.theirBonus) floatText(op.x, op.y + op.s * 9, 'SUPER EFFECTIVE!', EL_PART[r.theirs.el][0]);
    if (r.myExhausted) floatText(me.x, me.y + me.s * 13, 'EXHAUSTED', '#9d96c6');
    if (r.theirExhausted) floatText(op.x, op.y + op.s * 13, 'EXHAUSTED', '#9d96c6');
    setTimeout(() => {
      if (winner) {
        // winner pushes through, loser shatters
        go(winner, { x: loser.x, y: loser.y }, 160, { cb: () => go(winner, { x: winner === me ? mid.x + gap : mid.x - gap, y: mid.y }, 260, { hop: 4 }) });
        setTimeout(() => { shatter(loser); shatterSfx(); burst(loser.x, loser.y, wEl, 18, 1.4); kickFrame(); }, 90);
      } else {
        go(me, { x: me.x + gap * .8, y: me.y }, 260, { hop: 6 }); go(op, { x: op.x - gap * .8, y: op.y }, 260, { hop: 6 });
        floatText(mid.x, mid.y - big * 10, 'CLASH!', '#ffcc33', true);
      }
      kickFrame();
    }, 120);
    // creatures fade back after the round
    setTimeout(() => { B.sprites.forEach(s => { if (!s.dead) shatterSoft(s); }); kickFrame(); }, 1500);
    kickFrame();
  }
}
function shatterSoft(sp) {
  const src = sp.img.getContext('2d').getImageData(0, 0, 12, 12).data, s = sp.s;
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) { const k = (y * 12 + x) * 4; if (src[k + 3] < 10 || Math.random() < .5) continue; B.parts.push({ x: sp.x + (x - 6) * s, y: sp.y + (y - 6) * s, vx: 0, vy: rnd(-.6, -.2), g: -.01, col: `rgb(${src[k]},${src[k + 1]},${src[k + 2]})`, life: rnd(12, 26), size: 1 }); }
  sp.dead = true;
}
function clearBattle() { B.parts = []; B.texts = []; B.sprites = []; if (B.ctx) B.ctx.clearRect(0, 0, B.canvas.width, B.canvas.height); }

// ---------- round banners ----------
function banner(board, text, color, sub) {
  const el = document.createElement('div'); el.className = 'fx-banner'; el.style.setProperty('--c', color || '#ffcc33');
  el.innerHTML = `<b>${text}</b>${sub ? `<span>${sub}</span>` : ''}`;
  board.appendChild(el);
  setTimeout(() => el.remove(), reduced ? 900 : 1500);
}

window.FX = { state: () => ({ track: M.track, want: M.want, musicOn: M.on, audio: AC ? AC.state : 'none', scene: W.name, particles: W.parts.length }), music, setMusic, musicOn: () => M.on, ambient, scene, battle, clearBattle, banner, beep, sfx: { impact: impactSfx, shatter: shatterSfx },
  init() { initWorld(); setInterval(blinkSome, 1700); } };
})();
