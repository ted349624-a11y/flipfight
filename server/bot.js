const crypto = require('crypto');

// Practice-bot brain.
// Easy plays at random. Normal and Hard play out possible endings of the match many times
// (using the remaining cards, like a player counting cards) and pick the card and side that win most often;
// Normal thinks less and often plays on a whim. Measured with scripts/bot-sim.js.
const rand = () => crypto.randomInt(0, 1e9) / 1e9;

function createBot(G) {
  const cost = c => G.RARITIES[c.rar].cost;

  // Mirror match: the bot gets copies of the player's five cards, so only the play decides the result.
  function buildDeck(playerCards) {
    return playerCards.map((pc, j) => ({ ...pc, uid: 1e9 + j, tid: '#' + crypto.randomInt(1000, 10000) }));
  }
  const leftOf = p => p.hand.filter(c => !p.used.includes(c.uid));
  const options = p => leftOf(p).flatMap(c => [{ card: c, face: 0 }, { card: c, face: 1 }]);

  // returns { card, face }
  function choose(level, me, opp) {
    const opts = options(me);
    if (level === 'easy') return opts[crypto.randomInt(0, opts.length)]; // no plan at all
    if (level === 'normal' && rand() < 0.6) return modelPick(me, opp); // Normal plays on instinct most of the time
    const n = level === 'normal' ? 3 : 10, noise = level === 'normal' ? 0.3 : 0.15;
    let best = null, bestScore = -Infinity;
    for (const o of opts) {
      let score = 0;
      for (let k = 0; k < n; k++) score += rollout(me, opp, o);
      score = score / n + (rand() - 0.5) * noise;
      if (score > bestScore) { bestScore = score; best = o; }
    }
    return best;
  }

  // A plausible human: usually the strongest card or the best element match, then the better-looking side.
  function modelPick(p, opp) {
    const left = leftOf(p), oppSides = leftOf(opp).flatMap(c => [c.el, c.back.el]);
    const ex = c => cost(c) > p.energy;
    const sideScore = (c, f) => {
      const s = G.faceOf(c, f);
      const vs = oppSides.length ? oppSides.reduce((a, el) => a + (G.ELEMENTS[s.el].beats === el ? (s.ab === 'echo' ? 1.6 : 1.3) : 1), 0) / oppSides.length : 1;
      const ab = { shield: 3, trap: 5, drain: 4, rally: 4, ambush: 5, echo: 2 }[s.ab] || 0;
      return (s.pow + (p.bonus || 0) + ab) * vs * (ex(c) ? 0.5 : 1);
    };
    const best = c => (sideScore(c, 1) > sideScore(c, 0) ? 1 : 0);
    const x = rand();
    let card;
    if (x < 0.45) card = left.reduce((a, b) => (sideScore(b, best(b)) > sideScore(a, best(a)) ? b : a));
    else if (x < 0.75) card = left.reduce((a, b) => (sideScore(b, 0) > sideScore(a, 0) ? b : a));
    else card = left[crypto.randomInt(0, left.length)];
    return { card, face: rand() < 0.75 ? best(card) : crypto.randomInt(0, 2) };
  }

  function rollout(me, opp, first) {
    const a = { hand: me.hand, used: me.used.slice(), energy: me.energy, wins: me.wins, bonus: me.bonus || 0 };
    const b = { hand: opp.hand, used: opp.used.slice(), energy: opp.energy, wins: opp.wins, bonus: opp.bonus || 0 };
    let mine = first;
    while (a.used.length < 5 && a.wins < 3 && b.wins < 3) {
      const theirs = modelPick(b, a);
      mine = mine || modelPick(a, b);
      const at = cost(mine.card) > a.energy, bt = cost(theirs.card) > b.energy;
      if (!at) a.energy -= cost(mine.card); if (!bt) b.energy -= cost(theirs.card);
      a.used.push(mine.card.uid); b.used.push(theirs.card.uid);
      const r = G.clash({ card: mine.card, face: mine.face, exhausted: at, bonus: a.bonus }, { card: theirs.card, face: theirs.face, exhausted: bt, bonus: b.bonus });
      a.energy = Math.max(0, a.energy - r.drain[0]); b.energy = Math.max(0, b.energy - r.drain[1]);
      a.bonus = r.nextBonus[0]; b.bonus = r.nextBonus[1];
      if (r.winner === 0) a.wins++; else if (r.winner === 1) b.wins++;
      mine = null;
    }
    return a.wins > b.wins ? 1 : a.wins === b.wins ? 0.5 : 0;
  }

  // FLIP! decisions from a quick look ahead: chance of winning from here
  function winChance(me, opp, n = 40) { let s = 0; for (let k = 0; k < n; k++) s += rollout(me, opp, null); return s / n; }
  function wantsFlip(level, me, opp) {
    if (level === 'easy') return rand() < 0.1;
    return winChance(me, opp) > (level === 'hard' ? 0.72 : 0.8);
  }
  function takesFlip(level, me, opp) {
    if (level === 'easy') return rand() < 0.6;
    return winChance(me, opp) > (level === 'hard' ? 0.25 : 0.35); // a backgammon player's take point is 25%
  }

  const thinkMs = level => (level === 'easy' ? 1200 : 1800) + crypto.randomInt(0, 3200);

  return { buildDeck, choose, modelPick, wantsFlip, takesFlip, thinkMs };
}

module.exports = { createBot };
