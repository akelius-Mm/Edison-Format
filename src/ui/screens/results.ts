// Match results screen.
import type { GameResult } from '../../tournament/types';
import { button, h, icon, ICONS, type Child } from './dom';
import { artInto, signatureForDeckName } from './components';
import type { MatchOutcome, MatchSetup } from './match';
import { showScreen, type Screen } from './nav';
import { getProfile, winRate } from './store';

export interface ResultsOptions {
  setup: MatchSetup;
  outcome: MatchOutcome;
  /** Perspective: index of the human side, or null for spectated matches. */
  human: 0 | null;
  context?: string;
  actions: { label: string; variant?: 'primary' | 'ghost' | 'gold'; icon?: keyof typeof ICONS; onClick: () => void }[];
  extra?: Child;
}

export function gameRow(g: GameResult, i: number, names: [string, string], human: 0 | null) {
  const won = g.winner == null ? 'draw' : human == null ? 'neutral' : g.winner === human ? 'win' : 'loss';
  const mark = won === 'win' ? 'W' : won === 'loss' ? 'L' : won === 'draw' ? 'D' : String(i + 1);
  return h(
    'div',
    { class: ['game-row', won] },
    h('span', { class: 'game-mark', 'aria-hidden': 'true' }, mark),
    h(
      'span',
      { class: 'game-main' },
      h('span', { class: 'game-res' }, `Game ${i + 1} · `, g.winner == null ? 'Draw' : `${names[g.winner]} won`),
      h('span', { class: 'game-why' }, g.reason),
    ),
    h('span', { class: 'game-turns' }, g.turns ? `${g.turns} turn${g.turns === 1 ? '' : 's'}` : ''),
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
  const focus = o.human === 0 || o.outcome.result !== 'b' ? A : B;

  const art = h('div', { class: 'res-art' });
  artInto(art, signatureForDeckName(focus.title, focus.deck.main));

  const side = (s: typeof A, winner: boolean, right = false) =>
    h('div', { class: ['res-side', winner && 'winner', right && 'right'] }, h('div', { class: 'res-name' }, s.name), h('div', { class: 'res-deck' }, s.title ?? ''));
  const stat = (v: string, l: string) => h('div', { class: 'res-stat' }, h('b', null, v), h('span', null, l));

  const el = h(
    'div',
    { class: ['results', `results-${kind}`], tabindex: '-1' },
    h(
      'section',
      { class: 'res-hero' },
      art,
      h('div', { class: 'res-shade' }),
      h(
        'div',
        { class: 'res-hero-body' },
        o.context ? h('div', { class: 'res-context' }, o.context) : null,
        h('h1', { class: 'res-headline' }, headline),
        h('div', { class: 'res-sub' }, o.outcome.conceded ? 'Match conceded' : o.setup.bestOf === 3 ? 'Best of three' : 'Single game'),
      ),
    ),
    h(
      'div',
      { class: 'res-inner' },
      h(
        'div',
        { class: 'res-board' },
        side(A, o.outcome.result === 'a'),
        h('div', { class: 'res-score' }, h('b', { class: o.outcome.result === 'a' ? 'lead' : '' }, String(wa)), h('span', null, '–'), h('b', { class: o.outcome.result === 'b' ? 'lead' : '' }, String(wb))),
        side(B, o.outcome.result === 'b', true),
      ),
      o.outcome.games.length ? h('div', { class: 'res-games' }, o.outcome.games.map((g, i) => gameRow(g, i, [A.name, B.name], o.human))) : null,
      ds
        ? h(
            'div',
            { class: 'res-stats' },
            stat(`${ds.w}-${ds.l}${ds.d ? '-' + ds.d : ''}`, 'Deck record'),
            stat(`${Math.round(winRate(ds) * 100)}%`, 'Win rate'),
            stat(`${profile.games.w}-${profile.games.l}`, 'Lifetime'),
          )
        : null,
      o.extra ?? null,
      h(
        'div',
        { class: 'res-actions' },
        o.actions.map((a, i) =>
          h('button', { type: 'button', class: ['cta', !(a.variant === 'primary' || a.variant === 'gold' || (i === 0 && !a.variant)) && 'cta--dark'], onclick: a.onClick }, a.icon ? icon(a.icon) : null, h('span', null, a.label)),
        ),
      ),
    ),
  );
  const screen: Screen = { el, onShow: () => setTimeout(() => el.querySelector<HTMLElement>('.res-actions button')?.focus({ preventScroll: true }), 80) };
  showScreen(screen, 'results');
}
