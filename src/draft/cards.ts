// Draft card pool: which cards can be opened, how strong each one is in a draft
// ("power", 0–100), its pack rarity and its archetype families for synergy.
import { allCards } from '../cards';
import type { CardData } from '../engine/card';

export type Rarity = 'C' | 'R' | 'SR' | 'UR' | 'ScR';
export const RARITIES: Rarity[] = ['C', 'R', 'SR', 'UR', 'ScR'];
export const RARITY_NAME: Record<Rarity, string> = { C: 'Common', R: 'Rare', SR: 'Super Rare', UR: 'Ultra Rare', ScR: 'Secret Rare' };
export const rarityRank = (r: Rarity) => RARITIES.indexOf(r);

export const isExtraDeck = (c: CardData) => !!(c.mtypes?.includes('synchro') || c.mtypes?.includes('fusion'));
export const isVanilla = (c: CardData) => c.kind === 'monster' && !!c.mtypes?.includes('normal') && !isExtraDeck(c);

// ------------------------------------------------------------------ spell / trap ratings
// Spells and traps mostly have no aiValue, so their draft strength comes from this table.
// In a draft, raw removal and big swings matter most; archetype support is rated low here
// and gets its value back through synergy when the drafter is in that archetype.
const ST_TIERS: [number, string[]][] = [
  [96, ['Dark Hole', 'Monster Reborn', 'Heavy Storm', 'Brain Control', 'Mirror Force', 'Torrential Tribute', 'Solemn Judgment', 'Call of the Haunted', 'Mind Control', 'Lightning Vortex', 'Premature Burial', 'Limiter Removal']],
  [86, ['Mystical Space Typhoon', 'Book of Moon', 'Solemn Warning', 'Bottomless Trap Hole', 'Smashing Ground', 'Nobleman of Crossout', 'Dimensional Prison', 'Royal Oppression', 'Enemy Controller', 'Scapegoat', 'Swords of Revealing Light', 'Magic Cylinder', 'Starlight Road', 'Fissure', 'Sakuretsu Armor', 'Megamorph']],
  [72, ['Compulsory Evacuation Device', 'Phoenix Wing Wind Blast', 'Dust Tornado', 'Shrink', 'Soul Exchange', 'Trap Dustshoot', 'Pot of Avarice', 'Gold Sarcophagus', 'Allure of Darkness', 'Ceasefire', 'Magic Drain', 'Dark Bribe', 'Horn of Heaven', 'Seven Tools of the Bandit', 'Gravity Bind', 'Messenger of Peace', 'Mass Driver', 'Cold Wave', 'Burial from a Different Dimension', 'Return from the Different Dimension', 'Monster Reincarnation', 'Trap Hole', 'Raigeki Break', 'Axe of Despair', 'United We Stand', 'Mage Power', 'Rush Recklessly', 'Negate Attack', 'Spellbinding Circle', 'Royal Decree', 'Skill Drain', 'Card Destruction', 'Reasoning', 'Monster Gate', 'Foolish Burial', 'Reinforcement of the Army', 'Divine Wrath']],
  [56, ['Upstart Goblin', 'Trade-In', 'Magical Stone Excavation', 'Draining Shield', 'Dimension Wall', 'Threatening Roar', 'Waboku', 'Shadow Spell', 'Widespread Ruin', 'Karma Cut', 'Michizure', 'Trap Stun', 'Double Summon', 'Level Limit - Area B', 'Wall of Revealing Light', 'Mind Crush', 'Ultimate Offering', 'Book of Life', 'Hand Destruction', 'Magic Planter', 'Spell Reproduction', 'Shield Crush', 'Macro Cosmos', 'Magical Explosion', 'Polymerization', 'Overload Fusion', 'Future Fusion', 'Miracle Fusion', 'Emergency Teleport', 'E - Emergency Call', 'Charge of the Light Brigade', 'Solar Recharge', 'Black Whirlwind', 'Icarus Attack', 'Gladiator Beast War Chariot', "Gottoms' Emergency Call", 'Zombie World', 'Realm of Light']],
  [38, ['Ookazi', 'Hinotama', 'Dian Keto the Cure Master', 'Emergency Provisions', 'Ojama Trio', 'Bad Reaction to Simochi', 'Reckless Greed', 'Lightsworn Sabre', 'Delta Crow - Anti Reverse', 'Saber Slash', 'Gladiator Proving Ground', "Gladiator Beast's Respite", 'Skyscraper', 'Hero Signal', 'Hero Barrier', 'A Hero Emerges']],
];
const ST_POWER = new Map<string, number>();
for (const [v, names] of ST_TIERS) for (const n of names) ST_POWER.set(n.toLowerCase(), v);

/** Famous cards that open at a higher rarity than their raw draft strength suggests. */
const RARITY_OVERRIDE: Record<string, Rarity> = {
  'Blue-Eyes White Dragon': 'UR',
  'Dark Magician': 'UR',
  'Red-Eyes B. Dragon': 'SR',
  'Summoned Skull': 'R',
};

// ------------------------------------------------------------------ power

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function statPower(c: CardData) {
  const atk = c.atk ?? 0;
  const lv = c.level ?? 4;
  const effect = c.mtypes?.includes('effect') || (c.effects?.length ?? 0) > 0;
  let v: number;
  if (isExtraDeck(c)) v = (atk / 3000) * 62;
  else if (lv <= 4) v = (atk / 1900) * 52 + Math.max(0, ((c.def ?? 0) - 1600) / 100);
  else if (lv <= 6) v = (atk / 2400) * 48;
  else v = (atk / 3000) * 46;
  if (effect) v += 8;
  if (c.mtypes?.includes('tuner')) v += 6;
  return v;
}

const powerCache = new Map<string, number>();

/** Draft strength of a card, 0–100. */
export function cardPower(c: CardData): number {
  const hit = powerCache.get(c.id);
  if (hit !== undefined) return hit;
  let v: number;
  if (c.kind === 'monster') {
    const stat = statPower(c);
    const ai = c.aiValue !== undefined ? 34 + c.aiValue / 19 : 0;
    v = Math.max(stat, ai);
    if (isVanilla(c)) v = Math.min(v, 58);
  } else {
    v = ST_POWER.get(c.name.toLowerCase()) ?? (c.aiValue !== undefined ? 50 + c.aiValue / 25 : 48);
  }
  // Restricted cards were restricted for a reason.
  if (c.limit === 1) v += 7;
  else if (c.limit === 2) v += 3;
  v = Math.round(clamp(v, 5, 100));
  powerCache.set(c.id, v);
  return v;
}

// ------------------------------------------------------------------ families (synergy)

const FAMILY_TAGS: Record<string, string> = {
  'x-saber': 'saber',
  'xx-saber': 'saber',
  'elemental-hero': 'hero',
  'destiny-hero': 'hero',
  hero: 'hero',
  synchron: 'synchro',
  resonator: 'synchro',
};
const FAMILY_WORDS: [string, RegExp][] = [
  ['blackwing', /blackwing/i],
  ['lightsworn', /lightsworn/i],
  ['gladiator', /gladiator beast/i],
  ['saber', /x-saber|xx-saber/i],
  ['hero', /elemental hero|destiny hero|\bhero\b|neo-spacian/i],
  ['frog', /\bfrog\b|t\.a\.d\.p\.o\.l\.e/i],
  ['monarch', /tribute summoned/i],
  ['cyber', /cyber dragon/i],
];
const familyCache = new Map<string, string[]>();

/** Archetype families a card belongs to or supports (e.g. Black Whirlwind → blackwing). */
export function families(c: CardData): string[] {
  const hit = familyCache.get(c.id);
  if (hit) return hit;
  const out = new Set<string>();
  for (const s of c.sets ?? []) out.add(FAMILY_TAGS[s] ?? s);
  const hay = `${c.name}\n${c.text}`;
  for (const [f, re] of FAMILY_WORDS) if (re.test(hay)) out.add(f);
  if (c.race === 'Zombie' || /\bzombie\b/i.test(hay)) out.add('zombie');
  if (c.race === 'Plant' || /\bplant\b/i.test(hay)) out.add('plant');
  const arr = [...out];
  familyCache.set(c.id, arr);
  return arr;
}

// ------------------------------------------------------------------ pool & rarity

let poolCache: CardData[] | null = null;
let rarityCache: Map<string, Rarity> | null = null;
let byId: Map<string, CardData> | null = null;

/** Every card that can appear in a pack: no Forbidden cards, no tokens. */
export function draftPool(): CardData[] {
  if (!poolCache) poolCache = allCards().filter((c) => c.limit !== 0 && !c.isToken && !c.mtypes?.includes('token'));
  return poolCache;
}

export function draftCard(id: string): CardData | undefined {
  if (!byId) byId = new Map(allCards().map((c) => [c.id, c]));
  return byId.get(id);
}

/**
 * Rarity by rank of draft power within the pool: top ~4% Secret, ~8% Ultra, ~15% Super,
 * ~25% Rare, the rest Common. Vanilla monsters are Common unless overridden.
 */
export function rarityOf(c: CardData): Rarity {
  if (!rarityCache) {
    rarityCache = new Map();
    const pool = [...draftPool()].sort((a, b) => cardPower(b) - cardPower(a) || (b.aiValue ?? 0) - (a.aiValue ?? 0) || a.name.localeCompare(b.name));
    const n = pool.length;
    const cut = [0.04, 0.12, 0.27, 0.52].map((f) => Math.round(n * f));
    pool.forEach((card, i) => {
      let r: Rarity = i < cut[0] ? 'ScR' : i < cut[1] ? 'UR' : i < cut[2] ? 'SR' : i < cut[3] ? 'R' : 'C';
      if (isVanilla(card)) r = 'C';
      r = RARITY_OVERRIDE[card.name] ?? r;
      rarityCache!.set(card.id, r);
    });
  }
  return rarityCache.get(c.id) ?? 'C';
}

export const isFoilRarity = (r: Rarity) => r === 'SR' || r === 'UR' || r === 'ScR';
