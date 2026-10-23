const crypto = require('crypto');
const { createBot } = require('./bot');

// Matchmaking queues and the server-authoritative match engine.
// Live match state is kept in memory; balances, ELO and results are written to the database.
function createMatchmaker({ io, db, q, G, validateDeck, publicProfile, badgesOf }) {
  const sockets = new Map();   // userId -> socket
  const queues = new Map(G.ROOMS.map(r => [r.id, []])); // roomId -> [{userId, cards, at}]
  const userQueue = new Map(); // userId -> roomId
  const matches = new Map();   // matchId -> match
  const userMatch = new Map(); // userId -> matchId
  const busy = new Set();      // users with a queue request in flight

  const emitTo = (userId, ev, data) => { const s = sockets.get(userId); if (s) s.emit(ev, data); };
  const cost = c => G.RARITIES[c.rar].cost;
  const log = err => console.error(err);
  const bot = createBot(G);
  const BOT_ID = -1;

  // Lobby counts only go to players looking at the rooms (socket room 'w:lobby'), batched to at most one
  // broadcast per second and only when something changed.
  let lobbyTimer = null, lastLobby = '';
  function lobbySnapshot() {
    const waiting = {};
    for (const [roomId, list] of queues) waiting[roomId] = list.length;
    return { online: sockets.size, waiting, playing: userMatch.size };
  }
  function broadcastLobby() {
    if (lobbyTimer) return;
    lobbyTimer = setTimeout(() => {
      lobbyTimer = null;
      const msg = lobbySnapshot(), key = JSON.stringify(msg);
      if (key === lastLobby) return;
      lastLobby = key; io.to('w:lobby').emit('lobby', msg);
    }, 1000);
  }

  // ---------- queue ----------
  async function joinQueue(userId, roomId) {
    if (busy.has(userId)) throw new Error('Please wait a moment.');
    if (userMatch.has(userId)) throw new Error('You are already in a match.');
    if (userQueue.has(userId)) throw new Error('You are already searching for a match.');
    busy.add(userId);
    try {
      const deckRow = await q.deckOf(userId, roomId);
      if (!deckRow) throw new Error('Build a deck for this room first.');
      const { room, cards } = await validateDeck(userId, roomId, JSON.parse(deckRow.card_uids));
      if (!(await q.spendBalance(userId, room.stake))) throw new Error('Not enough FLIP for this room.');
      queues.get(roomId).push({ userId, cards, at: Date.now() });
      userQueue.set(userId, roomId);
      broadcastLobby();
      tryPair(roomId);
      return room;
    } finally { busy.delete(userId); }
  }

  async function leaveQueue(userId) {
    const roomId = userQueue.get(userId);
    if (roomId === undefined) return false;
    const list = queues.get(roomId);
    const i = list.findIndex(e => e.userId === userId);
    if (i >= 0) list.splice(i, 1);
    userQueue.delete(userId);
    broadcastLobby();
    await q.addBalance(userId, G.ROOMS.find(r => r.id === roomId).stake); // refund the escrowed entry
    return true;
  }

  // ---------- practice vs bot ----------
  async function startPractice(userId, level) {
    if (!G.BOT_LEVELS[level]) throw new Error('Unknown difficulty.');
    if (busy.has(userId)) throw new Error('Please wait a moment.');
    if (userMatch.has(userId)) throw new Error('You are already in a match.');
    if (userQueue.has(userId)) throw new Error('Cancel your search before starting practice.');
    busy.add(userId);
    try {
      const deckRow = await q.deckOf(userId, G.PRACTICE.id);
      if (!deckRow) throw new Error('Build a practice deck first.');
      const { cards } = await validateDeck(userId, G.PRACTICE.id, JSON.parse(deckRow.card_uids));
      const u = await q.userById(userId);
      const human = { userId: u.id, nickname: u.nickname, elo: u.elo, hand: cards, used: [], energy: G.MATCH.energy, wins: 0, pick: null, auto: false };
      const botP = { userId: BOT_ID, isBot: true, nickname: `Training Bot · ${G.BOT_LEVELS[level].name}`, elo: G.BOT_LEVELS[level].elo,
        hand: bot.buildDeck(cards), used: [], energy: G.MATCH.energy, wins: 0, pick: null, auto: false };
      const m = { id: crypto.randomUUID(), room: G.PRACTICE, practice: true, level, players: [human, botP], round: 1, phase: 'pick', deadline: 0, timer: null, botTimer: null, log: [] };
      matches.set(m.id, m);
      userMatch.set(userId, m.id);
      broadcastLobby();
      startRound(m);
      return m.id;
    } finally { busy.delete(userId); }
  }

  function botPick(m) {
    const b = m.players.find(p => p.isBot);
    if (!b || m.phase !== 'pick' || b.pick !== null) return;
    const human = m.players.find(p => !p.isBot);
    b.pick = bot.choose(m.level, b, human).uid;
    if (m.players.every(x => x.pick !== null)) resolveRound(m);
    else emitState(m);
  }

  function quitPractice(userId) {
    const m = matches.get(userMatch.get(userId));
    if (!m) throw new Error('You are not in a match.');
    if (!m.practice) throw new Error('Only practice matches can be left early.');
    clearTimeout(m.timer); clearTimeout(m.botTimer);
    m.phase = 'done';
    matches.delete(m.id); userMatch.delete(userId);
    broadcastLobby();
  }

  function tryPair(roomId) {
    const list = queues.get(roomId);
    while (list.length >= 2) {
      const a = list.shift();
      const bi = list.findIndex(e => e.userId !== a.userId);
      if (bi < 0) { list.unshift(a); return; }
      const [b] = list.splice(bi, 1);
      // reserve both players before any await so nobody can be paired twice
      const id = crypto.randomUUID();
      userQueue.delete(a.userId); userQueue.delete(b.userId);
      userMatch.set(a.userId, id); userMatch.set(b.userId, id);
      startMatch(id, G.ROOMS.find(r => r.id === roomId), a, b).catch(err => {
        log(err);
        // could not start: refund both entries
        [a, b].forEach(p => { userMatch.delete(p.userId); q.addBalance(p.userId, G.ROOMS.find(r => r.id === roomId).stake).catch(log); emitTo(p.userId, 'match:error', { error: 'Could not start the match. Your entry was refunded.' }); });
      });
    }
  }

  // ---------- match engine ----------
  async function startMatch(id, room, a, b) {
    const mk = async e => {
      const u = await q.userById(e.userId);
      return { userId: u.id, nickname: u.nickname, elo: u.elo, badges: badgesOf ? (await badgesOf([u.id]))[u.id] || [] : [], hand: e.cards, used: [], energy: G.MATCH.energy, wins: 0, pick: null, auto: false };
    };
    const m = { id, room, players: [await mk(a), await mk(b)], round: 1, phase: 'pick', deadline: 0, timer: null, log: [] };
    matches.set(m.id, m);
    broadcastLobby();
    startRound(m);
  }

  function startRound(m) {
    m.phase = 'pick';
    m.deadline = Date.now() + G.MATCH.turnMs;
    m.players.forEach(p => { p.pick = null; p.auto = false; });
    clearTimeout(m.timer);
    m.timer = setTimeout(() => timeoutRound(m), G.MATCH.turnMs + 500);
    emitState(m);
    if (m.practice) { clearTimeout(m.botTimer); m.botTimer = setTimeout(() => botPick(m), bot.thinkMs(m.level)); }
  }

  function viewFor(m, idx) {
    const me = m.players[idx], op = m.players[1 - idx];
    return {
      matchId: m.id,
      room: { id: m.room.id, name: m.room.name, stake: m.room.stake, practice: !!m.practice, level: m.level || null },
      round: m.round, phase: m.phase, deadline: m.deadline, serverNow: Date.now(),
      you: { nickname: me.nickname, elo: me.elo, badges: me.badges || [], hand: me.hand, used: me.used, energy: me.energy, wins: me.wins, pick: me.pick },
      opp: {
        nickname: op.nickname, elo: op.elo, badges: op.badges || [], energy: op.energy, wins: op.wins, locked: op.pick !== null,
        leftElements: op.hand.filter(c => !op.used.includes(c.uid)).map(c => c.el),
      },
      log: m.log.map(r => ({
        round: r.round, mine: r.cards[idx], theirs: r.cards[1 - idx], myPower: r.powers[idx], theirPower: r.powers[1 - idx],
        myExhausted: r.exhausted[idx], theirExhausted: r.exhausted[1 - idx], myAuto: r.auto[idx],
        result: r.winner === null ? 'tie' : r.winner === idx ? 'win' : 'loss',
      })),
    };
  }

  function emitState(m) { m.players.forEach((p, i) => emitTo(p.userId, 'match:state', viewFor(m, i))); }

  function pick(userId, matchId, uid) {
    const m = matches.get(matchId);
    if (!m || userMatch.get(userId) !== matchId) throw new Error('This match is over.');
    if (m.phase !== 'pick') throw new Error('Wait for the next round.');
    const p = m.players.find(x => x.userId === userId);
    if (p.pick !== null) throw new Error('You already locked a card this round.');
    const card = p.hand.find(c => c.uid === uid);
    if (!card || p.used.includes(uid)) throw new Error('That card is not available.');
    p.pick = uid;
    if (m.players.every(x => x.pick !== null)) resolveRound(m);
    else emitState(m);
  }

  function timeoutRound(m) {
    if (m.phase !== 'pick') return;
    m.players.forEach(p => {
      if (p.pick !== null) return;
      const left = p.hand.filter(c => !p.used.includes(c.uid));
      p.pick = left[crypto.randomInt(0, left.length)].uid;
      p.auto = true;
    });
    resolveRound(m);
  }

  function resolveRound(m) {
    clearTimeout(m.timer); clearTimeout(m.botTimer);
    m.phase = 'reveal';
    const cards = m.players.map(p => p.hand.find(c => c.uid === p.pick));
    const exhausted = m.players.map((p, i) => cost(cards[i]) > p.energy);
    m.players.forEach((p, i) => { if (!exhausted[i]) p.energy -= cost(cards[i]); p.used.push(p.pick); });
    const powers = [
      G.effectivePower(cards[0], exhausted[0], cards[1].el),
      G.effectivePower(cards[1], exhausted[1], cards[0].el),
    ];
    const winner = powers[0] > powers[1] ? 0 : powers[1] > powers[0] ? 1 : null;
    if (winner !== null) m.players[winner].wins++;
    m.log.push({ round: m.round, cards, powers, exhausted, auto: m.players.map(p => p.auto), winner });
    emitState(m);
    const over = m.players.some(p => p.wins >= G.MATCH.winsNeeded) || m.log.length >= G.MATCH.rounds;
    m.timer = setTimeout(() => {
      if (!matches.has(m.id)) return; // practice match was left early
      if (over) (m.practice ? finishPractice(m) : finishMatch(m).catch(log));
      else { m.round++; startRound(m); }
    }, G.MATCH.revealMs);
  }

  function eloDelta(mine, theirs, score) {
    const expected = 1 / (1 + Math.pow(10, (theirs - mine) / 400));
    return Math.round(32 * (score - expected));
  }

  async function finishPractice(m) {
    m.phase = 'done';
    const [p, b] = m.players;
    const out = p.wins > b.wins ? 'win' : p.wins < b.wins ? 'loss' : 'draw';
    userMatch.delete(p.userId);
    matches.delete(m.id);
    emitTo(p.userId, 'match:end', {
      matchId: m.id, practice: true, level: m.level, out, myWins: p.wins, oppWins: b.wins, opponent: b.nickname, room: m.room.name,
      stake: 0, pot: 0, rake: 0, net: 0, split: { burn: 0, treasury: 0, season: 0 }, eloDelta: 0,
      profile: publicProfile(await q.userById(p.userId)),
    });
    broadcastLobby();
  }

  async function finishMatch(m) {
    m.phase = 'done';
    const [p1, p2] = m.players;
    const winnerIdx = p1.wins > p2.wins ? 0 : p2.wins > p1.wins ? 1 : null;
    const stake = m.room.stake, pot = stake * 2;
    const rake = winnerIdx === null ? 0 : Math.round(pot * m.room.rake);
    const s1 = winnerIdx === null ? 0.5 : winnerIdx === 0 ? 1 : 0;
    const d1 = eloDelta(p1.elo, p2.elo, s1), d2 = eloDelta(p2.elo, p1.elo, 1 - s1);
    const col = s => (s === 1 ? 'wins' : s === 0 ? 'losses' : 'draws');

    await db.tx(async c => {
      if (winnerIdx === null) {
        await q.addBalance(p1.userId, stake, c); await q.addBalance(p2.userId, stake, c);
      } else {
        await q.addBalance(m.players[winnerIdx].userId, pot - rake, c);
        await db.addStat('burned', rake * G.ECONOMY.feeSplit.burn, c);
        await db.addStat('treasury', rake * G.ECONOMY.feeSplit.treasury, c);
        await db.addStat('season', rake * G.ECONOMY.feeSplit.season, c);
      }
      const upd = (s, d, uid) => db.query(`UPDATE users SET elo = GREATEST(100, elo + $1), ${col(s)} = ${col(s)} + 1,
                                            season_played = season_played + 1, season_${col(s)} = season_${col(s)} + 1 WHERE id = $2`, [d, uid], c);
      await upd(s1, d1, p1.userId);
      await upd(1 - s1, d2, p2.userId);
      await db.query(`INSERT INTO matches(id, room_id, p1, p2, winner_id, p1_wins, p2_wins, stake, rake, p1_elo_delta, p2_elo_delta, created_at)
                      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [m.id, m.room.id, p1.userId, p2.userId, winnerIdx === null ? null : m.players[winnerIdx].userId,
         p1.wins, p2.wins, stake, rake, d1, d2, Date.now()], c);
    });

    for (let i = 0; i < 2; i++) {
      const p = m.players[i], op = m.players[1 - i];
      const out = winnerIdx === null ? 'draw' : winnerIdx === i ? 'win' : 'loss';
      const u = await q.userById(p.userId);
      userMatch.delete(p.userId);
      emitTo(p.userId, 'match:end', {
        matchId: m.id, out, myWins: p.wins, oppWins: op.wins, opponent: op.nickname, room: m.room.name,
        stake, pot, rake, net: out === 'win' ? pot - rake - stake : out === 'loss' ? -stake : 0,
        split: { burn: rake * G.ECONOMY.feeSplit.burn, treasury: rake * G.ECONOMY.feeSplit.treasury, season: rake * G.ECONOMY.feeSplit.season },
        eloDelta: i === 0 ? d1 : d2, profile: publicProfile(u),
      });
    }
    matches.delete(m.id);
    broadcastLobby();
  }

  // ---------- sockets ----------
  function onConnection(socket) {
    const userId = socket.data.userId;
    const prev = sockets.get(userId);
    if (prev && prev !== socket) { prev.emit('session:replaced'); prev.disconnect(true); }
    sockets.set(userId, socket);

    const handle = (fn, work) => Promise.resolve().then(work)
      .then(r => { if (typeof fn === 'function') fn({ ok: true, ...r }); })
      .catch(e => { if (typeof fn === 'function') fn({ ok: false, error: e.message || 'Request failed.' }); });

    socket.on('queue:join', (data, fn) => handle(fn, async () => {
      const room = await joinQueue(userId, Number(data && data.roomId));
      return { room: room.id, profile: publicProfile(await q.userById(userId)), matched: userMatch.has(userId) };
    }));
    socket.on('queue:leave', (data, fn) => handle(fn, async () => {
      await leaveQueue(userId);
      return { profile: publicProfile(await q.userById(userId)) };
    }));
    socket.on('practice:start', (data, fn) => handle(fn, async () => ({ matchId: await startPractice(userId, String(data && data.level)) })));
    socket.on('match:quit', (data, fn) => handle(fn, () => { quitPractice(userId); return {}; }));
    socket.on('match:pick', (data, fn) => handle(fn, () => { pick(userId, String(data && data.matchId), Number(data && data.uid)); return {}; }));

    socket.on('disconnect', () => {
      if (sockets.get(userId) !== socket) return;
      sockets.delete(userId);
      leaveQueue(userId).catch(log); // never leave a ghost in the queue
      broadcastLobby();               // an active match keeps running; timeouts auto-play for an absent player
    });

    const mid = userMatch.get(userId);
    const m = mid && matches.get(mid);
    if (m) emitTo(userId, 'match:state', viewFor(m, m.players.findIndex(p => p.userId === userId)));
    broadcastLobby();
  }

  return {
    onConnection,
    lobbySnapshot,
    onlineCount: () => sockets.size,
    activeMatchOf: userId => userMatch.get(userId) || null,
    notify: (userId, ev, data) => emitTo(userId, ev, data),
    isBusy: userId => userMatch.has(userId) || userQueue.has(userId) || busy.has(userId),
  };
}

module.exports = { createMatchmaker };
