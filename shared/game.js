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

// Seasons: every season lasts 7 days. Your ELO is your season rating.
// To earn a reward you must play at least `minMatches` ranked matches in the season.
// Rewards by final place among qualified players:
//   1st 1,000,000   2nd 500,000   3rd 250,000
//   4th-100th: 800,000 / place, rounded down to the nearest 1,000  (4th 200,000 · 10th 80,000 · 50th 16,000 · 100th 8,000)
// The top 3 also get a permanent badge for that season.
// When a season ends, ratings move halfway back to 1200 (1500 -> 1350, 1000 -> 1100) and season stats reset.
const SEASON = {
  lengthMs: 7 * 24 * 60 * 60 * 1000,
  minMatches: 3,
  paidPlaces: 100,
  topRewards: [1000000, 500000, 250000],
  curveNumerator: 800000,
  resetTo: 1200,
  resetKeep: 0.5,
};
function seasonReward(place) {
  if (place < 1 || place > SEASON.paidPlaces) return 0;
  if (place <= SEASON.topRewards.length) return SEASON.topRewards[place - 1];
  return Math.floor(SEASON.curveNumerator / place / 1000) * 1000;
}
function seasonResetElo(elo) { return Math.round(SEASON.resetTo + (elo - SEASON.resetTo) * SEASON.resetKeep); }

// Rank tiers by ELO (lowest first).
const TIERS = [
  { id: 'bronze', name: 'Bronze', min: 0, color: '#c98a4b' },
  { id: 'silver', name: 'Silver', min: 1150, color: '#c9d1e0' },
  { id: 'gold', name: 'Gold', min: 1300, color: '#ffcc33' },
  { id: 'platinum', name: 'Platinum', min: 1450, color: '#5fd3c8' },
  { id: 'diamond', name: 'Diamond', min: 1600, color: '#8fb8ff' },
  { id: 'master', name: 'Master', min: 1800, color: '#ff6bd6' },
];
function tierOf(elo) { let t = TIERS[0]; for (const x of TIERS) if (elo >= x.min) t = x; return t; }

// Marketplace: players list cards for FLIP. The buyer pays the price; the seller receives it minus a 5% fee
// (half burned, half to the treasury). Listed cards can't be used in decks or the Forge until the listing is cancelled.
const MARKET = {
  fee: 0.05,
  minPrice: 1000,
  maxPrice: 100000000,
  maxListings: 20,
  suggested: { common: 8000, rare: 30000, epic: 90000, legendary: 300000 },
};

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

module.exports = { SEASON, seasonReward, seasonResetElo, TIERS, tierOf, MARKET, FUSION, fusionChance, PRACTICE, BOT_LEVELS, CHAIN_ID, ELEMENTS, RARITIES, TEMPLATES, ROOMS, PACKS, ECONOMY, MATCH, cardView, effectivePower };
