// Offline check of the practice bot: plays thousands of games with the real rules and reports bot win rates.
// node scripts/bot-sim.js [gamesPerLevel]
const crypto = require('crypto');
const G = require('../shared/game');
const { createBot } = require('../server/bot');

const bot = createBot(G);
const N = Number(process.argv[2]) || 500;
const cost = c => G.RARITIES[c.rar].cost;

// A typical new-player deck: the Rookie default (2 commons + 3 rares).
const starter = [0, 3, 5, 6, 4].map((tpl, j) => ({ uid: j, tpl, name: G.TEMPLATES[tpl][0], el: G.TEMPLATES[tpl][1], rar: G.TEMPLATES[tpl][2], pow: G.TEMPLATES[tpl][3] }));

const humans = {
  mixed: (me, opp) => { const x = crypto.randomInt(0, 100); return x < 40 ? humans.greedy(me) : x < 70 ? humans.elementAware(me, opp) : humans.random(me); },
  random: me => { const left = me.hand.filter(c => !me.used.includes(c.uid)); return left[crypto.randomInt(0, left.length)]; },
  greedy: me => { const left = me.hand.filter(c => !me.used.includes(c.uid)); return left.reduce((a, b) => (b.pow > a.pow ? b : a)); },
  elementAware: (me, opp) => { const left = me.hand.filter(c => !me.used.includes(c.uid)), els = opp.hand.filter(c => !opp.used.includes(c.uid)).map(c => c.el);
    const sc = c => els.reduce((a, el) => a + G.effectivePower(c, G.RARITIES[c.rar].cost > me.energy, el), 0); return left.reduce((a, b) => (sc(b) > sc(a) ? b : a)); },
};

function play(level, humanPick) {
  const h = { hand: starter, used: [], energy: 15, wins: 0 };
  const b = { hand: bot.buildDeck(starter), used: [], energy: 15, wins: 0 };
  for (let r = 0; r < 5 && h.wins < 3 && b.wins < 3; r++) {
    const hc = humanPick(h, b), bc = bot.choose(level, b, h);
    const ht = cost(hc) > h.energy, bt = cost(bc) > b.energy;
    if (!ht) h.energy -= cost(hc); if (!bt) b.energy -= cost(bc);
    h.used.push(hc.uid); b.used.push(bc.uid);
    const a = G.effectivePower(hc, ht, bc.el), z = G.effectivePower(bc, bt, hc.el);
    if (a > z) h.wins++; else if (z > a) b.wins++;
  }
  return b.wins > h.wins ? 'bot' : b.wins < h.wins ? 'human' : 'draw';
}

for (const [hname, hp] of Object.entries(humans)) {
  const row = Object.keys(G.BOT_LEVELS).map(level => {
    let bw = 0; for (let i = 0; i < N; i++) if (play(level, hp) === 'bot') bw++;
    return `${level} ${(bw / N * 100).toFixed(0)}%`;
  });
  console.log(`vs ${hname} player → bot wins: ${row.join(' | ')}`);
}
