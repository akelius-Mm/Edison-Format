// Player-facing "why can't I use this?" reasons (EffectDef.whyNot), shown by the duel screen on the disabled rows of
// a card's action menu and in the Graveyard / Extra Deck viewer. UI only: the engine never reads `whyNot`, so nothing
// here changes how a card plays. Each reason mirrors the `condition` / `canActivate` check of that card's effect
// (src/cards/sets/*.ts): keep them in step when a card's check changes.
//
// A reason function only reads the game state and returns null when it has nothing specific to say (the screen then
// falls back to its generic text).
import type { CardInstance, EffectDef } from '../engine/card';
import type { Ctx } from '../engine/ctx';
import { findCard } from './define';

type Why = (ctx: Ctx) => string | null;

const fmt = (n: number) => n.toLocaleString('en-US');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const inSet = (tag: string) => (c: CardInstance) => c.isMonster && c.inSet(tag);
const isGB = inSet('gladiator');
const isBW = inSet('blackwing');
const isXS = inSet('x-saber');
const isLS = inSet('lightsworn');
const isSixSamurai = (c: CardInstance) => c.isMonster && (c.inSet('six-samurai') || c.name.includes('Six Samurai'));
const isAttr = (a: string) => (c: CardInstance) => c.isMonster && c.data.attribute === a;

// ------------------------------------------------------------------ shared checks

const NECROVALLEY = 'Necrovalley stops effects that move cards out of the Graveyard';
const SS_LOCKED = "You can't Special Summon right now (a card stops it)";
const ZONES_FULL = 'Your Monster Zones are full';

/** "Needs more than X LP" when an LP cost can't be paid (the card checks `lp > cost`). */
function lpShort(ctx: Ctx, cost: number): string | null {
  return ctx.lp > cost ? null : `Needs more than ${fmt(cost)} LP to pay the cost (you have ${fmt(ctx.lp)})`;
}

/** The player can't Special Summon at all right now (a lock or no free zone). */
function cantSpecial(ctx: Ctx): string | null {
  if (ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon')) return SS_LOCKED;
  if (ctx.freeMZones() <= 0) return ZONES_FULL;
  return null;
}

/** This card can't Special Summon itself (mirrors Ctx.canSummonSelf). */
function cantSummonSelf(ctx: Ctx): string | null {
  const p = cantSpecial(ctx);
  if (p) return p;
  if (ctx.game.queryCard(ctx.self, 'cannotBeSummoned') || ctx.self.data.noSpecialFrom?.includes(ctx.self.location)) return "Can't be Special Summoned right now (a card stops it)";
  return null;
}

/** For a GY effect of this card that moves it: Necrovalley negates it. */
function gyLock(ctx: Ctx): string | null {
  return ctx.game.gyLocked() ? NECROVALLEY : null;
}

/** Why none of the monsters in `pool` can be revived (Monster Reborn, Call of the Haunted, Premature Burial...). */
function reviveWhy(ctx: Ctx, pool: CardInstance[], where: string): string | null {
  const p = cantSpecial(ctx);
  if (p) return p;
  const mons = pool.filter((c) => c.isMonster);
  if (!mons.length) return `There is no monster in ${where}`;
  if (mons.some((c) => ctx.canSummonCard(c))) return null;
  const improper = mons.filter((c) => (c.isExtra || c.data.nomi) && !c.properlySummoned);
  if (improper.length === mons.length)
    return improper.length === 1 ? "That monster wasn't properly Summoned, so it can't be revived" : "Those monsters weren't properly Summoned, so they can't be revived";
  return "No monster there can be Special Summoned right now (a card stops it)";
}

const noOtherST = (ctx: Ctx) => (ctx.spellTraps('both', (c) => c !== ctx.self).length ? null : 'There are no other Spell/Trap Cards on the field');
const WHEN_ASKED = " — you'll be asked then";

// ------------------------------------------------------------------ table: [card name, effect index, reason]

export const WHY_NOT: [string, number, Why][] = [
  // ---- Spells
  [
    'Brain Control',
    0,
    (ctx) => {
      const lp = lpShort(ctx, 800);
      if (lp) return lp;
      if (ctx.freeMZones() <= 0) return ZONES_FULL;
      const faceUp = ctx.faceUpMonsters('opp');
      if (!faceUp.length) return 'Your opponent controls no face-up monster';
      const ok = faceUp.filter((c) => c.isMonster && !c.isExtra && !c.isToken && !c.data.cannotNormalSummon);
      if (!ok.length)
        return 'Can only take a face-up monster that can be Normal Summoned or Set — not Synchro/Fusion/Ritual monsters, Tokens, or monsters like Dark Armed Dragon/Judgment Dragon that can only be Special Summoned.';
      if (!ok.some((c) => ctx.canTarget(c))) return "None of their face-up monsters can be targeted";
      return null;
    },
  ],
  ['Monster Reborn', 0, (ctx) => reviveWhy(ctx, ctx.grave('both'), 'either Graveyard')],
  ['Premature Burial', 0, (ctx) => lpShort(ctx, 800) ?? reviveWhy(ctx, ctx.grave('me'), 'your Graveyard')],
  ['Heavy Storm', 0, noOtherST],
  ['Giant Trunade', 0, noOtherST],
  ['Mystical Space Typhoon', 0, (ctx) => noOtherST(ctx) ?? 'No Spell/Trap Card there can be targeted'],
  ['Dark Hole', 0, (ctx) => (ctx.monsters('both').length ? null : 'There are no monsters on the field')],
  ['Book of Moon', 0, () => 'Needs a face-up monster on the field you can target'],
  ['Nobleman of Crossout', 0, () => 'Needs a face-down monster on the field you can target'],
  ['Smashing Ground', 0, () => 'Your opponent controls no face-up monster'],
  ['Pot of Avarice', 0, (ctx) => `Needs 5 monsters in your Graveyard (you have ${ctx.grave('me', (c) => c.isMonster).length})`],
  ['Allure of Darkness', 0, () => 'Needs at least 2 cards in your Deck'],
  ['Foolish Burial', 0, () => 'There is no monster left in your Deck'],
  [
    'Charge of the Light Brigade',
    0,
    (ctx) => {
      if (ctx.game.queryPlayer(ctx.player, 'cannotAddFromDeck')) return "A card stops you adding cards from your Deck";
      if (ctx.deck().length < 4) return 'Needs at least 4 cards in your Deck (3 to send + 1 to add)';
      return 'There is no Level 4 or lower "Lightsworn" monster left in your Deck';
    },
  ],
  ['Solar Recharge', 0, (ctx) => (ctx.hand('me', (c) => c !== ctx.self && isLS(c)).length ? 'Needs at least 2 cards in your Deck' : 'Needs a "Lightsworn" monster in your hand to discard')],
  ['Cold Wave', 0, () => 'Only at the start of your Main Phase 1, before you do anything else'],
  ['Lightning Vortex', 0, (ctx) => (ctx.faceUpMonsters('opp').length ? 'Needs another card in your hand to discard' : 'Your opponent controls no face-up monster')],
  ['Mind Control', 0, (ctx) => (ctx.freeMZones() <= 0 ? ZONES_FULL : 'Your opponent controls no monster you can target')],
  ['Soul Exchange', 0, (ctx) => (ctx.phase !== 'main1' ? 'Only in Main Phase 1 (you skip your Battle Phase)' : 'Your opponent controls no monster you can target')],
  ['Enemy Controller', 1, (ctx) => (ctx.faceUpMonsters('opp').length ? 'Needs a monster you control to Tribute' : 'Your opponent controls no face-up monster')],
  [
    "Gottoms' Emergency Call",
    0,
    (ctx) => {
      if (!ctx.faceUpMonsters('both', isXS).length) return 'Needs a face-up "X-Saber" monster on the field';
      if (ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon')) return SS_LOCKED;
      if (ctx.freeMZones() < 2) return 'Needs 2 free Monster Zones';
      const n = ctx.grave('both', (c) => isXS(c) && ctx.canSummonCard(c)).length;
      return n < 2 ? `Needs 2 "X-Saber" monsters in the Graveyards (there ${n === 1 ? 'is' : 'are'} ${n})` : null;
    },
  ],

  // ---- Traps (Set): what they wait for
  ['Call of the Haunted', 0, (ctx) => reviveWhy(ctx, ctx.grave('me'), 'your Graveyard')],
  ['Solemn Judgment', 0, () => `Only when a monster would be Summoned, or a Spell/Trap Card is activated${WHEN_ASKED}`],
  ['Solemn Judgment', 1, () => `Only when a monster would be Summoned, or a Spell/Trap Card is activated${WHEN_ASKED}`],
  ['Royal Oppression', 1, (ctx) => lpShort(ctx, 800) ?? `Only when a monster would be Special Summoned${WHEN_ASKED}`],
  ['Bottomless Trap Hole', 0, () => `Only when your opponent Summons a monster with 1500 or more ATK${WHEN_ASKED}`],
  ['Torrential Tribute', 0, () => `Only when a monster is Summoned${WHEN_ASKED}`],
  ['Mirror Force', 0, () => `Only when your opponent's monster declares an attack${WHEN_ASKED}`],
  ['Dimensional Prison', 0, () => `Only when your opponent's monster declares an attack${WHEN_ASKED}`],
  ['Sakuretsu Armor', 0, () => `Only when your opponent's monster declares an attack${WHEN_ASKED}`],
  ['Magic Cylinder', 0, () => `Only when your opponent's monster declares an attack${WHEN_ASKED}`],
  ['Starlight Road', 0, () => `Only when an effect would destroy 2 or more cards you control${WHEN_ASKED}`],
  ['Dark Bribe', 0, () => `Only when your opponent activates a Spell/Trap Card${WHEN_ASKED}`],
  ['Trap Dustshoot', 0, (ctx) => `Only while your opponent has 4 or more cards in hand (they have ${ctx.hand('opp').length})`],
  ['Dust Tornado', 0, () => 'Your opponent controls no Spell/Trap Card you can target'],

  // ---- Summons from the hand (proc)
  [
    'Dark Armed Dragon',
    0,
    (ctx) => {
      const n = ctx.grave('me', isAttr('DARK')).length;
      return n !== 3 ? `Needs exactly 3 DARK monsters in your Graveyard (you have ${n})` : ctx.freeMZones() <= 0 ? ZONES_FULL : null;
    },
  ],
  [
    'Judgment Dragon',
    0,
    (ctx) => {
      const n = new Set(ctx.grave('me', isLS).map((c) => c.name)).size;
      return n < 4 ? `Needs 4+ Lightsworn monsters with different names in your Graveyard (you have ${n})` : ctx.freeMZones() <= 0 ? ZONES_FULL : null;
    },
  ],
  ['Chaos Sorcerer', 0, (ctx) => envoyWhy(ctx)],
  ['Black Luster Soldier - Envoy of the Beginning', 0, (ctx) => envoyWhy(ctx)],
  ['Blackwing - Gale the Whirlwind', 0, (ctx) => bwWhy(ctx)],
  ['Blackwing - Bora the Spear', 0, (ctx) => bwWhy(ctx)],
  ['Cyber Dragon', 0, (ctx) => (ctx.freeMZones() <= 0 ? ZONES_FULL : 'Only when your opponent controls a monster and you control none')],
  ['Test Tiger', 0, (ctx) => (ctx.freeMZones() <= 0 ? ZONES_FULL : 'Needs a face-up "Gladiator Beast" monster on your field')],
  [
    'Test Tiger',
    1,
    (ctx) => {
      if (ctx.query(ctx.self, 'cannotBeTributed')) return "This card can't be Tributed right now";
      if (!ctx.faceUpMonsters('me', (c) => isGB(c) && c !== ctx.self).length) return 'Needs a face-up "Gladiator Beast" monster on your field to target';
      if (!ctx.deck('me', isGB).length) return 'There is no "Gladiator Beast" left in your Deck';
      if (ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon')) return SS_LOCKED;
      return null;
    },
  ],
  [
    'Machina Fortress',
    0,
    (ctx) => {
      const p = cantSummonSelf(ctx);
      if (p) return p;
      if (ctx.self.location === 'grave' && ctx.game.gyLocked()) return NECROVALLEY;
      const lv = ctx.hand('me', (c) => c !== ctx.self && c.isMonster && c.data.race === 'Machine').reduce((a, c) => a + (c.data.level ?? 0), 0);
      return lv < 8 ? `Discard Machine monsters from your hand with total Levels of 8 or more (you have ${lv})` : null;
    },
  ],

  // ---- Monster effects
  [
    'Hand of the Six Samurai',
    0,
    (ctx) => {
      if (!ctx.faceUpMonsters('me', (c) => c !== ctx.self && isSixSamurai(c)).length) return 'Needs another face-up "Six Samurai" monster on your field';
      if (ctx.monsters('both', (c) => ctx.canTarget(c)).length <= 1) return 'Needs another monster on the field to destroy';
      return null;
    },
  ],

  // ---- Graveyard effects (shown in the Graveyard viewer)
  [
    'Plaguespreader Zombie',
    0,
    (ctx) => gyLock(ctx) ?? cantSummonSelf(ctx) ?? (ctx.hand().length ? null : 'Needs a card in your hand to put on top of your Deck'),
  ],
  [
    'Treeborn Frog',
    0,
    (ctx) => gyLock(ctx) ?? (ctx.spellTraps('me').length ? 'You control a Spell/Trap Card (Sets and Field Spells count)' : cantSummonSelf(ctx)),
  ],
];

function envoyWhy(ctx: Ctx): string | null {
  if (ctx.freeMZones() <= 0) return ZONES_FULL;
  if (ctx.game.queryPlayer(ctx.player, 'cannotBanishFromGY')) return "Cards in the Graveyard can't be banished right now (Necrovalley)";
  const l = ctx.grave('me', isAttr('LIGHT')).length;
  const d = ctx.grave('me', isAttr('DARK')).length;
  if (l && d) return null;
  return `Needs 1 LIGHT and 1 DARK monster in your Graveyard to banish (you have ${plural(l, 'LIGHT')}, ${plural(d, 'DARK')})`;
}

function bwWhy(ctx: Ctx): string | null {
  if (ctx.freeMZones() <= 0) return ZONES_FULL;
  return ctx.faceUpMonsters('me', (c) => isBW(c) && c.name !== ctx.self.name).length ? null : 'Needs another face-up "Blackwing" monster on your field';
}

/** Generic reasons for effects without their own (used by the duel screen). */
export function genericWhyNot(ctx: Ctx, ef: EffectDef): string | null {
  const c = ctx.self;
  // a contact fusion (Gladiator Beasts...): the materials must be face-up on the field
  if (ef.kind === 'proc' && c.location === 'extra' && c.data.fusion?.noPoly && c.data.fusion.desc)
    return `Needs ${c.data.fusion.desc} face-up on your field (shuffled into the Deck — no Polymerization)`;
  // a Graveyard effect that moves cards out of the Graveyard
  if (c.location === 'grave' && (ef.categories ?? []).some((k) => k === 'specialSummon' || k === 'toHand' || k === 'toDeck') && ctx.game.gyLocked() && !c.data.ignoresGyLock) return NECROVALLEY;
  if ((ef.categories ?? []).includes('specialSummon') && ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon')) return SS_LOCKED;
  // a Set Trap waiting for its moment
  if (ef.kind === 'activate' && c.location === 'szone' && ef.event) {
    const evs = Array.isArray(ef.event) ? ef.event : [ef.event];
    if (evs.includes('attackDeclared')) return `Only when a monster declares an attack${WHEN_ASKED}`;
    if (evs.includes('summoned')) return `Only when a monster is Summoned${WHEN_ASKED}`;
  }
  return null;
}

/** Problems with the table (unknown cards / indexes); empty when every entry resolves. */
export function applyWhyNot(): string[] {
  const problems: string[] = [];
  for (const [name, idx, fn] of WHY_NOT) {
    const c = findCard(name);
    const ef = c?.effects?.[idx];
    if (!c) problems.push(`unknown card ${name}`);
    else if (!ef) problems.push(`${name} has no effect ${idx}`);
    else if (!ef.whyNot) ef.whyNot = fn;
  }
  return problems;
}

export const WHY_NOT_PROBLEMS = applyWhyNot();
