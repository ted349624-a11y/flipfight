// Fusion math check: exact chances, expected cost per upgrade, and a Monte Carlo run of the same roll the server uses.
// node scripts/fusion-sim.js [trials]
const crypto = require('crypto');
const G = require('../shared/game');
const N = Number(process.argv[2]) || 200000;
const fmt = n => Math.round(n).toLocaleString('en-US');
console.log('rarity     cards  chance   sim      cards per upgrade  FLIP per upgrade');
for (const [rar, t] of Object.entries(G.FUSION.tiers)) {
  for (let n = G.FUSION.minCards; n <= G.FUSION.maxCards; n++) {
    const p = G.fusionChance(rar, n);
    let hits = 0; for (let i = 0; i < N; i++) if (crypto.randomInt(0, 1e6) < Math.round(p * 1e6)) hits++;
    // per attempt you lose n cards and get 1 same-rarity card back on failure: net loss n - (1 - p)
    const cardsPerUpgrade = (n - (1 - p)) / p;
    const flipPerUpgrade = t.fee / p;
    console.log(`${rar.padEnd(10)} ${n}      ${(p * 100).toFixed(1).padStart(5)}%  ${(hits / N * 100).toFixed(1).padStart(5)}%   ${cardsPerUpgrade.toFixed(2).padStart(6)} ${rar}s        ${fmt(flipPerUpgrade).padStart(8)}`);
  }
}
