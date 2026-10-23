// Game data and rules shared by the server (and sent to the client via /api/config).
// The server is the only authority: the client never decides outcomes.

const ELEMENTS = {
  fire: { name: 'FIRE', beats: 'wind' },
  wind: { name: 'WIND', beats: 'earth' },
  earth: { name: 'EARTH', beats: 'water' },
  water: { name: 'WATER', beats: 'fire' },
};

const RARITIES = {
  common: { name: 'COMMON', cost: 2, rank: 0 },
  rare: { name: 'RARE', cost: 3, rank: 1 },
  epic: { name: 'EPIC', cost: 4, rank: 2 },
  legendary: { name: 'LEGENDARY', cost: 6, rank: 3 },
};

// [name, element, rarity, power] — index is the template id
const TEMPLATES = [
  ['Ember Fox', 'fire', 'common', 28], ['Spark Beetle', 'fire', 'common', 24], ['Breeze Sparrow', 'wind', 'common', 26],
  ['Rock Tortoise', 'earth', 'common', 30], ['Tide Crab', 'water', 'common', 27], ['Lava Golem', 'fire', 'rare', 48],
  ['Storm Eagle', 'wind', 'rare', 52], ['Root Warden', 'earth', 'rare', 46], ['Frost Whale', 'water', 'rare', 50],
  ['Cloud Drake', 'wind', 'epic', 70], ['Abyss Kraken', 'water', 'epic', 68], ['Ashborn Phoenix', 'fire', 'legendary', 94],
  ['Dust Djinn', 'earth', 'common', 25], ['Mist Bat', 'wind', 'common', 23], ['Coral Keeper', 'water', 'rare', 47],
  ['Mountain Titan', 'earth', 'epic', 72], ['Magma Wolf', 'fire', 'epic', 66], ['Sky Leviathan', 'wind', 'legendary', 92],
  ['Elder Treant', 'earth', 'legendary', 96], ['Tidal Serpent', 'water', 'legendary', 90], ['Moss Toad', 'earth', 'common', 22],
  ['Puddle Imp', 'water', 'common', 21], ['Cinder Hawk', 'fire', 'rare', 45], ['Gale Lynx', 'wind', 'rare', 49],
];

const ROOMS = [
  { id: 1, name: 'ROOM 1 · ROOKIE', stake: 20000, limit: 220, rake: 0.05 },
  { id: 2, name: 'ROOM 2 · VETERAN', stake: 100000, limit: 320, rake: 0.05 },
  { id: 3, name: 'ROOM 3 · LEGEND', stake: 500000, limit: null, rake: 0.04 }, // null = no cap
];

// Practice room: free games against a bot. No stake, no deck cap, no ELO, no history.
const PRACTICE = { id: 0, name: 'PRACTICE · VS BOT', stake: 0, limit: null, rake: 0 };
const BOT_LEVELS = {
  easy: { name: 'Easy', elo: 1000 },
  normal: { name: 'Normal', elo: 1200 },
  hard: { name: 'Hard', elo: 1450 },
};

// Fusion (the Forge): combine 2-4 cards of the same rarity for a chance at one card of the next rarity.
// Every card after the first is an independent roll at the base rate, so
//   chance(n cards) = 1 - (1 - base)^(n - 1)
//   common  2 cards 40%   3 cards 64%   4 cards 78.4%
//   rare    2 cards 25%   3 cards 43.8% 4 cards 57.8%
//   epic    2 cards 12%   3 cards 22.6% 4 cards 31.9%
// Success: all used cards are consumed, you get 1 random card of the next rarity.
// Failure: all used cards are consumed, you get 1 random card of the SAME rarity back.
// So every fusion removes at least one card from the game (a card sink), and the FLIP fee is burned.
const FUSION = {
  minCards: 2,
  maxCards: 4,
  keepAtLeast: 5, // you always keep enough cards for a deck
  tiers: {
    common: { to: 'rare', base: 0.40, fee: 5000 },
    rare: { to: 'epic', base: 0.25, fee: 20000 },
    epic: { to: 'legendary', base: 0.12, fee: 60000 },
  },
};
function fusionChance(rarity, n) {
  const t = FUSION.tiers[rarity];
  if (!t || n < FUSION.minCards || n > FUSION.maxCards) return 0;
  return 1 - Math.pow(1 - t.base, n - 1);
}

const PACKS = [
  { id: 'basic', name: 'BASIC PACK', price: 15000, n: 3, odds: { common: 70, rare: 22, epic: 7, legendary: 1 } },
  { id: 'premium', name: 'PREMIUM PACK', price: 60000, n: 3, odds: { common: 0, rare: 65, epic: 28, legendary: 7 } },
];

const ECONOMY = {
  startBalance: 200000,
  startFreePacks: 2,
  dailyBonus: 25000,
  dailyBonusMs: 24 * 60 * 60 * 1000,
  starterTemplates: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  feeSplit: { burn: 0.4, treasury: 0.4, season: 0.2 },
};

const CHAIN_ID = 4663; // Robinhood Chain mainnet (sign-in messages only; nothing is sent on-chain)

const MATCH = { energy: 15, rounds: 5, winsNeeded: 3, turnMs: 20000, revealMs: 2600, deckSize: 5 };

function cardView(row) {
  const t = TEMPLATES[row.tpl];
  return { uid: row.uid, tpl: row.tpl, name: t[0], el: t[1], rar: t[2], pow: t[3], tid: '#' + String(row.token_no).padStart(4, '0') };
}

function effectivePower(card, exhausted, vsElement) {
  const elementBonus = ELEMENTS[card.el].beats === vsElement ? 1.3 : 1;
  return Math.round(card.pow * elementBonus * (exhausted ? 0.5 : 1));
}

module.exports = { FUSION, fusionChance, PRACTICE, BOT_LEVELS, CHAIN_ID, ELEMENTS, RARITIES, TEMPLATES, ROOMS, PACKS, ECONOMY, MATCH, cardView, effectivePower };
