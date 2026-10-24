// Match results screen.
import type { GameResult } from '../../tournament/types';
import { button, h, icon, type Child } from './dom';
import { renderAvatar } from './ext';
import type { MatchOutcome, MatchSetup } from './match';
import { showScreen, type Screen } from './nav';
import { getProfile, winRate } from './store';

export interface ResultsOptions {
  setup: MatchSetup;
  outcome: MatchOutcome;
  /** Perspective: index of the human side, or null for spectated matches. */
  human: 0 | null;
  context?: string;
  actions: { label: string; variant?: 'primary' | 'ghost' | 'gold'; icon?: Parameters<typeof button>[2]['icon']; onClick: () => void }[];
  extra?: Child;
}

export function gameRow(g: GameResult, i: number, names: [string, string], human: 0 | null) {
  const won = g.winner == null ? 'draw' : human == null ? 'neutral' : g.winner === human ? 'win' : 'loss';
  return h(
    'div',
    { class: ['game-row', won] },
    h('span', { class: 'game-no' }, `Game ${i + 1}`),
    h('span', { class: 'game-res' }, g.winner == null ? 'Draw' : `${names[g.winner]} won`),
    h('span', { class: 'game-why' }, g.reason),
    h('span', { class: 'game-turns' }, g.turns ? `${g.turns} turns` : ''),
  );
}

export function showResults(o: ResultsOptions) {
  const [A, B] = o.setup.sides;
  const wa = o.outcome.games.filter((g) => g.winner === 0).length;
  const wb = o.outcome.games.filter((g) => g.winner === 1).length;
  const kind = o.outcome.result === 'draw' ? 'draw' : o.human == null ? 'neutral' : (o.outcome.result === 'a') === (o.human === 0) ? 'victory' : 'defeat';
  const headline =
    kind === 'victory' ? 'Victory' : kind === 'defeat' ? 'Defeat' : kind === 'draw' ? 'Draw' : `${o.outcome.result === 'a' ? A.name : B.name} wins`;
  const profile = getProfile();
  const ds = o.setup.stats ? profile.decks[o.setup.stats.deckKey] : undefined;

  const side = (s: typeof A, w: number, winner: boolean) =>
    h(
      'div',
      { class: ['res-side', winner && 'winner'] },
      h('span', { class: 'avatar-ring' }, renderAvatar(s.avatar, 96)),
      h('div', { class: 'res-name' }, s.name),
      h('div', { class: 'res-deck' }, s.title ?? ''),
      winner ? h('div', { class: 'res-crown' }, icon('crown')) : null,
      h('div', { class: 'res-wins' }, String(w)),
    );

  const el = h(
    'div',
    { class: ['results', `results-${kind}`], tabindex: '-1' },
    h('div', { class: 'res-rays', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'res-inner' },
      o.context ? h('div', { class: 'res-context' }, o.context) : null,
      h('h1', { class: 'res-headline' }, headline),
      h('div', { class: 'res-sub' }, o.outcome.conceded ? 'Match conceded' : o.setup.bestOf === 3 ? 'Best of three' : 'Single game'),
      h('div', { class: 'res-score' }, side(A, wa, o.outcome.result === 'a'), h('div', { class: 'res-dash' }, '–'), side(B, wb, o.outcome.result === 'b')),
      h('div', { class: 'res-games' }, o.outcome.games.map((g, i) => gameRow(g, i, [A.name, B.name], o.human))),
      ds
        ? h(
            'div',
            { class: 'res-stats' },
            h('span', { class: 'stat-chip' }, h('b', null, `${ds.w}-${ds.l}${ds.d ? '-' + ds.d : ''}`), h('span', null, `${ds.name} record`)),
            h('span', { class: 'stat-chip' }, h('b', null, `${Math.round(winRate(ds) * 100)}%`), h('span', null, 'Deck win rate')),
            h('span', { class: 'stat-chip' }, h('b', null, `${profile.games.w}-${profile.games.l}`), h('span', null, 'Lifetime games')),
          )
        : null,
      o.extra ?? null,
      h(
        'div',
        { class: 'res-actions' },
        o.actions.map((a) => button(a.label, a.onClick, { variant: a.variant ?? 'ghost', icon: a.icon, cls: 'btn-lg' })),
      ),
    ),
  );
  const screen: Screen = { el, onShow: () => setTimeout(() => el.querySelector<HTMLElement>('.res-actions .btn')?.focus(), 80) };
  showScreen(screen, 'results');
}
