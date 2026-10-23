// World boss over the real server: a fight deals damage, the daily fight limit holds, and (with a low-HP boss,
// e.g. start the server with BOSS_HP=20000 on a fresh week) the final blow pays everyone and gives the top 3 a badge.
// node scripts/boss-test.js http://localhost:3000 [previewKey]
const { Wallet } = require('ethers');
const { io } = require('socket.io-client');
const BASE = process.argv[2] || 'http://localhost:3000', KEY = process.argv[3];
const H = KEY ? { 'X-Preview-Key': KEY } : {};
const call = async (p, b, t) => {
  const r = await fetch(BASE + p, { method: b ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...H, ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const d = await r.json(); if (!r.ok) throw new Error(p + ': ' + d.error); return d;
};
async function user(tag) {
  const w = Wallet.createRandom(); const { message } = await call('/api/nonce?address=' + w.address);
  const { token } = await call('/api/login', { address: w.address, signature: await w.signMessage(message) });
  await call('/api/nickname', { nickname: tag + String(Date.now()).slice(-5) }, token);
  const me = await call('/api/me', null, token);
  const strongest = me.cards.slice().sort((a, b) => b.pow - a.pow).slice(0, 5).map(c => c.uid);
  await call('/api/deck', { roomId: 9, uids: strongest }, token);
  const socket = io(BASE, { auth: { token, preview: KEY } });
  await new Promise((ok, bad) => { socket.on('connect', ok); socket.on('connect_error', bad); });
  socket.on('match:state', st => {
    if (st.phase !== 'pick' || st.you.pick !== null) return;
    const left = st.you.hand.filter(c => !st.you.used.includes(c.uid));
    socket.emit('match:pick', { matchId: st.matchId, uid: left[0].uid, face: 0 }, () => {});
  });
  return { token, socket, start: me.profile.balance };
}
const fight = p => new Promise((ok, bad) => {
  p.socket.once('match:end', ok);
  p.socket.emit('boss:start', {}, r => { if (!r.ok) { p.socket.off('match:end'); bad(new Error(r.error)); } });
});
(async () => {
  const A = await user('BossA'), B = await user('BossB');
  let s = await call('/api/boss', null, A.token);
  console.log(`boss: ${s.boss.name} (${s.boss.el}) HP ${s.boss.hp}/${s.boss.maxHp} · fights left ${s.me.attemptsLeft} · deck ${s.deck.map(c => c.name).join(', ')}`);
  for (let i = 1; i <= 3; i++) {
    const p = i === 2 ? B : A;
    try {
      const r = await fight(p);
      console.log(`fight ${i} (${p === A ? 'A' : 'B'}): ${r.out} ${r.myWins}-${r.oppWins} · damage ${r.boss.damage} (dealt ${r.boss.dealt}) · boss HP ${r.boss.hp}/${r.boss.maxHp}${r.boss.killed ? ' · BOSS DOWN!' : ''}`);
      if (r.boss.killed) break;
    } catch (e) { console.log(`fight ${i}:`, e.message); break; }
  }
  s = await call('/api/boss', null, A.token);
  console.log('A this week:', s.me, '| top:', s.top.map(t => `${t.nickname} ${t.damage}`).join(', '));
  if (!s.boss.killedAt) {
    for (let i = 0; i < 3; i++) { try { await fight(A); } catch (e) { console.log('extra fight:', e.message); break; } }
  } else {
    const [a, b] = await Promise.all([call('/api/me', null, A.token), call('/api/me', null, B.token)]);
    console.log('rewards: A', a.profile.balance - A.start, 'B', b.profile.balance - B.start, '| A badges', JSON.stringify(a.badges));
    try { await fight(B); } catch (e) { console.log('fight after the kill:', e.message); }
  }
  A.socket.close(); B.socket.close(); process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
