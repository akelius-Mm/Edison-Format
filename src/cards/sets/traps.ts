// Card definitions: generic Traps (see docs/CARD_ALLOCATION.md, "traps.ts").
import { allCards, token, trap } from '../define';
import { bestTarget, cardValue } from '../helpers';
import type { CardData, CardInstance, QueryKey } from '../../engine/card';
import type { Ctx } from '../../engine/ctx';
import type { ChainLink, Game } from '../../engine/game';
import type { Category, GameEvent, PlayerId } from '../../engine/types';

// ============================================================ shared helpers

const DEFINED: CardData[] = [];
const defTrap = (...a: Parameters<typeof trap>) => {
  const d = trap(...a);
  DEFINED.push(d);
  return d;
};

const evc = (ev: GameEvent) => ev.card as CardInstance;

/** Event filter: an opponent's monster declared an attack (and we are still before the Damage Step). */
const oppAttackEv = (ctx: Ctx, ev: GameEvent) => {
  const a = evc(ev);
  return !!a && a.controller === ctx.opp && !!ctx.battle && ctx.battle.attacker === a && !ctx.battle.inDamageStep;
};
/** Same, plus the attacker must still be on the field and targetable by this card. */
const oppAttackTargetableEv = (ctx: Ctx, ev: GameEvent) => oppAttackEv(ctx, ev) && evc(ev).location === 'mzone' && ctx.canTarget(evc(ev));

/** Lock the attacking monster (from ctx.event) as this card's target. */
async function targetAttacker(ctx: Ctx) {
  const a = ctx.event ? evc(ctx.event) : ctx.battle?.attacker;
  if (!a || a.location !== 'mzone') return false;
  ctx.addTargets([a]);
}

/** Pay a Tribute cost. */
async function tributeCost(ctx: Ctx, cards: CardInstance[]) {
  if (!cards.length) return;
  ctx.game.log(`${ctx.game.players[ctx.player].name} Tributes ${cards.map((c) => c.name).join(', ')}.`, 'action', ctx.player);
  await ctx.game.moveCards(cards, 'grave', { reason: 'tribute', reasons: ['tribute', 'cost'], reasonPlayer: ctx.player, reasonCard: ctx.self });
}
const tributable = (ctx: Ctx, c: CardInstance) => !ctx.query(c, 'cannotBeTributed');

/** Recursion guard for `active` checks of cards whose mods are 'negated' (the engine skips self-negation checks for that key). */
let negGuard = 0;
function selfNotNegated(ctx: Ctx) {
  if (negGuard > 0) return true;
  negGuard++;
  try {
    return !ctx.game.isNegated(ctx.self);
  } finally {
    negGuard--;
  }
}

/** I already have a face-up copy of this card applying. */
const haveActiveCopy = (ctx: Ctx) => ctx.spellTraps('me', (c) => c !== ctx.self && c.name === ctx.self.name && c.faceUp).length > 0;

/** Set a Spell/Trap from hand (used by Dust Tornado). */
async function setFromHand(ctx: Ctx, c: CardInstance) {
  const g = ctx.game;
  if (c.data.stype === 'field') {
    const old = g.players[ctx.player].fzone;
    if (old) await g.moveCards([old], 'grave', { reason: 'rule' });
    g.rawMove(c, 'fzone', { controller: ctx.player, faceUp: false });
  } else {
    if (ctx.freeSZones() <= 0) return;
    g.rawMove(c, 'szone', { controller: ctx.player, faceUp: false });
  }
  c.setTurn = g.turn;
  g.log(`${g.players[ctx.player].name} Sets a card in the Spell & Trap Zone.`, 'action', ctx.player);
  await g.anim({ type: 'move', cards: [{ uid: c.uid, from: 'hand', to: c.location, ctrl: ctx.player }], set: true });
  g.update();
}

/** Skip a player's Draw Phase on a given future turn (Reckless Greed, Time Seal). */
function scheduleSkipDraw(g: Game, p: PlayerId, turnNo: number, source: string) {
  g.addDelayed(
    'draw',
    async () => {
      if (g.turnPlayer !== p) return;
      const mod = { player: p, q: 'cannotDraw' as QueryKey, value: true as number | boolean, until: 'turn' as const, turn: g.turn };
      g.playerMods.push(mod);
      g.log(`${g.players[p].name} skips their Draw Phase (${source}).`, 'action', p);
      g.addDelayed('standby', async () => {
        const i = g.playerMods.indexOf(mod);
        if (i >= 0) g.playerMods.splice(i, 1);
      });
    },
    Math.max(0, turnNo - g.turn),
  );
}
/** Turn numbers of player p's next n turns (not counting the current one). */
function nextTurnsOf(g: Game, p: PlayerId, n: number) {
  const first = g.turnPlayer === p ? g.turn + 2 : g.turn + 1;
  return Array.from({ length: n }, (_, i) => first + 2 * i);
}

// ---------------------------------------------------- engine workarounds
// Dimension Wall (battle damage redirection) and Bad Reaction to Simochi (LP gain -> damage)
// have no engine hook; we wrap the game instance's damage/recover once per game.
// See docs/engine-requests/traps.md.
const PATCHED = new WeakSet<Game>();
function simochiAgainst(g: Game, p: PlayerId): CardInstance | undefined {
  return g.spellTraps(g.opp(p)).find((c) => c.name === 'Bad Reaction to Simochi' && c.faceUp && c.activeOnField && !g.isNegated(c));
}
function patchGame(g: Game) {
  if (PATCHED.has(g)) return;
  PATCHED.add(g);
  const anyG = g as any;
  const origDamage = g.damage.bind(g);
  anyG.damage = async (p: PlayerId, amount: number, kind: 'battle' | 'effect', source?: CardInstance, sourcePlayer?: PlayerId) => {
    const b = g.battle as any;
    if (kind === 'battle' && b && Array.isArray(b.__reflect) && b.__reflect.includes(p)) {
      const q = g.opp(p);
      g.log(`Dimension Wall: the battle damage is inflicted to ${g.players[q].name} instead.`, 'battle', p);
      return origDamage(q, amount, kind, source, p);
    }
    return origDamage(p, amount, kind, source, sourcePlayer);
  };
  const origRecover = g.recover.bind(g);
  // Simochi turns a gain into damage once: if that damage is itself turned back into a gain (Energy-Absorbing
  // Monolith, Rainbow Life, Prime Material Dragon), the player gains the LP. Without this the two replacements
  // called each other until the stack overflowed.
  let converting = 0;
  anyG.recover = async (p: PlayerId, amount: number, source?: CardInstance) => {
    const sim = amount > 0 && !converting ? simochiAgainst(g, p) : undefined;
    if (sim) {
      g.log(`Bad Reaction to Simochi: ${g.players[p].name}'s LP gain becomes damage.`, 'action', sim.controller);
      converting++;
      try {
        await g.damage(p, amount, 'effect', sim, sim.controller);
      } finally {
        converting--;
      }
      return;
    }
    return origRecover(p, amount, source);
  };
}

// ------------------------------------------------------------ AI helpers

const noChain = (ctx: Ctx) => ctx.game.chain.length === 0;
/** Open (no chain, no attack) moment in the given phase of the opponent's turn. */
const oppOpen = (ctx: Ctx, ...phases: string[]) => !ctx.isMyTurn && noChain(ctx) && !ctx.battle && phases.includes(ctx.phase);
/** Open moment in the given phase of my turn. */
const myOpen = (ctx: Ctx, ...phases: string[]) => ctx.isMyTurn && noChain(ctx) && !ctx.battle && phases.includes(ctx.phase);
/** One of my links is already on the chain (don't stack redundant answers). */
const myLinkInChain = (ctx: Ctx) => ctx.game.chain.some((l) => l.player === ctx.player && !l.negated && l.card !== ctx.self);

/** The opponent's link on top of the chain (not negated). */
function oppTop(ctx: Ctx): ChainLink | undefined {
  const l = ctx.chainTop();
  return l && l.player === ctx.opp && !l.negated ? l : undefined;
}

/** How bad a chain link is for me (0 = harmless, 3 = must answer). */
function linkThreat(ctx: Ctx, l: ChainLink): number {
  const cats = l.effect.categories ?? [];
  let s = 0;
  const has = (...c: Category[]) => c.some((x) => cats.includes(x));
  if (has('destroyMulti', 'control', 'negate', 'negateSummon', 'negateAttack')) s = Math.max(s, 3);
  if (l.ctx.targets.some((t) => t.controller === ctx.player && (t.onField || t.location === 'hand'))) s = Math.max(s, 2);
  if (has('specialSummon', 'search', 'draw')) s = Math.max(s, 2);
  if (has('destroy', 'banish', 'lockdown', 'toDeck', 'toHand', 'discard')) s = Math.max(s, 1);
  if (has('damage') && ctx.lp <= 2000) s = Math.max(s, 3);
  return s;
}

interface AttackInfo {
  attacker: CardInstance;
  target: CardInstance | null;
  damage: number;
  loss: number;
  danger: number;
  lethal: boolean;
  /** Further opponent monsters that can still attack this turn. */
  others: number;
}
/** Evaluate the opponent's current attack (null if there is none to answer). */
function oppAttack(ctx: Ctx): AttackInfo | null {
  const b = ctx.battle;
  if (!b || b.inDamageStep || b.negated) return null;
  const a = b.attacker;
  if (a.controller !== ctx.opp || a.location !== 'mzone') return null;
  const g = ctx.game;
  const atk = ctx.atk(a);
  const t = b.target;
  let damage = 0;
  let loss = 0;
  if (!t) damage = atk;
  else if (t.pos === 'atk') {
    const ta = ctx.atk(t);
    if (atk > ta) {
      damage = atk - ta;
      loss = cardValue(g, t);
    } else if (atk === ta && atk > 0) loss = cardValue(g, t) / 2;
  } else if (atk > ctx.def(t)) {
    loss = t.faceUp ? cardValue(g, t) : 1000 + (t.data.aiValue ?? 0);
    if (ctx.query(a, 'piercing')) damage = atk - ctx.def(t);
  }
  if (t && ctx.query(t, 'indestructibleBattle')) loss = 0;
  if (ctx.game.queryPlayer(ctx.player, 'noBattleDamage')) damage = 0;
  const others = ctx.monsters('opp', (m) => m !== a && g.canAttack(m)).length;
  return { attacker: a, target: t, damage, loss, danger: damage + loss, lethal: damage >= ctx.lp, others };
}

/** Opponent monsters summoned since the last action that are still on the field. */
function recentOppSummons(ctx: Ctx) {
  return ctx.game.recentEvents
    .filter((e) => e.type === 'summoned')
    .map(evc)
    .filter((c) => c && c.location === 'mzone' && c.controller === ctx.opp);
}

/** Damage potential of the opponent's monsters that can still attack. */
function oppAttackPotential(ctx: Ctx) {
  return ctx.monsters('opp', (m) => m.faceUp && m.pos === 'atk' && !ctx.query(m, 'cannotAttack')).reduce((a, m) => a + ctx.atk(m), 0);
}

/** Generic score for "remove 1 opponent card" traps (Raigeki Break, Phoenix Wing, CED, Karma Cut). */
function removalScore(ctx: Ctx, cands: CardInstance[], base: number) {
  if (!cands.length) return 0;
  if (myLinkInChain(ctx)) return 0;
  const g = ctx.game;
  const at = oppAttack(ctx);
  if (at && cands.includes(at.attacker)) {
    if (at.danger <= 0) return 0;
    return (at.lethal ? 120 : base) + cardValue(g, at.attacker) / 100;
  }
  const top = oppTop(ctx);
  if (top && top.card.onField && cands.includes(top.card)) {
    const lasting = top.card.data.ttype === 'continuous' || ['continuous', 'equip', 'field'].includes(top.card.data.stype ?? '');
    if (lasting && top.isCardActivation) return base + 15;
  }
  const summoned = recentOppSummons(ctx).filter((c) => cands.includes(c));
  if (!ctx.game.chain.length && summoned.length) {
    const v = Math.max(...summoned.map((c) => cardValue(g, c)));
    if (v >= 2400) return base + v / 200;
  }
  if (oppOpen(ctx, 'end')) {
    const best = bestTarget(g, cands);
    if (best && cardValue(g, best) >= 1800) return 36;
  }
  return 0;
}

// =================================================================== TRAPS

defTrap('Torrential Tribute', 'normal', {
  text: 'When a monster is Summoned: Destroy all monsters on the field.',
  aiValue: 500,
  effects: [
    {
      kind: 'activate',
      event: 'summoned',
      categories: ['destroy', 'destroyMulti'],
      eventFilter: (ctx, ev) => !!evc(ev) && evc(ev).location === 'mzone',
      resolve: async (ctx) => {
        await ctx.destroy(ctx.monsters('both'));
      },
      ai: {
        score: (ctx) => {
          if (myLinkInChain(ctx)) return 0;
          const g = ctx.game;
          const mine = ctx.monsters('me').reduce((a, c) => a + cardValue(g, c), 0);
          const theirs = ctx.monsters('opp').reduce((a, c) => a + cardValue(g, c), 0);
          const diff = theirs - mine;
          return diff >= 1500 ? 45 + diff / 150 : 0;
        },
      },
    },
  ],
});

defTrap('Solemn Warning', 'counter', {
  text: 'When a monster(s) would be Summoned, OR when a card or effect that includes Special Summoning a monster is activated: Pay 2000 LP; negate the Summon or activation, and if you do, destroy that card.',
  aiValue: 600,
  effects: [
    {
      kind: 'activate',
      label: 'Negate Summon',
      negateSummon: true,
      categories: ['negateSummon'],
      condition: (ctx) => !!ctx.game.pendingSummon && ctx.game.pendingSummon.player === ctx.opp && ctx.lp >= 2000,
      activate: async (ctx) => {
        await ctx.payLp(2000);
      },
      resolve: async (ctx) => {
        ctx.game.negatePendingSummon();
      },
      ai: {
        score: (ctx) => {
          if (ctx.lp <= 3000) return 0;
          const cards = ctx.game.pendingSummon?.cards ?? [];
          const v = Math.max(0, ...cards.map((c) => cardValue(ctx.game, c)));
          return v >= 2100 ? 50 + v / 100 : 0;
        },
      },
    },
    {
      kind: 'activate',
      label: 'Negate Special Summon effect',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && !l.negated && l.player === ctx.opp && (l.effect.categories ?? []).includes('specialSummon') && ctx.lp >= 2000;
      },
      activate: async (ctx) => {
        ctx.data.link = ctx.prevLink();
        await ctx.payLp(2000);
      },
      resolve: async (ctx) => {
        await ctx.negateAndDestroy(ctx.data.link as ChainLink);
      },
      ai: { score: (ctx) => (ctx.lp > 3000 && oppTop(ctx) ? 58 : 0) },
    },
  ],
});

defTrap('Dimensional Prison', 'normal', {
  text: "When an opponent's monster declares an attack: Target that attacking monster; banish that target.",
  aiValue: 300,
  effects: [
    {
      kind: 'activate',
      event: 'attackDeclared',
      categories: ['banish'],
      eventFilter: oppAttackTargetableEv,
      activate: targetAttacker,
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone');
        if (!t.length) return;
        ctx.log(`${t[0].name} is banished.`);
        await ctx.banish(t);
      },
      ai: {
        score: (ctx) => {
          const at = oppAttack(ctx);
          if (!at || myLinkInChain(ctx) || at.danger <= 0) return 0;
          return (at.lethal ? 130 : 52) + cardValue(ctx.game, at.attacker) / 100;
        },
      },
    },
  ],
});

defTrap('Trap Dustshoot', 'normal', {
  text: "Activate only if your opponent has 4 or more cards in their hand. Look at their hand, choose 1 Monster Card in it, and shuffle it into their Deck.",
  effects: [
    {
      kind: 'activate',
      categories: ['toDeck'],
      condition: (ctx) => ctx.hand('opp').length >= 4,
      resolve: async (ctx) => {
        const g = ctx.game;
        const hand = ctx.hand('opp');
        if (!hand.length) return;
        for (const c of hand) c.revealedUntil = g.turn;
        g.log(`${g.players[ctx.opp].name}'s hand: ${hand.map((c) => c.name).join(', ')}.`, 'action', ctx.player);
        await g.anim({ type: 'reveal', cards: hand.map((c) => c.uid), player: ctx.opp });
        const mons = hand.filter((c) => c.isMonster);
        if (!mons.length) return;
        const sel = await ctx.select(mons, 1, 1, 'Choose 1 monster to shuffle into the Deck.', 'toDeck');
        if (sel.length) {
          g.log(`${sel[0].name} is shuffled into the Deck.`, 'action', ctx.player);
          await ctx.toDeck(sel, 'shuffle');
        }
      },
      ai: {
        score: (ctx) => {
          if (ctx.hand('opp').length < 4) return 0;
          if (oppOpen(ctx, 'draw', 'standby')) return 38;
          if (myOpen(ctx, 'main1')) return 33;
          return 0;
        },
      },
    },
  ],
});

defTrap('Magic Cylinder', 'normal', {
  text: "When an opponent's monster declares an attack: Target the attacking monster; negate the attack, and if you do, inflict damage to your opponent equal to its ATK.",
  aiValue: 300,
  effects: [
    {
      kind: 'activate',
      event: 'attackDeclared',
      categories: ['negateAttack', 'damage'],
      eventFilter: oppAttackTargetableEv,
      activate: targetAttacker,
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone');
        if (!t.length || !ctx.battle) return;
        const atk = ctx.atk(t[0]);
        ctx.negateAttack();
        await ctx.damage(ctx.opp, atk);
      },
      ai: {
        score: (ctx) => {
          const at = oppAttack(ctx);
          if (!at || myLinkInChain(ctx)) return 0;
          const atk = ctx.atk(at.attacker);
          if (atk >= ctx.oppLp) return 300;
          if (at.lethal) return 130;
          if (at.danger > 0) return 44 + atk / 100;
          return atk >= 1800 ? 36 : 0;
        },
      },
    },
  ],
});

defTrap('Sakuretsu Armor', 'normal', {
  text: 'When an opponent\'s monster declares an attack: Target the attacking monster; destroy that target.',
  effects: [
    {
      kind: 'activate',
      event: 'attackDeclared',
      categories: ['destroy'],
      eventFilter: oppAttackTargetableEv,
      activate: targetAttacker,
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone');
        if (t.length) await ctx.destroy(t);
      },
      ai: {
        score: (ctx) => {
          const at = oppAttack(ctx);
          if (!at || myLinkInChain(ctx) || at.danger <= 0 || ctx.query(at.attacker, 'indestructibleEffect')) return 0;
          return (at.lethal ? 125 : 48) + cardValue(ctx.game, at.attacker) / 100;
        },
      },
    },
  ],
});

defTrap('Compulsory Evacuation Device', 'normal', {
  text: 'Target 1 monster on the field; return that target to the hand.',
  aiValue: 200,
  effects: [
    {
      kind: 'activate',
      categories: ['toHand'],
      canActivate: (ctx) => ctx.monsters('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.monsters('both'), 1, 1, 'Target 1 monster to return to the hand.', 'bounce', {
          aiScore: (c) => (c.controller === ctx.player ? -5000 : cardValue(ctx.game, c) + (c.isExtra ? 1500 : 0) + (c.isToken ? -800 : 0)),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone');
        if (t.length) await ctx.toHand(t);
      },
      ai: {
        score: (ctx) => {
          const cands = ctx.monsters('opp', (c) => ctx.canTarget(c) && !c.isToken);
          const s = removalScore(ctx, cands, 42);
          const extra = recentOppSummons(ctx).filter((c) => c.isExtra && ctx.canTarget(c));
          if (!ctx.game.chain.length && extra.length && !myLinkInChain(ctx)) return Math.max(s, 55);
          const at = oppAttack(ctx);
          if (at && at.attacker.isExtra && at.danger > 0) return Math.max(s, 60);
          return s;
        },
      },
    },
  ],
});

/**
 * Phoenix Wing Wind Blast cannot target a face-up non-Continuous, non-Equip Spell/Trap that was activated (it is on the
 * chain, already "considered destroyed"); a face-up "Swords of Revealing Light" that stays on the field can be targeted.
 */
const pwwbTargetable = (ctx: Ctx) => (c: CardInstance) =>
  !(c.faceUp && (c.isSpell || c.isTrap) && !['continuous', 'equip', 'field'].includes(c.data.stype ?? '') && c.data.ttype !== 'continuous' && ctx.game.chain.some((l) => l.card === c && l.isCardActivation));
defTrap('Phoenix Wing Wind Blast', 'normal', {
  text: 'Discard 1 card. Return 1 card your opponent controls to the top of the Deck.',
  effects: [
    {
      kind: 'activate',
      categories: ['toDeck'],
      // https://edisonrul.ing/cards/p/phoenix-wing-wind-blast.html — a face-up non-Continuous, non-Equip Spell/Trap (one
      // resolving on the chain) cannot be targeted: it is already "considered to be destroyed" once activated.
      canActivate: (ctx) => ctx.hand().length > 0 && ctx.field('opp', (c) => pwwbTargetable(ctx)(c) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.discardFromHand(1, undefined, 'cost', ctx.player, 'Discard 1 card.');
        await ctx.selectTargets(ctx.field('opp', pwwbTargetable(ctx)), 1, 1, 'Target 1 card your opponent controls to place on top of the Deck.', 'toDeck');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.toDeck(t, 'top');
      },
      ai: { score: (ctx) => (ctx.hand().length ? removalScore(ctx, ctx.field('opp', (c) => ctx.canTarget(c)), 44) : 0) },
    },
  ],
});

/** Would the activation in `l` destroy 2+ cards controlled by `me`? (heuristic for Starlight Road) */
function wouldDestroyTwoOfMine(ctx: Ctx, l: ChainLink): boolean {
  const cats = l.effect.categories ?? [];
  if (!cats.includes('destroy') && !cats.includes('destroyMulti')) return false;
  const me = ctx.player;
  if (l.ctx.targets.filter((c) => c.onField && c.controller === me).length >= 2) return true;
  if (!cats.includes('destroyMulti')) return false;
  const t = (l.card.data.text || '').toLowerCase();
  if (l.player === me && /opponent controls/.test(t) && !/you control/.test(t)) return false;
  if (l.player !== me && /you control/.test(t) && !/opponent controls|on the field/.test(t)) return false;
  let pool: CardInstance[];
  const mons = /monster/.test(t);
  const st = /spell|trap/.test(t);
  if (/all (other )?cards|cards on the field/.test(t)) pool = ctx.field('me');
  else if (mons && !st) pool = ctx.monsters('me');
  else if (st && !mons) pool = ctx.spellTraps('me');
  else pool = ctx.field('me');
  if (/attack position/.test(t)) pool = pool.filter((c) => !c.isMonster || c.pos === 'atk');
  if (/face-up/.test(t) && !/face-down/.test(t)) pool = pool.filter((c) => c.faceUp || c === ctx.self);
  return pool.length >= 2;
}

defTrap('Starlight Road', 'normal', {
  text: 'Activate only when an effect is activated that would destroy 2 or more cards you control. Negate the effect and destroy that card. Then, you can Special Summon 1 "Stardust Dragon" from your Extra Deck.',
  aiValue: 400,
  effects: [
    {
      // https://edisonrul.ing/cards/s/starlight-road.html — it negates the EFFECT (not the activation), cannot be
      // activated in the Damage Step, and "Stardust Dragon" can only be Summoned if Starlight Road destroyed that card.
      kind: 'activate',
      categories: ['negate', 'destroy', 'specialSummon'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !ctx.battle?.inDamageStep && !!l && !l.negated && l.card !== ctx.self && wouldDestroyTwoOfMine(ctx, l);
      },
      activate: async (ctx) => {
        ctx.data.link = ctx.prevLink();
      },
      resolve: async (ctx) => {
        if (!(await ctx.negateEffectAndDestroy(ctx.data.link as ChainLink))) return;
        const sd = ctx.extra('me', (c) => c.name === 'Stardust Dragon' && ctx.canSummonCard(c));
        if (sd.length && ctx.canSpecialSummon() && (await ctx.confirm('Special Summon "Stardust Dragon" from your Extra Deck?'))) {
          await ctx.specialSummon(sd[0]);
        }
      },
      ai: { score: (ctx) => (oppTop(ctx) ? 90 : 0) },
    },
  ],
});

defTrap('Trap Stun', 'normal', {
  text: 'Negate the effects of all other Trap Cards on the field during this turn.',
  effects: [
    {
      kind: 'activate',
      categories: ['negate'],
      // https://edisonrul.ing/cards/t/trap-stun.html — Traps can still be activated; every other Trap's effect on the
      // field is negated for the rest of the turn, even one that leaves the field during its chain (Game.trapStunned).
      resolve: async (ctx) => {
        const g = ctx.game;
        g.turnData.trapStunUid = ctx.self.uid;
        g.update();
        g.log('All other Trap effects on the field are negated this turn.', 'action', ctx.player);
      },
      ai: {
        score: (ctx) => {
          const top = oppTop(ctx);
          if (top && top.card.isTrap && top.card.onField && linkThreat(ctx, top) >= 2) return 56;
          if (myOpen(ctx, 'battle')) {
            const sets = ctx.spellTraps('opp', (c) => !c.faceUp).length;
            const attackers = ctx.monsters('me', (c) => ctx.game.canAttack(c)).length;
            if (sets >= 2 && attackers >= 1) return 34;
          }
          return 0;
        },
      },
    },
  ],
});

defTrap('Seven Tools of the Bandit', 'counter', {
  text: 'When a Trap Card is activated: Pay 1000 LP; negate the activation, and if you do, destroy it.',
  aiValue: 300,
  effects: [
    {
      kind: 'activate',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && !l.negated && l.isCardActivation && l.card.isTrap && l.player === ctx.opp && ctx.lp >= 1000;
      },
      activate: async (ctx) => {
        ctx.data.link = ctx.prevLink();
        await ctx.payLp(1000);
      },
      resolve: async (ctx) => {
        await ctx.negateAndDestroy(ctx.data.link as ChainLink);
      },
      ai: {
        score: (ctx) => {
          const top = oppTop(ctx);
          if (!top || ctx.lp <= 1500) return 0;
          const th = linkThreat(ctx, top);
          return th >= 2 ? 48 + th * 5 : 0;
        },
      },
    },
  ],
});

defTrap('Divine Wrath', 'counter', {
  text: "When a monster effect is activated: Discard 1 card; negate the activation, and if you do, destroy that monster.",
  aiValue: 200,
  effects: [
    {
      kind: 'activate',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && !l.negated && !l.isCardActivation && l.card.isMonster && l.player === ctx.opp;
      },
      canActivate: (ctx) => ctx.hand().length > 0,
      activate: async (ctx) => {
        ctx.data.link = ctx.prevLink();
        await ctx.discardFromHand(1, undefined, 'cost', ctx.player, 'Discard 1 card.');
      },
      resolve: async (ctx) => {
        await ctx.negateAndDestroy(ctx.data.link as ChainLink);
      },
      ai: {
        score: (ctx) => {
          const top = oppTop(ctx);
          if (!top || !ctx.hand().length) return 0;
          const th = linkThreat(ctx, top);
          return th >= 2 ? 46 + th * 5 + (top.card.onField ? cardValue(ctx.game, top.card) / 200 : 0) : 0;
        },
      },
    },
  ],
});

defTrap('Royal Decree', 'continuous', {
  text: 'Negate all other Trap effects on the field.',
  effects: [
    {
      kind: 'activate',
      categories: ['negate', 'lockdown'],
      ai: {
        score: (ctx) => {
          if (haveActiveCopy(ctx)) return 0;
          const myTraps = ctx.spellTraps('me', (c) => c !== ctx.self && c.isTrap).length;
          const top = oppTop(ctx);
          if (top && top.card.isTrap && top.card.onField && linkThreat(ctx, top) >= 2 && myTraps <= 2) return 54;
          const oppSets = ctx.spellTraps('opp', (c) => !c.faceUp || c.isTrap).length;
          if (myOpen(ctx, 'main1', 'battle') && oppSets >= 2 && myTraps <= 1) return 34;
          return 0;
        },
      },
    },
    {
      kind: 'continuous',
      active: selfNotNegated,
      mods: [{ q: 'negated', to: 'cards', filter: (ctx, c) => c.isTrap && c.onField && c.faceUp && c !== ctx.self }],
    },
  ],
});

/** Names the declaring player could sensibly call (revealed / publicly seen cards of the opponent first). */
function declarableNames(ctx: Ctx) {
  const g = ctx.game;
  const opp = ctx.opp;
  const revealed = ctx.hand('opp').filter((c) => c.revealedUntil >= g.turn).map((c) => c.name);
  const seen = [...g.players[opp].grave, ...g.players[opp].banished, ...g.fieldCards(opp).filter((c) => c.faceUp)]
    .filter((c) => !c.isToken && !c.isExtra && c.owner === opp)
    .map((c) => c.name);
  return { revealed: [...new Set(revealed)], seen: [...new Set(seen)] };
}

defTrap('Mind Crush', 'normal', {
  text: 'Declare 1 card name. If that card is in your opponent\'s hand, they must discard all copies of it from their hand. If it is not, you randomly discard 1 card.',
  effects: [
    {
      kind: 'activate',
      categories: ['discard'],
      // https://edisonrul.ing/cards/m/mind-crush.html — "You CANNOT activate "Mind Crush" while either player has no
      // cards in hand."
      canActivate: (ctx) => ctx.hand('me').length > 0 && ctx.hand('opp').length > 0,
      resolve: async (ctx) => {
        const g = ctx.game;
        const ctrl = g.controllers[ctx.player];
        const { revealed, seen } = declarableNames(ctx);
        let name: string;
        if (ctrl.declareCard) {
          const names = ctrl.isHuman ? allCards().map((c) => c.name).sort() : revealed.length ? revealed : seen.length ? seen : allCards().filter((c) => c.kind === 'monster').map((c) => c.name);
          name = await ctrl.declareCard(g, ctx.player, 'Mind Crush: declare 1 card name.', names);
        } else {
          const names = [...new Set([...revealed, ...seen])];
          const opts = names.length ? names : allCards().slice(0, 40).map((c) => c.name);
          name = opts[await ctx.option('Mind Crush: declare 1 card name.', opts, (i) => (revealed.includes(opts[i]) ? 10 : 0))];
        }
        g.log(`${g.players[ctx.player].name} declares "${name}".`, 'action', ctx.player);
        const hits = ctx.hand('opp').filter((c) => c.name === name);
        if (hits.length) {
          g.log(`${g.players[ctx.opp].name} discards ${hits.length} cop${hits.length > 1 ? 'ies' : 'y'} of "${name}".`, 'action', ctx.opp);
          await ctx.discard(hits);
        } else {
          g.log(`"${name}" is not in ${g.players[ctx.opp].name}'s hand.`, 'action', ctx.player);
          const mine = ctx.hand('me');
          if (mine.length) {
            const lost = mine[g.rng.int(mine.length)];
            g.log(`${g.players[ctx.player].name} randomly discards ${lost.name}.`, 'action', ctx.player);
            await ctx.discard([lost]);
          }
        }
      },
      ai: {
        score: (ctx) => {
          if (myLinkInChain(ctx)) return 0;
          return declarableNames(ctx).revealed.length ? 62 : 0;
        },
      },
    },
  ],
});

defTrap('Dust Tornado', 'normal', {
  text: 'Target 1 Spell/Trap Card your opponent controls; destroy that target, then you can Set 1 Spell/Trap Card from your hand.',
  aiValue: 200,
  effects: [
    {
      kind: 'activate',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.spellTraps('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.spellTraps('opp'), 1, 1, 'Target 1 Spell/Trap your opponent controls to destroy.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
        const noSet = ctx.game.queryPlayer(ctx.player, 'cannotSet') || ctx.game.queryPlayer(ctx.player, 'cannotSetSpellTrap'); // Cold Wave
        const cands = noSet ? [] : ctx.hand('me', (c) => (c.isSpell || c.isTrap) && (c.data.stype === 'field' || ctx.freeSZones() > 0));
        if (cands.length && (await ctx.confirm('Set 1 Spell/Trap Card from your hand?'))) {
          const sel = await ctx.select(cands, 1, 1, 'Choose a Spell/Trap to Set.', 'generic', {
            aiScore: (c) => (c.isTrap ? 1000 : 0) + (c.data.stype === 'quickplay' ? 500 : 0) + (c.data.aiValue ?? 0),
          });
          if (sel.length) await setFromHand(ctx, sel[0]);
        }
      },
      ai: {
        score: (ctx) => {
          if (myLinkInChain(ctx)) return 0;
          const top = oppTop(ctx);
          if (top && top.card.onField && top.isCardActivation && ctx.canTarget(top.card)) {
            const c = top.card;
            if (c.data.ttype === 'continuous' || ['continuous', 'equip', 'field'].includes(c.data.stype ?? '')) return 70;
          }
          if (oppOpen(ctx, 'end') && ctx.spellTraps('opp').length) return 40;
          if (myOpen(ctx, 'battle') && ctx.spellTraps('opp', (c) => !c.faceUp).length && ctx.monsters('me', (c) => ctx.game.canAttack(c)).length) return 32;
          return 0;
        },
      },
    },
  ],
});

defTrap('Raigeki Break', 'normal', {
  text: 'Discard 1 card, then target 1 card on the field; destroy that target.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.hand().length > 0 && ctx.field('both', (c) => c !== ctx.self && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.discardFromHand(1, undefined, 'cost', ctx.player, 'Discard 1 card.');
        await ctx.selectTargets(ctx.field('both', (c) => c !== ctx.self), 1, 1, 'Target 1 card to destroy.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
      },
      ai: { score: (ctx) => (ctx.hand().length ? removalScore(ctx, ctx.field('opp', (c) => ctx.canTarget(c)), 44) : 0) },
    },
  ],
});

defTrap('Threatening Roar', 'normal', {
  text: 'Your opponent cannot declare an attack this turn.',
  effects: [
    {
      kind: 'activate',
      categories: ['protect'],
      // https://edisonrul.ing/cards/t/threatening-roar.html — it cannot be activated during your own turn.
      condition: (ctx) => !ctx.isMyTurn,
      resolve: async (ctx) => {
        ctx.addPlayerMod(ctx.opp, 'cannotDeclareAttack');
        ctx.log(`${ctx.game.players[ctx.opp].name} cannot declare an attack this turn.`);
      },
      ai: {
        score: (ctx) => {
          if (!oppOpen(ctx, 'battle')) return 0;
          const pot = oppAttackPotential(ctx);
          if (pot >= ctx.lp) return 120;
          return pot >= 1500 ? 45 + pot / 300 : 0;
        },
      },
    },
  ],
});

defTrap('Negate Attack', 'counter', {
  text: "When an opponent's monster declares an attack: Negate the attack, then end the Battle Phase.",
  aiValue: 200,
  effects: [
    {
      kind: 'activate',
      event: 'attackDeclared',
      categories: ['negateAttack'],
      eventFilter: oppAttackEv,
      resolve: async (ctx) => {
        if (!ctx.battle) return;
        ctx.negateAttack();
        // No engine hook to end the Battle Phase: forbid further attacks this turn instead.
        ctx.addPlayerMod(ctx.opp, 'cannotDeclareAttack');
        ctx.log('The Battle Phase ends.');
      },
      ai: {
        score: (ctx) => {
          const at = oppAttack(ctx);
          if (!at || myLinkInChain(ctx)) return 0;
          if (at.lethal) return 140;
          return at.danger >= 1200 ? 38 + at.danger / 150 + at.others * 6 : 0;
        },
      },
    },
  ],
});

defTrap('Ultimate Offering', 'continuous', {
  text: 'During your Main Phase or your opponent\'s Battle Phase: You can pay 500 LP; immediately after this effect resolves, Normal Summon/Set 1 monster.',
  effects: [
    {
      kind: 'activate',
      categories: [],
      ai: { score: (ctx) => (myOpen(ctx, 'main1', 'main2') && offeringUseful(ctx) ? 36 : 0) },
    },
    {
      kind: 'ignition',
      label: 'Pay 500: extra Normal Summon',
      categories: [],
      canActivate: (ctx) => ctx.lp > 500,
      activate: async (ctx) => {
        await ctx.payLp(500);
      },
      resolve: async (ctx) => {
        // Approximation: grants 1 additional Normal Summon/Set this turn (only usable in your Main Phase).
        ctx.gainNormalSummon(1);
        ctx.log('You can Normal Summon/Set 1 more monster this turn.');
      },
      ai: { score: (ctx) => (offeringUseful(ctx) && ctx.lp > 1500 ? 45 : 0) },
    },
  ],
});
function offeringUseful(ctx: Ctx) {
  const g = ctx.game;
  if (g.players[ctx.player].normalSummonsLeft > 0) return false;
  return ctx.hand('me', (c) => {
    if (!c.isMonster || c.isExtra || c.data.cannotNormalSummon) return false;
    const need = g.tributesNeeded(c);
    if (need === 0) return ctx.freeMZones() > 0 && ((c.data.atk ?? 0) >= 1200 || c.hasType('effect'));
    return g.tributeCandidates(ctx.player, c).length >= need && (c.data.atk ?? 0) >= 2000;
  }).length > 0;
}

defTrap('Ceasefire', 'normal', {
  text: 'Activate only if there is a face-down Defense Position monster or a face-up Effect Monster on the field. Change all face-down Defense Position monsters on the field to face-up Defense Position (Flip effects are not activated), then inflict 500 damage to your opponent for each Effect Monster on the field.',
  effects: [
    {
      kind: 'activate',
      categories: ['position', 'damage'],
      condition: (ctx) => ctx.monsters('both', (c) => (!c.faceUp && c.pos === 'def') || (c.faceUp && c.hasType('effect'))).length > 0,
      resolve: async (ctx) => {
        const g = ctx.game;
        const down = ctx.monsters('both', (c) => !c.faceUp && c.pos === 'def');
        for (const c of down) await ctx.changePos(c, 'def', true);
        if (down.length) {
          const set = new Set(down);
          const anyG = g as any;
          anyG.pending = anyG.pending.filter((t: any) => !(t.event?.type === 'flipped' && set.has(t.card)));
        }
        const n = ctx.monsters('both', (c) => c.faceUp && c.hasType('effect')).length;
        if (n) await ctx.damage(ctx.opp, 500 * n);
      },
      ai: {
        score: (ctx) => {
          if (myLinkInChain(ctx)) return 0;
          const n = ctx.monsters('both', (c) => c.hasType('effect') && (c.faceUp || c.pos === 'def')).length;
          const dmg = 500 * n;
          if (dmg >= ctx.oppLp) return 300;
          if (n >= 3 && (noChain(ctx) || ctx.battle)) return 38 + n * 2;
          return 0;
        },
      },
    },
  ],
});

defTrap('Skill Drain', 'continuous', {
  text: 'Activate by paying 1000 LP. Negate the effects of all face-up monsters while they are face-up on the field (their effects can still be activated).',
  aiValue: 300,
  effects: [
    {
      kind: 'activate',
      categories: ['negate', 'lockdown'],
      canActivate: (ctx) => ctx.lp >= 1000,
      activate: async (ctx) => {
        await ctx.payLp(1000);
      },
      ai: {
        score: (ctx) => {
          if (haveActiveCopy(ctx) || ctx.lp <= 2500) return 0;
          const eff = (side: 'me' | 'opp') =>
            ctx.faceUpMonsters(side, (c) => c.hasType('effect')).reduce((a, c) => a + 300 + (c.data.aiValue ?? 0), 0);
          const top = oppTop(ctx);
          if (top && !top.isCardActivation && top.card.location === 'mzone' && top.card.faceUp && linkThreat(ctx, top) >= 2) return 52;
          const diff = eff('opp') - eff('me');
          if (diff >= 700 && (myOpen(ctx, 'main1', 'battle') || oppOpen(ctx, 'end', 'battle'))) return 34 + diff / 200;
          return 0;
        },
      },
    },
    {
      kind: 'continuous',
      active: selfNotNegated,
      mods: [{ q: 'negated', to: 'cards', filter: (_ctx, c) => c.isMonster && c.location === 'mzone' && c.faceUp }],
    },
  ],
});

defTrap('Macro Cosmos', 'continuous', {
  text: 'When this card resolves, you can Special Summon 1 "Helios - The Primordial Sun" from your hand or Deck. While this card is face-up on the field, any card sent to the GY is banished instead.',
  aiValue: 200,
  effects: [
    {
      kind: 'activate',
      categories: ['lockdown'],
      resolve: async (ctx) => {
        const helios = ctx.cards('me', ['hand', 'deck'], (c) => c.name === 'Helios - The Primordial Sun' && ctx.canSummonCard(c));
        if (helios.length && ctx.canSpecialSummon() && (await ctx.confirm('Special Summon "Helios - The Primordial Sun"?'))) {
          const fromDeck = helios[0].location === 'deck';
          await ctx.specialSummon(helios[0]);
          if (fromDeck) ctx.game.shuffleDeck(ctx.player);
        }
      },
      ai: {
        score: (ctx) => {
          if (haveActiveCopy(ctx)) return 0;
          const top = oppTop(ctx);
          if (top && (top.effect.categories ?? []).includes('specialSummon') && ctx.grave('opp', (c) => c.isMonster).length) return 40;
          if (oppOpen(ctx, 'end', 'standby') && ctx.grave('opp', (c) => c.isMonster).length >= 3) return 35;
          return 0;
        },
      },
    },
    {
      kind: 'continuous',
      mods: [{ q: 'banishInsteadOfGrave', to: 'players', filter: () => true }],
    },
  ],
});

defTrap('Trap Hole', 'normal', {
  text: 'When your opponent Normal or Flip Summons a monster with 1000 or more ATK: Target that monster; destroy that target.',
  effects: [
    {
      kind: 'activate',
      event: ['normalSummoned', 'flipSummoned'],
      categories: ['destroy'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && c.controller === ctx.opp && c.location === 'mzone' && c.faceUp && ctx.atk(c) >= 1000 && ctx.canTarget(c);
      },
      activate: async (ctx) => {
        const c = ctx.event ? evc(ctx.event) : undefined;
        if (!c || c.location !== 'mzone') return false;
        ctx.addTargets([c]);
      },
      // https://edisonrul.ing/cards/t/trap-hole.html — the Summoned monster must still be face-up to be destroyed.
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp);
        if (t.length) await ctx.destroy(t);
      },
      ai: {
        score: (ctx) => {
          if (myLinkInChain(ctx)) return 0;
          const c = ctx.event ? evc(ctx.event) : undefined;
          return c && c.location === 'mzone' ? 38 + cardValue(ctx.game, c) / 70 : 0;
        },
      },
    },
  ],
});

defTrap('Magic Drain', 'counter', {
  text: 'When your opponent activates a Spell Card: They can discard 1 Spell Card to negate this card\'s effect; otherwise, negate the Spell Card\'s activation, and if you do, destroy it.',
  effects: [
    {
      kind: 'activate',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && !l.negated && l.isCardActivation && l.card.isSpell && l.player === ctx.opp;
      },
      activate: async (ctx) => {
        ctx.data.link = ctx.prevLink();
      },
      resolve: async (ctx) => {
        const g = ctx.game;
        const spells = ctx.hand('opp', (c) => c.isSpell);
        if (spells.length && (await g.confirm(ctx.opp, 'Magic Drain: discard 1 Spell Card to negate its effect?', ctx.self, true))) {
          const sel = await g.select(ctx.opp, spells, 1, 1, 'Discard 1 Spell Card.', 'discard', { source: ctx.self });
          if (sel.length) {
            await g.discard(sel, 'effect', ctx.opp, ctx.self);
            g.log(`Magic Drain's effect is negated.`, 'chain', ctx.opp);
            return;
          }
        }
        await ctx.negateAndDestroy(ctx.data.link as ChainLink);
      },
      ai: {
        score: (ctx) => {
          const top = oppTop(ctx);
          if (!top) return 0;
          const th = linkThreat(ctx, top);
          return th >= 2 ? 44 + th * 5 - ctx.hand('opp').length : 0;
        },
      },
    },
  ],
});

defTrap('Dark Bribe', 'counter', {
  text: 'When your opponent activates a Spell/Trap Card: They draw 1 card, then negate the activation, and if you do, destroy it.',
  aiValue: 200,
  effects: [
    {
      kind: 'activate',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && !l.negated && l.isCardActivation && (l.card.isSpell || l.card.isTrap) && l.player === ctx.opp;
      },
      // 2010 ruling: it cannot be activated if your opponent has no cards in their Deck.
      // https://edisonrul.ing/cards/d/dark-bribe.html
      canActivate: (ctx) => ctx.deck('opp').length > 0,
      activate: async (ctx) => {
        ctx.data.link = ctx.prevLink();
      },
      resolve: async (ctx) => {
        await ctx.draw(1, ctx.opp);
        await ctx.negateAndDestroy(ctx.data.link as ChainLink);
      },
      ai: {
        score: (ctx) => {
          const top = oppTop(ctx);
          if (!top) return 0;
          const th = linkThreat(ctx, top);
          return th >= 2 ? 46 + th * 5 : 0;
        },
      },
    },
  ],
});

defTrap('Horn of Heaven', 'counter', {
  text: 'When a monster(s) would be Summoned: Tribute 1 monster; negate the Summon, and if you do, destroy that monster(s).',
  effects: [
    {
      kind: 'activate',
      negateSummon: true,
      categories: ['negateSummon'],
      condition: (ctx) => !!ctx.game.pendingSummon && ctx.game.pendingSummon.player === ctx.opp,
      canActivate: (ctx) => ctx.monsters('me', (c) => tributable(ctx, c)).length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(ctx.monsters('me', (c) => tributable(ctx, c)), 1, 1, 'Tribute 1 monster.', 'tribute');
        if (!sel.length) return false;
        await tributeCost(ctx, sel);
      },
      resolve: async (ctx) => {
        ctx.game.negatePendingSummon();
      },
      ai: {
        score: (ctx) => {
          const g = ctx.game;
          const cards = g.pendingSummon?.cards ?? [];
          const v = Math.max(0, ...cards.map((c) => cardValue(g, c)));
          const cheapest = Math.min(...ctx.monsters('me', (c) => tributable(ctx, c)).map((c) => cardValue(g, c)));
          return v >= 2300 && cheapest <= v - 900 ? 48 + (v - cheapest) / 150 : 0;
        },
      },
    },
  ],
});

const ojamaToken = token('Ojama Token', 'LIGHT', 'Beast', 2, 0, 1000, 'Special Summoned by "Ojama Trio". Cannot be Tributed for a Tribute Summon. When it is destroyed, its controller takes 300 damage.');
/** Ojama Tokens -> the Ojama Trio that created them (tokens have no location to run their own effect from). */
const OJAMA_SRC = new WeakMap<CardInstance, CardInstance>();
const OJAMA_CHARGED = new WeakSet<CardInstance>();
defTrap('Ojama Trio', 'normal', {
  text: 'Special Summon 3 "Ojama Tokens" (Beast/LIGHT/Level 2/ATK 0/DEF 1000) to your opponent\'s field in Defense Position. They cannot be Tributed for a Tribute Summon. Each time an Ojama Token is destroyed, its controller takes 300 damage.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon', 'lockdown'],
      canActivate: (ctx) => ctx.freeMZones('opp') >= 3 && !ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon'),
      resolve: async (ctx) => {
        if (ctx.freeMZones('opp') < 3) return;
        const toks = await ctx.createTokens(ojamaToken, 3, 'def', ctx.opp);
        for (const t of toks) {
          t.flags.noTributeSummonFodder = true;
          OJAMA_SRC.set(t, ctx.self);
        }
      },
      ai: { score: (ctx) => (oppOpen(ctx, 'end') && ctx.freeMZones('opp') >= 3 ? 34 : 0) },
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      label: 'Ojama Token destroyed',
      range: ['grave', 'banished', 'hand', 'deck', 'szone'],
      categories: ['damage'],
      eventFilter: (ctx, ev) => !!ev.card && OJAMA_SRC.get(evc(ev)) === ctx.self && !OJAMA_CHARGED.has(evc(ev)),
      resolve: async (ctx) => {
        const g = ctx.game;
        const dmg = new Map<PlayerId, number>();
        for (const e of g.eventLog) {
          if (e.type !== 'destroyed' || !e.card) continue;
          const tok = evc(e);
          if (OJAMA_SRC.get(tok) !== ctx.self || OJAMA_CHARGED.has(tok)) continue;
          OJAMA_CHARGED.add(tok);
          const p = (e.fromController ?? tok.controller) as PlayerId;
          dmg.set(p, (dmg.get(p) ?? 0) + 300);
        }
        for (const [p, n] of dmg) await ctx.damage(p, n);
      },
    },
  ],
});

defTrap('Waboku', 'normal', {
  text: 'You take no battle damage this turn. Your monsters cannot be destroyed by battle this turn.',
  effects: [
    {
      kind: 'activate',
      categories: ['protect'],
      resolve: async (ctx) => {
        ctx.addPlayerMod(ctx.player, 'noBattleDamage');
        for (const m of ctx.monsters('me')) ctx.addTempMod(m, 'indestructibleBattle', true, 'turn');
        ctx.log('No battle damage and no battle destruction for your monsters this turn.');
      },
      ai: {
        score: (ctx) => {
          const at = oppAttack(ctx);
          if (!at || myLinkInChain(ctx)) return 0;
          if (at.lethal) return 135;
          return at.danger >= 1500 ? 34 + at.danger / 200 + at.others * 5 : 0;
        },
      },
    },
  ],
});

defTrap('Return from the Different Dimension', 'normal', {
  text: 'Pay half your LP; Special Summon as many of your banished monsters as possible. During the End Phase, banish all monsters Special Summoned by this effect.',
  aiValue: 300,
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.lp > 1 && ctx.canSpecialSummon() && ctx.banished('me', (c) => c.isMonster && c.faceUp && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.payLp(Math.floor(ctx.lp / 2));
      },
      resolve: async (ctx) => {
        const cands = ctx.banished('me', (c) => c.isMonster && c.faceUp && ctx.canSummonCard(c));
        const n = Math.min(cands.length, ctx.freeMZones());
        if (!n || !ctx.canSpecialSummon()) return;
        const sel = await ctx.select(cands, n, n, `Special Summon ${n} banished monster(s).`, 'specialSummon');
        const done = await ctx.specialSummon(sel);
        // https://edisonrul.ing/cards/r/return-from-the-different-dimension.html — not a monster flipped face-down.
        const ids = done.map((c) => [c, c.moveId, c.faceUpId] as const);
        ctx.later('end', async () => {
          const still = ids.filter(([c, id, fid]) => c.location === 'mzone' && c.moveId === id && c.faceUpId === fid && c.faceUp).map(([c]) => c);
          if (still.length) await ctx.game.banish(still, 'effect', ctx.player, ctx.self);
        });
      },
      ai: {
        score: (ctx) => {
          const cands = ctx.banished('me', (c) => c.isMonster && c.faceUp && ctx.canSummonCard(c));
          const n = Math.min(cands.length, ctx.freeMZones());
          const atks = cands.map((c) => c.data.atk ?? 0).sort((a, b) => b - a).slice(0, n);
          const sum = atks.reduce((a, b) => a + b, 0);
          const at = oppAttack(ctx);
          if (at && at.lethal && n >= 1) return 110;
          if (ctx.lp < 2000 || n < 2) return 0;
          if (myOpen(ctx, 'main1') && sum >= 3500) return ctx.monsters('opp').length === 0 && sum >= ctx.oppLp ? 150 : 45;
          if (oppOpen(ctx, 'end') && sum >= 3000) return 48;
          return 0;
        },
      },
    },
  ],
});

defTrap('Wall of Revealing Light', 'continuous', {
  text: 'Activate by paying any multiple of 1000 LP. Monsters your opponent controls with ATK less than or equal to the amount you paid cannot attack.',
  effects: [
    {
      kind: 'activate',
      categories: ['lockdown'],
      canActivate: (ctx) => ctx.lp > 1000,
      activate: async (ctx) => {
        const max = Math.floor((ctx.lp - 1) / 1000);
        const opts = Array.from({ length: max }, (_, i) => `${(i + 1) * 1000} LP`);
        const need = Math.ceil(Math.max(0, ...ctx.monsters('opp', (c) => c.faceUp).map((c) => ctx.atk(c))) / 1000);
        const i = await ctx.option('Wall of Revealing Light: pay how much LP?', opts, (k) => (k + 1 >= need ? 100 - k : k));
        const amount = (i + 1) * 1000;
        await ctx.payLp(amount);
        ctx.self.flags.wallAmount = amount;
        ctx.log(`Monsters with ${amount} or less ATK cannot attack.`);
      },
      ai: {
        score: (ctx) => {
          if (haveActiveCopy(ctx)) return 0;
          const maxAtk = Math.max(0, ...ctx.monsters('opp', (c) => c.faceUp && c.pos === 'atk').map((c) => ctx.atk(c)));
          const amount = Math.ceil(maxAtk / 1000) * 1000;
          if (!amount || amount > 3000 || ctx.lp - amount < 2000) return 0;
          return oppOpen(ctx, 'battle') && oppAttackPotential(ctx) >= 1500 ? 42 : 0;
        },
      },
    },
    {
      kind: 'continuous',
      mods: [
        {
          q: 'cannotAttack',
          to: 'cards',
          filter: (ctx, c) => c.location === 'mzone' && c.controller === ctx.opp && ctx.atk(c) <= (ctx.self.flags.wallAmount ?? 0),
        },
      ],
    },
  ],
});

defTrap('Michizure', 'normal', {
  text: 'When a monster you control is destroyed and sent to the GY: Target 1 monster on the field; destroy that target.',
  effects: [
    {
      kind: 'activate',
      event: 'sentToGrave',
      damageStep: true,
      categories: ['destroy'],
      eventFilter: (ctx, ev) => ev.from === 'mzone' && ev.fromController === ctx.player && (ev.reasons ?? []).includes('destroy') && !!ev.card && evc(ev).isMonster,
      canActivate: (ctx) => ctx.monsters('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.monsters('both'), 1, 1, 'Target 1 monster to destroy.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone');
        if (t.length) await ctx.destroy(t);
      },
      ai: {
        score: (ctx) => {
          if (myLinkInChain(ctx)) return 0;
          const best = bestTarget(ctx.game, ctx.monsters('opp', (c) => ctx.canTarget(c)));
          return best ? 42 + cardValue(ctx.game, best) / 100 : 0;
        },
      },
    },
  ],
});

defTrap('Widespread Ruin', 'normal', {
  text: "When an opponent's monster declares an attack: Destroy the Attack Position monster your opponent controls with the highest ATK (your choice, if tied).",
  effects: [
    {
      kind: 'activate',
      event: 'attackDeclared',
      categories: ['destroy'],
      eventFilter: oppAttackEv,
      resolve: async (ctx) => {
        const atkPos = ctx.monsters('opp', (c) => c.faceUp && c.pos === 'atk');
        if (!atkPos.length) return;
        const top = Math.max(...atkPos.map((c) => ctx.atk(c)));
        const tied = atkPos.filter((c) => ctx.atk(c) === top);
        const sel = await ctx.select(tied, 1, 1, 'Destroy 1 of the highest-ATK Attack Position monsters.', 'destroy');
        if (sel.length) await ctx.destroy(sel);
      },
      ai: {
        score: (ctx) => {
          const at = oppAttack(ctx);
          if (!at || myLinkInChain(ctx) || at.danger <= 0) return 0;
          const atkPos = ctx.monsters('opp', (c) => c.faceUp && c.pos === 'atk');
          const top = Math.max(0, ...atkPos.map((c) => ctx.atk(c)));
          const victim = atkPos.find((c) => ctx.atk(c) === top);
          if (!victim) return 0;
          return (at.lethal && victim === at.attacker ? 120 : 44) + cardValue(ctx.game, victim) / 100;
        },
      },
    },
  ],
});

defTrap('Karma Cut', 'normal', {
  text: 'Discard 1 card, then target 1 face-up monster your opponent controls; banish that target, and if you do, banish all cards with that name from your opponent\'s GY.',
  effects: [
    {
      kind: 'activate',
      categories: ['banish'],
      canActivate: (ctx) => ctx.hand().length > 0 && ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.discardFromHand(1, undefined, 'cost', ctx.player, 'Discard 1 card.');
        await ctx.selectTargets(ctx.faceUpMonsters('opp'), 1, 1, 'Target 1 face-up monster your opponent controls to banish.', 'banish');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp);
        if (!t.length) return;
        const name = t[0].name;
        ctx.log(`${name} is banished, along with every "${name}" in the opponent's GY.`);
        const r = await ctx.banish(t);
        if (r.length && r[0].location === 'banished') {
          const same = ctx.grave('opp', (c) => c.name === name);
          if (same.length) await ctx.banish(same);
        }
      },
      ai: { score: (ctx) => (ctx.hand().length ? removalScore(ctx, ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)), 45) : 0) },
    },
  ],
});

defTrap('Reckless Greed', 'normal', {
  text: 'Draw 2 cards, then skip your next 2 Draw Phases.',
  effects: [
    {
      kind: 'activate',
      categories: ['draw'],
      canActivate: (ctx) => ctx.deck().length >= 2,
      resolve: async (ctx) => {
        await ctx.draw(2);
        const g = ctx.game;
        for (const t of nextTurnsOf(g, ctx.player, 2)) scheduleSkipDraw(g, ctx.player, t, 'Reckless Greed');
      },
      ai: {
        score: (ctx) => {
          if (ctx.deck().length < 12) return 0;
          const top = ctx.chainTop();
          if (top && top.player === ctx.player && top.card.name === 'Reckless Greed') return 50;
          return oppOpen(ctx, 'end') && ctx.hand().length <= 3 ? 36 : 0;
        },
      },
    },
  ],
});

defTrap('Magical Explosion', 'normal', {
  text: 'Activate only while you have no cards in your hand. Inflict 200 damage to your opponent for each Spell Card in your GY.',
  effects: [
    {
      kind: 'activate',
      categories: ['damage'],
      condition: (ctx) => ctx.hand().length === 0,
      resolve: async (ctx) => {
        const n = ctx.grave('me', (c) => c.isSpell).length;
        if (n) await ctx.damage(ctx.opp, 200 * n);
      },
      ai: {
        score: (ctx) => {
          const dmg = 200 * ctx.grave('me', (c) => c.isSpell).length;
          if (dmg >= ctx.oppLp) return 300;
          return dmg >= 1600 && !myLinkInChain(ctx) ? 40 : 0;
        },
      },
    },
  ],
});

/** Shared "bind 1 monster" logic for Shadow Spell / Spellbinding Circle. */
const boundTo = (ctx: Ctx, c: CardInstance) => c.location === 'mzone' && c.uid === ctx.self.flags.bindUid && c.moveId === ctx.self.flags.bindMove;
async function bindTarget(ctx: Ctx) {
  const t = ctx.validTargets((c) => c.location === 'mzone');
  if (!t.length || !ctx.self.onField) {
    if (ctx.self.onField) await ctx.sendToGrave(ctx.self, 'rule');
    return undefined;
  }
  ctx.self.flags.bindUid = t[0].uid;
  ctx.self.flags.bindMove = t[0].moveId;
  return t[0];
}
function bindAiScore(ctx: Ctx, base: number, atkLoss: number) {
  if (myLinkInChain(ctx)) return 0;
  const g = ctx.game;
  const at = oppAttack(ctx);
  if (at) {
    // The current attack continues; only worth it if the ATK loss turns the battle around.
    if (atkLoss && at.danger > 0 && at.target && at.target.faceUp) {
      const after = ctx.atk(at.attacker) - atkLoss;
      const stat = at.target.pos === 'atk' ? ctx.atk(at.target) : ctx.def(at.target);
      if (after < stat) return 55 + cardValue(g, at.attacker) / 100;
    }
    return 0;
  }
  const cands = ctx.faceUpMonsters('opp', (c) => c.pos === 'atk' && ctx.canTarget(c));
  const best = bestTarget(g, cands);
  if (!best || ctx.atk(best) < 1800) return 0;
  if (oppOpen(ctx, 'battle')) return base;
  if (!g.chain.length && recentOppSummons(ctx).includes(best)) return base - 2;
  return 0;
}

defTrap('Shadow Spell', 'continuous', {
  text: 'Activate this card by targeting 1 face-up monster your opponent controls; it loses 700 ATK, and it cannot attack or change its battle position. When it leaves the field, destroy this card.',
  effects: [
    {
      kind: 'activate',
      categories: ['atkChange', 'lockdown'],
      canActivate: (ctx) => ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('opp'), 1, 1, 'Target 1 face-up monster your opponent controls.', 'target', {
          aiScore: (c) => (ctx.battle?.attacker === c ? 5000 : 0) + cardValue(ctx.game, c) + (c.pos === 'atk' ? 500 : 0),
        });
      },
      resolve: async (ctx) => {
        const t = await bindTarget(ctx);
        if (t) ctx.game.link(ctx.self, t, false);
      },
      ai: { score: (ctx) => bindAiScore(ctx, 38, 700) },
    },
    {
      kind: 'continuous',
      mods: [
        { q: 'atk', to: 'cards', filter: (ctx, c) => boundTo(ctx, c) && c.faceUp, value: -700 },
        { q: 'cannotAttack', to: 'cards', filter: boundTo },
        { q: 'cannotChangePos', to: 'cards', filter: boundTo },
      ],
    },
  ],
});

defTrap('Spellbinding Circle', 'continuous', {
  text: 'Activate this card by targeting 1 monster your opponent controls; it cannot attack or change its battle position. When that monster is destroyed, destroy this card.',
  effects: [
    {
      kind: 'activate',
      categories: ['lockdown'],
      canActivate: (ctx) => ctx.monsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.monsters('opp'), 1, 1, 'Target 1 monster your opponent controls.', 'target', {
          aiScore: (c) => cardValue(ctx.game, c) + (c.faceUp && c.pos === 'atk' ? 800 : 0),
        });
      },
      resolve: async (ctx) => {
        await bindTarget(ctx);
      },
      ai: { score: (ctx) => bindAiScore(ctx, 36, 0) },
    },
    {
      kind: 'continuous',
      mods: [
        { q: 'cannotAttack', to: 'cards', filter: boundTo },
        { q: 'cannotChangePos', to: 'cards', filter: boundTo },
      ],
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      range: ['szone'],
      label: 'Bound monster destroyed',
      categories: ['destroy'],
      eventFilter: (ctx, ev) =>
        ctx.self.faceUp && ctx.self.activeOnField && !!ev.card && evc(ev).uid === ctx.self.flags.bindUid && !ctx.game.isNegated(ctx.self),
      resolve: async (ctx) => {
        if (ctx.self.onField) await ctx.destroy(ctx.self);
      },
    },
  ],
});

defTrap('Draining Shield', 'normal', {
  text: "When an opponent's monster declares an attack: Target the attacking monster; negate the attack, and if you do, gain LP equal to that target's ATK.",
  effects: [
    {
      kind: 'activate',
      event: 'attackDeclared',
      categories: ['negateAttack', 'recover'],
      eventFilter: oppAttackTargetableEv,
      activate: targetAttacker,
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone');
        if (!t.length || !ctx.battle) return;
        const atk = ctx.atk(t[0]);
        ctx.negateAttack();
        await ctx.recover(ctx.player, atk);
      },
      ai: {
        score: (ctx) => {
          const at = oppAttack(ctx);
          if (!at || myLinkInChain(ctx)) return 0;
          if (at.lethal) return 128;
          return at.danger > 0 ? 38 + ctx.atk(at.attacker) / 100 : 0;
        },
      },
    },
  ],
});

defTrap('Dimension Wall', 'normal', {
  text: "When an opponent's monster declares an attack: Your opponent takes any battle damage you would have taken from this battle instead.",
  effects: [
    {
      kind: 'activate',
      event: 'attackDeclared',
      categories: ['damage', 'protect'],
      eventFilter: oppAttackEv,
      activate: async (ctx) => {
        patchGame(ctx.game);
      },
      resolve: async (ctx) => {
        const b = ctx.battle as any;
        if (!b) return;
        patchGame(ctx.game);
        b.__reflect = [...(b.__reflect ?? []), ctx.player];
        ctx.log('Battle damage you would take from this battle is redirected to your opponent.');
      },
      ai: {
        score: (ctx) => {
          const at = oppAttack(ctx);
          if (!at || myLinkInChain(ctx) || at.damage <= 0) return 0;
          if (at.damage >= ctx.oppLp) return 300;
          if (at.lethal) return 132;
          return at.damage >= 800 ? 40 + at.damage / 100 : 0;
        },
      },
    },
  ],
});

defTrap('Bad Reaction to Simochi', 'continuous', {
  text: 'Any effect that would make your opponent gain LP inflicts that much damage to them instead.',
  effects: [
    {
      kind: 'activate',
      categories: ['damage', 'lockdown'],
      activate: async (ctx) => {
        patchGame(ctx.game);
      },
      resolve: async (ctx) => {
        patchGame(ctx.game);
      },
      ai: { score: (ctx) => (!haveActiveCopy(ctx) && myOpen(ctx, 'main1', 'main2') ? 15 : 0) },
    },
  ],
});

defTrap('Time Seal', 'normal', {
  text: "Skip your opponent's next Draw Phase.",
  effects: [
    {
      kind: 'activate',
      categories: ['lockdown'],
      resolve: async (ctx) => {
        const g = ctx.game;
        const [t] = nextTurnsOf(g, ctx.opp, 1);
        scheduleSkipDraw(g, ctx.opp, t, 'Time Seal');
        ctx.log(`${g.players[ctx.opp].name} will skip their next Draw Phase.`);
      },
      ai: { score: (ctx) => (oppOpen(ctx, 'end') || myOpen(ctx, 'main2') ? 32 : 0) },
    },
  ],
});

defTrap('Imperial Order', 'continuous', {
  text: 'Negate all Spell effects on the field. Once per turn, during your Standby Phase, pay 700 LP or destroy this card.',
  aiValue: 300,
  effects: [
    {
      kind: 'activate',
      categories: ['negate', 'lockdown'],
      ai: {
        score: (ctx) => {
          if (haveActiveCopy(ctx)) return 0;
          const top = oppTop(ctx);
          if (top && top.card.isSpell && top.card.onField && linkThreat(ctx, top) >= 2) return 56;
          const lasting = ctx.spellTraps('opp', (c) => c.isSpell && c.faceUp && ['continuous', 'equip', 'field'].includes(c.data.stype ?? '')).length;
          return lasting && (myOpen(ctx, 'main1') || oppOpen(ctx, 'end')) ? 35 : 0;
        },
      },
    },
    {
      kind: 'continuous',
      active: selfNotNegated,
      mods: [{ q: 'negated', to: 'cards', filter: (_ctx, c) => c.isSpell && c.onField && c.faceUp }],
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      range: ['szone'],
      label: 'Maintenance: pay 700 LP',
      categories: [],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn && ctx.self.faceUp && ctx.self.activeOnField,
      resolve: async (ctx) => {
        if (!ctx.self.onField) return;
        if (ctx.lp > 700 && (await ctx.confirm('Pay 700 LP to keep Imperial Order?', ctx.lp > 2500))) {
          await ctx.payLp(700);
        } else {
          await ctx.destroy(ctx.self);
        }
      },
    },
  ],
});

defTrap('Last Turn', 'normal', {
  text: "Activate only during your opponent's turn while your LP are 1000 or less. Choose 1 monster you control; send all other cards on the field and in both hands to the GY. Then your opponent Special Summons 1 monster from their Deck in Attack Position and it battles your monster. At the End Phase, the player who is the only one controlling a monster wins the Duel.",
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      condition: (ctx) => !ctx.isMyTurn && ctx.lp <= 1000 && ctx.phase !== 'end' && ctx.monsters('me').length > 0,
      resolve: async (ctx) => {
        const g = ctx.game;
        const mineSel = await ctx.select(ctx.monsters('me'), 1, 1, 'Choose 1 monster you control to keep.', 'buff');
        if (!mineSel.length) return;
        const mine = mineSel[0];
        const rest = [...g.allFieldCards(), ...g.players[0].hand, ...g.players[1].hand].filter((c) => c !== mine && c !== ctx.self);
        if (rest.length) await g.moveCards(rest, 'grave', { reason: 'effect', reasonPlayer: ctx.player, reasonCard: ctx.self });
        const deckMons = g.players[ctx.opp].deck.filter((c) => c.isMonster && !c.data.nomi);
        let theirs: CardInstance | undefined;
        if (deckMons.length && g.freeMZones(ctx.opp) > 0) {
          const sel = await g.select(ctx.opp, deckMons, 1, 1, 'Last Turn: Special Summon 1 monster from your Deck.', 'specialSummon', { source: ctx.self });
          if (sel.length) {
            const r = await g.specialSummon(sel, ctx.opp, { pos: 'atk', reasonCard: ctx.self });
            theirs = r[0];
          }
          g.shuffleDeck(ctx.opp);
        }
        if (theirs && mine.location === 'mzone' && theirs.location === 'mzone') {
          // The turn player's monster attacks.
          const atkA = g.getAtk(theirs);
          g.log(`Last Turn: ${theirs.name} battles ${mine.name}.`, 'battle');
          const losers: CardInstance[] = [];
          if (mine.pos === 'atk') {
            const atkM = g.getAtk(mine);
            if (atkA > atkM) {
              losers.push(mine);
              await g.damage(ctx.player, atkA - atkM, 'battle', theirs, ctx.opp);
            } else if (atkA < atkM) {
              losers.push(theirs);
              await g.damage(ctx.opp, atkM - atkA, 'battle', mine, ctx.player);
            } else if (atkA > 0) losers.push(mine, theirs);
          } else {
            const defM = g.getDef(mine);
            if (!mine.faceUp) await g.changePosition(mine, 'def', true);
            if (atkA > defM) losers.push(mine);
            else if (atkA < defM) await g.damage(ctx.opp, defM - atkA, 'battle', mine, ctx.player);
          }
          if (losers.length) await g.destroy(losers, 'battle');
        }
        ctx.later('end', async () => {
          const m0 = g.monsters(0).length;
          const m1 = g.monsters(1).length;
          if (m0 > 0 && m1 === 0) g.endGame(0, 'Last Turn');
          if (m1 > 0 && m0 === 0) g.endGame(1, 'Last Turn');
        });
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...ctx.faceUpMonsters('me').map((c) => ctx.atk(c)));
          const at = oppAttack(ctx);
          if (at && at.lethal && best >= 2000) return 80;
          return best >= 2600 && noChain(ctx) ? 35 : 0;
        },
      },
    },
  ],
});

defTrap('Ring of Destruction', 'normal', {
  text: 'Target 1 face-up monster on the field; destroy it, and if you do, inflict damage to both players equal to its ATK.',
  aiValue: 400,
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'damage'],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('both'), 1, 1, 'Target 1 face-up monster to destroy.', 'destroy', {
          aiScore: (c) => (c.controller === ctx.player ? -5000 : ctx.atk(c) >= ctx.oppLp && ctx.atk(c) < ctx.lp ? 10000 : cardValue(ctx.game, c)),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp);
        if (!t.length) return;
        const atk = ctx.atk(t[0]);
        const d = await ctx.destroy(t);
        if (!d.length || !atk) return;
        const g = ctx.game;
        if (ctx.lp <= atk && ctx.oppLp <= atk) {
          g.players[0].lp = 0;
          g.players[1].lp = 0;
          g.log(`Both players take ${atk} damage.`, 'damage');
          g.checkLp();
          return;
        }
        await ctx.damage(ctx.player, atk);
        await ctx.damage(ctx.opp, atk);
      },
      ai: {
        score: (ctx) => {
          if (myLinkInChain(ctx)) return 0;
          const cands = ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c));
          if (cands.some((c) => ctx.atk(c) >= ctx.oppLp && ctx.atk(c) < ctx.lp)) return 300;
          const at = oppAttack(ctx);
          if (at && at.danger > 0 && at.attacker.faceUp && ctx.lp > ctx.atk(at.attacker) + 2500 && cardValue(ctx.game, at.attacker) >= 2000) return 42;
          return 0;
        },
      },
    },
  ],
});

/** Crush Card Virus: card -> { victim, until (last turn number of the effect) }. */
const VIRUS = new WeakMap<CardInstance, { victim: PlayerId; until: number }>();
const virusVictim = (c: CardInstance) => c.isMonster && (c.data.atk ?? 0) >= 1500;
defTrap('Crush Card Virus', 'normal', {
  text: "Tribute 1 DARK monster with 1000 or less ATK. Destroy all monsters your opponent controls with 1500 or more ATK, then look at their hand and destroy all such monsters in it. Until the end of their 3rd turn after activation, they check every card they draw and destroy monsters with 1500 or more ATK.",
  aiValue: 800,
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'destroyMulti'],
      canActivate: (ctx) => ctx.monsters('me', (c) => c.data.attribute === 'DARK' && ctx.atk(c) <= 1000 && tributable(ctx, c)).length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(
          ctx.monsters('me', (c) => c.data.attribute === 'DARK' && ctx.atk(c) <= 1000 && tributable(ctx, c)),
          1,
          1,
          'Tribute 1 DARK monster with 1000 or less ATK.',
          'tribute',
        );
        if (!sel.length) return false;
        await tributeCost(ctx, sel);
      },
      resolve: async (ctx) => {
        const g = ctx.game;
        await ctx.destroy(ctx.monsters('opp', (c) => ctx.atk(c) >= 1500));
        const hand = ctx.hand('opp');
        for (const c of hand) c.revealedUntil = g.turn;
        g.log(`${g.players[ctx.opp].name}'s hand: ${hand.map((c) => c.name).join(', ') || '(empty)'}.`, 'action', ctx.player);
        const hits = hand.filter(virusVictim);
        if (hits.length) {
          await g.moveCards(hits, 'grave', { reason: 'effect', reasons: ['effect', 'destroy'], destroyed: true, reasonPlayer: ctx.player, reasonCard: ctx.self });
        }
        const turns = nextTurnsOf(g, ctx.opp, 3);
        VIRUS.set(ctx.self, { victim: ctx.opp, until: turns[2] });
      },
      ai: {
        score: (ctx) => {
          if (myLinkInChain(ctx)) return 0;
          const n = ctx.monsters('opp', (c) => ctx.atk(c) >= 1500).length;
          if (n >= 1) return 48 + n * 10;
          return oppOpen(ctx, 'end') && ctx.hand('opp').length >= 4 ? 38 : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'drawn',
      mandatory: true,
      range: ['grave', 'banished', 'hand', 'deck', 'szone'],
      label: 'Virus: check drawn card',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => {
        const v = VIRUS.get(ctx.self);
        return !!v && ev.player === v.victim && ctx.game.turn <= v.until && !!ev.card && virusVictim(evc(ev));
      },
      resolve: async (ctx) => {
        const g = ctx.game;
        const v = VIRUS.get(ctx.self);
        if (!v) return;
        const batch = ctx.event?.batch;
        const drawn = g.eventLog
          .filter((e) => e.type === 'drawn' && e.player === v.victim && (e.batch === batch || e.card === ctx.event?.card))
          .map(evc)
          .filter((c) => c.location === 'hand' && c.owner === v.victim);
        const hits = [...new Set(drawn)].filter(virusVictim);
        if (!hits.length) return;
        for (const c of hits) c.revealedUntil = g.turn;
        g.log(`Crush Card Virus: ${hits.map((c) => c.name).join(', ')} drawn and destroyed.`, 'action', ctx.player);
        await g.moveCards(hits, 'grave', { reason: 'effect', reasons: ['effect', 'destroy'], destroyed: true, reasonPlayer: ctx.player, reasonCard: ctx.self });
      },
    },
  ],
});

defTrap('Exchange of the Spirit', 'normal', {
  text: 'Activate only if both players have 15 or more cards in their GYs. Each player swaps the cards in their GY with the cards in their Deck, then shuffles their new Deck.',
  effects: [
    {
      kind: 'activate',
      categories: ['toDeck', 'mill'],
      condition: (ctx) => ctx.grave('me').length >= 15 && ctx.grave('opp').length >= 15,
      resolve: async (ctx) => {
        const g = ctx.game;
        for (const p of [ctx.player, ctx.opp] as PlayerId[]) {
          const deck = [...g.players[p].deck];
          const grave = [...g.players[p].grave];
          if (deck.length) await g.moveCards(deck, 'grave', { reason: 'effect', reasonPlayer: ctx.player, reasonCard: ctx.self });
          if (grave.length) await g.toDeck(grave, 'effect', 'shuffle', ctx.player, ctx.self);
          g.shuffleDeck(p);
        }
      },
      ai: { score: () => 0 },
    },
  ],
});

// The AI should not throw away Trap activations while a Royal Decree would negate them.
const decreeUp = (ctx: Ctx) =>
  ctx.game.allFieldCards().some((c) => c.name === 'Royal Decree' && c !== ctx.self && c.faceUp && c.activeOnField && !ctx.game.isNegated(c));
for (const d of DEFINED) {
  for (const ef of d.effects ?? []) {
    const score = ef.ai?.score;
    if (ef.kind !== 'activate' || !score) continue;
    ef.ai!.score = (ctx) => (decreeUp(ctx) ? -1 : score(ctx));
  }
}

export const TRAPS_LOADED = true;
