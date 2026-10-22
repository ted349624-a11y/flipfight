// End-to-end check: two wallets sign in, pick nicknames, open a free pack and play a full match.
// Run with the server already started:  node scripts/smoke-test.js http://localhost:3000
const { Wallet } = require('ethers');
const { io } = require('socket.io-client');
const BASE = process.argv[2] || 'http://localhost:3000';

async function call(path, body, token) {
  const res = await fetch(BASE + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(path + ': ' + data.error);
  return data;
}

async function player(name) {
  const w = Wallet.createRandom();
  const { message } = await call('/api/nonce?address=' + w.address);
  const signature = await w.signMessage(message);
  const { token, profile } = await call('/api/login', { address: w.address, signature });
  await call('/api/nickname', { nickname: name }, token);
  const me = await call('/api/me', null, token);
  console.log(`${name}: balance ${profile.balance}, free packs ${profile.freePacks}, cards ${me.cards.length}`);
  const pack = await call('/api/pack', { packId: 'premium', useFree: true }, token);
  console.log(`${name}: free pack pulled ${pack.pulled.map(c => c.name + ' (' + c.rar + ')').join(', ')}; free packs left ${pack.profile.freePacks}`);
  const socket = io(BASE, { auth: { token } });
  await new Promise((ok, bad) => { socket.on('connect', ok); socket.on('connect_error', bad); });
  return { name, token, socket };
}

(async () => {
  const stamp = String(Date.now()).slice(-5);
  const a = await player('Alice' + stamp), b = await player('Bob' + stamp);

  // nickname collisions are rejected
  try { const w = Wallet.createRandom(); const { message } = await call('/api/nonce?address=' + w.address);
    const { token } = await call('/api/login', { address: w.address, signature: await w.signMessage(message) });
    await call('/api/nickname', { nickname: 'alice' + stamp }, token); console.log('FAIL: duplicate nickname accepted'); }
  catch (e) { console.log('Duplicate nickname rejected:', e.message.split(': ')[1]); }

  const done = Promise.all([a, b].map(p => new Promise(resolve => {
    let lastRound = 0;
    p.socket.on('match:state', st => {
      if (st.phase === 'pick' && st.you.pick === null && st.round !== lastRound) {
        lastRound = st.round;
        const left = st.you.hand.filter(c => !st.you.used.includes(c.uid)); const card = p === a ? left[0] : left[left.length - 1];
        if (p === a && st.round === 1) return; // let the timer auto-play round 1
        p.socket.emit('match:pick', { matchId: st.matchId, uid: card.uid }, () => {});
      }
      if (st.phase === 'reveal') { const r = st.log[st.log.length - 1]; if (p === a) console.log(`  round ${r.round}: ${r.mine.name} ${r.myPower} vs ${r.theirs.name} ${r.theirPower} → ${r.result}`); }
    });
    p.socket.on('match:end', r => { console.log(`${p.name}: ${r.out.toUpperCase()} ${r.myWins}-${r.oppWins}, net ${r.net}, ELO ${r.eloDelta >= 0 ? '+' : ''}${r.eloDelta}, balance ${r.profile.balance}`); resolve(); });
  })));

  for (const p of [a, b]) {
    const r = await new Promise(ok => p.socket.emit('queue:join', { roomId: 1 }, ok));
    console.log(`${p.name} queued:`, r.ok ? 'ok' : r.error);
  }
  await done;

  const lb = await call('/api/leaderboard');
  console.log('Leaderboard top:', lb.players.slice(0, 3).map(p => `${p.nickname} ${p.elo}`).join(' | '), '· burned', lb.burned);
  const h = await call('/api/history', null, a.token);
  console.log('Alice history rows:', h.matches.length, h.matches[0] && h.matches[0].out);
  a.socket.close(); b.socket.close();
  process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
