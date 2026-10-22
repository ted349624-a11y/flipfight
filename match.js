const crypto = require('crypto');

// Matchmaking queues and the server-authoritative match engine.
function createMatchmaker({ io, db, q, G, addStat, validateDeck, publicProfile }) {
  const sockets = new Map();   // userId -> socket
  const queues = new Map(G.ROOMS.map(r => [r.id, []])); // roomId -> [{userId, cards, at}]
  const userQueue = new Map(); // userId -> roomId
  const matches = new Map();   // matchId -> match
  const userMatch = new Map(); // userId -> matchId

  const emitTo = (userId, ev, data) => { const s = sockets.get(userId); if (s) s.emit(ev, data); };
  const cost = c => G.RARITIES[c.rar].cost;

  function broadcastLobby() {
    const waiting = {};
    for (const [roomId, list] of queues) waiting[roomId] = list.length;
    io.emit('lobby', { online: sockets.size, waiting, playing: userMatch.size });
  }

  // ---------- queue ----------
  function joinQueue(userId, roomId) {
    if (userMatch.has(userId)) throw new Error('You are already in a match.');
    if (userQueue.has(userId)) throw new Error('You are already searching for a match.');
    const deckRow = db.prepare('SELECT card_uids FROM decks WHERE user_id = ? AND room_id = ?').get(userId, roomId);
    if (!deckRow) throw new Error('Build a deck for this room first.');
    const { room, cards } = validateDeck(userId, roomId, JSON.parse(deckRow.card_uids));
    if (!q.spendBalance.run(room.stake, userId, room.stake).changes) throw new Error('Not enough FLIP for this room.');
    queues.get(roomId).push({ userId, cards, at: Date.now() });
    userQueue.set(userId, roomId);
    tryPair(roomId);
    broadcastLobby();
    return room;
  }

  function leaveQueue(userId, refund = true) {
    const roomId = userQueue.get(userId);
    if (roomId === undefined) return false;
    const list = queues.get(roomId);
    const i = list.findIndex(e => e.userId === userId);
    if (i >= 0) list.splice(i, 1);
    userQueue.delete(userId);
    if (refund) q.addBalance.run(G.ROOMS.find(r => r.id === roomId).stake, userId);
    broadcastLobby();
    return true;
  }

  function tryPair(roomId) {
    const list = queues.get(roomId);
    while (list.length >= 2) {
      const a = list.shift();
      const bi = list.findIndex(e => e.userId !== a.userId);
      if (bi < 0) { list.unshift(a); return; }
      const [b] = list.splice(bi, 1);
      userQueue.delete(a.userId); userQueue.delete(b.userId);
      startMatch(G.ROOMS.find(r => r.id === roomId), a, b);
    }
  }

  // ---------- match engine ----------
  function startMatch(room, a, b) {
    const mk = e => {
      const u = q.userById.get(e.userId);
      return { userId: u.id, nickname: u.nickname, elo: u.elo, hand: e.cards, used: [], energy: G.MATCH.energy, wins: 0, pick: null, auto: false };
    };
    const m = { id: crypto.randomUUID(), room, players: [mk(a), mk(b)], round: 1, phase: 'pick', deadline: 0, timer: null, log: [] };
    matches.set(m.id, m);
    m.players.forEach(p => userMatch.set(p.userId, m.id));
    startRound(m);
  }

  function startRound(m) {
    m.phase = 'pick';
    m.deadline = Date.now() + G.MATCH.turnMs;
    m.players.forEach(p => { p.pick = null; p.auto = false; });
    clearTimeout(m.timer);
    m.timer = setTimeout(() => timeoutRound(m), G.MATCH.turnMs + 500);
    emitState(m);
  }

  function viewFor(m, idx) {
    const me = m.players[idx], op = m.players[1 - idx];
    return {
      matchId: m.id,
      room: { id: m.room.id, name: m.room.name, stake: m.room.stake },
      round: m.round, phase: m.phase, deadline: m.deadline, serverNow: Date.now(),
      you: { nickname: me.nickname, elo: me.elo, hand: me.hand, used: me.used, energy: me.energy, wins: me.wins, pick: me.pick },
      opp: {
        nickname: op.nickname, elo: op.elo, energy: op.energy, wins: op.wins, locked: op.pick !== null,
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
    clearTimeout(m.timer);
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
      if (over) finishMatch(m);
      else { m.round++; startRound(m); }
    }, G.MATCH.revealMs);
  }

  function eloDelta(mine, theirs, score) {
    const expected = 1 / (1 + Math.pow(10, (theirs - mine) / 400));
    return Math.round(32 * (score - expected));
  }

  function finishMatch(m) {
    m.phase = 'done';
    const [p1, p2] = m.players;
    const winnerIdx = p1.wins > p2.wins ? 0 : p2.wins > p1.wins ? 1 : null;
    const stake = m.room.stake, pot = stake * 2;
    const rake = winnerIdx === null ? 0 : Math.round(pot * m.room.rake);
    const s1 = winnerIdx === null ? 0.5 : winnerIdx === 0 ? 1 : 0;
    const d1 = eloDelta(p1.elo, p2.elo, s1), d2 = eloDelta(p2.elo, p1.elo, 1 - s1);

    db.transaction(() => {
      if (winnerIdx === null) {
        q.addBalance.run(stake, p1.userId); q.addBalance.run(stake, p2.userId);
      } else {
        q.addBalance.run(pot - rake, m.players[winnerIdx].userId);
        addStat('burned', rake * G.ECONOMY.feeSplit.burn);
        addStat('treasury', rake * G.ECONOMY.feeSplit.treasury);
        addStat('season', rake * G.ECONOMY.feeSplit.season);
      }
      const col = s => (s === 1 ? 'wins' : s === 0 ? 'losses' : 'draws');
      db.prepare(`UPDATE users SET elo = MAX(100, elo + ?), ${col(s1)} = ${col(s1)} + 1 WHERE id = ?`).run(d1, p1.userId);
      db.prepare(`UPDATE users SET elo = MAX(100, elo + ?), ${col(1 - s1)} = ${col(1 - s1)} + 1 WHERE id = ?`).run(d2, p2.userId);
      db.prepare(`INSERT INTO matches(id, room_id, p1, p2, winner_id, p1_wins, p2_wins, stake, rake, p1_elo_delta, p2_elo_delta, created_at)
                  VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        m.id, m.room.id, p1.userId, p2.userId, winnerIdx === null ? null : m.players[winnerIdx].userId,
        p1.wins, p2.wins, stake, rake, d1, d2, Date.now());
    })();

    m.players.forEach((p, i) => {
      const op = m.players[1 - i];
      const out = winnerIdx === null ? 'draw' : winnerIdx === i ? 'win' : 'loss';
      const u = q.userById.get(p.userId);
      emitTo(p.userId, 'match:end', {
        matchId: m.id, out, myWins: p.wins, oppWins: op.wins, opponent: op.nickname, room: m.room.name,
        stake, pot, rake, net: out === 'win' ? pot - rake - stake : out === 'loss' ? -stake : 0,
        split: { burn: rake * G.ECONOMY.feeSplit.burn, treasury: rake * G.ECONOMY.feeSplit.treasury, season: rake * G.ECONOMY.feeSplit.season },
        eloDelta: i === 0 ? d1 : d2, profile: publicProfile(u),
      });
      userMatch.delete(p.userId);
    });
    matches.delete(m.id);
    broadcastLobby();
  }

  // ---------- sockets ----------
  function onConnection(socket) {
    const userId = socket.data.userId;
    const prev = sockets.get(userId);
    if (prev && prev !== socket) { prev.emit('session:replaced'); prev.disconnect(true); }
    sockets.set(userId, socket);

    const ack = (fn, work) => {
      try { const r = work(); if (typeof fn === 'function') fn({ ok: true, ...r }); }
      catch (e) { if (typeof fn === 'function') fn({ ok: false, error: e.message }); }
    };

    socket.on('queue:join', (data, fn) => ack(fn, () => {
      const room = joinQueue(userId, Number(data && data.roomId));
      return { room: room.id, profile: publicProfile(q.userById.get(userId)), matched: userMatch.has(userId) };
    }));
    socket.on('queue:leave', (data, fn) => ack(fn, () => {
      leaveQueue(userId, true);
      return { profile: publicProfile(q.userById.get(userId)) };
    }));
    socket.on('match:pick', (data, fn) => ack(fn, () => { pick(userId, String(data && data.matchId), Number(data && data.uid)); return {}; }));

    socket.on('disconnect', () => {
      if (sockets.get(userId) !== socket) return;
      sockets.delete(userId);
      leaveQueue(userId, true); // never leave a ghost in the queue
      broadcastLobby();         // an active match keeps running; timeouts auto-play for an absent player
    });

    // resume an active match after a reload
    const mid = userMatch.get(userId);
    if (mid) { const m = matches.get(mid); emitTo(userId, 'match:state', viewFor(m, m.players.findIndex(p => p.userId === userId))); }
    broadcastLobby();
  }

  return {
    onConnection,
    onlineCount: () => sockets.size,
    activeMatchOf: userId => userMatch.get(userId) || null,
  };
}

module.exports = { createMatchmaker };
