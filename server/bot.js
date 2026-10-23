const crypto = require('crypto');

// Practice-bot brain.
// Easy plays at random. Normal and Hard play out possible endings of the match many times
// (using the remaining cards, like a player counting cards) and pick the card that wins most often;
// Normal thinks less and often plays on a whim. Measured with scripts/bot-sim.js.
const rand = () => crypto.randomInt(0, 1e9) / 1e9;

function createBot(G) {
  const cost = c => G.RARITIES[c.rar].cost;

  // Mirror match: the bot gets copies of the player's five cards, so only the play decides the result.
  function buildDeck(playerCards) {
    return playerCards.map((pc, j) => ({ ...pc, uid: 1e9 + j, tid: '#' + crypto.randomInt(1000, 10000) }));
  }

  function choose(level, me, opp) {
    const left = me.hand.filter(c => !me.used.includes(c.uid));
    if (left.length === 1) return left[0];
    if (level === 'easy') return left[crypto.randomInt(0, left.length)]; // no plan at all

    // Normal thinks a little (a few playouts, more noise); Hard thinks a lot.
    if (level === 'normal' && rand() < 0.6) return left[crypto.randomInt(0, left.length)]; // Normal still slips up
    const n = level === 'normal' ? 3 : 12, noise = level === 'normal' ? 0.3 : 0.2;
    let best = null, bestScore = -Infinity;
    for (const c of left) {
      let score = 0;
      for (let k = 0; k < n; k++) score += rollout(me, opp, c);
      score = score / n + (rand() - 0.5) * noise;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  // A plausible human: often plays their strongest card, sometimes the best element match, sometimes anything.
  function modelPick(p, vsEls) {
    const left = p.hand.filter(c => !p.used.includes(c.uid));
    const eff = c => (cost(c) > p.energy ? c.pow / 2 : c.pow);
    const x = rand();
    if (x < 0.4) return left.reduce((a, b) => (eff(b) > eff(a) ? b : a));
    if (x < 0.7 && vsEls.length) {
      const sc = c => vsEls.reduce((a, el) => a + G.effectivePower(c, cost(c) > p.energy, el), 0);
      return left.reduce((a, b) => (sc(b) > sc(a) ? b : a));
    }
    return left[crypto.randomInt(0, left.length)];
  }
  const ROLLOUTS = 160;
  function rollout(me, opp, first) {
    const a = { hand: me.hand, used: me.used.slice(), energy: me.energy, wins: me.wins };
    const b = { hand: opp.hand, used: opp.used.slice(), energy: opp.energy, wins: opp.wins };
    let mine = first;
    while (a.used.length < 5 && a.wins < 3 && b.wins < 3) {
      const elsOf = p => p.hand.filter(c => !p.used.includes(c.uid)).map(c => c.el);
      const theirs = modelPick(b, elsOf(a));
      mine = mine || modelPick(a, elsOf(b));
      const at = cost(mine) > a.energy, bt = cost(theirs) > b.energy;
      if (!at) a.energy -= cost(mine); if (!bt) b.energy -= cost(theirs);
      a.used.push(mine.uid); b.used.push(theirs.uid);
      const pa = G.effectivePower(mine, at, theirs.el), pb = G.effectivePower(theirs, bt, mine.el);
      if (pa > pb) a.wins++; else if (pb > pa) b.wins++;
      mine = null;
    }
    return a.wins > b.wins ? 1 : a.wins === b.wins ? 0.5 : 0;
  }

  const thinkMs = level => (level === 'easy' ? 1200 : 1800) + crypto.randomInt(0, 3200);

  return { buildDeck, choose, thinkMs };
}

module.exports = { createBot };
