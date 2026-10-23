// Island traffic check: N players walk around for a while; prints bytes each client received per second.
// Run with the server started:  node scripts/island-load.js http://localhost:3000 [previewKey] [players] [seconds] [walkers]
const { Wallet } = require('ethers');
const { io } = require('socket.io-client');
const BASE = process.argv[2] || 'http://localhost:3000', KEY = process.argv[3];
const N = Number(process.argv[4] || 20), SECS = Number(process.argv[5] || 15), WALKERS = Number(process.argv[6] || N);
const PREVIEW = KEY ? { 'X-Preview-Key': KEY } : {};
async function call(path, body, token) {
  const res = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...PREVIEW, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json(); if (!res.ok) throw new Error(path + ': ' + data.error); return data;
}
async function player(i, stamp) {
  const w = Wallet.createRandom();
  const { message } = await call('/api/nonce?address=' + w.address);
  const { token } = await call('/api/login', { address: w.address, signature: await w.signMessage(message) });
  await call('/api/nickname', { nickname: `Load${stamp}_${i}` }, token);
  const socket = io(BASE, { auth: { token, preview: KEY }, transports: ['websocket'] });
  await new Promise((ok, bad) => { socket.on('connect', ok); socket.on('connect_error', bad); });
  const p = { socket, bytes: 0, msgs: 0, seen: 0, x: 300 + Math.random() * 200, y: 250 + Math.random() * 150 };
  socket.io.engine.on('packet', pk => { if (typeof pk.data === 'string') { p.bytes += pk.data.length; p.msgs++; } });
  await new Promise(ok => socket.emit('island:enter', { x: p.x, y: p.y }, r => { p.seen = r.players.length; ok(); }));
  return p;
}
(async () => {
  const stamp = String(Date.now()).slice(-4);
  const ps = []; for (let i = 0; i < N; i += 20) ps.push(...await Promise.all(Array.from({ length: Math.min(20, N - i) }, (_, k) => player(i + k, stamp))));
  await new Promise(r => setTimeout(r, 500));
  ps.forEach(p => { p.bytes = 0; p.msgs = 0; });
  // optional: SERVER_PID=<pid> measures the server's CPU use during the window (same machine only)
  const fs = require('fs'), PID = process.env.SERVER_PID;
  const cpu = () => { if (!PID) return 0; const f = fs.readFileSync(`/proc/${PID}/stat`, 'utf8').split(') ')[1].split(' '); return (Number(f[11]) + Number(f[12])) / 100; };
  const rss = () => PID ? Math.round(Number(fs.readFileSync(`/proc/${PID}/statm`, 'utf8').split(' ')[1]) * 4096 / 1048576) : 0;
  const c0 = cpu();
  const t0 = Date.now();
  const timer = setInterval(() => ps.slice(0, WALKERS).forEach(p => { // the first WALKERS players keep walking
    p.x += (Math.random() - .5) * 20; p.y += (Math.random() - .5) * 20;
    p.socket.emit('island:move', { x: Math.round(p.x), y: Math.round(p.y), dir: 2, moving: true });
  }), 150);
  await new Promise(r => setTimeout(r, SECS * 1000));
  clearInterval(timer);
  const secs = (Date.now() - t0) / 1000, per = ps.reduce((a, p) => a + p.bytes, 0) / ps.length / secs;
  console.log(`${N} players, ${WALKERS} walking, for ${secs.toFixed(0)}s: each client received ${(per / 1024).toFixed(1)} KB/s (${(ps[0].msgs / secs).toFixed(1)} msgs/s); server total ${(per * N / 1024).toFixed(0)} KB/s = ${(per * N * 3600 / 1e9).toFixed(2)} GB per hour`);
  if (PID) console.log(`server CPU ${((cpu() - c0) / secs * 100).toFixed(0)}% of one core, memory ${rss()} MB`);
  ps.forEach(p => p.socket.close()); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
