// AI blunder detector (not part of `npm test`): AI-vs-AI self-play that counts plays a competent 2010 player would
// never make, per blunder type and per card. Used to find and rank AI mistakes; fixes go in the card `ai` hooks /
// `aiScore` pickers or src/ai/ai.ts, with a regression test in scripts/ai-removal-test.ts.
//
// Blunder types:
//   resolves-anyway   removal / bounce aimed at a Normal or Quick-Play Spell / Normal or Counter Trap that is already being
//                     activated (it resolves anyway)
//   own-target        a harmful effect (destroy, banish, bounce, control, negate, to Deck) targets the activator's own
//                     card on the field
//   no-op             an effect the AI chose to activate (not a mandatory trigger) resolved, was not negated, and changed
//                     nothing at all (no card moved, flipped or changed stats, no LP, no lingering effect)
//   no-op-cost        the same, after paying 1000+ LP or discarding / tributing / sending cards for it
//   self-wipe         a mass removal effect took more value off the activator's side than off the opponent's
//   suicide-attack    an attack into a face-up monster with more ATK (or DEF, in Defense Position) than the attacker
//   negate-weak       a summon negated (Solemn Judgment, Horn of Heaven...) of a monster worth little
//
// Usage: npx tsx scripts/ai-blunders.ts [--games N] [--seed S] [--mode mixed|premade|draft] [--workers W] [--examples K]
import { fork } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { AIController, type Difficulty } from '../src/ai/ai';
import { findCard } from '../src/cards';
import { cardValue } from '../src/cards/helpers';
import { playableSet } from '../src/collection/catalog';
import { PREMADE_DECKS, buildDeckList } from '../src/decks';
import { draftPool } from '../src/draft/cards';
import type { CardData, CardInstance } from '../src/engine/card';
import { Game, type ChainLink, type DeckList } from '../src/engine/game';
import { Rng } from '../src/engine/rng';
import type { PlayerId } from '../src/engine/types';

const args = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const GAMES = Number(arg('games', '200'));
const SEED = Number(arg('seed', '1'));
const MODE = arg('mode', 'mixed') as 'mixed' | 'premade' | 'draft';
const EXAMPLES = Number(arg('examples', '2'));
const WORKER = args.includes('--worker');
/** Print every AI activation of these cards with its context (comma-separated names). */
const TRACE = (arg('trace', '') ?? '').split(',').filter(Boolean);
const CONTEXTS = args.includes('--contexts');
const WORKERS = Number(arg('workers', String(Math.max(1, cpus().length))));
const DRAFT_CODES = ['TDGS', 'CSOC', 'GLAS', 'PTDN', 'LODT', 'CRMS', 'RGBT', 'ANPR', 'SOVR', 'ABPF', 'HA01'];

interface Blunder {
  type: string;
  card: string;
  detail: string;
  game: number;
  turn: number;
  player?: PlayerId;
}
interface Report {
  blunders: Blunder[];
  /** Activations chosen by the AI, per card name (denominators). */
  acts: Record<string, number>;
  /** Activation contexts per card: "own/opp phase top-of-chain" -> count (--contexts). */
  ctxs?: Record<string, Record<string, number>>;
  turns: number;
}

function hash(n: number) {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}

function randomDeck(code: string, rng: Rng): DeckList {
  const cards = code === 'POOL' ? draftPool() : (playableSet(code)?.playable ?? []).map((n) => findCard(n)).filter((c): c is CardData => !!c && !c.isToken);
  const isExtra = (c: CardData) => !!(c.mtypes?.includes('fusion') || c.mtypes?.includes('synchro'));
  const mains = cards.filter((c) => !isExtra(c));
  const main: CardData[] = [];
  const count = new Map<string, number>();
  let guard = 0;
  while (main.length < 40 && mains.length && guard++ < 10000) {
    const c = rng.pick(mains);
    const n = count.get(c.name) ?? 0;
    if (n >= 3) continue;
    count.set(c.name, n + 1);
    main.push(c);
  }
  return { main, extra: rng.shuffle(cards.filter(isExtra)).slice(0, 15) };
}

function makeJob(index: number) {
  const seed = SEED * 100003 + index;
  const rng = new Rng(hash(seed) || 1);
  const kind = MODE !== 'mixed' ? MODE : index % 3 === 2 ? 'draft' : 'premade';
  let decks: [DeckList, DeckList];
  if (kind === 'premade') {
    const n = PREMADE_DECKS.length;
    const k = index + SEED * 7;
    decks = [buildDeckList(PREMADE_DECKS[k % n]), buildDeckList(PREMADE_DECKS[(Math.floor(k / n) + k) % n])];
  } else {
    const ca = index % 6 === 5 ? 'POOL' : DRAFT_CODES[index % DRAFT_CODES.length];
    decks = [randomDeck(ca, rng), randomDeck(ca, rng)];
  }
  const diff = (): Difficulty => (rng.next() < 0.5 ? 'normal' : 'hard');
  return { seed, decks, diffs: [diff(), diff()] as [Difficulty, Difficulty] };
}

// ------------------------------------------------------------------ board fingerprint

function safeLen(o: unknown) {
  try {
    return JSON.stringify(o).length;
  } catch {
    return -1;
  }
}

function fingerprint(g: Game): string {
  const parts: unknown[] = [g.players.map((p) => [p.lp, p.hand.length, p.deck.map((c) => c.uid).join(','), p.grave.length, p.banished.length, p.extra.length, p.normalSummonsLeft])];
  for (const c of g.allCards) {
    if (c.location === 'deck' || c.location === 'extra') continue;
    const st = c.onField && c.isMonster && c.faceUp ? `${g.getAtk(c)}/${g.getDef(c)}/${g.getLevel(c)}` : '';
    parts.push(`${c.uid}:${c.location}:${c.controller}:${c.faceUp ? 'u' : 'd'}:${c.pos}:${c.moveId}:${st}:${c.tempMods.length}:${JSON.stringify(c.counters)}:${c.equippedTo}:${c.linkedTo}:${c.activeOnField}:${Object.keys(c.flags).length}:${c.revealedUntil}`);
  }
  parts.push(g.playerMods.length, (g as any).delayed?.length ?? 0, g.revealSeq, Object.keys(g.turnData).length, safeLen(g.turnData));
  parts.push(g.chain.map((l) => (l.negated ? 'n' : 'y')).join(''), g.battle ? `${g.battle.negated}:${g.battle.target?.uid}` : '-', g.pendingSummon?.negated ?? '-');
  return JSON.stringify(parts);
}

// ------------------------------------------------------------------ one game

const HARMFUL = ['destroy', 'banish', 'control', 'negate', 'toDeck'];
const lingers = (c: CardInstance) => c.data.stype === 'continuous' || c.data.stype === 'equip' || c.data.stype === 'field' || c.data.ttype === 'continuous';

async function playOne(index: number, setup?: (g: Game) => void): Promise<Report> {
  const job = makeJob(index);
  const ais = job.diffs.map((d, i) => new AIController(d, job.seed * 13 + i * 101)) as [AIController, AIController];
  const g = new Game(job.decks, ais, { seed: job.seed, maxTurns: 120 });
  setup?.(g);
  const rep: Report = { blunders: [], acts: {}, turns: 0 };
  const flag = (type: string, card: CardInstance, detail: string, player: PlayerId = card.controller) => rep.blunders.push({ type, card: card.name, detail, game: index, turn: g.turn, player });
  const desc = (c: CardInstance) => `${c.name}${c.onField ? (c.faceUp ? '' : ' (set)') : ` [${c.location}]`}`;
  /** Cost paid at activation, per link. */
  const costs = new Map<ChainLink, string>();

  // --- activations: targets and costs
  const origActivate = g.activate.bind(g);
  g.activate = async (player, act) => {
    const lp0 = g.players[player].lp;
    const hand0 = g.players[player].hand.length;
    const field0 = g.fieldCards(player).filter((c) => c !== act.card).length;
    const chainSnapshot = g.chain.slice();
    const wasFaceUp = act.card.onField && act.card.faceUp;
    const link = await origActivate(player, act);
    if (!link) return link;
    for (const l of chainSnapshot) (l.player !== player ? contestedLinks : redundantLinks).add(l);
    if (TRACE.includes(act.card.name)) {
      const top = chainSnapshot[chainSnapshot.length - 1];
      console.log(`TRACE g${index} T${g.turn} ${g.phase} ${g.turnPlayer === player ? 'own turn' : 'opp turn'} ${act.card.name}${act.effect.label ? ` (${act.effect.label})` : ''}: top=${top ? `${top.player === player ? 'own' : 'opp'} ${top.card.name}` : '-'} battle=${g.battle ? `${g.battle.attacker.name}->${g.battle.target?.name ?? 'direct'}` : '-'} targets=[${link.ctx.targets.map((t) => `${t.controller === player ? 'own' : 'opp'} ${desc(t)}`).join('; ')}] myField=[${g.fieldCards(player).map(desc).join('; ')}] oppField=[${g.fieldCards(g.opp(player)).map(desc).join('; ')}]`);
    }
    const ef = act.effect;
    const voluntary = !(ef.kind === 'trigger' && ef.mandatory);
    if (voluntary) rep.acts[act.card.name] = (rep.acts[act.card.name] ?? 0) + 1;
    if (voluntary && CONTEXTS) {
      const top = chainSnapshot[chainSnapshot.length - 1];
      const k = `${g.turnPlayer === player ? 'own' : 'opp'} ${g.phase}${g.battle ? (g.battle.attacker.controller === player ? ' my-attack' : ' their-attack') : ''}${top ? ` on ${top.player === player ? 'own' : 'opp'} ${top.card.isMonster ? 'monster' : top.card.isSpell ? 'spell' : 'trap'}` : ''}${g.pendingSummon ? ' summon' : ''}`;
      const m = ((rep.ctxs ??= {})[act.card.name + (act.effect.label ? ` (${act.effect.label})` : '')] ??= {});
      m[k] = (m[k] ?? 0) + 1;
    }
    const lpCost = lp0 - g.players[player].lp;
    const handCost = hand0 - g.players[player].hand.length - (link.fromLocation === 'hand' ? 1 : 0);
    const fieldCost = field0 - g.fieldCards(player).filter((c) => c !== act.card).length;
    const cost: string[] = [];
    if (lpCost >= 1000) cost.push(`${lpCost} LP`);
    if (handCost > 0) cost.push(`${handCost} card(s) from hand`);
    if (fieldCost > 0) cost.push(`${fieldCost} card(s) from field`);
    if (cost.length) costs.set(link, cost.join(', '));
    const cats = ef.categories ?? [];
    const harmful = cats.some((c) => HARMFUL.includes(c)) || (cats.includes('toHand') && link.ctx.targets.some((t) => t.onField));
    for (const t of link.ctx.targets) {
      if (!t.onField) continue;
      const beingActivated = chainSnapshot.find((l) => l.card === t && l.isCardActivation && !l.negated);
      if (beingActivated && !lingers(t) && (cats.includes('destroy') || cats.includes('toHand') || cats.includes('banish') || cats.includes('toDeck')) && t.controller !== player)
        flag('resolves-anyway', act.card, `targets ${desc(t)}, which is being activated and resolves anyway`);
      const selfUse = cats.some((c) => ['specialSummon', 'draw', 'search', 'recover', 'atkChange'].includes(c));
      if (harmful && !selfUse && t.controller === player && t !== act.card && voluntary) {
        const oppHas = g.fieldCards(g.opp(player)).length;
        flag('own-target', act.card, `targets its own ${desc(t)} (cats ${cats.join('/')}; opponent has ${oppHas} field card(s))`);
      }
      if (cats.includes('position') && !cats.includes('destroy') && t.controller === player && t.isMonster && voluntary && !g.battle)
        flag('own-target', act.card, `changes the position of its own ${desc(t)} outside battle`);
    }
    // An attack stopper (flip / take / switch the position of a monster) used on a monster other than the attacker:
    // the attack goes on.
    const b = g.battle;
    if (voluntary && b && !b.inDamageStep && b.attacker.controller !== player && b.attacker.location === 'mzone' && !b.negated && (cats.includes('position') || cats.includes('control')) && !cats.includes('destroy')) {
      const ts = link.ctx.targets.filter((t) => t.onField && t.isMonster);
      if (ts.length && !ts.includes(b.attacker)) flag('interrupt-miss', act.card, `${b.attacker.name} attacks${b.target ? ` ${b.target.name}` : ' directly'}; it targets ${ts.map(desc).join(', ')} instead`);
    }
    // In response to a monster effect, the position / control effect hits some other monster.
    const top = chainSnapshot[chainSnapshot.length - 1];
    if (voluntary && !b && top && top.player !== player && top.card.isMonster && top.card.location === 'mzone' && top.card.faceUp && cats.includes('position') && !cats.includes('destroy')) {
      const ts = link.ctx.targets.filter((t) => t.onField && t.isMonster);
      if (ts.length && !ts.includes(top.card)) flag('interrupt-miss', act.card, `answers ${top.card.name}'s effect by targeting ${ts.map(desc).join(', ')}`);
    }
    // Summoning into a lock: an already face-up card (Royal Oppression) negates the summon.
    if (cats.includes('negateSummon') && g.pendingSummon && g.pendingSummon.player !== player && link.fromLocation !== 'hand' && wasFaceUp)
      flag('summon-into-lock', g.pendingSummon.cards[0], `${g.pendingSummon.cards.map((c) => c.name).join(', ')} summoned into face-up ${act.card.name}`, g.pendingSummon.player as PlayerId);
    // summon negation
    if (cats.includes('negateSummon') && g.pendingSummon && g.pendingSummon.player !== player) {
      const v = Math.max(...g.pendingSummon.cards.map((c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0) + (c.hasType('effect') ? 400 : 0) + (c.isExtra ? 600 : 0)));
      if (v < 1700) flag('negate-weak', act.card, `negates the summon of ${g.pendingSummon.cards.map((c) => c.name).join(', ')} (value ${v})${lpCost ? ` for ${lpCost} LP` : ''}`);
    }
    return link;
  };

  // --- resolutions: did it change anything? Mass removal balance.
  const contestedLinks = new Set<ChainLink>();
  const redundantLinks = new Set<ChainLink>();
  const origResolve = (g as any).resolveLink.bind(g);
  (g as any).resolveLink = async (link: ChainLink) => {
    const ef = link.effect;
    const voluntary = !(ef.kind === 'trigger' && ef.mandatory);
    const before = fingerprint(g);
    const fieldBefore = g.allCards.filter((c) => c.onField && c !== link.card).map((c) => ({ c, side: c.controller, moveId: c.moveId, v: cardValue(g, c), up: c.faceUp }));
    await origResolve(link);
    if (g.over) return;
    if (voluntary && !link.negated && fingerprint(g) === before) {
      const cost = costs.get(link);
      // The opponent answered it (chained above it): their play, not ours.
      const contested = contestedLinks.has(link);
      // Our own later link already did the job (two Bottomless Trap Holes on one summon).
      const redundant = !contested && redundantLinks.has(link);
      flag(contested ? 'no-op-contested' : redundant ? 'no-op-redundant' : cost ? 'no-op-cost' : 'no-op', link.card, `${link.card.name}${ef.label ? ` (${ef.label})` : ''} resolved with no effect${cost ? ` after paying ${cost}` : ''}${link.ctx.targets.length ? `; targets ${link.ctx.targets.map(desc).join(', ')}` : ''}`);
    }
    // A removal Spell/Trap spent on little: what it took off the opponent's field is worth less than a card.
    const hitCats = ['destroy', 'banish', 'toDeck', 'toHand', 'control', 'position'];
    if (voluntary && !link.negated && link.isCardActivation && (ef.categories ?? []).some((c) => hitCats.includes(c)) && !(ef.categories ?? []).some((c) => ['specialSummon', 'draw', 'search'].includes(c))) {
      // face-up monsters only: a Set card's or an activated Trap's value says little
      const gone = fieldBefore.filter((b) => b.side !== link.player && b.c.isMonster && b.up && (!b.c.onField || b.c.moveId !== b.moveId || b.c.controller !== b.side || !b.c.faceUp));
      const v = gone.reduce((a, b) => a + b.v, 0);
      const allGone = fieldBefore.filter((b) => b.side !== link.player && (!b.c.onField || b.c.moveId !== b.moveId || b.c.controller !== b.side || (b.c.isMonster && !b.c.faceUp)));
      if (gone.length && gone.length === allGone.length && v < 1100) flag('weak-use', link.card, `${link.card.name} spent on ${gone.map((b) => `${b.c.name} (${Math.round(b.v)})`).join(', ')}`, link.player);
    }
    if ((ef.categories ?? []).includes('destroyMulti')) {
      let mine = 0;
      let theirs = 0;
      let nm = 0;
      let nt = 0;
      for (const b of fieldBefore) {
        if (b.c.onField && b.c.moveId === b.moveId) continue;
        if (b.side === link.player) (mine += b.v), nm++;
        else (theirs += b.v), nt++;
      }
      if (voluntary && mine > 0 && mine >= theirs) flag('self-wipe', link.card, `took ${nm} own card(s) (value ${Math.round(mine)}) vs ${nt} opponent card(s) (value ${Math.round(theirs)})`);
    }
  };

  // --- discard / cost picks: throwing away a much better card than needed
  for (const ai of ais) {
    const orig = ai.selectCards.bind(ai);
    ai.selectCards = async (game, p, req) => {
      const picked = await orig(game, p, req);
      if ((req.purpose === 'discard' || req.purpose === 'cost') && picked.length && req.candidates.every((c) => c.location === 'hand') && picked.length < req.candidates.length) {
        const rest = req.candidates.filter((c) => !picked.includes(c));
        const worst = Math.max(...picked.map((c) => cardValue(game, c)));
        const cheapest = Math.min(...rest.map((c) => cardValue(game, c)));
        if (worst - cheapest >= 1500)
          flag('discard-best', req.source ?? picked[0], `"${req.prompt}": discards ${picked.map((c) => `${c.name} (${cardValue(game, c)})`).join(', ')} over ${rest.map((c) => `${c.name} (${cardValue(game, c)})`).join(', ')}`, p);
      }
      return picked;
    };
  }
  // --- attacks into bigger face-up monsters
  for (const ai of ais) {
    const orig = ai.chooseAttackTarget.bind(ai);
    ai.chooseAttackTarget = async (game, p, attacker, targets, canDirect) => {
      const t = await orig(game, p, attacker, targets, canDirect);
      if (t && t !== 'cancel' && t.faceUp) {
        const a = game.getAtk(attacker);
        const tv = t.pos === 'atk' ? game.getAtk(t) : game.getDef(t);
        if (tv > a && !game.queryCard(attacker, 'indestructibleBattle'))
          flag('suicide-attack', attacker, `${attacker.name} (${a}) attacks ${t.name} (${t.pos === 'atk' ? 'ATK' : 'DEF'} ${tv})`);
      }
      return t;
    };
  }
  try {
    const res = await g.start();
    rep.turns = res.turns;
    // A board wipe that clears the way for a lethal attack the same turn is no blunder.
    rep.blunders = rep.blunders.filter((b) => !(b.type === 'self-wipe' && res.winner === b.player && b.turn === res.turns));
  } catch (e) {
    rep.blunders.push({ type: 'crash', card: '-', detail: String((e as Error)?.message ?? e), game: index, turn: g.turn });
  }
  return rep;
}

// ------------------------------------------------------------------ worker / parent

async function workerMain() {
  const from = Number(arg('from', '0'));
  const stride = Number(arg('stride', '1'));
  console.error = () => {};
  if (!TRACE.length) console.log = () => {};
  const all: Report = { blunders: [], acts: {}, turns: 0 };
  for (let i = from; i < GAMES; i += stride) {
    const r = await playOne(i);
    all.blunders.push(...r.blunders);
    all.turns += r.turns;
    for (const [k, v] of Object.entries(r.acts)) all.acts[k] = (all.acts[k] ?? 0) + v;
    for (const [card, m] of Object.entries(r.ctxs ?? {})) for (const [k, v] of Object.entries(m)) ((all.ctxs ??= {})[card] ??= {})[k] = (all.ctxs[card][k] ?? 0) + v;
  }
  await new Promise<void>((r) => process.send!(all, () => r()));
  process.exit(0);
}

async function parentMain() {
  const t0 = Date.now();
  const script = fileURLToPath(import.meta.url);
  const W = Math.max(1, Math.min(WORKERS, GAMES));
  const pass = args.filter((a, i) => !['--workers'].includes(a) && args[i - 1] !== '--workers');
  const reports = await Promise.all(
    Array.from(
      { length: W },
      (_, w) =>
        new Promise<Report>((resolve) => {
          const child = fork(script, [...pass, '--worker', '--from', String(w), '--stride', String(W)], { execArgv: process.execArgv, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
          let got: Report = { blunders: [], acts: {}, turns: 0 };
          child.on('message', (m: any) => (got = m));
          child.on('exit', () => resolve(got));
        }),
    ),
  );
  const blunders = reports.flatMap((r) => r.blunders);
  const acts: Record<string, number> = {};
  for (const r of reports) for (const [k, v] of Object.entries(r.acts)) acts[k] = (acts[k] ?? 0) + v;
  const byType = new Map<string, Blunder[]>();
  for (const b of blunders) byType.set(b.type, [...(byType.get(b.type) ?? []), b]);
  const total = Object.values(acts).reduce((a, b) => a + b, 0);
  console.log(`AI blunders, seed ${SEED}, ${GAMES} games (${MODE}), ${total} AI activations, ${reports.reduce((a, r) => a + r.turns, 0)} turns, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`TOTAL ${blunders.length}: ${[...byType].sort((a, b) => b[1].length - a[1].length).map(([k, v]) => `${k} ${v.length}`).join(', ')}`);
  if (CONTEXTS) {
    const ctxs: Record<string, Record<string, number>> = {};
    for (const r of reports) for (const [card, m] of Object.entries(r.ctxs ?? {})) for (const [k, v] of Object.entries(m)) (ctxs[card] ??= {})[k] = (ctxs[card][k] ?? 0) + v;
    const tot = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
    for (const [card, m] of Object.entries(ctxs).sort((a, b) => tot(b[1]) - tot(a[1])).slice(0, 70))
      console.log(`${tot(m)} ${card}: ${Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v}x ${k}`).join(' | ')}`);
  }
  if (args.includes('--acts'))
    console.log(Object.entries(acts).sort((a, b) => b[1] - a[1]).slice(0, 80).map(([k, v]) => `${v} ${k}`).join('\n'));
  console.log(`BLUNDERS (excluding no-op-contested) ${blunders.filter((b) => b.type !== 'no-op-contested').length}`);
  for (const [type, list] of [...byType].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n== ${type}: ${list.length}`);
    const byCard = new Map<string, Blunder[]>();
    for (const b of list) byCard.set(b.card, [...(byCard.get(b.card) ?? []), b]);
    for (const [card, bl] of [...byCard].sort((a, b) => b[1].length - a[1].length).slice(0, 25)) {
      console.log(`  ${String(bl.length).padStart(4)} / ${String(acts[card] ?? 0).padStart(4)}  ${card}`);
      for (const b of bl.slice(0, EXAMPLES)) console.log(`         g${b.game} T${b.turn}: ${b.detail}`);
    }
  }
}

async function onlyMain() {
  const want = Number(arg('only'));
  const fromT = Number(arg('from-turn', '0'));
  const toT = Number(arg('to-turn', '999'));
  const rep = await playOne(want, (g) => {
    g.hooks.log = (e) => {
      if (e.turn >= fromT && e.turn <= toT) console.log(`  [T${e.turn}] ${e.text}`);
    };
  });
  for (const b of rep.blunders) console.log(`${b.type} T${b.turn} ${b.card}: ${b.detail}`);
}

if (arg('only') !== undefined) void onlyMain();
else if (WORKER) void workerMain();
else void parentMain();
