// Card definitions: Blackwings (archetype group B).
import { monster, spell, trap } from '../define';
import { bestTarget, cardValue, destroyTargets, inSet, selfDestroysByBattle } from '../helpers';
import type { CardInstance, EffectDef } from '../../engine/card';
import type { Ctx } from '../../engine/ctx';

const isBW = (c: CardInstance) => c.isMonster && c.inSet('blackwing');
const faceUpBW = (ctx: Ctx, except?: string) => ctx.faceUpMonsters('me', (c) => isBW(c) && (!except || c.name !== except));
const BW = ['blackwing'];

/** Which side of the current battle is mine / theirs (or undefined). */
function battleSides(ctx: Ctx) {
  const b = ctx.battle;
  if (!b) return null;
  const mine = b.attacker.controller === ctx.player ? b.attacker : b.target && b.target.controller === ctx.player ? b.target : null;
  if (!mine) return null;
  const theirs = mine === b.attacker ? b.target : b.attacker;
  return { mine, theirs, b };
}

/** A Normal Spell/Trap that is currently resolving on the chain (it goes to the GY anyway). */
function spentOnChain(ctx: Ctx, c: CardInstance) {
  return ctx.game.chain.some(
    (l) => l.card === c && l.isCardActivation && !['continuous', 'equip', 'field'].includes(c.data.stype ?? '') && c.data.ttype !== 'continuous',
  );
}

/** Standard "if you control another face-up Blackwing, Special Summon from hand" procedure. */
function bwProc(selfName: string): EffectDef {
  return {
    kind: 'proc',
    label: 'Special Summon',
    categories: ['specialSummon'],
    condition: (ctx) => ctx.freeMZones() > 0 && faceUpBW(ctx, selfName).length > 0,
  };
}

// ============================================================ MAIN DECK

monster('Blackwing - Kalut the Moon Shadow', {
  attribute: 'DARK',
  race: 'Winged Beast',
  level: 1,
  atk: 400,
  def: 1000,
  sets: BW,
  aiValue: 500,
  text: 'During the Damage Step, when a "Blackwing" monster you control battles: You can send this card from your hand to the GY; that monster gains 1400 ATK until the End Phase.',
  effects: [
    {
      kind: 'quick',
      range: ['hand'],
      damageStep: true,
      label: '+1400 ATK',
      categories: ['atkChange'],
      condition: (ctx) => {
        const s = battleSides(ctx);
        return !!s && s.b.inDamageStep && s.mine.faceUp && isBW(s.mine);
      },
      activate: async (ctx) => {
        ctx.data.mine = battleSides(ctx)!.mine;
        await ctx.sendToGrave(ctx.self, 'cost');
      },
      resolve: async (ctx) => {
        const m = ctx.data.mine as CardInstance;
        if (m.location === 'mzone' && m.faceUp) ctx.addTempMod(m, 'atk', 1400, 'turn');
      },
      ai: {
        score: (ctx) => {
          const s = battleSides(ctx);
          if (!s) return 0;
          const atk = ctx.atk(s.mine);
          if (!s.theirs) return ctx.oppLp <= atk + 1400 && ctx.oppLp > atk ? 100 : 0;
          const t = s.theirs;
          const stat = t.pos === 'atk' ? ctx.atk(t) : ctx.def(t);
          if (atk <= stat && atk + 1400 > stat) return 95;
          if (atk === stat) return 90;
          // Attacking an attack-position monster we already beat: turn it into lethal / big damage.
          if (t.pos === 'atk' && s.mine === s.b.attacker && ctx.oppLp <= atk + 1400 - stat) return 90;
          return 0;
        },
      },
    },
  ],
});

monster('Blackwing - Shura the Blue Flame', {
  attribute: 'DARK',
  race: 'Winged Beast',
  level: 4,
  atk: 1800,
  def: 1200,
  sets: BW,
  aiValue: 300,
  text: 'Once per turn, when this card destroys an opponent\'s monster by battle and sends it to the GY: You can Special Summon 1 "Blackwing" monster with 1500 or less ATK from your Deck.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      opt: true,
      label: 'Summon Blackwing from Deck',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => selfDestroysByBattle(ctx, ev) && (ev.card as CardInstance).location === 'grave',
      condition: (ctx) => ctx.canSpecialSummon() && ctx.deck('me', (c) => isBW(c) && (c.data.atk ?? 0) <= 1500).length > 0,
      resolve: async (ctx) => {
        if (!ctx.canSpecialSummon()) return;
        const cands = ctx.deck('me', (c) => isBW(c) && (c.data.atk ?? 0) <= 1500 && ctx.canSummonCard(c));
        const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 "Blackwing" monster with 1500 or less ATK from your Deck.', 'specialSummon', {
          aiScore: (c) => ({ 'Blackwing - Gale the Whirlwind': 30, 'Blackwing - Blizzard the Far North': 20, 'Blackwing - Mistral the Silver Shield': 10, 'Blackwing - Fane the Steel Chain': 8 })[c.name] ?? 0,
        });
        if (sel.length) await ctx.specialSummon(sel[0]);
        ctx.game.shuffleDeck(ctx.player);
      },
    },
  ],
});

monster('Blackwing - Bora the Spear', {
  attribute: 'DARK',
  race: 'Winged Beast',
  level: 4,
  atk: 1700,
  def: 800,
  sets: BW,
  aiValue: 300,
  text: 'If you control a face-up "Blackwing" monster other than "Blackwing - Bora the Spear", you can Special Summon this card (from your hand). If this card attacks a Defense Position monster, inflict piercing battle damage.',
  effects: [bwProc('Blackwing - Bora the Spear'), { kind: 'continuous', mods: [{ q: 'piercing' }] }],
});

monster('Blackwing - Sirocco the Dawn', {
  attribute: 'DARK',
  race: 'Winged Beast',
  level: 5,
  atk: 2000,
  def: 900,
  sets: BW,
  aiValue: 300,
  text: 'If your opponent controls a monster and you control no monsters, you can Special Summon this card (from your hand). Once per turn, during your Main Phase 1: You can target 1 "Blackwing" monster you control; it gains ATK equal to the combined ATK of all other face-up "Blackwing" monsters you control, until the End Phase. Only that monster can attack this turn.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.monsters('opp').length > 0 && ctx.monsters('me').length === 0 && ctx.freeMZones() > 0,
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Gather Blackwing ATK',
      categories: ['atkChange'],
      condition: (ctx) => ctx.phase === 'main1' && faceUpBW(ctx).length >= 2,
      activate: async (ctx) => {
        await ctx.selectTargets(faceUpBW(ctx), 1, 1, 'Target 1 "Blackwing" monster to gain ATK.', 'buff', {
          aiScore: (c) => (ctx.game.canAttack(c) ? 1000 : 0) + ctx.atk(c),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp);
        if (!t.length) return;
        const others = faceUpBW(ctx).filter((c) => c !== t[0]);
        const sum = others.reduce((a, c) => a + ctx.atk(c), 0);
        ctx.addTempMod(t[0], 'atk', sum, 'turn');
        for (const m of ctx.monsters('me')) if (m !== t[0]) m.flags.cannotAttackTurn = ctx.turn;
      },
      ai: {
        score: (ctx) => {
          const bws = faceUpBW(ctx).filter((c) => ctx.game.canAttack(c));
          if (bws.length < 2) return 0;
          const total = faceUpBW(ctx).reduce((a, c) => a + ctx.atk(c), 0);
          const opp = ctx.monsters('opp');
          if (!opp.length) return 0; // attacking separately deals the same damage
          const atkOpp = opp.filter((c) => c.faceUp && c.pos === 'atk');
          if (opp.length === 1 && atkOpp.length === 1 && total - ctx.atk(atkOpp[0]) >= ctx.oppLp) return 85;
          const best = Math.max(0, ...opp.map((c) => (c.faceUp ? (c.pos === 'atk' ? ctx.atk(c) : ctx.def(c)) : 1500)));
          const maxMine = Math.max(...bws.map((c) => ctx.atk(c)));
          if (opp.length === 1 && best >= maxMine && total > best) return 45;
          return 0;
        },
      },
    },
  ],
});

monster('Blackwing - Gale the Whirlwind', {
  attribute: 'DARK',
  race: 'Winged Beast',
  level: 3,
  atk: 1300,
  def: 400,
  types: ['tuner'],
  sets: BW,
  aiValue: 800,
  text: 'If you control a face-up "Blackwing" monster other than "Blackwing - Gale the Whirlwind", you can Special Summon this card (from your hand). Once per turn: You can target 1 face-up monster your opponent controls; halve its ATK and DEF.',
  effects: [
    bwProc('Blackwing - Gale the Whirlwind'),
    {
      kind: 'ignition',
      opt: true,
      label: 'Halve ATK/DEF',
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('opp'), 1, 1, 'Target 1 face-up monster your opponent controls.', 'target', {
          aiScore: (c) => Math.max(ctx.atk(c), ctx.def(c)),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp);
        if (!t.length) return;
        ctx.addTempMod(t[0], 'atk', -Math.floor(ctx.atk(t[0]) / 2), 'field');
        ctx.addTempMod(t[0], 'def', -Math.floor(ctx.def(t[0]) / 2), 'field');
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...ctx.faceUpMonsters('opp').map((c) => Math.max(ctx.atk(c), ctx.def(c))));
          return best >= 1000 ? 50 + best / 200 : 0;
        },
      },
    },
  ],
});

monster('Blackwing - Blizzard the Far North', {
  attribute: 'DARK',
  race: 'Winged Beast',
  level: 2,
  atk: 1300,
  def: 0,
  types: ['tuner'],
  sets: BW,
  aiValue: 400,
  text: 'When this card is Normal Summoned: You can target 1 Level 4 or lower "Blackwing" monster in your GY; Special Summon it in face-up Defense Position.',
  effects: [
    {
      kind: 'trigger',
      event: 'normalSummoned',
      label: 'Revive Blackwing',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => isBW(c) && (c.data.level ?? 0) <= 4 && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => isBW(c) && (c.data.level ?? 0) <= 4 && ctx.canSummonCard(c)), 1, 1, 'Target 1 Level 4 or lower "Blackwing" in your GY.', 'specialSummon', {
          aiScore: (c) => (c.data.level ?? 0) * 100 + (c.data.atk ?? 0) / 10,
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.specialSummon(t[0], { pos: 'def' });
      },
    },
  ],
});

monster('Blackwing - Elphin the Raven', {
  attribute: 'DARK',
  race: 'Winged Beast',
  level: 6,
  atk: 2200,
  def: 1200,
  sets: BW,
  text: 'If you control a face-up "Blackwing" monster, you can Normal Summon this card without Tributing. When this card is Normal Summoned: You can target 1 face-up monster your opponent controls; change its battle position.',
  effects: [
    {
      // Workaround (see docs/engine-requests/group-b.md): the engine has no "summon without Tributing"
      // hook, so this hand-range continuous effect refreshes the noTribute flag whenever Normal Summon
      // legality is checked. It never actually forbids anything.
      kind: 'continuous',
      range: ['hand'],
      mods: [
        {
          q: 'cannotNormalSummon',
          to: 'players',
          filter: (ctx, p) => {
            if (p === ctx.player) ctx.self.flags.noTribute = faceUpBW(ctx).length > 0;
            return false;
          },
        },
      ],
    },
    {
      kind: 'trigger',
      event: 'normalSummoned',
      label: 'Change position',
      categories: ['position'],
      canActivate: (ctx) => ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('opp'), 1, 1, 'Target 1 face-up monster to change its battle position.', 'position', {
          aiScore: (c) => (c.pos === 'atk' ? ctx.atk(c) - ctx.def(c) : ctx.def(c) - ctx.atk(c)),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp);
        if (t.length) await ctx.changePos(t[0], t[0].pos === 'atk' ? 'def' : 'atk');
      },
    },
  ],
});

monster('Blackwing - Fane the Steel Chain', {
  attribute: 'DARK',
  race: 'Winged Beast',
  level: 3,
  atk: 500,
  def: 800,
  sets: BW,
  text: 'This card can attack directly. When this card inflicts battle damage to your opponent by a direct attack: You can target 1 face-up monster your opponent controls; change its battle position.',
  effects: [
    { kind: 'continuous', mods: [{ q: 'directAttack' }] },
    {
      kind: 'trigger',
      event: 'battleDamage',
      label: 'Change position',
      categories: ['position'],
      eventFilter: (ctx, ev) => ev.reasonCard === ctx.self && ev.player === ctx.opp && !!ctx.battle && ctx.battle.attacker === ctx.self && !ctx.battle.target,
      canActivate: (ctx) => ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('opp'), 1, 1, 'Target 1 face-up monster to change its battle position.', 'position', {
          aiScore: (c) => (c.pos === 'atk' ? ctx.atk(c) - ctx.def(c) : ctx.def(c) - ctx.atk(c)),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp);
        if (t.length) await ctx.changePos(t[0], t[0].pos === 'atk' ? 'def' : 'atk');
      },
    },
  ],
});

monster('Blackwing - Mistral the Silver Shield', {
  attribute: 'DARK',
  race: 'Winged Beast',
  level: 2,
  atk: 100,
  def: 1800,
  sets: BW,
  text: 'If this face-up card on the field is destroyed and sent to the GY: The next battle damage you take this turn becomes 0.',
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'Prevent battle damage',
      categories: ['protect'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone' && !!ev.fromFaceUp && (ev.reasons ?? []).includes('destroy'),
      resolve: async (ctx) => {
        // Approximation: no battle damage for the rest of this turn (the engine has no "next damage" hook).
        ctx.addPlayerMod(ctx.player, 'noBattleDamage', true, 'turn');
      },
    },
  ],
});

// ============================================================ SPELLS / TRAPS

spell('Black Whirlwind', 'continuous', {
  sets: BW,
  text: 'When a "Blackwing" monster is Normal Summoned to your field: You can add 1 "Blackwing" monster with less ATK than that monster from your Deck to your hand.',
  aiValue: 400,
  effects: [
    {
      kind: 'activate',
      categories: ['search'],
      ai: {
        score: (ctx) => {
          const up = ctx.spellTraps('me', (c) => c.name === 'Black Whirlwind' && c.faceUp).length;
          const canNS = ctx.game.players[ctx.player].normalSummonsLeft > 0 && ctx.hand('me', (c) => isBW(c) && (c.data.level ?? 0) <= 4).length > 0;
          if (up >= 2) return 0;
          if (canNS) return up ? 40 : 66;
          return up ? 0 : 25;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'normalSummoned',
      range: ['szone'],
      label: 'Search Blackwing',
      categories: ['search'],
      eventFilter: (ctx, ev) => {
        const c = ev.card as CardInstance;
        return !!c && c.controller === ctx.player && isBW(c) && c.location === 'mzone' && c.faceUp;
      },
      condition: (ctx) => ctx.self.faceUp && ctx.self.activeOnField && !ctx.isNegated(ctx.self),
      canActivate: (ctx) => {
        const c = ctx.event?.card as CardInstance | undefined;
        const lim = c ? (c.location === 'mzone' && c.faceUp ? ctx.atk(c) : c.data.atk ?? 0) : 0;
        return ctx.deck('me', (d) => isBW(d) && (d.data.atk ?? 0) < lim).length > 0;
      },
      activate: async (ctx) => {
        const c = ctx.event!.card as CardInstance;
        ctx.data.lim = c.location === 'mzone' && c.faceUp ? ctx.atk(c) : c.data.atk ?? 0;
      },
      resolve: async (ctx) => {
        const lim = ctx.data.lim as number;
        await ctx.search((d) => isBW(d) && (d.data.atk ?? 0) < lim, 1, `Add 1 "Blackwing" monster with less than ${lim} ATK to your hand.`);
      },
    },
  ],
});

trap('Icarus Attack', 'normal', {
  text: 'Tribute 1 Winged Beast monster, then target 2 cards on the field; destroy them.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy'],
      canActivate: (ctx) => {
        const wbs = ctx.monsters('me', (c) => c.faceUp && c.data.race === 'Winged Beast' && !ctx.query(c, 'cannotBeTributed'));
        if (!wbs.length) return false;
        const others = ctx.field('both', (c) => c !== ctx.self && ctx.canTarget(c));
        return wbs.some((w) => others.filter((o) => o !== w).length >= 2);
      },
      activate: async (ctx) => {
        const wbs = ctx.monsters('me', (c) => c.faceUp && c.data.race === 'Winged Beast' && !ctx.query(c, 'cannotBeTributed'));
        const top = ctx.prevLink();
        const threatened = top && top.player === ctx.opp ? top.ctx.targets : [];
        const b = ctx.battle;
        const cost = await ctx.select(wbs, 1, 1, 'Tribute 1 Winged Beast monster.', 'tribute', {
          aiScore: (c) => {
            let s = -cardValue(ctx.game, c);
            if (threatened.includes(c)) s += 5000;
            if (b && b.target === c && b.attacker.controller === ctx.opp && ctx.atk(b.attacker) > (c.pos === 'atk' ? ctx.atk(c) : ctx.def(c))) s += 3000;
            return s;
          },
        });
        await ctx.sendToGrave(cost, 'tribute');
        const cands = ctx.field('both', (c) => c !== ctx.self);
        await ctx.selectTargets(cands, 2, 2, 'Target 2 cards on the field to destroy.', 'destroy', {
          aiScore: (c) => {
            const mine = ctx.mine(c);
            let v = cardValue(ctx.game, c);
            // A Normal Spell/Trap already resolving on the chain leaves the field anyway.
            if (spentOnChain(ctx, c)) v -= 5000;
            return mine ? -v - 10000 : v;
          },
        });
      },
      resolve: destroyTargets,
      ai: {
        score: (ctx) => {
          // Negative = never (also stops the AI from "saving" this card by chaining it pointlessly).
          const opp = ctx.field('opp', (c) => ctx.canTarget(c) && !spentOnChain(ctx, c));
          if (opp.length < 2) return -1;
          const wbs = ctx.monsters('me', (c) => c.faceUp && c.data.race === 'Winged Beast');
          const top = ctx.chainTop();
          if (top && top.player === ctx.opp) {
            if (top.ctx.targets.includes(ctx.self)) return 70;
            if (top.ctx.targets.some((t) => wbs.includes(t))) return 80;
            const cats = top.effect.categories ?? [];
            if (cats.includes('destroyMulti') && wbs.length) return 75;
            if (top.ctx.targets.some((t) => opp.includes(t))) return -1;
          }
          const b = ctx.battle;
          if (b && b.attacker.controller === ctx.opp && !b.inDamageStep) {
            const tgt = b.target;
            if (tgt && wbs.includes(tgt) && ctx.atk(b.attacker) > (tgt.pos === 'atk' ? ctx.atk(tgt) : ctx.def(tgt))) return 80;
            return 55;
          }
          if (!ctx.isMyTurn && ctx.phase === 'end') return 45;
          if (ctx.isMyTurn && ctx.phase === 'main1' && !ctx.chainTop()) {
            const setOpp = ctx.spellTraps('opp', (c) => !c.faceUp).length;
            const cheap = wbs.some((c) => cardValue(ctx.game, c) < 1800);
            if (setOpp >= 1 && wbs.length >= 2 && cheap) return 42;
          }
          return -1;
        },
      },
    },
  ],
});

trap('Delta Crow - Anti Reverse', 'normal', {
  sets: BW,
  text: 'Activate only if you control 3 or more face-up "Blackwing" monsters. Destroy all Set Spell and Trap Cards your opponent controls.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'destroyMulti'],
      condition: (ctx) => faceUpBW(ctx).length >= 3,
      canActivate: (ctx) => ctx.spellTraps('opp', (c) => !c.faceUp).length > 0,
      resolve: async (ctx) => {
        if (faceUpBW(ctx).length < 3) return;
        await ctx.destroy(ctx.spellTraps('opp', (c) => !c.faceUp));
      },
      ai: { score: (ctx) => (ctx.spellTraps('opp', (c) => !c.faceUp).length ? 50 + 10 * ctx.spellTraps('opp', (c) => !c.faceUp).length : 0) },
    },
  ],
});

// ============================================================ EXTRA DECK

const bwTuner = (c: CardInstance) => c.inSet('blackwing');

monster('Blackwing Armor Master', {
  attribute: 'DARK',
  race: 'Winged Beast',
  level: 7,
  atk: 2500,
  def: 1500,
  types: ['synchro'],
  sets: BW,
  aiValue: 1000,
  text: '"Blackwing" Tuner + 1 or more non-Tuner monsters\nCannot be destroyed by battle. You take no battle damage from battles involving this card. At the end of the Damage Step, if this card battled an opponent\'s monster: place 1 Wedge Counter on that monster (max. 1). You can remove all Wedge Counters on the field; the ATK and DEF of each monster that had a Wedge Counter become 0 until the End Phase.',
  synchro: { tuner: bwTuner, desc: '"Blackwing" Tuner + 1+ non-Tuner monsters' },
  effects: [
    { kind: 'continuous', mods: [{ q: 'indestructibleBattle' }, { q: 'noBattleDamageFrom' }] },
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      mandatory: true,
      label: 'Place Wedge Counter',
      eventFilter: (ctx, ev) => {
        if (ctx.self.location !== 'mzone' || !ctx.self.faceUp) return false;
        const other = ev.card === ctx.self ? (ev.other as CardInstance | undefined) : ev.other === ctx.self ? (ev.card as CardInstance) : undefined;
        return !!other && other.location === 'mzone' && other.controller !== ctx.player && !(other.counters.wedge > 0);
      },
      activate: async (ctx) => {
        const ev = ctx.event!;
        ctx.data.victim = ev.card === ctx.self ? ev.other : ev.card;
        ctx.data.moveId = (ctx.data.victim as CardInstance).moveId;
      },
      resolve: async (ctx) => {
        const v = ctx.data.victim as CardInstance;
        if (v.location === 'mzone' && v.moveId === ctx.data.moveId && !(v.counters.wedge > 0)) {
          v.counters.wedge = 1;
          ctx.log(`A Wedge Counter is placed on ${v.faceUp ? v.name : 'a face-down monster'}.`);
        }
      },
    },
    {
      kind: 'quick',
      label: 'Remove Wedge Counters',
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.monsters('both', (c) => c.counters.wedge > 0).length > 0,
      resolve: async (ctx) => {
        const hit = ctx.monsters('both', (c) => c.counters.wedge > 0);
        for (const c of hit) {
          c.counters.wedge = 0;
          if (!c.faceUp) continue;
          ctx.addTempMod(c, 'atk', -ctx.atk(c), 'turn');
          ctx.addTempMod(c, 'def', -ctx.def(c), 'turn');
        }
      },
      ai: {
        score: (ctx) => {
          const hit = ctx.monsters('opp', (c) => c.counters.wedge > 0 && c.faceUp);
          if (!hit.length) return 0;
          const b = ctx.battle;
          if (b && !b.inDamageStep && b.attacker.controller === ctx.opp && hit.includes(b.attacker)) return 75;
          if (ctx.isMyTurn && (ctx.phase === 'battle' || ctx.phase === 'main1') && !b && !ctx.chainTop()) {
            // Clear the way for my attackers.
            const myBest = Math.max(0, ...ctx.monsters('me', (c) => ctx.game.canAttack(c)).map((c) => ctx.atk(c)));
            const blocks = hit.some((c) => (c.pos === 'atk' ? ctx.atk(c) : ctx.def(c)) >= myBest);
            if (myBest > 0 && blocks) return 50;
          }
          return 0;
        },
      },
    },
  ],
});

monster('Blackwing Armed Wing', {
  attribute: 'DARK',
  race: 'Winged Beast',
  level: 6,
  atk: 2300,
  def: 1000,
  types: ['synchro'],
  sets: BW,
  text: '"Blackwing" Tuner + 1 or more non-Tuner monsters\nIf this card attacks, it gains 500 ATK during the Damage Step only. If this card attacks a Defense Position monster, inflict piercing battle damage.',
  synchro: { tuner: bwTuner, desc: '"Blackwing" Tuner + 1+ non-Tuner monsters' },
  effects: [
    {
      kind: 'continuous',
      mods: [
        { q: 'piercing' },
        { q: 'atk', value: (ctx) => (ctx.battle && ctx.battle.inDamageStep && ctx.battle.attacker === ctx.self ? 500 : 0) },
      ],
    },
  ],
});

monster('Blackwing - Silverwind the Ascendant', {
  attribute: 'DARK',
  race: 'Winged Beast',
  level: 8,
  atk: 2800,
  def: 2000,
  types: ['synchro'],
  sets: BW,
  aiValue: 600,
  text: '"Blackwing" Tuner + 2 or more non-Tuner "Blackwing" monsters\nOnce per turn, during your Main Phase 1: You can target up to 2 face-up monsters your opponent controls with DEF lower than this card\'s ATK; destroy them.',
  synchro: { tuner: bwTuner, nonTuner: (c) => c.inSet('blackwing'), minNonTuners: 2, desc: '"Blackwing" Tuner + 2+ non-Tuner "Blackwing" monsters' },
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Destroy up to 2',
      categories: ['destroy'],
      condition: (ctx) => ctx.phase === 'main1',
      canActivate: (ctx) => ctx.faceUpMonsters('opp', (c) => ctx.def(c) < ctx.atk(ctx.self) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('opp', (c) => ctx.def(c) < ctx.atk(ctx.self)), 1, 2, 'Target up to 2 face-up monsters with lower DEF.', 'destroy');
      },
      resolve: async (ctx) => {
        await ctx.destroy(ctx.validTargets((c) => c.location === 'mzone' && c.faceUp));
      },
      ai: { score: (ctx) => 60 + Math.min(20, cardValue(ctx.game, bestTarget(ctx.game, ctx.faceUpMonsters('opp')) ?? ctx.self) / 150) },
    },
  ],
});

void inSet;
export const BLACKWINGS_LOADED = true;
