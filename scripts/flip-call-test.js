// FLIP! call over the real server: A calls in round 2 and B accepts (stakes x2), then B calls and A folds.
// Checks the money: entries escrowed on accept, refund of the caller's extra on a fold, pot paid at the right level.
// node scripts/flip-call-test.js http://localhost:3000 [previewKey]
const { Wallet } = require('ethers');
const { io } = require('socket.io-client');
const BASE = process.argv[2] || 'http://localhost:3000', KEY = process.argv[3];
const H = KEY ? { 'X-Preview-Key': KEY } : {};
const call = async (p, b, t) => {
  const r = await fetch(BASE + p, { method: b ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...H, ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const d = await r.json(); if (!r.ok) throw new Error(p + ': ' + d.error); return d;
};
async function player(tag) {
  const w = Wallet.createRandom(); const { message } = await call('/api/nonce?address=' + w.address);
  const { token } = await call('/api/login', { address: w.address, signature: await w.signMessage(message) });
  const nick = tag + String(Date.now()).slice(-5); await call('/api/nickname', { nickname: nick }, token);
  const me = await call('/api/me', null, token);
  const pick = ['Ember Fox', 'Rock Tortoise', 'Lava Golem', 'Storm Eagle', 'Tide Crab'].map(n => me.cards.find(c => c.name === n).uid);
  await call('/api/deck', { roomId: 1, uids: pick }, token);
  const socket = io(BASE, { auth: { token, preview: KEY } });
  await new Promise((ok, bad) => { socket.on('connect', ok); socket.on('connect_error', bad); });
  return { nick, token, socket, start: me.profile.balance };
}
const ask = (p, ev, data) => new Promise(ok => p.socket.emit(ev, data, ok));
(async () => {
  const A = await player('FcA'), B = await player('FcB');
  const ended = Promise.all([A, B].map(p => new Promise(res => p.socket.on('match:end', r => { p.end = r; res(); }))));
  let step = 0;
  for (const p of [A, B]) p.socket.on('match:state', async st => {
    p.st = st;
    if (p.busy) return; p.busy = true;
    try { await onState(p, st); } finally { p.busy = false; }
  });
  async function onState(p, st) {
    if (st.phase === 'flip' && st.flipCall && !st.flipCall.mine && !p.answered) {
      p.answered = true;
      const accept = p === B; // B accepts A's call, A folds B's call
      console.log(`${p === A ? 'A' : 'B'} answers FLIP! (extra ${st.flipCall.extra}) →`, accept ? 'accept' : 'fold', (await ask(p, 'match:flip-answer', { matchId: st.matchId, accept })).ok ? '' : '(error)');
      if (accept) setTimeout(() => (p.answered = false), 500);
      return;
    }
    if (st.phase !== 'pick' || st.you.pick !== null || p.lockedRound === st.round) return;
    if (st.round === 1 && p === A) {
      const r = await ask(p, 'match:flip', { matchId: st.matchId });
      console.log('A calls FLIP! in round 1 →', r.ok ? 'allowed (WRONG)' : r.error);
    }
    if (st.round === 2 && p === A && st.canCall && step === 0) { step = 1; const r = await ask(p, 'match:flip', { matchId: st.matchId }); console.log('A calls FLIP! in round 2 →', r.ok ? 'ok' : r.error); return; }
    if (st.round === 2 && p === A && step === 1 && st.mult === 2) {
      const again = await ask(p, 'match:flip', { matchId: st.matchId }); console.log('A calls a second time →', again.ok ? 'allowed (WRONG)' : again.error); step = 2;
    }
    if (st.round === 3 && p === B && st.canCall && step === 2) { step = 3; console.log('pot before B calls: ×' + st.mult, 'entry', st.entry); const r = await ask(p, 'match:flip', { matchId: st.matchId }); console.log('B calls FLIP! ×4 in round 3 →', r.ok ? 'ok' : r.error); return; }
    if (st.phase !== 'pick') return;
    p.lockedRound = st.round;
    const left = st.you.hand.filter(c => !st.you.used.includes(c.uid));
    await ask(p, 'match:pick', { matchId: st.matchId, uid: left[0].uid, face: st.round % 2 });
  }
  for (const p of [A, B]) { const r = await ask(p, 'queue:join', { roomId: 1 }); if (!r.ok) throw new Error(r.error); }
  await ended;
  for (const [n, p] of [['A', A], ['B', B]]) {
    const bal = (await call('/api/me', null, p.token)).profile.balance;
    console.log(`${n}: ${p.end.out}${p.end.folded ? ' (folded: ' + p.end.folded + ')' : ''} · stakes ×${p.end.mult} · entry ${p.end.stake} · pot ${p.end.pot} · rake ${p.end.rake} · net ${p.end.net} · balance ${p.start} → ${bal} (diff ${bal - p.start})`);
  }
  const ok = A.end.out === 'loss' && B.end.out === 'win' && A.end.mult === 2 && (await call('/api/me', null, A.token)).profile.balance - A.start === -40000 && (await call('/api/me', null, B.token)).profile.balance - B.start === 40000 - 4000;
  console.log(ok ? 'PASS: money checks out' : 'CHECK the numbers above');
  A.socket.close(); B.socket.close(); process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
