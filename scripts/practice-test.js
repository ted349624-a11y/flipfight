// Practice mode over the real server: start a bot game, play it out, check nothing at stake changed; then start and quit one.
// node scripts/practice-test.js http://localhost:3000 [previewKey]
const { Wallet } = require('ethers');
const { io } = require('socket.io-client');
const BASE = process.argv[2] || 'http://localhost:3000';
const COOKIE = process.argv[3] ? { Cookie: 'ff_preview=' + process.argv[3] } : {};
const call = async (p, b, t) => { const r = await fetch(BASE + p, { method: b ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...COOKIE, ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); const d = await r.json(); if (!r.ok) throw new Error(p + ': ' + d.error); return d; };
(async () => {
  const w = Wallet.createRandom(); const { message } = await call('/api/nonce?address=' + w.address);
  const { token } = await call('/api/login', { address: w.address, signature: await w.signMessage(message) });
  await call('/api/nickname', { nickname: 'Prac' + String(Date.now()).slice(-6) }, token);
  const me = await call('/api/me', null, token);
  await call('/api/deck', { roomId: 0, uids: me.decks[1] }, token);
  const s = io(BASE, { auth: { token }, extraHeaders: COOKIE }); await new Promise((ok, bad) => { s.on('connect', ok); s.on('connect_error', bad); });
  const ask = (ev, d) => new Promise(r => s.emit(ev, d, r));
  const end = new Promise(resolve => {
    let last = 0;
    s.on('match:state', st => {
      if (st.phase === 'pick' && st.you.pick === null && st.round !== last) {
        last = st.round; if (st.round === 1) console.log('opponent:', st.opp.nickname, '| room:', st.room.name, '| practice:', st.room.practice);
        s.emit('match:pick', { matchId: st.matchId, uid: st.you.hand.find(c => !st.you.used.includes(c.uid)).uid }, () => {});
      }
      if (st.phase === 'reveal') { const r = st.log[st.log.length - 1]; console.log(`  round ${r.round}: ${r.mine.name} ${r.myPower} vs ${r.theirs.name} ${r.theirPower} → ${r.result}`); }
    });
    s.once('match:end', resolve);
  });
  const t0 = Date.now();
  console.log('start hard practice:', (await ask('practice:start', { level: 'hard' })).ok);
  const r = await end;
  console.log(`result: ${r.out} ${r.myWins}-${r.oppWins} in ${((Date.now() - t0) / 1000).toFixed(0)}s, practice=${r.practice}, net=${r.net}, eloDelta=${r.eloDelta}`);
  const after = await call('/api/me', null, token);
  console.log('balance unchanged:', after.profile.balance === me.profile.balance, '| elo unchanged:', after.profile.elo === me.profile.elo, '| record unchanged:', after.profile.wins + after.profile.losses + after.profile.draws === 0);
  console.log('history entries:', (await call('/api/history', null, token)).matches.length);
  console.log('queue blocked while... start easy:', (await ask('practice:start', { level: 'easy' })).ok);
  console.log('quit:', (await ask('match:quit', {})).ok, '| can start again:', (await ask('practice:start', { level: 'normal' })).ok, '| quit again:', (await ask('match:quit', {})).ok);
  console.log('quit when not in a match:', (await ask('match:quit', {})).error);
  console.log('bad level:', (await ask('practice:start', { level: 'godlike' })).error);
  process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
