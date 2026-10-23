// Ante room over the real server: players are only paired with the same ante rarity, the winner takes the
// loser's ante card (with its history: owners + 1), and FLIP! calls are off.
// node scripts/ante-test.js http://localhost:3000 [previewKey]
const { Wallet } = require('ethers');
const { io } = require('socket.io-client');
const BASE = process.argv[2] || 'http://localhost:3000', KEY = process.argv[3];
const H = KEY ? { 'X-Preview-Key': KEY } : {};
const call = async (p, b, t) => {
  const r = await fetch(BASE + p, { method: b ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...H, ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const d = await r.json(); if (!r.ok) throw new Error(p + ': ' + d.error); return d;
};
async function user(tag, names, anteName, strong) {
  const w = Wallet.createRandom(); const { message } = await call('/api/nonce?address=' + w.address);
  const { token } = await call('/api/login', { address: w.address, signature: await w.signMessage(message) });
  const nick = tag + String(Date.now()).slice(-5); await call('/api/nickname', { nickname: nick }, token);
  const me = await call('/api/me', null, token);
  const deck = names.map(n => me.cards.find(c => c.name === n));
  await call('/api/deck', { roomId: 4, uids: deck.map(c => c.uid) }, token);
  const socket = io(BASE, { auth: { token, preview: KEY } });
  await new Promise((ok, bad) => { socket.on('connect', ok); socket.on('connect_error', bad); });
  const u = { nick, token, socket, ante: deck.find(c => c.name === anteName), states: [] };
  socket.on('match:state', st => {
    u.states.push(st);
    if (st.phase !== 'pick' || st.you.pick !== null) return;
    const left = st.you.hand.filter(c => !st.you.used.includes(c.uid));
    const c = left.reduce((a, b) => (strong ? b.pow > a.pow : b.pow < a.pow) ? b : a);
    socket.emit('match:pick', { matchId: st.matchId, uid: c.uid, face: 0 }, () => {});
  });
  return u;
}
const join = u => new Promise(ok => u.socket.emit('queue:join', { roomId: 4, ante: u.ante.uid }, ok));
(async () => {
  const strongDeck = ['Ashborn Phoenix', 'Cloud Drake', 'Abyss Kraken', 'Storm Eagle', 'Frost Whale'];
  const weakDeck = ['Ember Fox', 'Spark Beetle', 'Breeze Sparrow', 'Rock Tortoise', 'Storm Eagle'];
  const A = await user('AntA', strongDeck, 'Storm Eagle', true);  // rare ante
  const C = await user('AntC', weakDeck, 'Ember Fox', false);     // common ante: must not be paired with A
  const B = await user('AntB', weakDeck, 'Storm Eagle', false);   // rare ante
  console.log('no ante card chosen:', (await new Promise(ok => A.socket.emit('queue:join', { roomId: 4 }, ok))).error);
  const endA = new Promise(ok => A.socket.on('match:end', ok)), endB = new Promise(ok => B.socket.on('match:end', ok));
  console.log('A queues (rare):', (await join(A)).ok, '| C queues (common):', (await join(C)).ok);
  await new Promise(r => setTimeout(r, 400));
  console.log('A paired with C?', A.states.length > 0 ? 'YES (wrong)' : 'no, rarities differ');
  console.log('B queues (rare):', (await join(B)).ok);
  const [ra, rb] = await Promise.all([endA, endB]);
  const first = A.states[0];
  console.log('match shows antes:', first.ante && `${first.ante.mine.name} vs ${first.ante.theirs.name}`, '| FLIP! allowed:', A.states.some(s => s.canCall));
  console.log(`A ${ra.out} ${ra.myWins}-${ra.oppWins}, B ${rb.out}; ante moved: ${ra.ante.moved}`);
  const [ma, mb] = await Promise.all([call('/api/me', null, A.token), call('/api/me', null, B.token)]);
  const winner = ra.out === 'win' ? ma : mb, loserAnte = ra.out === 'win' ? B.ante : A.ante;
  const got = winner.cards.find(c => c.uid === loserAnte.uid);
  console.log('winner now owns the loser\'s ante card:', !!got, got && `(${got.name}, owners ${got.life.owners})`, '| A cards', ma.cards.length, 'B cards', mb.cards.length);
  await new Promise(ok => C.socket.emit('queue:leave', {}, ok));
  [A, B, C].forEach(u => u.socket.close()); process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
