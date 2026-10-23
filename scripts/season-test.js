// Season end over the real server. Plays ranked matches, then the caller ends the season early
// (e.g. psql: UPDATE seasons SET ends_at = 0 WHERE finalized_at IS NULL) and this script checks payouts, badges and the reset.
// node scripts/season-test.js http://localhost:3000 [previewKey] play|check
const fs = require('fs');
const { Wallet } = require('ethers');
const { io } = require('socket.io-client');
const BASE = process.argv[2] || 'http://localhost:3000';
const KEY = process.argv[3];
const MODE = process.argv[4] || 'play';
const STATE = process.env.SEASON_TEST_STATE || 'season-test-state.json';
const G = require('../shared/game');
const H = KEY ? { 'X-Preview-Key': KEY } : {};
const call = async (p, b, t) => { const r = await fetch(BASE + p, { method: b ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...H, ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); const d = await r.json(); if (!r.ok) throw new Error(p + ': ' + d.error); return d; };

async function player(tag, strong) {
  const w = Wallet.createRandom(); const { message } = await call('/api/nonce?address=' + w.address);
  const { token } = await call('/api/login', { address: w.address, signature: await w.signMessage(message) });
  const nick = tag + String(Date.now()).slice(-5);
  await call('/api/nickname', { nickname: nick }, token);
  const me = await call('/api/me', null, token);
  const sorted = me.cards.slice().sort((a, b) => a.pow - b.pow);
  const deck = strong ? ['Ember Fox', 'Rock Tortoise', 'Lava Golem', 'Storm Eagle', 'Tide Crab'].map(n => me.cards.find(c => c.name === n).uid) : sorted.slice(0, 5).map(c => c.uid);
  for (const room of [1, 2]) await call('/api/deck', { roomId: room, uids: deck }, token);
  const socket = io(BASE, { auth: { token, preview: KEY } });
  await new Promise((ok, bad) => { socket.on('connect', ok); socket.on('connect_error', bad); });
  const p = { token, nick, socket, last: 0 };
  socket.on('match:state', st => {
    if (st.phase === 'pick' && st.you.pick === null && st.round !== p.last) {
      p.last = st.round;
      const left = st.you.hand.filter(c => !st.you.used.includes(c.uid)).sort((a, b) => b.pow - a.pow);
      socket.emit('match:pick', { matchId: st.matchId, uid: left[0].uid }, () => {});
    }
  });
  return p;
}
async function match(a, b, room) {
  a.last = b.last = 0;
  const ends = [a, b].map(p => new Promise(r => p.socket.once('match:end', r)));
  for (const p of [a, b]) { const r = await new Promise(ok => p.socket.emit('queue:join', { roomId: room }, ok)); if (!r.ok) throw new Error(r.error); }
  return Promise.all(ends);
}

(async () => {
  if (MODE === 'play') {
    const [A, B, C, D, E] = await Promise.all([player('Alpha', true), player('Bravo', false), player('Charlie', true), player('Delta', false), player('Echo', true)]);
    for (let i = 0; i < 3; i++) { await match(A, B, 1); await match(C, D, 1); }
    await match(E, D, 1); // Echo plays only once: not qualified
    const lb = await call('/api/leaderboard', null, A.token);
    console.log(`season ${lb.season.number} leaderboard before the end:`);
    lb.players.filter(p => [A, B, C, D, E].some(x => x.nick === p.nickname)).forEach(p =>
      console.log(`  #${p.rank} ${p.nickname.padEnd(13)} ${p.elo} ELO  ${p.wins}-${p.losses}-${p.draws}  qualified=${p.qualified}  place=${p.place}  projected=${p.reward}`));
    const state = { season: lb.season.number, players: {} };
    for (const p of [A, B, C, D, E]) { const me = await call('/api/me', null, p.token); state.players[p.nick] = { token: p.token, balance: me.profile.balance, elo: me.profile.elo }; }
    fs.writeFileSync(STATE, JSON.stringify(state));
    console.log('saved state; now end the season and run with "check"');
    process.exit(0);
  }
  const state = JSON.parse(fs.readFileSync(STATE));
  const lb = await call('/api/leaderboard');
  console.log(`now in season ${lb.season.number} (was ${state.season}) | new season ends in ${((lb.season.endsAt - lb.season.serverNow) / 864e5).toFixed(2)} days | ranked players: ${lb.ranked}`);
  console.log('last season podium:', JSON.stringify(lb.lastSeason.podium.map(p => `${p.place}:${p.nickname}`)));
  for (const [nick, s] of Object.entries(state.players)) {
    const me = await call('/api/me', null, s.token);
    const r = me.seasonResult;
    const paid = me.profile.balance - s.balance;
    const ok = r ? paid === G.seasonReward(r.place) && me.profile.elo === G.seasonResetElo(s.elo) : paid === 0;
    console.log(`  ${nick.padEnd(13)} ${r ? `place ${r.place}/${r.of}` : 'not qualified'}  paid +${paid}  ELO ${s.elo} -> ${me.profile.elo}  season stats ${JSON.stringify(me.profile.season)}  badges ${JSON.stringify(me.badges)}  ${ok ? 'OK' : 'MISMATCH'}`);
    if (r) { await call('/api/season/seen', {}, s.token); console.log('    popup cleared after seen:', (await call('/api/me', null, s.token)).seasonResult === null); }
  }
  process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
