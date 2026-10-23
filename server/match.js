const crypto = require('crypto');
const { createBot } = require('./bot');

// Matchmaking queues and the server-authoritative match engine.
// Live match state is kept in memory; balances, ELO and results are written to the database.
function createMatchmaker({ io, db, q, G, validateDeck, publicProfile, badgesOf, clanOf = () => null, onWinTx, getBoss = () => null }) {
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
      const human = { userId: u.id, nickname: u.nickname, clan: clanOf(u.clan_id), elo: u.elo, hand: cards, used: [], energy: G.MATCH.energy, wins: 0, pick: null, face: 0, bonus: 0, auto: false };
      const botP = { userId: BOT_ID, isBot: true, nickname: `Training Bot · ${G.BOT_LEVELS[level].name}`, elo: G.BOT_LEVELS[level].elo,
        hand: bot.buildDeck(cards), used: [], energy: G.MATCH.energy, wins: 0, pick: null, face: 0, bonus: 0, auto: false };
      const m = { id: crypto.randomUUID(), room: G.PRACTICE, practice: true, level, players: [human, botP], round: 1, phase: 'pick', deadline: 0, timer: null, botTimer: null, log: [], mult: 1, flip: null };
      matches.set(m.id, m);
      userMatch.set(userId, m.id);
      broadcastLobby();
      startRound(m);
      return m.id;
    } finally { busy.delete(userId); }
  }

  // ---------- world boss fight (a practice-style match against the boss deck) ----------
  async function startBoss(userId) {
    if (busy.has(userId)) throw new Error('Please wait a moment.');
    if (userMatch.has(userId)) throw new Error('You are already in a match.');
    if (userQueue.has(userId)) throw new Error('Cancel your search before fighting the boss.');
    const bossMod = getBoss(); if (!bossMod) throw new Error('The boss is not here yet.');
    busy.add(userId);
    try {
      const deckRow = await q.deckOf(userId, G.BOSS_ROOM.id);
      if (!deckRow) throw new Error('Pick your 5 cards first.');
      const { cards } = await validateDeck(userId, G.BOSS_ROOM.id, JSON.parse(deckRow.card_uids));
      const cur = await bossMod.useAttempt(userId); // throws when no fights are left today
      const u = await q.userById(userId);
      const human = { userId: u.id, nickname: u.nickname, clan: clanOf(u.clan_id), elo: u.elo, hand: cards, used: [], energy: G.MATCH.energy, wins: 0, pick: null, face: 0, bonus: 0, auto: false };
      const b = { userId: BOT_ID, isBot: true, nickname: cur.boss.name, elo: 2000, hand: G.bossDeck(cur.boss), used: [], energy: G.BOSS.energy, wins: 0, pick: null, face: 0, bonus: 0, auto: false };
      const m = { id: crypto.randomUUID(), room: G.BOSS_ROOM, practice: true, boss: { id: cur.boss.id, name: cur.boss.name, el: cur.boss.el }, level: 'hard',
        players: [human, b], round: 1, phase: 'pick', deadline: 0, timer: null, botTimer: null, log: [], mult: 1, flip: null };
      matches.set(m.id, m); userMatch.set(userId, m.id);
      broadcastLobby(); startRound(m);
      return m.id;
    } finally { busy.delete(userId); }
  }
  async function finishBoss(m) {
    m.phase = 'done';
    const [p, b] = m.players;
    const out = p.wins > b.wins ? 'win' : p.wins < b.wins ? 'loss' : 'draw';
    const damage = G.bossDamage(m.log.map(r => r.powers[0]), m.log.filter(r => r.winner === 0).length, out === 'win');
    userMatch.delete(p.userId); matches.delete(m.id);
    let hit = null;
    try { hit = await getBoss().recordFight(p.userId, damage); } catch (e) { log(e); }
    emitTo(p.userId, 'match:end', {
      matchId: m.id, practice: true, boss: { ...m.boss, damage, dealt: hit ? hit.dealt : 0, hp: hit ? hit.hp : null, maxHp: hit ? hit.maxHp : null, killed: !!(hit && hit.killed) },
      out, myWins: p.wins, oppWins: b.wins, opponent: b.nickname, room: m.room.name, mult: 1, folded: null,
      stake: 0, pot: 0, rake: 0, net: 0, split: { burn: 0, treasury: 0, season: 0 }, eloDelta: 0, profile: publicProfile(await q.userById(p.userId)),
    });
    broadcastLobby();
  }

  function botPick(m) {
    const b = m.players.find(p => p.isBot);
    if (!b || m.phase !== 'pick' || b.pick !== null) return;
    const human = m.players.find(p => !p.isBot);
    const choice = bot.choose(m.level, b, human);
    b.pick = choice.card.uid; b.face = choice.face;
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
      return { userId: u.id, nickname: u.nickname, clan: clanOf(u.clan_id), elo: u.elo, badges: badgesOf ? (await badgesOf([u.id]))[u.id] || [] : [], hand: e.cards, used: [], energy: G.MATCH.energy, wins: 0, pick: null, face: 0, bonus: 0, auto: false };
    };
    const m = { id, room, players: [await mk(a), await mk(b)], round: 1, phase: 'pick', deadline: 0, timer: null, log: [], mult: 1, flip: null };
    matches.set(m.id, m);
    broadcastLobby();
    startRound(m);
  }

  function startRound(m) {
    m.phase = 'pick';
    m.deadline = Date.now() + G.MATCH.turnMs;
    m.players.forEach(p => { p.pick = null; p.face = 0; p.auto = false; });
    clearTimeout(m.timer);
    m.timer = setTimeout(() => timeoutRound(m), G.MATCH.turnMs + 500);
    emitState(m);
    if (m.practice) {
      clearTimeout(m.botTimer);
      const b = m.players[1];
      if (canCall(m, 1) && bot.wantsFlip(m.level, b, m.players[0])) m.botTimer = setTimeout(() => callFlip(BOT_ID, m.id).catch(log), 900 + crypto.randomInt(0, 900));
      else m.botTimer = setTimeout(() => botPick(m), bot.thinkMs(m.level));
    }
  }

  // ---------- FLIP! call ----------
  const entryOf = m => m.room.stake * m.mult; // what each player has in the pot right now
  function canCall(m, idx) {
    const p = m.players[idx];
    return !m.boss && m.phase === 'pick' && !m.flip && m.calling === undefined && m.round >= G.FLIP_CALL.fromRound && !p.calledFlip && p.pick === null && m.mult * 2 <= G.FLIP_CALL.maxMult;
  }
  async function callFlip(userId, matchId) {
    const m = matches.get(matchId || userMatch.get(userId));
    if (!m || (userId !== BOT_ID && userMatch.get(userId) !== m.id)) throw new Error('This match is over.');
    const idx = m.players.findIndex(p => p.userId === userId);
    if (!canCall(m, idx)) throw new Error('You can\'t call FLIP right now.');
    const extra = entryOf(m), round = m.round;
    m.calling = idx; // blocks picks and other calls while the payment goes through
    let paid = false;
    try { paid = m.players[idx].isBot || (await q.spendBalance(userId, extra)); } finally { delete m.calling; }
    if (!paid) throw new Error(`You need ${extra.toLocaleString('en-US')} FLIP to call.`);
    if (m.phase !== 'pick' || m.round !== round || !matches.has(m.id)) { if (!m.players[idx].isBot) await q.addBalance(userId, extra); throw new Error('Too late: the round moved on.'); }
    m.players[idx].calledFlip = true;
    clearTimeout(m.timer); clearTimeout(m.botTimer);
    m.flip = { by: idx, extra, left: Math.max(3000, m.deadline - Date.now()), deadline: Date.now() + G.FLIP_CALL.answerMs };
    m.phase = 'flip';
    m.timer = setTimeout(() => answerFlip(m.players[1 - idx].userId, m.id, null).catch(log), G.FLIP_CALL.answerMs + 300);
    emitState(m);
    if (m.practice && m.players[1 - idx].isBot) m.botTimer = setTimeout(() => answerFlip(BOT_ID, m.id, bot.takesFlip(m.level, m.players[1], m.players[0])).catch(log), 1400 + crypto.randomInt(0, 1200));
  }
  // accept: true / false; null = no answer (accept if affordable)
  async function answerFlip(userId, matchId, accept) {
    const m = matches.get(matchId);
    if (!m || m.phase !== 'flip' || !m.flip) return;
    const idx = m.players.findIndex(p => p.userId === userId);
    if (idx < 0 || idx === m.flip.by) throw new Error('Not your call to answer.');
    const f = m.flip, me = m.players[idx];
    m.flip = null; clearTimeout(m.timer); clearTimeout(m.botTimer); // answer only once
    let ok = accept !== false;
    if (ok && !me.isBot) ok = await q.spendBalance(me.userId, f.extra);
    if (!ok) { // fold: the caller wins now at the current level; refund the caller's extra
      if (!m.players[f.by].isBot) await q.addBalance(m.players[f.by].userId, f.extra);
      m.folded = { by: idx };
      m.phase = 'done';
      emitState(m);
      return m.practice ? finishPractice(m, f.by) : finishMatch(m, f.by);
    }
    m.mult *= 2;
    m.lastFlip = { by: f.by, mult: m.mult, at: Date.now() };
    m.phase = 'pick';
    m.deadline = Date.now() + f.left + 1500;
    m.timer = setTimeout(() => timeoutRound(m), f.left + 2000);
    emitState(m);
    if (m.practice && m.players[1].pick === null) m.botTimer = setTimeout(() => botPick(m), bot.thinkMs(m.level));
  }

  function viewFor(m, idx) {
    const me = m.players[idx], op = m.players[1 - idx];
    return {
      matchId: m.id,
      room: { id: m.room.id, name: m.room.name, stake: m.room.stake, practice: !!m.practice, level: m.level || null, boss: m.boss || null },
      round: m.round, phase: m.phase, deadline: m.deadline, serverNow: Date.now(),
      mult: m.mult, entry: entryOf(m), canCall: canCall(m, idx), lastFlip: m.lastFlip ? { mine: m.lastFlip.by === idx, mult: m.lastFlip.mult, at: m.lastFlip.at } : null,
      flipCall: m.flip ? { mine: m.flip.by === idx, extra: m.flip.extra, deadline: m.flip.deadline } : null,
      folded: m.folded ? { me: m.folded.by === idx } : null,
      you: { calledFlip: !!me.calledFlip, clan: me.clan || null, nickname: me.nickname, elo: me.elo, badges: me.badges || [], hand: me.hand, used: me.used, energy: me.energy, wins: me.wins, pick: me.pick, face: me.face, bonus: me.bonus },
      opp: {
        calledFlip: !!op.calledFlip, clan: op.clan || null, nickname: op.nickname, elo: op.elo, badges: op.badges || [], energy: op.energy, wins: op.wins, locked: op.pick !== null, bonus: op.bonus,
        leftElements: op.hand.filter(c => !op.used.includes(c.uid)).map(c => c.el),
        leftSides: op.hand.filter(c => !op.used.includes(c.uid)).map(c => [c.el, c.back.el]),
      },
      log: m.log.map(r => ({
        round: r.round, mine: played(r, idx), theirs: played(r, 1 - idx), myPower: r.powers[idx], theirPower: r.powers[1 - idx],
        myExhausted: r.exhausted[idx], theirExhausted: r.exhausted[1 - idx], myAuto: r.auto[idx],
        myEvents: r.events[idx], theirEvents: r.events[1 - idx],
        result: r.winner === null ? 'tie' : r.winner === idx ? 'win' : 'loss',
      })),
    };
  }

  // the card as it ended up face up in a round (after any FLIP TRAP)
  function played(r, i) {
    const c = r.cards[i], f = G.faceOf(c, r.faces[i]);
    return { ...c, name: f.name, el: f.el, pow: f.pow, ab: f.ab, face: r.faces[i], chosenFace: r.chosen[i], flipped: r.flipped[i] };
  }

  function emitState(m) { m.players.forEach((p, i) => emitTo(p.userId, 'match:state', viewFor(m, i))); }

  function pick(userId, matchId, uid, face) {
    const m = matches.get(matchId);
    if (!m || userMatch.get(userId) !== matchId) throw new Error('This match is over.');
    if (m.phase !== 'pick' || m.calling !== undefined) throw new Error('Wait for the next round.');
    const p = m.players.find(x => x.userId === userId);
    if (p.pick !== null) throw new Error('You already locked a card this round.');
    const card = p.hand.find(c => c.uid === uid);
    if (!card || p.used.includes(uid)) throw new Error('That card is not available.');
    p.pick = uid; p.face = face === 1 ? 1 : 0;
    if (m.players.every(x => x.pick !== null)) resolveRound(m);
    else emitState(m);
  }

  function timeoutRound(m) {
    if (m.phase !== 'pick') return;
    if (m.calling !== undefined) { m.timer = setTimeout(() => timeoutRound(m), 300); return; } // a FLIP! payment is in flight
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
    const [a, b] = m.players;
    const res = G.clash({ card: cards[0], face: a.face, exhausted: exhausted[0], bonus: a.bonus }, { card: cards[1], face: b.face, exhausted: exhausted[1], bonus: b.bonus });
    m.players.forEach((p, i) => { p.energy = Math.max(0, p.energy - res.drain[i]); p.bonus = res.nextBonus[i]; });
    const { powers, winner } = res;
    if (winner !== null) m.players[winner].wins++;
    m.log.push({ round: m.round, cards, chosen: [a.face, b.face], faces: res.faces, flipped: res.flipped, events: res.events, powers, exhausted, auto: m.players.map(p => p.auto), winner });
    emitState(m);
    const over = m.players.some(p => p.wins >= G.MATCH.winsNeeded) || m.log.length >= G.MATCH.rounds;
    m.timer = setTimeout(() => {
      if (!matches.has(m.id) || m.phase === 'done') return; // practice match was left early, or someone folded
      if (over) (m.practice ? finishPractice(m) : finishMatch(m).catch(log));
      else { m.round++; startRound(m); }
    }, G.MATCH.revealMs);
  }

  function eloDelta(mine, theirs, score) {
    const expected = 1 / (1 + Math.pow(10, (theirs - mine) / 400));
    return Math.round(32 * (score - expected));
  }

  async function finishPractice(m, forced) {
    if (m.boss) return finishBoss(m);
    m.phase = 'done';
    const [p, b] = m.players;
    const out = forced !== undefined ? (forced === 0 ? 'win' : 'loss') : p.wins > b.wins ? 'win' : p.wins < b.wins ? 'loss' : 'draw';
    userMatch.delete(p.userId);
    matches.delete(m.id);
    emitTo(p.userId, 'match:end', {
      matchId: m.id, practice: true, level: m.level, out, myWins: p.wins, oppWins: b.wins, opponent: b.nickname, room: m.room.name, mult: m.mult, folded: m.folded ? (m.folded.by === 0 ? 'me' : 'them') : null,
      stake: 0, pot: 0, rake: 0, net: 0, split: { burn: 0, treasury: 0, season: 0 }, eloDelta: 0,
      profile: publicProfile(await q.userById(p.userId)),
    });
    broadcastLobby();
  }

  async function finishMatch(m, forced) {
    m.phase = 'done';
    const [p1, p2] = m.players;
    const winnerIdx = forced !== undefined ? forced : p1.wins > p2.wins ? 0 : p2.wins > p1.wins ? 1 : null;
    const stake = entryOf(m), pot = stake * 2;
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
      if (winnerIdx !== null && onWinTx) await onWinTx(m.players[winnerIdx].userId, c); // clan season point
      // living cards: every card played gets a round played, and a round won if it took the round
      const tally = new Map();
      for (const r of m.log) r.cards.forEach((card, i) => {
        const t = tally.get(card.uid) || { plays: 0, wins: 0 }; t.plays++; if (r.winner === i) t.wins++; tally.set(card.uid, t);
      });
      for (const [uid, t] of tally) await db.query('UPDATE cards SET plays = plays + $1, wins = wins + $2 WHERE uid = $3', [t.plays, t.wins, uid], c);
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
        matchId: m.id, out, myWins: p.wins, oppWins: op.wins, opponent: op.nickname, room: m.room.name, mult: m.mult, folded: m.folded ? (m.folded.by === i ? 'me' : 'them') : null,
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
    socket.on('boss:start', (data, fn) => handle(fn, async () => ({ matchId: await startBoss(userId) })));
    socket.on('practice:start', (data, fn) => handle(fn, async () => ({ matchId: await startPractice(userId, String(data && data.level)) })));
    socket.on('match:quit', (data, fn) => handle(fn, () => { quitPractice(userId); return {}; }));
    socket.on('match:flip', (data, fn) => handle(fn, async () => { await callFlip(userId, String(data && data.matchId)); return {}; }));
    socket.on('match:flip-answer', (data, fn) => handle(fn, async () => { await answerFlip(userId, String(data && data.matchId), !!(data && data.accept)); return {}; }));
    socket.on('match:pick', (data, fn) => handle(fn, () => { pick(userId, String(data && data.matchId), Number(data && data.uid), Number(data && data.face)); return {}; }));

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
