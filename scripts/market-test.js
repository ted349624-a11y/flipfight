// Marketplace over the real server: listing rules, live socket updates, a race between two buyers, money and card bookkeeping.
// node scripts/market-test.js http://localhost:3000 [previewKey]
const { Wallet } = require('ethers');
const { io } = require('socket.io-client');
const BASE = process.argv[2] || 'http://localhost:3000';
const KEY = process.argv[3];
const H = KEY ? { 'X-Preview-Key': KEY } : {};
const call = async (p, b, t, ok = true) => {
  const r = await fetch(BASE + p, { method: b ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...H, ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const d = await r.json(); if (ok && !r.ok) throw new Error(p + ': ' + d.error); return d;
};
async function player(tag) {
  const w = Wallet.createRandom(); const { message } = await call('/api/nonce?address=' + w.address);
  const { token } = await call('/api/login', { address: w.address, signature: await w.signMessage(message) });
  const nick = tag + String(Date.now()).slice(-5);
  await call('/api/nickname', { nickname: nick }, token);
  const socket = io(BASE, { auth: { token, preview: KEY } });
  await new Promise((ok, bad) => { socket.on('connect', ok); socket.on('connect_error', bad); });
  return { token, nick, socket, events: [] };
}
const me = t => call('/api/me', null, t);

(async () => {
  const [s, b1, b2] = await Promise.all([player('Seller'), player('BuyerA'), player('BuyerB')]);
  await Promise.all([s, b1, b2].map(p => new Promise(ok => p.socket.emit('watch', 'market', ok)))); // like a player looking at the Market screen
  [s, b1, b2].forEach(p => { p.socket.on('market:update', u => p.events.push(u.kind)); p.socket.on('market:sold', d => p.events.push('sold-notice:' + d.received)); });
  const sm = await me(s.token);
  const card = sm.cards.find(c => c.rar === 'epic');
  const burned0 = (await call('/api/leaderboard')).burned;

  const err = async (label, p) => console.log(label.padEnd(28), (await p).error);
  await err('price too low:', call('/api/market/list', { uid: card.uid, price: 10 }, s.token, false));
  await err("someone else's card:", call('/api/market/list', { uid: card.uid, price: 50000 }, b1.token, false));

  const { listingId } = await call('/api/market/list', { uid: card.uid, price: 90000 }, s.token);
  await err('list same card twice:', call('/api/market/list', { uid: card.uid, price: 50000 }, s.token, false));
  const listed = (await me(s.token)).cards.find(c => c.uid === card.uid);
  console.log('listed card flagged:', !!listed.listingId, '| price', listed.listPrice);
  await err('use listed card in deck:', call('/api/deck', { roomId: 3, uids: sm.cards.filter(c => c.uid !== card.uid).slice(0, 4).map(c => c.uid).concat(card.uid) }, s.token, false));
  await err('fuse listed card:', call('/api/fuse', { uids: [card.uid, sm.cards.find(c => c.rar === 'epic' && c.uid !== card.uid).uid] }, s.token, false));
  await err('buy own card:', call('/api/market/buy', { listingId }, s.token, false));

  const view = await call('/api/market', null, b1.token);
  console.log('buyer sees listing:', view.listings.some(l => l.id === listingId && l.seller === s.nick && !l.mine));

  // two buyers click Buy at the same moment
  const bb1 = (await me(b1.token)).profile.balance, bb2 = (await me(b2.token)).profile.balance, sb = (await me(s.token)).profile.balance;
  const [r1, r2] = await Promise.all([call('/api/market/buy', { listingId }, b1.token, false), call('/api/market/buy', { listingId }, b2.token, false)]);
  const winner = r1.ok ? b1 : b2, loser = r1.ok ? b2 : b1;
  console.log('race: exactly one buyer won:', [r1, r2].filter(r => r.ok).length === 1, '| loser told:', (r1.ok ? r2 : r1).error);
  await new Promise(r => setTimeout(r, 500));
  const [sw, ww, lw] = await Promise.all([me(s.token), me(winner.token), me(loser.token)]);
  console.log('card moved to buyer:', ww.cards.some(c => c.uid === card.uid), '| gone from seller:', !sw.cards.some(c => c.uid === card.uid));
  console.log('buyer paid:', (winner === b1 ? bb1 : bb2) - ww.profile.balance, '| seller got:', sw.profile.balance - sb, '| loser charged:', (loser === b1 ? bb1 : bb2) - lw.profile.balance);
  console.log('fee burned:', (await call('/api/leaderboard')).burned - burned0, '(expected 2250)');
  console.log('live events seller:', s.events.join(','), '| buyerA:', b1.events.join(','), '| buyerB:', b2.events.join(','));
  const after = await call('/api/market', null, b1.token);
  console.log('listing gone from market:', !after.listings.some(l => l.id === listingId), '| in recent sales:', after.recent.some(r => r.id === listingId), '| avg price for card:', after.avgPrice[card.tpl] && after.avgPrice[card.tpl].avg);

  // cancel flow
  const c2 = sw.cards.find(c => c.rar === 'common');
  const l2 = (await call('/api/market/list', { uid: c2.uid, price: 5000 }, s.token)).listingId;
  await err('cancel by someone else:', call('/api/market/cancel', { listingId: l2 }, b1.token, false));
  await call('/api/market/cancel', { listingId: l2 }, s.token);
  console.log('cancelled card usable again:', !(await me(s.token)).cards.find(c => c.uid === c2.uid).listingId);
  await err('buy cancelled listing:', call('/api/market/buy', { listingId: l2 }, b1.token, false));

  // keep-5 rule
  let left = (await me(s.token)).cards, n = 0, last;
  while (true) { const c = left.find(x => !x.listingId); last = await call('/api/market/list', { uid: c.uid, price: 2000 }, s.token, false); if (last.error) break; n++; left = (await me(s.token)).cards; }
  console.log(`listed ${n} more, then:`, last.error, '| unlisted left:', left.filter(c => !c.listingId).length);
  process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
