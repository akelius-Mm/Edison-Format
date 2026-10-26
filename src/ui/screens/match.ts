// Runs a single game or best-of-three match through the duel screen, with interstitials
// between games (loser chooses to go first or second; the AI always chooses to go first).
// Best-of-3: before that choice the human sides (when their deck has a Side Deck and side decking
// is on in Settings) and AI players side by a deterministic heuristic (decks/siding.ts).
import { aiSideDeck, cloneDeck, sideDiff, type DeckIds } from '../../decks/siding';
import type { PlayerId } from '../../engine/types';
import { matchOutcome } from '../../tournament/simulate';
import type { GameResult } from '../../tournament/types';
import type { DuelResult, DuelSide } from '../duel/api';
import { startDuel } from '../duel/duelScreen';
import { activeDuelFor, clearActiveDuel, deckFromIds, deckToIds, fromSavedSide, saveActiveDuel, toSavedSide, type PlayedGame, type ResumeTag, type SavedDuel } from '../duel/resume';
import { sidingScreen } from './siding';
import { getSettings } from '../settings';
import { button, h, icon, toast, type ICONS } from './dom';

const cta = (label: string, onClick: () => void, ic: keyof typeof ICONS, dark = false) =>
  h('button', { type: 'button', class: ['cta', dark && 'cta--dark'], onclick: onClick }, icon(ic), h('span', null, label));
import { applyPlaymat } from './ext';
import { go, lockNav } from './nav';
import { recordGame } from './store';

export interface MatchSetup {
  sides: [DuelSide, DuelSide];
  bestOf: 1 | 3;
  playmat?: string;
  /** Header caption, e.g. "Round 2 – vs Rei Mori (Blackwings)". */
  caption: string;
  /** Top-cut style: keep playing until someone leads. */
  requireWinner?: boolean;
  /** Stats key/name for the human's deck (side 0). Omit for exhibitions. */
  stats?: { deckKey: string; deckName: string };
  /**
   * Save the match after every decision so it can be resumed after the app is closed. When the
   * saved duel has the same key, runMatch picks it up where it was left instead of starting over.
   */
  resume?: ResumeTag;
  /** Draft / Sealed: the Side Deck is the rest of the pool and siding is not one-for-one. */
  limited?: boolean;
}

export interface MatchOutcome {
  games: GameResult[];
  /** 'a' = side 0 won the match. */
  result: 'a' | 'b' | 'draw';
  conceded: boolean;
}

const isHuman = (s: DuelSide) => s.control === 'human';
const newSeed = () => Math.floor(Math.random() * 2 ** 31);

/** Rebuild the setup of a saved match (null when one of its cards no longer exists). */
export function setupFromSaved(d: SavedDuel): MatchSetup | null {
  const a = fromSavedSide(d.setup.sides[0]);
  const b = fromSavedSide(d.setup.sides[1]);
  if (!a || !b) return null;
  return { sides: [a, b], bestOf: d.setup.bestOf, playmat: d.setup.playmat, caption: d.setup.caption, requireWinner: d.setup.requireWinner, stats: d.setup.stats, resume: d.tag, limited: d.setup.limited };
}

export async function runMatch(setup: MatchSetup): Promise<MatchOutcome> {
  // ---- resume: a saved duel for this very match continues where it was left
  const saving = !!setup.resume && setup.sides.some(isHuman);
  let rec: SavedDuel | null = null;
  if (saving) {
    const saved = activeDuelFor(setup.resume!.key);
    const restored = saved && setupFromSaved(saved);
    if (saved && restored) {
      rec = saved;
      setup = { ...restored, resume: { ...saved.tag, ...setup.resume } };
      rec.tag = setup.resume!;
    } else {
      if (saved) {
        clearActiveDuel();
        toast('The saved duel could not be restored, so the match starts over.', 'error', 3600);
      }
      rec = {
        v: 1,
        tag: setup.resume!,
        savedAt: Date.now(),
        setup: {
          sides: [toSavedSide(setup.sides[0]), toSavedSide(setup.sides[1])],
          bestOf: setup.bestOf,
          playmat: setup.playmat ?? getSettings().playmat,
          caption: setup.caption,
          requireWinner: setup.requireWinner,
          stats: setup.stats,
          ...(setup.limited ? { limited: true } : {}),
        },
        games: [],
        game: null,
      };
    }
  }
  const persist = () => {
    if (!rec) return;
    rec.savedAt = Date.now();
    saveActiveDuel(rec);
  };
  if (rec) {
    rec.live = true;
    persist();
  }
  const finish = () => {
    if (rec) clearActiveDuel();
  };

  const host = h('div', { class: 'duel-host' });
  const playmat = setup.playmat ?? getSettings().playmat;
  document.body.appendChild(host);
  document.body.classList.add('in-duel');
  lockNav(true);
  const games: GameResult[] = rec ? [...rec.games] : [];
  // ---- siding state: the original decks, each finished game's decks, and the match seed
  const original: [DeckIds, DeckIds] = [deckToIds(setup.sides[0].deck), deckToIds(setup.sides[1].deck)];
  const played: (PlayedGame | null)[] = rec?.played ? [...rec.played] : [];
  const matchSeed = rec?.seed ?? newSeed();
  if (rec && rec.seed == null) {
    rec.seed = matchSeed;
    persist();
  }
  /** The decks of the last finished game (older records without them: the original decks). */
  const lastDecks = (): [DeckIds, DeckIds] => {
    const d = played[games.length - 1]?.decks;
    return d ? [cloneDeck(d[0]), cloneDeck(d[1])] : [cloneDeck(original[0]), cloneDeck(original[1])];
  };
  let conceded = false;
  let left = false;
  try {
    for (let guard = 0; guard < 12; guard++) {
      const out = matchOutcome(games, setup.bestOf, setup.requireWinner);
      if (out.result) {
        finish();
        return { games, result: out.result, conceded };
      }
      if (out.exhausted) {
        // sudden death exhausted: coin flip
        finish();
        return { games, result: Math.random() < 0.5 ? 'a' : 'b', conceded };
      }
      // the game in progress (resuming), or a new one
      let cur = rec?.game && rec.game.index === games.length ? rec.game : null;
      if (!cur) {
        let first: PlayerId | 'coin' = 'coin';
        let decks: [DeckIds, DeckIds] = lastDecks();
        let oppSided = 0;
        if (games.length) {
          const prev = lastDecks();
          if (setup.bestOf === 3 && getSettings().sideDecking) {
            decks = await sideForGame(host, setup, games, played, original, prev, matchSeed, playmat, rec, persist);
            const h = setup.sides.findIndex(isHuman);
            if (h >= 0) {
              const d = sideDiff(prev[1 - h], decks[1 - h]);
              oppSided = d.added.reduce((a, [, n]) => a + n, 0);
            }
          }
          const choice = await interstitial(host, setup, games, playmat, oppSided);
          if (choice === 'concede') {
            conceded = true;
            finish();
            const humanIdx = isHuman(setup.sides[0]) ? 0 : 1;
            return { games, result: humanIdx === 0 ? 'b' : 'a', conceded };
          }
          first = choice;
        }
        const n = games.length + 1;
        cur = {
          index: games.length,
          seed: newSeed(),
          first,
          skipFirstDraw: getSettings().skipFirstDraw,
          caption: setup.bestOf === 1 && n === 1 ? setup.caption : `${setup.caption} · Game ${n}${setup.bestOf === 3 ? ' of 3' : ''}`,
          log: [],
          turn: 0,
        };
        // the decks are stored only when siding changed them (older builds read the setup decks)
        if (!sameDecks(decks, original)) cur.decks = decks;
        if (rec) {
          rec.game = cur;
          rec.siding = null;
          persist();
        }
      }
      host.replaceChildren();
      const game = cur;
      const gameSides: [DuelSide, DuelSide] = [0, 1].map((i) => {
        const d = game.decks?.[i] ? deckFromIds(game.decks[i]) : null;
        return d ? { ...setup.sides[i], deck: d } : setup.sides[i];
      }) as [DuelSide, DuelSide];
      let decided = false;
      const onGameOver = (r: DuelResult) => {
        decided = true;
        const g: GameResult = { winner: (r.winner ?? null) as 0 | 1 | null, turns: r.turns, reason: r.surrendered ? 'Surrender' : r.reason, how: 'human' };
        games.push(g);
        played[game.index] = { decks: game.decks ?? original, ...(r.seen ? { seen: r.seen } : {}) };
        if (setup.stats) recordGame(setup.stats.deckKey, setup.stats.deckName, g.winner === 0 ? 'W' : g.winner === 1 ? 'L' : 'D');
        if (rec) {
          // decided: a reload from the result screen resumes between games, not inside this one
          rec.games = [...games];
          rec.played = [...played];
          rec.game = null;
          persist();
        }
      };
      let r: DuelResult | null = null;
      try {
        r = await startDuel(host, {
          sides: gameSides,
          playmat,
          firstPlayer: game.first,
          seed: game.seed,
          skipFirstDraw: game.skipFirstDraw,
          caption: game.caption,
          allowSurrender: true,
          resumable: !!rec,
          replay: game.log.length ? game.log : undefined,
          onDecision: rec
            ? (log, g) => {
                game.log = log.slice();
                game.turn = g.turn;
                persist();
              }
            : undefined,
          onGameOver,
        });
      } catch (e) {
        console.error('duel failed', e);
      }
      if (r?.left) {
        left = true;
        return new Promise<MatchOutcome>(() => {});
      }
      if (r?.restoreFailed) {
        await restoreFailed(host, setup, game.index, playmat);
        game.seed = newSeed();
        game.log = [];
        game.turn = 0;
        persist();
        continue;
      }
      if (!decided) onGameOver({ winner: null, turns: r?.turns ?? 0, reason: 'Duel ended unexpectedly' });
    }
    finish();
    return { games, result: 'draw', conceded };
  } finally {
    host.classList.add('closing');
    setTimeout(() => host.remove(), 300);
    document.body.classList.remove('in-duel');
    lockNav(false);
    // "Leave and save": the match never resolves; go back to where it can be resumed
    if (left && rec) {
      rec.live = false;
      persist();
      const t = rec.tag;
      if (t.kind === 'vsai') go('title', {}, { replace: true });
      else go(t.route, t.params ?? {}, { replace: true });
    }
  }
}

/** Replaying a saved game did not reproduce it: say so and start that game again. */
function restoreFailed(host: HTMLElement, setup: MatchSetup, index: number, playmat: string): Promise<void> {
  return new Promise((resolve) => {
    host.replaceChildren();
    const bg = h('div', { class: 'inter-bg' });
    applyPlaymat(bg, playmat);
    const actions = h('div', { class: 'inter-actions' }, cta('Start this game again', () => resolve(), 'refresh'));
    host.append(
      bg,
      h(
        'div',
        { class: 'inter inter--restore' },
        h('div', { class: 'inter-caption' }, setup.caption),
        h('div', { class: 'inter-title' }, `Game ${index + 1}`),
        h('div', { class: 'inter-result' }, 'Couldn’t restore this duel exactly'),
        h('p', { class: 'inter-msg' }, 'The saved moves no longer line up with the game, so this game starts again from the beginning. Earlier games of the match still count.'),
        actions,
      ),
    );
    setTimeout(() => (actions.querySelector('button') as HTMLButtonElement | null)?.focus(), 50);
  });
}

const sameDeck = (a: DeckIds, b: DeckIds) => a.main.join() === b.main.join() && a.extra.join() === b.extra.join() && a.side.join() === b.side.join();
const sameDecks = (a: [DeckIds, DeckIds], b: [DeckIds, DeckIds]) => sameDeck(a[0], b[0]) && sameDeck(a[1], b[1]);

/**
 * Side decking before game `games.length + 1`. AI players side from their original deck against
 * the opponent's original deck (deterministic from the match seed); the human sides on the siding
 * screen, starting from the previous game's deck (or the swaps saved before the app was closed).
 */
async function sideForGame(
  host: HTMLElement,
  setup: MatchSetup,
  games: GameResult[],
  played: (PlayedGame | null)[],
  original: [DeckIds, DeckIds],
  prev: [DeckIds, DeckIds],
  matchSeed: number,
  playmat: string,
  rec: SavedDuel | null,
  persist: () => void,
): Promise<[DeckIds, DeckIds]> {
  const index = games.length;
  const decks: [DeckIds, DeckIds] = [cloneDeck(prev[0]), cloneDeck(prev[1])];
  for (const i of [0, 1] as const) {
    if (isHuman(setup.sides[i]) || setup.limited || !original[i].side.length) continue;
    decks[i] = aiSideDeck(original[i], original[1 - i], (matchSeed + index * 7919 + i * 104729) >>> 0);
  }
  const hi = setup.sides.findIndex(isHuman);
  if (hi < 0 || !original[hi].side.length) return decks;
  const saved = rec?.siding && rec.siding.index === index && rec.siding.player === hi ? rec.siding : null;
  if (saved?.done) {
    decks[hi] = cloneDeck(saved.deck);
    return decks;
  }
  const oi = 1 - hi;
  const wHuman = games.filter((g) => g.winner === hi).length;
  const wOpp = games.filter((g) => g.winner === oi).length;
  const last = games[games.length - 1];
  const lastText = last.winner == null ? `Game ${index} was a draw` : last.winner === hi ? `You won game ${index}` : `You lost game ${index}`;
  // what the opponent showed: the most copies seen in any one game
  const seen = new Map<string, number>();
  for (const p of played) {
    const t = new Map<string, number>();
    for (const id of p?.seen?.[oi] ?? []) t.set(id, (t.get(id) ?? 0) + 1);
    for (const [id, n] of t) seen.set(id, Math.max(n, seen.get(id) ?? 0));
  }
  const persistSiding = (deck: DeckIds, done = false) => {
    if (!rec) return;
    rec.siding = { index, player: hi as PlayerId, deck, ...(done ? { done: true } : {}) };
    persist();
  };
  if (rec && !saved) persistSiding(decks[hi]);
  const deck = await sidingScreen(host, {
    caption: setup.caption,
    gameNo: index + 1,
    status: `${lastText} · ${wHuman}–${wOpp}`,
    opp: { name: setup.sides[oi].name, deck: setup.sides[oi].title, seen: [...seen].sort((a, b) => b[1] - a[1]) },
    start: saved ? saved.deck : decks[hi],
    previous: prev[hi],
    original: original[hi],
    limited: setup.limited,
    playmat,
    onChange: (d) => persistSiding(d),
  });
  persistSiding(deck, true);
  decks[hi] = deck;
  return decks;
}

/** Between-games screen. Resolves with who goes first next, or 'concede'. */
function interstitial(host: HTMLElement, setup: MatchSetup, games: GameResult[], playmat: string, oppSided = 0): Promise<PlayerId | 'coin' | 'concede'> {
  return new Promise((resolve) => {
    host.replaceChildren();
    const [A, B] = setup.sides;
    const wa = games.filter((g) => g.winner === 0).length;
    const wb = games.filter((g) => g.winner === 1).length;
    const last = games[games.length - 1];
    const loser: PlayerId | null = last.winner == null ? null : ((1 - last.winner) as PlayerId);
    const humanPlays = isHuman(A) || isHuman(B);
    const lastText = last.winner == null ? 'Draw' : `${setup.sides[last.winner].name} wins`;
    const bg = h('div', { class: 'inter-bg' });
    applyPlaymat(bg, playmat);

    const actions = h('div', { class: 'inter-actions' });
    let msg = '';
    if (loser == null) {
      msg = 'The last game was a draw — a coin toss decides who goes first.';
      actions.append(cta('Continue', () => resolve('coin'), 'play'));
    } else if (isHuman(setup.sides[loser])) {
      msg = 'You lost the previous game, so you choose: go first or second?';
      actions.append(
        h('div', { class: 'inter-choice' }, cta('Go first', () => resolve(loser), 'bolt'), cta('Go second', () => resolve((1 - loser) as PlayerId), 'hand', true)),
      );
    } else {
      msg = `${setup.sides[loser].name} lost the previous game and chooses to go first.`;
      actions.append(cta('Continue', () => resolve(loser), 'play'));
    }
    if (humanPlays && oppSided) {
      const opp = setup.sides.find((s) => !isHuman(s));
      msg += ` ${opp?.name ?? 'Your opponent'} sided ${oppSided} card${oppSided === 1 ? '' : 's'}.`;
    }
    if (humanPlays) actions.append(button('Concede match', () => resolve('concede'), { variant: 'subtle', icon: 'flag', cls: 'inter-concede' }));
    else setTimeout(() => resolve(loser ?? 'coin'), 4500); // exhibitions continue on their own

    const side = (s: DuelSide, i: number) =>
      h('div', { class: ['inter-side', last.winner === i && 'won', i === 1 && 'right'] }, h('div', { class: 'inter-name' }, s.name), h('div', { class: 'inter-deck' }, s.title ?? ''));
    host.append(
      bg,
      h(
        'div',
        { class: 'inter' },
        h('div', { class: 'inter-caption' }, setup.caption),
        h('div', { class: 'inter-title' }, `Game ${games.length}`),
        h('div', { class: 'inter-result' }, lastText),
        h('div', { class: 'inter-reason' }, `${last.reason}${last.turns ? ` · ${last.turns} turn${last.turns === 1 ? '' : 's'}` : ''}`),
        h(
          'div',
          { class: 'inter-score' },
          side(A, 0),
          h('div', { class: 'inter-nums' }, h('b', null, String(wa)), h('span', null, '–'), h('b', null, String(wb))),
          side(B, 1),
        ),
        h('div', { class: 'inter-next' }, `Up next · Game ${games.length + 1}${setup.bestOf === 3 ? ' of 3' : ''}`),
        h('p', { class: 'inter-msg' }, msg),
        actions,
      ),
    );
    setTimeout(() => (actions.querySelector('button') as HTMLButtonElement | null)?.focus(), 50);
  });
}
