// Card definitions: generic Main Deck monsters (effect + vanilla).
// See docs/CARD_SCRIPTING.md and src/cards/sets/core.ts for the patterns used here.
// Engine limitations and their workarounds are listed in docs/engine-requests/monsters.md.
import { monster, normal, token } from '../define';
import { attr, bestTarget, cardValue, destroyTargets, flip, selfFieldToGrave, selfDestroysByBattle } from '../helpers';
import type { CardInstance, EffectDef } from '../../engine/card';
import type { Ctx } from '../../engine/ctx';
import type { ChainLink, Game } from '../../engine/game';
import type { Attribute, GameEvent, PlayerId, Race } from '../../engine/types';

// ============================================================ shared helpers

const evC = (ev: GameEvent) => ev.card as CardInstance | undefined;
const evO = (ev: GameEvent) => ev.other as CardInstance | undefined;
const reasonsOf = (ev: GameEvent) => ev.reasons ?? (ev.reason ? [ev.reason] : []);

/** Once-per-Duel bookkeeping (card flags are wiped whenever a card moves). */
const perDuel = new WeakMap<Game, Set<string>>();
function duelUsed(g: Game, key: string) {
  return perDuel.get(g)?.has(key) ?? false;
}
function markDuel(g: Game, key: string) {
  let s = perDuel.get(g);
  if (!s) perDuel.set(g, (s = new Set()));
  s.add(key);
}

/** Tribute this card as a cost (emits the 'tributed' event). */
async function tributeSelf(ctx: Ctx) {
  await ctx.game.moveCards([ctx.self], 'grave', {
    reason: 'tribute',
    reasons: ['tribute', 'cost'],
    reasonPlayer: ctx.player,
    reasonCard: ctx.self,
  });
}

/**
 * "End the Battle Phase": the engine has no direct hook, so the current attack is negated and
 * the turn player cannot declare further attacks this turn.
 */
function endBattlePhase(ctx: Ctx) {
  if (ctx.battle) ctx.negateAttack();
  ctx.addPlayerMod(ctx.game.turnPlayer, 'cannotDeclareAttack', true, 'turn');
  ctx.log('The Battle Phase ends.');
}

/** Monster battling `self` in the current battle (the opponent's side). */
function battleOpponent(ctx: Ctx, self: CardInstance = ctx.self): CardInstance | null {
  const b = ctx.battle;
  if (!b) return null;
  if (b.attacker === self) return b.target;
  if (b.target === self) return b.attacker;
  return null;
}

/** True once the current attack has finished its Damage Step (the battle state lingers until triggers resolve). */
function attackFinished(g: Game): boolean {
  for (let i = g.eventLog.length - 1; i >= 0; i--) {
    const t = g.eventLog[i].type;
    if (t === 'damageStepEnd') return true;
    if (t === 'attackDeclared') return false;
  }
  return false;
}

/** Would `c` be destroyed by battle with `opp` given current stats (ignoring indestructibility)? */
function wouldLoseBattle(ctx: Ctx, c: CardInstance, opp: CardInstance, cIsAttacker: boolean): boolean {
  if (cIsAttacker) {
    if (opp.pos !== 'atk') return false;
    const a = ctx.atk(c);
    const o = ctx.atk(opp);
    return o > a || (o === a && a > 0);
  }
  const a = ctx.atk(opp);
  if (c.pos === 'atk') {
    const s = ctx.atk(c);
    return a > s || (a === s && a > 0);
  }
  return a > ctx.def(c);
}

/** "When this card is destroyed by battle and sent to the GY: you can Special Summon 1 <ATTR> monster with 1500 or less ATK from your Deck in Attack Position." */
function recruiter(a: Attribute): EffectDef {
  const ok = (ctx: Ctx) => (c: CardInstance) => c.isMonster && c.data.attribute === a && (c.data.atk ?? 0) <= 1500 && ctx.canSummonCard(c);
  return {
    kind: 'trigger',
    event: 'sentToGrave',
    label: `Recruit ${a}`,
    categories: ['specialSummon'],
    eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone' && reasonsOf(ev).includes('battle'),
    condition: (ctx) => ctx.canSpecialSummon() && ctx.deck('me', ok(ctx)).length > 0,
    resolve: async (ctx) => {
      const cands = ctx.deck('me', ok(ctx));
      const sel = await ctx.select(cands, 1, 1, `Special Summon 1 ${a} monster with 1500 or less ATK from your Deck.`, 'specialSummon', {
        aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0) + (c.name === ctx.self.name ? 300 : 0),
      });
      if (sel.length) await ctx.specialSummon(sel[0], { pos: 'atk' });
      ctx.game.shuffleDeck(ctx.player);
    },
  };
}

/**
 * Spirit: remembers the turn it was Normal Summoned / flipped face-up (via an eventFilter
 * side effect) and returns to the hand during that turn's End Phase.
 */
const markSpirit = (ctx: Ctx, ev: GameEvent) => {
  if (ev.card === ctx.self && (ev.type === 'normalSummoned' || ev.type === 'flipped')) ctx.self.flags.spiritTurn = ctx.turn;
};
const spiritReturn: EffectDef = {
  kind: 'trigger',
  event: 'phaseStart',
  mandatory: true,
  label: 'Return to hand (Spirit)',
  categories: ['toHand'],
  eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.self.location === 'mzone' && ctx.self.flags.spiritTurn === ctx.turn,
  resolve: async (ctx) => {
    if (ctx.self.location === 'mzone' && ctx.self.faceUp) await ctx.toHand(ctx.self);
  },
};

/** Inherent Special Summon by banishing 1 LIGHT and 1 DARK monster from your GY. */
function envoyProc(): EffectDef {
  return {
    kind: 'proc',
    label: 'Special Summon (banish LIGHT + DARK)',
    condition: (ctx) => {
      if (ctx.freeMZones() <= 0) return false;
      const l = ctx.grave('me', attr('LIGHT'));
      const d = ctx.grave('me', attr('DARK'));
      return l.length > 0 && d.length > 0;
    },
    perform: async (ctx) => {
      const light = await ctx.select(ctx.grave('me', attr('LIGHT')), 1, 1, 'Banish 1 LIGHT monster from your GY.', 'cost');
      const dark = await ctx.select(ctx.grave('me', attr('DARK')), 1, 1, 'Banish 1 DARK monster from your GY.', 'cost');
      if (!light.length || !dark.length) return false;
      await ctx.banish([...light, ...dark], 'cost');
      return true;
    },
  };
}

/** Ignition-style "pay LP: Special Summon a Fusion Monster from the Extra Deck". */
function fusionFromExtra(ctx: Ctx, maxLevel: number) {
  return ctx.extra('me', (c) => c.hasType('fusion') && (c.data.level ?? 0) <= maxLevel && ctx.canSummonCard(c));
}

// ============================================================ EFFECT MONSTERS

monster('Spirit Reaper', {
  attribute: 'DARK',
  race: 'Zombie',
  level: 3,
  atk: 300,
  def: 200,
  text: 'Cannot be destroyed by battle. After resolving a card effect that targets this face-up card, destroy this card. If this card attacks directly and inflicts battle damage: your opponent discards 1 random card.',
  aiValue: 700,
  effects: [
    { kind: 'continuous', mods: [{ q: 'indestructibleBattle' }] },
    {
      // Self-destruction when targeted: wraps the targeting link's resolution (no 'targeted' event in the engine).
      kind: 'trigger',
      event: 'chainActivated',
      label: 'Destroyed when targeted',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => {
        const me = ctx.self;
        const link = ev.data?.link as ChainLink | undefined;
        if (!link || me.location !== 'mzone' || !me.faceUp || ctx.game.isNegated(me)) return false;
        if (!link.ctx.targets.includes(me)) return false;
        const orig = link.effect;
        const moveId = me.moveId;
        const game = ctx.game;
        link.effect = {
          ...orig,
          resolve: async (c) => {
            if (orig.resolve) await orig.resolve(c);
            if (me.location === 'mzone' && me.moveId === moveId && me.faceUp && !game.isNegated(me)) {
              game.log(`${me.name} was targeted and destroys itself.`, 'action', me.controller);
              await game.destroy([me], 'effect', me.controller, me);
            }
          },
        };
        return false;
      },
    },
    {
      kind: 'trigger',
      event: 'battleDamage',
      mandatory: true,
      label: 'Random discard',
      categories: ['discard'],
      eventFilter: (ctx, ev) => ev.reasonCard === ctx.self && ev.player === ctx.opp && !!ctx.battle && !ctx.battle.target,
      resolve: async (ctx) => {
        const hand = ctx.hand('opp');
        if (!hand.length) return;
        const c = ctx.game.rng.pick(hand);
        await ctx.game.discard([c], 'effect', ctx.player, ctx.self);
      },
    },
  ],
});

monster('Mystic Tomato', {
  attribute: 'DARK',
  race: 'Plant',
  level: 4,
  atk: 1400,
  def: 1100,
  text: 'When this card is destroyed by battle and sent to the GY: You can Special Summon 1 DARK monster with 1500 or less ATK from your Deck in Attack Position.',
  aiValue: 300,
  effects: [recruiter('DARK')],
});

monster('Giant Rat', {
  attribute: 'EARTH',
  race: 'Beast',
  level: 4,
  atk: 1400,
  def: 1450,
  text: 'When this card is destroyed by battle and sent to the GY: You can Special Summon 1 EARTH monster with 1500 or less ATK from your Deck in Attack Position.',
  aiValue: 300,
  effects: [recruiter('EARTH')],
});

monster('Mother Grizzly', {
  attribute: 'WATER',
  race: 'Beast-Warrior',
  level: 4,
  atk: 1400,
  def: 1000,
  text: 'When this card is destroyed by battle and sent to the GY: You can Special Summon 1 WATER monster with 1500 or less ATK from your Deck in Attack Position.',
  aiValue: 300,
  effects: [recruiter('WATER')],
});

monster('Shining Angel', {
  attribute: 'LIGHT',
  race: 'Fairy',
  level: 4,
  atk: 1400,
  def: 800,
  text: 'When this card is destroyed by battle and sent to the GY: You can Special Summon 1 LIGHT monster with 1500 or less ATK from your Deck in Attack Position.',
  aiValue: 300,
  effects: [recruiter('LIGHT')],
});

monster('Necro Gardna', {
  attribute: 'DARK',
  race: 'Warrior',
  level: 3,
  atk: 600,
  def: 1300,
  text: "During your opponent's turn: You can banish this card from your GY to negate 1 attack of an opponent's monster.",
  aiValue: 500,
  effects: [
    {
      kind: 'quick',
      range: ['grave'],
      label: 'Banish: negate attack',
      categories: ['negateAttack'],
      condition: (ctx) => {
        const b = ctx.battle;
        return !ctx.isMyTurn && !!b && !b.negated && !b.inDamageStep && b.attacker.controller === ctx.opp && !attackFinished(ctx.game);
      },
      activate: async (ctx) => {
        await ctx.banish(ctx.self, 'cost');
      },
      resolve: async (ctx) => {
        if (ctx.battle && !ctx.battle.negated) ctx.negateAttack();
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b) return 0;
          const atk = ctx.atk(b.attacker);
          if (!b.target) return atk >= 1000 ? 60 + atk / 100 : 0;
          const t = b.target;
          if (t.controller !== ctx.player) return 0;
          if (!t.faceUp) return atk >= 1800 ? 40 : 0;
          if (ctx.query(t, 'indestructibleBattle')) return 0;
          return wouldLoseBattle(ctx, t, b.attacker, false) ? 45 + cardValue(ctx.game, t) / 100 : 0;
        },
      },
    },
  ],
});

const emissaryToken = token('Emissary of Darkness Token', 'LIGHT', 'Fairy', 7, 0, 0, "Summoned by Gorz the Emissary of Darkness. Its ATK/DEF equal the battle damage taken.");

monster('Gorz the Emissary of Darkness', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 7,
  atk: 2700,
  def: 2500,
  text: 'If you take damage from a card your opponent controls while you control no cards: You can Special Summon this card from your hand. Then, if it was battle damage, Special Summon 1 "Emissary of Darkness Token" (LIGHT/Fairy/Level 7) with ATK/DEF equal to that damage; if it was effect damage, gain LP equal to that damage.',
  aiValue: 1500,
  effects: [
    {
      kind: 'trigger',
      event: 'damage',
      range: ['hand'],
      label: 'Special Summon Gorz',
      categories: ['specialSummon', 'recover'],
      eventFilter: (ctx, ev) =>
        ev.player === ctx.player && ev.reasonPlayer === ctx.opp && (ev.amount ?? 0) > 0 && ctx.field('me').length === 0,
      condition: (ctx) => ctx.canSummonSelf() && ctx.canSummonCard(ctx.self),
      resolve: async (ctx) => {
        if (ctx.self.location !== 'hand') return;
        const r = await ctx.specialSummon(ctx.self, { pos: 'choose' });
        if (!r.length) return;
        const ev = ctx.event!;
        const amount = ev.amount ?? 0;
        if (ev.reason === 'battle') {
          if (ctx.freeMZones() <= 0 || !ctx.canSpecialSummon()) return;
          const i = await ctx.option('Emissary of Darkness Token position?', ['Attack Position', 'Defense Position'], (k) =>
            (k === 0) === ctx.isMyTurn ? 1 : 0,
          );
          const toks = await ctx.createTokens(emissaryToken, 1, i === 0 ? 'atk' : 'def');
          for (const t of toks) {
            t.flags.baseAtk = amount;
            t.flags.baseDef = amount;
          }
          ctx.game.update();
        } else {
          await ctx.recover(ctx.player, amount);
        }
      },
    },
  ],
});

monster('Tragoedia', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 10,
  atk: 0,
  def: 0,
  text: 'When you take battle damage: You can Special Summon this card from your hand. Gains 600 ATK/DEF for each card in your hand. Once per turn: You can send 1 monster from your hand to the GY, then target 1 face-up monster your opponent controls with the same Level; take control of it. Once per turn: You can target 1 monster in your GY; this card becomes that monster\'s Level until the End Phase.',
  aiValue: 1000,
  effects: [
    {
      kind: 'trigger',
      event: 'battleDamage',
      range: ['hand'],
      label: 'Special Summon Tragoedia',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.player === ctx.player && (ev.amount ?? 0) > 0,
      condition: (ctx) => ctx.canSummonSelf() && ctx.canSummonCard(ctx.self),
      resolve: async (ctx) => {
        if (ctx.self.location === 'hand') await ctx.specialSummon(ctx.self, { pos: 'choose' });
      },
    },
    {
      kind: 'continuous',
      mods: [
        { q: 'atk', value: (ctx) => 600 * ctx.hand('me').length },
        { q: 'def', value: (ctx) => 600 * ctx.hand('me').length },
      ],
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Send monster: take control',
      categories: ['control'],
      canActivate: (ctx) => {
        if (ctx.freeMZones() <= 0) return false;
        const lv = new Set(ctx.hand('me', (c) => c.isMonster).map((c) => c.data.level ?? 0));
        return ctx.faceUpMonsters('opp', (t) => ctx.canTarget(t) && lv.has(ctx.level(t))).length > 0;
      },
      activate: async (ctx) => {
        const targets = ctx.faceUpMonsters('opp', (t) => ctx.canTarget(t));
        // any matching target counts (a Token's value can be negative)
        const best = (lv: number) => Math.max(-Infinity, ...targets.filter((t) => ctx.level(t) === lv).map((t) => cardValue(ctx.game, t)));
        const costs = ctx.hand('me', (c) => c.isMonster && targets.some((t) => ctx.level(t) === (c.data.level ?? 0)));
        const cost = await ctx.select(costs, 1, 1, 'Send 1 monster from your hand to the GY.', 'cost', {
          aiScore: (c) => best(c.data.level ?? 0) - cardValue(ctx.game, c) / 2,
        });
        if (!cost.length) return false;
        const lv = cost[0].data.level ?? 0;
        await ctx.sendToGrave(cost, 'cost');
        await ctx.selectTargets(targets.filter((t) => ctx.level(t) === lv), 1, 1, `Target 1 face-up Level ${lv} monster to take control of.`, 'control');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp && c.controller === ctx.opp);
        if (t.length) await ctx.takeControl(t[0], false);
      },
      ai: {
        score: (ctx) => {
          const lv = new Set(ctx.hand('me', (c) => c.isMonster).map((c) => c.data.level ?? 0));
          const ts = ctx.faceUpMonsters('opp', (t) => ctx.canTarget(t) && lv.has(ctx.level(t)));
          const b = bestTarget(ctx.game, ts);
          return b && cardValue(ctx.game, b) >= 1200 ? 55 + cardValue(ctx.game, b) / 100 : 0;
        },
      },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Copy a Level',
      categories: [],
      canActivate: (ctx) => ctx.grave('me', (c) => c.isMonster && (c.data.level ?? 0) > 0).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => c.isMonster && (c.data.level ?? 0) > 0), 1, 1, 'Target 1 monster in your GY to copy its Level.', 'generic');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave')[0];
        if (!t || ctx.self.location !== 'mzone' || !ctx.self.faceUp) return;
        const diff = (t.data.level ?? 0) - ctx.level(ctx.self);
        if (diff) ctx.addTempMod(ctx.self, 'level', diff, 'turn');
      },
      ai: { score: () => 0 },
    },
  ],
});

monster('Battle Fader', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 1,
  atk: 0,
  def: 0,
  text: 'When an opponent\'s monster declares a direct attack: You can Special Summon this card from your hand, then end the Battle Phase. If this card Summoned this way would leave the field, banish it.',
  aiValue: 600,
  effects: [
    {
      kind: 'quick',
      range: ['hand'],
      event: 'attackDeclared',
      label: 'Special Summon & end Battle Phase',
      categories: ['specialSummon', 'negateAttack'],
      eventFilter: (ctx, ev) => evC(ev)?.controller === ctx.opp && !ev.other,
      condition: (ctx) =>
        !!ctx.battle && !ctx.battle.target && !ctx.battle.inDamageStep && !attackFinished(ctx.game) && ctx.canSummonSelf() && ctx.canSummonCard(ctx.self),
      resolve: async (ctx) => {
        if (ctx.self.location !== 'hand') return;
        const r = await ctx.specialSummon(ctx.self, { pos: 'def' });
        if (!r.length) return;
        ctx.self.banishOnLeave = true;
        endBattlePhase(ctx);
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b) return 0;
          return ctx.atk(b.attacker) >= 800 || ctx.lp <= ctx.atk(b.attacker) ? 85 : 0;
        },
      },
    },
  ],
});

monster('Marshmallon', {
  attribute: 'LIGHT',
  race: 'Fairy',
  level: 3,
  atk: 300,
  def: 500,
  text: 'Cannot be destroyed by battle. After damage calculation, if this card was attacked while face-down: Inflict 1000 damage to the attacking player.',
  aiValue: 700,
  effects: [
    { kind: 'continuous', mods: [{ q: 'indestructibleBattle' }] },
    {
      kind: 'trigger',
      event: ['flipped', 'damageStepEnd'],
      mandatory: true,
      label: '1000 damage',
      categories: ['damage'],
      eventFilter: (ctx, ev) => {
        const me = ctx.self;
        if (ev.type === 'flipped') {
          // Record that this card was flipped by being attacked (start of the Damage Step).
          if (ev.card === me && ctx.battle?.target === me && ctx.battle.inDamageStep) me.flags.marshFlippedTurn = ctx.turn;
          return false;
        }
        return ev.other === me && me.location === 'mzone' && me.flags.marshFlippedTurn === ctx.turn;
      },
      resolve: async (ctx) => {
        ctx.self.flags.marshFlippedTurn = undefined;
        const attackerCtrl = (ctx.event?.player ?? ctx.opp) as PlayerId;
        await ctx.damage(attackerCtrl, 1000);
      },
    },
  ],
});

monster('Breaker the Magical Warrior', {
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 4,
  atk: 1600,
  def: 1000,
  text: 'When this card is Normal Summoned: Place 1 Spell Counter on it (max. 1). Gains 300 ATK for each Spell Counter on it. You can remove 1 Spell Counter from this card, then target 1 Spell/Trap on the field; destroy that target.',
  aiValue: 900,
  effects: [
    {
      kind: 'trigger',
      event: 'normalSummoned',
      mandatory: true,
      label: 'Place Spell Counter',
      categories: ['atkChange'],
      resolve: async (ctx) => {
        if (ctx.self.location === 'mzone' && ctx.self.faceUp) ctx.self.counters.spell = 1;
        ctx.game.update();
      },
    },
    { kind: 'continuous', mods: [{ q: 'atk', value: (ctx) => 300 * (ctx.self.counters.spell ?? 0) }] },
    {
      kind: 'ignition',
      label: 'Remove counter: destroy S/T',
      categories: ['destroy'],
      canActivate: (ctx) => (ctx.self.counters.spell ?? 0) > 0 && ctx.spellTraps('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        ctx.self.counters.spell = Math.max(0, (ctx.self.counters.spell ?? 0) - 1);
        await ctx.selectTargets(ctx.spellTraps('both'), 1, 1, 'Target 1 Spell/Trap to destroy.', 'destroy');
      },
      resolve: destroyTargets,
      ai: { score: (ctx) => (ctx.spellTraps('opp').length ? 50 + 5 * ctx.spellTraps('opp', (c) => !c.faceUp).length : 0) },
    },
  ],
});

monster('Exiled Force', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 4,
  atk: 1000,
  def: 1000,
  text: 'You can Tribute this card, then target 1 monster on the field; destroy that target.',
  aiValue: 700,
  effects: [
    {
      kind: 'ignition',
      label: 'Tribute: destroy monster',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.monsters('both', (c) => c !== ctx.self && ctx.canTarget(c)).length > 0 && !ctx.query(ctx.self, 'cannotBeTributed'),
      activate: async (ctx) => {
        const t = await ctx.selectTargets(ctx.monsters('both', (c) => c !== ctx.self), 1, 1, 'Target 1 monster to destroy.', 'destroy');
        if (!t.length) return false;
        await tributeSelf(ctx);
      },
      resolve: destroyTargets,
      ai: {
        score: (ctx) => {
          const b = bestTarget(ctx.game, ctx.monsters('opp', (c) => ctx.canTarget(c)));
          const v = b ? cardValue(ctx.game, b) : 0;
          return v >= 1800 ? 45 + v / 100 : 0;
        },
      },
    },
  ],
});

monster('D.D. Warrior Lady', {
  attribute: 'LIGHT',
  race: 'Warrior',
  level: 4,
  atk: 1500,
  def: 1600,
  text: "After damage calculation, if this card battled an opponent's monster: You can banish that monster, and also banish this card.",
  aiValue: 700,
  effects: [
    {
      // "After damage calculation": resolves before battle-destroyed monsters leave the field, so a monster that
      // would be destroyed is banished instead and its "sent to the GY" effects never happen.
      kind: 'trigger',
      event: 'damageCalculated',
      label: 'Banish both',
      categories: ['banish'],
      eventFilter: (ctx, ev) => {
        const me = ctx.self;
        const opp = ev.card === me ? evO(ev) : ev.other === me ? evC(ev) : undefined;
        return !!opp && me.location === 'mzone' && opp.location === 'mzone' && opp.controller !== me.controller;
      },
      resolve: async (ctx) => {
        const ev = ctx.event!;
        const me = ctx.self;
        const opp = ev.card === me ? evO(ev) : evC(ev);
        const list: CardInstance[] = [];
        if (opp && opp.location === 'mzone') list.push(opp);
        if (me.location === 'mzone') list.push(me);
        if (list.length) await ctx.banish(list);
      },
      ai: {
        score: (ctx) => {
          const ev = ctx.event!;
          const opp = ev.card === ctx.self ? evO(ev) : evC(ev);
          if (!opp) return 0;
          // Lady loses the battle anyway: always take the other monster with her.
          if (ctx.game.battle?.calc?.losers.includes(ctx.self)) return 1;
          return cardValue(ctx.game, opp) >= cardValue(ctx.game, ctx.self) ? 1 : 0;
        },
      },
    },
  ],
});

monster('Snipe Hunter', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 4,
  atk: 1500,
  def: 600,
  text: 'You can discard 1 card, then target 1 card on the field; roll a six-sided die, and destroy that target unless the result is 1 or 6.',
  aiValue: 600,
  effects: [
    {
      kind: 'ignition',
      label: 'Discard: roll to destroy',
      categories: ['destroy', 'discard'],
      canActivate: (ctx) => ctx.hand().length > 0 && ctx.field('both', (c) => c !== ctx.self && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const d = await ctx.select(ctx.hand(), 1, 1, 'Discard 1 card.', 'discard');
        if (!d.length) return false;
        await ctx.discard(d, 'cost');
        await ctx.selectTargets(ctx.field('both', (c) => c !== ctx.self), 1, 1, 'Target 1 card on the field.', 'destroy');
      },
      resolve: async (ctx) => {
        const roll = ctx.game.rng.int(6) + 1;
        ctx.log(`Snipe Hunter rolls a ${roll}.`);
        if (roll === 1 || roll === 6) return;
        await destroyTargets(ctx);
      },
      ai: {
        score: (ctx) => {
          if (ctx.hand().length < 2) return 0;
          const b = bestTarget(ctx.game, ctx.field('opp', (c) => ctx.canTarget(c)));
          return b && cardValue(ctx.game, b) >= 1500 ? 38 : 0;
        },
      },
    },
  ],
});

monster('Chaos Sorcerer', {
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 6,
  atk: 2300,
  def: 2000,
  text: 'Cannot be Normal Summoned/Set. Must be Special Summoned (from your hand) by banishing 1 LIGHT and 1 DARK monster from your GY. Once per turn: You can target 1 face-up monster on the field; banish that target. This card cannot attack the turn you activate this effect.',
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 1200,
  effects: [
    envoyProc(),
    {
      kind: 'ignition',
      opt: true,
      label: 'Banish 1 face-up monster',
      categories: ['banish'],
      condition: (ctx) => ctx.self.attacksThisTurn === 0,
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => c !== ctx.self && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('both', (c) => c !== ctx.self), 1, 1, 'Target 1 face-up monster to banish.', 'banish');
        ctx.self.flags.cannotAttackTurn = ctx.turn;
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp);
        if (t.length) await ctx.banish(t);
      },
      ai: {
        score: (ctx) => {
          const b = bestTarget(ctx.game, ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)));
          return b && cardValue(ctx.game, b) >= 1400 ? 55 + cardValue(ctx.game, b) / 100 : 0;
        },
      },
    },
  ],
});

monster('Jinzo', {
  attribute: 'DARK',
  race: 'Machine',
  level: 6,
  atk: 2400,
  def: 1500,
  text: 'Trap Cards cannot be activated. Negate all Trap effects on the field.',
  aiValue: 1000,
  effects: [
    {
      kind: 'continuous',
      mods: [
        { q: 'cannotActivateTraps', to: 'players' },
        { q: 'negated', to: 'cards', filter: (_ctx, c: CardInstance) => c.isTrap && c.onField && c.faceUp },
      ],
    },
  ],
});

monster('Rescue Cat', {
  attribute: 'EARTH',
  race: 'Beast',
  level: 4,
  atk: 300,
  def: 100,
  text: 'You can send this face-up card to the Graveyard to Special Summon 2 Level 3 or lower Beast-Type monsters from your Deck. Those monsters are destroyed during the End Phase.',
  aiValue: 800,
  effects: [
    {
      kind: 'ignition',
      label: 'Send: summon 2 Beasts',
      categories: ['specialSummon'],
      // https://edisonrul.ing/cards/r/rescue-cat.html — it Special Summons 2 monsters at once: it cannot be activated to
      // Summon only 1 (2 eligible Beasts and 2 free zones, counting the one Rescue Cat frees), and a Summoned monster
      // that is flipped face-down is not destroyed in the End Phase.
      canActivate: (ctx) =>
        !ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon') &&
        ctx.freeMZones() + 1 >= 2 &&
        ctx.deck('me', (c) => c.isMonster && c.data.race === 'Beast' && (c.data.level ?? 0) <= 3 && !c.data.nomi && ctx.canSummonCard(c)).length >= 2,
      activate: async (ctx) => {
        await ctx.sendToGrave(ctx.self, 'cost');
      },
      resolve: async (ctx) => {
        const cands = ctx.deck('me', (c) => c.isMonster && c.data.race === 'Beast' && (c.data.level ?? 0) <= 3 && !c.data.nomi && ctx.canSummonCard(c));
        if (ctx.freeMZones() < 2 || cands.length < 2 || !ctx.canSpecialSummon()) return;
        const sel = await ctx.select(cands, 2, 2, 'Special Summon 2 Level 3 or lower Beast monsters.', 'specialSummon');
        const r = await ctx.specialSummon(sel, { pos: 'choose' });
        ctx.game.shuffleDeck(ctx.player);
        for (const m of r) {
          const id = m.moveId;
          const fid = m.faceUpId;
          ctx.later('end', async () => {
            if (m.location === 'mzone' && m.moveId === id && m.faceUpId === fid && m.faceUp) await ctx.game.destroy([m], 'effect', ctx.player, ctx.self);
          });
        }
      },
      ai: {
        score: (ctx) => {
          const n = ctx.deck('me', (c) => c.isMonster && c.data.race === 'Beast' && (c.data.level ?? 0) <= 3).length;
          return n >= 1 && ctx.freeMZones() >= 1 ? 40 + 5 * Math.min(2, n) : 0;
        },
      },
    },
  ],
});

monster('Marauding Captain', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 3,
  atk: 1200,
  def: 400,
  text: 'When this card is Normal Summoned: You can Special Summon 1 Level 4 or lower monster from your hand. Your opponent cannot target other Warrior monsters you control for attacks.',
  aiValue: 700,
  effects: [
    {
      kind: 'trigger',
      event: 'normalSummoned',
      when: true,
      label: 'Special Summon from hand',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.canSpecialSummon() && ctx.hand('me', (c) => c.isMonster && (c.data.level ?? 0) <= 4 && ctx.canSummonCard(c)).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.hand('me', (c) => c.isMonster && (c.data.level ?? 0) <= 4 && ctx.canSummonCard(c));
        const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 Level 4 or lower monster from your hand.', 'specialSummon');
        if (sel.length) await ctx.specialSummon(sel[0], { pos: 'choose' });
      },
    },
    {
      kind: 'continuous',
      mods: [
        {
          q: 'cannotBeAttacked',
          to: 'cards',
          filter: (ctx, c: CardInstance) => c !== ctx.self && c.location === 'mzone' && c.faceUp && c.controller === ctx.player && c.data.race === 'Warrior',
        },
      ],
    },
  ],
});

monster('Night Assailant', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 3,
  atk: 200,
  def: 500,
  types: ['flip'],
  text: 'FLIP: Target 1 monster your opponent controls; destroy that target. When this card is sent from your hand to the GY: Target 1 Flip monster in your GY, except "Night Assailant"; add that target to your hand.',
  aiValue: 800,
  effects: [
    flip({
      categories: ['destroy'],
      canActivate: (ctx) => ctx.monsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.monsters('opp'), 1, 1, 'Target 1 monster your opponent controls to destroy.', 'destroy');
      },
      resolve: destroyTargets,
    }),
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'Add Flip monster',
      categories: ['toHand'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'hand',
      canActivate: (ctx) => ctx.grave('me', (c) => c.hasType('flip') && c.name !== 'Night Assailant').length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => c.hasType('flip') && c.name !== 'Night Assailant'), 1, 1, 'Target 1 Flip monster in your GY.', 'toHand');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.toHand(t);
      },
    },
  ],
});

monster('Magician of Faith', {
  attribute: 'LIGHT',
  race: 'Spellcaster',
  level: 1,
  atk: 300,
  def: 400,
  types: ['flip'],
  text: 'FLIP: Target 1 Spell in your GY; add that target to your hand.',
  aiValue: 800,
  effects: [
    flip({
      categories: ['toHand'],
      canActivate: (ctx) => ctx.grave('me', (c) => c.isSpell).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => c.isSpell), 1, 1, 'Target 1 Spell in your GY.', 'toHand', {
          aiScore: (c) => (c.data.aiValue ?? 0) + (c.data.limit === 1 ? 1000 : 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.toHand(t);
      },
    }),
  ],
});

monster('Neo-Spacian Grand Mole', {
  attribute: 'EARTH',
  race: 'Rock',
  level: 3,
  atk: 900,
  def: 300,
  text: "At the start of the Damage Step, if this card battles an opponent's monster: You can return that monster to the hand, and also return this card to the hand.",
  aiValue: 900,
  effects: [
    {
      // Approximated as a Damage Step quick effect before damage calculation (no "start of Damage Step" event).
      kind: 'quick',
      damageStep: true,
      label: 'Bounce both',
      categories: ['toHand'],
      condition: (ctx) => {
        const b = ctx.battle;
        if (!b || !b.inDamageStep || b.negated) return false;
        const opp = battleOpponent(ctx);
        return !!opp && opp.location === 'mzone' && opp.controller === ctx.opp;
      },
      activate: async (ctx) => {
        ctx.data.opp = battleOpponent(ctx);
        ctx.data.oppMove = (ctx.data.opp as CardInstance).moveId;
      },
      resolve: async (ctx) => {
        const opp = ctx.data.opp as CardInstance;
        const list: CardInstance[] = [];
        if (opp.location === 'mzone' && opp.moveId === ctx.data.oppMove) list.push(opp);
        if (ctx.self.location === 'mzone') list.push(ctx.self);
        if (list.length) await ctx.toHand(list);
      },
      ai: {
        score: (ctx) => {
          const opp = battleOpponent(ctx);
          if (!opp) return 0;
          return cardValue(ctx.game, opp) >= 1300 || opp.isExtra || opp.isToken ? 80 : 0;
        },
      },
    },
  ],
});

monster('Twin-Headed Behemoth', {
  attribute: 'WIND',
  race: 'Dragon',
  level: 3,
  atk: 1500,
  def: 1200,
  text: 'When this card is destroyed and sent to the GY: You can Special Summon it during the End Phase of this turn; its ATK/DEF become 1000. You can only use this effect of "Twin-Headed Behemoth" once per Duel.',
  aiValue: 400,
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      label: 'Revive in End Phase',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && reasonsOf(ev).includes('destroy') && !duelUsed(ctx.game, `behemoth:${ctx.self.uid}`),
      resolve: async (ctx) => {
        markDuel(ctx.game, `behemoth:${ctx.self.uid}`);
        const me = ctx.self;
        const id = me.moveId;
        const revive = async () => {
          if (me.location !== 'grave' || me.moveId !== id || !ctx.canSpecialSummon()) return;
          const r = await ctx.specialSummon(me, { pos: 'choose' });
          if (r.length) {
            me.flags.baseAtk = 1000;
            me.flags.baseDef = 1000;
            ctx.game.update();
          }
        };
        if (ctx.phase === 'end') await revive();
        else ctx.later('end', revive);
      },
    },
  ],
});

monster('Banisher of the Radiance', {
  attribute: 'LIGHT',
  race: 'Fairy',
  level: 3,
  atk: 1600,
  def: 0,
  text: 'Any card sent to the GY is banished instead.',
  aiValue: 400,
  effects: [{ kind: 'continuous', mods: [{ q: 'banishInsteadOfGrave', to: 'players' }] }],
});

monster('Doomcaliber Knight', {
  attribute: 'DARK',
  race: 'Fiend', // printed Type (YGOJSON), was Warrior
  level: 4,
  atk: 1900,
  def: 1800,
  // "Cannot be Special Summoned": blocked from every location (it has no Summon procedure).
  noSpecialFrom: ['hand', 'deck', 'grave', 'banished'],
  text: 'Cannot be Special Summoned. During either player\'s turn, when a monster effect is activated: You can Tribute this face-up card; negate the activation, and if you do, destroy that monster.',
  aiValue: 700,
  effects: [
    {
      kind: 'quick',
      label: 'Tribute: negate monster effect',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && !l.negated && l.card.isMonster && !l.isCardActivation && l.card !== ctx.self;
      },
      canActivate: (ctx) => !ctx.query(ctx.self, 'cannotBeTributed'),
      activate: async (ctx) => {
        ctx.data.link = ctx.prevLink();
        await tributeSelf(ctx);
      },
      resolve: async (ctx) => {
        await ctx.negateAndDestroy(ctx.data.link as ChainLink);
      },
      ai: {
        score: (ctx) => {
          const l = ctx.prevLink();
          if (!l || l.player !== ctx.opp) return 0;
          const cats = l.effect.categories ?? [];
          if (cats.some((c) => ['destroy', 'destroyMulti', 'banish', 'control', 'specialSummon', 'search', 'draw', 'negate'].includes(c))) return 60;
          return cardValue(ctx.game, l.card) >= 2000 ? 45 : 0;
        },
      },
    },
  ],
});

monster('D.D. Assailant', {
  attribute: 'DARK',
  race: 'Warrior',
  level: 4,
  atk: 1700,
  def: 1600,
  text: "When this card is destroyed by battle with an opponent's attacking monster: Banish that attacking monster, and also banish this card.",
  aiValue: 500,
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Banish attacker',
      categories: ['banish'],
      eventFilter: (ctx, ev) => {
        const o = evO(ev);
        return ev.card === ctx.self && !!o && ctx.battle?.attacker === o && o !== ctx.self;
      },
      resolve: async (ctx) => {
        const o = evO(ctx.event!)!;
        const list: CardInstance[] = [];
        if (o.location === 'mzone' || o.location === 'grave') list.push(o);
        if (ctx.self.location === 'grave') list.push(ctx.self);
        if (list.length) await ctx.banish(list);
      },
    },
  ],
});

monster('Thunder King Rai-Oh', {
  attribute: 'LIGHT',
  race: 'Thunder',
  level: 4,
  atk: 1900,
  def: 800,
  text: 'Neither player can add cards from their Deck to their hand except by drawing them. When your opponent would Special Summon exactly 1 monster: You can send this face-up card to the GY; negate the Special Summon, and if you do, destroy it.',
  aiValue: 900,
  effects: [
    { kind: 'continuous', mods: [{ q: 'cannotAddFromDeck', to: 'players' }] },
    {
      kind: 'quick',
      label: 'Send: negate Special Summon',
      negateSummon: true,
      categories: ['negateSummon'],
      condition: (ctx) => {
        const ps = ctx.game.pendingSummon;
        return !!ps && ps.player === ctx.opp && ps.cards.length === 1 && !['normal', 'tribute', 'flip'].includes(ps.method);
      },
      activate: async (ctx) => {
        await ctx.sendToGrave(ctx.self, 'cost');
      },
      resolve: async (ctx) => {
        ctx.game.negatePendingSummon();
      },
      ai: {
        score: (ctx) => {
          const ps = ctx.game.pendingSummon;
          if (!ps) return 0;
          const v = Math.max(0, ...ps.cards.map((c) => cardValue(ctx.game, c)));
          return v >= 2200 ? 60 + v / 100 : 0;
        },
      },
    },
  ],
});

const RACES: Race[] = [
  'Aqua', 'Beast', 'Beast-Warrior', 'Dinosaur', 'Dragon', 'Fairy', 'Fiend', 'Fish', 'Insect', 'Machine', 'Plant',
  'Psychic', 'Pyro', 'Reptile', 'Rock', 'Sea Serpent', 'Spellcaster', 'Thunder', 'Warrior', 'Winged Beast', 'Zombie',
];
/** Value difference (opponent - mine) of destroying every face-up monster of a Type. */
function raceSwing(ctx: Ctx, r: Race) {
  const g = ctx.game;
  const opp = ctx.faceUpMonsters('opp', (c) => c.data.race === r).reduce((a, c) => a + cardValue(g, c), 0);
  const mine = ctx.faceUpMonsters('me', (c) => c.data.race === r).reduce((a, c) => a + cardValue(g, c), 0);
  return opp - mine;
}

monster('Tribe-Infecting Virus', {
  attribute: 'WATER',
  race: 'Aqua',
  level: 4,
  atk: 1600,
  def: 1000,
  text: 'You can discard 1 card and declare 1 Monster Type; destroy all face-up monsters of the declared Type on the field.',
  aiValue: 800,
  effects: [
    {
      kind: 'ignition',
      label: 'Discard: destroy a Type',
      categories: ['destroy', 'destroyMulti', 'discard'],
      canActivate: (ctx) => ctx.hand().length > 0,
      activate: async (ctx) => {
        const d = await ctx.select(ctx.hand(), 1, 1, 'Discard 1 card.', 'discard');
        if (!d.length) return false;
        await ctx.discard(d, 'cost');
        const i = await ctx.option('Declare a Monster Type.', RACES, (k) => raceSwing(ctx, RACES[k]));
        ctx.data.race = RACES[i];
        ctx.log(`Declares ${RACES[i]}.`);
      },
      resolve: async (ctx) => {
        await ctx.destroy(ctx.faceUpMonsters('both', (c) => c.data.race === ctx.data.race));
      },
      ai: {
        score: (ctx) => {
          if (!ctx.hand().length) return 0;
          const best = Math.max(...RACES.map((r) => raceSwing(ctx, r)));
          return best >= 1500 ? 45 + best / 200 : 0;
        },
      },
    },
  ],
});

monster('Tsukuyomi', {
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 4,
  atk: 1100,
  def: 1400,
  types: ['spirit'],
  text: 'Cannot be Special Summoned. During the End Phase of the turn this card is Normal Summoned or flipped face-up: Return it to the hand. When this card is Normal Summoned or flipped face-up: Target 1 face-up monster on the field; change that target to face-down Defense Position.',
  nomi: true,
  aiValue: 800,
  effects: [
    spiritReturn,
    {
      kind: 'trigger',
      event: ['normalSummoned', 'flipped'],
      mandatory: true,
      label: 'Flip a monster face-down',
      categories: ['position'],
      eventFilter: (ctx, ev) => {
        markSpirit(ctx, ev);
        return ev.card === ctx.self && ctx.self.location === 'mzone';
      },
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('both'), 1, 1, 'Target 1 face-up monster to change to face-down Defense Position.', 'position', {
          aiScore: (c) => (c.controller === ctx.opp ? cardValue(ctx.game, c) : c === ctx.self ? 0 : -5000),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp);
        if (t.length) await ctx.changePos(t[0], 'def', false);
      },
    },
  ],
});

monster('Kycoo the Ghost Destroyer', {
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 4,
  atk: 1800,
  def: 700,
  text: "When this card inflicts battle damage to your opponent: You can banish up to 2 monsters from your opponent's GY. Your opponent cannot banish cards from either GY.",
  aiValue: 500,
  effects: [
    {
      kind: 'trigger',
      event: 'battleDamage',
      label: "Banish from opponent's GY",
      categories: ['banish'],
      eventFilter: (ctx, ev) => ev.reasonCard === ctx.self && ev.player === ctx.opp,
      condition: (ctx) => ctx.grave('opp', (c) => c.isMonster).length > 0,
      resolve: async (ctx) => {
        const sel = await ctx.select(ctx.grave('opp', (c) => c.isMonster), 1, 2, "Banish up to 2 monsters from your opponent's GY.", 'banish', {
          aiScore: (c) => (c.data.aiValue ?? 0) + (c.data.atk ?? 0) + (c.data.attribute === 'DARK' || c.data.attribute === 'LIGHT' ? 500 : 0),
        });
        if (sel.length) await ctx.banish(sel);
      },
    },
    {
      // "Your opponent cannot banish cards from either GY."
      kind: 'continuous',
      mods: [{ q: 'cannotBanishFromGY', to: 'players', filter: (ctx, p) => p === ctx.opp }],
    },
  ],
});

monster('Big Shield Gardna', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 4,
  atk: 100,
  def: 2600,
  text: 'While face-down, if a Spell targets only this card: Flip it face-up and negate that activation. If this card is attacked: change it to Attack Position after damage calculation.',
  aiValue: 300,
  effects: [
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      mandatory: true,
      label: 'Change to Attack Position',
      categories: ['position'],
      eventFilter: (ctx, ev) => ev.other === ctx.self && ctx.self.location === 'mzone' && ctx.self.faceUp && ctx.self.pos === 'def',
      resolve: async (ctx) => {
        if (ctx.self.location === 'mzone' && ctx.self.faceUp && ctx.self.pos === 'def') await ctx.changePos(ctx.self, 'atk');
      },
    },
  ],
});

monster('Cyber Valley', {
  attribute: 'LIGHT',
  race: 'Machine',
  level: 1,
  atk: 0,
  def: 0,
  text: 'You can use 1 of the following 3 effects: ● When this card is selected as an attack target by an opponent\'s monster, you can remove this card from play to draw 1 card and end the Battle Phase. ● You can remove from play this card and 1 face-up monster you control, then draw 2 cards. ● You can remove from play this card and 1 card from your hand, and place 1 card from your Graveyard on top of your Deck.',
  aiValue: 600,
  effects: [
    {
      kind: 'trigger',
      event: 'attackDeclared',
      label: 'Banish: draw 1, end Battle',
      categories: ['draw', 'negateAttack'],
      eventFilter: (ctx, ev) => ev.other === ctx.self && ctx.self.location === 'mzone',
      activate: async (ctx) => {
        await ctx.banish(ctx.self, 'cost');
      },
      resolve: async (ctx) => {
        await ctx.draw(1);
        endBattlePhase(ctx);
      },
    },
    {
      kind: 'ignition',
      label: 'Banish 2: draw 2',
      categories: ['draw', 'banish'],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => c !== ctx.self).length > 0,
      activate: async (ctx) => {
        const t = await ctx.selectTargets(ctx.faceUpMonsters('me', (c) => c !== ctx.self), 1, 1, 'Target 1 other face-up monster you control.', 'cost');
        if (!t.length) return false;
        ctx.addTargets([ctx.self]);
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone');
        // 2010 rulings: the other target must still be face-up (Cyber Valley itself may be face-down).
        // https://edisonrul.ing/cards/c/cyber-valley.html
        if (t.length < 2 || t.some((c) => c !== ctx.self && !c.faceUp)) return;
        await ctx.banish(t);
        await ctx.draw(2);
      },
      ai: {
        score: (ctx) => {
          const worst = Math.min(...ctx.faceUpMonsters('me', (c) => c !== ctx.self).map((c) => cardValue(ctx.game, c)));
          return worst <= 1000 ? 50 : 0;
        },
      },
    },
    {
      // 2010 text and rulings: an Ignition Effect of this card on the field that targets 1 card in your GY; this card
      // and 1 card from your hand are banished when it resolves (if this card left the field, nothing happens).
      // https://edisonrul.ing/cards/c/cyber-valley.html
      kind: 'ignition',
      label: 'Banish this and 1 hand card: GY card to top of Deck',
      categories: ['toDeck', 'banish'],
      canActivate: (ctx) => ctx.grave('me', (c) => ctx.canTarget(c)).length > 0 && ctx.hand().length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me'), 1, 1, 'Target 1 card in your GY to place on top of your Deck.', 'toDeck');
      },
      resolve: async (ctx) => {
        if (ctx.self.location !== 'mzone') return;
        const [h] = await ctx.select(ctx.hand(), 1, 1, 'Banish 1 card from your hand.', 'banish', { aiScore: (c) => -cardValue(ctx.game, c) });
        await ctx.banish(h ? [ctx.self, h] : [ctx.self]);
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.toDeck(t, 'top');
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...ctx.grave('me').map((c) => (c.data.aiValue ?? 0) + (c.data.limit === 1 ? 800 : 0)));
          return ctx.hand().length <= 1 && best >= 1000 ? 25 : 0;
        },
      },
    },
  ],
});

monster("Gravekeeper's Spy", {
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 4,
  atk: 1200,
  def: 2000,
  types: ['flip'],
  sets: ['gravekeeper'],
  text: 'FLIP: Special Summon 1 "Gravekeeper\'s" monster with 1500 or less ATK from your Deck.',
  aiValue: 400,
  effects: [
    flip({
      categories: ['specialSummon'],
      condition: (ctx) => ctx.canSpecialSummon(),
      resolve: async (ctx) => {
        const ok = (c: CardInstance) =>
          c.isMonster && (c.inSet('gravekeeper') || c.name.startsWith("Gravekeeper's")) && (c.data.atk ?? 0) <= 1500 && ctx.canSummonCard(c);
        const cands = ctx.deck('me', ok);
        const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 "Gravekeeper\'s" monster with 1500 or less ATK.', 'specialSummon');
        if (sel.length) await ctx.specialSummon(sel[0], { pos: 'choose' });
        ctx.game.shuffleDeck(ctx.player);
      },
    }),
  ],
});

monster('Genex Controller', {
  attribute: 'DARK',
  race: 'Machine',
  level: 3,
  atk: 1400,
  def: 1200,
  types: ['tuner'],
  sets: ['genex'],
  text: 'A compact control unit that links Genex machines into a single network.',
});

monster('Dark Resonator', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 3,
  atk: 1300,
  def: 300,
  types: ['tuner'],
  sets: ['resonator'],
  text: 'Once per turn, this card cannot be destroyed by battle.',
  aiValue: 300,
  effects: [
    {
      kind: 'continuous',
      mods: [{ q: 'indestructibleBattle', value: (ctx) => ctx.self.flags.resonatorUsed !== ctx.turn }],
    },
    {
      // Bookkeeping only: marks the once-per-turn protection as used when it saved this card.
      kind: 'trigger',
      event: 'damageStepEnd',
      label: 'Battle protection used',
      categories: ['protect'],
      eventFilter: (ctx, ev) => {
        const me = ctx.self;
        if (me.location !== 'mzone' || ctx.game.isNegated(me) || me.flags.resonatorUsed === ctx.turn) return false;
        const isAtk = ev.card === me;
        const opp = isAtk ? evO(ev) : ev.other === me ? evC(ev) : undefined;
        if (!opp || opp.location !== 'mzone') return false;
        if (wouldLoseBattle(ctx, me, opp, isAtk)) me.flags.resonatorUsed = ctx.turn;
        return false;
      },
    },
  ],
});

monster('Cyber Phoenix', {
  attribute: 'FIRE',
  race: 'Machine',
  level: 4,
  atk: 1200,
  def: 1600,
  text: 'While this card is in face-up Attack Position, negate the effects of any Spell or Trap Card that targets 1 Machine-Type monster you control. When this face-up card attacks or is attacked, and it is destroyed by battle and sent to the Graveyard, you can draw 1 card.',
  aiValue: 400,
  effects: [
    {
      // Implemented as an instant check when a Spell/Trap is activated (see engine-requests).
      kind: 'trigger',
      event: 'chainActivated',
      label: 'Protect Machine',
      categories: ['negate', 'protect'],
      eventFilter: (ctx, ev) => {
        const me = ctx.self;
        const link = ev.data?.link as ChainLink | undefined;
        if (!link || link.negated || me.location !== 'mzone' || !me.faceUp || me.pos !== 'atk' || ctx.game.isNegated(me)) return false;
        if (!(link.card.isSpell || link.card.isTrap)) return false;
        const t = link.ctx.targets;
        if (t.length !== 1) return false;
        const m = t[0];
        if (m.location === 'mzone' && m.faceUp && m.controller === me.controller && m.data.race === 'Machine') {
          ctx.game.negateLink(link, false, me);
        }
        return false;
      },
    },
    {
      // Optional ("you can draw 1 card"), and only if it was face-up before the attack (not when attacked face-down):
      // https://edisonrul.ing/cards/c/cyber-phoenix.html
      kind: 'trigger',
      event: 'sentToGrave',
      label: 'Draw 1',
      categories: ['draw'],
      eventFilter: (ctx, ev) => {
        if (ev.card !== ctx.self || ev.from !== 'mzone' || !reasonsOf(ev).includes('battle')) return false;
        const b = ctx.battle;
        return !(b && b.target === ctx.self && b.targetFaceDownAtStart);
      },
      resolve: async (ctx) => {
        await ctx.draw(1);
      },
    },
  ],
});

monster('Mystic Swordsman LV2', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 2,
  atk: 900,
  def: 0,
  sets: ['lv', 'mystic-swordsman'],
  text: 'If this card attacks a face-down Defense Position monster: Destroy that monster without flipping it face-up. During the End Phase of a turn this card destroyed a monster by battle: You can send this card to the GY; Special Summon 1 "Mystic Swordsman LV4" from your hand or Deck.',
  aiValue: 300,
  effects: [
    {
      // Real timing is the start of the Damage Step; the attack is then negated to prevent a replay.
      kind: 'trigger',
      event: 'attackDeclared',
      mandatory: true,
      label: 'Destroy face-down monster',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => {
        const t = evO(ev);
        return ev.card === ctx.self && !!t && t.location === 'mzone' && !t.faceUp;
      },
      resolve: async (ctx) => {
        const t = evO(ctx.event!);
        const b = ctx.battle;
        if (!t || !b || b.negated || b.target !== t || t.location !== 'mzone' || t.faceUp) return;
        const r = await ctx.destroy(t);
        if (r.length) ctx.negateAttack();
      },
    },
    {
      kind: 'trigger',
      event: ['battleDestroyed', 'phaseStart'],
      label: 'Level up to LV4',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => {
        if (ev.type === 'battleDestroyed') {
          if (selfDestroysByBattle(ctx, ev)) ctx.self.flags.killTurn = ctx.turn;
          return false;
        }
        return ev.phase === 'end' && ctx.self.location === 'mzone' && ctx.self.flags.killTurn === ctx.turn;
      },
      canActivate: (ctx) => ctx.cards('me', ['hand', 'deck'], (c) => c.name === 'Mystic Swordsman LV4').length > 0,
      activate: async (ctx) => {
        await ctx.sendToGrave(ctx.self, 'cost');
      },
      resolve: async (ctx) => {
        const c = ctx.cards('me', ['hand', 'deck'], (x) => x.name === 'Mystic Swordsman LV4');
        const sel = await ctx.select(c, 1, 1, 'Special Summon "Mystic Swordsman LV4".', 'specialSummon');
        if (sel.length) await ctx.specialSummon(sel[0], { pos: 'choose', proper: true });
        ctx.game.shuffleDeck(ctx.player);
      },
    },
  ],
});

monster('Totem Dragon', {
  attribute: 'EARTH',
  race: 'Dragon',
  level: 2,
  atk: 400,
  def: 200,
  text: 'Can be treated as 2 Tributes for the Tribute Summon of a Dragon monster. Once per turn, during your Standby Phase, if this card is in your GY, all monsters in your GY are Dragons, and you control no monsters: You can Special Summon this card in Attack Position, but banish it when it leaves the field.',
  aiValue: 200,
  effects: [
    // CRMS: "Can be treated as 2 Tributes for the Tribute Summon of a Dragon monster" (ABPF altTribute hook).
    { kind: 'continuous', altTribute: (ctx, summoned, tribute) => tribute === ctx.self && summoned.data.race === 'Dragon' },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['grave'],
      opt: true,
      label: 'Revive',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn,
      condition: (ctx) =>
        ctx.monsters('me').length === 0 && ctx.canSummonSelf() && ctx.grave('me', (c) => c.isMonster).every((c) => c.data.race === 'Dragon'),
      resolve: async (ctx) => {
        if (ctx.self.location !== 'grave' || ctx.monsters('me').length) return;
        const r = await ctx.specialSummon(ctx.self, { pos: 'atk' });
        if (r.length) ctx.self.banishOnLeave = true;
      },
    },
  ],
});

// ------------------------------------------------------------ Forbidden effect monsters

monster('Black Luster Soldier - Envoy of the Beginning', {
  attribute: 'LIGHT',
  race: 'Warrior',
  level: 8,
  atk: 3000,
  def: 2500,
  text: 'Cannot be Normal Summoned/Set. Must be Special Summoned (from your hand) by banishing 1 LIGHT and 1 DARK monster from your GY. Once per turn, you can activate 1 of these effects: ● Target 1 monster on the field; banish it. This card cannot attack the turn you activate this effect. ● If this attacking card destroys an opponent\'s monster by battle: It can make a second attack in a row.',
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 1800,
  effects: [
    envoyProc(),
    {
      kind: 'ignition',
      opt: 'bls-envoy',
      label: 'Banish 1 monster',
      categories: ['banish'],
      condition: (ctx) => ctx.self.attacksThisTurn === 0,
      canActivate: (ctx) => ctx.monsters('both', (c) => c !== ctx.self && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.monsters('both', (c) => c !== ctx.self), 1, 1, 'Target 1 monster to banish.', 'banish');
        ctx.self.flags.cannotAttackTurn = ctx.turn;
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone');
        if (t.length) await ctx.banish(t);
      },
      ai: {
        score: (ctx) => {
          const opp = ctx.monsters('opp', (c) => ctx.canTarget(c));
          const b = bestTarget(ctx.game, opp);
          if (!b) return 0;
          // Prefer attacking if 3000 ATK already wins every battle.
          const beatsAll = opp.every((c) => (c.faceUp ? (c.pos === 'atk' ? ctx.atk(c) : ctx.def(c)) : 1500) < 3000);
          return beatsAll && opp.length <= 1 ? 0 : 55 + cardValue(ctx.game, b) / 100;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      opt: 'bls-envoy',
      label: 'Attack again',
      categories: ['atkChange'],
      eventFilter: (ctx, ev) => selfDestroysByBattle(ctx, ev) && ctx.battle?.attacker === ctx.self && ctx.self.attacksThisTurn === 1,
      resolve: async (ctx) => {
        if (ctx.self.location === 'mzone' && ctx.self.faceUp) ctx.addTempMod(ctx.self, 'extraAttacks', 1, 'turn');
      },
    },
  ],
});

monster('Chaos Emperor Dragon - Envoy of the End', {
  attribute: 'DARK',
  race: 'Dragon',
  level: 8,
  atk: 3000,
  def: 2500,
  text: 'Cannot be Normal Summoned/Set. Must be Special Summoned (from your hand) by banishing 1 LIGHT and 1 DARK monster from your GY. You can pay 1000 LP; send all cards in both players\' hands and on the field to the GY, then inflict 300 damage to your opponent for each card sent to the GY by this effect.',
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 1800,
  effects: [
    envoyProc(),
    {
      kind: 'ignition',
      label: 'Pay 1000: send everything to the GY',
      categories: ['destroyMulti', 'damage', 'toDeck'],
      canActivate: (ctx) => ctx.lp > 1000,
      activate: async (ctx) => {
        await ctx.payLp(1000);
      },
      resolve: async (ctx) => {
        const all = [...ctx.hand('me'), ...ctx.hand('opp'), ...ctx.field('both')];
        const sent = await ctx.sendToGrave(all);
        const n = sent.filter((c) => c.location === 'grave').length;
        await ctx.damage(ctx.opp, 300 * n);
      },
      ai: {
        score: (ctx) => {
          const mine = ctx.hand('me').length + ctx.field('me').length;
          const theirs = ctx.hand('opp').length + ctx.field('opp').length;
          if (300 * (mine + theirs) >= ctx.oppLp) return 100;
          return theirs >= mine + 3 ? 50 : 0;
        },
      },
    },
  ],
});

monster('Dark Magician of Chaos', {
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 8,
  atk: 2800,
  def: 2600,
  text: 'When this card is Normal or Special Summoned: You can target 1 Spell in your GY; add it to your hand during the End Phase. Banish any monster destroyed by battle with this card. If this face-up card would leave the field, banish it instead.',
  aiValue: 1500,
  effects: [
    {
      // Bookkeeping: "If this face-up card would leave the field, banish it instead" (however it got face-up).
      kind: 'trigger',
      event: ['summoned', 'flipped', 'positionChanged'],
      label: 'Banish when leaving the field',
      categories: [],
      eventFilter: (ctx, ev) => {
        if (ev.card === ctx.self && ctx.self.location === 'mzone') ctx.self.banishOnLeave = ctx.self.faceUp;
        return false;
      },
    },
    {
      // "When this card is Normal or Special Summoned" (a Flip Summon does not count).
      kind: 'trigger',
      event: ['normalSummoned', 'specialSummoned'],
      when: true,
      label: 'Recover a Spell (End Phase)',
      categories: ['toHand'],
      eventFilter: (ctx, ev) => {
        if (ev.card !== ctx.self || ctx.self.location !== 'mzone') return false;
        if (ctx.self.faceUp) ctx.self.banishOnLeave = true;
        return true;
      },
      canActivate: (ctx) => ctx.grave('me', (c) => c.isSpell).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => c.isSpell), 1, 1, 'Target 1 Spell in your GY.', 'toHand', {
          aiScore: (c) => (c.data.aiValue ?? 0) + (c.data.limit === 1 ? 1000 : 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave')[0];
        if (!t) return;
        const id = t.moveId;
        ctx.later('end', async () => {
          if (t.location === 'grave' && t.moveId === id) await ctx.toHand(t);
        });
      },
    },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Banish destroyed monster',
      categories: ['banish'],
      eventFilter: (ctx, ev) => ev.other === ctx.self && evC(ev)?.location === 'grave',
      resolve: async (ctx) => {
        const c = evC(ctx.event!);
        if (c && c.location === 'grave') await ctx.banish(c);
      },
    },
  ],
});

monster('Sinister Serpent', {
  attribute: 'WATER',
  race: 'Reptile',
  level: 1,
  atk: 300,
  def: 250,
  text: 'During your Standby Phase, if this card is in your GY: You can add it to your hand.',
  aiValue: 800,
  effects: [
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['grave'],
      label: 'Return to hand',
      categories: ['toHand'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn,
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave') await ctx.toHand(ctx.self);
      },
    },
  ],
});

monster('Witch of the Black Forest', {
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 4,
  atk: 1100,
  def: 1200,
  text: 'If this card is sent from the field to the GY: Add 1 monster with 1500 or less DEF from your Deck to your hand.',
  aiValue: 800,
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'Search',
      categories: ['search'],
      eventFilter: selfFieldToGrave,
      resolve: async (ctx) => {
        await ctx.search((c) => c.isMonster && (c.data.def ?? 0) <= 1500, 1, 'Add 1 monster with 1500 or less DEF to your hand.');
      },
    },
  ],
});

monster('Cyber Jar', {
  attribute: 'DARK',
  race: 'Rock',
  level: 3,
  atk: 900,
  def: 900,
  types: ['flip'],
  text: 'FLIP: Destroy all monsters on the field. Then each player reveals the top 5 cards of their Deck, Special Summons all Level 4 or lower monsters among them, and adds the rest to their hand.',
  aiValue: 600,
  effects: [
    flip({
      categories: ['destroy', 'destroyMulti', 'specialSummon', 'draw'],
      resolve: async (ctx) => {
        await ctx.destroy(ctx.monsters('both'));
        // The turn player Special Summons first, then the opponent: https://edisonrul.ing/cards/c/cyber-jar.html
        const tp = ctx.game.turnPlayer;
        for (const p of [tp, ctx.game.opp(tp)] as PlayerId[]) {
          const deck = ctx.game.players[p].deck;
          const top = deck.slice(Math.max(0, deck.length - 5)).reverse();
          if (!top.length) continue;
          ctx.game.log(`${ctx.game.players[p].name} reveals ${top.map((c) => c.name).join(', ')}.`, 'action', p);
          const mons = top.filter((c) => c.isMonster && !c.isExtra && (c.data.level ?? 0) <= 4 && !c.data.nomi);
          const summoned = mons.length ? await ctx.game.specialSummon(mons, p, { pos: 'choose', reasonCard: ctx.self }) : [];
          const rest = top.filter((c) => !summoned.includes(c) && c.location === 'deck');
          if (rest.length) await ctx.game.toHand(rest, 'effect', ctx.player, ctx.self);
        }
      },
    }),
  ],
});

monster('Fiber Jar', {
  attribute: 'EARTH',
  race: 'Plant',
  level: 3,
  atk: 500,
  def: 500,
  types: ['flip'],
  text: 'FLIP: Shuffle all cards on the field, in both hands and in both GYs into the Decks, then each player draws 5 cards.',
  aiValue: 600,
  effects: [
    flip({
      categories: ['toDeck', 'draw'],
      resolve: async (ctx) => {
        const all = [...ctx.field('both'), ...ctx.hand('me'), ...ctx.hand('opp'), ...ctx.grave('both')];
        await ctx.toDeck(all, 'shuffle');
        ctx.game.shuffleDeck(ctx.player);
        ctx.game.shuffleDeck(ctx.opp);
        await ctx.draw(5, ctx.player);
        await ctx.draw(5, ctx.opp);
      },
    }),
  ],
});

monster('Magical Scientist', {
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 1,
  atk: 300,
  def: 300,
  text: 'Pay 1000 LP: Special Summon 1 Level 6 or lower Fusion Monster from your Extra Deck. It cannot attack directly, and returns to the Extra Deck at the end of the turn.',
  aiValue: 800,
  effects: [
    {
      kind: 'ignition',
      label: 'Pay 1000: Fusion from Extra Deck',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.lp > 1000 && ctx.canSpecialSummon() && fusionFromExtra(ctx, 6).length > 0,
      activate: async (ctx) => {
        await ctx.payLp(1000);
      },
      resolve: async (ctx) => {
        const sel = await ctx.select(fusionFromExtra(ctx, 6), 1, 1, 'Special Summon 1 Level 6 or lower Fusion Monster.', 'specialSummon');
        if (!sel.length) return;
        const r = await ctx.specialSummon(sel[0], { pos: 'choose' });
        for (const m of r) {
          const id = m.moveId;
          ctx.later('end', async () => {
            if (m.location === 'mzone' && m.moveId === id) await ctx.toDeck(m, 'shuffle');
          });
        }
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...fusionFromExtra(ctx, 6).map((c) => c.data.atk ?? 0));
          return ctx.lp > 3000 && best >= 2000 && ctx.monsters('opp').length > 0 ? 45 : 0;
        },
      },
    },
  ],
});

monster('Sacred Phoenix of Nephthys', {
  attribute: 'FIRE',
  race: 'Winged Beast',
  level: 6,
  atk: 2400,
  def: 1600,
  text: 'When this card is destroyed by a card effect and sent to the GY: During the next Standby Phase, Special Summon this card from the GY. When it is Special Summoned this way: Destroy all Spells and Traps on the field.',
  aiValue: 900,
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'Rebirth next Standby Phase',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => {
        const r = reasonsOf(ev);
        return ev.card === ctx.self && ev.from === 'mzone' && r.includes('destroy') && !r.includes('battle');
      },
      resolve: async (ctx) => {
        const me = ctx.self;
        if (me.location !== 'grave') return;
        const id = me.moveId;
        const game = ctx.game;
        ctx.later(
          'standby',
          async () => {
            if (me.location !== 'grave' || me.moveId !== id) return;
            const r = await game.specialSummon([me], me.owner, { pos: 'atk', reasonCard: me });
            if (!r.length) return;
            // Every card in the Spell & Trap Zones (an equipped Union monster is an Equip Spell there).
            const st = game.allFieldCards().filter((c) => c.location === 'szone' || c.location === 'fzone');
            if (st.length) await game.destroy(st, 'effect', me.controller, me);
          },
          1,
        );
      },
    },
  ],
});

monster('Victory Dragon', {
  attribute: 'DARK',
  race: 'Dragon',
  level: 8,
  atk: 2400,
  def: 3000,
  types: ['effect'],
  text: 'Cannot be Special Summoned. Requires 3 Dragon monsters as Tribute to Tribute Summon. If this card attacks directly and reduces your opponent\'s LP to 0, you win the Match.',
  nomi: true,
  effects: [],
});

monster('Yata-Garasu', {
  attribute: 'WIND',
  race: 'Fiend',
  level: 2,
  atk: 200,
  def: 100,
  types: ['spirit'],
  text: 'Cannot be Special Summoned. During the End Phase of the turn this card is Normal Summoned or flipped face-up: Return it to the hand. When this card inflicts battle damage to your opponent: They skip their next Draw Phase.',
  nomi: true,
  aiValue: 900,
  effects: [
    spiritReturn,
    {
      // Bookkeeping: remember Normal Summon / flip for the Spirit return.
      kind: 'trigger',
      event: ['normalSummoned', 'flipped'],
      label: 'Spirit',
      categories: [],
      eventFilter: (ctx, ev) => {
        markSpirit(ctx, ev);
        return false;
      },
    },
    {
      kind: 'trigger',
      event: 'battleDamage',
      mandatory: true,
      label: 'Skip next Draw Phase',
      categories: ['lockdown'],
      eventFilter: (ctx, ev) => ev.reasonCard === ctx.self && ev.player === ctx.opp,
      resolve: async (ctx) => {
        const game = ctx.game;
        const victim = ctx.opp;
        const key = `yata:${victim}`;
        if (game.turnData[key]) return;
        game.turnData[key] = true;
        let mod: (typeof game.playerMods)[number] | undefined;
        // At the start of their next Draw Phase, block the draw; lift it at Standby Phase.
        game.addDelayed(
          'draw',
          async () => {
            if (game.turnPlayer !== victim) return;
            game.addPlayerMod(victim, 'cannotDraw', true, 'turn');
            mod = game.playerMods[game.playerMods.length - 1];
            game.log(`${game.players[victim].name} skips the Draw Phase.`, 'action', victim);
          },
          1,
        );
        game.addDelayed(
          'standby',
          async () => {
            if (mod) game.playerMods = game.playerMods.filter((m) => m !== mod);
          },
          1,
        );
      },
    },
  ],
});

monster('Makyura the Destructor', {
  attribute: 'DARK',
  race: 'Warrior',
  level: 4,
  atk: 1600,
  def: 1200,
  text: 'When this card is destroyed and sent to the GY: You can activate Trap Cards from your hand this turn.',
  aiValue: 300,
  effects: [
    {
      // Engine does not yet support Trap activation from the hand; this records the permission
      // in turnData so an engine hook can honour it (see docs/engine-requests/monsters.md).
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'Traps from hand this turn',
      categories: [],
      eventFilter: (ctx, ev) => ev.card === ctx.self && reasonsOf(ev).includes('destroy'),
      resolve: async (ctx) => {
        ctx.game.turnData[`trapsFromHand:${ctx.player}`] = true;
        ctx.log('Trap Cards can be activated from the hand this turn.');
      },
    },
  ],
});

monster('Cyber-Stein', {
  attribute: 'DARK',
  race: 'Machine',
  level: 2,
  atk: 700,
  def: 500,
  text: 'Pay 5000 LP: Special Summon 1 Fusion Monster from your Extra Deck in Attack Position.',
  aiValue: 600,
  effects: [
    {
      kind: 'ignition',
      label: 'Pay 5000: Fusion from Extra Deck',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.lp > 5000 && ctx.canSpecialSummon() && fusionFromExtra(ctx, 12).length > 0,
      activate: async (ctx) => {
        await ctx.payLp(5000);
      },
      resolve: async (ctx) => {
        const sel = await ctx.select(fusionFromExtra(ctx, 12), 1, 1, 'Special Summon 1 Fusion Monster in Attack Position.', 'specialSummon');
        if (sel.length) await ctx.specialSummon(sel[0], { pos: 'atk' });
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...fusionFromExtra(ctx, 12).map((c) => c.data.atk ?? 0));
          return ctx.lp >= 7000 && best >= 3000 ? 40 : 0;
        },
      },
    },
  ],
});

// ============================================================ VANILLA MONSTERS

normal('Blue-Eyes White Dragon', 'LIGHT', 'Dragon', 8, 3000, 2500, 'A legendary dragon whose white scales gleam with overwhelming destructive power.');
normal('Dark Magician', 'DARK', 'Spellcaster', 7, 2500, 2100, 'The supreme sorcerer, master of the darkest arts of attack and defense.');
normal('Summoned Skull', 'DARK', 'Fiend', 6, 2500, 1200, 'A skeletal fiend that crackles with lightning drawn from the abyss.');
normal('Gemini Elf', 'EARTH', 'Spellcaster', 4, 1900, 900, 'Twin elf sisters who strike in perfect unison.');
normal('Vorse Raider', 'DARK', 'Beast-Warrior', 4, 1900, 1200, 'A savage raider who revels in the chaos of battle.');
normal('Gene-Warped Warwolf', 'EARTH', 'Beast', 4, 2000, 100, 'A wolf twisted by experiments into a beast of pure aggression.');
normal('Luster Dragon', 'WIND', 'Dragon', 4, 1900, 1600, 'A dragon whose sapphire hide scatters light across the battlefield.');
normal('Alexandrite Dragon', 'LIGHT', 'Dragon', 4, 2000, 100, 'Its gem-studded scales were once the treasure of an ancient king.');
normal('Mad Dog of Darkness', 'DARK', 'Beast', 4, 1900, 1400, 'A feral hound born from a failed experiment in the shadows.');
normal('Frostosaurus', 'WATER', 'Dinosaur', 6, 2600, 1700, 'A dinosaur thawed from glacial ice, still sluggish but immensely strong.');
normal('Giant Soldier of Stone', 'EARTH', 'Rock', 3, 1300, 2000, 'A colossal stone sentinel that never yields its post.');
normal('Neo Bug', 'EARTH', 'Insect', 4, 1800, 1700, 'An alien insect that multiplies swiftly and swarms its prey.');
normal('Archfiend Soldier', 'DARK', 'Fiend', 4, 1900, 1500, 'A veteran of the dark realm\'s endless wars, feared by friend and foe.');
normal('Battle Ox', 'EARTH', 'Beast-Warrior', 4, 1700, 1000, 'A bull-headed warrior whose axe cleaves through any guard.');
normal('La Jinn the Mystical Genie of the Lamp', 'DARK', 'Fiend', 4, 1800, 1000, 'A genie bound to its lamp, obedient to whoever rubs it.');
normal('Mechanicalchaser', 'DARK', 'Machine', 4, 1850, 800, 'A relentless war machine armed with blades on every limb.');
normal('Luster Dragon #2', 'WIND', 'Dragon', 6, 2400, 1400, 'A dragon clad in emerald scales that shine with a fierce light.');
normal('Red-Eyes B. Dragon', 'DARK', 'Dragon', 7, 2400, 2000, 'A black dragon of fearsome potential whose eyes burn crimson.');
normal('Celtic Guardian', 'EARTH', 'Warrior', 4, 1400, 1200, 'An elven swordsman sworn to guard the ancient forests.');
normal('Insect Knight', 'EARTH', 'Insect', 4, 1900, 1500, 'An armored insect champion who leads the swarm into battle.');
normal('Sea Serpent Warrior of Darkness', 'WATER', 'Sea Serpent', 4, 1800, 1500, 'A warrior of the deep who rose from the sea to defend its realm.');
normal('7 Colored Fish', 'WATER', 'Fish', 4, 1800, 800, 'A rare fish whose seven-hued scales are said to bring good fortune.');

export const MONSTERS_LOADED = true;
