// ELO and leaderboard over the real server: three matches between the same two players, then a practice game.
// node scripts/elo-test.js http://localhost:3000 [previewKey]
const { Wallet } = require('ethers');
const { io } = require('socket.io-client');
const BASE = process.argv[2] || 'http://localhost:3000';
const KEY = process.argv[3];
const H = KEY ? { 'X-Preview-Key': KEY } : {};
const call = async (p, b, t) => { const r = await fetch(BASE + p, { method: b ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...H, ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); const d = await r.json(); if (!r.ok) throw new Error(p + ': ' + d.error); return d; };

async function player(tag, strong) {
  const w = Wallet.createRandom(); const { message } = await call('/api/nonce?address=' + w.address);
  const { token } = await call('/api/login', { address: w.address, signature: await w.signMessage(message) });
  const nick = tag + String(Date.now()).slice(-5);
  await call('/api/nickname', { nickname: nick }, token);
  const me = await call('/api/me', null, token);
  // strong player: highest-power legal Rookie deck; weak player: the five weakest cards
  const sorted = me.cards.slice().sort((a, b) => a.pow - b.pow);
  const deck = strong ? ['Ember Fox', 'Rock Tortoise', 'Lava Golem', 'Storm Eagle', 'Tide Crab'].map(n => me.cards.find(c => c.name === n).uid) : sorted.slice(0, 5).map(c => c.uid);
  for (const room of [0, 1]) await call('/api/deck', { roomId: room, uids: deck }, token);
  const socket = io(BASE, { auth: { token, preview: KEY } });
  await new Promise((ok, bad) => { socket.on('connect', ok); socket.on('connect_error', bad); });
  let last = 0;
  socket.on('match:state', st => {
    if (st.phase === 'pick' && st.you.pick === null && st.round !== last) {
      last = st.round;
      const left = st.you.hand.filter(c => !st.you.used.includes(c.uid)).sort((a, b) => b.pow - a.pow);
      socket.emit('match:pick', { matchId: st.matchId, uid: left[0].uid }, () => {});
    }
  });
  return { token, nick, socket, reset: () => { last = 0; } };
}
const elo = async p => (await call('/api/me', null, p.token)).profile;

(async () => {
  const A = await player('Strong', true), B = await player('Weak', false);
  console.log(`start: ${A.nick} ${(await elo(A)).elo} | ${B.nick} ${(await elo(B)).elo}`);
  for (let i = 1; i <= 3; i++) {
    A.reset(); B.reset();
    const ends = [A, B].map(p => new Promise(r => p.socket.once('match:end', r)));
    for (const p of [A, B]) { const r = await new Promise(ok => p.socket.emit('queue:join', { roomId: 1 }, ok)); if (!r.ok) throw new Error(r.error); }
    const [ra, rb] = await Promise.all(ends);
    const [pa, pb] = await Promise.all([elo(A), elo(B)]);
    console.log(`match ${i}: ${ra.out} ${ra.myWins}-${ra.oppWins} | ELO change ${A.nick} ${ra.eloDelta >= 0 ? '+' : ''}${ra.eloDelta}, ${B.nick} ${rb.eloDelta >= 0 ? '+' : ''}${rb.eloDelta} | now ${pa.elo} vs ${pb.elo} | record ${pa.wins}-${pa.losses}-${pa.draws} vs ${pb.wins}-${pb.losses}-${pb.draws}`);
  }
  const lb = await call('/api/leaderboard');
  const ia = lb.players.findIndex(p => p.nickname === A.nick), ib = lb.players.findIndex(p => p.nickname === B.nick);
  const sortedOk = lb.players.every((p, i) => i === 0 || lb.players[i - 1].elo >= p.elo);
  console.log(`leaderboard: ${lb.totalPlayers} players, sorted by ELO: ${sortedOk} | ${A.nick} rank #${ia + 1} | ${B.nick} rank #${ib + 1}`);
  const h = await call('/api/history', null, A.token);
  console.log('history rows for strong player:', h.matches.length, '| ELO per row:', h.matches.map(m => (m.eloDelta >= 0 ? '+' : '') + m.eloDelta).join(' '));
  const before = (await elo(B)).elo;
  A.socket.emit('practice:start', { level: 'easy' }, () => {}); // practice must not touch ELO
  const end = await new Promise(r => A.socket.once('match:end', r));
  console.log('practice game ->', end.out, '| ELO unchanged:', (await elo(A)).elo === (await call('/api/leaderboard')).players.find(p => p.nickname === A.nick).elo && end.eloDelta === 0, before === (await elo(B)).elo);
  process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
