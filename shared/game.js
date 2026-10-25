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

// Flip side of every card: [name, element, power, ability] — same index as TEMPLATES.
// When you play a card you choose which side faces up. The back is a little weaker (93–98% power) but has another
// element and an ability. Balanced with scripts/bot-sim.js: a player who uses both sides beats one who never flips ~60%.
const BACKS = [
  ['Ash Fox', 'wind', 27, 'shield'], ['Husk Beetle', 'earth', 22, 'trap'], ['Rain Sparrow', 'water', 25, 'rally'],
  ['Shell Tortoise', 'water', 29, 'shield'], ['Sand Crab', 'earth', 25, 'ambush'], ['Obsidian Golem', 'earth', 47, 'shield'],
  ['Thunder Eagle', 'fire', 51, 'echo'], ['Thorn Warden', 'wind', 43, 'trap'], ['Ice Whale', 'wind', 49, 'drain'],
  ['Storm Drake', 'water', 68, 'rally'], ['Kraken Lord', 'earth', 63, 'trap'], ['Reborn Phoenix', 'water', 92, 'echo'],
  ['Sand Djinn', 'fire', 25, 'drain'], ['Night Bat', 'water', 21, 'ambush'], ['Reef Keeper', 'earth', 46, 'rally'],
  ['Iron Titan', 'fire', 70, 'shield'], ['Smoke Wolf', 'wind', 61, 'ambush'], ['Void Leviathan', 'earth', 90, 'drain'],
  ['Ancient Treant', 'water', 93, 'shield'], ['Storm Serpent', 'wind', 84, 'trap'], ['Bog Toad', 'water', 22, 'echo'],
  ['Steam Imp', 'fire', 20, 'trap'], ['Ember Hawk', 'wind', 42, 'ambush'], ['Frost Lynx', 'water', 48, 'echo'],
];
const ABILITIES = {
  shield: { name: 'SHIELD', text: 'Wins the round on a tie.' },
  trap: { name: 'FLIP TRAP', text: "Flips the opponent's card to its other side before the clash; the flipped card gets −8 power." },
  drain: { name: 'DRAIN', text: 'Your opponent loses 2 energy.' },
  rally: { name: 'RALLY', text: 'Your next card gets +10 power.' },
  echo: { name: 'ECHO', text: 'Your element bonus is +60% instead of +30%.' },
  ambush: { name: 'AMBUSH', text: '+20 power against a card that costs more energy.' },
};
const ABILITY_NUM = { rally: 10, ambush: 20, drain: 2, echo: 1.6, element: 1.3, trapStun: 8 };

const ROOMS = [
  { id: 1, name: 'ROOM 1 · ROOKIE', stake: 20000, limit: 220, rake: 0.05 },
  { id: 2, name: 'ROOM 2 · VETERAN', stake: 100000, limit: 320, rake: 0.05 },
  { id: 3, name: 'ROOM 3 · LEGEND', stake: 500000, limit: null, rake: 0.04 }, // null = no cap
  // Ante room: no FLIP entry. Each player puts one card from their deck on the line and is paired with someone
  // who antes a card of the same rarity. The winner takes the loser's ante card. Ranked (ELO and clan points count).
  { id: 4, name: 'ROOM 4 · ANTE', stake: 0, limit: null, rake: 0, ante: true },
];

// World boss: one boss per weekly season, shared HP for the whole island. Everyone gets 15 free fights a day
// (UTC). A fight is a match against the boss's own deck; your damage =
//   10 x (total final power of your cards over the match) + 2,500 per round won + 10,000 for winning the match.
// If the boss falls before the week ends, everyone who hit it gets 25,000 FLIP and the top 3 damage dealers get
// 100,000 / 50,000 / 25,000 more and a permanent boss badge. Bosses rotate every week.
const BOSS_ROOM = { id: 9, name: 'WORLD BOSS', stake: 0, limit: null, rake: 0 };
const BOSS = {
  hp: 250000, fightsPerDay: 15, energy: 20,
  damage: { perPower: 10, perRound: 2500, win: 10000 },
  rewards: { all: 25000, top: [100000, 50000, 25000] },
  bosses: [
    { id: 'leviathan', name: 'The Leviathan', el: 'water', cards: ['Tidal Maw', 'Abyssal Coil', 'Brine Fang', 'Deep Gaze', 'Foam Lash'] },
    { id: 'wyrm', name: 'Infernal Wyrm', el: 'fire', cards: ['Molten Jaw', 'Cinder Wing', 'Ash Breath', 'Ember Eye', 'Slag Tail'] },
    { id: 'colossus', name: 'Stone Colossus', el: 'earth', cards: ['Granite Fist', 'Quake Stomp', 'Moss Shoulder', 'Boulder Heart', 'Pebble Swarm'] },
    { id: 'roc', name: 'Tempest Roc', el: 'wind', cards: ['Storm Talon', 'Gale Wing', 'Thunder Cry', 'Sky Dive', 'Feather Storm'] },
    // stands in the plaza instead of rising from the sea; much tougher
    { id: 'titan', name: 'The Iron Titan', el: 'fire', hp: 5000000, spot: 'plaza', cards: ['Molten Core', 'Iron Fist', 'Rivet Storm', 'Furnace Gaze', 'Slag Stomp'] },
  ],
  // put this boss in place of the current week's boss once per key (fresh HP, fresh leaderboard, today's fights reset).
  // A new key brings it back again (titan-2: the Titan returns with 5,000,000 HP after it fell).
  startNow: { id: 'titan', key: 'titan-2' },
};
const bossOf = seasonNumber => BOSS.bosses[(Math.max(1, seasonNumber) - 1) % BOSS.bosses.length];
// The boss's five cards: its element on the front, the other elements (with abilities) on the back.
function bossDeck(boss) {
  const order = ['fire', 'wind', 'earth', 'water'], i = order.indexOf(boss.el);
  const backs = [order[(i + 1) % 4], order[(i + 2) % 4], order[(i + 3) % 4], order[(i + 1) % 4], order[(i + 3) % 4]];
  const rar = ['legendary', 'epic', 'epic', 'rare', 'rare'], pow = [88, 72, 70, 54, 52], ab = ['trap', 'shield', 'drain', 'echo', 'rally'];
  return boss.cards.map((name, j) => ({ uid: 2e9 + j, tpl: 100 + j * 7 + i, name, el: boss.el, rar: rar[j], pow: pow[j], tid: 'BOSS',
    back: { name: name + ' II', el: backs[j], pow: Math.round(pow[j] * 0.94), ab: ab[j] } }));
}
function bossDamage(myPowers, roundsWon, wonMatch) {
  const d = BOSS.damage;
  return myPowers.reduce((a, p) => a + p, 0) * d.perPower + roundsWon * d.perRound + (wonMatch ? d.win : 0);
}

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
  startBalance: 500000,
  startFreePacks: 2,
  dailyBonus: 25000,
  dailyBonusMs: 24 * 60 * 60 * 1000,
  starterTemplates: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  feeSplit: { burn: 0.4, treasury: 0.4, season: 0.2 },
};

// Clans: anyone can found one for 50,000 FLIP (burned). Up to 25 members; the founder is the leader.
// A banner (colours + symbol + pattern) is shown next to every member's nickname. Each ranked win by a member
// gives the clan 1 season point; the season's top clan flies its banner over the island plaza.
const CLAN = {
  createCost: 50000,
  maxMembers: 25,
  colors: ['#e0484e', '#ff8a3a', '#ffcc33', '#5fd38d', '#4fd3d3', '#4f8dff', '#8a5cf6', '#ff6bd6', '#f3ecd6', '#2a2238'],
  symbols: ['sword', 'shield', 'crown', 'flame', 'wave', 'leaf', 'skull', 'star', 'moon', 'bolt', 'heart', 'eye'],
  patterns: ['plain', 'stripe', 'split', 'chevron'],
  joinModes: ['open', 'approval', 'invite'],
  // the official clan of the game's founder: created automatically, invite-only, with a one-of-a-kind royal banner
  official: { name: 'Flipfight', tag: 'FF', banner: { special: 'flipfight' } },
  reservedTags: ['FF', 'FLIP', 'DEV', 'MOD'],
};
function clanBannerOk(b) {
  return !!b && Number.isInteger(b.bg) && Number.isInteger(b.fg) && Number.isInteger(b.sym) && Number.isInteger(b.pat) &&
    b.bg >= 0 && b.bg < CLAN.colors.length && b.fg >= 0 && b.fg < CLAN.colors.length && b.bg !== b.fg &&
    b.sym >= 0 && b.sym < CLAN.symbols.length && b.pat >= 0 && b.pat < CLAN.patterns.length;
}

const CHAIN_ID = 4663; // Robinhood Chain mainnet (sign-in messages only; nothing is sent on-chain)

const MATCH = { energy: 15, rounds: 5, winsNeeded: 3, turnMs: 20000, revealMs: 2600, deckSize: 5 };
// FLIP! call (like a doubling cube): from round 2, before locking a card, each player may once ask to double the
// stakes. The other player accepts (both pay one more entry at the current level) or folds and loses right away
// at the current level. Max x4. No answer in time = accept if they can afford it.
const FLIP_CALL = { fromRound: 2, maxMult: 4, answerMs: 12000 };

// Living cards: every card keeps its own history (rounds played and won in ranked matches, how many players
// have owned it). Round wins evolve its look: stage 2 at 25 wins, stage 3 at 100. Cosmetic only, power never changes.
const EVOLVE = { stage2: 25, stage3: 100 };
const stageOf = wins => (wins >= EVOLVE.stage3 ? 3 : wins >= EVOLVE.stage2 ? 2 : 1);

function cardView(row) {
  const t = TEMPLATES[row.tpl], b = BACKS[row.tpl];
  const v = { uid: row.uid, tpl: row.tpl, name: t[0], el: t[1], rar: t[2], pow: t[3], tid: '#' + String(row.token_no).padStart(4, '0'),
    back: { name: b[0], el: b[1], pow: b[2], ab: b[3] } };
  if (row.plays !== undefined) {
    const wins = Number(row.wins || 0);
    v.life = { plays: Number(row.plays || 0), wins, owners: Number(row.owners || 1), stage: stageOf(wins) };
  }
  return v;
}
// The side of a card that is face up: 0 = front (no ability), 1 = back (with an ability).
function faceOf(card, face) { return face === 1 ? card.back : { name: card.name, el: card.el, pow: card.pow, ab: null }; }

function effectivePower(card, exhausted, vsElement) {
  const elementBonus = ELEMENTS[card.el].beats === vsElement ? ABILITY_NUM.element : 1;
  return Math.round(card.pow * elementBonus * (exhausted ? 0.5 : 1));
}

// One round. a and b are { card, face, exhausted, bonus } (bonus = +power from an earlier RALLY).
// Order: FLIP TRAPs turn the other card over (both at once), then power =
//   (side power + rally bonus + ambush − 8 if trapped) x element bonus (1.3, or 1.6 with ECHO) x 0.5 if exhausted.
// Ties go to a SHIELD (if only one side has it). DRAIN and RALLY take effect after the round.
function clash(a, b) {
  const S = [a, b];
  const traps = S.map(x => faceOf(x.card, x.face).ab === 'trap');
  const faces = [traps[1] ? 1 - a.face : a.face, traps[0] ? 1 - b.face : b.face];
  const F = faces.map((f, i) => faceOf(S[i].card, f));
  const costs = S.map(x => RARITIES[x.card.rar].cost);
  const events = [[], []];
  traps.forEach((t, i) => { if (t) events[i].push('trap'); });
  const powers = [0, 1].map(i => {
    const me = F[i], them = F[1 - i];
    let flat = S[i].bonus || 0;
    if (flat) events[i].push('rallied');
    if (traps[1 - i]) flat -= ABILITY_NUM.trapStun; // this card was flipped by a trap
    if (me.ab === 'ambush' && costs[1 - i] > costs[i]) { flat += ABILITY_NUM.ambush; events[i].push('ambush'); }
    const beats = ELEMENTS[me.el].beats === them.el;
    if (beats && me.ab === 'echo') events[i].push('echo');
    const mult = beats ? (me.ab === 'echo' ? ABILITY_NUM.echo : ABILITY_NUM.element) : 1;
    return Math.max(0, Math.round((me.pow + flat) * mult * (S[i].exhausted ? 0.5 : 1)));
  });
  let winner = powers[0] > powers[1] ? 0 : powers[1] > powers[0] ? 1 : null;
  if (winner === null) {
    const sh = F.map(f => f.ab === 'shield');
    if (sh[0] !== sh[1]) { winner = sh[0] ? 0 : 1; events[winner].push('shield'); }
  }
  F.forEach((f, i) => { if (f.ab === 'drain') events[i].push('drain'); if (f.ab === 'rally') events[i].push('rally'); });
  return {
    faces, flipped: [traps[1], traps[0]], sides: F, powers, winner, events,
    drain: [F[1].ab === 'drain' ? ABILITY_NUM.drain : 0, F[0].ab === 'drain' ? ABILITY_NUM.drain : 0], // energy each player loses
    nextBonus: F.map(f => (f.ab === 'rally' ? ABILITY_NUM.rally : 0)),
  };
}

module.exports = { BOSS_ROOM, BOSS, bossOf, bossDeck, bossDamage, EVOLVE, stageOf, CLAN, clanBannerOk, FLIP_CALL, BACKS, ABILITIES, ABILITY_NUM, faceOf, clash, SEASON, seasonReward, seasonResetElo, TIERS, tierOf, MARKET, FUSION, fusionChance, PRACTICE, BOT_LEVELS, CHAIN_ID, ELEMENTS, RARITIES, TEMPLATES, ROOMS, PACKS, ECONOMY, MATCH, cardView, effectivePower };
