// Undo for misclicks (games against the AI only).
//
// A duel is rebuilt from its seed, decks and the human's decision log (engine/replay.ts), so undoing
// is "replay the log without its last decisions". The hard part is fairness: the player may take a
// play back only while nothing has happened that they could learn from. This module decides when.
//
// Undo points. Every main-action request of the human (RecordingController 'act': summon, set,
// activate, attack, change position, move to the next phase…) opens an undo point: the decision
// plus every follow-up prompt that belongs to it (tributes, targets, positions, costs, the human's
// own response windows, optional triggers) up to the next main-action request. Undo goes back to
// the most recent undo point that is already answered, i.e. the player is asked that action again.
// Undoing again from there goes one more point back, under the same rule.
//
// The rule (conservative; anything unknown blocks). Undo to point P is allowed only if, since the
// human was asked P's action, ALL of these hold:
//   1. the opponent's controller was not asked anything (no action, chain response, target, trigger
//      confirmation… an AI pass counts too: the window itself is information);
//   2. the game's random number generator was not used (shuffles, the coin toss, dice, coins,
//      random discards);
//   3. nothing hidden was shown: no 'reveal', 'coin', 'draw' or 'shuffle' animation;
//   4. no card left or entered a Deck (draws, searches, mills, cards returned to the Deck);
//   5. no event concerned a card the opponent owns or controls (their hidden cards, hand and field),
//      except declaring an attack on / targeting it, which reveals nothing by itself;
//   6. no event of type drawn, flipped, destroyed, battle destroyed, damage, battle damage, LP gain,
//      damage calculated or control changed happened, and neither player's LP changed;
//   7. the turn did not change (same turn number and turn player) and the game is not over.
// The decision being undone must be the human's own (the opponent's turn has no undo points), and the
// human must currently be waiting at a decision (the duel screen only offers it at an action prompt).
import type { PlayerController } from './controller';
import type { CardInstance } from './card';
import type { Game } from './game';
import type { DecisionKind } from './replay';
import type { EventType, GameEvent, PlayerId } from './types';

/** Snapshot of everything the rule compares, taken when an undo point's action is requested. */
export interface UndoMark {
  /** Log index of the 'act' decision (the log is cut back to this length). */
  log: number;
  seq: number;
  rng: number;
  reveal: number;
  opp: number;
  turn: number;
  turnPlayer: PlayerId;
  lp: [number, number];
}

/** Events that always make the decisions before them final. */
const BLOCKING: ReadonlySet<EventType> = new Set<EventType>([
  'drawn',
  'milled',
  'flipped',
  'destroyed',
  'battleDestroyed',
  'damage',
  'battleDamage',
  'lpGain',
  'damageCalculated',
  'controlChanged',
]);

/** Events that may name an opponent's card without revealing anything. */
const HARMLESS_ON_OPPONENT: ReadonlySet<EventType> = new Set<EventType>(['attackDeclared', 'targeted']);

const lastSeq = (g: Game) => g.eventLog[g.eventLog.length - 1]?.seq ?? 0;

export class UndoTracker {
  /** Undo points in log order (replayed and live). */
  readonly marks: UndoMark[] = [];
  /** Requests made to the opponent's controller so far. */
  oppCalls = 0;

  constructor(readonly human: PlayerId) {}

  /** Wrap the opponent's controller so every request to it is counted (at the call, not the answer). */
  watchOpponent<C extends PlayerController>(c: C): C {
    return new Proxy(c, {
      get: (t, k) => {
        const v = (t as any)[k];
        if (typeof v !== 'function' || !OPP_METHODS.has(k as string)) return v;
        return (...a: unknown[]) => {
          this.oppCalls++;
          return v.apply(t, a);
        };
      },
    });
  }

  /** RecordingOptions.onRequest for the human's recorder. */
  onRequest(kind: DecisionKind, game: Game, index: number) {
    if (kind !== 'act' || game.turnPlayer !== this.human) return;
    this.marks.push({
      log: index,
      seq: lastSeq(game),
      rng: game.rng.calls,
      reveal: game.revealSeq,
      opp: this.oppCalls,
      turn: game.turn,
      turnPlayer: game.turnPlayer,
      lp: [game.players[0].lp, game.players[1].lp],
    });
  }

  /** The undo point an undo would go back to (answered already), or null. */
  target(logLength: number): UndoMark | null {
    for (let i = this.marks.length - 1; i >= 0; i--) if (this.marks[i].log < logLength) return this.marks[i];
    return null;
  }

  /** Why undo is not allowed right now, or null when it is. */
  blocked(game: Game, logLength: number): string | null {
    const m = this.target(logLength);
    if (!m) return 'nothing to undo';
    if (game.over) return 'the game is over';
    if (this.oppCalls !== m.opp) return 'the opponent was asked to respond';
    if (game.turn !== m.turn || game.turnPlayer !== m.turnPlayer) return 'the turn changed';
    if (game.rng.calls !== m.rng) return 'a random result (shuffle, coin, die) was used';
    if (game.revealSeq !== m.reveal) return 'a card was drawn or revealed';
    if (game.players[0].lp !== m.lp[0] || game.players[1].lp !== m.lp[1]) return 'Life Points changed';
    // the event log keeps the last 1000+ events; if the mark scrolled out, refuse
    const log = game.eventLog;
    if (log.length && log[0].seq > m.seq + 1) return 'too much happened';
    for (const ev of log) {
      if (ev.seq <= m.seq) continue;
      const why = this.eventBlocks(ev);
      if (why) return why;
    }
    return null;
  }

  /** Log length to cut back to, or -1 when undo is not allowed. */
  undoIndex(game: Game, logLength: number): number {
    return this.blocked(game, logLength) ? -1 : this.target(logLength)!.log;
  }

  private eventBlocks(ev: GameEvent): string | null {
    if (BLOCKING.has(ev.type)) return `a card was ${ev.type === 'drawn' ? 'drawn' : 'affected'} (${ev.type})`;
    if (ev.from === 'deck' || ev.to === 'deck') return 'a card left or entered a Deck';
    if (HARMLESS_ON_OPPONENT.has(ev.type)) return null;
    const c = ev.card as CardInstance | undefined;
    if (c && (c.owner !== this.human || c.controller !== this.human)) return "an opponent's card was involved";
    if (ev.fromController !== undefined && ev.fromController !== this.human) return "an opponent's card was involved";
    return null;
  }
}

const OPP_METHODS = new Set(['chooseAction', 'chooseResponse', 'selectCards', 'chooseOption', 'confirm', 'choosePosition', 'chooseAttackTarget', 'confirmTrigger', 'declareCard']);
