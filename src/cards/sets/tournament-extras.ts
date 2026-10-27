// Card definitions needed by the real SJC Edison 2010 decklists in src/decks/tournament.ts
// (main, Extra and Side Decks) that were not yet in the pool. All of them were legal in the
// Edison format (The Shining Darkness card pool, March 2010 list).
//
// Approximations are marked "Approximation:" next to the card. They exist where the engine
// has no hook for the exact rule (per-card summon restrictions, name changes, etc.).
import { findCard, monster, spell, trap } from '../define';
import { attr, bestTarget, cardValue, destroyTargets, flip, race, selfDestroysByBattle } from '../helpers';
import { dataVariant, type CardInstance, type EffectDef } from '../../engine/card';
import type { Ctx } from '../../engine/ctx';
import type { ChainLink, Game } from '../../engine/game';
import type { GameEvent, Location, PlayerId } from '../../engine/types';
import type { Activation } from '../../engine/controller';

type C = CardInstance;

// ============================================================ shared helpers

const evc = (ev: GameEvent) => ev.card as C | undefined;
const isQuickdraw = (c: C) => c.name === 'Quickdraw Synchron';
/** A specific "X Synchron" Tuner, or Quickdraw Synchron (which can substitute for any "Synchron" Tuner). */
const synchronNamed = (n: string) => (c: C) => c.name === n || isQuickdraw(c);
const noChain = (ctx: Ctx) => ctx.game.chain.length === 0;
/** This Continuous Spell/Trap is face-up, has resolved and is not negated. */
const stActive = (ctx: Ctx) => ctx.self.onField && ctx.self.faceUp && ctx.self.activeOnField && !ctx.game.isNegated(ctx.self);
/** The link on top of the chain belongs to the opponent and still resolves. */
function oppTop(ctx: Ctx): ChainLink | undefined {
  const l = ctx.chainTop();
  return l && l.player === ctx.opp && !l.negated ? l : undefined;
}
/** Tribute cards as a cost. */
async function tributeCost(ctx: Ctx, cards: C[]) {
  if (!cards.length) return;
  ctx.game.log(`${ctx.game.players[ctx.player].name} Tributes ${cards.map((c) => c.name).join(', ')}.`, 'action', ctx.player);
  await ctx.game.moveCards(cards, 'grave', { reason: 'tribute', reasons: ['tribute', 'cost'], reasonPlayer: ctx.player, reasonCard: ctx.self });
}
const nameOf = (c: C) => c.name;

/**
 * "X cannot be Summoned" lock (Consecrated Light, Prohibition).
 * Approximation: the engine has no per-card summon restriction hook, so a locked monster that still gets
 * Summoned is returned at once (no destruction): Main Deck monsters go to the GY, Extra Deck monsters to the Extra Deck.
 */
function summonLock(label: string, locked: (ctx: Ctx, c: C) => boolean): EffectDef {
  return {
    kind: 'trigger',
    event: 'summoned',
    range: ['szone'],
    mandatory: true,
    label,
    categories: ['toDeck'],
    eventFilter: (ctx, ev) => {
      const c = evc(ev);
      return !!c && c.location === 'mzone' && c.faceUp && stActive(ctx) && locked(ctx, c);
    },
    activate: async (ctx) => {
      const c = evc(ctx.event!)!;
      ctx.data.mon = c;
      ctx.data.mid = c.moveId;
    },
    resolve: async (ctx) => {
      const c = ctx.data.mon as C;
      if (!c || c.location !== 'mzone' || c.moveId !== ctx.data.mid) return;
      ctx.log(`${c.name} cannot be Summoned while ${ctx.self.name} applies.`);
      if (c.isExtra) await ctx.game.toDeck([c], 'rule', 'shuffle', ctx.player, ctx.self);
      else await ctx.game.moveCards([c], 'grave', { reason: 'rule', reasonPlayer: ctx.player, reasonCard: ctx.self });
    },
  };
}

/** Names of the monsters a Fusion monster lists explicitly as Fusion Material (from its first text line). */
function listedMaterials(f: C): string[] {
  const first = (f.data.text ?? '').split('\n')[0];
  const names = [...first.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  return [...new Set(names)].filter((n) => findCard(n)?.kind === 'monster');
}

/**
 * Change a monster's name (and therefore its archetype membership) until the end of the turn.
 * Approximation: the engine has no name-change hook, so the instance's `name` getter and `inSet` method
 * are shadowed. The change ends when the card leaves the field or the turn ends.
 */
function renameUntilEndPhase(game: Game, card: C, name: string) {
  const mid = card.moveId;
  const turn = game.turn;
  const tags = findCard(name)?.sets ?? [];
  // A data patch, so `name`, `data.name` and the archetype tags all change while it is face-up on the field this turn.
  card.addDataPatch((d, c) =>
    c.moveId === mid && game.turn === turn && c.location === 'mzone' && c.faceUp
      ? dataVariant(d, `prisma:${name}`, { name, sets: [...new Set([...(d.sets ?? []), ...tags])] })
      : undefined,
  );
}

// ============================================================ MAIN DECK MONSTERS

/**
 * Light and Darkness Dragon: after any activation, each face-up Light and Darkness Dragon (once per Chain, able to lose
 * 500 ATK/DEF) adds its mandatory negation as the next Chain Link. Effect 1 of the card is that link.
 */
const LADD_PATCHED = new WeakSet<Game>();
function ensureLaddPatch(g: Game) {
  if (LADD_PATCHED.has(g)) return;
  LADD_PATCHED.add(g);
  const orig = g.activate.bind(g);
  (g as any).activate = async (player: PlayerId, act: Activation) => {
    const link = await orig(player, act);
    if (!link || g.over || link.speed >= 3) return link;
    for (const me of g.allFieldCards()) {
      if (me.name !== 'Light and Darkness Dragon' || me === link.card || me.location !== 'mzone' || !me.faceUp || g.isNegated(me)) continue;
      const first = g.chain[0];
      if (me.flags.laddChain && me.flags.laddChain === first) continue;
      if (g.getAtk(me) < 500 || g.getDef(me) < 500) continue;
      me.flags.laddChain = first;
      const ef = me.data.effects![1];
      await g.activate(me.controller, { card: me, effect: ef, effectIndex: 1, label: ef.label ?? 'Negate activation', event: { type: 'chainActivated', seq: 0, batch: 0, card: link.card, data: { link } } });
    }
    return link;
  };
}

monster('Light and Darkness Dragon', {
  attribute: 'LIGHT',
  race: 'Dragon',
  level: 8,
  atk: 2800,
  def: 2400,
  // Cannot be Special Summoned: nomi blocks every Special Summon from hand/Deck/GY (it is never "properly" summoned).
  nomi: true,
  aiValue: 1200,
  text: 'Cannot be Special Summoned. While face-up on the field, this card is also DARK. Once per Chain, when a Spell/Trap Card or monster effect is activated: this card loses exactly 500 ATK and DEF, and if it does, negate that activation. When this card is destroyed and sent to the GY: Target 1 monster in your GY (if possible); destroy all cards you control, then Special Summon that target.',
  effects: [
    {
      // Installs the per-game hook below (an inert listener from every location, like the sets' rule listeners).
      kind: 'trigger',
      event: 'phaseStart',
      range: ['deck', 'hand', 'mzone', 'grave', 'banished', 'extra'],
      label: '(rules)',
      eventFilter: (ctx) => {
        ensureLaddPatch(ctx.game);
        return false;
      },
    },
    {
      // The mandatory negation: its own Chain Link (Spell Speed 2), added right after the activation by the hook.
      // The ATK/DEF loss happens on resolution, so if this card is no longer face-up then (Book of Moon in response),
      // or can't lose 500, nothing is negated. Not counted as DARK (the engine has one Attribute per card).
      kind: 'trigger',
      speed: 2,
      damageStep: true,
      mandatory: true,
      label: 'Negate activation',
      categories: ['negate'],
      activate: async (ctx) => {
        ctx.data.link = (ctx.event?.data as { link?: ChainLink } | undefined)?.link;
      },
      resolve: async (ctx) => {
        const me = ctx.self;
        const target = ctx.data.link as ChainLink | undefined;
        if (me.location !== 'mzone' || !me.faceUp || ctx.game.isNegated(me)) return;
        if (ctx.game.getAtk(me) < 500 || ctx.game.getDef(me) < 500) return;
        ctx.game.addTempMod(me, 'atk', -500, 'field', me);
        ctx.game.addTempMod(me, 'def', -500, 'field', me);
        if (target && !target.negated && ctx.game.chain.includes(target)) {
          ctx.game.negateLink(target, false, me);
          // Edison functional errata (Lumina / Susa Soldier entries): a Phase-Dependent Mandatory Trigger whose activation
          // is negated by this card "activates again ... until it is able to resolve" (Judgment Dragon, every Lightsworn
          // and every Spirit monster). https://www.edisonformat.com/functional-errata.html
          const ev = target.ctx.event;
          if (target.effect.kind === 'trigger' && target.effect.mandatory && ev?.type === 'phaseStart' && ev.phase === ctx.game.phase) {
            ctx.game.pending.push({ card: target.card, effect: target.effect, effectIndex: target.effectIndex, event: ev, player: target.player });
          }
        }
      },
    },
    {
      // Rulings audit: mandatory (Edison text: "select 1 monster in your Graveyard. Destroy all cards on your side of
      // the field, then Special Summon the selected monster"). It targets a monster if there is one, and still
      // destroys your field when there is none.
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'Destroy your field, revive 1 monster',
      categories: ['destroy', 'destroyMulti', 'specialSummon'],
      // https://edisonrul.ing/cards/l/light-and-darkness-dragon.html — it activates whenever it is destroyed and sent to
      // the GY: from the hand, the Deck, the field, or while equipped to "Relinquished" (a Spell & Trap Zone).
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.to === 'grave' && (ev.reasons ?? []).includes('destroy'),
      activate: async (ctx) => {
        const cands = ctx.grave('me', (c) => c.isMonster && c !== ctx.self && ctx.canTarget(c));
        if (!cands.length) return;
        await ctx.selectTargets(cands, 1, 1, 'Target 1 monster in your GY.', 'specialSummon', {
          aiScore: (c) => (ctx.canSummonCard(c) ? (c.data.atk ?? 0) + (c.data.aiValue ?? 0) : -5000),
        });
      },
      resolve: async (ctx) => {
        const mine = ctx.field('me');
        if (mine.length) await ctx.destroy(mine);
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length && ctx.canSummonCard(t[0])) await ctx.specialSummon(t[0]);
      },
    },
  ],
});

monster('Super-Nimble Mega Hamster', {
  attribute: 'EARTH',
  race: 'Beast',
  level: 4, // ABPF: printed Level 4 (YGOJSON), so it cannot fetch another copy of itself
  atk: 1100,
  def: 1800,
  types: ['flip'],
  aiValue: 500,
  text: 'FLIP: Special Summon 1 Level 3 or lower monster from your Deck in face-up Attack Position or face-down Defense Position.',
  effects: [
    flip({
      categories: ['specialSummon'],
      condition: (ctx) => ctx.canSpecialSummon(),
      resolve: async (ctx) => {
        const cands = ctx.deck('me', (c) => c.isMonster && !c.isExtra && (c.data.level ?? 0) <= 3 && ctx.canSummonCard(c));
        if (!cands.length || !ctx.canSpecialSummon()) {
          ctx.game.shuffleDeck(ctx.player);
          return;
        }
        const [c] = await ctx.select(cands, 1, 1, 'Special Summon 1 Level 3 or lower monster from your Deck.', 'specialSummon', {
          aiScore: (c) => (c.data.aiValue ?? 0) + (c.data.atk ?? 0) / 4 + (c.hasType('flip') ? 400 : 0),
        });
        if (c) {
          const faceDown =
            (await ctx.option(`Summon ${c.name} how?`, ['Face-up Attack Position', 'Face-down Defense Position'], (i) =>
              c.hasType('flip') ? (i === 1 ? 2 : 0) : i === 0 ? 2 : (c.data.atk ?? 0) < 1000 ? 1 : 0,
            )) === 1;
          await ctx.specialSummon(c, faceDown ? { pos: 'def', faceDown: true } : { pos: 'atk' });
        }
        ctx.game.shuffleDeck(ctx.player);
      },
    }),
  ],
});

monster('D.D. Crow', {
  attribute: 'DARK',
  race: 'Winged Beast',
  level: 1,
  atk: 100,
  def: 100,
  aiValue: 600,
  text: '(Quick Effect): You can discard this card from your hand, then target 1 card in your opponent\'s GY; banish that target.',
  effects: [
    {
      kind: 'quick',
      range: ['hand'],
      label: 'Discard: banish from GY',
      categories: ['banish'],
      canActivate: (ctx) => ctx.grave('opp').length > 0,
      activate: async (ctx) => {
        const prevTargets = new Set(ctx.game.chain.flatMap((l) => (l.player === ctx.opp ? l.ctx.targets : [])));
        await ctx.discard(ctx.self, 'cost');
        await ctx.selectTargets(ctx.grave('opp'), 1, 1, 'Target 1 card in your opponent\'s GY to banish.', 'banish', {
          aiScore: (c) => (prevTargets.has(c) ? 5000 : 0) + cardValue(ctx.game, c),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.banish(t);
      },
      ai: {
        score: (ctx) => {
          const top = oppTop(ctx);
          if (top && top.ctx.targets.some((t) => t.location === 'grave' && t.controller === ctx.opp)) return 85;
          return 0;
        },
      },
    },
  ],
});

/** Gadget search: "When this card is Normal or Special Summoned: You can add 1 <next> from your Deck to your hand." */
function gadget(name: string, atk: number, def: number, next: string) {
  monster(name, {
    attribute: 'EARTH',
    race: 'Machine',
    level: 4,
    atk,
    def,
    sets: ['gadget'],
    aiValue: 500,
    text: `When this card is Normal or Special Summoned: You can add 1 "${next}" from your Deck to your hand.`,
    effects: [
      {
        kind: 'trigger',
        event: ['normalSummoned', 'specialSummoned'],
        when: true,
        label: `Search ${next}`,
        categories: ['search'],
        canActivate: (ctx) => ctx.deck('me', (c) => c.name === next).length > 0,
        resolve: async (ctx) => {
          await ctx.search((c) => c.name === next, 1, `Add 1 "${next}" to your hand.`);
        },
      },
    ],
  });
}
gadget('Green Gadget', 1400, 600, 'Red Gadget');
gadget('Red Gadget', 1300, 1500, 'Yellow Gadget');
gadget('Yellow Gadget', 1200, 1200, 'Green Gadget');

/** Gravekeeper's Descendant's cost: another face-up "Gravekeeper's" monster. */
const isGKFodder = (c: CardInstance) => c.faceUp && c.isMonster && (c.inSet('gravekeeper') || c.name.startsWith("Gravekeeper's"));
monster("Gravekeeper's Descendant", {
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 4,
  atk: 1500,
  def: 1200,
  sets: ['gravekeeper'],
  aiValue: 600,
  text: 'You can Tribute 1 other face-up "Gravekeeper\'s" monster, then target 1 card your opponent controls; destroy that target.',
  effects: [
    {
      kind: 'ignition',
      label: 'Tribute: destroy 1 card',
      categories: ['destroy'],
      canActivate: (ctx) =>
        ctx.monsters('me', (c) => c !== ctx.self && isGKFodder(c) && !ctx.query(c, 'cannotBeTributed')).length > 0 && ctx.field('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const cost = await ctx.select(ctx.monsters('me', (c) => c !== ctx.self && isGKFodder(c) && !ctx.query(c, 'cannotBeTributed')), 1, 1, 'Tribute 1 other face-up "Gravekeeper\'s" monster.', 'tribute');
        if (!cost.length) return false;
        await tributeCost(ctx, cost);
        await ctx.selectTargets(ctx.field('opp'), 1, 1, 'Target 1 card your opponent controls to destroy.', 'destroy');
      },
      resolve: destroyTargets,
      ai: {
        score: (ctx) => {
          const fodder = Math.min(...ctx.monsters('me', (c) => c !== ctx.self && isGKFodder(c) && !ctx.query(c, 'cannotBeTributed')).map((c) => cardValue(ctx.game, c)));
          const best = bestTarget(ctx.game, ctx.field('opp', (c) => ctx.canTarget(c)));
          if (!best) return 0;
          const gain = cardValue(ctx.game, best) - fodder;
          return gain >= 500 ? 45 + gain / 200 : 0;
        },
      },
    },
  ],
});

monster('Summoner Monk', {
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 4,
  atk: 800,
  def: 1600,
  aiValue: 700,
  text: 'While this card is face-up on the field, it cannot be Tributed. When this card is Normal Summoned or flipped face-up: Change it to Defense Position. Once per turn: You can discard 1 Spell Card; Special Summon 1 Level 4 monster from your Deck. It cannot attack this turn.',
  effects: [
    { kind: 'continuous', mods: [{ q: 'cannotBeTributed' }] },
    {
      kind: 'trigger',
      event: ['normalSummoned', 'flipped'],
      mandatory: true,
      label: 'Change to Defense Position',
      categories: ['position'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.location === 'mzone' && ctx.self.faceUp && ctx.self.pos === 'atk',
      resolve: async (ctx) => {
        if (ctx.self.location === 'mzone' && ctx.self.faceUp && ctx.self.pos === 'atk') await ctx.changePos(ctx.self, 'def', true);
      },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Discard Spell: summon Level 4',
      categories: ['specialSummon', 'discard'],
      canActivate: (ctx) =>
        ctx.hand('me', (c) => c.isSpell).length > 0 &&
        ctx.canSpecialSummon() &&
        ctx.deck('me', (c) => c.isMonster && !c.isExtra && c.data.level === 4 && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        const d = await ctx.select(ctx.hand('me', (c) => c.isSpell), 1, 1, 'Discard 1 Spell Card.', 'discard', {
          aiScore: (c) => -(cardValue(ctx.game, c) + (c.data.aiValue ?? 0)),
        });
        if (!d.length) return false;
        await ctx.discard(d, 'cost');
      },
      resolve: async (ctx) => {
        const cands = ctx.deck('me', (c) => c.isMonster && !c.isExtra && c.data.level === 4 && ctx.canSummonCard(c));
        if (cands.length && ctx.canSpecialSummon()) {
          const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 Level 4 monster from your Deck.', 'specialSummon', {
            aiScore: (c) => (c.data.aiValue ?? 0) + (c.data.atk ?? 0) / 2,
          });
          const r = sel.length ? await ctx.specialSummon(sel[0]) : [];
          for (const m of r) m.flags.cannotAttackTurn = ctx.turn;
        }
        ctx.game.shuffleDeck(ctx.player);
      },
      ai: { score: (ctx) => (ctx.phase === 'main1' || ctx.phase === 'main2' ? 50 : 0) },
    },
  ],
});

/** Beast King Barbaros: a Tribute Summon with `n` Tributes (3: destroys all the opponent's cards). Never Special Summons. */
async function barbarosTributeSummon(ctx: Ctx, n: number): Promise<boolean> {
  const g = ctx.game;
  const p = ctx.player;
  const card = ctx.self;
  const trib = await ctx.select(g.tributeCandidates(p, card), n, n, `Select ${n} monsters to Tribute for ${card.name}.`, 'tribute');
  if (trib.length < n) return false;
  g.log(`${g.players[p].name} Tributes ${trib.map(nameOf).join(', ')}.`, 'action', p);
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
  card.flags.tributedMonsters = trib.map((t) => ({ uid: t.uid, attribute: t.data.attribute, name: t.name, race: t.data.race }));
  g.log(`${g.players[p].name} Tribute Summons ${card.name}.`, 'action', p);
  await g.anim({ type: 'summon', cards: [card.uid], method: 'tribute', from: ['hand'] });
  if (await g.summonNegationWindow([card], p, 'tribute')) return false;
  g.beginBatch();
  const common = { card, player: p, from: 'hand' as Location, to: 'mzone' as Location, tributes: trib, method: 'tribute' as const };
  g.emit({ type: 'normalSummoned', ...common });
  g.emit({ type: 'tributeSummoned', ...common });
  g.emit({ type: 'summoned', ...common });
  await g.processTriggers(true);
  // The summon is complete; tell the engine not to Special Summon anything.
  return false;
}

monster('Beast King Barbaros', {
  attribute: 'EARTH',
  race: 'Beast-Warrior',
  level: 8,
  atk: 3000,
  def: 1200,
  aiValue: 400,
  text: 'You can Normal Summon/Set this card without Tributing, but its original ATK becomes 1900. You can Tribute 3 monsters to Tribute Summon (but not Set) this card. If Summoned this way: Destroy all cards your opponent controls.',
  effects: [
    {
      // Workaround (same as Blackwing Armor Master): keep the noTribute flag set while in hand. Never forbids anything.
      kind: 'continuous',
      range: ['hand'],
      mods: [
        {
          q: 'cannotNormalSummon',
          to: 'players',
          filter: (ctx, p) => {
            if (p === ctx.player) ctx.self.flags.noTribute = true;
            return false;
          },
        },
      ],
    },
    {
      // "Its original ATK becomes 1900": set the original ATK (flags.baseAtk) when Normal Summoned / Set without
      // Tributes. Bookkeeping only, never builds a Chain Link; the flag clears when the card leaves the field.
      kind: 'trigger',
      event: ['normalSummoned', 'monsterSet'],
      eventFilter: (ctx, ev) => {
        if (ev.card === ctx.self && ctx.self.location === 'mzone' && !ctx.self.flags.tributeCount) ctx.self.flags.baseAtk = 1900;
        return false;
      },
    },
    {
      // The Tribute Summons are hand actions (the plain Summon action is the no-Tribute one): a regular Tribute Summon
      // that uses the Normal Summon and can be negated by Solemn Judgment.
      kind: 'proc',
      label: 'Tribute Summon (3 Tributes)',
      categories: ['destroy', 'destroyMulti'],
      condition: (ctx) =>
        ctx.game.hasNormalSummonFor(ctx.player, ctx.self, false) &&
        !ctx.game.queryPlayer(ctx.player, 'cannotNormalSummon') &&
        !ctx.game.queryCard(ctx.self, 'cannotBeSummoned') &&
        !ctx.game.queryCard(ctx.self, 'cannotTributeSummon') &&
        ctx.game.tributeCandidates(ctx.player, ctx.self).length >= 3,
      perform: (ctx) => barbarosTributeSummon(ctx, 3),
      ai: {
        score: (ctx) => {
          const opp = ctx.field('opp').reduce((a, c) => a + cardValue(ctx.game, c), 0);
          const cost = ctx.game
            .tributeCandidates(ctx.player, ctx.self)
            .map((c) => cardValue(ctx.game, c))
            .sort((a, b) => a - b)
            .slice(0, 3)
            .reduce((a, b) => a + b, 0);
          return ctx.field('opp').length >= 3 && opp > cost + 1500 ? 66 : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'tributeSummoned',
      mandatory: true,
      label: 'Destroy all opponent\'s cards',
      categories: ['destroy', 'destroyMulti'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && (ev.tributes?.length ?? 0) >= 3,
      resolve: async (ctx) => {
        const all = ctx.field('opp');
        if (all.length) await ctx.destroy(all);
      },
    },
    {
      // The standard 2-Tribute Tribute Summon of a Level 8 monster (3000 ATK, no destruction).
      kind: 'proc',
      label: 'Tribute Summon (2 Tributes)',
      condition: (ctx) =>
        ctx.game.hasNormalSummonFor(ctx.player, ctx.self, false) &&
        !ctx.game.queryPlayer(ctx.player, 'cannotNormalSummon') &&
        !ctx.game.queryCard(ctx.self, 'cannotBeSummoned') &&
        !ctx.game.queryCard(ctx.self, 'cannotTributeSummon') &&
        ctx.game.tributeCandidates(ctx.player, ctx.self).length >= 2,
      perform: (ctx) => barbarosTributeSummon(ctx, 2),
      ai: {
        score: (ctx) => {
          const cost = ctx.game
            .tributeCandidates(ctx.player, ctx.self)
            .map((c) => cardValue(ctx.game, c))
            .sort((a, b) => a - b)
            .slice(0, 2)
            .reduce((a, b) => a + b, 0);
          return cost < 1400 ? 45 : 0;
        },
      },
    },
  ],
});

/** Prisma: AI value of revealing Fusion monster `f` right now. */
function prismaPlan(ctx: Ctx, f: C): number {
  const mats = listedMaterials(f).filter((n) => ctx.deck('me', (c) => c.name === n).length > 0);
  if (!mats.length) return -1;
  const others = ctx.faceUpMonsters('me', (c) => c !== ctx.self);
  const gb = others.filter((c) => c.inSet('gladiator'));
  switch (f.name) {
    case 'Gladiator Beast Gyzarus':
      return gb.length >= 1 ? 90 : 40;
    case 'Gladiator Beast Heraklinos':
      return gb.length >= 2 ? 85 : 30;
    case 'Chimeratech Fortress Dragon': {
      const machines = ctx.faceUpMonsters('both', (c) => c !== ctx.self && c.data.race === 'Machine' && (c.controller === ctx.opp || !c.isExtra));
      return machines.some((c) => c.controller === ctx.opp) ? 80 : machines.length >= 2 ? 50 : 10;
    }
    default:
      return 20;
  }
}

monster('Elemental Hero Prisma', {
  attribute: 'LIGHT',
  race: 'Warrior',
  level: 4,
  atk: 1700,
  def: 1100,
  sets: ['hero', 'elemental-hero'],
  aiValue: 700,
  text: 'Once per turn: You can reveal 1 Fusion Monster in your Extra Deck and send 1 of the Fusion Materials whose name is specifically listed on it from your Deck to the GY. Until the End Phase, this card\'s name becomes that sent monster\'s name.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Reveal Fusion: send material, copy name',
      categories: ['mill'],
      canActivate: (ctx) => ctx.extra('me', (f) => f.hasType('fusion') && listedMaterials(f).some((n) => ctx.deck('me', (c) => c.name === n).length > 0)).length > 0,
      activate: async (ctx) => {
        const cands = ctx.extra('me', (f) => f.hasType('fusion') && listedMaterials(f).some((n) => ctx.deck('me', (c) => c.name === n).length > 0));
        const [f] = await ctx.select(cands, 1, 1, 'Reveal 1 Fusion Monster in your Extra Deck.', 'generic', { aiScore: (f) => prismaPlan(ctx, f) });
        if (!f) return false;
        ctx.log(`${ctx.game.players[ctx.player].name} reveals ${f.name}.`);
        ctx.data.fusion = f;
      },
      resolve: async (ctx) => {
        // 2010 ruling: if Prisma left the field or was flipped face-down, the effect does nothing (no monster is sent).
        // https://edisonrul.ing/cards/e/elemental-hero-prisma.html
        if (ctx.self.location !== 'mzone' || !ctx.self.faceUp) return;
        const f = ctx.data.fusion as C;
        const names = listedMaterials(f);
        const cands = ctx.deck('me', (c) => names.includes(c.name));
        if (!cands.length) return;
        const [m] = await ctx.select(cands, 1, 1, `Send 1 Fusion Material listed on ${f.name} to the GY.`, 'toGrave');
        if (!m) return;
        const name = m.name;
        await ctx.sendToGrave(m);
        if (ctx.self.location === 'mzone' && ctx.self.faceUp) {
          renameUntilEndPhase(ctx.game, ctx.self, name);
          ctx.log(`${ctx.self.data.name} is now treated as "${name}" until the End Phase.`);
        }
      },
      ai: {
        score: (ctx) => {
          if (ctx.phase !== 'main1' && ctx.phase !== 'main2') return 0;
          const best = Math.max(-1, ...ctx.extra('me', (f) => f.hasType('fusion')).map((f) => prismaPlan(ctx, f)));
          return best >= 80 ? 72 : best >= 20 ? 32 : 0;
        },
      },
    },
  ],
});

monster('Flamvell Firedog', {
  attribute: 'FIRE',
  race: 'Beast',
  level: 4,
  atk: 1900,
  def: 200,
  sets: ['flamvell'],
  aiValue: 300,
  text: 'When this card destroys an opponent\'s monster by battle and sends it to the GY: You can Special Summon 1 FIRE monster with 200 or less DEF from your Deck.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      when: true,
      label: 'Summon FIRE monster',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => selfDestroysByBattle(ctx, ev) && evc(ev)?.location === 'grave',
      canActivate: (ctx) =>
        ctx.canSpecialSummon() && ctx.deck('me', (c) => c.isMonster && !c.isExtra && c.data.attribute === 'FIRE' && (c.data.def ?? 0) <= 200 && ctx.canSummonCard(c)).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.deck('me', (c) => c.isMonster && !c.isExtra && c.data.attribute === 'FIRE' && (c.data.def ?? 0) <= 200 && ctx.canSummonCard(c));
        if (cands.length && ctx.canSpecialSummon()) {
          const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 FIRE monster with 200 or less DEF.', 'specialSummon');
          if (sel.length) await ctx.specialSummon(sel[0]);
        }
        ctx.game.shuffleDeck(ctx.player);
      },
    },
  ],
});

monster('Flamvell Magician', {
  attribute: 'FIRE',
  race: 'Spellcaster',
  level: 4,
  atk: 1400,
  def: 200,
  types: ['tuner'],
  sets: ['flamvell'],
  aiValue: 200,
  text: 'This card gains 400 ATK while you control a face-up "Ally of Justice" monster.',
  effects: [
    {
      kind: 'continuous',
      mods: [{ q: 'atk', value: (ctx) => (ctx.faceUpMonsters('me', (c) => c.inSet('ally-of-justice') || c.name.startsWith('Ally of Justice')).length ? 400 : 0) }],
    },
  ],
});

/** Legendary Jujitsu Master: remember which attack it is defending against (flags reset when it moves). */
const jujitsuAttacked = new WeakMap<C, { turn: number; attacker: number }>();
monster('Legendary Jujitsu Master', {
  attribute: 'EARTH',
  race: 'Rock',
  level: 3,
  atk: 1300,
  def: 1800,
  aiValue: 400,
  text: "A monster that battles with this Defense Position card is returned to the top of its owner's Deck at the end of the Damage Step.",
  effects: [
    {
      kind: 'trigger',
      event: 'attackDeclared',
      label: 'Jujitsu (bookkeeping)',
      eventFilter: (ctx, ev) => {
        if (ev.other === ctx.self && ctx.self.location === 'mzone' && ctx.self.pos === 'def') jujitsuAttacked.set(ctx.self, { turn: ctx.turn, attacker: (ev.card as C).uid });
        return false;
      },
    },
    {
      // https://edisonrul.ing/cards/l/legendary-jujitsu-master.html — a mandatory Trigger Effect in Substep 7 (End of the
      // Damage Step), even if this card is no longer face-up on the field (destroyed by that battle); it chains with
      // other triggers of that substep (Goyo Guardian, Mystic Tomato...). It needs this card in Defense Position at damage
      // calculation. Index 1 kept for saved duel logs.
      kind: 'trigger',
      event: 'damageStepEnd',
      mandatory: true,
      label: 'Return attacker to the Deck',
      categories: ['toDeck'],
      eventFilter: (ctx, ev) => {
        const a = evc(ev);
        jujitsuAttacked.delete(ctx.self);
        return (
          !!a &&
          ev.other === ctx.self &&
          a.location === 'mzone' &&
          ctx.game.battle?.calc?.targetPos === 'def' &&
          (ctx.self.location === 'grave' || ctx.self.location === 'banished' || (ctx.self.location === 'mzone' && !ctx.game.isNegated(ctx.self)))
        );
      },
      resolve: async (ctx) => {
        const a = evc(ctx.event!);
        if (a && a.location === 'mzone') await ctx.toDeck(a, 'top');
      },
    },
  ],
});

// ============================================================ EXTRA DECK

monster('Drill Warrior', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 6,
  atk: 2400,
  def: 2000,
  types: ['synchro'],
  aiValue: 600,
  text: '"Drill Synchron" + 1 or more non-Tuner monsters\nOnce per turn, during your Main Phase, you can halve this card\'s ATK (permanently). If you do, it can attack your opponent directly this turn. Once per turn, during your Main Phase, you can discard 1 card and remove this card from play. During your next Standby Phase, Special Summon this card, if removed by this effect. Then, add 1 Monster Card from your Graveyard to your hand.',
  synchro: { tuner: synchronNamed('Drill Synchron'), desc: '"Drill Synchron" + 1+ non-Tuner monsters' },
  effects: [
    {
      kind: 'ignition',
      opt: true, // "Once per turn" per copy (Edison and modern text alike), not by name
      label: 'Halve ATK: attack directly',
      categories: ['atkChange'],
      // 2010 text and rulings: during your Main Phase; the ATK stays halved while it is face-up on the field (not
      // just this turn). https://edisonrul.ing/cards/d/drill-warrior.html
      condition: (ctx) => (ctx.phase === 'main1' || ctx.phase === 'main2') && ctx.self.faceUp,
      resolve: async (ctx) => {
        if (ctx.self.location !== 'mzone' || !ctx.self.faceUp) return;
        ctx.addTempMod(ctx.self, 'atk', -Math.floor(ctx.atk(ctx.self) / 2), 'field');
        ctx.addTempMod(ctx.self, 'directAttack', true, 'turn');
      },
      ai: {
        score: (ctx) => {
          if (ctx.game.turn <= 1 || ctx.self.attacksThisTurn > 0) return 0;
          const blockers = ctx.monsters('opp');
          if (!blockers.length) return 0;
          const beatsAll = blockers.every((m) => m.faceUp && (m.pos === 'atk' ? ctx.atk(m) : ctx.def(m)) < ctx.atk(ctx.self));
          return beatsAll ? 0 : 40;
        },
      },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Discard: banish until next Standby Phase',
      categories: ['banish', 'toHand', 'discard'],
      // 2010 rulings: discarding is part of the effect, not a cost: you discard even if this card left the field (or
      // cannot be banished), and if you cannot discard, this card is not banished. https://edisonrul.ing/cards/d/drill-warrior.html
      condition: (ctx) => ctx.phase === 'main1' || ctx.phase === 'main2',
      canActivate: (ctx) => ctx.hand().length > 0,
      resolve: async (ctx) => {
        const me = ctx.self;
        const d = await ctx.select(ctx.hand(), 1, 1, 'Discard 1 card.', 'discard', { aiScore: (c) => -cardValue(ctx.game, c) });
        if (!d.length) return;
        await ctx.discard(d);
        if (me.location !== 'mzone') return;
        const r = await ctx.banish(me);
        if (!r.length || (me.location as Location) !== 'banished') return;
        // ③ is a mandatory Trigger Effect in the banished zone at its owner's next Standby Phase (below).
        me.flags.drillReturn = { mid: me.moveId, turn: ctx.game.turn };
      },
      ai: {
        score: (ctx) => {
          if (ctx.phase !== 'main2' || !ctx.isMyTurn) return 0;
          const best = Math.max(0, ...ctx.grave('me', (c) => c.isMonster).map((c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0)));
          const worstHand = Math.min(...ctx.hand().map((c) => cardValue(ctx.game, c)));
          return best >= 1500 && worstHand < best ? 35 : 0;
        },
      },
    },
    {
      // https://edisonrul.ing/cards/d/drill-warrior.html — the ③ mandatory Trigger Effect activates & resolves in the
      // banished zone and "will start a chain at any point during the Standby Phase" (not a chainless return): it is not
      // negated by Skill Drain, but "If this effect is negated (by 'Royal Oppression'), 'Drill Warrior' remains removed
      // from play and cannot activate this effect again". With all Monster Zones full it is sent to the GY instead and no
      // monster is added. FIRST Special Summon, THEN add 1 monster from the GY (not optional).
      kind: 'trigger',
      event: 'phaseStart',
      range: ['banished'],
      mandatory: true,
      label: 'Return and add 1 monster from the GY',
      categories: ['specialSummon', 'toHand'],
      eventFilter: (ctx, ev) => {
        const d = ctx.self.flags.drillReturn as { mid: number; turn: number } | undefined;
        return ev.phase === 'standby' && !!d && d.mid === ctx.self.moveId && ctx.game.turnPlayer === ctx.self.owner && ctx.game.turn > d.turn;
      },
      activate: async (ctx) => {
        // Activated once: a negated activation does not try again.
        delete ctx.self.flags.drillReturn;
      },
      resolve: async (ctx) => {
        const me = ctx.self;
        const owner = me.owner;
        const game = ctx.game;
        if (me.location !== 'banished') return;
        if (game.freeMZones(owner) <= 0) {
          await game.sendToGrave([me], 'rule', owner, me);
          return;
        }
        const back = await game.specialSummon([me], owner, { pos: 'atk', ignoreConditions: true, reasonCard: me });
        if (!back.length) return;
        const g = game.zone(owner, 'grave').filter((c) => c.isMonster);
        if (g.length) {
          const sel = await game.select(owner, g, 1, 1, 'Add 1 monster from your GY to your hand.', 'toHand', { source: me });
          if (sel.length) await game.toHand(sel, 'effect', owner, me);
        }
      },
    },
  ],
});

monster('Junk Archer', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 7,
  atk: 2300,
  def: 2000,
  types: ['synchro'],
  aiValue: 700,
  text: '"Junk Synchron" + 1 or more non-Tuner monsters\nOnce per turn, you can select 1 monster your opponent controls. Remove that monster from play. During the End Phase of this turn, it returns to your opponent\'s side of the field, in the same Battle Position.',
  synchro: { tuner: synchronNamed('Junk Synchron'), desc: '"Junk Synchron" + 1+ non-Tuner monsters' },
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Banish 1 monster until End Phase',
      categories: ['banish'],
      canActivate: (ctx) => ctx.monsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.monsters('opp'), 1, 1, 'Target 1 monster your opponent controls to banish until the End Phase.', 'banish');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone');
        if (!t.length) return;
        const m = t[0];
        const pos = m.pos;
        const faceDown = !m.faceUp;
        const owner = m.owner;
        // https://edisonrul.ing/cards/j/junk-archer.html — a face-down target is banished face-down and returns face-down;
        // it returns without starting a Chain and this is not treated as a Special Summon (a Token does not return).
        const r = await ctx.banish(m, 'effect', faceDown);
        if (!r.length || m.location !== 'banished' || m.isToken) return;
        const mid = m.moveId;
        const game = ctx.game;
        ctx.later('end', async () => {
          if (m.location !== 'banished' || m.moveId !== mid) return;
          if (game.freeMZones(owner) <= 0) {
            await game.sendToGrave([m], 'rule');
            return;
          }
          game.beginBatch();
          game.rawMove(m, 'mzone', { controller: owner, faceUp: !faceDown, pos });
          game.log(`${m.name} returns to the field.`, 'action', owner);
          await game.anim({ type: 'move', cards: [{ uid: m.uid, from: 'banished', to: 'mzone', ctrl: owner }] });
          game.update();
        });
      },
      ai: {
        score: (ctx) => {
          if (ctx.phase !== 'main1' || ctx.game.turn <= 1) return 0;
          const best = bestTarget(ctx.game, ctx.monsters('opp', (c) => ctx.canTarget(c)));
          return best && cardValue(ctx.game, best) >= 1200 ? 55 : 0;
        },
      },
    },
  ],
});

/** Chimeratech Fortress Dragon: number of materials used, keyed by card uid, until its summon event is seen. */
const cfdPending = new Map<number, number>();
const isCyberDragonName = (c: C) => c.name === 'Cyber Dragon';
/** Monsters that may be sent for Chimeratech Fortress Dragon: any of yours, face-up ones of your opponent. */
const cfdPool = (ctx: Ctx) => ctx.monsters('both', (c) => c.controller === ctx.player || c.faceUp);
const cfdMachine = (c: C) => c.data.race === 'Machine';
/**
 * "Cyber Dragon"s that can start the Contact Fusion: another Machine is available, and when your Monster Zones are
 * full, one of the two is yours (sending only your opponent's monsters would leave no room for this card).
 */
const cfdCyberDragons = (ctx: Ctx) => {
  const pool = cfdPool(ctx);
  const full = ctx.freeMZones('me') <= 0;
  return pool.filter((cd) => isCyberDragonName(cd) && pool.some((m) => m !== cd && cfdMachine(m) && (!full || cd.controller === ctx.player || m.controller === ctx.player)));
};

monster('Chimeratech Fortress Dragon', {
  attribute: 'DARK',
  race: 'Machine',
  level: 8,
  atk: 0,
  def: 0,
  types: ['fusion'],
  nomi: true,
  sets: ['cyber'],
  aiValue: 900,
  text: '"Cyber Dragon" + 1 or more Machine monsters\nMust first be Special Summoned (from your Extra Deck) by sending the above cards from either field to the GY. (You do not use "Polymerization".) The original ATK of this card becomes 1000 x the number of Fusion Materials used for its Special Summon.',
  fusion: { materials: [isCyberDragonName, cfdMachine], noPoly: true, desc: '"Cyber Dragon" + 1+ Machine monsters' },
  effects: [
    {
      kind: 'proc',
      range: ['extra'],
      label: 'Contact Fusion',
      categories: ['specialSummon'],
      condition: (ctx) => cfdCyberDragons(ctx).length > 0,
      perform: async (ctx) => {
        const pool = cfdPool(ctx);
        const mine = (c: C) => c.controller === ctx.player;
        const cds = cfdCyberDragons(ctx);
        const [cd] = await ctx.select(cds, 1, 1, 'Select "Cyber Dragon" to send to the GY.', 'material', {
          aiScore: (c) => (c.controller === ctx.opp ? 5000 : 0) - cardValue(ctx.game, c),
        });
        if (!cd) return false;
        const machines = pool.filter((m) => m !== cd && cfdMachine(m));
        const machineScore = (c: C) => (c.controller === ctx.opp ? 5000 + cardValue(ctx.game, c) : 900 - cardValue(ctx.game, c));
        // With every Monster Zone full, one of the materials must be yours, or there is no room for this card.
        const first: C[] = [];
        if (ctx.freeMZones('me') <= 0 && !mine(cd)) {
          first.push(
            ...(await ctx.select(machines.filter(mine), 1, 1, 'Your Monster Zones are full: select 1 Machine monster you control to send to the GY.', 'material', {
              aiScore: (c) => 900 - cardValue(ctx.game, c),
            })),
          );
          if (!first.length) return false;
        }
        const rest = machines.filter((m) => !first.includes(m));
        const more = [
          ...first,
          ...(await ctx.select(rest, first.length ? 0 : 1, rest.length, first.length ? 'Select any other Machine monsters to send to the GY.' : 'Select 1 or more Machine monsters to send to the GY.', 'material', {
            aiScore: machineScore,
          })),
        ];
        if (!more.length) return false;
        const mats = [cd, ...more];
        ctx.log(`${ctx.game.players[ctx.player].name} sends ${mats.map(nameOf).join(', ')} to the GY.`);
        await ctx.game.moveCards(mats, 'grave', { reason: 'material', reasons: ['material', 'fusion'], reasonPlayer: ctx.player, reasonCard: ctx.self });
        cfdPending.set(ctx.self.uid, mats.length);
        return true;
      },
      ai: {
        score: (ctx) => {
          const pool = cfdPool(ctx);
          const theirs = pool.filter((c) => c.controller === ctx.opp && cfdMachine(c));
          if (theirs.length) return 75 + theirs.length * 5;
          const mine = pool.filter((c) => c.controller === ctx.player && cfdMachine(c));
          const cost = mine.reduce((a, c) => a + cardValue(ctx.game, c), 0);
          return mine.length >= 3 && 1000 * mine.length > cost + 600 ? 45 : 0;
        },
      },
    },
    {
      // Bookkeeping: fix the original ATK once it has been Special Summoned (never builds a chain link).
      kind: 'trigger',
      event: 'specialSummoned',
      eventFilter: (ctx, ev) => {
        if (ev.card === ctx.self && cfdPending.has(ctx.self.uid)) {
          ctx.self.flags.baseAtk = 1000 * (cfdPending.get(ctx.self.uid) ?? 0);
          cfdPending.delete(ctx.self.uid);
        }
        return false;
      },
    },
  ],
});

monster('Flamvell Uruquizas', {
  attribute: 'FIRE',
  race: 'Pyro',
  level: 6,
  atk: 2100,
  def: 400,
  types: ['synchro'],
  sets: ['flamvell'],
  aiValue: 400,
  text: '1 Tuner + 1 or more non-Tuner monsters\nIf this card attacks a Defense Position monster, inflict piercing battle damage. Each time this card inflicts battle damage to your opponent: it gains 300 ATK.',
  synchro: { desc: '1 Tuner + 1+ non-Tuner monsters' },
  effects: [
    { kind: 'continuous', mods: [{ q: 'piercing' }] },
    {
      kind: 'trigger',
      event: 'battleDamage',
      range: ['mzone'],
      mandatory: true,
      label: 'Gain 300 ATK',
      categories: ['atkChange'],
      eventFilter: (ctx, ev) => ev.player === ctx.opp && ev.reasonCard === ctx.self,
      resolve: async (ctx) => {
        if (ctx.self.location === 'mzone' && ctx.self.faceUp) ctx.addTempMod(ctx.self, 'atk', 300, 'field');
      },
    },
  ],
});

monster('Road Warrior', {
  attribute: 'LIGHT',
  race: 'Warrior',
  level: 8,
  atk: 3000,
  def: 1500,
  types: ['synchro'],
  aiValue: 800,
  text: '"Road Synchron" + 2 or more non-Tuner monsters\nOnce per turn: You can Special Summon 1 Level 2 or lower Warrior or Machine monster from your Deck.',
  synchro: { tuner: synchronNamed('Road Synchron'), minNonTuners: 2, desc: '"Road Synchron" + 2+ non-Tuner monsters' },
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Summon Level 2 Warrior/Machine',
      categories: ['specialSummon'],
      canActivate: (ctx) =>
        ctx.canSpecialSummon() &&
        ctx.deck('me', (c) => c.isMonster && !c.isExtra && (c.data.level ?? 0) <= 2 && (c.data.race === 'Warrior' || c.data.race === 'Machine') && ctx.canSummonCard(c)).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.deck('me', (c) => c.isMonster && !c.isExtra && (c.data.level ?? 0) <= 2 && (c.data.race === 'Warrior' || c.data.race === 'Machine') && ctx.canSummonCard(c));
        if (cands.length && ctx.canSpecialSummon()) {
          const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 Level 2 or lower Warrior or Machine monster.', 'specialSummon');
          if (sel.length) await ctx.specialSummon(sel[0]);
        }
        ctx.game.shuffleDeck(ctx.player);
      },
      ai: { score: () => 50 },
    },
  ],
});

monster('Zeman the Ape King', {
  attribute: 'EARTH',
  race: 'Beast',
  level: 7,
  atk: 2500,
  def: 1800,
  types: ['synchro'],
  aiValue: 800,
  // ABPF: official text / materials (exactly 1 non-Tuner Beast-Type monster).
  text: '1 DARK Tuner + 1 non-Tuner Beast-Type monster\nIf this card attacks, your opponent cannot activate any Spell or Trap Cards until the end of the Damage Step. When an opponent\'s monster declares an attack, you can select that monster and send 1 monster from your hand or your side of the field to the Graveyard to negate the attack.',
  synchro: { tuner: attr('DARK'), nonTuner: race('Beast'), minNonTuners: 1, maxNonTuners: 1, desc: '1 DARK Tuner + 1 non-Tuner Beast-Type monster' },
  effects: [
    {
      kind: 'continuous',
      mods: [
        { q: 'cannotActivateSpells', to: 'players', filter: (ctx, p) => p === ctx.opp && ctx.game.battle?.attacker === ctx.self },
        { q: 'cannotActivateTraps', to: 'players', filter: (ctx, p) => p === ctx.opp && ctx.game.battle?.attacker === ctx.self },
      ],
    },
    {
      kind: 'quick',
      label: 'Send a monster: negate attack',
      categories: ['negateAttack'],
      condition: (ctx) => {
        const b = ctx.battle;
        return !ctx.isMyTurn && !!b && !b.negated && !b.inDamageStep && b.attacker.controller === ctx.opp && ctx.self.faceUp;
      },
      // https://edisonrul.ing/cards/z/zeman-the-ape-king.html — the effect that negates an attack targets the attacking
      // monster; sending a (face-up / face-down) monster is a cost.
      canActivate: (ctx) => ctx.cards('me', ['hand', 'mzone'], (c) => c.isMonster && c !== ctx.self).length > 0 && !!ctx.battle && ctx.canTarget(ctx.battle.attacker),
      activate: async (ctx) => {
        const cost = await ctx.select(ctx.cards('me', ['hand', 'mzone'], (c) => c.isMonster && c !== ctx.self), 1, 1, 'Send 1 monster from your hand or field to the GY.', 'cost');
        if (!cost.length) return false;
        await ctx.sendToGrave(cost, 'cost');
        if (ctx.battle) ctx.addTargets([ctx.battle.attacker]);
      },
      resolve: async (ctx) => {
        const b = ctx.battle;
        if (b && !b.negated && ctx.validTargets((c) => c.location === 'mzone').includes(b.attacker)) ctx.negateAttack();
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b) return 0;
          const t = b.target;
          const cheapest = Math.min(...ctx.cards('me', ['hand', 'mzone'], (c) => c.isMonster && c !== ctx.self).map((c) => cardValue(ctx.game, c)));
          if (!t) return ctx.atk(b.attacker) >= 1800 && cheapest < 1500 ? 50 : 0;
          if (t.controller !== ctx.player) return 0;
          const theirs = ctx.atk(b.attacker);
          const mine = t.faceUp ? (t.pos === 'atk' ? ctx.atk(t) : ctx.def(t)) : 0;
          return theirs > mine && cardValue(ctx.game, t) > cheapest ? 55 : 0;
        },
      },
    },
  ],
});

// ============================================================ SPELLS

spell('Hammer Shot', 'normal', {
  text: 'Destroy the face-up Attack Position monster with the highest ATK on the field (your choice if tied).',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => c.pos === 'atk').length > 0,
      resolve: async (ctx) => {
        const mons = ctx.faceUpMonsters('both', (c) => c.pos === 'atk');
        if (!mons.length) return;
        const hi = Math.max(...mons.map((c) => ctx.atk(c)));
        const sel = await ctx.select(mons.filter((c) => ctx.atk(c) === hi), 1, 1, 'Destroy the Attack Position monster with the highest ATK.', 'destroy');
        await ctx.destroy(sel);
      },
      ai: {
        score: (ctx) => {
          const mons = ctx.faceUpMonsters('both', (c) => c.pos === 'atk');
          if (!mons.length) return 0;
          const hi = Math.max(...mons.map((c) => ctx.atk(c)));
          const top = mons.filter((c) => ctx.atk(c) === hi);
          if (top.some((c) => c.controller === ctx.player)) return 0;
          return 45 + Math.max(...top.map((c) => cardValue(ctx.game, c))) / 150;
        },
      },
    },
  ],
});

spell('Burden of the Mighty', 'continuous', {
  text: 'All face-up monsters your opponent controls lose 100 ATK for each of their Levels.',
  effects: [
    {
      kind: 'activate',
      categories: ['atkChange'],
      ai: {
        score: (ctx) => {
          if (ctx.spellTraps('me', (c) => c !== ctx.self && c.name === ctx.self.name && c.faceUp).length) return 0;
          const lv = ctx.faceUpMonsters('opp').reduce((a, c) => a + ctx.level(c), 0);
          return lv >= 4 ? 38 + lv : 0;
        },
      },
    },
    {
      kind: 'continuous',
      mods: [
        {
          q: 'atk',
          to: 'cards',
          filter: (ctx, c: C) => c.location === 'mzone' && c.faceUp && c.controller === ctx.opp,
          value: (ctx, c: C) => -100 * (c.data.level ?? 0),
        },
      ],
    },
  ],
});

spell('Creature Swap', 'normal', {
  text: 'Each player chooses 1 monster they control and switches control of those monsters with each other. Those monsters cannot change their battle positions for the rest of this turn.',
  effects: [
    {
      kind: 'activate',
      categories: ['control'],
      canActivate: (ctx) => ctx.monsters('me').length > 0 && ctx.monsters('opp').length > 0,
      resolve: async (ctx) => {
        if (!ctx.monsters('me').length || !ctx.monsters('opp').length) return;
        const [mine] = await ctx.select(ctx.monsters('me'), 1, 1, 'Choose 1 monster you control to give to your opponent.', 'cost');
        const [theirs] = await ctx.select(ctx.monsters('opp'), 1, 1, 'Creature Swap: choose 1 monster you control to give to your opponent.', 'cost', { player: ctx.opp });
        if (!mine || !theirs) return;
        const g = ctx.game;
        // Order the hand-over so that a full field does not block the swap.
        if (ctx.freeMZones('opp') > 0) {
          await g.takeControl(mine, ctx.opp, false);
          await g.takeControl(theirs, ctx.player, false);
        } else {
          await g.takeControl(theirs, ctx.player, false);
          await g.takeControl(mine, ctx.opp, false);
        }
        for (const m of [mine, theirs]) if (m.location === 'mzone') ctx.addTempMod(m, 'cannotChangePos', true, 'turn');
      },
      ai: {
        score: (ctx) => {
          const worstMine = Math.min(...ctx.monsters('me').map((c) => cardValue(ctx.game, c)));
          const worstTheirs = Math.min(...ctx.monsters('opp').map((c) => cardValue(ctx.game, c)));
          return worstTheirs > worstMine + 600 ? 40 : 0;
        },
      },
    },
  ],
});

spell('Soul Taker', 'normal', {
  text: 'Target 1 face-up monster your opponent controls; destroy that target, then your opponent gains 1000 LP.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'recover'],
      canActivate: (ctx) => ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('opp'), 1, 1, 'Target 1 face-up monster your opponent controls.', 'destroy');
      },
      resolve: async (ctx) => {
        // Rulings audit: if the only target is gone (or no longer face-up), the effect does nothing (no LP gain).
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp);
        if (!t.length) return;
        await ctx.destroy(t);
        await ctx.recover(ctx.opp, 1000);
      },
      ai: {
        score: (ctx) => {
          const best = bestTarget(ctx.game, ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)));
          return best && cardValue(ctx.game, best) >= 1500 ? 44 + cardValue(ctx.game, best) / 200 : 0;
        },
      },
    },
  ],
});

const rekindlable = (ctx: Ctx) => ctx.grave('me', (c) => c.isMonster && !c.isExtra && c.data.attribute === 'FIRE' && c.data.def === 200 && ctx.canSummonCard(c));
spell('Rekindling', 'normal', {
  text: 'Special Summon from your Graveyard as many FIRE monsters as possible with 200 DEF. During the End Phase, remove from play all monsters that were Special Summoned by this effect.',
  // https://edisonrul.ing/cards/r/rekindling.html — it does not target and is not negated by "Necrovalley" (the
  // general 2010 rule in src/cards/necrovalley.ts).
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && rekindlable(ctx).length > 0,
      resolve: async (ctx) => {
        const cands = rekindlable(ctx);
        const n = Math.min(cands.length, ctx.freeMZones());
        if (n <= 0 || !ctx.canSpecialSummon()) return;
        const sel = n === cands.length ? cands : await ctx.select(cands, n, n, `Special Summon ${n} FIRE monster(s) with 200 DEF.`, 'specialSummon');
        const r = await ctx.specialSummon(sel);
        const game = ctx.game;
        // https://edisonrul.ing/cards/r/rekindling.html — a Summoned monster flipped face-down is not banished.
        for (const m of r) {
          const id = m.moveId;
          const fid = m.faceUpId;
          ctx.later('end', async () => {
            if (m.location === 'mzone' && m.moveId === id && m.faceUpId === fid && m.faceUp) await game.banish([m], 'effect', ctx.player, ctx.self);
          });
        }
      },
      ai: { score: (ctx) => (ctx.phase === 'main1' && rekindlable(ctx).length >= 2 ? 55 : 0) },
    },
  ],
});

/** Prohibition: name declared by this copy (stored on the card while it stays face-up). */
const prohibited = (ctx: Ctx): string | undefined => (stActive(ctx) ? (ctx.self.flags.prohibitedName as string | undefined) : undefined);
/**
 * https://edisonrul.ing/cards/p/prohibition.html — "Cards on the field before this card was activated are not affected
 * (including face-down cards)": such a card stays usable while it remains on the field, and its effects in the GY /
 * removed from play can still activate; once it is Summoned again it is affected.
 */
const prohibitionExempt = (ctx: Ctx, c: C) => {
  const snap = ctx.self.flags.prohibitionExempt as Record<number, number> | undefined;
  return !!snap && snap[c.uid] !== undefined && (!c.onField || c.moveId === snap[c.uid]);
};
/** The declared name, for a card that is not exempt. */
const prohibitedFor = (ctx: Ctx, c: C) => {
  const n = prohibited(ctx);
  return !!n && c.data.name === n && !prohibitionExempt(ctx, c);
};
spell('Prohibition', 'continuous', {
  text: 'When you activate this card, declare 1 card name. Cards with that name and their effects cannot be used. Cards on the field before this card was activated are not affected (including face-down cards).',
  effects: [
    {
      kind: 'activate',
      categories: ['lockdown'],
      activate: async (ctx) => {
        const snap: Record<number, number> = {};
        for (const c of ctx.game.allFieldCards()) if (c !== ctx.self) snap[c.uid] = c.moveId;
        ctx.data.exempt = snap;
      },
      resolve: async (ctx) => {
        ctx.self.flags.prohibitionExempt = ctx.data.exempt ?? {};
        // Candidates: every card name in the opponent's Deck list (main + Extra), most valuable first.
        const seen = new Map<string, number>();
        for (const c of ctx.cards('opp', ['deck', 'hand', 'mzone', 'szone', 'fzone', 'grave', 'banished', 'extra'] as Location[])) {
          if (c.isToken) continue;
          seen.set(c.data.name, (seen.get(c.data.name) ?? 0) + 1000 + (c.data.aiValue ?? 0) + (c.data.atk ?? 0) / 2 + (c.location === 'deck' || c.location === 'hand' || c.location === 'extra' ? 500 : 0));
        }
        const names = [...seen.keys()].sort((a, b) => (seen.get(b) ?? 0) - (seen.get(a) ?? 0));
        if (!names.length) return;
        const i = await ctx.option('Declare 1 card name.', names, (k) => names.length - k);
        ctx.self.flags.prohibitedName = names[i] ?? names[0];
        ctx.log(`${ctx.game.players[ctx.player].name} declares "${ctx.self.flags.prohibitedName}".`);
      },
      ai: { score: (ctx) => (ctx.phase === 'main1' || ctx.phase === 'main2' ? 22 : 0) },
    },
    {
      // Activations of the declared card (or its effects) are negated.
      kind: 'trigger',
      event: 'chainActivated',
      label: 'Prohibition (negate)',
      eventFilter: (ctx, ev) => {
        const link = ev.data?.link as ChainLink | undefined;
        if (link && !link.negated && prohibitedFor(ctx, link.card)) ctx.game.negateLink(link, false, ctx.self);
        return false;
      },
    },
    { kind: 'continuous', mods: [{ q: 'cannotAttack', to: 'cards', filter: (ctx, c: C) => prohibitedFor(ctx, c) }] },
    summonLock('Prohibition (no Summon)', (ctx, c) => c.data.name === prohibited(ctx)),
  ],
});

// ============================================================ TRAPS

// ABPF: Consecrated Light (ABPF-EN035) is a LIGHT Fairy Effect Monster, not a Continuous Trap (YGOJSON, passcode 02980764).
const consecratedActive = (ctx: Ctx) => ctx.self.location === 'mzone' && ctx.self.faceUp && !ctx.game.isNegated(ctx.self);
const battlingDark = (ctx: Ctx) => {
  const b = ctx.game.battle;
  const o = !b ? null : b.attacker === ctx.self ? b.target : b.target === ctx.self ? b.attacker : null;
  return !!o && o.data.attribute === 'DARK';
};
monster('Consecrated Light', {
  attribute: 'LIGHT',
  race: 'Fairy',
  level: 1,
  atk: 0,
  def: 0,
  aiValue: 600,
  text: 'Neither player can Normal or Special Summon DARK monsters or declare an attack with a DARK monster. This card cannot be destroyed by battle with a DARK monster, also you take no battle damage from that battle.',
  effects: [
    {
      kind: 'continuous',
      mods: [
        { q: 'cannotAttack', to: 'cards', filter: (_ctx, c: C) => c.location === 'mzone' && c.data.attribute === 'DARK' },
        { q: 'indestructibleBattle', value: (ctx) => battlingDark(ctx) },
        { q: 'noBattleDamageFrom', value: (ctx) => battlingDark(ctx) },
      ],
    },
    {
      // "Neither player can Normal or Special Summon DARK monsters": the Summons are not allowed at all (Sets are).
      kind: 'continuous',
      mods: [{ q: 'cannotBeSummoned', to: 'cards', filter: (_ctx, c: C) => c.isMonster && c.data.attribute === 'DARK' }],
    },
  ],
});

/** Would chain link `l` destroy a monster on the field? */
function destroysMonsters(ctx: Ctx, l: ChainLink, side: 'me' | 'both' = 'both') {
  const cats = l.effect.categories ?? [];
  if (!cats.includes('destroy') && !cats.includes('destroyMulti')) return false;
  const mons = ctx.monsters(side);
  if (!mons.length) return false;
  if (l.ctx.targets.length) return l.ctx.targets.some((t) => t.location === 'mzone' && mons.includes(t));
  return true;
}

trap('My Body as a Shield', 'normal', {
  text: 'When a Spell/Trap Card or monster effect that would destroy a monster(s) on the field is activated: Pay 1500 LP; negate the activation, and if you do, destroy that card.',
  effects: [
    {
      kind: 'activate',
      categories: ['negate', 'protect'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && !l.negated && l.card !== ctx.self && destroysMonsters(ctx, l);
      },
      canActivate: (ctx) => ctx.lp > 1500,
      activate: async (ctx) => {
        await ctx.payLp(1500);
      },
      resolve: async (ctx) => {
        await ctx.negateAndDestroy(ctx.prevLink());
      },
      ai: {
        score: (ctx) => {
          const l = oppTop(ctx);
          if (!l || ctx.lp <= 2500 || !destroysMonsters(ctx, l, 'me')) return 0;
          const at = l.ctx.targets.length ? l.ctx.targets.filter((t) => t.controller === ctx.player) : ctx.monsters('me');
          const v = at.reduce((a, c) => a + cardValue(ctx.game, c), 0);
          return v >= 1800 ? 60 + v / 200 : 0;
        },
      },
    },
  ],
});

const sysDownTargets = (ctx: Ctx) => [
  ...ctx.faceUpMonsters('opp', (c) => c.data.race === 'Machine'),
  ...ctx.grave('opp', (c) => c.isMonster && c.data.race === 'Machine'),
];
trap('System Down', 'normal', {
  text: 'Pay 1000 LP; banish all Machine monsters your opponent controls and in their GY.',
  effects: [
    {
      kind: 'activate',
      categories: ['banish'],
      canActivate: (ctx) => ctx.lp > 1000 && sysDownTargets(ctx).length > 0,
      activate: async (ctx) => {
        await ctx.payLp(1000);
      },
      resolve: async (ctx) => {
        const t = sysDownTargets(ctx);
        if (t.length) await ctx.banish(t);
      },
      ai: {
        score: (ctx) => {
          const field = ctx.faceUpMonsters('opp', (c) => c.data.race === 'Machine').reduce((a, c) => a + cardValue(ctx.game, c), 0);
          const grave = ctx.grave('opp', (c) => c.isMonster && c.data.race === 'Machine').length;
          if (ctx.lp <= 2000) return 0;
          if (field >= 1800 || (field > 0 && grave >= 2)) return 55 + field / 200;
          return !ctx.isMyTurn && ctx.phase === 'end' && noChain(ctx) && grave >= 4 ? 35 : 0;
        },
      },
    },
  ],
});

/** Chain link `l` is a monster effect activated because a monster was Summoned with one of `methods`. */
function summonTriggered(l: ChainLink | undefined, methods: string[]) {
  if (!l || l.negated || !l.card.isMonster || l.isCardActivation) return false;
  const ev = l.ctx.event;
  if (!ev) return false;
  if (ev.type === 'normalSummoned' || ev.type === 'tributeSummoned') return methods.includes('normal');
  if (ev.type === 'specialSummoned' || ev.type === 'synchroSummoned' || ev.type === 'fusionSummoned') return methods.includes('special');
  if (ev.type === 'summoned') return !!ev.method && (methods.includes(ev.method) || (ev.method === 'tribute' && methods.includes('normal')) || (['synchro', 'fusion', 'ritual'].includes(ev.method) && methods.includes('special')));
  return false;
}
function rugTrap(name: string, methods: string[], what: string) {
  trap(name, 'counter', {
    text: `When a monster effect is activated because a monster was ${what}: Negate the activation, and if you do, destroy that monster.`,
    effects: [
      {
        kind: 'activate',
        categories: ['negate', 'destroy'],
        condition: (ctx) => summonTriggered(ctx.prevLink(), methods),
        resolve: async (ctx) => {
          await ctx.negateAndDestroy(ctx.prevLink());
        },
        ai: {
          score: (ctx) => {
            const l = oppTop(ctx);
            if (!l || !summonTriggered(l, methods)) return 0;
            return 55 + Math.min(40, cardValue(ctx.game, l.card) / 100);
          },
        },
      },
    ],
  });
}
rugTrap('Pulling the Rug', ['normal'], 'Normal Summoned');
rugTrap('Swallow Flip', ['special'], 'Special Summoned');

/**
 * Light-Imprisoning Mirror watches a chain link: a LIGHT monster effect activated on the field or in the GY is
 * negated when it resolves if a Mirror applies at that moment.
 */
function mirrorWatch(game: Game, link: ChainLink & { mirrorWatch?: boolean }) {
  const c = link.card;
  if (link.mirrorWatch || link.isCardActivation || !c.isMonster || c.data.attribute !== 'LIGHT') return;
  if (!(link.fromLocation === 'mzone' || link.fromLocation === 'grave' || c.location === 'grave')) return;
  link.mirrorWatch = true;
  const orig = link.effect;
  link.effect = {
    ...orig,
    resolve: async (c2) => {
      const mirror = game.allFieldCards().find((m) => m.name === 'Light-Imprisoning Mirror' && m.faceUp && m.activeOnField && !game.isNegated(m));
      if (mirror) {
        game.log(`${c.name}'s effect is negated by ${mirror.name}.`, 'chain');
        void game.anim({ type: 'negate', card: c.uid });
        return;
      }
      if (orig.resolve) await orig.resolve(c2);
    },
  };
}

trap('Light-Imprisoning Mirror', 'continuous', {
  text: 'Negate the effects of LIGHT monsters that are activated on the field or in the GY.',
  effects: [
    {
      kind: 'activate',
      categories: ['lockdown', 'negate'],
      // Chained to a LIGHT monster effect: that effect is negated when it resolves after this card.
      resolve: async (ctx) => {
        for (const l of ctx.game.chain) if (l !== ctx.link) mirrorWatch(ctx.game, l);
      },
      ai: {
        score: (ctx) => {
          if (ctx.spellTraps('me', (c) => c !== ctx.self && c.name === ctx.self.name && c.faceUp).length) return 0;
          const l = oppTop(ctx);
          if (l && !l.isCardActivation && l.card.data.attribute === 'LIGHT') return 70;
          const theirs = ctx.cards('opp', ['mzone', 'grave'], (c) => c.isMonster && c.data.attribute === 'LIGHT').length;
          const mine = ctx.cards('me', ['mzone', 'grave'], (c) => c.isMonster && c.data.attribute === 'LIGHT').length;
          return theirs >= 2 && theirs > mine && !ctx.isMyTurn && ctx.phase === 'end' && noChain(ctx) ? 35 : 0;
        },
      },
    },
    {
      // A continuous effect, not a chain link: a LIGHT monster effect activated on the field or in the GY is negated
      // when it resolves, if a Light-Imprisoning Mirror still applies then (destroying the Mirror in response lets it
      // resolve). The link's resolve is wrapped once, the way Spirit Reaper watches targeting links.
      kind: 'trigger',
      event: 'chainActivated',
      label: 'Light-Imprisoning Mirror (negate)',
      eventFilter: (ctx, ev) => {
        const link = ev.data?.link as ChainLink | undefined;
        if (link && stActive(ctx)) mirrorWatch(ctx.game, link);
        return false;
      },
    },
  ],
});

/** Tuner's Scheme: monsters it took, so they are banished if destroyed. */
const schemeTaken = new WeakMap<C, number>();
trap("Tuner's Scheme", 'continuous', {
  text: 'Activate only when a Synchro Monster is Special Summoned to your opponent\'s side of the field. Take control of that Synchro Monster. When it is destroyed, banish it. When it leaves the field, destroy this card.',
  effects: [
    {
      kind: 'activate',
      event: 'specialSummoned',
      categories: ['control'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && c.hasType('synchro') && c.location === 'mzone' && c.controller === ctx.opp;
      },
      activate: async (ctx) => {
        const c = evc(ctx.event!)!;
        ctx.data.mon = c;
        ctx.data.mid = c.moveId;
      },
      resolve: async (ctx) => {
        const c = ctx.data.mon as C;
        if (!c || c.location !== 'mzone' || c.moveId !== ctx.data.mid || c.controller !== ctx.opp) return;
        if (ctx.game.isUnaffected(c, ctx.self, ctx.player)) return;
        const ok = await ctx.takeControl(c, false);
        if (ok && ctx.self.onField) {
          ctx.game.link(ctx.self, c, false);
          schemeTaken.set(c, c.moveId);
        }
      },
      ai: {
        score: (ctx) => {
          const c = ctx.event ? evc(ctx.event) : undefined;
          return c && ctx.freeMZones() > 0 ? 60 + cardValue(ctx.game, c) / 100 : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      label: 'Banish the destroyed Synchro',
      categories: ['banish'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        if (!c || !schemeTaken.has(c) || ev.from !== 'mzone') return false;
        schemeTaken.delete(c);
        return c.location === 'grave';
      },
      resolve: async (ctx) => {
        const c = evc(ctx.event!);
        if (c && c.location === 'grave') await ctx.banish(c);
      },
    },
  ],
});

/** Pole Position: guard against re-entrant ATK queries (the protection is itself checked while computing ATK). */
let poleGuard = 0;
function highestAtk(ctx: Ctx): C[] {
  const mons = ctx.faceUpMonsters('both');
  if (!mons.length) return [];
  const hi = Math.max(...mons.map((c) => ctx.atk(c)));
  return mons.filter((c) => ctx.atk(c) === hi);
}
trap('Pole Position', 'continuous', {
  text: 'The face-up monster(s) with the highest ATK on the field is unaffected by Spell effects. When this card leaves the field, destroy the face-up monster(s) with the highest ATK on the field.',
  effects: [
    {
      kind: 'activate',
      categories: ['protect'],
      ai: {
        score: (ctx) => {
          const top = highestAtk(ctx);
          return top.length && top.every((c) => c.controller === ctx.player) && ctx.spellTraps('me', (c) => c !== ctx.self && c.name === ctx.self.name).length === 0 ? 25 : 0;
        },
      },
    },
    {
      kind: 'continuous',
      mods: [
        {
          q: 'unaffectedBySpells',
          to: 'cards',
          filter: (ctx, c: C) => {
            if (poleGuard > 0 || c.location !== 'mzone' || !c.faceUp) return false;
            poleGuard++;
            try {
              return highestAtk(ctx).includes(c);
            } finally {
              poleGuard--;
            }
          },
        },
      ],
    },
    {
      kind: 'trigger',
      event: 'leftField',
      mandatory: true,
      label: 'Destroy the highest-ATK monster',
      categories: ['destroy'],
      // https://edisonrul.ing/cards/p/pole-position.html — "The ② Continuous-like Effect does NOT start a chain. The monster
      // is destroyed simultaneously with 'Pole Position' being removed from the field." Applied at once, also mid-Chain
      // (Game.applyChainless); not if Pole Position's effects were negated when it left (GameEvent.fromNegated).
      noChain: true,
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'szone' && ev.fromFaceUp !== false && ctx.faceUpMonsters('both').length > 0,
      resolve: async (ctx) => {
        const top = highestAtk(ctx);
        if (top.length) await ctx.destroy(top);
      },
    },
  ],
});

export const TOURNAMENT_EXTRAS_LOADED = true;
