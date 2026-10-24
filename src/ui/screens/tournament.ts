// Tournament mode: creation, hub (pairings / standings / bracket / entrants), human matches,
// simulated tables and the final placement screen.
import type { Difficulty } from '../../ai/ai';
import { PREMADE_DECKS } from '../../decks';
import { simulateMatch } from '../../tournament/simulate';
import {
  advance,
  clearActiveTournament,
  computeStandings,
  createTournament,
  currentMatches,
  currentRoundLabel,
  difficultyLabel,
  entrant,
  humanEliminated,
  humanMatchThisRound,
  isRoundComplete,
  loadActiveTournament,
  pendingHumanMatch,
  recordHumanMatch,
  saveTournament,
  simulateRound,
  type DeckSnapshot,
  type DifficultyMix,
  type Entrant,
  type Match,
  type SimMode,
  type Standing,
  type Tournament,
} from '../../tournament/tournament';
import { finalPlacements, roundComplete } from '../../tournament/swiss';
import type { DuelSide } from '../duel/api';
import { getSettings, loadJSON, saveJSON } from '../settings';
import { deckPicker, tierBadge } from './components';
import { badge, button, clear, confirmDialog, h, icon, pct, segmented, toast } from './dom';
import { AVATAR_PRESETS, SLEEVES, renderAvatar } from './ext';
import { runMatch } from './match';
import { frame, go, lockNav, type Screen } from './nav';
import { gameRow, showResults } from './results';
import { allDeckInfos, getProfile, ordinal, recordMatch, recordTournament, toDeckList, tournamentSummary } from './store';

const FORM_KEY = 'edison.tournament.form.v1';

interface FormState {
  name: string;
  size: 8 | 16 | 32;
  deck: string | null;
  mix: DifficultyMix;
  bestOf: 1 | 3;
  sim: SimMode;
}

type HubTab = 'round' | 'standings' | 'bracket' | 'entrants';

export function tournamentScreen(): Screen {
  const t = loadActiveTournament();
  if (!t) return createScreen();
  if (t.phase === 'done') return finalScreen(t);
  return hubScreen(t);
}

// =================================================================== creation

function createScreen(): Screen {
  const decks = allDeckInfos();
  const profile = getProfile();
  const saved = loadJSON<Partial<FormState>>(FORM_KEY, {});
  const st: FormState = {
    name: saved.name || `Edison Regional #${profile.tournaments.length + 1}`,
    size: saved.size ?? 16,
    deck: saved.deck && decks.some((d) => d.key === saved.deck) ? saved.deck : (decks.find((d) => !d.problems.length)?.key ?? null),
    mix: saved.mix ?? 'mixed',
    bestOf: saved.bestOf ?? 3,
    sim: saved.sim ?? 'fast',
  };
  const persist = () => saveJSON(FORM_KEY, { ...st, name: undefined });

  const nameIn = h('input', { class: 'input', value: st.name, maxlength: 40, 'aria-label': 'Tournament name' });
  nameIn.addEventListener('input', () => (st.name = nameIn.value));

  const summary = h('div', { class: 'tc-summary' });
  const drawSummary = () => {
    const rounds = Math.ceil(Math.log2(st.size));
    const cut = st.size <= 8 ? 4 : 8;
    summary.replaceChildren(
      h('div', { class: 'tc-sum-row' }, icon('user'), `${st.size} players (you + ${st.size - 1} AI duelists)`),
      h('div', { class: 'tc-sum-row' }, icon('shuffle'), `${rounds} Swiss rounds, then a Top ${cut} single-elimination cut`),
      h('div', { class: 'tc-sum-row' }, icon('swords'), `${st.bestOf === 3 ? 'Best-of-three' : 'Single-game'} matches · ${rounds + Math.log2(cut)} rounds max for you`),
      h('div', { class: 'tc-sum-row' }, icon('robot'), st.sim === 'fast' ? 'Other tables resolved instantly with a rating model' : 'Other tables played out by the AI with the full rules engine'),
    );
  };
  drawSummary();

  const createBtn = button('Create tournament', () => void create(), { variant: 'primary', icon: 'trophy', cls: 'btn-lg' });

  async function create() {
    const info = decks.find((d) => d.key === st.deck);
    if (!info) return toast('Choose your deck first.', 'error');
    if (info.problems.length) return toast(`${info.name} isn't tournament legal: ${info.problems[0]}`, 'error', 4000);
    if (!PREMADE_DECKS.length) return toast('No premade decks are available for AI entrants.', 'error');
    const s = getSettings();
    const snap: DeckSnapshot = { id: info.key, name: info.name, archetype: info.archetype, tier: info.tier, color: info.color, main: info.main, extra: info.extra };
    const t = createTournament({
      name: st.name.trim() || 'Edison Open',
      size: st.size,
      bestOf: st.bestOf,
      simMode: st.sim,
      difficultyMix: st.mix,
      human: { name: s.playerName, avatar: s.avatar, sleeve: s.sleeve, deck: snap },
      sleeves: SLEEVES.map((x) => x.id),
      avatars: AVATAR_PRESETS.filter((a) => a !== s.avatar),
    });
    saveTournament(t);
    go('tournament', { t: t.id }, { replace: true });
  }

  const ts = tournamentSummary();
  const history = profile.tournaments;
  const el = frame(
    'Tournament',
    { subtitle: 'Swiss rounds, a top cut and a trophy', cls: 'tour-create' },
    h(
      'div',
      { class: 'tc-layout' },
      h(
        'section',
        { class: 'tc-form panel' },
        h('div', { class: 'panel-body tc-form-body' },
          h('div', { class: 'tc-hero' }, h('span', { class: 'tc-hero-icon' }, icon('trophy')), h('div', null, h('h2', null, 'Create a tournament'), h('p', { class: 'muted' }, 'Register with one of your decks. The AI field brings the Edison meta, weighted toward the top tiers with a few rogue picks.'))),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Tournament name'), nameIn),
          h(
            'div',
            { class: 'tc-row' },
            h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Players'), segmented<8 | 16 | 32>([{ value: 8, label: '8' }, { value: 16, label: '16' }, { value: 32, label: '32' }], st.size, (v) => ((st.size = v), persist(), drawSummary()), 'Players')),
            h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Matches'), segmented<1 | 3>([{ value: 1, label: 'Best of 1' }, { value: 3, label: 'Best of 3' }], st.bestOf, (v) => ((st.bestOf = v), persist(), drawSummary()), 'Match format')),
          ),
          h(
            'div',
            { class: 'tc-row' },
            h(
              'div',
              { class: 'field' },
              h('span', { class: 'field-label' }, 'AI difficulty'),
              segmented<DifficultyMix>(
                [
                  { value: 'easy', label: 'Easy' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'hard', label: 'Hard' },
                  { value: 'mixed', label: 'Mixed', hint: 'Skilled personas tend to play harder' },
                ],
                st.mix,
                (v) => ((st.mix = v), persist()),
                'AI difficulty',
              ),
            ),
            h(
              'div',
              { class: 'field' },
              h('span', { class: 'field-label' }, 'Simulation'),
              segmented<SimMode>(
                [
                  { value: 'fast', label: 'Fast', hint: 'Instant results from deck tier, persona skill and luck' },
                  { value: 'full', label: 'Full', hint: 'AI-vs-AI games actually played with the engine (slower)' },
                ],
                st.sim,
                (v) => ((st.sim = v), persist(), drawSummary()),
                'Simulation mode',
              ),
            ),
          ),
          summary,
        ),
      ),
      h(
        'section',
        { class: 'tc-deck panel' },
        h('header', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, 'Your deck')),
        h('div', { class: 'panel-body tc-deck-body' }, deckPicker(decks, st.deck, (d) => ((st.deck = d.key), persist()), { emptyText: 'No decks yet — build one in the Deck Builder.' })),
      ),
      h(
        'aside',
        { class: 'tc-side' },
        h(
          'section',
          { class: 'panel tc-record' },
          h('header', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, 'Your circuit')),
          h(
            'div',
            { class: 'panel-body' },
            h(
              'div',
              { class: 'tc-chips' },
              h('span', { class: 'stat-chip' }, h('b', null, String(ts.played)), h('span', null, 'Events')),
              h('span', { class: 'stat-chip' }, h('b', null, String(ts.wins)), h('span', null, 'Titles')),
              h('span', { class: 'stat-chip' }, h('b', null, ts.best ? ordinal(ts.best) : '—'), h('span', null, 'Best finish')),
            ),
            history.length
              ? h(
                  'div',
                  { class: 'tc-history' },
                  history.slice(0, 8).map((x) =>
                    h(
                      'div',
                      { class: ['tc-hist', x.place === 1 && 'won'] },
                      h('span', { class: 'tc-place' }, x.place === 1 ? icon('trophy') : ordinal(x.place)),
                      h('span', { class: 'tc-hist-text' }, h('b', null, x.name), h('span', null, `${x.size} players · ${x.deckName} · ${x.record}`)),
                      h('span', { class: 'tc-date' }, new Date(x.date).toLocaleDateString()),
                    ),
                  ),
                )
              : h('p', { class: 'muted tc-empty' }, 'No tournaments played yet. Your results will appear here.'),
          ),
        ),
      ),
    ),
    h('div', { class: 'setup-bar tc-bar' }, h('div', { class: 'setup-summary muted' }, icon('info'), ' Progress is saved after every match — you can leave and resume any time.'), createBtn),
  );
  return { el };
}

// =================================================================== hub

function hubScreen(t: Tournament): Screen {
  let tab: HubTab = 'round';
  let simulating = false;
  let disposed = false;
  let progress: { done: number; total: number; label: string } | null = null;

  const E = (id: string | null | undefined) => entrant(t, id);
  const standings = () => computeStandings(t);

  const stepper = h('div', { class: 'tour-steps' });
  const tabsEl = h('div', { class: 'tabs tour-tabs', role: 'tablist' });
  const body = h('div', { class: 'tour-body' });
  const headActions = h('div', { class: 'tour-head-actions' });

  const subtitle = () => `${t.size} players · ${t.bestOf === 3 ? 'Best of 3' : 'Best of 1'} · ${t.simMode === 'full' ? 'Full' : 'Fast'} simulation · ${currentRoundLabel(t)}`;
  function redraw() {
    if (disposed) return;
    const sub = el.querySelector('.frame-sub');
    if (sub) sub.textContent = subtitle();
    drawStepper();
    drawTabs();
    clear(body);
    body.appendChild(tab === 'round' ? roundView() : tab === 'standings' ? standingsView() : tab === 'bracket' ? bracketView() : entrantsView());
    drawHeadActions();
  }

  function drawHeadActions() {
    clear(headActions);
    headActions.append(
      button(
        'Abandon',
        async () => {
          if (!(await confirmDialog('Abandon tournament', `Drop out of ${t.name}? The tournament will be deleted and won't count in your history.`, 'Abandon', true))) return;
          clearActiveTournament();
          go('tournament', {}, { replace: true });
        },
        { variant: 'subtle', small: true, icon: 'flag', title: 'Abandon tournament' },
      ),
    );
  }

  function drawStepper() {
    clear(stepper);
    const steps: { label: string; short: string; state: 'done' | 'cur' | 'todo' }[] = [];
    const swissDone = t.phase === 'top' || t.phase === 'done';
    for (let i = 1; i <= t.swissRounds; i++) {
      const done = swissDone || i < t.rounds.length || (i === t.rounds.length && isRoundComplete(t));
      steps.push({ label: `Round ${i}`, short: String(i), state: done ? 'done' : i === t.rounds.length ? 'cur' : 'todo' });
    }
    const cutRounds = Math.log2(t.topCut);
    const labels = t.topCut === 8 ? ['Quarters', 'Semis', 'Final'] : ['Semis', 'Final'];
    const shorts = t.topCut === 8 ? ['QF', 'SF', 'F'] : ['SF', 'F'];
    for (let i = 0; i < cutRounds; i++) {
      const r = t.top[i];
      const done = !!r && (i < t.top.length - 1 || roundComplete(r));
      steps.push({ label: labels[i], short: shorts[i], state: !r ? 'todo' : done ? 'done' : 'cur' });
    }
    stepper.append(
      ...steps.map((s, i) =>
        h(
          'div',
          { class: ['tour-step', s.state, i === t.swissRounds && 'cut'] },
          h('span', { class: 'tour-dot' }, s.state === 'done' ? icon('check') : s.short),
          h('span', { class: 'tour-step-label' }, s.label),
        ),
      ),
    );
  }

  function drawTabs() {
    clear(tabsEl);
    const tabs: [HubTab, string, Parameters<typeof icon>[0]][] = [
      ['round', t.phase === 'lobby' ? 'Overview' : 'Current round', 'swords'],
      ['standings', 'Standings', 'list'],
      ['bracket', `Top ${t.topCut}`, 'bracket'],
      ['entrants', 'Entrants', 'user'],
    ];
    for (const [k, l, ic] of tabs)
      tabsEl.appendChild(
        h(
          'button',
          {
            type: 'button',
            class: ['tab', tab === k && 'on'],
            role: 'tab',
            'aria-selected': String(tab === k),
            onclick: () => {
              tab = k;
              redraw();
            },
          },
          icon(ic),
          l,
        ),
      );
  }

  // ---------------------------------------------------------------- round view
  function recordOf(id: string, st: Standing[]) {
    const s = st.find((x) => x.id === id);
    return s ? `${s.w}-${s.l}${s.d ? '-' + s.d : ''}` : '';
  }

  function roundView(): HTMLElement {
    if (t.phase === 'lobby') return lobbyView();
    const st = standings();
    const ms = currentMatches(t);
    const mine = humanMatchThisRound(t);
    const wrap = h('div', { class: 'round-view' });
    wrap.appendChild(h('div', { class: 'round-title' }, h('h2', null, currentRoundLabel(t)), h('span', { class: 'muted' }, `${ms.filter((m) => m.result).length} / ${ms.length} matches complete`)));
    wrap.appendChild(myMatchCard(mine, st));
    if (progress) {
      wrap.appendChild(
        h(
          'div',
          { class: 'sim-progress' },
          h('div', { class: 'sim-label' }, h('span', { class: 'spinner' }), progress.label),
          h('div', { class: 'progress' }, h('i', { style: { width: `${(progress.done / Math.max(1, progress.total)) * 100}%` } })),
          h('div', { class: 'sim-count' }, `${progress.done} / ${progress.total}`),
        ),
      );
    }
    wrap.appendChild(roundControls());
    wrap.appendChild(pairingsTable(ms, st));
    return wrap;
  }

  function roundControls(): HTMLElement {
    const c = h('div', { class: 'round-controls' });
    if (simulating) return c;
    const pending = pendingHumanMatch(t);
    const complete = isRoundComplete(t);
    if (!complete && !pending) c.appendChild(button('Simulate remaining tables', () => void simulateRest(), { variant: 'primary', icon: 'robot' }));
    if (complete) {
      const isLastSwiss = t.phase === 'swiss' && t.rounds.length >= t.swissRounds;
      const isFinal = t.phase === 'top' && currentMatches(t).length === 1;
      const label = isFinal ? 'See final results' : isLastSwiss ? `Start Top ${t.topCut}` : 'Next round';
      c.appendChild(
        h('div', { class: 'round-done' }, icon('check'), h('span', null, isLastSwiss ? 'Swiss rounds complete — the top cut is set.' : 'Round complete.')),
      );
      c.appendChild(
        button(
          label,
          () => {
            advance(t);
            saveTournament(t);
            if (t.phase === 'done') return go('tournament', { t: t.id, done: '1' }, { replace: true });
            tab = 'round';
            redraw();
            maybeAutoSimulate();
          },
          { variant: 'primary', icon: isFinal ? 'trophy' : 'play', cls: 'btn-lg' },
        ),
      );
    }
    return c;
  }

  function myMatchCard(m: Match | null, st: Standing[]): HTMLElement {
    const me = E(t.humanId)!;
    if (!m) {
      const out = humanEliminated(t);
      return h(
        'div',
        { class: 'my-match idle' },
        h('span', { class: 'mm-icon' }, icon(out ? 'flag' : 'info')),
        h(
          'div',
          null,
          h('h3', null, out ? 'Your run has ended' : 'No match this round'),
          h('p', { class: 'muted' }, out ? 'You did not make it through this stage. The remaining matches will be simulated — follow the bracket to see who takes the title.' : 'Sit back while the other tables finish.'),
        ),
      );
    }
    if (m.b == null)
      return h('div', { class: 'my-match idle' }, h('span', { class: 'mm-icon' }, icon('check')), h('div', null, h('h3', null, 'You have a bye'), h('p', { class: 'muted' }, 'A bye counts as a match win (3 points).')));
    const oppId = m.a === t.humanId ? m.b : m.a;
    const opp = E(oppId)!;
    const meA = m.a === t.humanId;
    const done = m.result != null;
    const won = done && (m.result === 'a') === meA;
    const draw = m.result === 'draw';
    const wa = m.games.filter((g) => g.winner === 0).length;
    const wb = m.games.filter((g) => g.winner === 1).length;
    const [myW, opW] = meA ? [wa, wb] : [wb, wa];
    const side = (e: Entrant, isMe: boolean) =>
      h(
        'div',
        { class: ['mm-side', isMe ? 'me' : 'opp'] },
        h('span', { class: 'avatar-ring' }, renderAvatar(e.avatar, 76)),
        h(
          'div',
          { class: 'mm-who' },
          h('div', { class: 'mm-name' }, e.name),
          h('div', { class: 'mm-title' }, isMe ? `Record ${recordOf(e.id, st)}` : `${e.title} · ${recordOf(e.id, st)}`),
          h('div', { class: 'mm-deck', style: { '--deck': e.deck.color } }, h('i'), e.deck.name, isMe ? null : badge(difficultyLabel(e.difficulty), e.difficulty === 'hard' ? 'red' : e.difficulty === 'easy' ? 'green' : 'blue')),
        ),
      );
    return h(
      'div',
      { class: ['my-match', done && (draw ? 'draw' : won ? 'won' : 'lost')] },
      h('div', { class: 'mm-label' }, `${m.label} · Table ${m.table}`),
      h(
        'div',
        { class: 'mm-vs' },
        side(me, true),
        h('div', { class: 'mm-mid' }, done ? h('div', { class: 'mm-score' }, `${myW} – ${opW}`) : h('div', { class: 'mm-vsbadge' }, 'VS'), done ? h('div', { class: 'mm-res' }, draw ? 'Draw' : won ? 'Victory' : 'Defeat') : null),
        side(opp, false),
      ),
      done
        ? h('div', { class: 'mm-games' }, m.games.map((g, i) => gameRow(meA ? g : { ...g, winner: g.winner == null ? null : ((1 - g.winner) as 0 | 1) }, i, [me.name, opp.name], 0)))
        : h(
            'div',
            { class: 'mm-actions' },
            button('Play match', () => void playMine(m), { variant: 'primary', icon: 'swords', cls: 'btn-lg' }),
            button('Auto-play my match', () => void autoPlayMine(m), { variant: 'ghost', icon: 'robot', title: 'Let the AI play your deck for you' }),
          ),
    );
  }

  function pairingsTable(ms: Match[], st: Standing[]) {
    const rows = ms.map((m) => {
      const A = E(m.a)!;
      const B = E(m.b);
      const wa = m.games.filter((g) => g.winner === 0).length;
      const wb = m.games.filter((g) => g.winner === 1).length;
      const isMe = m.a === t.humanId || m.b === t.humanId;
      const who = (e: Entrant | undefined, win: boolean, right = false) =>
        e
          ? h(
              'div',
              { class: ['pt-player', win && 'win', right && 'right'] },
              renderAvatar(e.avatar, 30),
              h('div', { class: 'pt-who' }, h('span', { class: 'pt-name' }, e.name, e.human ? badge('You', 'gold') : null), h('span', { class: 'pt-deck' }, `${e.deck.name} · ${recordOf(e.id, st)}`)),
            )
          : h('div', { class: ['pt-player', 'bye', right && 'right'] }, h('span', { class: 'muted' }, 'BYE'));
      const res = m.b == null ? 'Bye' : m.result == null ? (progress?.label.includes(A.name) ? '…' : 'vs') : `${wa} – ${wb}`;
      return h(
        'tr',
        { class: [isMe && 'me', m.result == null && 'pending'] },
        h('td', { class: 'pt-table' }, String(m.table)),
        h('td', null, who(A, m.result === 'a')),
        h('td', { class: 'pt-res' }, h('span', { class: ['pt-score', m.result === 'draw' && 'draw'] }, res)),
        h('td', null, who(B, m.result === 'b', true)),
      );
    });
    return h(
      'div',
      { class: 'panel pairings' },
      h('header', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, 'Pairings')),
      h('div', { class: 'panel-body table-wrap' }, h('table', { class: 'table pairings-table' }, h('thead', null, h('tr', null, h('th', null, 'Table'), h('th', null, 'Player'), h('th', { class: 'pt-res' }, 'Result'), h('th', { class: 'right' }, 'Opponent'))), h('tbody', null, rows))),
    );
  }

  // ---------------------------------------------------------------- lobby
  function lobbyView(): HTMLElement {
    const me = E(t.humanId)!;
    const counts = new Map<string, { name: string; color: string; n: number; tier: 1 | 2 | 3 }>();
    for (const e of t.entrants) {
      const c = counts.get(e.deck.name) ?? { name: e.deck.name, color: e.deck.color, n: 0, tier: e.deck.tier };
      c.n++;
      counts.set(e.deck.name, c);
    }
    const meta = [...counts.values()].sort((a, b) => b.n - a.n);
    const max = Math.max(...meta.map((m) => m.n));
    return h(
      'div',
      { class: 'lobby' },
      h(
        'section',
        { class: 'lobby-hero' },
        h('div', { class: 'title-eyebrow' }, 'Registration closed'),
        h('h2', null, t.name),
        h('p', { class: 'muted' }, `${t.size} duelists · ${t.swissRounds} Swiss rounds · Top ${t.topCut} cut · ${t.bestOf === 3 ? 'Best of 3' : 'Best of 1'} · ${t.simMode === 'full' ? 'Full simulation' : 'Fast simulation'}`),
        h('div', { class: 'lobby-me' }, h('span', { class: 'avatar-ring' }, renderAvatar(me.avatar, 64)), h('div', null, h('div', { class: 'setup-role' }, 'Registered as'), h('b', null, me.name), h('div', { class: 'mm-deck', style: { '--deck': me.deck.color } }, h('i'), me.deck.name))),
        button('Begin Round 1', () => {
          advance(t);
          saveTournament(t);
          tab = 'round';
          redraw();
          maybeAutoSimulate();
        }, { variant: 'primary', icon: 'play', cls: 'btn-lg' }),
      ),
      h(
        'section',
        { class: 'panel lobby-meta' },
        h('header', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, 'Metagame breakdown')),
        h(
          'div',
          { class: 'panel-body meta-bars' },
          meta.map((m) =>
            h('div', { class: 'meta-bar', style: { '--deck': m.color } }, h('span', { class: 'meta-name' }, m.name), h('span', { class: 'meta-track' }, h('i', { style: { width: `${(m.n / max) * 100}%` } })), h('b', null, `${m.n}`), h('span', { class: 'meta-pct' }, pct(m.n / t.size))),
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------- standings
  function standingsView(): HTMLElement {
    const st = standings();
    if (!t.rounds.length) return h('div', { class: 'empty' }, icon('list'), 'Standings appear after round 1.');
    const rows: HTMLElement[] = [];
    st.forEach((s, i) => {
      const e = E(s.id)!;
      rows.push(
        h(
          'tr',
          { class: [e.human && 'me', i === t.topCut - 1 && 'cutline'] },
          h('td', { class: 'num rank' }, String(s.rank)),
          h('td', null, h('div', { class: 'pt-player' }, renderAvatar(e.avatar, 30), h('div', { class: 'pt-who' }, h('span', { class: 'pt-name' }, e.name, e.human ? badge('You', 'gold') : null), h('span', { class: 'pt-deck' }, e.title)))),
          h('td', null, h('span', { class: 'mm-deck', style: { '--deck': e.deck.color } }, h('i'), e.deck.name)),
          h('td', { class: 'num' }, `${s.w}-${s.l}${s.d ? '-' + s.d : ''}`),
          h('td', { class: 'num strong' }, String(s.mp)),
          h('td', { class: 'num' }, pct(s.omw)),
          h('td', { class: 'num' }, pct(s.gwp)),
          h('td', { class: 'num hide-sm' }, pct(s.ogw)),
        ),
      );
    });
    return h(
      'div',
      { class: 'panel standings' },
      h('header', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, `Swiss standings after round ${Math.min(t.rounds.length, t.swissRounds)}`), h('span', { class: 'muted small' }, `Top ${t.topCut} advance · tiebreakers: OMW%, GW%, OGW%`)),
      h(
        'div',
        { class: 'panel-body table-wrap' },
        h(
          'table',
          { class: 'table standings-table' },
          h('thead', null, h('tr', null, h('th', { class: 'num' }, '#'), h('th', null, 'Player'), h('th', null, 'Deck'), h('th', { class: 'num' }, 'Record'), h('th', { class: 'num' }, 'Pts'), h('th', { class: 'num' }, 'OMW%'), h('th', { class: 'num' }, 'GW%'), h('th', { class: 'num hide-sm' }, 'OGW%'))),
          h('tbody', null, rows),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------- bracket
  function bracketView(): HTMLElement {
    return bracket(t);
  }

  // ---------------------------------------------------------------- entrants
  function entrantsView(): HTMLElement {
    return h(
      'div',
      { class: 'entrants' },
      t.entrants.map((e) =>
        h(
          'div',
          { class: ['entrant', e.human && 'me'], style: { '--deck': e.deck.color } },
          h('span', { class: 'avatar-ring' }, renderAvatar(e.avatar, 54)),
          h(
            'div',
            { class: 'ent-text' },
            h('div', { class: 'ent-name' }, e.name),
            h('div', { class: 'ent-title' }, e.human ? 'You' : e.title),
            h('div', { class: 'ent-deck' }, h('span', { class: 'mm-deck' }, h('i'), e.deck.name), e.human ? null : tierBadge(e.deck.tier)),
          ),
          e.human ? null : badge(difficultyLabel(e.difficulty), e.difficulty === 'hard' ? 'red' : e.difficulty === 'easy' ? 'green' : 'blue'),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------- actions
  async function playMine(m: Match) {
    const s = getSettings();
    const meA = m.a === t.humanId;
    const me = E(t.humanId)!;
    const opp = E(meA ? m.b : m.a)!;
    const sides: [DuelSide, DuelSide] = [
      { name: me.name, deck: toDeckList(me.deck), avatar: s.avatar, sleeve: s.sleeve, control: 'human', title: me.deck.name },
      { name: opp.name, deck: toDeckList(opp.deck), avatar: opp.avatar, sleeve: opp.sleeve, control: opp.difficulty as Difficulty, title: opp.deck.name },
    ];
    const caption = `${m.label === `Round ${m.round}` ? `Round ${m.round}` : m.label} – vs ${opp.name} (${opp.deck.name})`;
    const setup = { sides, bestOf: t.bestOf, caption, requireWinner: m.stage === 'top', stats: { deckKey: me.deck.id, deckName: me.deck.name } };
    const outcome = await runMatch(setup);
    const games = outcome.games.map((g) => (meA ? g : { ...g, winner: g.winner == null ? null : ((1 - g.winner) as 0 | 1) }));
    const res = outcome.result === 'draw' ? 'draw' : (outcome.result === 'a') === meA ? 'a' : 'b';
    recordHumanMatch(t, m.id, games, res);
    saveTournament(t);
    const myRes = outcome.result === 'a' ? 'W' : outcome.result === 'b' ? 'L' : 'D';
    const wa = outcome.games.filter((g) => g.winner === 0).length;
    const wb = outcome.games.filter((g) => g.winner === 1).length;
    recordMatch({ date: Date.now(), deckName: me.deck.name, oppName: opp.name, oppDeck: opp.deck.name, result: myRes, score: `${wa}-${wb}`, context: `${t.name} · ${m.label}` });
    showResults({
      setup,
      outcome,
      human: 0,
      context: `${t.name} · ${m.label}`,
      actions: [{ label: 'Continue tournament', variant: 'primary', icon: 'trophy', onClick: () => go('tournament', { t: t.id, r: String(Date.now()) }, { replace: true }) }],
    });
  }

  async function autoPlayMine(m: Match) {
    if (simulating) return;
    simulating = true;
    lockNav(true);
    progress = { done: 0, total: 1, label: 'Auto-playing your match…' };
    redraw();
    try {
      const A = E(m.a)!;
      const B = E(m.b)!;
      const asAI = (e: Entrant): Entrant => (e.human ? { ...e, difficulty: 'hard' } : e);
      await simulateMatch(m, asAI(A), asAI(B), { bestOf: t.bestOf, mode: PREMADE_DECKS.length ? 'full' : 'fast', requireWinner: m.stage === 'top', skipFirstDraw: getSettings().skipFirstDraw });
      saveTournament(t);
      const meA = m.a === t.humanId;
      const won = m.result !== 'draw' && (m.result === 'a') === meA;
      const wa = m.games.filter((g) => g.winner === 0).length;
      const wb = m.games.filter((g) => g.winner === 1).length;
      const opp = E(meA ? m.b : m.a)!;
      recordMatch({
        date: Date.now(),
        deckName: E(t.humanId)!.deck.name,
        oppName: opp.name,
        oppDeck: opp.deck.name,
        result: m.result === 'draw' ? 'D' : won ? 'W' : 'L',
        score: meA ? `${wa}-${wb}` : `${wb}-${wa}`,
        context: `${t.name} · ${m.label} (auto)`,
      });
      toast(m.result === 'draw' ? 'Your match ended in a draw.' : won ? 'Your deck won the match!' : 'Your deck lost the match.', won ? 'gold' : 'info');
    } finally {
      simulating = false;
      progress = null;
      lockNav(false);
    }
    redraw();
    maybeAutoSimulate();
  }

  async function simulateRest() {
    if (simulating) return;
    simulating = true;
    lockNav(true);
    try {
      await simulateRound(t, {
        skipFirstDraw: getSettings().skipFirstDraw,
        includeHuman: humanEliminated(t),
        shouldStop: () => disposed,
        onProgress: (done, total, m) => {
          const A = E(m.a);
          const B = E(m.b);
          progress = { done, total, label: done < total ? `Simulating: ${A?.name} vs ${B?.name}` : 'Finishing up…' };
          if (!disposed) redraw();
        },
      });
    } finally {
      simulating = false;
      progress = null;
      lockNav(false);
    }
    redraw();
  }

  /** After the human's match (or with no human match), resolve the other tables automatically. */
  function maybeAutoSimulate() {
    if (simulating || disposed) return;
    if (t.phase !== 'swiss' && t.phase !== 'top') return;
    if (isRoundComplete(t)) return;
    if (pendingHumanMatch(t) && !humanEliminated(t)) return;
    void simulateRest();
  }

  const el = frame(
    t.name,
    {
      subtitle: subtitle(),
      cls: 'tour-hub',
      actions: headActions,
    },
    stepper,
    tabsEl,
    body,
  );
  redraw();
  setTimeout(maybeAutoSimulate, 400);
  return {
    el,
    dispose: () => {
      disposed = true;
    },
  };
}

// =================================================================== bracket

export function bracket(t: Tournament): HTMLElement {
  const rounds = Math.log2(t.topCut);
  const labels = t.topCut === 8 ? ['Quarterfinals', 'Semifinals', 'Final'] : ['Semifinals', 'Final'];
  const st = computeStandings(t);
  const seedOf = new Map(st.map((s) => [s.id, s.rank]));
  const cols: HTMLElement[] = [];
  for (let r = 0; r < rounds; r++) {
    const ms = t.top[r];
    const count = t.topCut / 2 ** (r + 1);
    const boxes: HTMLElement[] = [];
    for (let i = 0; i < count; i++) {
      const m = ms?.[i];
      const slot = (id: string | null | undefined, win: boolean, score: number | null) => {
        const e = id ? entrant(t, id) : undefined;
        return h(
          'div',
          { class: ['br-slot', win && 'win', e?.human && 'me', !e && 'tbd'] },
          e ? h('span', { class: 'br-seed' }, String(seedOf.get(e.id) ?? '')) : null,
          e ? renderAvatar(e.avatar, 24) : null,
          h('span', { class: 'br-name' }, e ? e.name : 'TBD'),
          e ? h('span', { class: 'br-deck', style: { '--deck': e.deck.color } }) : null,
          h('span', { class: 'br-score' }, score == null ? '' : String(score)),
        );
      };
      const wa = m ? m.games.filter((g) => g.winner === 0).length : null;
      const wb = m ? m.games.filter((g) => g.winner === 1).length : null;
      boxes.push(h('div', { class: ['br-match', m?.result == null && m && 'live'] }, slot(m?.a, m?.result === 'a', m?.result ? wa : null), slot(m?.b, m?.result === 'b', m?.result ? wb : null)));
    }
    cols.push(h('div', { class: 'br-col' }, h('div', { class: 'br-label' }, labels[r]), h('div', { class: 'br-matches' }, boxes)));
  }
  const final = t.top[rounds - 1]?.[0];
  const champ = final?.result ? entrant(t, final.result === 'a' ? final.a : final.b) : undefined;
  cols.push(
    h(
      'div',
      { class: 'br-col champ' },
      h('div', { class: 'br-label' }, 'Champion'),
      h('div', { class: 'br-matches' }, h('div', { class: ['br-champ', champ && 'set'] }, trophySVG('br-trophy'), champ ? h('div', null, renderAvatar(champ.avatar, 40), h('b', null, champ.name), h('span', null, champ.deck.name)) : h('span', { class: 'muted' }, 'To be decided'))),
    ),
  );
  if (!t.top.length) {
    const preview = st.slice(0, t.topCut);
    return h(
      'div',
      { class: 'bracket-wrap' },
      h('p', { class: 'muted br-note' }, icon('info'), t.rounds.length ? ` If the Swiss rounds ended now, these ${t.topCut} players would make the cut: ${preview.map((s) => entrant(t, s.id)!.name).join(', ')}.` : ' The bracket is seeded from the Swiss standings once all Swiss rounds are complete.'),
      h('div', { class: 'bracket' }, cols),
    );
  }
  return h('div', { class: 'bracket-wrap' }, h('div', { class: 'bracket' }, cols));
}

export function trophySVG(cls = 'trophy') {
  const el = document.createElement('div');
  el.className = cls;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<svg viewBox="0 0 120 140">
<defs>
<linearGradient id="tg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3c4"/><stop offset=".35" stop-color="#e6bf4f"/><stop offset=".65" stop-color="#b8861f"/><stop offset="1" stop-color="#f3d27a"/></linearGradient>
<linearGradient id="tg2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a6416"/><stop offset="1" stop-color="#3d2b06"/></linearGradient>
</defs>
<path d="M30 18h60v22c0 22-12 38-30 42-18-4-30-20-30-42Z" fill="url(#tg)" stroke="#6b4c0e" stroke-width="1.5"/>
<path d="M30 26H14c0 20 8 30 20 32" fill="none" stroke="url(#tg)" stroke-width="6" stroke-linecap="round"/>
<path d="M90 26h16c0 20-8 30-20 32" fill="none" stroke="url(#tg)" stroke-width="6" stroke-linecap="round"/>
<path d="M54 82h12v16H54z" fill="url(#tg)"/>
<path d="M40 98h40l4 12H36z" fill="url(#tg)" stroke="#6b4c0e" stroke-width="1"/>
<rect x="30" y="110" width="60" height="16" rx="3" fill="url(#tg2)" stroke="#d4af37" stroke-width="1.2"/>
<path d="M60 32l5 10 11 1.5-8 7.5 2 11-10-5.5-10 5.5 2-11-8-7.5 11-1.5Z" fill="#fff8dc" opacity=".9"/>
<path d="M36 22c2 14 6 24 14 32" stroke="#fff" stroke-opacity=".45" stroke-width="3" fill="none" stroke-linecap="round"/>
</svg>`;
  return el;
}

// =================================================================== final screen

function finalScreen(t: Tournament): Screen {
  const placements = t.placements ?? finalPlacements(t);
  const myPlace = placements.indexOf(t.humanId) + 1;
  const st = computeStandings(t);
  const me = st.find((s) => s.id === t.humanId)!;
  let topW = 0,
    topL = 0;
  for (const r of t.top)
    for (const m of r) {
      if (m.a !== t.humanId && m.b !== t.humanId) continue;
      const won = (m.result === 'a') === (m.a === t.humanId);
      if (won) topW++;
      else topL++;
    }
  const record = `${me.w + topW}-${me.l + topL}${me.d ? '-' + me.d : ''}`;
  const champ = entrant(t, placements[0])!;
  if (!t.recorded) {
    recordTournament({ id: t.id, name: t.name, date: Date.now(), size: t.size, place: myPlace, record, deckName: entrant(t, t.humanId)!.deck.name, champion: champ.name });
    t.recorded = true;
    saveTournament(t);
  }
  const prize =
    myPlace === 1
      ? { title: 'Tournament Champion', text: 'Gold trophy and the Edison title. The whole room is talking about your deck.', cls: 'gold' }
      : myPlace === 2
        ? { title: 'Finalist', text: 'Silver trophy — one game away from glory.', cls: 'silver' }
        : myPlace <= 4 && t.topCut >= 4
          ? { title: 'Semifinalist', text: 'Bronze medal for reaching the final four.', cls: 'bronze' }
          : myPlace <= t.topCut
            ? { title: `Top ${t.topCut}`, text: 'A top-cut medal for making it out of Swiss.', cls: 'bronze' }
            : { title: `${ordinal(myPlace)} place`, text: 'No hardware this time — tune the side deck and come back stronger.', cls: 'plain' };

  const medal = (i: number) => (i === 0 ? 'gold' : i === 1 ? 'silver' : i < 4 ? 'bronze' : '');
  const podium = placements.slice(0, t.topCut).map((id, i) => {
    const e = entrant(t, id)!;
    return h(
      'div',
      { class: ['fin-row', e.human && 'me', medal(i)] },
      h('span', { class: 'fin-place' }, i < 4 ? icon(i === 0 ? 'trophy' : 'medal') : null, ordinal(i + 1)),
      renderAvatar(e.avatar, 36),
      h('span', { class: 'fin-who' }, h('span', { class: 'fin-name' }, e.name, e.human ? badge('You', 'gold') : null), h('span', { class: 'mm-deck', style: { '--deck': e.deck.color } }, h('i'), e.deck.name)),
    );
  });

  const el = h(
    'div',
    { class: ['final-screen', `prize-${prize.cls}`], tabindex: '-1' },
    h('div', { class: 'res-rays', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'fin-inner' },
      h('div', { class: 'res-context' }, `${t.name} · ${t.size} players`),
      h('div', { class: 'fin-hero' }, trophySVG(`fin-trophy ${prize.cls}`), h('div', null, h('div', { class: 'fin-place-big' }, ordinal(myPlace)), h('h1', { class: 'fin-title' }, prize.title), h('p', { class: 'fin-text' }, prize.text))),
      h(
        'div',
        { class: 'res-stats' },
        h('span', { class: 'stat-chip' }, h('b', null, record), h('span', null, 'Your record')),
        h('span', { class: 'stat-chip' }, h('b', null, `${me.rank}`), h('span', null, 'Swiss rank')),
        h('span', { class: 'stat-chip' }, h('b', null, pct(me.omw)), h('span', null, 'OMW%')),
        h('span', { class: 'stat-chip' }, h('b', null, champ.human ? 'You!' : champ.name), h('span', null, 'Champion')),
      ),
      h('div', { class: 'fin-grid' }, h('section', { class: 'panel fin-podium' }, h('header', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, `Final Top ${t.topCut}`)), h('div', { class: 'panel-body' }, podium)), h('section', { class: 'panel fin-bracket' }, h('header', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, 'Bracket')), h('div', { class: 'panel-body' }, bracket(t)))),
      h(
        'div',
        { class: 'res-actions' },
        button('New tournament', () => {
          clearActiveTournament();
          go('tournament', {}, { replace: true });
        }, { variant: 'primary', icon: 'trophy', cls: 'btn-lg' }),
        button('Main menu', () => go('title'), { variant: 'ghost', icon: 'back', cls: 'btn-lg' }),
      ),
    ),
  );
  return { el };
}

