// Clans over the real server: create (cost + validation), open join, approval requests, the 25-member cap,
// kick / transfer / leave / disband rules, and a season point for a ranked win.
// node scripts/clan-test.js http://localhost:3000 [previewKey]
const { Wallet } = require('ethers');
const { io } = require('socket.io-client');
const BASE = process.argv[2] || 'http://localhost:3000', KEY = process.argv[3];
const H = KEY ? { 'X-Preview-Key': KEY } : {};
const call = async (p, b, t) => {
  const r = await fetch(BASE + p, { method: b ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...H, ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const d = await r.json(); return r.ok ? d : { error: d.error };
};
const stamp = String(Date.now()).slice(-5);
async function user(tag) {
  const w = Wallet.createRandom(); const { message } = await call('/api/nonce?address=' + w.address);
  const { token } = await call('/api/login', { address: w.address, signature: await w.signMessage(message) });
  const nick = tag + stamp; await call('/api/nickname', { nickname: nick }, token);
  return { token, nick, id: (await call('/api/me', null, token)).profile.id };
}
const banner = { bg: 0, fg: 2, sym: 2, pat: 1 };
(async () => {
  const L = await user('Lead');
  const bal0 = (await call('/api/me', null, L.token)).profile.balance;
  console.log('bad tag:', (await call('/api/clan/create', { name: 'Test Clan', tag: 'TOOLONG', banner }, L.token)).error);
  console.log('same colours:', (await call('/api/clan/create', { name: 'Test Clan', tag: 'TC', banner: { ...banner, fg: 0 } }, L.token)).error);
  const made = await call('/api/clan/create', { name: 'Pixel Kings ' + stamp.slice(-3), tag: 'P' + stamp.slice(-3), banner, joinMode: 'open' }, L.token);
  const me = await call('/api/me', null, L.token);
  console.log('created:', !!made.clanId, '| cost charged:', bal0 - me.profile.balance, '| profile clan:', me.profile.clan && me.profile.clan.tag);
  const L2 = await user('Lead2');
  console.log('duplicate tag:', (await call('/api/clan/create', { name: 'Other ' + stamp, tag: 'P' + stamp.slice(-3), banner }, L2.token)).error);
  const id = made.clanId;

  // fill the clan to 25 with open joins
  const members = [];
  for (let i = 0; i < 24; i++) members.push(await user('M' + i + '_'));
  for (const m of members) { const r = await call('/api/clan/join', { clanId: id }, m.token); if (!r.joined) console.log('join failed', r.error); }
  let d = await call('/api/clan/' + id, null, L.token);
  console.log('members after 24 joins:', d.clan.members, '/', d.clan.max);
  const extra = await user('Extra');
  console.log('26th player joins:', (await call('/api/clan/join', { clanId: id }, extra.token)).error);

  // approval mode
  await call('/api/clan/kick', { userId: members[0].id }, L.token);
  console.log('kick by non-leader:', (await call('/api/clan/kick', { userId: members[1].id }, members[2].token)).error);
  console.log('set approval:', (await call('/api/clan/update', { joinMode: 'approval' }, L.token)).ok);
  const ask = await call('/api/clan/join', { clanId: id }, extra.token);
  d = await call('/api/clan/' + id, null, L.token);
  console.log('request sent:', ask.requested, '| leader sees requests:', d.requests.map(r => r.nickname));
  await call('/api/clan/approve', { userId: extra.id }, L.token);
  d = await call('/api/clan/' + id, null, L.token);
  console.log('after approve:', d.clan.members, 'members, requests left', d.requests.length);

  // leader rules
  console.log('leader leaves with members:', (await call('/api/clan/leave', {}, L.token)).error);
  await call('/api/clan/transfer', { userId: members[1].id }, L.token);
  d = await call('/api/clan/' + id, null, L.token);
  console.log('new leader:', d.members.find(m => m.leader).nickname === members[1].nick, '| old leader can now leave:', (await call('/api/clan/leave', {}, L.token)).ok);

  // a ranked win gives the clan a point
  const deckOf = async (t, names) => { const m = await call('/api/me', null, t); const uids = names.map(n => m.cards.find(c => c.name === n).uid); await call('/api/deck', { roomId: 2, uids }, t); };
  const P = members[3], Q = await user('Rival');
  await deckOf(P.token, ['Cloud Drake', 'Abyss Kraken', 'Storm Eagle', 'Frost Whale', 'Lava Golem']); // strong deck
  await deckOf(Q.token, ['Ember Fox', 'Spark Beetle', 'Breeze Sparrow', 'Rock Tortoise', 'Tide Crab']); // commons
  const sock = t => new Promise(ok => { const s = io(BASE, { auth: { token: t, preview: KEY } }); s.on('connect', () => ok(s)); });
  const [sp, sq] = await Promise.all([sock(P.token), sock(Q.token)]);
  const end = Promise.all([sp, sq].map(s => new Promise(ok => s.on('match:end', ok))));
  [sp, sq].forEach((s, k) => s.on('match:state', st => {
    if (st.phase !== 'pick' || st.you.pick !== null) return;
    const left = st.you.hand.filter(c => !st.you.used.includes(c.uid));
    s.emit('match:pick', { matchId: st.matchId, uid: (k === 0 ? left.reduce((a, b) => (b.pow > a.pow ? b : a)) : left.reduce((a, b) => (b.pow < a.pow ? b : a))).uid, face: 0 }, () => {});
  }));
  let oppClan = null; sq.once('match:state', st => (oppClan = st.opp.clan));
  sp.emit('queue:join', { roomId: 2 }, () => {}); sq.emit('queue:join', { roomId: 2 }, () => {});
  const [rp] = await end;
  d = await call('/api/clan/' + id, null, P.token);
  console.log(`clan member ${rp.out}s a ranked match → clan points:`, d.clan.points, '| opponent saw clan in match:', oppClan && oppClan.tag);
  const lb = await call('/api/clans', null, Q.token);
  console.log('clan list top:', lb.clans.slice(0, 3).map(c => `[${c.tag}] ${c.points}p ${c.members}m`).join(' | '));
  const r = await call('/api/leaderboard', null, P.token);
  console.log('leaderboard shows clan next to name:', (r.players.find(x => x.id === P.id) || {}).clan?.tag, '| top clan:', r.topClan && r.topClan.tag);

  // disband
  const newLeader = members[1];
  console.log('disband by member:', (await call('/api/clan/disband', {}, members[4].token)).error);
  console.log('disband by leader:', (await call('/api/clan/disband', {}, newLeader.token)).ok, '| member clan after:', (await call('/api/me', null, members[4].token)).profile.clan);
  sp.close(); sq.close(); process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
