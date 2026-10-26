// Card definitions: Tele-DAD engine (Psychic tuners, Destiny HEROes, DARK enablers).
// Caius the Shadow Monarch lives in monarchs.ts; Dark Armed Dragon in core.ts.
import { monster, spell } from '../define';
import { attr, cardValue, selfSummoned } from '../helpers';
import { Ctx } from '../../engine/ctx';
import type { CardInstance } from '../../engine/card';
import { GameOver, type BattleState } from '../../engine/game';

// ------------------------------------------------------------------ helpers

const isDark = attr('DARK');
const isDHero = (c: CardInstance) => c.isMonster && c.inSet('destiny-hero');
const isPsychic = (c: CardInstance) => c.isMonster && c.data.race === 'Psychic';

/** How many DARK monsters are in my GY (Dark Armed Dragon wants exactly 3). */
const darkCount = (ctx: Ctx) => ctx.grave('me', isDark).length;
const dadInHand = (ctx: Ctx) => ctx.hand('me', (c) => c.name === 'Dark Armed Dragon').length > 0;

/**
 * Priority for sending a DARK monster from the Deck to the GY (Armageddon Knight, Dark Grepher).
 * Higher = better pick.
 */
function darkMillPriority(ctx: Ctx, c: CardInstance) {
  if (c.name === 'Dark Armed Dragon') return -5000;
  const inGrave = ctx.grave('me', (x) => x.name === c.name).length;
  switch (c.name) {
    case 'Destiny Hero - Malicious':
      return 1000 - inGrave * 300;
    case 'Plaguespreader Zombie':
      return 800;
    case 'Necro Gardna':
      return 700;
    case 'Destiny Hero - Disk Commander':
      return 600;
    case 'Sangan':
      return 150;
    case 'Krebons':
      return 300;
    case 'Caius the Shadow Monarch':
      return 350;
    case 'Gorz the Emissary of Darkness':
      return -500;
    case 'Tragoedia':
      return -400;
    default:
      return 200 - (c.data.atk ?? 0) / 20;
  }
}

/**
 * Could a tuner with this card data be used right away for a Synchro Summon with one face-up
 * non-tuner I control? (Checks levels and the Synchro monster's material requirements.)
 */
function synchroReadyWith(ctx: Ctx, tuner: CardInstance) {
  const tLv = tuner.data.level ?? 0;
  const nonT = ctx.faceUpMonsters('me', (c) => !c.isTuner && !ctx.query(c, 'cannotBeSynchroMaterial') && !c.flags.noSynchroMaterial);
  return ctx.extra('me', (s) => {
    const req = s.data.synchro;
    if (!s.hasType('synchro') || !req) return false;
    if (req.tuner && !req.tuner(tuner)) return false;
    if ((req.minNonTuners ?? 1) > 1) return false;
    return nonT.some((m) => ctx.level(m) + tLv === (s.data.level ?? 0) && (!req.nonTuner || req.nonTuner(m)));
  }).length > 0;
}
/** Any Level 3 or lower Psychic tuner I could Teleport out that makes a Synchro. */
function teleportSynchro(ctx: Ctx) {
  return ctx.cards('me', ['hand', 'deck'], (c) => isPsychic(c) && c.isTuner && (c.data.level ?? 0) <= 3).some((t) => synchroReadyWith(ctx, t));
}

/** Monarch in hand that needs exactly one more body to Tribute Summon. */
function needsTributeBody(ctx: Ctx) {
  if (ctx.game.players[ctx.player].normalSummonsLeft <= 0) return false;
  if (ctx.game.tributeCandidates(ctx.player).length > 0) return false;
  return ctx.hand('me', (c) => c.isMonster && !c.data.cannotNormalSummon && ctx.game.tributesNeeded(c) === 1 && (c.data.atk ?? 0) >= 2000).length > 0;
}

// ============================================================ SPELLS

spell('Emergency Teleport', 'quickplay', {
  text: 'Special Summon 1 Level 3 or lower Psychic monster from your hand or Deck. Banish it during the End Phase of this turn.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.cards('me', ['hand', 'deck'], (c) => isPsychic(c) && (c.data.level ?? 0) <= 3).length > 0,
      resolve: async (ctx) => {
        if (!ctx.canSpecialSummon()) return;
        const cands = ctx.cards('me', ['hand', 'deck'], (c) => isPsychic(c) && (c.data.level ?? 0) <= 3);
        const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 Level 3 or lower Psychic monster from your hand or Deck.', 'specialSummon', {
          aiScore: (c) => {
            let s = c.location === 'deck' ? 200 : 0; // thin the deck
            if (c.isTuner && synchroReadyWith(ctx, c)) s += 1000 + (c.data.level ?? 0);
            if (c.name === 'Krebons') s += 100;
            return s;
          },
        });
        const fromDeck = sel.some((c) => c.location === 'deck');
        if (sel.length) {
          const r = await ctx.specialSummon(sel[0]);
          if (r.length) {
            const m = r[0];
            const id = m.moveId;
            ctx.later('end', async () => {
              if (m.location === 'mzone' && m.moveId === id) {
                ctx.game.log(`${m.name} is banished by the effect of Emergency Teleport.`, 'action', ctx.player);
                await ctx.game.banish([m], 'effect', ctx.player, ctx.self);
              }
            });
          }
        }
        if (fromDeck) ctx.game.shuffleDeck(ctx.player);
      },
      ai: {
        score: (ctx) => {
          if (ctx.isMyTurn) {
            if (ctx.phase !== 'main1' && ctx.phase !== 'main2') return 0;
            if (teleportSynchro(ctx)) return 62;
            if (needsTributeBody(ctx)) return 56;
            return 0;
          }
          // Opponent's turn (from a set card): emergency blocker against a direct attack.
          const b = ctx.battle;
          if (b && !b.inDamageStep && b.attacker.controller === ctx.opp && !b.target && ctx.atk(b.attacker) >= 1500) return 45;
          return 0;
        },
      },
    },
  ],
});

spell('Destiny Draw', 'normal', {
  text: 'Discard 1 "Destiny HERO" monster; draw 2 cards.',
  effects: [
    {
      kind: 'activate',
      categories: ['draw', 'discard'],
      canActivate: (ctx) => ctx.hand('me', (c) => c !== ctx.self && isDHero(c)).length > 0 && ctx.deck().length >= 2,
      activate: async (ctx) => {
        const sel = await ctx.select(ctx.hand('me', (c) => c !== ctx.self && isDHero(c)), 1, 1, 'Discard 1 "Destiny HERO" monster.', 'discard');
        if (!sel.length) return false;
        await ctx.discard(sel, 'cost');
      },
      resolve: async (ctx) => {
        await ctx.draw(2);
      },
      ai: { score: () => 60 },
    },
  ],
});

// ============================================================ PSYCHICS

monster('Krebons', {
  attribute: 'DARK',
  race: 'Psychic',
  level: 2,
  atk: 1200,
  def: 400,
  types: ['tuner'],
  aiValue: 400,
  text: 'When this card is targeted for an attack: You can pay 800 LP; negate the attack.',
  effects: [
    {
      kind: 'trigger',
      event: 'attackDeclared',
      label: 'Pay 800: negate attack',
      categories: ['negateAttack'],
      eventFilter: (ctx, ev) => ev.other === ctx.self && ctx.self.location === 'mzone',
      condition: (ctx) => ctx.lp > 800 && !!ctx.battle && ctx.battle.target === ctx.self,
      activate: async (ctx) => {
        await ctx.payLp(800);
      },
      resolve: async (ctx) => {
        if (ctx.battle && ctx.battle.target === ctx.self) ctx.negateAttack();
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b || ctx.lp <= 2400) return 0;
          const stat = ctx.self.pos === 'atk' ? ctx.atk(ctx.self) : ctx.def(ctx.self);
          const a = ctx.atk(b.attacker);
          if (a <= stat) return 0;
          // Pay when it stops real damage, or keeps a tuner alive for a Synchro next turn.
          if (ctx.self.pos === 'atk' && a - stat >= 1000) return 50;
          if (synchroReadyWith(ctx, ctx.self) && ctx.lp > 4000) return 45;
          return 0;
        },
      },
    },
  ],
});

const commanderUsed = new WeakSet<BattleState>();
/** Battling pair for Psychic Commander: my Psychic and the opponent's monster. */
function commanderPair(ctx: Ctx): { mine: CardInstance; theirs: CardInstance } | null {
  const b = ctx.battle;
  if (!b || !b.inDamageStep || !b.target) return null;
  const mine = b.attacker.controller === ctx.player ? b.attacker : b.target;
  const theirs = mine === b.attacker ? b.target : b.attacker;
  if (mine.controller !== ctx.player || theirs.controller !== ctx.opp) return null;
  if (!mine.faceUp || mine.location !== 'mzone' || !isPsychic(mine)) return null;
  if (theirs.location !== 'mzone') return null;
  return { mine, theirs };
}
/** Smallest LP payment (100..500) that makes my Psychic survive and win, or 0 if none helps. */
function commanderNeed(ctx: Ctx, mine: CardInstance, theirs: CardInstance) {
  const myAtk = ctx.atk(mine);
  const myStat = mine.pos === 'atk' ? myAtk : ctx.def(mine);
  const iAttack = ctx.battle?.attacker === mine;
  if (ctx.query(theirs, 'indestructibleBattle') && iAttack) return 0;
  for (let x = 0; x <= 500; x += 100) {
    const tAtk = Math.max(0, ctx.atk(theirs) - x);
    const tDef = Math.max(0, ctx.def(theirs) - x);
    if (iAttack) {
      const tStat = theirs.pos === 'atk' ? tAtk : tDef;
      if (myAtk > tStat) return x;
    } else if (mine.pos === 'atk' ? myStat > tAtk : myStat >= tAtk) return x;
  }
  return 0;
}

monster('Psychic Commander', {
  attribute: 'EARTH',
  race: 'Psychic',
  level: 3,
  atk: 1400,
  def: 800,
  types: ['tuner'],
  aiValue: 300,
  text: "Once per battle, during the Damage Step, when a Psychic monster you control battles an opponent's monster (before damage calculation): You can pay up to 500 LP (in multiples of 100); that opponent's monster loses that much ATK and DEF until the end of this turn.",
  effects: [
    {
      kind: 'quick',
      damageStep: true,
      label: 'Pay LP: weaken opponent\'s monster',
      categories: ['atkChange'],
      condition: (ctx) => {
        const pair = commanderPair(ctx);
        return !!pair && !commanderUsed.has(ctx.battle!) && ctx.lp > 100;
      },
      activate: async (ctx) => {
        const pair = commanderPair(ctx)!;
        commanderUsed.add(ctx.battle!);
        const max = Math.min(5, Math.floor((ctx.lp - 1) / 100));
        const opts = Array.from({ length: max }, (_, i) => `${(i + 1) * 100} LP`);
        const need = commanderNeed(ctx, pair.mine, pair.theirs);
        const i = await ctx.option('Pay how much LP?', opts, (k) => (need ? -Math.abs((k + 1) * 100 - need) : k));
        ctx.data.amount = (i + 1) * 100;
        ctx.data.theirs = pair.theirs;
        ctx.data.moveId = pair.theirs.moveId;
        await ctx.payLp(ctx.data.amount);
      },
      resolve: async (ctx) => {
        const t = ctx.data.theirs as CardInstance;
        if (t.location !== 'mzone' || t.moveId !== ctx.data.moveId || !t.faceUp) return;
        ctx.addTempMod(t, 'atk', -ctx.data.amount, 'turn');
        ctx.addTempMod(t, 'def', -ctx.data.amount, 'turn');
      },
      ai: {
        score: (ctx) => {
          const pair = commanderPair(ctx);
          if (!pair || ctx.lp <= 1500) return 0;
          return commanderNeed(ctx, pair.mine, pair.theirs) ? 85 : 0;
        },
      },
    },
  ],
});

// ============================================================ DESTINY HEROES

monster('Destiny Hero - Malicious', {
  attribute: 'DARK',
  race: 'Warrior',
  level: 6,
  atk: 800,
  def: 800,
  sets: ['hero', 'destiny-hero'],
  aiValue: 300,
  text: 'You can banish this card from your GY; Special Summon 1 "Destiny Hero - Malicious" from your Deck.',
  effects: [
    {
      kind: 'ignition',
      range: ['grave'],
      label: 'Banish: summon Malicious from Deck',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.deck('me', (c) => c.name === 'Destiny Hero - Malicious').length > 0,
      activate: async (ctx) => {
        await ctx.banish(ctx.self, 'cost');
      },
      resolve: async (ctx) => {
        if (!ctx.canSpecialSummon()) return;
        const c = ctx.deck('me', (x) => x.name === 'Destiny Hero - Malicious')[0];
        // No position is specified: the player chooses Attack or Defense.
        if (c) await ctx.specialSummon(c, { pos: 'choose' });
        ctx.game.shuffleDeck(ctx.player);
      },
      ai: {
        score: (ctx) => {
          // Don't drop below 3 DARKs while holding Dark Armed Dragon.
          if (dadInHand(ctx) && darkCount(ctx) === 3) return 0;
          // A face-up tuner + Malicious (Level 6) = a Synchro (Krebons -> Level 8).
          const tunerLvs = ctx.faceUpMonsters('me', (t) => t.isTuner).map((t) => ctx.level(t) + 6);
          if (tunerLvs.length && ctx.extra('me', (c) => c.hasType('synchro') && tunerLvs.includes(c.data.level ?? 0)).length) return 64;
          if (needsTributeBody(ctx)) return 57;
          if (ctx.monsters('me').length === 0 && ctx.monsters('opp').length > 0) return 38;
          return 0;
        },
      },
    },
  ],
});

monster('Destiny Hero - Disk Commander', {
  attribute: 'DARK',
  race: 'Warrior',
  level: 1,
  atk: 300,
  def: 300,
  sets: ['hero', 'destiny-hero'],
  aiValue: 600,
  text: 'This card cannot be Special Summoned from the GY during the turn it was sent there. When this card is Special Summoned from the GY: Draw 2 cards.',
  effects: [
    {
      kind: 'trigger',
      event: 'specialSummoned',
      mandatory: true,
      label: 'Draw 2',
      categories: ['draw'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'grave',
      resolve: async (ctx) => {
        await ctx.draw(2);
      },
    },
  ],
});

monster('Destiny Hero - Diamond Dude', {
  attribute: 'DARK',
  race: 'Warrior',
  level: 4,
  atk: 1400,
  def: 1600,
  sets: ['hero', 'destiny-hero'],
  aiValue: 400,
  text: 'Once per turn: You can look at the top card of your Deck. If it is a Normal Spell, send it to the GY; during your next Main Phase 1 you can apply that card\'s effect. Otherwise, place it on the bottom of the Deck.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Check the top card',
      categories: ['mill'],
      canActivate: (ctx) => ctx.deck().length > 0,
      resolve: async (ctx) => {
        const deck = ctx.game.players[ctx.player].deck;
        const top = deck[deck.length - 1];
        if (!top) return;
        ctx.log(`${ctx.self.name} reveals ${top.name}.`);
        if (top.isSpell && top.data.stype === 'normal') {
          await ctx.sendToGrave(top);
          const id = top.moveId;
          const player = ctx.player;
          const game = ctx.game;
          game.addDelayed(
            'main1',
            async () => {
              if (top.location !== 'grave' || top.moveId !== id || game.turnPlayer !== player) return;
              const idx = (top.data.effects ?? []).findIndex((e) => e.kind === 'activate');
              const ef = top.data.effects?.[idx];
              if (!ef) return;
              const c2 = new Ctx(game, top, ef, player);
              c2.effectIndex = idx;
              try {
                if (ef.condition && !ef.condition(c2)) return;
                if (ef.canActivate && !ef.canActivate(c2)) return;
                const yes = await c2.confirm(`Apply the effect of ${top.name} (Destiny Hero - Diamond Dude)?`, (ef.ai?.score?.(c2) ?? 30) > 0);
                if (!yes) return;
                game.log(`${game.players[player].name} applies the effect of ${top.name} from the GY.`, 'action', player);
                if (ef.activate && (await ef.activate(c2)) === false) return;
                if (ef.resolve) await ef.resolve(c2);
              } catch (e) {
                if (e instanceof GameOver) throw e;
                console.error('Diamond Dude delayed effect error', top.name, e);
              }
            },
            2,
          );
        } else {
          await ctx.toDeck(top, 'bottom');
        }
      },
      ai: { score: () => 45 },
    },
  ],
});

monster('Destiny Hero - Dogma', {
  attribute: 'DARK',
  race: 'Warrior',
  level: 8,
  atk: 3400,
  def: 2400,
  sets: ['hero', 'destiny-hero'],
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 800,
  text: 'Cannot be Normal Summoned/Set. Must be Special Summoned (from your hand) by Tributing 3 monsters, including a "Destiny HERO" monster. During your opponent\'s next Standby Phase after this card is Special Summoned this way: Halve their LP.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (Tribute 3 incl. a Destiny HERO)',
      canActivate: (ctx) => {
        const mons = ctx.monsters('me', (c) => !ctx.query(c, 'cannotBeTributed'));
        return mons.length >= 3 && mons.some((c) => c.faceUp && isDHero(c));
      },
      perform: async (ctx) => {
        const mons = ctx.monsters('me', (c) => !ctx.query(c, 'cannotBeTributed'));
        const d = await ctx.select(mons.filter((c) => c.faceUp && isDHero(c)), 1, 1, 'Tribute 1 "Destiny HERO" monster.', 'tribute', { cancelable: true });
        if (!d.length) return false;
        const rest = await ctx.select(mons.filter((c) => c !== d[0]), 2, 2, 'Tribute 2 more monsters.', 'tribute', { cancelable: true });
        if (rest.length < 2) return false;
        const all = [...d, ...rest];
        ctx.log(`${ctx.game.players[ctx.player].name} Tributes ${all.map((c) => c.name).join(', ')}.`);
        await ctx.game.moveCards(all, 'grave', { reason: 'tribute', reasons: ['tribute', 'cost'], reasonPlayer: ctx.player, reasonCard: ctx.self });
        return true;
      },
      ai: {
        score: (ctx) => {
          const mons = ctx.monsters('me');
          const loss = [...mons].map((c) => cardValue(ctx.game, c)).sort((a, b) => a - b).slice(0, 3).reduce((a, b) => a + b, 0);
          return loss < 3600 ? 60 : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'specialSummoned',
      mandatory: true,
      label: 'Halve LP next Standby Phase',
      categories: ['damage'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'hand' && !ev.reasonCard,
      resolve: async (ctx) => {
        const me = ctx.self;
        const id = me.moveId;
        const p = ctx.player;
        const game = ctx.game;
        ctx.later(
          'standby',
          async () => {
            if (me.location !== 'mzone' || me.moveId !== id || !me.faceUp || game.isNegated(me)) return;
            const o = game.opp(p);
            const lp = game.players[o].lp;
            const half = Math.ceil(lp / 2);
            game.players[o].lp = half;
            game.log(`${me.name} halves ${game.players[o].name}'s LP. (LP ${half})`, 'damage', o);
            await game.anim({ type: 'damage', player: o, amount: lp - half, kind: 'effect' });
            game.checkLp();
          },
          1,
        );
      },
    },
  ],
});

// ============================================================ DARK SUPPORT

monster('Dark Grepher', {
  attribute: 'DARK',
  race: 'Warrior',
  level: 4,
  atk: 1700,
  def: 1600,
  aiValue: 500,
  text: 'You can Special Summon this card (from your hand) by discarding 1 Level 5 or higher DARK monster. Once per turn: You can discard 1 DARK monster; send 1 DARK monster from your Deck to the GY.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (discard a Level 5+ DARK)',
      canActivate: (ctx) => ctx.freeMZones() > 0 && ctx.hand('me', (c) => c !== ctx.self && isDark(c) && (c.data.level ?? 0) >= 5).length > 0,
      perform: async (ctx) => {
        const cands = ctx.hand('me', (c) => c !== ctx.self && isDark(c) && (c.data.level ?? 0) >= 5);
        const sel = await ctx.select(cands, 1, 1, 'Discard 1 Level 5 or higher DARK monster.', 'discard', {
          cancelable: true,
          aiScore: (c) => (c.name === 'Destiny Hero - Malicious' ? 2000 : c.name === 'Dark Armed Dragon' ? -5000 : -cardValue(ctx.game, c)),
        });
        if (!sel.length) return false;
        await ctx.discard(sel, 'cost');
        return true;
      },
      ai: {
        score: (ctx) => {
          const fodder = ctx.hand('me', (c) => c !== ctx.self && isDark(c) && (c.data.level ?? 0) >= 5 && c.name !== 'Dark Armed Dragon');
          if (!fodder.length) return 0;
          // Discarding Malicious is pure profit; discarding a Monarch is fine when it can't be summoned soon.
          if (fodder.some((c) => c.name === 'Destiny Hero - Malicious')) return 72;
          if (dadInHand(ctx) && darkCount(ctx) === 2) return 72;
          return ctx.monsters('me').length === 0 ? 0 : 40;
        },
      },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Discard a DARK: send a DARK from Deck to GY',
      categories: ['mill', 'discard'],
      canActivate: (ctx) => ctx.hand('me', isDark).length > 0 && ctx.deck('me', isDark).length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(ctx.hand('me', isDark), 1, 1, 'Discard 1 DARK monster.', 'discard', {
          aiScore: (c) => (c.name === 'Destiny Hero - Malicious' ? 2000 : c.name === 'Dark Armed Dragon' ? -5000 : -cardValue(ctx.game, c)),
        });
        if (!sel.length) return false;
        await ctx.discard(sel, 'cost');
      },
      resolve: async (ctx) => {
        const cands = ctx.deck('me', isDark);
        const sel = await ctx.select(cands, 1, 1, 'Send 1 DARK monster from your Deck to the GY.', 'toGrave', { aiScore: (c) => darkMillPriority(ctx, c) });
        if (sel.length) await ctx.sendToGrave(sel);
        ctx.game.shuffleDeck(ctx.player);
      },
      ai: {
        score: (ctx) => {
          const spare = ctx.hand('me', (c) => isDark(c) && c.name !== 'Dark Armed Dragon' && (c.name === 'Destiny Hero - Malicious' || (c.data.level ?? 0) >= 5 || ctx.hand('me', (x) => x.name === c.name).length > 1));
          if (!spare.length) return 0;
          // +2 DARKs to the GY: avoid overshooting Dark Armed Dragon's count of exactly 3.
          if (dadInHand(ctx) && darkCount(ctx) + 2 > 3) return 0;
          return 50;
        },
      },
    },
  ],
});

monster('Armageddon Knight', {
  attribute: 'DARK',
  race: 'Warrior',
  level: 4,
  atk: 1400,
  def: 1200,
  aiValue: 500,
  text: 'When this card is Summoned: You can send 1 DARK monster from your Deck to the GY.',
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      when: true,
      label: 'Send a DARK from Deck to GY',
      categories: ['mill'],
      eventFilter: selfSummoned(),
      canActivate: (ctx) => ctx.deck('me', isDark).length > 0,
      resolve: async (ctx) => {
        const sel = await ctx.select(ctx.deck('me', isDark), 1, 1, 'Send 1 DARK monster from your Deck to the GY.', 'toGrave', { aiScore: (c) => darkMillPriority(ctx, c) });
        if (sel.length) await ctx.sendToGrave(sel);
        ctx.game.shuffleDeck(ctx.player);
      },
      ai: { score: (ctx) => (dadInHand(ctx) && darkCount(ctx) >= 3 ? 0 : 1) },
    },
  ],
});
