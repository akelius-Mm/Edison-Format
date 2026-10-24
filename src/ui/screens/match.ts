// Runs a single game or best-of-three match through the duel screen, with interstitials
// between games (loser chooses to go first or second; the AI always chooses to go first).
import type { PlayerId } from '../../engine/types';
import { matchOutcome } from '../../tournament/simulate';
import type { GameResult } from '../../tournament/types';
import type { DuelSide } from '../duel/api';
import { startDuel } from '../duel/duelScreen';
import { getSettings } from '../settings';
import { button, h, icon } from './dom';
import { applyPlaymat, renderAvatar } from './ext';
import { lockNav } from './nav';
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
}

export interface MatchOutcome {
  games: GameResult[];
  /** 'a' = side 0 won the match. */
  result: 'a' | 'b' | 'draw';
  conceded: boolean;
}

const isHuman = (s: DuelSide) => s.control === 'human';

export async function runMatch(setup: MatchSetup): Promise<MatchOutcome> {
  const host = h('div', { class: 'duel-host' });
  const playmat = setup.playmat ?? getSettings().playmat;
  document.body.appendChild(host);
  document.body.classList.add('in-duel');
  lockNav(true);
  const games: GameResult[] = [];
  let conceded = false;
  try {
    for (let guard = 0; guard < 8; guard++) {
      const out = matchOutcome(games, setup.bestOf, setup.requireWinner);
      if (out.result) return { games, result: out.result, conceded };
      if (out.exhausted) {
        // sudden death exhausted: coin flip
        return { games, result: Math.random() < 0.5 ? 'a' : 'b', conceded };
      }
      let first: PlayerId | 'coin' = 'coin';
      if (games.length) {
        const choice = await interstitial(host, setup, games, playmat);
        if (choice === 'concede') {
          conceded = true;
          const humanIdx = isHuman(setup.sides[0]) ? 0 : 1;
          return { games, result: humanIdx === 0 ? 'b' : 'a', conceded };
        }
        first = choice;
      }
      host.replaceChildren();
      const n = games.length + 1;
      const gameCaption = setup.bestOf === 1 && n === 1 ? setup.caption : `${setup.caption} · Game ${n}${setup.bestOf === 3 ? ' of 3' : ''}`;
      let g: GameResult;
      try {
        const r = await startDuel(host, {
          sides: setup.sides,
          playmat,
          firstPlayer: first,
          caption: gameCaption,
          allowSurrender: true,
        });
        g = { winner: (r.winner ?? null) as 0 | 1 | null, turns: r.turns, reason: r.surrendered ? 'Surrender' : r.reason, how: 'human' };
      } catch (e) {
        console.error('duel failed', e);
        g = { winner: null, turns: 0, reason: 'Duel ended unexpectedly', how: 'human' };
      }
      games.push(g);
      if (setup.stats) recordGame(setup.stats.deckKey, setup.stats.deckName, g.winner === 0 ? 'W' : g.winner === 1 ? 'L' : 'D');
    }
    return { games, result: 'draw', conceded };
  } finally {
    host.classList.add('closing');
    setTimeout(() => host.remove(), 300);
    document.body.classList.remove('in-duel');
    lockNav(false);
  }
}

/** Between-games screen. Resolves with who goes first next, or 'concede'. */
function interstitial(host: HTMLElement, setup: MatchSetup, games: GameResult[], playmat: string): Promise<PlayerId | 'coin' | 'concede'> {
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
      actions.append(button('Continue', () => resolve('coin'), { variant: 'primary', icon: 'play', cls: 'ui-btn-lg' }));
    } else if (isHuman(setup.sides[loser])) {
      msg = 'You lost the previous game, so you choose: go first or second?';
      actions.append(
        button('Go First', () => resolve(loser), { variant: 'primary', icon: 'bolt', cls: 'ui-btn-lg' }),
        button('Go Second', () => resolve((1 - loser) as PlayerId), { variant: 'ghost', icon: 'hand', cls: 'ui-btn-lg' }),
      );
    } else {
      msg = `${setup.sides[loser].name} lost the previous game and chooses to go first.`;
      actions.append(button('Continue', () => resolve(loser), { variant: 'primary', icon: 'play', cls: 'ui-btn-lg' }));
    }
    if (humanPlays) actions.append(button('Concede match', () => resolve('concede'), { variant: 'subtle', icon: 'flag' }));
    else setTimeout(() => resolve(loser ?? 'coin'), 4500); // exhibitions continue on their own

    const side = (s: DuelSide, w: number, i: number) =>
      h(
        'div',
        { class: ['inter-side', last.winner === i && 'won'] },
        h('span', { class: 'avatar-ring' }, renderAvatar(s.avatar, 84)),
        h('div', { class: 'inter-name' }, s.name),
        h('div', { class: 'inter-wins' }, String(w)),
      );
    host.append(
      bg,
      h(
        'div',
        { class: 'inter' },
        h('div', { class: 'inter-caption' }, setup.caption),
        h('div', { class: 'inter-title' }, `Game ${games.length} · ${lastText}`),
        h('div', { class: 'inter-reason' }, `${last.reason}${last.turns ? ` · ${last.turns} turns` : ''}`),
        h('div', { class: 'inter-score' }, side(A, wa, 0), h('div', { class: 'inter-vs' }, icon('swords')), side(B, wb, 1)),
        h('div', { class: 'inter-next' }, `Game ${games.length + 1}${setup.bestOf === 3 ? ' of 3' : ''}`),
        h('p', { class: 'inter-msg' }, msg),
        actions,
      ),
    );
    setTimeout(() => (actions.querySelector('button') as HTMLButtonElement | null)?.focus(), 50);
  });
}
