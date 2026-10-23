// Fusion over the real server: rules, error cases, balance/burn bookkeeping, and an observed success rate.
// node scripts/fusion-test.js http://localhost:3000 [previewKey]
const { Wallet } = require('ethers');
const BASE = process.argv[2] || 'http://localhost:3000';
const PREVIEW = process.argv[3] ? { 'X-Preview-Key': process.argv[3] } : {};
const call = async (p, b, t, ok = true) => {
  const r = await fetch(BASE + p, { method: b ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...PREVIEW, ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const d = await r.json(); if (ok && !r.ok) throw new Error(p + ': ' + d.error); return d;
};
async function player(tag) {
  const w = Wallet.createRandom(); const { message } = await call('/api/nonce?address=' + w.address);
  const { token } = await call('/api/login', { address: w.address, signature: await w.signMessage(message) });
  await call('/api/nickname', { nickname: tag + String(Date.now()).slice(-6) }, token);
  return token;
}
const of = (cards, rar) => cards.filter(c => c.rar === rar).map(c => c.uid);

(async () => {
  const t = await player('Forge');
  let me = await call('/api/me', null, t);
  const burned0 = (await call('/api/leaderboard')).burned;
  const commons = of(me.cards, 'common');
  console.log('start:', me.cards.length, 'cards,', commons.length, 'commons, balance', me.profile.balance);

  const err = async (label, uids) => console.log(label.padEnd(26), (await call('/api/fuse', { uids }, t, false)).error);
  await err('one card:', commons.slice(0, 1));
  await err('five cards:', commons.slice(0, 5));
  await err('duplicate card:', [commons[0], commons[0]]);
  await err('mixed rarities:', [commons[0], of(me.cards, 'rare')[0]]);
  await err('legendaries:', of(me.cards, 'legendary').concat(of(me.cards, 'legendary')).slice(0, 2));
  await err('not my card:', [commons[0], 99999999]);

  const r = await call('/api/fuse', { uids: commons.slice(0, 2) }, t);
  const after = await call('/api/me', null, t);
  console.log(`fuse 2 commons: ${r.success ? 'SUCCESS' : 'fail'} (chance ${(r.chance * 100).toFixed(0)}%) -> ${r.card.name} (${r.card.rar})`);
  console.log('  cards', me.cards.length, '->', after.cards.length, '| inputs gone:', !after.cards.some(c => commons.slice(0, 2).includes(c.uid)),
    '| balance', me.profile.balance, '->', after.profile.balance, '| burned +', (await call('/api/leaderboard')).burned - burned0);

  // fuse down to the 5-card floor
  me = after;
  let guard = 0;
  while (me.cards.length > 5 && guard++ < 20) {
    const byR = ['common', 'rare', 'epic'].map(r => of(me.cards, r)).find(l => l.length >= 2);
    if (!byR) break;
    const res = await call('/api/fuse', { uids: byR.slice(0, 2) }, t, false);
    if (res.error) { console.log('stopped:', res.error); break; }
    me = await call('/api/me', null, t);
  }
  console.log('after repeated fusions:', me.cards.length, 'cards left, balance', me.profile.balance);
  const pair = ['common', 'rare', 'epic'].map(r => of(me.cards, r)).find(l => l.length >= 2);
  if (pair) await err('below 5-card floor:', pair.slice(0, 2));

  // observed rate on a fresh player per run, many runs
  let tries = 0, wins = 0;
  for (let k = 0; k < 25; k++) {
    const tk = await player('Rate');
    const m = await call('/api/me', null, tk);
    const res = await call('/api/fuse', { uids: of(m.cards, 'common').slice(0, 3) }, tk);
    tries++; if (res.success) wins++;
  }
  console.log(`observed 3-common fusions: ${wins}/${tries} succeeded (expected 64%)`);
  console.log('server stats:', JSON.stringify((await call('/api/fusion-stats')).stats));
  process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
