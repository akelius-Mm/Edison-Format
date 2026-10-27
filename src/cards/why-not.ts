// Player-facing "why can't I use this?" reasons (EffectDef.whyNot), shown by the duel screen on the disabled rows of
// a card's action menu and in the Graveyard / Extra Deck viewer. UI only: the engine never reads `whyNot`, so nothing
// here changes how a card plays. Each reason mirrors the `condition` / `canActivate` check of that card's effect
// (src/cards/sets/*.ts): keep them in step when a card's check changes.
//
// A reason function only reads the game state and returns null when it has nothing specific to say (the screen then
// falls back to its generic text). Keep reasons short: the first line follows "Activate: " / "Summon: " in the menu
// (lowercase, about 35 characters at most); an optional second line after "\n" is a short detail shown under it.
import type { CardInstance, EffectDef } from '../engine/card';
import type { Ctx } from '../engine/ctx';
import { findCard } from './define';

type Why = (ctx: Ctx) => string | null;

const fmt = (n: number) => n.toLocaleString('en-US');

const inSet = (tag: string) => (c: CardInstance) => c.isMonster && c.inSet(tag);
const isGB = inSet('gladiator');
const isBW = inSet('blackwing');
const isXS = inSet('x-saber');
const isLS = inSet('lightsworn');
const isSixSamurai = (c: CardInstance) => c.isMonster && (c.inSet('six-samurai') || c.name.includes('Six Samurai'));
const isAttr = (a: string) => (c: CardInstance) => c.isMonster && c.data.attribute === a;

// ------------------------------------------------------------------ shared checks

const SS_LOCKED = 'a card stops Special Summons';
const ZONES_FULL = 'your Monster Zones are full';

/** "needs more than X LP" when an LP cost can't be paid (the card checks `lp > cost`). */
function lpShort(ctx: Ctx, cost: number): string | null {
  return ctx.lp > cost ? null : `needs more than ${fmt(cost)} LP\nYou have ${fmt(ctx.lp)}`;
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
  if (ctx.game.queryCard(ctx.self, 'cannotBeSummoned') || ctx.self.data.noSpecialFrom?.includes(ctx.self.location)) return 'a card stops it being Summoned';
  return null;
}

/** Why none of the monsters in `pool` can be revived (Monster Reborn, Call of the Haunted, Premature Burial...). */
function reviveWhy(ctx: Ctx, pool: CardInstance[], where: string): string | null {
  const p = cantSpecial(ctx);
  if (p) return p;
  const mons = pool.filter((c) => c.isMonster);
  if (!mons.length) return `no monster in ${where}`;
  if (mons.some((c) => ctx.canSummonCard(c))) return null;
  const improper = mons.filter((c) => (c.isExtra || c.data.nomi) && !c.properlySummoned);
  if (improper.length === mons.length)
    return improper.length === 1 ? "can't revive it\nIt wasn't properly Summoned first" : "can't revive them\nThey weren't properly Summoned first";
  return 'nothing there can be Summoned now';
}

/** Why no face-up monster your opponent controls can be targeted (null when one can). */
function faceUpTargetWhy(ctx: Ctx): string | null {
  const faceUp = ctx.faceUpMonsters('opp');
  if (!faceUp.length) return 'opponent has no face-up monster';
  return faceUp.some((c) => ctx.canTarget(c)) ? null : 'no face-up monster to target';
}

const noOtherST = (ctx: Ctx) => (ctx.spellTraps('both', (c) => c !== ctx.self).length ? null : 'no other Spells/Traps on the field');
const WHEN_ASKED = "\nYou'll be asked then";

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
      if (!faceUp.length) return 'opponent has no face-up monster';
      if (!faceUp.some((c) => ctx.canTarget(c))) return 'no monster it can target';
      return null;
    },
  ],
  ['Monster Reborn', 0, (ctx) => reviveWhy(ctx, ctx.grave('both'), 'either Graveyard')],
  ['Premature Burial', 0, (ctx) => lpShort(ctx, 800) ?? reviveWhy(ctx, ctx.grave('me'), 'your Graveyard')],
  ['Heavy Storm', 0, noOtherST],
  ['Giant Trunade', 0, noOtherST],
  ['Mystical Space Typhoon', 0, (ctx) => noOtherST(ctx) ?? 'no Spell/Trap it can target'],
  ['Dark Hole', 0, (ctx) => (ctx.monsters('both').length ? null : 'no monsters on the field')],
  ['Book of Moon', 0, () => 'needs a face-up monster to target'],
  ['Nobleman of Crossout', 0, () => 'needs a face-down monster to target'],
  ['Smashing Ground', 0, () => 'opponent has no face-up monster'],
  ['Pot of Avarice', 0, (ctx) => `needs 5 monsters in your GY\nYou have ${ctx.grave('me', (c) => c.isMonster).length}`],
  ['Allure of Darkness', 0, () => 'needs 2+ cards in your Deck'],
  ['Foolish Burial', 0, () => 'no monster left in your Deck'],
  [
    'Charge of the Light Brigade',
    0,
    (ctx) => {
      if (ctx.game.queryPlayer(ctx.player, 'cannotAddFromDeck')) return 'a card stops adding from the Deck';
      if (ctx.deck().length < 4) return 'needs 4+ cards in your Deck\n3 to send, 1 to add';
      return 'no Lightsworn left to add\nLevel 4 or lower, from your Deck';
    },
  ],
  ['Solar Recharge', 0, (ctx) => (ctx.hand('me', (c) => c !== ctx.self && isLS(c)).length ? 'needs 2+ cards in your Deck' : 'needs a Lightsworn in hand to discard')],
  ['Cold Wave', 0, () => 'only at the start of Main Phase 1\nBefore you do anything else'],
  ['Lightning Vortex', 0, (ctx) => (ctx.faceUpMonsters('opp').length ? 'needs a card in hand to discard' : 'opponent has no face-up monster')],
  ['Mind Control', 0, (ctx) => (ctx.freeMZones() <= 0 ? ZONES_FULL : 'no monster you can target')],
  ['Soul Exchange', 0, (ctx) => (ctx.phase !== 'main1' ? 'only in Main Phase 1\nYou skip your Battle Phase' : 'no monster you can target')],
  ['Enemy Controller', 0, (ctx) => faceUpTargetWhy(ctx)],
  [
    'Enemy Controller',
    1,
    (ctx) => {
      // mirrors spells.ts tributable(): your monsters that aren't stopped from being Tributed
      const mine = ctx.monsters('me');
      if (!mine.length) return 'you control no monster to Tribute';
      if (!mine.some((c) => !ctx.query(c, 'cannotBeTributed')))
        return mine.length === 1
          ? `your monster can't be Tributed\nA card effect stops ${mine[0].faceUp ? mine[0].name : 'it'}`
          : "your monsters can't be Tributed\nA card effect stops them";
      return faceUpTargetWhy(ctx);
    },
  ],
  [
    "Gottoms' Emergency Call",
    0,
    (ctx) => {
      if (!ctx.faceUpMonsters('both', isXS).length) return 'needs a face-up X-Saber on the field';
      if (ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon')) return SS_LOCKED;
      if (ctx.freeMZones() < 2) return 'needs 2 free Monster Zones';
      const n = ctx.grave('both', (c) => isXS(c) && ctx.canSummonCard(c)).length;
      return n < 2 ? `needs 2 X-Sabers in the GYs\nThere ${n === 1 ? 'is' : 'are'} ${n}` : null;
    },
  ],

  // ---- Traps (Set): what they wait for
  ['Call of the Haunted', 0, (ctx) => reviveWhy(ctx, ctx.grave('me'), 'your Graveyard')],
  ['Solemn Judgment', 0, () => `waits for a Summon or Spell/Trap${WHEN_ASKED}`],
  ['Solemn Judgment', 1, () => `waits for a Summon or Spell/Trap${WHEN_ASKED}`],
  ['Royal Oppression', 1, (ctx) => lpShort(ctx, 800) ?? `waits for a Special Summon${WHEN_ASKED}`],
  ['Bottomless Trap Hole', 0, () => `waits for a 1500+ ATK Summon${WHEN_ASKED}`],
  ['Torrential Tribute', 0, () => `waits for a Summon${WHEN_ASKED}`],
  ['Mirror Force', 0, () => `waits for an opponent's attack${WHEN_ASKED}`],
  ['Dimensional Prison', 0, () => `waits for an opponent's attack${WHEN_ASKED}`],
  ['Sakuretsu Armor', 0, () => `waits for an opponent's attack${WHEN_ASKED}`],
  ['Magic Cylinder', 0, () => `waits for an opponent's attack${WHEN_ASKED}`],
  ['Starlight Road', 0, () => `waits for 2+ of yours to be destroyed${WHEN_ASKED}`],
  ['Dark Bribe', 0, () => `waits for an opponent's Spell/Trap${WHEN_ASKED}`],
  ['Trap Dustshoot', 0, (ctx) => `opponent needs 4+ cards in hand\nThey have ${ctx.hand('opp').length}`],
  ['Dust Tornado', 0, () => 'no Spell/Trap it can target'],

  // ---- Summons from the hand (proc)
  [
    'Dark Armed Dragon',
    0,
    (ctx) => {
      const n = ctx.grave('me', isAttr('DARK')).length;
      return n !== 3 ? `needs exactly 3 DARK in your GY\nYou have ${n}` : ctx.freeMZones() <= 0 ? ZONES_FULL : null;
    },
  ],
  [
    'Judgment Dragon',
    0,
    (ctx) => {
      const n = new Set(ctx.grave('me', isLS).map((c) => c.name)).size;
      return n < 4 ? `needs 4 Lightsworn names in your GY\nYou have ${n}` : ctx.freeMZones() <= 0 ? ZONES_FULL : null;
    },
  ],
  ['Chaos Sorcerer', 0, (ctx) => envoyWhy(ctx)],
  ['Black Luster Soldier - Envoy of the Beginning', 0, (ctx) => envoyWhy(ctx)],
  ['Blackwing - Gale the Whirlwind', 0, (ctx) => bwWhy(ctx)],
  ['Blackwing - Bora the Spear', 0, (ctx) => bwWhy(ctx)],
  ['Cyber Dragon', 0, (ctx) => (ctx.freeMZones() <= 0 ? ZONES_FULL : "only if they have a monster and you don't")],
  ['Test Tiger', 0, (ctx) => (ctx.freeMZones() <= 0 ? ZONES_FULL : 'needs a face-up Gladiator Beast')],
  [
    'Test Tiger',
    1,
    (ctx) => {
      if (ctx.query(ctx.self, 'cannotBeTributed')) return "it can't be Tributed now";
      if (!ctx.faceUpMonsters('me', (c) => isGB(c) && c !== ctx.self).length) return 'needs a face-up Gladiator Beast';
      if (!ctx.deck('me', isGB).length) return 'no Gladiator Beast left in your Deck';
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
      // From the hand this card itself counts toward the 8 Levels (it is then Summoned from the GY).
      const lv = ctx.hand('me', (c) => c.isMonster && c.data.race === 'Machine').reduce((a, c) => a + (c.data.level ?? 0), 0);
      const self = ctx.self.location === 'hand' ? ', counting this card' : '';
      return lv < 8 ? `needs Machines with 8+ Levels to discard\nYour hand has ${lv}${self}` : null;
    },
  ],

  // ---- Monster effects
  [
    'Hand of the Six Samurai',
    0,
    (ctx) => {
      if (!ctx.faceUpMonsters('me', (c) => c !== ctx.self && isSixSamurai(c)).length) return 'needs another face-up Six Samurai';
      if (ctx.monsters('both', (c) => ctx.canTarget(c)).length <= 1) return 'needs another monster to destroy';
      return null;
    },
  ],

  // ---- Graveyard effects (shown in the Graveyard viewer)
  [
    'Plaguespreader Zombie',
    0,
    (ctx) => cantSummonSelf(ctx) ?? (ctx.hand().length ? null : 'needs a card in hand to put on the Deck'),
  ],
  [
    'Treeborn Frog',
    0,
    (ctx) =>
      (ctx.spellTraps('me').length
        ? 'you control a Spell/Trap\nSet cards and Field Spells count'
        : ctx.faceUpMonsters('me', (c) => c.name === 'Treeborn Frog').length
          ? 'you control a face-up Treeborn Frog'
          : cantSummonSelf(ctx)),
  ],
];

function envoyWhy(ctx: Ctx): string | null {
  if (ctx.freeMZones() <= 0) return ZONES_FULL;
  if (ctx.game.queryPlayer(ctx.player, 'cannotBanishFromGY')) return 'Necrovalley stops banishing';
  const l = ctx.grave('me', isAttr('LIGHT')).length;
  const d = ctx.grave('me', isAttr('DARK')).length;
  if (l && d) return null;
  return `needs 1 LIGHT + 1 DARK in your GY\nYou have ${l} LIGHT, ${d} DARK`;
}

function bwWhy(ctx: Ctx): string | null {
  if (ctx.freeMZones() <= 0) return ZONES_FULL;
  return ctx.faceUpMonsters('me', (c) => isBW(c) && c.name !== ctx.self.name).length ? null : 'needs another face-up Blackwing';
}

/** A reason as a menu row: its first line after the verb ("Activate: needs 2+ cards in your Deck"), the rest below. */
export function whyRow(verb: string, why: string): { label: string; sub?: string } {
  const [head, ...rest] = why.split('\n');
  return { label: `${verb}: ${head}`, sub: rest.join(' ') || undefined };
}

/** A reason as one sentence, for notes ("Needs 5 monsters in your GY. You have 2."). */
export function whySentence(why: string): string {
  const t = why
    .split('\n')
    .map((l) => l.replace(/[.\s]+$/, ''))
    .join('. ');
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}.`;
}

/** Generic reasons for effects without their own (used by the duel screen). */
export function genericWhyNot(ctx: Ctx, ef: EffectDef): string | null {
  const c = ctx.self;
  // a contact fusion (Gladiator Beasts...): the materials must be face-up on the field
  if (ef.kind === 'proc' && c.location === 'extra' && c.data.fusion?.noPoly && c.data.fusion.desc)
    return `needs its materials face-up\n${c.data.fusion.desc}, shuffled into the Deck`;
  if ((ef.categories ?? []).includes('specialSummon') && ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon')) return SS_LOCKED;
  // a Set Trap waiting for its moment
  if (ef.kind === 'activate' && c.location === 'szone' && ef.event) {
    const evs = Array.isArray(ef.event) ? ef.event : [ef.event];
    if (evs.includes('attackDeclared')) return `waits for an attack${WHEN_ASKED}`;
    if (evs.includes('summoned')) return `waits for a Summon${WHEN_ASKED}`;
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
