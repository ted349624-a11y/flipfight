// Offline checks with the real rules (two-sided cards included).
// 1) practice-bot strength against typical players   2) flip-side balance: how each ability performs
// node scripts/bot-sim.js [gamesPerTest]
const crypto = require('crypto');
const G = require('../shared/game');
const { createBot } = require('../server/bot');

const bot = createBot(G);
const N = Number(process.argv[2]) || 400;
const cost = c => G.RARITIES[c.rar].cost;
const card = (tpl, uid) => G.cardView({ uid, tpl, token_no: 1000 + uid });
const starter = [0, 3, 5, 6, 4].map(card); // a typical new-player deck (2 commons + 3 rares)
const left = p => p.hand.filter(c => !p.used.includes(c.uid));

const players = {
  frontOnly: (me, opp) => ({ ...bot.modelPick(me, opp), face: 0 }), // never flips
  randomSide: me => { const l = left(me); return { card: l[crypto.randomInt(0, l.length)], face: crypto.randomInt(0, 2) }; },
  instinct: (me, opp) => bot.modelPick(me, opp),                     // a sensible human
};

// plays one match; returns 'a' | 'b' | 'draw' and collects per-side stats
function play(pickA, pickB, deckA, deckB, stats) {
  const A = { hand: deckA, used: [], energy: 15, wins: 0, bonus: 0 }, B = { hand: deckB, used: [], energy: 15, wins: 0, bonus: 0 };
  while (A.used.length < 5 && A.wins < 3 && B.wins < 3) {
    const a = pickA(A, B), b = pickB(B, A);
    const ax = cost(a.card) > A.energy, bx = cost(b.card) > B.energy;
    if (!ax) A.energy -= cost(a.card); if (!bx) B.energy -= cost(b.card);
    A.used.push(a.card.uid); B.used.push(b.card.uid);
    const r = G.clash({ card: a.card, face: a.face, exhausted: ax, bonus: A.bonus }, { card: b.card, face: b.face, exhausted: bx, bonus: B.bonus });
    A.energy = Math.max(0, A.energy - r.drain[0]); B.energy = Math.max(0, B.energy - r.drain[1]);
    A.bonus = r.nextBonus[0]; B.bonus = r.nextBonus[1];
    if (r.winner === 0) A.wins++; else if (r.winner === 1) B.wins++;
    if (stats) [0, 1].forEach(i => {
      const key = r.sides[i].ab || 'front';
      const s = stats[key] || (stats[key] = { played: 0, won: 0 });
      s.played++; if (r.winner === i) s.won++;
    });
  }
  return A.wins > B.wins ? 'a' : A.wins < B.wins ? 'b' : 'draw';
}
const randomDeck = base => Array.from({ length: 5 }, (_, j) => card(crypto.randomInt(0, G.TEMPLATES.length), base + j));
const pct = (x, n) => `${(x / n * 100).toFixed(0)}%`;

console.log('— practice bot vs typical players (mirror decks, starter cards) —');
for (const [name, human] of Object.entries(players)) {
  const row = Object.keys(G.BOT_LEVELS).map(level => {
    let w = 0;
    for (let i = 0; i < N; i++) if (play((me, op) => bot.choose(level, me, op), human, bot.buildDeck(starter), starter) === 'a') w++;
    return `${level} ${pct(w, N)}`;
  });
  console.log(`vs ${name.padEnd(10)} → bot wins: ${row.join(' | ')}`);
}

console.log('\n— does flipping matter? random decks, 4×N matches —');
let w = 0, d = 0;
for (let i = 0; i < N * 4; i++) { const r = play(players.instinct, players.frontOnly, randomDeck(0), randomDeck(100)); if (r === 'a') w++; if (r === 'draw') d++; }
console.log(`flip-aware player vs front-only player: wins ${pct(w, N * 4)}, draws ${pct(d, N * 4)}`);

console.log('\n— round win rate by face-up side (both players use sides by instinct) —');
const stats = {};
for (let i = 0; i < N * 6; i++) play(players.instinct, players.instinct, randomDeck(0), randomDeck(100), stats);
const total = Object.values(stats).reduce((a, s) => a + s.played, 0);
for (const [k, s] of Object.entries(stats).sort((x, y) => y[1].played - x[1].played))
  console.log(`${k.padEnd(7)} played ${pct(s.played, total).padStart(4)} of rounds · wins ${pct(s.won, s.played)} of them`);
