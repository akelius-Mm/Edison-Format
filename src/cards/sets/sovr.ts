// Card definitions: Stardust Overdrive (SOVR), the TCG booster set released November 2009.
// Every SOVR card that was not already in the pool. Card text, stats and passcodes come from the
// YGOJSON v1 aggregate (official English text); behaviour follows the 2010 TCG rulings.
//
// Engine limits are worked around at card level. Where the result is not exact, the card is
// marked "APPROX:" with the reason. Engine additions used here are marked "SOVR:" in
// src/engine/card.ts and src/engine/game.ts ('atkBecomes', 'deckTopInsteadOfGrave', BattleState.calc).
import { monster, normal, spell, token, trap } from '../define';
import { bestTarget, cardValue, flip, selfDestroysByBattle } from '../helpers';
import { dataVariant, type CardInstance, type EffectDef, type TempMod } from '../../engine/card';
import { Ctx } from '../../engine/ctx';
import { GameOver, type Game } from '../../engine/game';
import type { Attribute, GameEvent, Location, PlayerId, Race } from '../../engine/types';

type C = CardInstance;

// =================================================================== shared helpers

const ALL_LOCS: Location[] = ['deck', 'hand', 'mzone', 'szone', 'fzone', 'grave', 'banished', 'extra'];
const evc = (ev: GameEvent) => ev.card as C | undefined;
const evo = (ev: GameEvent) => ev.other as C | undefined;
const raceIs = (c: C, ...r: Race[]) => c.isMonster && r.includes(c.data.race as Race);
const attrIs = (c: C, ...a: Attribute[]) => c.isMonster && a.includes(c.data.attribute as Attribute);
const lvl = (c: C) => c.data.level ?? 0;
/** This Spell/Trap is face-up, has resolved and is not negated. */
const stActive = (ctx: Ctx) => ctx.self.onField && ctx.self.faceUp && ctx.self.activeOnField && !ctx.game.isNegated(ctx.self);
/** Turn offset of this player's next turn (for ctx.later). */
const nextOwnTurn = (ctx: Ctx) => (ctx.isMyTurn ? 2 : 1);
const nextOppTurnEnd = (ctx: Ctx) => (ctx.isMyTurn ? 1 : 0);
const mainPhase = (ctx: Ctx) => ctx.phase === 'main1' || ctx.phase === 'main2';

/** Tribute cards as a cost (not for a Tribute Summon). */
async function tributeCost(ctx: Ctx, cards: C[]) {
  if (!cards.length) return [];
  ctx.log(`${ctx.game.players[ctx.player].name} Tributes ${cards.map((c) => c.name).join(', ')}.`);
  return ctx.game.moveCards(cards, 'grave', { reason: 'tribute', reasons: ['tribute', 'cost'], reasonPlayer: ctx.player, reasonCard: ctx.self });
}
const tributable = (ctx: Ctx, f: (c: C) => boolean = () => true) =>
  ctx.monsters('me', (c) => !ctx.query(c, 'cannotBeTributed') && !c.flags.sovrNoCostTribute && f(c));

/** Every card involved in events of `type` in the same batch as the triggering event. */
function batchCards(ctx: Ctx, types: GameEvent['type'][]): C[] {
  const ev = ctx.event;
  if (!ev) return [];
  const out = ctx.game.eventLog.filter((e) => e.batch === ev.batch && types.includes(e.type)).map((e) => e.card as C);
  return [...new Set(out.filter(Boolean))];
}

/** Position for an effect Special Summon: humans choose, the AI picks by stats. */
function aiPos(ctx: Ctx, c: C): 'atk' | 'def' | 'choose' {
  if (ctx.game.controllers[ctx.player]?.isHuman) return 'choose';
  const atk = c.data.atk ?? 0;
  const oppBest = Math.max(0, ...ctx.faceUpMonsters('opp').map((m) => (m.pos === 'atk' ? ctx.atk(m) : 0)));
  return atk >= 1600 && atk >= oppBest ? 'atk' : 'def';
}

const reviveScore = (c: C) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0);

/** Is any face-up Field Spell on the field? */
const fieldSpellUp = (g: Game) => [g.players[0].fzone, g.players[1].fzone].some((f) => !!f && f.faceUp);

// ---- archetypes (by tag, or by name for cards from other files) ----
const isFortuneLady = (c: C) => c.isMonster && (c.inSet('fortune-lady') || c.name.startsWith('Fortune Lady'));
const isReptilianne = (c: C) => c.isMonster && (c.inSet('reptilianne') || c.name.startsWith('Reptilianne'));
const IRON_CORE = "Iron Core of Koa'ki Meiru";
const isKoaki = (c: C) => c.inSet('koaki-meiru') || c.name.includes("Koa'ki Meiru");
const isKoakiMonster = (c: C) => c.isMonster && isKoaki(c);
const isEI = (c: C) => c.isMonster && (c.inSet('earthbound-immortal') || c.name.startsWith('Earthbound Immortal '));
const isInfernity = (c: C) => c.isMonster && (c.inSet('infernity') || c.name.startsWith('Infernity'));
const isSixSamurai = (c: C) => c.isMonster && (c.inSet('six-samurai') || c.name.includes('Six Samurai'));
const isShien = (c: C) => c.isMonster && c.name.includes('Shien');
const isLightsworn = (c: C) => c.isMonster && c.inSet('lightsworn');
const isRitualMonster = (c: C) => c.isMonster && c.hasType('ritual');
const isDjinn = (c: C) => c.isMonster && c.inSet('djinn');

/** Monsters whose printed ATK is "?" (their ATK is 0 outside the field). */
export const QUESTION_ATK = new Set([
  'Fortune Lady Wind',
  'Fortune Lady Water',
  'Fortune Lady Dark',
  'Fortune Lady Earth',
  'Fortune Lady Light',
  'Fortune Lady Fire',
  'Clear Vice Dragon',
  'Destiny Hero - Dreadmaster',
]);
const hasQuestionAtk = (c: C) => c.isMonster && QUESTION_ATK.has(c.data.name);

// ---- Gemini ----
const isGemini = (c: C) => c.isMonster && c.hasType('gemini');
/** A Gemini monster that has been Gemini Summoned (is an Effect Monster now). */
const geminiActive = (c: C) => isGemini(c) && c.location === 'mzone' && c.faceUp && !!c.flags.geminiSummoned;
/** Normal Monster, or a Gemini monster where it is treated as a Normal Monster (GY / face-up un-Gemini'd). */
const isNormalLike = (c: C) =>
  c.isMonster &&
  !c.isToken &&
  (c.hasType('normal') || (isGemini(c) && (c.location === 'grave' || (c.location === 'mzone' && c.faceUp && !c.flags.geminiSummoned))));

/** Turn a face-up Gemini monster into an Effect Monster (Gemini Summon, Gemini Booster, Black Brutdrago). */
function makeGeminiActive(ctx: Ctx, c: C) {
  if (c.location !== 'mzone' || !c.faceUp || !isGemini(c)) return;
  c.flags.geminiSummoned = true;
  ctx.log(`${c.name} is now treated as an Effect Monster.`);
  ctx.game.update();
}

/**
 * Gemini Summon. APPROX (same as plants.ts): the engine has no Gemini Summon action, so it is an
 * Ignition effect that uses the turn's Normal Summon; it starts a chain instead of being a Summon.
 */
function geminiSummon(score: (ctx: Ctx) => number = () => 40): EffectDef {
  return {
    kind: 'ignition',
    label: 'Gemini Summon (Normal Summon again)',
    categories: [],
    condition: (ctx) =>
      ctx.self.faceUp && !ctx.self.flags.geminiSummoned && ctx.game.players[ctx.player].normalSummonsLeft > 0 && !ctx.game.queryPlayer(ctx.player, 'cannotNormalSummon'),
    activate: async (ctx) => {
      ctx.game.players[ctx.player].normalSummonsLeft--;
    },
    resolve: async (ctx) => {
      makeGeminiActive(ctx, ctx.self);
    },
    ai: {
      score: (ctx) => {
        // Don't spend the Normal Summon if a better monster in hand still wants it (main phase 1).
        const better = ctx.hand('me', (c) => c.isMonster && ctx.game.canNormalSummon(ctx.player, c) && (c.data.atk ?? 0) + (c.data.aiValue ?? 0) > 1900);
        if (ctx.phase === 'main1' && better.length) return 0;
        return score(ctx);
      },
    },
  };
}
const gemini = (ctx: Ctx) => geminiActive(ctx.self);

// ---- ATK / Level manipulation ----
const hasAtkBecomes = (c: C) => c.tempMods.some((t) => t.q === 'atkBecomes');
/** "The ATK of that monster becomes 0" for as long as it stays face-up on the field. */
function setAtkZero(ctx: Ctx, c: C) {
  if (c.location !== 'mzone' || !c.faceUp) return;
  c.tempMods = c.tempMods.filter((t) => t.q !== 'atk' && t.q !== 'atkBecomes');
  ctx.addTempMod(c, 'atkBecomes', 0, 'field');
  ctx.log(`${c.name}'s ATK becomes 0.`);
}
/** Reptilianne lock: ATK becomes 0 and it cannot change its battle position. */
function reptilianneLock(ctx: Ctx, c: C) {
  if (c.location !== 'mzone' || !c.faceUp) return;
  setAtkZero(ctx, c);
  ctx.addTempMod(c, 'cannotChangePos', true, 'field');
}

/**
 * Increase a face-up monster's Level. Fortune Lady Earth's "When the Level of this card increases"
 * burn is applied here. APPROX: it resolves at once instead of as its own chain link.
 */
async function raiseLevel(ctx: Ctx, c: C, n: number, until: TempMod['until'] = 'field', cap?: number) {
  if (c.location !== 'mzone' || !c.faceUp) return 0;
  const inc = cap === undefined ? n : Math.min(n, cap - ctx.level(c));
  if (inc <= 0) return 0;
  ctx.addTempMod(c, 'level', inc, until);
  ctx.log(`${c.name}'s Level increases by ${inc} (Level ${ctx.level(c)}).`);
  if (c.data.name === 'Fortune Lady Earth' && !ctx.game.isNegated(c)) {
    ctx.game.log(`Fortune Lady Earth: its Level increased.`, 'action', c.controller);
    await ctx.game.damage(ctx.game.opp(c.controller), 400, 'effect', c, c.controller);
  }
  return inc;
}

// ---- battle helpers (BattleState.calc is recorded by the engine at damage calculation) ----
/** ATK the destroyed monster had at damage calculation. */
function calcAtkOf(g: Game, c: C): number | undefined {
  const b = g.battle;
  if (!b?.calc) return undefined;
  if (c === b.attacker) return b.calc.attackerAtk;
  if (c === b.target) return b.calc.targetAtk;
  return undefined;
}

/**
 * Listener (never starts a chain): at the end of each Damage Step, `mark` is called for every
 * monster that lost the battle but is still on the field (its battle protection was used).
 */
function battleSurvivorListener(mark: (ctx: Ctx, c: C) => void, range: Location[] = ALL_LOCS): EffectDef {
  return {
    kind: 'trigger',
    event: 'damageStepEnd',
    range,
    label: 'Battle protection used',
    eventFilter: (ctx) => {
      const b = ctx.game.battle;
      if (!b?.calc) return false;
      for (const c of b.calc.losers) if (c.location === 'mzone') mark(ctx, c);
      return false;
    },
  };
}

// ---- Koa'ki Meiru upkeep ----
/**
 * "During each of your End Phases, destroy this card unless you send 1 'Iron Core of Koa'ki Meiru'
 * from your hand to the GY or reveal 1 <X> in your hand." Iron Core Armor's replacement is offered
 * when the card would be destroyed this way.
 */
function koakiUpkeep(revealDesc: string, reveal: ((c: C) => boolean) | null, sendAlso?: (c: C) => boolean): EffectDef {
  return {
    kind: 'trigger',
    event: 'phaseStart',
    range: ['mzone'],
    mandatory: true,
    label: "Koa'ki Meiru upkeep",
    categories: ['destroy'],
    eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.isMyTurn && ctx.self.faceUp,
    resolve: async (ctx) => {
      const me = ctx.self;
      if (me.location !== 'mzone' || !me.faceUp) return;
      const sendable = ctx.hand('me', (c) => c.name === IRON_CORE || (!!sendAlso && sendAlso(c)));
      const reveals = reveal ? ctx.hand('me', reveal) : [];
      const opts: string[] = [];
      const kinds: ('reveal' | 'send' | 'destroy')[] = [];
      if (reveals.length) {
        opts.push(`Reveal 1 ${revealDesc} in your hand`);
        kinds.push('reveal');
      }
      if (sendable.length) {
        opts.push(sendAlso ? `Send 1 "${IRON_CORE}" or "Koa'ki Meiru" monster from your hand to the GY` : `Send 1 "${IRON_CORE}" from your hand to the GY`);
        kinds.push('send');
      }
      opts.push(`Destroy ${me.name}`);
      kinds.push('destroy');
      const i = await ctx.option(`${me.name}: End Phase upkeep`, opts, (k) => (kinds[k] === 'reveal' ? 3 : kinds[k] === 'send' ? 2 : 0));
      const kind = kinds[i] ?? 'destroy';
      if (kind === 'reveal') {
        const [r] = await ctx.select(reveals, 1, 1, `Reveal 1 ${revealDesc}.`, 'generic', { aiScore: () => 0 });
        if (r) {
          r.revealedUntil = ctx.turn;
          ctx.log(`${ctx.game.players[ctx.player].name} reveals ${r.name}.`);
          await ctx.game.anim({ type: 'reveal', cards: [r.uid], player: ctx.player });
          return;
        }
      }
      if (kind === 'send') {
        const [s] = await ctx.select(sendable, 1, 1, 'Send 1 card from your hand to the GY.', 'cost', {
          aiScore: (c) => (c.name === IRON_CORE ? 100 : 0) - cardValue(ctx.game, c) / 100,
        });
        if (s) {
          await ctx.sendToGrave(s, 'cost');
          return;
        }
      }
      // Iron Core Armor: "If the equipped monster would be destroyed during the End Phase, you can send this card to the GY instead."
      const armor = ctx.game.equipsOf(me).find((e) => e.name === 'Iron Core Armor' && e.faceUp && !ctx.game.isNegated(e));
      if (armor && (await ctx.confirm(`Send Iron Core Armor to the GY instead of destroying ${me.name}?`, true))) {
        await ctx.sendToGrave(armor, 'effect');
        return;
      }
      await ctx.destroy(me);
    },
  };
}

// ---- Fortune Lady ----
/** ATK/DEF = Level x mult, and the Standby Phase Level increase (max 12). */
function fortuneLadyBase(mult: number): EffectDef[] {
  return [
    {
      kind: 'continuous',
      mods: [
        { q: 'atk', value: (ctx) => (hasAtkBecomes(ctx.self) ? 0 : ctx.level(ctx.self) * mult) },
        { q: 'def', value: (ctx) => ctx.level(ctx.self) * mult },
      ],
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['mzone'],
      mandatory: true,
      label: 'Standby Phase: Level +1',
      categories: ['atkChange'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn && ctx.self.faceUp && ctx.level(ctx.self) < 12,
      resolve: async (ctx) => {
        await raiseLevel(ctx, ctx.self, 1, 'field', 12);
      },
    },
  ];
}

// ---- Earthbound Immortal ----
function earthboundRules(): EffectDef[] {
  return [
    {
      kind: 'continuous',
      mods: [
        { q: 'cannotBeAttacked' },
        { q: 'directAttack' },
        {
          // If none of your monsters can be targeted for an attack, the opponent's monsters attack directly.
          q: 'directAttack',
          to: 'cards',
          filter: (ctx, c: C) => {
            if (c.location !== 'mzone' || c.controller !== ctx.opp) return false;
            const mine = ctx.game.monsters(ctx.player);
            return mine.length > 0 && mine.every((m) => ctx.game.queryCard(m, 'cannotBeAttacked'));
          },
        },
      ],
    },
    {
      // APPROX: the self-destruction for "no face-up Field Spell" is a mandatory chain link here, checked
      // whenever a card leaves the field, a monster is Summoned, or a phase starts.
      kind: 'trigger',
      event: ['leftField', 'summoned', 'phaseStart', 'positionChanged'],
      range: ['mzone'],
      mandatory: true,
      label: 'No Field Spell: destroy',
      categories: ['destroy'],
      eventFilter: (ctx) => ctx.self.faceUp && !fieldSpellUp(ctx.game),
      condition: (ctx) => !fieldSpellUp(ctx.game),
      resolve: async (ctx) => {
        if (ctx.self.location === 'mzone' && ctx.self.faceUp && !fieldSpellUp(ctx.game)) await ctx.destroy(ctx.self);
      },
    },
    {
      // APPROX: "There can only be 1 Earthbound Immortal on the field": a second one that gets Summoned is destroyed.
      kind: 'trigger',
      event: 'summoned',
      mandatory: true,
      label: 'Only 1 Earthbound Immortal',
      categories: ['destroy'],
      eventFilter: (ctx, ev) =>
        ev.card === ctx.self && ctx.self.location === 'mzone' && ctx.faceUpMonsters('both', (c) => c !== ctx.self && isEI(c)).length > 0,
      resolve: async (ctx) => {
        if (ctx.self.location === 'mzone' && ctx.faceUpMonsters('both', (c) => c !== ctx.self && isEI(c)).length) await ctx.destroy(ctx.self);
      },
    },
  ];
}

// ---- Ritual Summons ----
/** Ritual material available to `ctx.player`: hand and field monsters, plus Djinns in the GY (banished). */
function ritualPool(ctx: Ctx, ritual: C): C[] {
  return [
    ...ctx.hand('me', (c) => c.isMonster && c !== ritual),
    ...ctx.monsters('me', (c) => !ctx.query(c, 'cannotBeTributed')),
    ...ctx.grave('me', isDjinn),
  ];
}
const levelSum = (cs: C[], ctx: Ctx) => cs.reduce((a, c) => a + (c.location === 'mzone' ? ctx.level(c) : lvl(c)), 0);
function canRitual(ctx: Ctx, ritualFilter: (c: C) => boolean, need: number) {
  if (!ctx.canSpecialSummon() && ctx.monsters('me').length === 0) return false;
  if (ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon')) return false;
  return ctx.hand('me', (c) => isRitualMonster(c) && ritualFilter(c)).some((r) => levelSum(ritualPool(ctx, r), ctx) >= need);
}
/**
 * Ritual Summon 1 monster from the hand by Tributing monsters from the hand/field whose total
 * Levels are `need` or more (Djinns in the GY can be banished as 1 of them). Returns the monster.
 */
async function performRitual(ctx: Ctx, ritualFilter: (c: C) => boolean, need: number): Promise<C | null> {
  const rituals = ctx.hand('me', (c) => isRitualMonster(c) && ritualFilter(c) && levelSum(ritualPool(ctx, c), ctx) >= need);
  if (!rituals.length) return null;
  const [r] = await ctx.select(rituals, 1, 1, 'Select the Ritual Monster to Ritual Summon.', 'specialSummon');
  if (!r) return null;
  const chosen: C[] = [];
  for (let guard = 0; guard < 12 && levelSum(chosen, ctx) < need; guard++) {
    const rest = ritualPool(ctx, r).filter((c) => !chosen.includes(c));
    // Keep at least one free zone if every chosen monster is in the hand.
    const ok = rest.filter((c) => levelSum([...chosen, ...rest], ctx) >= need && (c.location === 'mzone' || ctx.freeMZones() > 0 || chosen.some((x) => x.location === 'mzone')));
    if (!ok.length) break;
    const [m] = await ctx.select(ok, 1, 1, `Select Ritual material (${levelSum(chosen, ctx)}/${need} Levels).`, 'material', {
      aiScore: (c) => (isDjinn(c) && c.location === 'grave' ? 3000 : 0) - cardValue(ctx.game, c) + (c.isToken ? 1500 : 0) + lvl(c) * 50,
    });
    if (!m) break;
    chosen.push(m);
  }
  if (levelSum(chosen, ctx) < need) return null;
  const banished = chosen.filter((c) => c.location === 'grave');
  const tributed = chosen.filter((c) => c.location !== 'grave');
  if (banished.length) await ctx.banish(banished, 'material');
  if (tributed.length) {
    ctx.log(`${ctx.game.players[ctx.player].name} Tributes ${tributed.map((c) => c.name).join(', ')} for a Ritual Summon.`);
    await ctx.game.moveCards(tributed, 'grave', { reason: 'tribute', reasons: ['tribute', 'material'], reasonPlayer: ctx.player, reasonCard: r });
  }
  if (r.location !== 'hand' || ctx.freeMZones() <= 0) return null;
  const [s] = await ctx.specialSummon(r, { method: 'ritual', proper: true, pos: aiPos(ctx, r) });
  if (!s) return null;
  s.flags.ritualMaterialCount = chosen.length;
  for (const m of chosen) {
    if (m.data.name === 'Djinn Releaser of Rituals') s.flags.sovrDjinnReleaser = [...(s.flags.sovrDjinnReleaser ?? []), m.uid];
    if (m.data.name === 'Djinn Presider of Rituals') s.flags.sovrDjinnPresider = [...(s.flags.sovrDjinnPresider ?? []), m.uid];
  }
  s.flags.sovrRitualPlayer = ctx.player;
  ctx.game.update();
  return s;
}

// ---- equips ----
const equipped = (ctx: Ctx, c: C) => c === ctx.equipTarget;
function equipSpell(filter: (ctx: Ctx, c: C) => boolean, score: (ctx: Ctx) => number, aiTarget?: (ctx: Ctx, c: C) => number): EffectDef {
  const cands = (ctx: Ctx) => ctx.faceUpMonsters('both', (c) => filter(ctx, c));
  return {
    kind: 'activate',
    categories: ['atkChange'],
    canActivate: (ctx) => cands(ctx).some((c) => ctx.canTarget(c)),
    activate: async (ctx) => {
      await ctx.selectTargets(cands(ctx), 1, 1, 'Target 1 face-up monster to equip this card to.', 'equip', {
        aiScore: (c) => (aiTarget ? aiTarget(ctx, c) : c.controller === ctx.player ? ctx.atk(c) + 1000 : -10000),
      });
    },
    resolve: async (ctx) => {
      const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp && filter(ctx, c));
      if (!t.length || !ctx.self.onField || !ctx.self.faceUp) return;
      ctx.equip(t[0]);
    },
    ai: { score },
  };
}
const buffScore = (ok: (c: C) => boolean) => (ctx: Ctx) => {
  const mine = ctx.faceUpMonsters('me', ok);
  if (!mine.length || !mainPhase(ctx)) return 0;
  return ctx.phase === 'main1' ? 32 : 12;
};

/** Distinct Lightsworn monster names in this player's GY. */
const lsNames = (ctx: Ctx) => new Set(ctx.grave('me', isLightsworn).map((c) => c.name)).size;

// =================================================================== tokens

const reptilianneToken = token('Reptilianne Token', 'EARTH', 'Reptile', 1, 0, 0);
const spiderToken = token('Spider Token', 'EARTH', 'Insect', 1, 100, 100);
const soulToken = token('Soul Token', 'DARK', 'Fiend', 1, 0, 0, 'Soul Token (Fiend/DARK/Level 1/ATK 0/DEF 0). Cannot be Tributed, except for a Tribute Summon.');
const multiToken = token('Multi Token', 'LIGHT', 'Machine', 4, 1200, 1200);

// =================================================================== MONSTERS

monster("Koa'ki Meiru Beetle", {
  attribute: 'EARTH',
  race: 'Insect',
  level: 4,
  atk: 1900,
  def: 1500,
  sets: ['koaki-meiru'],
  aiValue: 300,
  text: 'During each of your End Phases, destroy this card unless you send 1 "Iron Core of Koa\'ki Meiru" from your hand to the Graveyard or reveal 1 Insect-Type monster in your hand. If a LIGHT or DARK monster is Special Summoned in Attack Position: Change that monster to Defense Position.',
  effects: [
    koakiUpkeep('Insect-Type monster', (c) => raceIs(c, 'Insect')),
    {
      kind: 'trigger',
      event: 'specialSummoned',
      range: ['mzone'],
      mandatory: true,
      label: 'LIGHT/DARK to Defense Position',
      categories: ['position'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && ctx.self.faceUp && c.location === 'mzone' && c.faceUp && c.pos === 'atk' && attrIs(c, 'LIGHT', 'DARK');
      },
      resolve: async (ctx) => {
        for (const c of batchCards(ctx, ['specialSummoned'])) {
          if (c.location === 'mzone' && c.faceUp && c.pos === 'atk' && attrIs(c, 'LIGHT', 'DARK')) await ctx.changePos(c, 'def', true);
        }
      },
    },
  ],
});

monster('Majestic Dragon', {
  attribute: 'LIGHT',
  race: 'Dragon',
  level: 1,
  atk: 0,
  def: 0,
  types: ['tuner', 'effect'],
  sets: ['majestic'],
  aiValue: 300,
  text: 'Cannot be used as Synchro Material, except for the Synchro Summon of a "Majestic" monster.',
  synchroMaterialCheck: (synchro, materials) =>
    synchro.inSet('majestic') && (synchro.data.name !== 'Majestic Star Dragon' || materials.some((m) => m.name === 'Stardust Dragon')),
});

monster('Stardust Xiaolong', {
  attribute: 'LIGHT',
  race: 'Dragon',
  level: 1,
  atk: 100,
  def: 100,
  aiValue: 400,
  text: 'When you Synchro Summon "Stardust Dragon": You can Special Summon this card from your GY in Attack Position. Each turn, the first time this card would be destroyed by battle, it is not destroyed.',
  effects: [
    {
      kind: 'trigger',
      event: 'synchroSummoned',
      range: ['grave'],
      when: true,
      label: 'Special Summon from GY',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => evc(ev)?.name === 'Stardust Dragon' && ev.player === ctx.player,
      condition: (ctx) => ctx.canSummonSelf(),
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave') await ctx.specialSummon(ctx.self, { pos: 'atk' });
      },
    },
    { kind: 'continuous', mods: [{ q: 'indestructibleBattle', value: (ctx) => ctx.self.flags.sovrXiaolongTurn !== ctx.game.turn }] },
    battleSurvivorListener((ctx, c) => {
      if (c === ctx.self && !ctx.game.isNegated(c)) c.flags.sovrXiaolongTurn = ctx.game.turn;
    }, ['mzone']),
  ],
});

monster('Max Warrior', {
  attribute: 'WIND',
  race: 'Warrior',
  level: 4,
  atk: 1800,
  def: 800,
  aiValue: 200,
  text: "If this card attacks an opponent's monster, this card gains 400 ATK during the Damage Step only. If this card destroys an opponent's monster by battle, until your next Standby Phase: this card becomes Level 2 and its original ATK and DEF are halved.",
  effects: [
    {
      kind: 'continuous',
      mods: [
        {
          q: 'atk',
          value: (ctx) => {
            const b = ctx.game.battle;
            return b && b.inDamageStep && b.attacker === ctx.self && b.target ? 400 : 0;
          },
        },
      ],
    },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Becomes Level 2, halves original ATK/DEF',
      categories: ['atkChange'],
      eventFilter: selfDestroysByBattle,
      resolve: async (ctx) => {
        const me = ctx.self;
        if (me.location !== 'mzone' || !me.faceUp) return;
        me.flags.baseAtk = Math.floor((me.data.atk ?? 0) / 2);
        me.flags.baseDef = Math.floor((me.data.def ?? 0) / 2);
        me.flags.baseLevel = 2;
        ctx.game.update();
        const mid = me.moveId;
        ctx.later(
          'standby',
          async () => {
            if (me.moveId !== mid) return;
            delete me.flags.baseAtk;
            delete me.flags.baseDef;
            delete me.flags.baseLevel;
            ctx.game.update();
          },
          nextOwnTurn(ctx),
        );
      },
    },
  ],
});

monster('Zero Gardna', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 4,
  atk: 0,
  def: 0,
  aiValue: 600,
  text: 'You can Tribute this card to activate its effect. If you do, monsters you control cannot be destroyed by battle, and you take no Battle Damage, during this turn. This effect can be activated during either player\'s turn.',
  effects: [
    {
      kind: 'quick',
      label: 'Tribute: no battle destruction or damage this turn',
      categories: ['protect'],
      canActivate: (ctx) => !ctx.query(ctx.self, 'cannotBeTributed'),
      activate: async (ctx) => {
        await tributeCost(ctx, [ctx.self]);
      },
      resolve: async (ctx) => {
        const list: PlayerId[] = ctx.game.turnData.sovrZeroGardna ?? [];
        if (!list.includes(ctx.player)) list.push(ctx.player);
        ctx.game.turnData.sovrZeroGardna = list;
        ctx.addPlayerMod(ctx.player, 'noBattleDamage');
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b || b.attacker.controller !== ctx.opp || b.inDamageStep) return 0;
          const atk = ctx.atk(b.attacker);
          if (!b.target) return atk >= 1500 || atk >= ctx.lp ? 70 : 0;
          if (b.target.controller !== ctx.player) return 0;
          const t = b.target;
          const stat = t.pos === 'atk' ? ctx.atk(t) : t.faceUp ? ctx.def(t) : 0;
          if (t === ctx.self) return 60;
          return atk > stat && cardValue(ctx.game, t) >= 1500 ? 55 : 0;
        },
      },
    },
    {
      // The protection lasts for the turn even after Zero Gardna has left the field.
      kind: 'continuous',
      range: ALL_LOCS,
      mods: [
        {
          q: 'indestructibleBattle',
          to: 'cards',
          filter: (ctx, c: C) => c.location === 'mzone' && ((ctx.game.turnData.sovrZeroGardna ?? []) as PlayerId[]).includes(c.controller),
        },
      ],
    },
  ],
});

monster('Regulus', {
  attribute: 'LIGHT',
  race: 'Beast',
  level: 4,
  atk: 1700,
  def: 1000,
  aiValue: 100,
  text: 'Once per turn, you can select 1 Field Spell Card in your Graveyard. Return it to the Deck.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Return a Field Spell to the Deck',
      categories: ['toDeck'],
      canActivate: (ctx) => ctx.grave('me', (c) => c.data.stype === 'field' && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => c.data.stype === 'field'), 1, 1, 'Select 1 Field Spell in your GY.', 'toHand');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.toDeck(t, 'shuffle');
      },
      ai: { score: (ctx) => (ctx.deck('me', (c) => c.data.stype === 'field').length === 0 ? 20 : 0) },
    },
  ],
});

monster('Infernity Necromancer', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 3,
  atk: 0,
  def: 2000,
  sets: ['infernity'],
  aiValue: 500,
  text: 'When this card is Normal Summoned, it is changed to Defense Position. If you have no cards in your hand, this card gains the following effect: Once per turn, you can select 1 "Infernity" monster in your Graveyard, except "Infernity Necromancer", and Special Summon it.',
  effects: [
    {
      kind: 'trigger',
      event: 'normalSummoned',
      mandatory: true,
      label: 'Change to Defense Position',
      categories: ['position'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.location === 'mzone' && ctx.self.pos === 'atk',
      resolve: async (ctx) => {
        if (ctx.self.location === 'mzone' && ctx.self.faceUp && ctx.self.pos === 'atk') await ctx.changePos(ctx.self, 'def', true);
      },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Revive an Infernity monster',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.hand('me').length === 0,
      canActivate: (ctx) =>
        ctx.canSpecialSummon() && ctx.grave('me', (c) => isInfernity(c) && c.data.name !== 'Infernity Necromancer' && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(
          ctx.grave('me', (c) => isInfernity(c) && c.data.name !== 'Infernity Necromancer' && ctx.canSummonCard(c)),
          1,
          1,
          'Select 1 "Infernity" monster in your GY to Special Summon.',
          'specialSummon',
          { aiScore: reviveScore },
        );
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length && ctx.canSummonCard(t[0])) await ctx.specialSummon(t[0], { pos: aiPos(ctx, t[0]) });
      },
      ai: { score: () => 60 },
    },
  ],
});

// ---- Fortune Ladies ----

monster('Fortune Lady Wind', {
  attribute: 'WIND',
  race: 'Spellcaster',
  level: 3,
  atk: 0,
  def: 0,
  sets: ['fortune-lady'],
  aiValue: 1100,
  text: 'This card\'s ATK and DEF are equal to its Level x 300. During each of your Standby Phases, increase the Level of this card by 1 (max 12). When this card is Normal Summoned, you can destroy a number of Spell or Trap Cards your opponent controls equal to the number of face-up "Fortune Lady" monsters you control.',
  effects: [
    ...fortuneLadyBase(300),
    {
      kind: 'trigger',
      event: 'normalSummoned',
      when: true,
      label: 'Destroy Spells/Traps',
      categories: ['destroy'],
      // 2010 ruling: it cannot be activated if your opponent controls fewer Spell/Trap Cards than the "Fortune Lady"
      // monsters you control (counted again when it resolves). https://edisonrul.ing/cards/f/fortune-lady-wind.html
      canActivate: (ctx) => ctx.spellTraps('opp').length > 0 && ctx.spellTraps('opp').length >= ctx.faceUpMonsters('me', isFortuneLady).length,
      resolve: async (ctx) => {
        const n = ctx.faceUpMonsters('me', isFortuneLady).length;
        const st = ctx.spellTraps('opp');
        if (!n || !st.length) return;
        const k = Math.min(n, st.length);
        const sel = await ctx.select(st, k, k, `Destroy ${k} Spell/Trap Card(s) your opponent controls.`, 'destroy');
        if (sel.length) await ctx.destroy(sel);
      },
    },
  ],
});

monster('Fortune Lady Water', {
  attribute: 'WATER',
  race: 'Spellcaster',
  level: 4,
  atk: 0,
  def: 0,
  sets: ['fortune-lady'],
  aiValue: 1000,
  text: 'This card\'s ATK/DEF become its Level x 300. Once per turn, during your Standby Phase: Increase this card\'s Level by 1 (max. 12). If this card is Special Summoned while you control a "Fortune Lady" monster except "Fortune Lady Water": Draw 2 cards.',
  effects: [
    ...fortuneLadyBase(300),
    {
      kind: 'trigger',
      event: 'specialSummoned',
      mandatory: true,
      label: 'Draw 2',
      categories: ['draw'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.faceUpMonsters('me', (c) => isFortuneLady(c) && c.data.name !== 'Fortune Lady Water').length > 0,
      resolve: async (ctx) => {
        await ctx.draw(2);
      },
    },
  ],
});

monster('Fortune Lady Dark', {
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 5,
  atk: 0,
  def: 0,
  sets: ['fortune-lady'],
  aiValue: 1100,
  text: 'This card\'s ATK and DEF are equal to its Level x 400. During each of your Standby Phases, increase the Level of this card by 1 (max 12). When a face-up "Fortune Lady" monster you control destroys an opponent\'s monster by battle and sends it to the Graveyard, you can select and Special Summon 1 "Fortune Lady" monster from your Graveyard.',
  effects: [
    ...fortuneLadyBase(400),
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      range: ['mzone'],
      when: true,
      label: 'Revive a Fortune Lady',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => {
        const killer = evo(ev);
        const dead = evc(ev);
        return (
          !!killer &&
          !!dead &&
          ctx.self.faceUp &&
          killer.location === 'mzone' &&
          killer.faceUp &&
          killer.controller === ctx.player &&
          isFortuneLady(killer) &&
          ev.fromController === ctx.opp &&
          dead.location === 'grave'
        );
      },
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => isFortuneLady(c) && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => isFortuneLady(c) && ctx.canSummonCard(c)), 1, 1, 'Select 1 "Fortune Lady" monster in your GY.', 'specialSummon', {
          aiScore: (c) => lvl(c) + (c.data.name === 'Fortune Lady Water' ? 5 : 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.specialSummon(t[0], { pos: aiPos(ctx, t[0]) });
      },
    },
  ],
});

monster('Fortune Lady Earth', {
  attribute: 'EARTH',
  race: 'Spellcaster',
  level: 6,
  atk: 0,
  def: 0,
  sets: ['fortune-lady'],
  aiValue: 1200,
  text: 'This card\'s ATK and DEF are equal to its Level x 400. During each of your Standby Phases, increase the Level of this card by 1 (max 12). When the Level of this card increases, inflict 400 damage to your opponent.',
  effects: [...fortuneLadyBase(400)],
});

monster('Solitaire Magician', {
  attribute: 'LIGHT',
  race: 'Spellcaster',
  level: 4,
  atk: 1600,
  def: 1300,
  aiValue: 500,
  text: 'Once per turn, you can select 1 face-up "Fortune Lady" monster you control and 1 other face-up monster on the field. Reduce the Level of the selected "Fortune Lady" monster by 3, and destroy the other selected monster.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Lower a Fortune Lady: destroy 1 monster',
      categories: ['destroy'],
      // https://edisonrul.ing/cards/s/solitaire-magician.html — a "Fortune Lady" whose Level is less than 3 cannot be chosen.
      canActivate: (ctx) => {
        const fl = ctx.faceUpMonsters('me', (c) => isFortuneLady(c) && ctx.level(c) >= 3 && ctx.canTarget(c));
        return fl.length > 0 && ctx.faceUpMonsters('both', (c) => ctx.canTarget(c) && fl.some((f) => f !== c)).length > 0;
      },
      activate: async (ctx) => {
        const [fl] = await ctx.selectTargets(ctx.faceUpMonsters('me', (c) => isFortuneLady(c) && ctx.level(c) >= 3), 1, 1, 'Select 1 face-up "Fortune Lady" monster you control.', 'target', {
          aiScore: (c) => ctx.level(c),
        });
        ctx.data.fl = fl;
        const [victim] = await ctx.selectTargets(ctx.faceUpMonsters('both', (c) => c !== fl), 1, 1, 'Select 1 other face-up monster to destroy.', 'destroy');
        ctx.data.victim = victim;
      },
      resolve: async (ctx) => {
        const valid = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp);
        const fl = ctx.data.fl as C | undefined;
        const victim = ctx.data.victim as C | undefined;
        if (fl && valid.includes(fl)) ctx.addTempMod(fl, 'level', -Math.min(3, ctx.level(fl) - 1), 'field');
        if (victim && valid.includes(victim)) await ctx.destroy(victim);
      },
      ai: {
        score: (ctx) => {
          const best = bestTarget(ctx.game, ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)));
          return best && cardValue(ctx.game, best) >= 1200 ? 55 : 0;
        },
      },
    },
  ],
});

monster('Catoblepas and the Witch of Fate', {
  attribute: 'EARTH',
  race: 'Spellcaster',
  level: 4,
  atk: 1800,
  def: 0,
  aiValue: 400,
  text: 'When your opponent Special Summons a monster(s), you can remove from play 1 monster with ? ATK from your Graveyard to destroy that Special Summoned monster(s).',
  effects: [
    {
      kind: 'trigger',
      event: 'specialSummoned',
      range: ['mzone'],
      when: true,
      label: 'Banish a ? ATK monster: destroy the summoned monster(s)',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => ctx.self.faceUp && ev.player === ctx.opp && evc(ev)?.location === 'mzone',
      canActivate: (ctx) => ctx.grave('me', hasQuestionAtk).length > 0,
      activate: async (ctx) => {
        ctx.data.victims = batchCards(ctx, ['specialSummoned']).filter((c) => c.location === 'mzone' && c.controller === ctx.opp);
        ctx.data.ids = (ctx.data.victims as C[]).map((c) => c.moveId);
        const cost = await ctx.select(ctx.grave('me', hasQuestionAtk), 1, 1, 'Banish 1 monster with ? ATK from your GY.', 'cost');
        if (!cost.length) return false;
        await ctx.banish(cost, 'cost');
      },
      resolve: async (ctx) => {
        const v = (ctx.data.victims as C[]).filter((c, i) => c.location === 'mzone' && c.moveId === ctx.data.ids[i]);
        if (v.length) await ctx.destroy(v);
      },
      ai: {
        score: (ctx) => {
          const v = batchCards(ctx, ['specialSummoned']).filter((c) => c.location === 'mzone' && c.controller === ctx.opp);
          return v.reduce((a, c) => a + cardValue(ctx.game, c), 0) >= 1500 ? 1 : 0;
        },
      },
    },
  ],
});

// ---- Spiders ----

monster('Dark Spider', {
  attribute: 'DARK',
  race: 'Insect',
  level: 1,
  atk: 0,
  def: 0,
  aiValue: 200,
  text: 'Once per turn, you can increase the Level of 1 face-up Insect-Type monster you control by 2, until the End Phase.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Insect Level +2',
      categories: [],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => raceIs(c, 'Insect')).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.faceUpMonsters('me', (c) => raceIs(c, 'Insect'));
        const [c] = await ctx.select(cands, 1, 1, 'Increase the Level of 1 face-up Insect-Type monster by 2.', 'buff', {
          aiScore: (c) => (c === ctx.self ? 0 : 10),
        });
        if (c) await raiseLevel(ctx, c, 2, 'turn');
      },
      ai: {
        score: (ctx) => {
          // Only when it opens a Synchro Summon that isn't there yet.
          const g = ctx.game;
          const before = ctx.extra().filter((s) => g.canSynchro(ctx.player, s)).length;
          for (const c of ctx.faceUpMonsters('me', (m) => raceIs(m, 'Insect'))) {
            ctx.addTempMod(c, 'level', 2, 'turn');
            const after = ctx.extra().filter((s) => g.canSynchro(ctx.player, s)).length;
            c.tempMods.pop();
            if (after > before) return 50;
          }
          return 0;
        },
      },
    },
  ],
});

monster('Ground Spider', {
  attribute: 'EARTH',
  race: 'Insect',
  level: 4,
  atk: 0,
  def: 1500,
  aiValue: 300,
  text: 'Once per turn, if you control this face-up Defense Position monster when your opponent Normal or Special Summons a monster(s), you can change that monster(s) to Defense Position.',
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      range: ['mzone'],
      opt: true,
      when: true,
      label: 'Change summoned monster(s) to Defense Position',
      categories: ['position'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return (
          !!c &&
          ctx.self.faceUp &&
          ctx.self.pos === 'def' &&
          ev.player === ctx.opp &&
          ev.method !== 'flip' &&
          c.location === 'mzone' &&
          c.faceUp &&
          c.pos === 'atk'
        );
      },
      resolve: async (ctx) => {
        for (const c of batchCards(ctx, ['summoned'])) {
          if (c.location === 'mzone' && c.faceUp && c.pos === 'atk' && c.controller === ctx.opp) await ctx.changePos(c, 'def', true);
        }
      },
    },
  ],
});

monster('Relinquished Spider', {
  attribute: 'EARTH',
  race: 'Insect',
  level: 2,
  atk: 300,
  def: 500,
  aiValue: 300,
  text: 'If you have 4 or more Insect-Type monsters in your Graveyard, you can Tribute this card to destroy all face-up Defense Position monsters your opponent controls.',
  effects: [
    {
      kind: 'ignition',
      label: 'Tribute: destroy face-up Defense Position monsters',
      categories: ['destroy', 'destroyMulti'],
      condition: (ctx) => ctx.grave('me', (c) => raceIs(c, 'Insect')).length >= 4,
      canActivate: (ctx) => !ctx.query(ctx.self, 'cannotBeTributed'),
      activate: async (ctx) => {
        await tributeCost(ctx, [ctx.self]);
      },
      resolve: async (ctx) => {
        const t = ctx.faceUpMonsters('opp', (c) => c.pos === 'def');
        if (t.length) await ctx.destroy(t);
      },
      ai: {
        score: (ctx) => {
          const t = ctx.faceUpMonsters('opp', (c) => c.pos === 'def');
          return t.reduce((a, c) => a + cardValue(ctx.game, c), 0) >= 1500 ? 50 : 0;
        },
      },
    },
  ],
});

monster('Spyder Spider', {
  attribute: 'EARTH',
  race: 'Insect',
  level: 4,
  atk: 1500,
  def: 1000,
  aiValue: 300,
  text: 'When this card destroys an opponent\'s Defense Position monster by battle, you can select and Special Summon 1 Level 4 or lower Insect-Type monster from your Graveyard.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      when: true,
      label: 'Revive a Level 4 or lower Insect',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => selfDestroysByBattle(ctx, ev) && ctx.game.battle?.calc?.targetPos === 'def' && ctx.game.battle?.target === evc(ev),
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => raceIs(c, 'Insect') && lvl(c) <= 4 && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => raceIs(c, 'Insect') && lvl(c) <= 4 && ctx.canSummonCard(c)), 1, 1, 'Select 1 Level 4 or lower Insect.', 'specialSummon', {
          aiScore: reviveScore,
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.specialSummon(t[0], { pos: aiPos(ctx, t[0]) });
      },
    },
  ],
});

monster('Mother Spider', {
  attribute: 'DARK',
  race: 'Insect',
  level: 6,
  atk: 2300,
  def: 1200,
  aiValue: 400,
  text: 'If you have only Insect-Type monsters in your Graveyard, you can send 2 face-up Defense Position monsters your opponent controls to the Graveyard and Special Summon this card from your hand.',
  effects: [
    {
      kind: 'proc',
      label: 'Send 2 opponent\'s Defense Position monsters to the GY',
      categories: ['specialSummon', 'toDeck'],
      condition: (ctx) => {
        const mons = ctx.grave('me', (c) => c.isMonster);
        return mons.length > 0 && mons.every((c) => raceIs(c, 'Insect')) && ctx.freeMZones() > 0 && ctx.faceUpMonsters('opp', (c) => c.pos === 'def').length >= 2;
      },
      perform: async (ctx) => {
        const sel = await ctx.select(ctx.faceUpMonsters('opp', (c) => c.pos === 'def'), 2, 2, 'Send 2 face-up Defense Position monsters your opponent controls to the GY.', 'destroy');
        if (sel.length < 2) return false;
        await ctx.sendToGrave(sel, 'cost');
        return true;
      },
      ai: { score: () => 80 },
    },
  ],
});

// ---- Reptilianne ----

monster('Reptilianne Gorgon', {
  attribute: 'DARK',
  race: 'Reptile',
  level: 3,
  atk: 1400,
  def: 1400,
  sets: ['reptilianne'],
  aiValue: 400,
  text: 'If this card attacks a monster, after damage calculation: The ATK of that monster becomes 0, also it cannot change its battle position.',
  effects: [
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      mandatory: true,
      label: 'ATK becomes 0',
      categories: ['atkChange'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && evo(ev)?.location === 'mzone' && !!evo(ev)?.faceUp,
      activate: async (ctx) => {
        const t = evo(ctx.event!)!;
        ctx.data.t = t;
        ctx.data.mid = t.moveId;
      },
      resolve: async (ctx) => {
        const t = ctx.data.t as C;
        if (t && t.location === 'mzone' && t.moveId === ctx.data.mid && t.faceUp) reptilianneLock(ctx, t);
      },
    },
  ],
});

monster('Reptilianne Medusa', {
  attribute: 'DARK',
  race: 'Reptile',
  level: 6,
  atk: 2200,
  def: 800,
  sets: ['reptilianne'],
  aiValue: 400,
  text: 'Send 1 card from your hand to the Graveyard and select 1 face-up monster your opponent controls. The ATK of the selected monster becomes 0, and it cannot change its battle position.',
  effects: [
    {
      kind: 'ignition',
      label: 'Send 1 card: ATK becomes 0',
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.hand('me').length > 0 && ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const cost = await ctx.select(ctx.hand('me'), 1, 1, 'Send 1 card from your hand to the GY.', 'cost');
        if (!cost.length) return false;
        await ctx.sendToGrave(cost, 'cost');
        await ctx.selectTargets(ctx.faceUpMonsters('opp'), 1, 1, 'Select 1 face-up monster your opponent controls.', 'target', {
          aiScore: (c) => ctx.atk(c) + (hasAtkBecomes(c) ? -9000 : 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp);
        if (t.length) reptilianneLock(ctx, t[0]);
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c) && !hasAtkBecomes(c)).map((c) => ctx.atk(c)));
          if (best < 1500 || ctx.hand('me').length < 2) return 0;
          return best > ctx.atk(ctx.self) || ctx.monsters('me', isReptilianne).length > 1 ? 45 : 25;
        },
      },
    },
  ],
});

monster('Reptilianne Scylla', {
  attribute: 'DARK',
  race: 'Reptile',
  level: 4,
  atk: 1800,
  def: 1200,
  sets: ['reptilianne'],
  aiValue: 300,
  text: 'If this card destroys a monster with 0 ATK by battle, you can Special Summon that monster from the Graveyard to your side of the field in face-up Defense Position. The effect(s) of that monster is negated.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      when: true,
      label: 'Special Summon the destroyed monster',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => {
        const dead = evc(ev);
        return ev.other === ctx.self && ctx.self.location === 'mzone' && !!dead && dead.location === 'grave' && calcAtkOf(ctx.game, dead) === 0;
      },
      condition: (ctx) => ctx.canSpecialSummon(),
      activate: async (ctx) => {
        const dead = evc(ctx.event!)!;
        ctx.data.dead = dead;
        ctx.data.mid = dead.moveId;
      },
      resolve: async (ctx) => {
        const d = ctx.data.dead as C;
        if (!d || d.location !== 'grave' || d.moveId !== ctx.data.mid || !ctx.canSummonCard(d)) return;
        const [s] = await ctx.specialSummon(d, { pos: 'def', controller: ctx.player });
        if (s) ctx.negateEffects(s, 'field');
      },
    },
  ],
});

monster('Reptilianne Viper', {
  attribute: 'DARK',
  race: 'Reptile',
  level: 2,
  atk: 0,
  def: 0,
  types: ['tuner'],
  sets: ['reptilianne'],
  aiValue: 400,
  text: 'When this card is Normal Summoned, you can select and take control of 1 face-up monster with 0 ATK your opponent controls.',
  effects: [
    {
      kind: 'trigger',
      event: 'normalSummoned',
      when: true,
      label: 'Take control of a 0 ATK monster',
      categories: ['control'],
      canActivate: (ctx) => ctx.freeMZones() > 0 && ctx.faceUpMonsters('opp', (c) => ctx.atk(c) === 0 && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('opp', (c) => ctx.atk(c) === 0), 1, 1, 'Select 1 face-up monster with 0 ATK your opponent controls.', 'control');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp && ctx.atk(c) === 0 && c.controller === ctx.opp);
        if (t.length) await ctx.takeControl(t[0], false);
      },
    },
  ],
});

// ---- Earthbound Immortals ----

monster('Earthbound Immortal Ccarayhua', {
  attribute: 'DARK',
  race: 'Reptile',
  level: 10,
  atk: 2800,
  def: 1800,
  sets: ['earthbound-immortal'],
  aiValue: 600,
  text: 'There can only be 1 "Earthbound Immortal" monster on the field. If there is no face-up Field Spell on the field, destroy this card. Your opponent\'s monsters cannot target this card for attacks. This card can attack your opponent directly. If this card is destroyed by a card effect, except by its own effect: Destroy all cards on the field.',
  effects: [
    ...earthboundRules(),
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      label: 'Destroy all cards on the field',
      categories: ['destroy', 'destroyMulti'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone' && (ev.reasons ?? []).includes('effect') && ev.reasonCard !== ctx.self,
      resolve: async (ctx) => {
        const all = ctx.field('both');
        if (all.length) await ctx.destroy(all);
      },
    },
  ],
});

monster('Earthbound Immortal Uru', {
  attribute: 'DARK',
  race: 'Insect',
  level: 10,
  atk: 3000,
  def: 3000,
  sets: ['earthbound-immortal'],
  aiValue: 600,
  text: 'There can only be 1 "Earthbound Immortal" monster on the field. If there is no face-up Field Spell on the field, destroy this card. Your opponent\'s monsters cannot target this card for attacks. This card can attack your opponent directly. Once per turn: You can Tribute 1 other monster, then target 1 face-up monster your opponent controls; take control of that target, until the End Phase.',
  effects: [
    ...earthboundRules(),
    {
      kind: 'ignition',
      opt: true,
      label: 'Tribute 1: take control until the End Phase',
      categories: ['control'],
      canActivate: (ctx) => tributable(ctx, (c) => c !== ctx.self).length > 0 && ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const cost = await ctx.select(tributable(ctx, (c) => c !== ctx.self), 1, 1, 'Tribute 1 other monster.', 'tribute');
        if (!cost.length) return false;
        await tributeCost(ctx, cost);
        await ctx.selectTargets(ctx.faceUpMonsters('opp'), 1, 1, 'Target 1 face-up monster your opponent controls.', 'control');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp);
        if (t.length && ctx.freeMZones() > 0) await ctx.takeControl(t[0], true);
      },
      ai: {
        score: (ctx) => {
          const fodder = Math.min(...tributable(ctx, (c) => c !== ctx.self).map((c) => cardValue(ctx.game, c)));
          const best = bestTarget(ctx.game, ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)));
          return best && ctx.phase === 'main1' && cardValue(ctx.game, best) > fodder + 300 ? 50 : 0;
        },
      },
    },
  ],
});

monster('Earthbound Immortal Wiraqocha Rasca', {
  attribute: 'DARK',
  race: 'Winged Beast',
  level: 10,
  atk: 100,
  def: 100,
  sets: ['earthbound-immortal'],
  aiValue: 800,
  text: 'There can only be 1 "Earthbound Immortal" monster on the field. If there is no face-up Field Spell on the field, destroy this card. Your opponent\'s monsters cannot target this card for attacks. This card can attack directly. If this card is Normal Summoned: Target 1 to 3 cards you control, but not more than your opponent has in their hand; shuffle them into the Deck, then discard the same number of random cards from your opponent\'s hand (or as many as possible), and if you do, this card gains 1000 ATK for each card discarded by this effect.',
  effects: [
    ...earthboundRules(),
    {
      kind: 'trigger',
      event: 'normalSummoned',
      when: true,
      label: 'Shuffle cards: random discard',
      categories: ['discard', 'toDeck', 'atkChange'],
      canActivate: (ctx) => ctx.hand('opp').length > 0 && ctx.field('me', (c) => c !== ctx.self && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const cands = ctx.field('me', (c) => c !== ctx.self);
        const max = Math.min(3, ctx.hand('opp').length, cands.length);
        // Never send away the Field Spell this card needs.
        const cheap = (c: C) => (c.isToken ? 3000 : 0) + (c.faceUp && !c.isMonster && c.data.stype !== 'field' ? 500 : 0) - (c.data.stype === 'field' ? 5000 : 0) - cardValue(ctx.game, c);
        const ranked = [...cands].sort((a, b) => cheap(b) - cheap(a));
        const k = (await ctx.option('Target how many cards?', Array.from({ length: max }, (_, i) => `${i + 1}`), (i) => (ranked.slice(0, i + 1).every((c) => cheap(c) > -1600) ? i : -1))) + 1;
        await ctx.selectTargets(cands, k, k, `Target ${k} card(s) you control to shuffle into the Deck.`, 'cost', { aiScore: cheap });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField && c.controller === ctx.player);
        if (!t.length) return;
        await ctx.toDeck(t, 'shuffle');
        const hand = [...ctx.hand('opp')];
        const picks: C[] = [];
        for (let i = 0; i < t.length && hand.length; i++) picks.push(hand.splice(ctx.game.rng.int(hand.length), 1)[0]);
        if (!picks.length) return;
        const d = await ctx.game.discard(picks, 'effect', ctx.player, ctx.self);
        const n = d.filter((c) => c.location === 'grave' || c.location === 'banished').length;
        if (n && ctx.self.location === 'mzone' && ctx.self.faceUp) ctx.addTempMod(ctx.self, 'atk', 1000 * n, 'field');
      },
      ai: { score: (ctx) => (ctx.field('me', (c) => c !== ctx.self && c.data.stype !== 'field').length > 0 ? 1 : 0) },
    },
  ],
});

// ---- Koa'ki Meiru ----

monster("Koa'ki Meiru Sea Panther", {
  attribute: 'WATER',
  race: 'Sea Serpent',
  level: 4,
  atk: 1900,
  def: 1200,
  sets: ['koaki-meiru'],
  aiValue: 200,
  text: 'During each of your End Phases, destroy this card unless you send 1 "Iron Core of Koa\'ki Meiru" from your hand to the Graveyard or reveal 1 WATER monster in your hand. Once per turn, you can send 1 "Iron Core of Koa\'ki Meiru" from your hand to the Graveyard to return 1 Spell Card from your Graveyard to the top of your Deck.',
  effects: [
    koakiUpkeep('WATER monster', (c) => attrIs(c, 'WATER')),
    {
      kind: 'ignition',
      opt: true,
      label: 'Send Iron Core: Spell to the top of the Deck',
      categories: ['toDeck'],
      canActivate: (ctx) => ctx.hand('me', (c) => c.name === IRON_CORE).length > 0 && ctx.grave('me', (c) => c.isSpell).length > 0,
      activate: async (ctx) => {
        const [core] = await ctx.select(ctx.hand('me', (c) => c.name === IRON_CORE), 1, 1, `Send 1 "${IRON_CORE}" to the GY.`, 'cost');
        if (!core) return false;
        await ctx.sendToGrave(core, 'cost');
      },
      resolve: async (ctx) => {
        const sp = ctx.grave('me', (c) => c.isSpell);
        const [s] = await ctx.select(sp, 1, 1, 'Return 1 Spell Card from your GY to the top of your Deck.', 'toHand', {
          aiScore: (c) => (c.name === IRON_CORE ? 0 : 1000 + (c.data.aiValue ?? 0)),
        });
        if (s) await ctx.toDeck(s, 'top');
      },
      ai: { score: (ctx) => (ctx.hand('me', (c) => c.name === IRON_CORE).length >= 2 ? 30 : 0) },
    },
  ],
});

monster("Koa'ki Meiru Rooklord", {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 7,
  atk: 2800,
  def: 2200,
  sets: ['koaki-meiru'],
  aiValue: 500,
  text: 'During each of your End Phases, destroy this card unless you send 1 "Iron Core of Koa\'ki Meiru" from your hand to the Graveyard or reveal 1 Warrior-Type monster in your hand. You can Tribute Summon this card by Tributing 1 "Koa\'ki Meiru" monster. When this card is Normal Summoned, you can remove from play 1 "Koa\'ki Meiru" card in your Graveyard to destroy up to 2 cards your opponent controls.',
  effects: [
    koakiUpkeep('Warrior-Type monster', (c) => raceIs(c, 'Warrior')),
    {
      // APPROX (same technique as Beast King Barbaros in tournament-extras.ts): the 1-Tribute Summon is a
      // separate hand action that performs a real Tribute Summon (uses the Normal Summon, can be negated).
      kind: 'proc',
      label: "Tribute Summon (1 Koa'ki Meiru)",
      categories: ['destroy'],
      condition: (ctx) =>
        ctx.game.players[ctx.player].normalSummonsLeft > 0 &&
        !ctx.game.queryPlayer(ctx.player, 'cannotNormalSummon') &&
        ctx.game.tributeCandidates(ctx.player, ctx.self).some(isKoakiMonster),
      perform: async (ctx) => {
        const g = ctx.game;
        const p = ctx.player;
        const card = ctx.self;
        const trib = await ctx.select(g.tributeCandidates(p, card).filter(isKoakiMonster), 1, 1, `Tribute 1 "Koa'ki Meiru" monster for ${card.name}.`, 'tribute');
        if (!trib.length) return false;
        g.log(`${g.players[p].name} Tributes ${trib.map((c) => c.name).join(', ')}.`, 'action', p);
        await g.moveCards(trib, 'grave', { reason: 'tribute', reasons: ['tribute', 'cost'], reasonPlayer: p, reasonCard: card });
        if (card.location !== 'hand' || g.freeMZones(p) <= 0) return false;
        g.players[p].normalSummonsLeft--;
        g.recentEvents = [];
        g.beginBatch();
        g.rawMove(card, 'mzone', { controller: p, faceUp: true, pos: 'atk' });
        card.summonTurn = g.turn;
        card.setTurn = -1;
        card.summonMethod = 'tribute';
        card.flags.tributeCount = trib.length;
        g.log(`${g.players[p].name} Tribute Summons ${card.name}.`, 'action', p);
        await g.anim({ type: 'summon', cards: [card.uid], method: 'tribute', from: ['hand'] });
        if (await g.summonNegationWindow([card], p, 'tribute')) return false;
        g.beginBatch();
        const common = { card, player: p, from: 'hand' as Location, to: 'mzone' as Location, tributes: trib, method: 'tribute' as const };
        g.emit({ type: 'normalSummoned', ...common });
        g.emit({ type: 'tributeSummoned', ...common });
        g.emit({ type: 'summoned', ...common });
        await g.processTriggers(true);
        // The summon is done; the engine must not Special Summon anything.
        return false;
      },
      ai: {
        score: (ctx) => {
          const fodder = Math.min(...ctx.game.tributeCandidates(ctx.player, ctx.self).filter(isKoakiMonster).map((c) => cardValue(ctx.game, c)));
          return 3300 - fodder >= 400 ? 60 : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'normalSummoned',
      when: true,
      label: "Banish a Koa'ki Meiru: destroy up to 2",
      categories: ['destroy'],
      // https://edisonrul.ing/cards/k/koaki-meiru-rooklord.html — banishing the "Koa'ki Meiru" card is a cost, and the
      // effect targets 1 or 2 cards your opponent controls.
      canActivate: (ctx) => ctx.grave('me', isKoaki).length > 0 && ctx.field('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const cost = await ctx.select(ctx.grave('me', isKoaki), 1, 1, '"Koa\'ki Meiru" card to banish.', 'cost');
        if (!cost.length) return false;
        await ctx.banish(cost, 'cost');
        await ctx.selectTargets(ctx.field('opp'), 1, 2, 'Target up to 2 cards your opponent controls to destroy.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
      },
    },
  ],
});

// ---- Gemini & Normal Monster support ----

monster('Tuned Magician', {
  attribute: 'WIND',
  race: 'Spellcaster',
  level: 4,
  atk: 1800,
  def: 1600,
  types: ['gemini'],
  aiValue: 200,
  text: 'This card is treated as a Normal Monster while face-up on the field or in the Graveyard. While this card is face-up on the field, you can Normal Summon it to have it be treated as an Effect Monster with this effect:\n● This card is treated as a Tuner monster.',
  effects: [
    geminiSummon((ctx) => {
      // Worth it when it opens a Synchro Summon right now.
      // (Temporarily pretend it is a Tuner to ask the engine.)
      const g = ctx.game;
      Object.defineProperty(ctx.self, 'isTuner', { configurable: true, get: () => true });
      const can = ctx.extra().some((s) => g.canSynchro(ctx.player, s) && (s.data.atk ?? 0) + (s.data.aiValue ?? 0) >= 2400);
      delete (ctx.self as { isTuner?: boolean }).isTuner;
      return can ? 60 : 0;
    }),
    {
      // "● This card is treated as a Tuner monster." (only while Gemini Summoned; a dataMod, so hasType('tuner') and
      // isTuner both see it, and it is lost when the effect is negated).
      kind: 'continuous',
      active: (ctx) => !!ctx.self.flags.geminiSummoned,
      dataMod: { apply: (d) => (d.mtypes?.includes('tuner') ? d : dataVariant(d, 'tuner', { mtypes: [...(d.mtypes ?? []), 'tuner'] })) },
    },
  ],
});

/** Cards that can hold Spell Counters (by name), for Crusader of Endymion. */
const SPELL_COUNTER_HOLDERS = new Set([
  'Breaker the Magical Warrior',
  'Arcanite Magician',
  'Endymion, the Master Magician',
  'Magical Citadel of Endymion',
  'Royal Magical Library',
  'Mythical Beast Cerberus',
  'Apprentice Magician',
  'Skilled Dark Magician',
  'Skilled White Magician',
  'Silent Magician LV4',
  'Defender, the Magical Knight',
  'Magical Marionette',
  'Dark Red Enchanter',
  'Blast Magician',
  'Magical Exemplar',
]);
const canHoldSpellCounter = (c: C) => c.onField && c.faceUp && (SPELL_COUNTER_HOLDERS.has(c.data.name) || c.inSet('spell-counter'));

monster('Crusader of Endymion', {
  attribute: 'LIGHT',
  race: 'Spellcaster',
  level: 4,
  atk: 1900,
  def: 1200,
  types: ['gemini'],
  aiValue: 300,
  text: 'This card is treated as a Normal Monster while face-up on the field or in the GY. While this card is a Normal Monster on the field, you can Normal Summon it to have it become an Effect Monster with this effect.\n● Once per turn: You can target 1 face-up card on the field that you can place a Spell Counter on; place 1 Spell Counter on it, and if you do, this card gains 600 ATK until the end of this turn.',
  effects: [
    geminiSummon((ctx) => (ctx.field('me', canHoldSpellCounter).length ? 45 : 30)),
    {
      kind: 'ignition',
      opt: true,
      label: 'Place a Spell Counter: +600 ATK',
      categories: ['atkChange'],
      condition: gemini,
      canActivate: (ctx) => ctx.field('both', (c) => canHoldSpellCounter(c) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.field('both', canHoldSpellCounter), 1, 1, 'Target 1 face-up card you can place a Spell Counter on.', 'buff', {
          aiScore: (c) => (c.controller === ctx.player ? 100 : 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => canHoldSpellCounter(c));
        if (!t.length) return;
        t[0].counters.spell = (t[0].counters.spell ?? 0) + 1;
        if (ctx.self.location === 'mzone' && ctx.self.faceUp) ctx.addTempMod(ctx.self, 'atk', 600, 'turn');
        ctx.game.update();
      },
      ai: { score: (ctx) => (ctx.phase === 'main1' ? 45 : 20) },
    },
  ],
});

monster('Woodland Archer', {
  attribute: 'EARTH',
  race: 'Beast-Warrior',
  level: 3,
  atk: 1400,
  def: 1300,
  nomi: true,
  cannotNormalSummon: true,
  aiValue: 500,
  text: 'This card cannot be Normal Summoned or Set. This card cannot be Special Summoned except by having 2 or more Normal Monsters in your Graveyard. You can Tribute this card to add 1 Gemini monster from your Deck to your hand.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (2+ Normal Monsters in GY)',
      condition: (ctx) => ctx.grave('me', isNormalLike).length >= 2 && ctx.freeMZones() > 0,
      ai: { score: () => 65 },
    },
    {
      kind: 'ignition',
      label: 'Tribute: search a Gemini monster',
      categories: ['search'],
      canActivate: (ctx) => !ctx.query(ctx.self, 'cannotBeTributed') && ctx.deck('me', isGemini).length > 0,
      activate: async (ctx) => {
        await tributeCost(ctx, [ctx.self]);
      },
      resolve: async (ctx) => {
        await ctx.search(isGemini, 1, 'Add 1 Gemini monster from your Deck to your hand.');
      },
      ai: { score: (ctx) => (ctx.phase === 'main2' || ctx.faceUpMonsters('opp', (c) => ctx.atk(c) > 1400).length ? 45 : 0) },
    },
  ],
});

monster('Knight of the Red Lotus', {
  attribute: 'FIRE',
  race: 'Warrior',
  level: 6,
  atk: 2100,
  def: 1800,
  aiValue: 600,
  text: 'If you have exactly 3 Normal Monsters in your Graveyard, you can Special Summon this card from your hand by removing from play 2 Normal Monsters from your Graveyard. Once per turn, you can select and Special Summon 1 Level 4 or lower Normal Monster from your Graveyard.',
  effects: [
    {
      kind: 'proc',
      label: 'Banish 2 Normal Monsters from the GY',
      condition: (ctx) => ctx.grave('me', isNormalLike).length === 3 && ctx.freeMZones() > 0,
      perform: async (ctx) => {
        const sel = await ctx.select(ctx.grave('me', isNormalLike), 2, 2, 'Banish 2 Normal Monsters from your GY.', 'cost', {
          aiScore: (c) => -(c.data.atk ?? 0) - (lvl(c) <= 4 ? 1000 : 0),
        });
        if (sel.length < 2) return false;
        await ctx.banish(sel, 'cost');
        return true;
      },
      ai: { score: () => 72 },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Revive a Level 4 or lower Normal Monster',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => isNormalLike(c) && lvl(c) <= 4 && ctx.canSummonCard(c) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => isNormalLike(c) && lvl(c) <= 4 && ctx.canSummonCard(c)), 1, 1, 'Select 1 Level 4 or lower Normal Monster in your GY.', 'specialSummon', {
          aiScore: reviveScore,
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.specialSummon(t[0], { pos: aiPos(ctx, t[0]) });
      },
      ai: { score: () => 58 },
    },
  ],
});

monster('Energy Bravery', {
  attribute: 'LIGHT',
  race: 'Warrior',
  level: 4,
  atk: 1700,
  def: 1200,
  aiValue: 200,
  text: 'Gemini monsters you control that are being treated as Effect Monsters cannot be destroyed by card effects.',
  effects: [
    {
      kind: 'continuous',
      mods: [{ q: 'indestructibleEffect', to: 'cards', filter: (ctx, c: C) => c.controller === ctx.player && geminiActive(c) }],
    },
  ],
});

monster('Lord British Space Fighter', {
  attribute: 'LIGHT',
  race: 'Machine',
  level: 4,
  atk: 1200,
  def: 800,
  aiValue: 400,
  text: 'If this card destroys an opponent\'s monster by battle: Activate 1 of these effects;\n● This card can make a second attack in a row.\n● Target 1 Set card on the field; destroy that target.\n● Special Summon 1 "Multi Token" (Machine/LIGHT/Level 4/ATK 1200/DEF 1200).',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Choose 1 effect',
      categories: ['destroy', 'specialSummon'],
      eventFilter: selfDestroysByBattle,
      activate: async (ctx) => {
        const sets = ctx.field('both', (c) => !c.faceUp && ctx.canTarget(c));
        const opts = ['Make a second attack in a row'];
        const kinds = ['attack'];
        if (sets.length) {
          opts.push('Destroy 1 Set card');
          kinds.push('destroy');
        }
        if (ctx.freeMZones() > 0 && ctx.canSpecialSummon()) {
          opts.push('Special Summon 1 "Multi Token"');
          kinds.push('token');
        }
        const oppSets = ctx.field('opp', (c) => !c.faceUp).length;
        const i = await ctx.option('Lord British Space Fighter: choose 1 effect', opts, (k) => {
          if (kinds[k] === 'destroy') return oppSets ? 3 : -1;
          if (kinds[k] === 'attack') return ctx.monsters('opp').length === 0 && ctx.phase === 'battle' ? 2 : 0;
          return 1;
        });
        ctx.data.kind = kinds[i];
        if (ctx.data.kind === 'destroy') await ctx.selectTargets(sets, 1, 1, 'Target 1 Set card to destroy.', 'destroy');
      },
      resolve: async (ctx) => {
        if (ctx.data.kind === 'attack') {
          // APPROX: "a second attack in a row" is an extra attack this Battle Phase (not forced to be next).
          if (ctx.self.location === 'mzone' && ctx.self.faceUp) ctx.addTempMod(ctx.self, 'extraAttacks', 1, 'turn');
        } else if (ctx.data.kind === 'destroy') {
          const t = ctx.validTargets((c) => c.onField && !c.faceUp);
          if (t.length) await ctx.destroy(t);
        } else if (ctx.data.kind === 'token') {
          await ctx.createTokens(multiToken, 1, 'def');
        }
      },
    },
  ],
});

monster('Oshaleon', {
  attribute: 'WATER',
  race: 'Reptile',
  level: 3,
  atk: 1400,
  def: 800,
  aiValue: 300,
  text: 'While you control this face-up Attack Position card, your opponent cannot select a monster other than "Oshaleon" as an attack target. When this card is destroyed by battle and sent to the Graveyard, you can add 1 Reptile-Type monster with 500 or less ATK from your Deck to your hand.',
  effects: [
    {
      kind: 'continuous',
      active: (ctx) => ctx.self.pos === 'atk',
      mods: [{ q: 'cannotBeAttacked', to: 'cards', filter: (ctx, c: C) => c.location === 'mzone' && c.controller === ctx.player && c.name !== 'Oshaleon' }],
    },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      when: true,
      label: 'Search a Reptile with 500 or less ATK',
      categories: ['search'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.location === 'grave',
      canActivate: (ctx) => ctx.deck('me', (c) => raceIs(c, 'Reptile') && (c.data.atk ?? 0) <= 500).length > 0,
      resolve: async (ctx) => {
        await ctx.search((c) => raceIs(c, 'Reptile') && (c.data.atk ?? 0) <= 500, 1, 'Add 1 Reptile-Type monster with 500 or less ATK to your hand.');
      },
    },
  ],
});

// ---- Rituals ----

const djinnRange: Location[] = ['grave', 'banished', 'hand', 'deck', 'mzone', 'szone'];

monster('Djinn Releaser of Rituals', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 3,
  atk: 1200,
  def: 2000,
  sets: ['djinn', 'djinn-of-rituals'],
  aiValue: 500,
  text: 'When you Ritual Summon a monster, you can banish this card from your Graveyard as 1 of the monsters required for the Ritual Summon. If a player Ritual Summons using this card, the other player cannot Special Summon while that Ritual Summoned monster is face-up on the field.',
  effects: [
    {
      // The lock is granted to the Ritual Monster; it lasts wherever this card is now.
      kind: 'continuous',
      range: djinnRange,
      mods: [
        {
          q: 'cannotSpecialSummon',
          to: 'players',
          filter: (ctx, p: PlayerId) =>
            [...ctx.game.faceUpMonsters(0), ...ctx.game.faceUpMonsters(1)].some(
              (m) => (m.flags.sovrDjinnReleaser ?? []).includes(ctx.self.uid) && m.flags.sovrRitualPlayer === ctx.game.opp(p),
            ),
        },
      ],
    },
  ],
});

monster('Djinn Presider of Rituals', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 4,
  atk: 1800,
  def: 1400,
  sets: ['djinn', 'djinn-of-rituals'],
  aiValue: 400,
  text: 'When you Ritual Summon a monster, you can banish this card from your Graveyard as 1 of the monsters required for the Ritual Summon. If the monster Ritual Summoned using this card destroys a monster by battle, the controller of the Ritual Monster draws 1 card.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      range: djinnRange,
      mandatory: true,
      label: 'Ritual Monster destroyed a monster: draw 1',
      categories: ['draw'],
      eventFilter: (ctx, ev) => {
        const killer = evo(ev);
        return !!killer && (killer.flags.sovrDjinnPresider ?? []).includes(ctx.self.uid) && killer.location === 'mzone';
      },
      activate: async (ctx) => {
        ctx.data.drawer = evo(ctx.event!)!.controller;
      },
      resolve: async (ctx) => {
        await ctx.draw(1, ctx.data.drawer as PlayerId);
      },
    },
  ],
});

monster('Divine Grace - Northwemko', {
  attribute: 'LIGHT',
  race: 'Spellcaster',
  level: 7,
  atk: 2700,
  def: 1200,
  types: ['ritual'],
  nomi: true,
  cannotNormalSummon: true,
  aiValue: 600,
  text: 'This card can only be Ritual Summoned with the Ritual Spell Card, "Ritual of Grace". When this card is Ritual Summoned, select a number of face-up cards on the field (except this card), up to the number of monsters you used for the Ritual Summon. While any of the selected cards are face-up on the field, this card cannot be destroyed by card effects.',
  effects: [
    {
      kind: 'trigger',
      event: 'specialSummoned',
      mandatory: true,
      label: 'Select face-up cards',
      categories: ['protect'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.method === 'ritual',
      resolve: async (ctx) => {
        const me = ctx.self;
        if (me.location !== 'mzone') return;
        const n = Math.max(1, me.flags.ritualMaterialCount ?? 1);
        const cands = ctx.field('both', (c) => c !== me && c.faceUp);
        if (!cands.length) return;
        const sel = await ctx.select(cands, 1, n, `Select up to ${n} face-up card(s) on the field.`, 'buff', {
          aiScore: (c) => (c.controller === ctx.player ? 1000 : 0) + (c.isMonster ? 0 : 500) + (c.data.stype === 'continuous' || c.data.ttype === 'continuous' || c.data.stype === 'field' ? 300 : 0),
        });
        me.flags.sovrGrace = sel.map((c) => ({ c, mid: c.moveId }));
        ctx.game.update();
      },
    },
    {
      kind: 'continuous',
      mods: [
        {
          q: 'indestructibleEffect',
          value: (ctx) => ((ctx.self.flags.sovrGrace ?? []) as { c: C; mid: number }[]).some((x) => x.c.onField && x.c.faceUp && x.c.moveId === x.mid),
        },
      ],
    },
  ],
});

// ---- Extra Deck ----

monster('Majestic Star Dragon', {
  attribute: 'WIND',
  race: 'Dragon',
  level: 10,
  atk: 3800,
  def: 3000,
  types: ['synchro'],
  sets: ['majestic'],
  aiValue: 1500,
  text: '"Majestic Dragon" + "Stardust Dragon" + 1 non-Tuner monster\nDuring either player\'s turn, when your opponent activates a card or effect: You can Tribute this card; negate the activation, and if you do, destroy all cards your opponent controls. Once per turn: You can target 1 face-up monster your opponent controls; negate its effects until the end of this turn, and you can activate 1 of its effects as this card\'s effect once this turn. During the End Phase: Target 1 "Stardust Dragon" in your Graveyard; return this card from the field to the Extra Deck, then Special Summon that target.',
  synchro: {
    tuner: (c) => c.name === 'Majestic Dragon',
    minNonTuners: 2,
    maxNonTuners: 2,
    desc: '"Majestic Dragon" + "Stardust Dragon" + 1 non-Tuner monster',
  },
  effects: [
    {
      kind: 'quick',
      label: 'Tribute: negate and destroy all opponent\'s cards',
      categories: ['negate', 'destroy', 'destroyMulti'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && l.player === ctx.opp && !l.negated;
      },
      canActivate: (ctx) => !ctx.query(ctx.self, 'cannotBeTributed'),
      activate: async (ctx) => {
        await tributeCost(ctx, [ctx.self]);
      },
      resolve: async (ctx) => {
        const l = ctx.prevLink();
        if (!l) return;
        ctx.negate(l);
        const all = ctx.field('opp');
        if (all.length) await ctx.destroy(all);
      },
      ai: {
        score: (ctx) => {
          const l = ctx.prevLink();
          if (!l) return 0;
          const theirs = ctx.field('opp').reduce((a, c) => a + cardValue(ctx.game, c), 0);
          const cats = l.effect.categories ?? [];
          const threat = cats.some((c) => ['destroy', 'destroyMulti', 'banish', 'control', 'toDeck'].includes(c)) && (l.ctx.targets.includes(ctx.self) || cats.includes('destroyMulti'));
          return threat || theirs >= 4500 ? 90 : 0;
        },
      },
    },
    {
      // APPROX: the copied effect is used immediately as part of this resolution (one of the target's
      // Ignition/Quick effects whose requirements are met), not activated separately later in the turn.
      kind: 'ignition',
      opt: true,
      label: 'Negate a monster and copy its effect',
      categories: ['negate'],
      canActivate: (ctx) => ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('opp'), 1, 1, 'Target 1 face-up monster your opponent controls.', 'negate', {
          aiScore: (c) => (c.hasType('effect') ? 1000 : 0) + cardValue(ctx.game, c),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp)[0];
        if (!t) return;
        ctx.negateEffects(t, 'turn');
        ctx.log(`${t.name}'s effects are negated until the end of this turn.`);
        if (ctx.self.location !== 'mzone' || !ctx.self.faceUp) return;
        const effs = (t.data.effects ?? []).filter((e) => (e.kind === 'ignition' || e.kind === 'quick') && e.range === undefined && !e.negateSummon);
        const usable = effs.filter((e) => {
          const c2 = new Ctx(ctx.game, ctx.self, e, ctx.player);
          try {
            return (!e.condition || e.condition(c2)) && (!e.canActivate || e.canActivate(c2));
          } catch {
            return false;
          }
        });
        if (!usable.length) return;
        const labels = usable.map((e) => e.label ?? 'Effect');
        const i = await ctx.option(`Use 1 of ${t.name}'s effects as this card's effect?`, ['Don\'t', ...labels], (k) => (k === 0 ? 0 : 1));
        if (i <= 0) return;
        const ef = usable[i - 1];
        const c2 = new Ctx(ctx.game, ctx.self, ef, ctx.player);
        try {
          ctx.log(`${ctx.self.name} uses ${t.name}'s effect (${ef.label ?? 'effect'}).`);
          if (ef.activate && (await ef.activate(c2)) === false) return;
          if (ef.resolve) await ef.resolve(c2);
        } catch (e) {
          if (e instanceof GameOver) throw e;
          console.error('Majestic Star Dragon copy error', t.name, e);
        }
      },
      ai: { score: (ctx) => (ctx.faceUpMonsters('opp', (c) => c.hasType('effect') && ctx.canTarget(c)).length ? 45 : 0) },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['mzone'],
      mandatory: true,
      label: 'Return to the Extra Deck, revive Stardust Dragon',
      categories: ['toDeck', 'specialSummon'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.self.faceUp,
      canActivate: (ctx) => ctx.grave('me', (c) => c.name === 'Stardust Dragon' && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => c.name === 'Stardust Dragon'), 1, 1, 'Target 1 "Stardust Dragon" in your GY.', 'specialSummon');
      },
      resolve: async (ctx) => {
        if (ctx.self.location !== 'mzone') return;
        await ctx.toDeck(ctx.self, 'shuffle');
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length && ctx.canSummonCard(t[0])) await ctx.specialSummon(t[0], { pos: aiPos(ctx, t[0]) });
      },
    },
  ],
});

monster('Reptilianne Hydra', {
  attribute: 'DARK',
  race: 'Reptile',
  level: 6,
  atk: 2100,
  def: 1500,
  types: ['synchro'],
  sets: ['reptilianne'],
  aiValue: 500,
  text: '1 "Reptilianne" Tuner + 1+ non-Tuner monsters\nIf this card is Synchro Summoned: Destroy as many monsters your opponent controls with 0 ATK as possible, and if you do, draw 1 card for each monster destroyed.',
  synchro: { tuner: isReptilianne, desc: '1 "Reptilianne" Tuner + 1+ non-Tuner monsters' },
  effects: [
    {
      kind: 'trigger',
      event: 'synchroSummoned',
      mandatory: true,
      label: 'Destroy 0 ATK monsters, draw',
      categories: ['destroy', 'draw'],
      resolve: async (ctx) => {
        const t = ctx.faceUpMonsters('opp', (c) => ctx.atk(c) === 0);
        if (!t.length) return;
        const d = await ctx.destroy(t);
        if (d.length) await ctx.draw(d.length);
      },
    },
  ],
});

monster('Black Brutdrago', {
  attribute: 'FIRE',
  race: 'Dragon',
  level: 8,
  atk: 3000,
  def: 2600,
  types: ['synchro'],
  aiValue: 700,
  text: '1 Tuner + 1 or more non-Tuner Gemini monsters\nOnce per turn, you can send 1 Gemini monster from your hand to the Graveyard to select and destroy 1 Spell or Trap Card your opponent controls. When this card is destroyed and sent to the Graveyard, you can select 1 Gemini monster in your Graveyard and Special Summon it. The Special Summoned Gemini monster is treated as an Effect Monster, and gains its effect.',
  synchro: { nonTuner: isGemini, desc: '1 Tuner + 1+ non-Tuner Gemini monsters' },
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Send a Gemini: destroy 1 Spell/Trap',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.hand('me', isGemini).length > 0 && ctx.spellTraps('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const cost = await ctx.select(ctx.hand('me', isGemini), 1, 1, 'Send 1 Gemini monster from your hand to the GY.', 'cost');
        if (!cost.length) return false;
        await ctx.sendToGrave(cost, 'cost');
        await ctx.selectTargets(ctx.spellTraps('opp'), 1, 1, 'Select 1 Spell/Trap your opponent controls.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
      },
      ai: { score: (ctx) => (ctx.spellTraps('opp').length ? 50 : 0) },
    },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      when: true,
      label: 'Revive a Gemini as an Effect Monster',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone' && (ev.reasons ?? []).includes('destroy'),
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => isGemini(c) && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => isGemini(c) && ctx.canSummonCard(c)), 1, 1, 'Select 1 Gemini monster in your GY.', 'specialSummon', { aiScore: reviveScore });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (!t.length) return;
        const [s] = await ctx.specialSummon(t[0], { pos: aiPos(ctx, t[0]) });
        if (s) makeGeminiActive(ctx, s);
      },
    },
  ],
});

// ---- secret rares and the rest of the main set ----

monster("Koa'ki Meiru Maximus", {
  attribute: 'WIND',
  race: 'Dragon',
  level: 8,
  atk: 3000,
  def: 2500,
  sets: ['koaki-meiru'],
  nomi: true,
  cannotNormalSummon: true,
  aiValue: 900,
  text: 'This card cannot be Normal Summoned or Set. This card can only be Special Summoned by removing from play 1 "Iron Core of Koa\'ki Meiru" from your hand. During each of your End Phases, destroy this card unless you send 1 "Iron Core of Koa\'ki Meiru" or 1 "Koa\'ki Meiru" monster from your hand to the Graveyard. Once per turn, during your Main Phase, you can select and destroy 1 card your opponent controls.',
  effects: [
    {
      kind: 'proc',
      label: `Banish "${IRON_CORE}" from your hand`,
      condition: (ctx) => ctx.freeMZones() > 0 && ctx.hand('me', (c) => c.name === IRON_CORE).length > 0,
      perform: async (ctx) => {
        const [core] = await ctx.select(ctx.hand('me', (c) => c.name === IRON_CORE), 1, 1, `Banish 1 "${IRON_CORE}" from your hand.`, 'cost');
        if (!core) return false;
        await ctx.banish(core, 'cost');
        return true;
      },
      ai: { score: () => 80 },
    },
    koakiUpkeep('', null, isKoakiMonster),
    {
      kind: 'ignition',
      opt: true,
      label: 'Destroy 1 card your opponent controls',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.field('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.field('opp'), 1, 1, 'Select 1 card your opponent controls to destroy.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
      },
      ai: { score: () => 65 },
    },
  ],
});

monster('Shire, Lightsworn Spirit', {
  attribute: 'LIGHT',
  race: 'Fairy',
  level: 3,
  atk: 400,
  def: 1400,
  sets: ['lightsworn'],
  aiValue: 500,
  text: 'This card gains 300 ATK for each "Lightsworn" monster with a different name in your Graveyard. During each of your End Phases: Send the top 2 cards of your Deck to the Graveyard.',
  effects: [
    { kind: 'continuous', mods: [{ q: 'atk', value: (ctx) => 300 * lsNames(ctx) }] },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['mzone'],
      mandatory: true,
      label: 'End Phase: send top 2 to GY',
      categories: ['mill'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.isMyTurn && ctx.self.faceUp,
      resolve: async (ctx) => {
        await ctx.mill(2);
      },
    },
  ],
});

monster('Rinyan, Lightsworn Rogue', {
  attribute: 'LIGHT',
  race: 'Beast',
  level: 2,
  atk: 100,
  def: 100,
  types: ['flip'],
  sets: ['lightsworn'],
  aiValue: 400,
  text: 'FLIP: Target 1 "Lightsworn" monster in your Graveyard; shuffle that target into your Deck, then draw 1 card.',
  effects: [
    flip({
      categories: ['toDeck', 'draw'],
      activate: async (ctx) => {
        const cands = ctx.grave('me', isLightsworn);
        if (cands.length) await ctx.selectTargets(cands, 1, 1, 'Target 1 "Lightsworn" monster in your GY.', 'toDeck', { aiScore: (c) => -(c.data.aiValue ?? 0) });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (!t.length) return;
        await ctx.toDeck(t, 'shuffle');
        await ctx.draw(1);
      },
    }),
  ],
});

monster('Yellow Baboon, Archer of the Forest', {
  attribute: 'EARTH',
  race: 'Beast',
  level: 7,
  atk: 2600,
  def: 1800,
  aiValue: 400,
  text: 'When a Beast-Type monster you control is destroyed by battle and sent to the Graveyard, you can remove from play 2 Beast-Type monsters in your Graveyard to Special Summon this card from your hand.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      range: ['hand'],
      when: true,
      label: 'Banish 2 Beasts: Special Summon from hand',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && ev.fromController === ctx.player && raceIs(c, 'Beast') && c.location === 'grave';
      },
      canActivate: (ctx) => ctx.canSummonSelf() && ctx.grave('me', (c) => raceIs(c, 'Beast')).length >= 2,
      activate: async (ctx) => {
        const cost = await ctx.select(ctx.grave('me', (c) => raceIs(c, 'Beast')), 2, 2, 'Banish 2 Beast-Type monsters from your GY.', 'cost');
        if (cost.length < 2) return false;
        await ctx.banish(cost, 'cost');
      },
      resolve: async (ctx) => {
        if (ctx.self.location === 'hand') await ctx.specialSummon(ctx.self, { pos: aiPos(ctx, ctx.self) });
      },
    },
  ],
});

monster('Gemini Scorpion', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 4,
  atk: 1600,
  def: 400,
  aiValue: 400,
  text: 'When this card is Normal or Special Summoned, you can Special Summon 1 Level 4 or lower Gemini monster from your hand.',
  effects: [
    {
      kind: 'trigger',
      event: ['normalSummoned', 'specialSummoned'],
      when: true,
      label: 'Special Summon a Gemini from hand',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.hand('me', (c) => isGemini(c) && lvl(c) <= 4 && ctx.canSummonCard(c)).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.hand('me', (c) => isGemini(c) && lvl(c) <= 4 && ctx.canSummonCard(c));
        if (!cands.length || !ctx.canSpecialSummon()) return;
        const [c] = await ctx.select(cands, 1, 1, 'Special Summon 1 Level 4 or lower Gemini monster from your hand.', 'specialSummon');
        if (c) await ctx.specialSummon(c, { pos: aiPos(ctx, c) });
      },
    },
  ],
});

monster('Metabo-Shark', {
  attribute: 'WATER',
  race: 'Fish',
  level: 4,
  atk: 1800,
  def: 500,
  aiValue: 100,
  text: 'When this card is Normal Summoned: You can target 2 Fish-Type monsters in your Graveyard; shuffle those targets into your Deck.',
  effects: [
    {
      kind: 'trigger',
      event: 'normalSummoned',
      when: true,
      label: 'Shuffle 2 Fish into the Deck',
      categories: ['toDeck'],
      canActivate: (ctx) => ctx.grave('me', (c) => raceIs(c, 'Fish')).length >= 2,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => raceIs(c, 'Fish')), 2, 2, 'Target 2 Fish-Type monsters in your GY.', 'toHand');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.toDeck(t, 'shuffle');
      },
    },
  ],
});

normal('Dark Rabbit', 'DARK', 'Beast', 4, 1100, 1500, 'He leaps up, down, and all around! Nobody can lay a hand on this funny bunny.');

/** Dark Simorgh: "You can banish 1 DARK and 1 WIND monster from your <costFrom>; Special Summon this card" (from <from>). */
function simorghSummon(from: 'hand' | 'grave', costFrom: 'hand' | 'grave'): EffectDef {
  const pool = (ctx: Ctx, a: Attribute, not?: C) => (costFrom === 'hand' ? ctx.hand('me') : ctx.grave('me')).filter((c) => c !== ctx.self && c !== not && attrIs(c, a));
  const pairOk = (ctx: Ctx) => pool(ctx, 'DARK').some((d) => pool(ctx, 'WIND', d).length > 0);
  return {
    kind: 'ignition',
    range: [from],
    label: `Banish 1 DARK + 1 WIND from your ${costFrom === 'hand' ? 'hand' : 'GY'}: Special Summon`,
    categories: ['specialSummon'],
    canActivate: (ctx) => ctx.canSummonSelf() && pairOk(ctx),
    activate: async (ctx) => {
      const where = costFrom === 'hand' ? 'hand' : 'GY';
      const [d] = await ctx.select(pool(ctx, 'DARK').filter((x) => pool(ctx, 'WIND', x).length > 0), 1, 1, `Banish 1 DARK monster from your ${where}.`, 'cost');
      if (!d) return false;
      const [w] = await ctx.select(pool(ctx, 'WIND', d), 1, 1, `Banish 1 WIND monster from your ${where}.`, 'cost');
      if (!w) return false;
      await ctx.banish([d, w], 'cost');
    },
    resolve: async (ctx) => {
      if (ctx.self.location === from && ctx.canSummonSelf()) await ctx.specialSummon(ctx.self, { pos: aiPos(ctx, ctx.self) });
    },
    ai: { score: (ctx) => (from === 'hand' ? 72 : ctx.hand('me').length >= 4 ? 60 : 0) },
  };
}

monster('Dark Simorgh', {
  attribute: 'DARK',
  race: 'Winged Beast',
  level: 7,
  atk: 2700,
  def: 1000,
  aiValue: 800,
  // APPROX: the engine has one Attribute per card, so "also WIND while face-up" is not applied.
  // Rulings: both self-Special Summons are Ignition Effects (they start a Chain); banishing is the cost.
  text: 'While face-up on the field, this card is also WIND-Attribute. If this card is in your hand: You can banish 1 DARK and 1 WIND monster from your GY; Special Summon this card. If this card is in your GY: You can banish 1 DARK and 1 WIND monster from your hand; Special Summon this card. Your opponent cannot Set cards.',
  effects: [
    simorghSummon('hand', 'grave'),
    simorghSummon('grave', 'hand'),
    { kind: 'continuous', mods: [{ q: 'cannotSet', to: 'players', filter: (ctx, p: PlayerId) => p === ctx.opp }] },
  ],
});

monster('Victoria', {
  attribute: 'LIGHT',
  race: 'Fairy',
  level: 4,
  atk: 1800,
  def: 1500,
  aiValue: 400,
  text: 'Once per turn: You can target 1 Dragon-Type monster in your opponent\'s Graveyard; Special Summon that target to your side of the field. Your opponent cannot target face-up Fairy-Type monsters for attacks, except this one.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Special Summon a Dragon from the opponent\'s GY',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('opp', (c) => raceIs(c, 'Dragon') && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('opp', (c) => raceIs(c, 'Dragon') && ctx.canSummonCard(c)), 1, 1, 'Target 1 Dragon in your opponent\'s GY.', 'specialSummon', { aiScore: reviveScore });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length && ctx.canSummonCard(t[0])) await ctx.specialSummon(t[0], { pos: aiPos(ctx, t[0]), controller: ctx.player });
      },
      ai: { score: () => 60 },
    },
    {
      kind: 'continuous',
      mods: [
        {
          q: 'cannotBeAttacked',
          to: 'cards',
          filter: (ctx, c: C) => c !== ctx.self && c.location === 'mzone' && c.faceUp && c.controller === ctx.player && raceIs(c, 'Fairy'),
        },
      ],
    },
  ],
});

monster('Ice Queen', {
  attribute: 'WATER',
  race: 'Spellcaster',
  level: 8,
  atk: 2900,
  def: 2100,
  aiValue: 400,
  text: 'Cannot be Special Summoned from the GY. When this face-up card you control is destroyed and sent to your GY: You can target 1 Spell in your GY; add that target to your hand. You must have 3 or more Spellcaster monsters in your GY to activate and to resolve this effect.',
  effects: [
    {
      // APPROX: there is no per-card "cannot be Special Summoned" check in the engine, so an Ice Queen that is
      // Special Summoned from the GY is sent straight back to the GY.
      kind: 'trigger',
      event: 'specialSummoned',
      mandatory: true,
      label: 'Cannot be Special Summoned from the GY',
      categories: [],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'grave',
      resolve: async (ctx) => {
        if (ctx.self.location === 'mzone') await ctx.game.moveCards([ctx.self], 'grave', { reason: 'rule', reasonPlayer: ctx.player, reasonCard: ctx.self });
      },
    },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      when: true,
      label: 'Add 1 Spell from your GY',
      categories: ['toHand'],
      eventFilter: (ctx, ev) =>
        ev.card === ctx.self && ev.from === 'mzone' && ev.fromFaceUp === true && ev.fromController === ctx.self.owner && (ev.reasons ?? []).includes('destroy'),
      condition: (ctx) => ctx.grave('me', (c) => raceIs(c, 'Spellcaster')).length >= 3,
      canActivate: (ctx) => ctx.grave('me', (c) => c.isSpell).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => c.isSpell), 1, 1, 'Target 1 Spell in your GY.', 'toHand', { aiScore: (c) => 1000 + (c.data.aiValue ?? 0) });
      },
      resolve: async (ctx) => {
        if (ctx.grave('me', (c) => raceIs(c, 'Spellcaster')).length < 3) return;
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.toHand(t);
      },
    },
  ],
});

monster('Shutendoji', {
  attribute: 'EARTH',
  race: 'Zombie',
  level: 4,
  atk: 1500,
  def: 800,
  aiValue: 400,
  text: 'Once per turn: You can activate 1 of these effects.\n● Banish 2 Zombie monsters from your GY; draw 1 card.\n● Target 1 of your banished Zombie monsters; place that target on the top of your Deck.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Banish 2 Zombies: draw 1 / banished Zombie to Deck top',
      categories: ['draw', 'toDeck'],
      canActivate: (ctx) => ctx.grave('me', (c) => raceIs(c, 'Zombie')).length >= 2 || ctx.banished('me', (c) => raceIs(c, 'Zombie')).length > 0,
      activate: async (ctx) => {
        const canDraw = ctx.grave('me', (c) => raceIs(c, 'Zombie')).length >= 2;
        const canTop = ctx.banished('me', (c) => raceIs(c, 'Zombie') && c.faceUp).length > 0;
        const opts: string[] = [];
        if (canDraw) opts.push('Banish 2 Zombies from your GY: draw 1 card');
        if (canTop) opts.push('Place 1 banished Zombie on top of your Deck');
        if (!opts.length) return false;
        const i = await ctx.option('Shutendoji: choose 1 effect', opts, (k) => (opts[k].startsWith('Banish') ? 2 : 1));
        ctx.data.mode = opts[i].startsWith('Banish') ? 'draw' : 'top';
        if (ctx.data.mode === 'draw') {
          const cost = await ctx.select(ctx.grave('me', (c) => raceIs(c, 'Zombie')), 2, 2, 'Banish 2 Zombie monsters from your GY.', 'cost');
          if (cost.length < 2) return false;
          await ctx.banish(cost, 'cost');
        } else {
          await ctx.selectTargets(ctx.banished('me', (c) => raceIs(c, 'Zombie') && c.faceUp), 1, 1, 'Target 1 of your banished Zombie monsters.', 'toHand', { aiScore: reviveScore });
        }
      },
      resolve: async (ctx) => {
        if (ctx.data.mode === 'draw') await ctx.draw(1);
        else {
          const t = ctx.validTargets((c) => c.location === 'banished');
          if (t.length) await ctx.toDeck(t, 'top');
        }
      },
      ai: { score: (ctx) => (ctx.grave('me', (c) => raceIs(c, 'Zombie')).length >= 4 ? 55 : 0) },
    },
  ],
});

/** Kristya Special Summoned by its own procedure (flags reset when it moves, so this is tracked by uid). */
const kristyaProc = new Set<number>();

monster('Archlord Kristya', {
  attribute: 'LIGHT',
  race: 'Fairy',
  level: 8,
  atk: 2800,
  def: 2300,
  aiValue: 1500,
  text: 'If you have exactly 4 Fairy monsters in your GY, you can Special Summon this card (from your hand). If Summoned this way: Target 1 Fairy monster in your GY; add that target to your hand. Neither player can Special Summon monsters. If this face-up card would be sent from the field to the GY, place it on top of the Deck, instead.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (exactly 4 Fairies in GY)',
      condition: (ctx) => ctx.freeMZones() > 0 && ctx.grave('me', (c) => raceIs(c, 'Fairy')).length === 4,
      perform: async (ctx) => {
        kristyaProc.add(ctx.self.uid);
        return true;
      },
      ai: { score: () => 80 },
    },
    {
      kind: 'trigger',
      event: 'specialSummoned',
      mandatory: true,
      label: 'Add 1 Fairy from your GY',
      categories: ['toHand'],
      eventFilter: (ctx, ev) => {
        if (ev.card !== ctx.self || ev.from !== 'hand' || ev.reasonCard || !kristyaProc.has(ctx.self.uid)) return false;
        kristyaProc.delete(ctx.self.uid);
        return true;
      },
      canActivate: (ctx) => ctx.grave('me', (c) => raceIs(c, 'Fairy')).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => raceIs(c, 'Fairy')), 1, 1, 'Target 1 Fairy monster in your GY.', 'toHand');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.toHand(t);
      },
    },
    {
      kind: 'continuous',
      mods: [
        { q: 'cannotSpecialSummon', to: 'players', value: true },
        { q: 'deckTopInsteadOfGrave' },
      ],
    },
  ],
});

monster('Guardian Eatos', {
  attribute: 'WIND',
  race: 'Fairy',
  level: 8,
  atk: 2500,
  def: 2000,
  aiValue: 700,
  text: 'If you have no monsters in your GY, you can Special Summon this card (from your hand). You can send 1 of your Equip Spells equipped to this card to the GY, then target up to 3 monsters in your opponent\'s GY; banish those targets, and if you do, this card gains 500 ATK for each monster banished by this effect, until the end of this turn.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (no monsters in your GY)',
      condition: (ctx) => ctx.freeMZones() > 0 && ctx.grave('me', (c) => c.isMonster).length === 0,
      ai: { score: () => 75 },
    },
    {
      kind: 'ignition',
      label: 'Send an Equip Spell: banish up to 3',
      categories: ['banish', 'atkChange'],
      canActivate: (ctx) =>
        ctx.game.equipsOf(ctx.self).some((e) => e.isSpell && e.controller === ctx.player) && ctx.grave('opp', (c) => c.isMonster && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const eq = ctx.game.equipsOf(ctx.self).filter((e) => e.isSpell && e.controller === ctx.player);
        const [e] = await ctx.select(eq, 1, 1, 'Send 1 Equip Spell equipped to this card to the GY.', 'cost');
        if (!e) return false;
        await ctx.sendToGrave(e, 'cost');
        await ctx.selectTargets(ctx.grave('opp', (c) => c.isMonster), 1, 3, 'Target up to 3 monsters in your opponent\'s GY.', 'banish');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (!t.length) return;
        const b = await ctx.banish(t);
        const n = b.filter((c) => c.location === 'banished').length;
        if (n && ctx.self.location === 'mzone' && ctx.self.faceUp) ctx.addTempMod(ctx.self, 'atk', 500 * n, 'turn');
      },
      ai: { score: (ctx) => (ctx.phase === 'main1' && ctx.grave('opp', (c) => c.isMonster).length >= 2 ? 40 : 0) },
    },
  ],
});

monster('Clear Vice Dragon', {
  attribute: 'DARK',
  race: 'Dragon',
  level: 8,
  atk: 0,
  def: 0,
  aiValue: 1500,
  text: 'You are unaffected by the effects of "Clear World". If this card attacks an opponent\'s monster, this card\'s ATK becomes twice the ATK of the attack target, during damage calculation only. If this card would be destroyed by an opponent\'s card effect, you can discard 1 card instead.',
  effects: [
    {
      kind: 'continuous',
      mods: [
        {
          q: 'atk',
          value: (ctx) => {
            const b = ctx.game.battle;
            if (!b || !b.inDamageStep || b.attacker !== ctx.self || !b.target || b.target.controller === ctx.player) return 0;
            return 2 * ctx.game.getAtk(b.target);
          },
        },
      ],
    },
    {
      // APPROX: no destruction-replacement step in the engine. Instead, in response to an opponent's
      // destroying effect, you can discard 1 card so this card cannot be destroyed by card effects this turn.
      kind: 'quick',
      label: 'Discard 1 instead of being destroyed',
      categories: ['protect'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        if (!l || l.player !== ctx.opp || l.negated) return false;
        const cats = l.effect.categories ?? [];
        if (!cats.includes('destroy') && !cats.includes('destroyMulti')) return false;
        return l.ctx.targets.length === 0 || l.ctx.targets.includes(ctx.self);
      },
      canActivate: (ctx) => ctx.hand('me').length > 0 && !ctx.query(ctx.self, 'indestructibleEffect'),
      activate: async (ctx) => {
        const d = await ctx.select(ctx.hand('me'), 1, 1, 'Discard 1 card.', 'discard');
        if (!d.length) return false;
        await ctx.discard(d, 'cost');
      },
      resolve: async (ctx) => {
        if (ctx.self.location === 'mzone') ctx.addTempMod(ctx.self, 'indestructibleEffect', true, 'turn');
      },
      ai: {
        score: (ctx) => {
          const l = ctx.prevLink();
          if (!l) return 0;
          const cats = l.effect.categories ?? [];
          return l.ctx.targets.includes(ctx.self) || cats.includes('destroyMulti') ? 80 : 0;
        },
      },
    },
  ],
});

// =================================================================== SPELLS

/** AI: how much this player wants a Field Spell up (Earthbound Immortals need one). */
const fieldSpellScore = (ctx: Ctx, base: number) => {
  if (ctx.game.players[ctx.player].fzone?.faceUp) return 0;
  const ei = ctx.cards('me', ['hand', 'mzone'], isEI).length;
  return ei ? 55 : base;
};

spell('Spider Web', 'field', {
  text: 'If a monster declares an attack, it is changed to Defense Position at the end of the Damage Step. It cannot change its battle position until the End Phase of its controller\'s next turn, while this card remains on the field.',
  effects: [
    { kind: 'activate', categories: ['position'], ai: { score: (ctx) => fieldSpellScore(ctx, ctx.faceUpMonsters('opp', (c) => c.pos === 'atk').length ? 20 : 8) } },
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      range: ['fzone'],
      mandatory: true,
      label: 'Attacker to Defense Position',
      categories: ['position'],
      eventFilter: (ctx, ev) => {
        const a = evc(ev);
        return stActive(ctx) && !!a && a.location === 'mzone' && a.faceUp && a.pos === 'atk';
      },
      activate: async (ctx) => {
        const a = evc(ctx.event!)!;
        ctx.data.a = a;
        ctx.data.mid = a.moveId;
      },
      resolve: async (ctx) => {
        const a = ctx.data.a as C;
        if (!a || a.location !== 'mzone' || a.moveId !== ctx.data.mid || !a.faceUp) return;
        if (a.pos === 'atk') await ctx.changePos(a, 'def', true);
        if (a.location === 'mzone') a.flags.sovrSpiderWebUntil = ctx.game.turn + (ctx.game.turnPlayer === a.controller ? 2 : 1);
      },
    },
    {
      kind: 'continuous',
      mods: [{ q: 'cannotChangePos', to: 'cards', filter: (ctx, c: C) => c.location === 'mzone' && (c.flags.sovrSpiderWebUntil ?? -1) >= ctx.game.turn }],
    },
  ],
});

spell('Earthbound Whirlwind', 'normal', {
  text: 'If you control an "Earthbound Immortal" monster: Destroy all Spells and Traps your opponent controls.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'destroyMulti'],
      condition: (ctx) => ctx.faceUpMonsters('me', isEI).length > 0,
      canActivate: (ctx) => ctx.spellTraps('opp').length > 0,
      resolve: async (ctx) => {
        if (!ctx.faceUpMonsters('me', isEI).length) return;
        const st = ctx.spellTraps('opp');
        if (st.length) await ctx.destroy(st);
      },
      ai: { score: (ctx) => (ctx.spellTraps('opp').length ? 55 + 8 * ctx.spellTraps('opp').length : 0) },
    },
  ],
});

spell('Savage Colosseum', 'field', {
  // APPROX: "All monsters must attack, if able" is not forced on the player; the End Phase destruction applies.
  text: 'If a monster attacks, at the end of the Damage Step: Its controller gains 300 LP. All monsters must attack, if able. During each End Phase: Destroy all face-up Attack Position monsters the turn player controls, that did not declare an attack.',
  effects: [
    { kind: 'activate', categories: ['lockdown'], ai: { score: (ctx) => fieldSpellScore(ctx, 5) } },
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      range: ['fzone'],
      mandatory: true,
      label: 'Attacker\'s controller gains 300 LP',
      categories: ['recover'],
      eventFilter: (ctx, ev) => stActive(ctx) && ev.player !== undefined,
      activate: async (ctx) => {
        ctx.data.p = ctx.event!.player;
      },
      resolve: async (ctx) => {
        await ctx.recover(ctx.data.p as PlayerId, 300);
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['fzone'],
      mandatory: true,
      label: 'Destroy monsters that did not attack',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && stActive(ctx),
      condition: (ctx) => ctx.game.faceUpMonsters(ctx.game.turnPlayer).some((c) => c.pos === 'atk' && c.attacksThisTurn === 0),
      resolve: async (ctx) => {
        const t = ctx.game.faceUpMonsters(ctx.game.turnPlayer).filter((c) => c.pos === 'atk' && c.attacksThisTurn === 0);
        if (t.length) await ctx.destroy(t);
      },
    },
  ],
});

spell('Attack Pheromones', 'continuous', {
  text: 'If a monster you control attacks a Defense Position monster, change that monster to face-up Attack Position at the end of the Damage Step if your attacking monster is Reptile-Type.',
  effects: [
    { kind: 'activate', categories: ['position'], ai: { score: (ctx) => (ctx.cards('me', ['hand', 'mzone'], (c) => raceIs(c, 'Reptile')).length >= 2 ? 15 : 0) } },
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      range: ['szone'],
      mandatory: true,
      label: 'Change the attacked monster to Attack Position',
      categories: ['position'],
      eventFilter: (ctx, ev) => {
        const a = evc(ev);
        const t = evo(ev);
        return (
          stActive(ctx) &&
          !!a &&
          !!t &&
          a.controller === ctx.player &&
          raceIs(a, 'Reptile') &&
          ctx.game.battle?.calc?.targetPos === 'def' &&
          t.location === 'mzone' &&
          t.pos === 'def'
        );
      },
      activate: async (ctx) => {
        const t = evo(ctx.event!)!;
        ctx.data.t = t;
        ctx.data.mid = t.moveId;
      },
      resolve: async (ctx) => {
        const t = ctx.data.t as C;
        if (t && t.location === 'mzone' && t.moveId === ctx.data.mid && t.pos === 'def') await ctx.changePos(t, 'atk', true);
      },
    },
  ],
});

spell('Molting Escape', 'equip', {
  text: 'Equip only to a Reptile-Type monster. Once per turn, if the equipped monster would be destroyed by battle, it is not destroyed. The equipped monster gains 300 ATK at the end of the Damage Step each time this effect is applied.',
  effects: [
    equipSpell((_ctx, c) => raceIs(c, 'Reptile'), buffScore((c) => raceIs(c, 'Reptile')), (ctx, c) => (c.controller === ctx.player ? ctx.atk(c) + 1000 : -10000)),
    {
      kind: 'continuous',
      mods: [{ q: 'indestructibleBattle', to: 'cards', filter: (ctx, c: C) => equipped(ctx, c) && ctx.self.flags.sovrMoltTurn !== ctx.game.turn }],
    },
    battleSurvivorListener(
      (ctx, c) => {
        if (!stActive(ctx) || c !== ctx.equipTarget || ctx.self.flags.sovrMoltTurn === ctx.game.turn) return;
        ctx.self.flags.sovrMoltTurn = ctx.game.turn;
        ctx.game.addTempMod(c, 'atk', 300, 'field', ctx.self);
        ctx.game.log(`Molting Escape: ${c.name} is not destroyed and gains 300 ATK.`, 'action', ctx.player);
      },
      ['szone'],
    ),
  ],
});

spell('Reptilianne Spawn', 'normal', {
  text: 'Banish 1 "Reptilianne" monster from your GY; Special Summon 2 "Reptilianne Tokens" (Reptile/EARTH/Level 1/ATK 0/DEF 0).',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.freeMZones() >= 2 && ctx.grave('me', isReptilianne).length > 0,
      activate: async (ctx) => {
        const cost = await ctx.select(ctx.grave('me', isReptilianne), 1, 1, 'Banish 1 "Reptilianne" monster from your GY.', 'cost');
        if (!cost.length) return false;
        await ctx.banish(cost, 'cost');
      },
      resolve: async (ctx) => {
        if (ctx.freeMZones() >= 2) await ctx.createTokens(reptilianneToken, 2, 'def');
      },
      ai: {
        score: (ctx) => {
          // Tokens are Synchro or Tribute fodder.
          const tuner = ctx.faceUpMonsters('me', (c) => c.isTuner).length;
          const tribute = ctx.hand('me', (c) => c.isMonster && lvl(c) >= 7).length;
          return tuner || tribute ? 45 : 15;
        },
      },
    },
  ],
});

spell("Fortune's Future", 'normal', {
  text: 'Target 1 of your banished "Fortune Lady" monsters; return it to the GY, then draw 2 cards.',
  effects: [
    {
      kind: 'activate',
      categories: ['draw'],
      canActivate: (ctx) => ctx.banished('me', (c) => isFortuneLady(c) && c.faceUp).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.banished('me', (c) => isFortuneLady(c) && c.faceUp), 1, 1, 'Target 1 banished "Fortune Lady" monster.', 'toHand');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'banished');
        if (!t.length) return;
        await ctx.game.moveCards(t, 'grave', { reason: 'effect', reasonPlayer: ctx.player, reasonCard: ctx.self });
        await ctx.draw(2);
      },
      ai: { score: () => 70 },
    },
  ],
});

spell('Time Passage', 'quickplay', {
  // Rulings: it targets the "Fortune Lady" monster, and it cannot be activated during the Damage Step (it changes a
  // Level, not ATK/DEF directly).
  text: 'Increase the Level of 1 face-up "Fortune Lady" monster you control by 3, until the End Phase.',
  effects: [
    {
      kind: 'activate',
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => isFortuneLady(c) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('me', isFortuneLady), 1, 1, 'Target 1 face-up "Fortune Lady" monster you control.', 'buff', {
          aiScore: (c) => (c.data.name === 'Fortune Lady Earth' ? 100 : 0) + ctx.atk(c) / 100,
        });
      },
      resolve: async (ctx) => {
        const [c] = ctx.validTargets((x) => x.location === 'mzone' && x.faceUp && isFortuneLady(x) && x.controller === ctx.player);
        if (c) await raiseLevel(ctx, c, 3, 'turn');
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          // Attack declaration (before the Damage Step): pump the attacking or attacked Fortune Lady.
          if (b && !b.inDamageStep && b.target) {
            const mine = b.attacker.controller === ctx.player ? b.attacker : b.target;
            const theirs = mine === b.attacker ? b.target : b.attacker;
            if (!isFortuneLady(mine) || !mine.faceUp || mine.controller !== ctx.player) return 0;
            const mult = mine.data.name === 'Fortune Lady Wind' || mine.data.name === 'Fortune Lady Water' ? 300 : 400;
            const their = theirs.pos === 'atk' ? ctx.atk(theirs) : theirs.faceUp ? ctx.def(theirs) : 1500;
            return ctx.atk(mine) <= their && ctx.atk(mine) + 3 * mult > their ? 85 : 0;
          }
          return ctx.faceUpMonsters('me', (c) => c.data.name === 'Fortune Lady Earth').length && !ctx.isMyTurn && ctx.phase === 'end' ? 35 : 0;
        },
      },
    },
  ],
});

spell('Iron Core Armor', 'equip', {
  text: 'Equip only to a "Koa\'ki Meiru" monster. During damage calculation only, monsters that battle with the equipped monster lose ATK equal to the equipped monster\'s Level x 100. If the equipped monster would be destroyed during the End Phase, you can send this card to the Graveyard instead.',
  effects: [
    equipSpell((_ctx, c) => isKoakiMonster(c), buffScore(isKoakiMonster)),
    {
      kind: 'continuous',
      mods: [
        {
          q: 'atk',
          to: 'cards',
          filter: (ctx, c: C) => {
            const b = ctx.game.battle;
            const host = ctx.equipTarget;
            if (!b || !b.inDamageStep || !host || !b.target) return false;
            return (b.attacker === host && b.target === c) || (b.target === host && b.attacker === c);
          },
          value: (ctx) => -(ctx.equipTarget ? ctx.level(ctx.equipTarget) * 100 : 0),
        },
      ],
    },
  ],
});

spell('Herculean Power', 'continuous', {
  text: 'Once per turn, if your opponent controls a monster and you control no monsters, you can Special Summon 1 Level 4 or lower Gemini monster from your hand.',
  effects: [
    { kind: 'activate', categories: ['specialSummon'], ai: { score: (ctx) => (ctx.hand('me', isGemini).length ? 20 : 0) } },
    {
      kind: 'ignition',
      opt: true,
      label: 'Special Summon a Gemini from hand',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.monsters('opp').length > 0 && ctx.monsters('me').length === 0,
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.hand('me', (c) => isGemini(c) && lvl(c) <= 4 && ctx.canSummonCard(c)).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.hand('me', (c) => isGemini(c) && lvl(c) <= 4 && ctx.canSummonCard(c));
        if (!cands.length || ctx.monsters('me').length) return;
        const [c] = await ctx.select(cands, 1, 1, 'Special Summon 1 Level 4 or lower Gemini monster from your hand.', 'specialSummon');
        if (c) await ctx.specialSummon(c, { pos: aiPos(ctx, c) });
      },
      ai: { score: () => 60 },
    },
  ],
});

spell('Gemini Spark', 'quickplay', {
  text: 'Tribute 1 face-up Level 4 Gemini Monster you control and select 1 card on the field. Destroy the selected card and draw 1 card.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'draw'],
      // https://edisonrul.ing/cards/g/gemini-spark.html — "Gemini Spark" cannot be activated if you have no cards in the Deck.
      canActivate: (ctx) =>
        ctx.deck().length > 0 &&
        tributable(ctx, (c) => c.faceUp && isGemini(c) && ctx.level(c) === 4).length > 0 &&
        ctx.field('both', (c) => c !== ctx.self && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const cost = await ctx.select(tributable(ctx, (c) => c.faceUp && isGemini(c) && ctx.level(c) === 4), 1, 1, 'Tribute 1 face-up Level 4 Gemini monster.', 'tribute');
        if (!cost.length) return false;
        await tributeCost(ctx, cost);
        await ctx.selectTargets(ctx.field('both', (c) => c !== ctx.self), 1, 1, 'Target 1 card on the field to destroy.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (!t.length) return;
        const d = await ctx.destroy(t);
        if (d.length) await ctx.draw(1);
      },
      ai: {
        score: (ctx) => {
          const best = bestTarget(ctx.game, ctx.field('opp', (c) => ctx.canTarget(c)));
          if (!best) return 0;
          const fodder = Math.min(...tributable(ctx, (c) => c.faceUp && isGemini(c) && ctx.level(c) === 4).map((c) => cardValue(ctx.game, c)));
          const top = ctx.chainTop();
          if (top && top.player === ctx.opp && top.ctx.targets.some((t) => t.controller === ctx.player && isGemini(t))) return 75;
          return cardValue(ctx.game, best) >= fodder ? 45 : 0;
        },
      },
    },
  ],
});

spell('Ritual of Grace', 'ritual', {
  text: 'This card is used to Ritual Summon "Divine Grace - Northwemko". You must also Tribute monsters whose total Levels equal 7 or more from the field or your hand. During your Main Phase, you can remove from play this card from your Graveyard to make 1 face-up Ritual Monster you control become un-targetable by effects this turn.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => canRitual(ctx, (c) => c.data.name === 'Divine Grace - Northwemko', 7),
      resolve: async (ctx) => {
        await performRitual(ctx, (c) => c.data.name === 'Divine Grace - Northwemko', 7);
      },
      ai: { score: () => 60 },
    },
    {
      // APPROX: 'untargetable' protects from the opponent's card effects only.
      kind: 'ignition',
      range: ['grave'],
      label: 'Banish: a Ritual Monster cannot be targeted this turn',
      categories: ['protect'],
      canActivate: (ctx) => ctx.faceUpMonsters('me', isRitualMonster).length > 0,
      activate: async (ctx) => {
        await ctx.banish(ctx.self, 'cost');
        await ctx.selectTargets(ctx.faceUpMonsters('me', isRitualMonster), 1, 1, 'Select 1 face-up Ritual Monster you control.', 'buff');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp);
        if (t.length) ctx.addTempMod(t[0], 'untargetable', true, 'turn');
      },
      ai: { score: (ctx) => (ctx.spellTraps('opp', (c) => !c.faceUp).length >= 2 ? 20 : 0) },
    },
  ],
});

spell('Preparation of Rites', 'normal', {
  text: 'Add 1 Level 7 or lower Ritual Monster from your Deck to your hand, then you can add 1 Ritual Spell from your GY to your hand.',
  effects: [
    {
      kind: 'activate',
      categories: ['search', 'toHand'],
      canActivate: (ctx) => ctx.deck('me', (c) => isRitualMonster(c) && lvl(c) <= 7).length > 0,
      resolve: async (ctx) => {
        const r = await ctx.search((c) => isRitualMonster(c) && lvl(c) <= 7, 1, 'Add 1 Level 7 or lower Ritual Monster to your hand.');
        if (!r.length) return;
        const spells = ctx.grave('me', (c) => c.data.stype === 'ritual');
        if (spells.length && (await ctx.confirm('Also add 1 Ritual Spell from your GY to your hand?', true))) {
          const [s] = await ctx.select(spells, 1, 1, 'Add 1 Ritual Spell from your GY to your hand.', 'toHand');
          if (s) await ctx.toHand(s);
        }
      },
      ai: { score: () => 60 },
    },
  ],
});

spell('Moray of Greed', 'normal', {
  text: 'Shuffle 2 WATER monsters from your hand into the Deck, then draw 3 cards.',
  effects: [
    {
      kind: 'activate',
      categories: ['draw', 'toDeck'],
      canActivate: (ctx) => ctx.hand('me', (c) => attrIs(c, 'WATER')).length >= 2 && ctx.deck().length + 2 >= 3,
      resolve: async (ctx) => {
        const w = ctx.hand('me', (c) => attrIs(c, 'WATER'));
        if (w.length < 2) return;
        const sel = await ctx.select(w, 2, 2, 'Shuffle 2 WATER monsters from your hand into the Deck.', 'cost');
        if (sel.length < 2) return;
        await ctx.toDeck(sel, 'shuffle');
        await ctx.draw(3);
      },
      ai: { score: () => 65 },
    },
  ],
});

spell('Spiritual Forest', 'continuous', {
  text: 'The first time each Beast, Beast-Warrior, or Plant monster you control would be destroyed by battle each turn, it is not destroyed.',
  effects: [
    { kind: 'activate', categories: ['protect'], ai: { score: (ctx) => (ctx.cards('me', ['hand', 'mzone'], (c) => raceIs(c, 'Beast', 'Beast-Warrior', 'Plant')).length >= 2 ? 22 : 0) } },
    {
      kind: 'continuous',
      mods: [
        {
          q: 'indestructibleBattle',
          to: 'cards',
          filter: (ctx, c: C) =>
            c.location === 'mzone' && c.controller === ctx.player && raceIs(c, 'Beast', 'Beast-Warrior', 'Plant') && c.flags.sovrForestTurn !== ctx.game.turn,
        },
      ],
    },
    battleSurvivorListener(
      (ctx, c) => {
        if (stActive(ctx) && c.controller === ctx.player && raceIs(c, 'Beast', 'Beast-Warrior', 'Plant')) c.flags.sovrForestTurn = ctx.game.turn;
      },
      ['szone'],
    ),
  ],
});

spell('Raging Mad Plants', 'quickplay', {
  text: 'All Plant-Type monsters you currently control gain 300 ATK for each Plant-Type monster currently in your Graveyard, until the end of this turn. During the End Phase, destroy all Plant-Type monsters you control.',
  effects: [
    {
      kind: 'activate',
      damageStep: true,
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => raceIs(c, 'Plant')).length > 0 && ctx.grave('me', (c) => raceIs(c, 'Plant')).length > 0,
      resolve: async (ctx) => {
        const bonus = 300 * ctx.grave('me', (c) => raceIs(c, 'Plant')).length;
        for (const c of ctx.faceUpMonsters('me', (m) => raceIs(m, 'Plant'))) ctx.addTempMod(c, 'atk', bonus, 'turn');
        const p = ctx.player;
        ctx.later('end', async () => {
          const plants = ctx.game.monsters(p).filter((c) => raceIs(c, 'Plant'));
          if (plants.length) await ctx.game.destroy(plants, 'effect', p, ctx.self);
        });
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          const bonus = 300 * ctx.grave('me', (c) => raceIs(c, 'Plant')).length;
          if (b && b.inDamageStep && b.target) {
            const mine = b.attacker.controller === ctx.player ? b.attacker : b.target;
            const theirs = mine === b.attacker ? b.target : b.attacker;
            if (!raceIs(mine, 'Plant') || !mine.faceUp) return 0;
            const their = theirs.pos === 'atk' ? ctx.atk(theirs) : ctx.def(theirs);
            return ctx.atk(mine) <= their && ctx.atk(mine) + bonus > their ? 80 : 0;
          }
          if (b && !b.target && b.attacker.controller === ctx.player && raceIs(b.attacker, 'Plant') && ctx.atk(b.attacker) + bonus >= ctx.oppLp) return 95;
          return 0;
        },
      },
    },
  ],
});

spell('Insect Neglect', 'continuous', {
  text: 'When your opponent\'s monster declares an attack: You can banish 1 Insect monster from your GY; negate the attack.',
  effects: [
    { kind: 'activate', categories: ['negateAttack'], ai: { score: (ctx) => (ctx.grave('me', (c) => raceIs(c, 'Insect')).length >= 2 ? 20 : 0) } },
    {
      kind: 'quick',
      event: 'attackDeclared',
      label: 'Banish an Insect: negate the attack',
      categories: ['negateAttack'],
      eventFilter: (ctx, ev) => evc(ev)?.controller === ctx.opp,
      condition: (ctx) => !!ctx.battle && !ctx.battle.inDamageStep && !ctx.battle.negated,
      canActivate: (ctx) => ctx.grave('me', (c) => raceIs(c, 'Insect')).length > 0,
      activate: async (ctx) => {
        const cost = await ctx.select(ctx.grave('me', (c) => raceIs(c, 'Insect')), 1, 1, 'Banish 1 Insect monster from your GY.', 'cost');
        if (!cost.length) return false;
        await ctx.banish(cost, 'cost');
      },
      resolve: async (ctx) => {
        ctx.negateAttack();
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b) return 0;
          const atk = ctx.atk(b.attacker);
          if (!b.target) return atk >= 1000 ? 60 : 0;
          const t = b.target;
          const stat = t.pos === 'atk' ? ctx.atk(t) : t.faceUp ? ctx.def(t) : 1500;
          return atk >= stat ? 55 : 0;
        },
      },
    },
  ],
});

spell('Faustian Bargain', 'normal', {
  text: 'Target 1 Special Summoned monster on either field; send it to the GY, and if you do, Special Summon 1 Level 4 or lower Normal Monster from your hand.',
  effects: [
    {
      kind: 'activate',
      categories: ['toDeck', 'specialSummon'],
      canActivate: (ctx) =>
        ctx.monsters('both', (c) => c.faceUp && !!c.summonMethod && ['special', 'synchro', 'fusion', 'ritual'].includes(c.summonMethod) && ctx.canTarget(c)).length > 0 &&
        ctx.hand('me', (c) => c.isMonster && c.hasType('normal') && lvl(c) <= 4).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(
          ctx.monsters('both', (c) => c.faceUp && !!c.summonMethod && ['special', 'synchro', 'fusion', 'ritual'].includes(c.summonMethod)),
          1,
          1,
          'Target 1 Special Summoned monster.',
          'destroy',
        );
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone');
        if (!t.length) return;
        const sent = await ctx.sendToGrave(t);
        if (!sent.some((c) => c.location !== 'mzone')) return;
        const n = ctx.hand('me', (c) => c.isMonster && c.hasType('normal') && lvl(c) <= 4 && ctx.canSummonCard(c));
        if (!n.length || !ctx.canSpecialSummon()) return;
        const [m] = await ctx.select(n, 1, 1, 'Special Summon 1 Level 4 or lower Normal Monster from your hand.', 'specialSummon');
        if (m) await ctx.specialSummon(m, { pos: aiPos(ctx, m) });
      },
      ai: {
        score: (ctx) => {
          const best = bestTarget(ctx.game, ctx.monsters('opp', (c) => c.faceUp && !!c.summonMethod && ['special', 'synchro', 'fusion', 'ritual'].includes(c.summonMethod) && ctx.canTarget(c)));
          return best && cardValue(ctx.game, best) >= 1800 ? 55 : 0;
        },
      },
    },
  ],
});

spell('Earthbound Immortal Revival', 'normal', {
  text: 'Discard 1 card, then target 1 "Earthbound Immortal" monster and 1 Field Spell in your GY; add those targets to your hand.',
  effects: [
    {
      kind: 'activate',
      categories: ['toHand', 'discard'],
      canActivate: (ctx) =>
        ctx.hand('me', (c) => c !== ctx.self).length > 0 && ctx.grave('me', isEI).length > 0 && ctx.grave('me', (c) => c.data.stype === 'field').length > 0,
      activate: async (ctx) => {
        const d = await ctx.select(ctx.hand('me', (c) => c !== ctx.self), 1, 1, 'Discard 1 card.', 'discard');
        if (!d.length) return false;
        await ctx.discard(d, 'cost');
        await ctx.selectTargets(ctx.grave('me', isEI), 1, 1, 'Target 1 "Earthbound Immortal" monster in your GY.', 'toHand');
        await ctx.selectTargets(ctx.grave('me', (c) => c.data.stype === 'field'), 1, 1, 'Target 1 Field Spell in your GY.', 'toHand');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.toHand(t);
      },
      ai: { score: () => 55 },
    },
  ],
});

spell('Reptilianne Poison', 'normal', {
  text: 'Activate only if you control a face-up "Reptilianne" monster. Change 1 Defense Position monster your opponent controls to face-up Attack Position and reduce its ATK to 0.',
  effects: [
    {
      kind: 'activate',
      categories: ['position', 'atkChange'],
      condition: (ctx) => ctx.faceUpMonsters('me', isReptilianne).length > 0,
      canActivate: (ctx) => ctx.monsters('opp', (c) => c.pos === 'def').length > 0,
      resolve: async (ctx) => {
        const cands = ctx.monsters('opp', (c) => c.pos === 'def' && !ctx.game.isUnaffected(c, ctx.self, ctx.player));
        if (!cands.length) return;
        const [c] = await ctx.select(cands, 1, 1, 'Change 1 Defense Position monster to face-up Attack Position.', 'position', {
          aiScore: (c) => (c.faceUp ? ctx.def(c) : 1600) + (c.data.aiValue ?? 0) / 2,
        });
        if (!c) return;
        await ctx.changePos(c, 'atk', true);
        if (c.location === 'mzone' && c.faceUp) setAtkZero(ctx, c);
      },
      ai: { score: (ctx) => (ctx.phase === 'main1' && ctx.turn > 1 && ctx.faceUpMonsters('me', (c) => c.pos === 'atk' && ctx.atk(c) > 0).length ? 50 : 0) },
    },
  ],
});

spell('Gateway of the Six', 'continuous', {
  text: 'Each time a "Six Samurai" monster(s) is Normal or Special Summoned, place 2 Bushido Counters on this card. You can remove Bushido Counters from your field to activate these effects.\n● 2 Counters: Target 1 "Six Samurai" or "Shien" Effect Monster; that target gains 500 ATK until the end of this turn.\n● 4 Counters: Add 1 "Six Samurai" monster from your Deck or GY to your hand.\n● 6 Counters: Target 1 "Shien" Effect Monster in your GY; Special Summon that target.',
  effects: [
    { kind: 'activate', categories: ['search'], ai: { score: (ctx) => (ctx.cards('me', ['hand', 'mzone'], isSixSamurai).length ? 30 : 0) } },
    {
      // Placing counters doesn't use the chain.
      kind: 'trigger',
      event: 'summoned',
      range: ['szone'],
      label: 'Bushido Counters',
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        // 2 counters per Summon, not per monster: several Six Samurai Summoned together share one event batch.
        if (c && isSixSamurai(c) && ev.method !== 'flip' && stActive(ctx) && ctx.self.flags.gatewayBatch !== ev.batch) {
          ctx.self.flags.gatewayBatch = ev.batch;
          ctx.self.counters.bushido = (ctx.self.counters.bushido ?? 0) + 2;
          ctx.game.update();
        }
        return false;
      },
    },
    // The +500 ATK target can be on either side of the field (the text does not say "you control").
    gatewayEffect(2, 'Target a Six Samurai/Shien: +500 ATK', ['atkChange'], (ctx) => ctx.faceUpMonsters('both', (c) => (isSixSamurai(c) || isShien(c)) && c.hasType('effect') && ctx.canTarget(c)).length > 0,
      async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('both', (c) => (isSixSamurai(c) || isShien(c)) && c.hasType('effect')), 1, 1, 'Target 1 "Six Samurai" or "Shien" Effect Monster.', 'buff', {
          aiScore: (c) => (c.controller === ctx.player ? 1000 + ctx.atk(c) : -1000),
        });
      },
      async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp);
        if (t.length) ctx.addTempMod(t[0], 'atk', 500, 'turn');
      },
      () => 0,
    ),
    gatewayEffect(4, 'Add a Six Samurai from Deck or GY', ['search'], (ctx) => ctx.cards('me', ['deck', 'grave'], isSixSamurai).length > 0,
      async () => undefined,
      async (ctx) => {
        const cands = ctx.cards('me', ['deck', 'grave'], isSixSamurai);
        if (!cands.length) return;
        const [c] = await ctx.select(cands, 1, 1, 'Add 1 "Six Samurai" monster from your Deck or GY to your hand.', 'toHand');
        if (c) await ctx.toHand(c);
        ctx.game.shuffleDeck(ctx.player);
      },
      () => 55,
    ),
    gatewayEffect(6, 'Revive a Shien Effect Monster', ['specialSummon'], (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => isShien(c) && c.hasType('effect') && ctx.canSummonCard(c)).length > 0,
      async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => isShien(c) && c.hasType('effect') && ctx.canSummonCard(c)), 1, 1, 'Target 1 "Shien" Effect Monster in your GY.', 'specialSummon');
      },
      async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.specialSummon(t[0], { pos: aiPos(ctx, t[0]) });
      },
      () => 60,
    ),
  ],
});

/** A Gateway of the Six effect: remove `n` Bushido Counters from your field as the cost. */
function gatewayEffect(
  n: number,
  label: string,
  categories: EffectDef['categories'],
  can: (ctx: Ctx) => boolean,
  target: (ctx: Ctx) => Promise<void>,
  resolve: (ctx: Ctx) => Promise<void>,
  score: (ctx: Ctx) => number,
): EffectDef {
  const total = (ctx: Ctx) => ctx.field('me').reduce((a, c) => a + (c.counters.bushido ?? 0), 0);
  return {
    kind: 'ignition',
    label: `${label} (${n} counters)`,
    categories,
    canActivate: (ctx) => total(ctx) >= n && can(ctx),
    activate: async (ctx) => {
      let left = n;
      for (let guard = 0; left > 0 && guard < 12; guard++) {
        const holders = ctx.field('me', (c) => (c.counters.bushido ?? 0) > 0);
        if (!holders.length) return false;
        const [h] = await ctx.select(holders, 1, 1, `Remove Bushido Counters (${left} left).`, 'cost');
        if (!h) return false;
        const k = Math.min(left, h.counters.bushido ?? 0);
        h.counters.bushido = (h.counters.bushido ?? 0) - k;
        left -= k;
      }
      ctx.game.update();
      await target(ctx);
    },
    // https://edisonrul.ing/cards/g/gateway-of-the-six.html — "Gateway of the Six" must remain face-up on the field in
    // order to resolve this effect.
    resolve: async (ctx) => {
      if (!ctx.self.onField || !ctx.self.faceUp) return;
      await resolve(ctx);
    },
    ai: { score },
  };
}

spell('Shine Palace', 'equip', {
  text: 'Equip only to a LIGHT monster. It gains 700 ATK.',
  effects: [
    equipSpell((_ctx, c) => attrIs(c, 'LIGHT'), buffScore((c) => attrIs(c, 'LIGHT'))),
    { kind: 'continuous', mods: [{ q: 'atk', to: 'cards', filter: equipped, value: 700 }] },
  ],
});

// ---- Clear World ----

/** This player is unaffected by Clear World (controls a face-up, non-negated Clear Vice Dragon). */
const clearViceProtected = (g: Game, p: PlayerId) => g.faceUpMonsters(p).some((c) => c.data.name === 'Clear Vice Dragon' && !g.isNegated(c));
/** Clear World's effect for Attribute `a` applies to player `p`. */
const clearWorldHits = (ctx: Ctx, p: PlayerId, a: Attribute) =>
  stActive(ctx) && !clearViceProtected(ctx.game, p) && ctx.game.faceUpMonsters(p).some((c) => attrIs(c, a));

spell('Clear World', 'field', {
  // APPROX: LIGHT's "play with your hand revealed" only marks the hand as revealed for the UI; WIND's 500 LP is
  // paid as the Spell Card is activated (a player with 500 LP or less cannot activate Spell Cards).
  text: 'Once per turn, during your End Phase, pay 500 LP or destroy this card. Each player receives effects, depending on the monster Attributes they control.\n● LIGHT: Play with your hand revealed at all times.\n● DARK: If you control 2 or more monsters, you cannot declare an attack.\n● EARTH: During your Standby Phase, destroy 1 face-up Defense Position monster you control.\n● WATER: During your End Phase, discard 1 card.\n● FIRE: During your End Phase, take 1000 damage.\n● WIND: You must pay 500 LP to activate a Spell Card.',
  effects: [
    {
      kind: 'activate',
      categories: ['lockdown'],
      ai: {
        score: (ctx) => {
          const hurt = (p: PlayerId) => ctx.game.faceUpMonsters(p).length;
          return clearViceProtected(ctx.game, ctx.player) ? 40 : hurt(ctx.opp) > hurt(ctx.player) + 1 ? 15 : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['fzone'],
      mandatory: true,
      label: 'Pay 500 LP or destroy this card',
      categories: [],
      eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.isMyTurn && stActive(ctx),
      resolve: async (ctx) => {
        if (!ctx.self.onField) return;
        const pay = ctx.lp > 500 && (await ctx.option('Clear World: pay 500 LP or destroy it?', ['Pay 500 LP', 'Destroy Clear World'], (i) => (i === 0 && ctx.lp > 2000 ? 1 : i === 1 ? 0.5 : 0))) === 0;
        if (pay) await ctx.payLp(500);
        else await ctx.destroy(ctx.self);
      },
    },
    {
      kind: 'continuous',
      range: ['fzone'],
      mods: [
        // DARK
        { q: 'cannotDeclareAttack', to: 'players', filter: (ctx, p: PlayerId) => clearWorldHits(ctx, p, 'DARK') && ctx.game.monsters(p).length >= 2 },
        // WIND: no LP to pay
        { q: 'cannotActivateSpells', to: 'players', filter: (ctx, p: PlayerId) => clearWorldHits(ctx, p, 'WIND') && ctx.game.players[p].lp <= 500 },
      ],
    },
    {
      // LIGHT: hand revealed; WIND: pay 500 LP per Spell Card activation. Listener, no chain.
      kind: 'trigger',
      event: ['phaseStart', 'drawn', 'addedToHand', 'cardActivated'],
      range: ['fzone'],
      label: 'Clear World (status)',
      eventFilter: (ctx, ev) => {
        if (!stActive(ctx)) return false;
        const g = ctx.game;
        for (const p of [0, 1] as PlayerId[]) {
          if (clearWorldHits(ctx, p, 'LIGHT')) for (const c of g.players[p].hand) c.revealedUntil = g.turn;
        }
        if (ev.type === 'cardActivated') {
          const c = evc(ev);
          const p = ev.player;
          if (c && c.isSpell && p !== undefined && clearWorldHits(ctx, p, 'WIND') && g.players[p].lp > 500) {
            g.players[p].lp -= 500;
            g.log(`${g.players[p].name} pays 500 LP to activate ${c.name} (Clear World). (LP ${g.players[p].lp})`, 'damage', p);
          }
        }
        return false;
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['fzone'],
      mandatory: true,
      label: 'EARTH: destroy 1 face-up Defense Position monster',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && clearWorldHits(ctx, ctx.game.turnPlayer, 'EARTH'),
      condition: (ctx) => ctx.game.faceUpMonsters(ctx.game.turnPlayer).some((c) => c.pos === 'def'),
      resolve: async (ctx) => {
        const tp = ctx.game.turnPlayer;
        if (!clearWorldHits(ctx, tp, 'EARTH')) return;
        const cands = ctx.game.faceUpMonsters(tp).filter((c) => c.pos === 'def');
        if (!cands.length) return;
        const [c] = await ctx.select(cands, 1, 1, 'Clear World (EARTH): destroy 1 face-up Defense Position monster you control.', 'cost', { player: tp });
        if (c) await ctx.destroy(c);
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['fzone'],
      mandatory: true,
      label: 'WATER: discard 1 / FIRE: take 1000 damage',
      categories: ['discard', 'damage'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && (clearWorldHits(ctx, ctx.game.turnPlayer, 'WATER') || clearWorldHits(ctx, ctx.game.turnPlayer, 'FIRE')),
      resolve: async (ctx) => {
        const tp = ctx.game.turnPlayer;
        if (clearWorldHits(ctx, tp, 'WATER') && ctx.game.players[tp].hand.length) await ctx.discardFromHand(1, undefined, 'effect', tp, 'Clear World (WATER): discard 1 card.');
        if (clearWorldHits(ctx, tp, 'FIRE')) await ctx.damage(tp, 1000);
      },
    },
  ],
});

// =================================================================== TRAPS

trap('Slip Summon', 'normal', {
  text: 'Activate only when your opponent Summons a monster. Special Summon 1 Level 4 or lower monster from your hand in face-up Defense Position. Return it to the owner\'s hand during the End Phase.',
  effects: [
    {
      kind: 'activate',
      event: 'summoned',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.player === ctx.opp,
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.hand('me', (c) => c.isMonster && lvl(c) <= 4 && ctx.canSummonCard(c)).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.hand('me', (c) => c.isMonster && lvl(c) <= 4 && ctx.canSummonCard(c));
        if (!cands.length || !ctx.canSpecialSummon()) return;
        const [c] = await ctx.select(cands, 1, 1, 'Special Summon 1 Level 4 or lower monster from your hand in face-up Defense Position.', 'specialSummon', {
          aiScore: (c) => (c.data.def ?? 0) + (c.data.aiValue ?? 0) + (c.isTuner ? 500 : 0),
        });
        if (!c) return;
        const [s] = await ctx.specialSummon(c, { pos: 'def' });
        if (!s) return;
        const mid = s.moveId;
        ctx.later('end', async () => {
          if (s.location === 'mzone' && s.moveId === mid) await ctx.game.toHand([s], 'effect', ctx.player, ctx.self);
        });
      },
      ai: {
        score: (ctx) => {
          // Block an attack with a big wall, or set up a Synchro on the opponent's turn.
          const best = Math.max(0, ...ctx.hand('me', (c) => c.isMonster && lvl(c) <= 4 && ctx.canSummonCard(c)).map((c) => c.data.def ?? 0));
          return best >= 1800 && ctx.monsters('me').length === 0 ? 35 : 0;
        },
      },
    },
  ],
});

trap('Synchro Barrier', 'normal', {
  text: 'Tribute 1 Synchro Monster you control. You do not take any damage until the End Phase of the next turn.',
  effects: [
    {
      kind: 'activate',
      categories: ['protect'],
      canActivate: (ctx) => tributable(ctx, (c) => c.hasType('synchro')).length > 0,
      activate: async (ctx) => {
        const cost = await ctx.select(tributable(ctx, (c) => c.hasType('synchro')), 1, 1, 'Tribute 1 Synchro Monster you control.', 'tribute');
        if (!cost.length) return false;
        await tributeCost(ctx, cost);
      },
      resolve: async (ctx) => {
        ctx.addPlayerMod(ctx.player, 'noBattleDamage', true, 'nextTurnEnd');
        ctx.addPlayerMod(ctx.player, 'noEffectDamage', true, 'nextTurnEnd');
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b || b.attacker.controller !== ctx.opp || b.inDamageStep) return 0;
          const incoming = ctx.monsters('opp', (c) => c.faceUp && c.pos === 'atk').reduce((a, c) => a + ctx.atk(c), 0);
          return incoming >= ctx.lp ? 90 : 0;
        },
      },
    },
  ],
});

trap('Enlightenment', 'normal', {
  // APPROX: the extra attack is granted for the rest of the Battle Phase instead of "immediately".
  text: 'You cannot Summon the turn you activate this card. Activate at the end of the Damage Step, if a Spellcaster-Type monster you control attacked and destroyed an opponent\'s monster by battle. That monster can attack again (immediately).',
  effects: [
    {
      // Remember who has Summoned this turn (listener, no chain).
      kind: 'trigger',
      event: 'summoned',
      range: ALL_LOCS,
      label: 'Summon tracker',
      eventFilter: (ctx, ev) => {
        if (ev.player !== undefined) ctx.game.turnData[`sovrSummoned:${ev.player}`] = true;
        return false;
      },
    },
    {
      kind: 'activate',
      event: 'battleDestroyed',
      categories: ['atkChange'],
      eventFilter: (ctx, ev) => {
        const a = evo(ev);
        return !!a && ctx.battle?.attacker === a && a.controller === ctx.player && raceIs(a, 'Spellcaster') && ev.fromController === ctx.opp;
      },
      condition: (ctx) => !ctx.game.turnData[`sovrSummoned:${ctx.player}`] && !!ctx.battle && !ctx.battle.inDamageStep,
      activate: async (ctx) => {
        ctx.data.a = ctx.battle!.attacker;
        ctx.data.mid = ctx.battle!.attacker.moveId;
        ctx.addPlayerMod(ctx.player, 'cannotNormalSummon');
        ctx.addPlayerMod(ctx.player, 'cannotSpecialSummon');
      },
      resolve: async (ctx) => {
        const a = ctx.data.a as C;
        if (a && a.location === 'mzone' && a.moveId === ctx.data.mid && a.faceUp) ctx.addTempMod(a, 'extraAttacks', 1, 'turn');
      },
      ai: { score: (ctx) => (ctx.monsters('opp').length === 0 || ctx.oppLp <= 3000 ? 60 : 35) },
    },
  ],
});

trap('Bending Destiny', 'counter', {
  text: 'Activate only if all face-up monsters you control are "Fortune Lady" monsters. Negate the activation of a Spell or Trap Card, or the Normal Summon of a monster, and remove that card from play. The card removed from play by this effect is returned to its owner\'s hand during the End Phase.',
  effects: [
    {
      kind: 'activate',
      label: 'Negate Normal Summon',
      negateSummon: true,
      categories: ['negateSummon', 'banish'],
      condition: (ctx) => {
        const ps = ctx.game.pendingSummon;
        const mine = ctx.faceUpMonsters('me');
        return !!ps && ps.player === ctx.opp && (ps.method === 'normal' || ps.method === 'tribute') && mine.length > 0 && mine.every(isFortuneLady);
      },
      resolve: async (ctx) => {
        const cards = [...(ctx.game.pendingSummon?.cards ?? [])];
        ctx.game.negatePendingSummon();
        const b = await ctx.banish(cards.filter((c) => c.location === 'mzone'));
        bendingReturn(ctx, b);
      },
      ai: {
        score: (ctx) => {
          const v = Math.max(0, ...(ctx.game.pendingSummon?.cards ?? []).map((c) => cardValue(ctx.game, c)));
          return v >= 1900 ? 60 : 0;
        },
      },
    },
    {
      kind: 'activate',
      label: 'Negate Spell/Trap',
      categories: ['negate', 'banish'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        const mine = ctx.faceUpMonsters('me');
        return !!l && l.isCardActivation && !l.negated && mine.length > 0 && mine.every(isFortuneLady);
      },
      resolve: async (ctx) => {
        const l = ctx.prevLink();
        if (!l) return;
        ctx.negate(l);
        if (l.card.onField || l.card.location === 'grave') {
          const b = await ctx.banish(l.card);
          bendingReturn(ctx, b);
        }
      },
      ai: {
        score: (ctx) => {
          const l = ctx.prevLink();
          if (!l || l.player !== ctx.opp) return 0;
          const cats = l.effect.categories ?? [];
          return cats.some((c) => ['destroy', 'destroyMulti', 'control', 'banish', 'negate', 'negateAttack'].includes(c)) || l.ctx.targets.some((t) => t.controller === ctx.player) ? 70 : 0;
        },
      },
    },
  ],
});
function bendingReturn(ctx: Ctx, cards: C[]) {
  for (const c of cards.filter((x) => x.location === 'banished')) {
    const mid = c.moveId;
    ctx.later('end', async () => {
      if (c.location === 'banished' && c.moveId === mid) await ctx.game.toHand([c], 'effect', ctx.player, ctx.self);
    });
  }
}

trap('Inherited Fortune', 'normal', {
  text: 'Activate during the turn a face-up "Fortune Lady" monster you control was destroyed. Special Summon up to 2 "Fortune Lady" monsters from your hand during your next Standby Phase.',
  effects: [
    {
      // Remember that a face-up Fortune Lady of this player was destroyed this turn (listener, no chain).
      kind: 'trigger',
      event: 'destroyed',
      range: ALL_LOCS,
      label: 'Fortune Lady destroyed (status)',
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        if (c && ev.from === 'mzone' && ev.fromFaceUp && isFortuneLady(c) && ev.fromController !== undefined) ctx.game.turnData[`sovrFLDestroyed:${ev.fromController}`] = true;
        return false;
      },
    },
    {
      kind: 'activate',
      categories: ['specialSummon'],
      condition: (ctx) => !!ctx.game.turnData[`sovrFLDestroyed:${ctx.player}`],
      resolve: async (ctx) => {
        const p = ctx.player;
        ctx.later(
          'standby',
          async () => {
            const g = ctx.game;
            if (g.turnPlayer !== p || g.queryPlayer(p, 'cannotSpecialSummon')) return;
            const c2 = new Ctx(g, ctx.self, ctx.effect, p);
            const cands = c2.hand('me', (c) => isFortuneLady(c) && c2.canSummonCard(c));
            if (!cands.length) return;
            const max = Math.min(2, cands.length, g.freeMZones(p));
            if (max <= 0) return;
            const sel = await c2.select(cands, 0, max, 'Inherited Fortune: Special Summon up to 2 "Fortune Lady" monsters from your hand.', 'specialSummon');
            if (sel.length) await c2.specialSummon(sel, { pos: 'atk' });
          },
          nextOwnTurn(ctx),
        );
      },
      ai: { score: (ctx) => (ctx.hand('me', isFortuneLady).length ? 45 : 0) },
    },
  ],
});

trap('Spider Egg', 'normal', {
  text: 'When your opponent declares a direct attack, while you have 3 or more Insect monsters in your GY: Negate the attack, and if you do, Special Summon 3 "Spider Tokens" (Insect/EARTH/Level 1/ATK 100/DEF 100) in Attack Position.',
  effects: [
    {
      kind: 'activate',
      event: 'attackDeclared',
      categories: ['negateAttack', 'specialSummon'],
      eventFilter: (ctx, ev) => evc(ev)?.controller === ctx.opp && !ev.other,
      condition: (ctx) => !!ctx.battle && !ctx.battle.target && !ctx.battle.inDamageStep && ctx.grave('me', (c) => raceIs(c, 'Insect')).length >= 3,
      resolve: async (ctx) => {
        if (!ctx.battle || ctx.battle.negated) return;
        ctx.negateAttack();
        if (ctx.canSpecialSummon() && ctx.freeMZones() > 0) await ctx.createTokens(spiderToken, 3, 'atk');
      },
      ai: { score: (ctx) => (ctx.battle && ctx.atk(ctx.battle.attacker) >= 1000 ? 65 : 0) },
    },
  ],
});

trap("Wolf in Sheep's Clothing", 'normal', {
  text: 'Activate only when you take Battle Damage from your opponent\'s monster\'s direct attack. Reveal 1 Level 1 monster in your hand. Special Summon it from your hand, and 1 monster with the same name from your Deck.',
  effects: [
    {
      kind: 'activate',
      event: 'battleDamage',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.player === ctx.player && !!ctx.battle && !ctx.battle.target && ctx.battle.attacker.controller === ctx.opp,
      canActivate: (ctx) =>
        ctx.canSpecialSummon() &&
        ctx.freeMZones() >= 2 &&
        ctx.hand('me', (c) => c.isMonster && lvl(c) === 1 && ctx.canSummonCard(c) && ctx.deck('me', (d) => d.name === c.name).length > 0).length > 0,
      activate: async (ctx) => {
        const cands = ctx.hand('me', (c) => c.isMonster && lvl(c) === 1 && ctx.canSummonCard(c) && ctx.deck('me', (d) => d.name === c.name).length > 0);
        const [c] = await ctx.select(cands, 1, 1, 'Reveal 1 Level 1 monster in your hand.', 'specialSummon', { aiScore: reviveScore });
        if (!c) return false;
        c.revealedUntil = ctx.turn;
        ctx.log(`${ctx.game.players[ctx.player].name} reveals ${c.name}.`);
        ctx.data.c = c;
      },
      resolve: async (ctx) => {
        const c = ctx.data.c as C;
        if (!c || c.location !== 'hand' || !ctx.canSpecialSummon()) return;
        const twin = ctx.deck('me', (d) => d.name === c.name)[0];
        const list = twin && ctx.freeMZones() >= 2 ? [c, twin] : [c];
        await ctx.specialSummon(list, { pos: 'choose' });
        ctx.game.shuffleDeck(ctx.player);
      },
      ai: { score: () => 50 },
    },
  ],
});

trap('Earthbound Wave', 'counter', {
  text: 'When your opponent activates a Spell/Trap Card while you control an "Earthbound Immortal" monster: Negate the activation, and if you do, destroy it.',
  effects: [
    {
      kind: 'activate',
      categories: ['negate'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && l.isCardActivation && l.player === ctx.opp && !l.negated && ctx.faceUpMonsters('me', isEI).length > 0;
      },
      resolve: async (ctx) => {
        await ctx.negateAndDestroy(ctx.prevLink());
      },
      ai: { score: () => 70 },
    },
  ],
});

trap('Roar of the Earthbound Immortal', 'continuous', {
  text: 'Once per turn, if an opponent\'s monster declares an attack: Target the attacking monster; destroy that target, and if you do, inflict damage to your opponent equal to half the destroyed monster\'s ATK. You must control an "Earthbound Immortal" monster with ATK higher than the ATK of the attacking monster to activate and to resolve this effect.',
  effects: [
    { kind: 'activate', categories: ['destroy'], ai: { score: (ctx) => (ctx.faceUpMonsters('me', isEI).length ? 30 : ctx.cards('me', ['hand'], isEI).length ? 15 : 0) } },
    {
      kind: 'quick',
      event: 'attackDeclared',
      opt: true,
      label: 'Destroy the attacker, burn half its ATK',
      categories: ['destroy', 'damage'],
      eventFilter: (ctx, ev) => evc(ev)?.controller === ctx.opp,
      condition: (ctx) => {
        const b = ctx.battle;
        if (!b || b.inDamageStep || b.attacker.controller !== ctx.opp) return false;
        return ctx.faceUpMonsters('me', (c) => isEI(c) && ctx.atk(c) > ctx.atk(b.attacker)).length > 0;
      },
      canActivate: (ctx) => !!ctx.battle && ctx.canTarget(ctx.battle.attacker),
      activate: async (ctx) => {
        await ctx.selectTargets([ctx.battle!.attacker], 1, 1, 'Target the attacking monster.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone')[0];
        if (!t) return;
        const atk = ctx.atk(t);
        if (!ctx.faceUpMonsters('me', (c) => isEI(c) && ctx.atk(c) > atk).length) return;
        const d = await ctx.destroy(t);
        if (d.length) await ctx.damage(ctx.opp, Math.floor(atk / 2));
      },
      ai: { score: () => 80 },
    },
  ],
});

trap('Limit Impulse', 'normal', {
  // APPROX: "cannot be Tributed, except for a Tribute Summon" is honoured by the SOVR scripts only.
  text: 'Send 2 cards from your hand to the GY; Special Summon 2 "Soul Tokens" (Fiend/DARK/Level 1/ATK 0/DEF 0). They cannot be Tributed except for a Tribute Summon.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.hand('me').length >= 2 && ctx.freeMZones() >= 2 && ctx.canSpecialSummon(),
      activate: async (ctx) => {
        const cost = await ctx.select(ctx.hand('me'), 2, 2, 'Send 2 cards from your hand to the GY.', 'cost');
        if (cost.length < 2) return false;
        await ctx.sendToGrave(cost, 'cost');
      },
      resolve: async (ctx) => {
        if (ctx.freeMZones() < 2) return;
        const t = await ctx.createTokens(soulToken, 2, 'def');
        for (const x of t) x.flags.sovrNoCostTribute = true;
      },
      ai: {
        score: (ctx) => {
          const big = ctx.hand('me', (c) => c.isMonster && lvl(c) >= 7).length;
          return big && ctx.hand('me').length >= 4 && !ctx.isMyTurn && ctx.phase === 'end' ? 40 : 0;
        },
      },
    },
  ],
});

trap('Infernity Force', 'normal', {
  text: 'Activate only when an "Infernity" monster is selected as an attack target while you have no cards in your hand. Destroy the attacking monster and Special Summon 1 "Infernity" monster from your Graveyard.',
  effects: [
    {
      kind: 'activate',
      event: 'attackDeclared',
      categories: ['destroy', 'specialSummon'],
      eventFilter: (ctx, ev) => {
        const t = evo(ev);
        return !!t && t.controller === ctx.player && t.faceUp && isInfernity(t);
      },
      condition: (ctx) => ctx.hand('me').length === 0 && !!ctx.battle && !ctx.battle.inDamageStep,
      resolve: async (ctx) => {
        const a = ctx.battle?.attacker;
        if (a && a.location === 'mzone') await ctx.destroy(a);
        const cands = ctx.grave('me', (c) => isInfernity(c) && ctx.canSummonCard(c));
        if (!cands.length || !ctx.canSpecialSummon()) return;
        const [c] = await ctx.select(cands, 1, 1, 'Special Summon 1 "Infernity" monster from your GY.', 'specialSummon', { aiScore: reviveScore });
        if (c) await ctx.specialSummon(c, { pos: aiPos(ctx, c) });
      },
      ai: { score: () => 75 },
    },
  ],
});

trap('Nega-Ton Corepanel', 'counter', {
  text: 'Activate only if you control a face-up "Koa\'ki Meiru" monster and have "Iron Core of Koa\'ki Meiru" in your Graveyard. Negate the activation of an Effect Monster\'s effect, and destroy it.',
  effects: [
    {
      kind: 'activate',
      categories: ['negate'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return (
          !!l &&
          !l.negated &&
          !l.isCardActivation &&
          l.card.isMonster &&
          ctx.faceUpMonsters('me', isKoakiMonster).length > 0 &&
          ctx.grave('me', (c) => c.name === IRON_CORE).length > 0
        );
      },
      resolve: async (ctx) => {
        const l = ctx.prevLink();
        if (!l) return;
        ctx.negate(l);
        if (l.card.onField) await ctx.destroy(l.card);
      },
      ai: { score: (ctx) => (ctx.prevLink()?.player === ctx.opp ? 70 : 0) },
    },
  ],
});

trap('Gemini Counter', 'counter', {
  text: 'Change 1 face-up Gemini monster you control to face-down Defense Position and negate the activation of an opponent\'s Spell Card, and destroy it.',
  effects: [
    {
      kind: 'activate',
      categories: ['negate'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && l.isCardActivation && l.card.isSpell && l.player === ctx.opp && !l.negated;
      },
      canActivate: (ctx) => ctx.faceUpMonsters('me', isGemini).length > 0,
      activate: async (ctx) => {
        const [g] = await ctx.select(ctx.faceUpMonsters('me', isGemini), 1, 1, 'Change 1 face-up Gemini monster you control to face-down Defense Position.', 'cost');
        if (!g) return false;
        g.flags.geminiSummoned = false;
        await ctx.changePos(g, 'def', false);
      },
      resolve: async (ctx) => {
        await ctx.negateAndDestroy(ctx.prevLink());
      },
      ai: {
        score: (ctx) => {
          const l = ctx.prevLink();
          if (!l) return 0;
          const cats = l.effect.categories ?? [];
          return cats.some((c) => ['destroy', 'destroyMulti', 'control', 'specialSummon', 'draw', 'search'].includes(c)) ? 65 : 0;
        },
      },
    },
  ],
});

trap('Gemini Booster', 'normal', {
  text: 'Equip this card to a Gemini monster you control as an Equip Card. It gains 700 ATK. When this card is destroyed while equipped and sent to the Graveyard, select 1 face-up Gemini monster and treat it as an Effect Monster.',
  effects: [
    {
      kind: 'activate',
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => isGemini(c) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('me', isGemini), 1, 1, 'Target 1 Gemini monster you control.', 'equip');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp)[0];
        if (!t || !ctx.self.onField || !ctx.self.faceUp) return;
        ctx.self.flags.staysOnField = true;
        ctx.self.activeOnField = true;
        ctx.equip(t);
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (b && !b.inDamageStep && b.target && b.attacker.controller === ctx.opp && isGemini(b.target) && b.target.faceUp) {
            const t = b.target;
            const stat = t.pos === 'atk' ? ctx.atk(t) : ctx.def(t);
            return t.pos === 'atk' && stat <= ctx.atk(b.attacker) && stat + 700 > ctx.atk(b.attacker) ? 70 : 0;
          }
          return ctx.isMyTurn && ctx.phase === 'main1' && ctx.faceUpMonsters('me', isGemini).length ? 30 : 0;
        },
      },
    },
    { kind: 'continuous', mods: [{ q: 'atk', to: 'cards', filter: equipped, value: 700 }] },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'Treat a Gemini as an Effect Monster',
      categories: [],
      // Destroyed by a card effect (not the rule destruction when its monster left the field).
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'szone' && ev.fromFaceUp === true && (ev.reasons ?? []).includes('destroy') && ev.reason !== 'rule',
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => isGemini(c) && !c.flags.geminiSummoned).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.faceUpMonsters('both', (c) => isGemini(c) && !c.flags.geminiSummoned);
        const [g] = await ctx.select(cands, 1, 1, 'Select 1 face-up Gemini monster to treat as an Effect Monster.', 'buff');
        if (g) makeGeminiActive(ctx, g);
      },
    },
  ],
});

trap('Ritual Buster', 'normal', {
  // APPROX: the engine's 'cannotActivateSpells' stops Spell Card activations but not the effects of face-up
  // Continuous Spells; Trap Cards and their effects are fully stopped.
  text: 'Activate only when a Ritual Monster is Ritual Summoned. Your opponent cannot activate any Spell or Trap Cards or use their effects until your next Standby Phase.',
  effects: [
    {
      kind: 'activate',
      event: 'specialSummoned',
      categories: ['lockdown'],
      eventFilter: (ctx, ev) => ev.method === 'ritual',
      resolve: async (ctx) => {
        const g = ctx.game;
        const opp = ctx.opp;
        const lock = () => {
          g.addPlayerMod(opp, 'cannotActivateSpells', true, 'nextTurnEnd');
          g.addPlayerMod(opp, 'cannotActivateTraps', true, 'nextTurnEnd');
          return g.playerMods.slice(-2);
        };
        let mods = lock();
        // 'nextTurnEnd' mods expire at the end of the next turn; renew them then if "your next Standby Phase" is later.
        if (nextOwnTurn(ctx) === 2) {
          ctx.later(
            'end',
            async () => {
              g.playerMods = g.playerMods.filter((m) => !mods.includes(m));
              mods = lock();
            },
            1,
          );
        }
        ctx.later(
          'standby',
          async () => {
            g.playerMods = g.playerMods.filter((m) => !mods.includes(m));
          },
          nextOwnTurn(ctx),
        );
      },
      ai: { score: (ctx) => (ctx.event?.player === ctx.opp ? 60 : 0) },
    },
  ],
});

trap('Stygian Dirge', 'continuous', {
  text: 'Reduce the Levels of all monsters your opponent controls by 1.',
  effects: [
    {
      kind: 'activate',
      categories: ['lockdown'],
      ai: { score: (ctx) => (!ctx.isMyTurn && ctx.extra('opp').length > 0 && ctx.faceUpMonsters('opp').length ? 25 : 0) },
    },
    { kind: 'continuous', mods: [{ q: 'level', to: 'cards', filter: (ctx, c: C) => c.location === 'mzone' && c.controller === ctx.opp, value: -1 }] },
  ],
});

trap('Seal of Wickedness', 'continuous', {
  text: 'Once per turn, during your opponent\'s Standby Phase, select 1 face-up card on the field. The selected card\'s effect(s) is negated during that turn. During each of your Standby Phases, pay 500 Life Points or destroy this card.',
  effects: [
    {
      kind: 'activate',
      categories: ['negate'],
      // Flip it up in the opponent's Draw Phase so the effect is ready in their Standby Phase.
      ai: { score: (ctx) => (!ctx.isMyTurn && ctx.phase === 'draw' && ctx.field('opp', (c) => c.faceUp && (c.hasType('effect') || !c.isMonster)).length ? 40 : 0) },
    },
    {
      kind: 'quick',
      opt: true,
      label: 'Negate 1 face-up card this turn',
      categories: ['negate'],
      condition: (ctx) => ctx.phase === 'standby' && !ctx.isMyTurn,
      canActivate: (ctx) => ctx.field('both', (c) => c.faceUp && c !== ctx.self && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.field('both', (c) => c.faceUp && c !== ctx.self), 1, 1, 'Select 1 face-up card on the field.', 'negate', {
          aiScore: (c) => (c.controller === ctx.opp ? 1000 : -1000) + (c.hasType('effect') || !c.isMonster ? 500 : 0) + cardValue(ctx.game, c),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField && c.faceUp);
        if (t.length) ctx.negateEffects(t[0], 'turn');
      },
      ai: { score: (ctx) => (ctx.field('opp', (c) => c.faceUp && (c.hasType('effect') || !c.isMonster)).length ? 50 : 0) },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['szone'],
      mandatory: true,
      label: 'Pay 500 LP or destroy this card',
      categories: [],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn && stActive(ctx),
      resolve: async (ctx) => {
        if (!ctx.self.onField) return;
        const pay = ctx.lp > 500 && (await ctx.option('Seal of Wickedness: pay 500 LP or destroy it?', ['Pay 500 LP', 'Destroy Seal of Wickedness'], (i) => (i === 0 ? (ctx.lp > 2500 ? 1 : 0) : 0.5))) === 0;
        if (pay) await ctx.payLp(500);
        else await ctx.destroy(ctx.self);
      },
    },
  ],
});

trap('Appointer of the Red Lotus', 'normal', {
  text: 'Pay 2000 LP and reveal your entire hand; look at your opponent\'s hand and banish 1 card from their hand, until your opponent\'s next End Phase.',
  effects: [
    {
      kind: 'activate',
      categories: ['banish'],
      canActivate: (ctx) => ctx.lp > 2000 && ctx.hand('opp').length > 0,
      activate: async (ctx) => {
        await ctx.payLp(2000);
        for (const c of ctx.hand('me')) c.revealedUntil = ctx.turn;
        ctx.log(`${ctx.game.players[ctx.player].name} reveals their hand: ${ctx.hand('me').map((c) => c.name).join(', ') || '(empty)'}.`);
      },
      resolve: async (ctx) => {
        const hand = ctx.hand('opp');
        if (!hand.length) return;
        for (const c of hand) c.revealedUntil = ctx.turn;
        const [c] = await ctx.select(hand, 1, 1, 'Banish 1 card from your opponent\'s hand.', 'banish');
        if (!c) return;
        const b = await ctx.banish(c);
        if (!b.length || c.location !== 'banished') return;
        const mid = c.moveId;
        ctx.later(
          'end',
          async () => {
            if (c.location === 'banished' && c.moveId === mid) await ctx.game.toHand([c], 'effect', ctx.player, ctx.self);
          },
          nextOppTurnEnd(ctx),
        );
      },
      ai: { score: (ctx) => (ctx.lp >= 5000 && ctx.hand('opp').length >= 2 && !ctx.isMyTurn && ctx.phase === 'standby' ? 35 : 0) },
    },
  ],
});

/** Passcodes (8-digit card numbers) of every SOVR card, from YGOJSON. */
export const SOVR_PASSCODES: Record<string, string> = {
  'Koa\'ki Meiru Beetle': '39037517',
  'Majestic Dragon': '21159309',
  'Stardust Xiaolong': '68543408',
  'Max Warrior': '94538053',
  'Quickdraw Synchron': '20932152',
  'Level Eater': '57421866',
  'Zero Gardna': '93816465',
  'Regulus': '20210570',
  'Infernity Necromancer': '56209279',
  'Fortune Lady Wind': '82693917',
  'Fortune Lady Water': '29088922',
  'Fortune Lady Dark': '55586621',
  'Fortune Lady Earth': '82971335',
  'Solitaire Magician': '28966434',
  'Catoblepas and the Witch of Fate': '54360049',
  'Dark Spider': '81759748',
  'Ground Spider': '17243896',
  'Relinquished Spider': '54248491',
  'Spyder Spider': '80637190',
  'Mother Spider': '17021204',
  'Reptilianne Gorgon': '43426903',
  'Reptilianne Medusa': '89810518',
  'Reptilianne Scylla': '16909657',
  'Reptilianne Viper': '42303365',
  'Earthbound Immortal Ccarayhua': '79798060',
  'Earthbound Immortal Uru': '15187079',
  'Earthbound Immortal Wiraqocha Rasca': '41181774',
  'Koa\'ki Meiru Sea Panther': '74576482',
  'Koa\'ki Meiru Rooklord': '10060427',
  'Tuned Magician': '47459126',
  'Crusader of Endymion': '73853830',
  'Woodland Archer': '09848939',
  'Knight of the Red Lotus': '46237548',
  'Energy Bravery': '72631243',
  'Swap Frog': '09126351',
  'Lord British Space Fighter': '35514096',
  'Oshaleon': '71519605',
  'Djinn Releaser of Rituals': '08903700',
  'Djinn Presider of Rituals': '34358408',
  'Divine Grace - Northwemko': '61757117',
  'Majestic Star Dragon': '07841112',
  'Blackwing - Silverwind the Ascendant': '33236860',
  'Reptilianne Hydra': '60634565',
  'Black Brutdrago': '96029574',
  'Explosive Magician': '33413279',
  'Spider Web': '69408987',
  'Earthbound Whirlwind': '96907086',
  'Savage Colosseum': '32391631',
  'Attack Pheromones': '68786330',
  'Molting Escape': '95784434',
  'Reptilianne Spawn': '21179143',
  'Fortune\'s Future': '68663748',
  'Time Passage': '94068856',
  'Iron Core Armor': '20457551',
  'Herculean Power': '57441100',
  'Gemini Spark': '33846209',
  'Ritual of Grace': '60234913',
  'Preparation of Rites': '96729612',
  'Moray of Greed': '22123627',
  'Spiritual Forest': '69112325',
  'Raging Mad Plants': '95507060',
  'Insect Neglect': '22991179',
  'Faustian Bargain': '68396778',
  'Slip Summon': '94484482',
  'Synchro Barrier': '21879581',
  'Enlightenment': '57274196',
  'Bending Destiny': '94662235',
  'Inherited Fortune': '20057949',
  'Spider Egg': '56051648',
  'Wolf in Sheep\'s Clothing': '83546647',
  'Earthbound Wave': '29934351',
  'Roar of the Earthbound Immortal': '56339050',
  'Limit Impulse': '82324105',
  'Infernity Force': '18712704',
  'Nega-Ton Corepanel': '55117418',
  'Gemini Counter': '81601517',
  'Gemini Booster': '18096222',
  'Ritual Buster': '54094821',
  'Stygian Dirge': '81489939',
  'Seal of Wickedness': '17874674',
  'Appointer of the Red Lotus': '43262273',
  'Koa\'ki Meiru Maximus': '65026212',
  'Shire, Lightsworn Spirit': '02420921',
  'Rinyan, Lightsworn Rogue': '38815069',
  'Yellow Baboon, Archer of the Forest': '65303664',
  'Gemini Scorpion': '91798373',
  'Metabo-Shark': '37792478',
  'Earthbound Immortal Revival': '64187086',
  'Reptilianne Poison': '90576781',
  'Gateway of the Six': '27970830',
  'Dark Rabbit': '99261403',
  'Shine Palace': '82878489',
  'Dark Simorgh': '11366199',
  'Victoria': '75162696',
  'Ice Queen': '14462257',
  'Shutendoji': '65422840',
  'Archlord Kristya': '59509952',
  'Guardian Eatos': '34022290',
  'Clear Vice Dragon': '97811903',
  'Clear World': '33900648',
};

export const SOVR_LOADED = true;
