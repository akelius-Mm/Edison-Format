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
import { badge, button, clear, confirmDialog, h, icon, modal, pct, segmented, toast } from './dom';
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

  const nameIn = h('input', { class: 'ios-input', value: st.name, maxlength: 40, 'aria-label': 'Tournament name', spellcheck: false });
  nameIn.addEventListener('input', () => (st.name = nameIn.value));

  const summary = h('div', { class: 'ios-list' });
  const drawSummary = () => {
    const rounds = Math.ceil(Math.log2(st.size));
    const cut = st.size <= 8 ? 4 : 8;
    summary.replaceChildren(
      iosRow(`${st.size} players`, `You and ${st.size - 1} AI duelists`, null, { icon: 'user' }),
      iosRow(`${rounds} Swiss rounds, then Top ${cut}`, `${st.bestOf === 3 ? 'Best-of-three' : 'Single-game'} matches · up to ${rounds + Math.log2(cut)} rounds for you`, null, { icon: 'bracket' }),
      iosRow(st.sim === 'fast' ? 'Fast simulation' : 'Full simulation', st.sim === 'fast' ? 'Other tables resolve instantly with a rating model' : 'Other tables are played out by the AI with the full rules engine', null, { icon: 'robot' }),
    );
  };
  drawSummary();

  const createBtn = ctaButton('Create tournament', () => void create(), 'trophy');

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
  const seg = <T extends string | number>(opts: { value: T; label: string; hint?: string }[], v: T, on: (v: T) => void, label: string) => segmented<T>(opts, v, on, label);
  const stat = (v: string, l: string) => h('div', { class: 'res-stat' }, h('b', null, v), h('span', null, l));
  const el = frame(
    'Tournament',
    { subtitle: 'Swiss rounds, a top cut and a title on the line', cls: 'tour-screen' },
    h('div', { class: 'res-stats tour-circuit' }, stat(String(ts.played), 'Events'), stat(String(ts.wins), 'Titles'), stat(ts.best ? ordinal(ts.best) : '—', 'Best finish')),
    lobbySection('Your deck', linkButton('Deck Builder', () => go('deck-builder')), deckShelf(decks, st.deck, (d) => ((st.deck = d?.key ?? null), persist()), { label: 'Your deck', newDeck: () => go('deck-builder') })),
    iosGroup('Event', [
      h('div', { class: 'ios-row ios-row--input' }, nameIn),
      iosRow('Players', null, seg<8 | 16 | 32>([{ value: 8, label: '8' }, { value: 16, label: '16' }, { value: 32, label: '32' }], st.size, (v) => ((st.size = v), persist(), drawSummary()), 'Players'), { stack: true }),
      iosRow('Matches', null, seg<1 | 3>([{ value: 1, label: 'Best of 1' }, { value: 3, label: 'Best of 3' }], st.bestOf, (v) => ((st.bestOf = v), persist(), drawSummary()), 'Match format'), { stack: true }),
      iosRow(
        'AI difficulty',
        null,
        seg<DifficultyMix>(
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
        { stack: true },
      ),
      iosRow(
        'Simulation',
        null,
        seg<SimMode>(
          [
            { value: 'fast', label: 'Fast', hint: 'Instant results from deck tier, persona skill and luck' },
            { value: 'full', label: 'Full', hint: 'AI-vs-AI games actually played with the engine (slower)' },
          ],
          st.sim,
          (v) => ((st.sim = v), persist(), drawSummary()),
          'Simulation mode',
        ),
        { stack: true },
      ),
    ]),
    h('section', { class: 'ios-group' }, h('h2', { class: 'ios-group-h' }, 'Format'), summary, h('p', { class: 'ios-foot' }, 'Progress is saved after every match, so you can leave and resume any time.')),
    iosGroup(
      'History',
      history.length
        ? history.slice(0, 8).map((x) =>
            h(
              'div',
              { class: ['ios-row', 'tc-hist', x.place === 1 && 'won'] },
              h('span', { class: 'place-pill' }, ordinal(x.place)),
              h('div', { class: 'ios-row-text' }, h('div', { class: 'ios-label' }, x.name), h('div', { class: 'ios-desc' }, `${x.size} players · ${x.deckName} · ${x.record}`)),
              h('span', { class: 'ios-detail' }, new Date(x.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
            ),
          )
        : [iosRow(h('span', { class: 'muted' }, 'No tournaments played yet.'), null, null)],
    ),
    stickyBar(createBtn),
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
  const tabsEl = h('div', { class: 'seg tour-tabs', role: 'tablist', 'aria-label': 'Tournament views' });
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
    const tabs: [HubTab, string][] = [
      ['round', t.phase === 'lobby' ? 'Overview' : 'Round'],
      ['standings', 'Standings'],
      ['bracket', `Top ${t.topCut}`],
      ['entrants', 'Players'],
    ];
    for (const [k, l] of tabs)
      tabsEl.appendChild(
        h(
          'button',
          {
            type: 'button',
            class: ['seg-btn', tab === k && 'on'],
            role: 'tab',
            'aria-selected': String(tab === k),
            onclick: () => {
              tab = k;
              redraw();
            },
          },
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
    wrap.appendChild(h('div', { class: 'lob-h round-title' }, h('h2', null, currentRoundLabel(t)), h('span', { class: 'lob-count' }, `${ms.filter((m) => m.result).length} of ${ms.length} done`)));
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
    const othersLeft = currentMatches(t).some((m) => m.result == null && m.a !== t.humanId && m.b !== t.humanId);
    if (!complete && !pending) c.appendChild(ctaButton('Simulate remaining tables', () => void simulateRest(), 'robot'));
    else if (!complete && othersLeft) c.appendChild(button('Simulate other tables first', () => void simulateRest(), { variant: 'subtle', small: true, icon: 'robot', title: 'Resolve the other matches before playing yours' }));
    if (complete) {
      const isLastSwiss = t.phase === 'swiss' && t.rounds.length >= t.swissRounds;
      const isFinal = t.phase === 'top' && currentMatches(t).length === 1;
      const label = isFinal ? 'See final results' : isLastSwiss ? `Start Top ${t.topCut}` : 'Next round';
      c.appendChild(
        h('div', { class: 'round-done' }, icon('check'), h('span', null, isLastSwiss ? 'Swiss rounds complete — the top cut is set.' : 'Round complete.')),
      );
      c.appendChild(
        ctaButton(
          label,
          () => {
            advance(t);
            saveTournament(t);
            if (t.phase === 'done') return go('tournament', { t: t.id, done: '1' }, { replace: true });
            tab = 'round';
            redraw();
            window.scrollTo(0, 0);
            maybeAutoSimulate();
          },
          isFinal ? 'trophy' : 'play',
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
        { class: 'mm2 idle' },
        h('div', { class: 'mm2-label' }, 'Your match'),
        h('h3', { class: 'mm2-idle-title' }, out ? 'Your run has ended' : 'No match this round'),
        h('p', { class: 'mm2-idle-text' }, out ? 'The remaining matches are simulated. Follow the bracket to see who takes the title.' : 'Sit back while the other tables finish.'),
      );
    }
    if (m.b == null)
      return h('div', { class: 'mm2 idle' }, h('div', { class: 'mm2-label' }, `${m.label} · Your match`), h('h3', { class: 'mm2-idle-title' }, 'You have a bye'), h('p', { class: 'mm2-idle-text' }, 'A bye counts as a match win (3 points).'));
    const oppId = m.a === t.humanId ? m.b : m.a;
    const opp = E(oppId)!;
    const meA = m.a === t.humanId;
    const done = m.result != null;
    const won = done && (m.result === 'a') === meA;
    const draw = m.result === 'draw';
    const wa = m.games.filter((g) => g.winner === 0).length;
    const wb = m.games.filter((g) => g.winner === 1).length;
    const [myW, opW] = meA ? [wa, wb] : [wb, wa];
    const art = h('div', { class: 'mm2-bg', 'aria-hidden': 'true' });
    artInto(art, signatureCard(opp.deck));
    const side = (e: Entrant, isMe: boolean) =>
      h(
        'div',
        { class: ['mm2-side', isMe ? 'me' : 'opp'] },
        deckArt(snapInfo(e.deck), 'mm2-art'),
        h('div', { class: 'mm2-name' }, isMe ? 'You' : e.name),
        h('div', { class: 'mm2-deck' }, e.deck.name),
        h('div', { class: 'mm2-meta' }, isMe ? recordOf(e.id, st) || '0-0' : `${difficultyLabel(e.difficulty)} · ${recordOf(e.id, st) || '0-0'}`),
      );
    return h(
      'div',
      { class: ['mm2', done && (draw ? 'draw' : won ? 'won' : 'lost')] },
      art,
      h('div', { class: 'mm2-shade' }),
      h('div', { class: 'mm2-label' }, `${m.label} · Table ${m.table}`),
      h(
        'div',
        { class: 'mm2-face' },
        side(me, true),
        h('div', { class: 'mm2-mid' }, done ? h('div', { class: 'mm2-score' }, `${myW}–${opW}`) : h('div', { class: 'mm2-vs' }, 'vs'), done ? h('div', { class: 'mm2-res' }, draw ? 'Draw' : won ? 'Victory' : 'Defeat') : null),
        side(opp, false),
      ),
      done
        ? h('div', { class: 'mm-games' }, m.games.map((g, i) => gameRow(meA ? g : { ...g, winner: g.winner == null ? null : ((1 - g.winner) as 0 | 1) }, i, [me.name, opp.name], 0)))
        : h(
            'div',
            { class: 'mm2-actions' },
            ctaButton('Play match', () => void playMine(m), 'swords'),
            h(
              'div',
              { class: 'mm2-alt' },
              h('button', { type: 'button', class: 'cta cta--dark cta--sm', onclick: () => void autoPlayMine(m), title: 'Let the AI play your deck for you' }, icon('robot'), h('span', null, 'Auto-play')),
              h('button', { type: 'button', class: 'cta cta--dark cta--sm', onclick: () => reportMine(m), title: 'Enter the result of your match manually' }, icon('edit'), h('span', null, 'Report')),
            ),
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
      const live = m.result == null && !!progress?.label.includes(A.name);
      const line = (e: Entrant | undefined, win: boolean, score: number | null) =>
        h(
          'div',
          { class: ['pr-p', win && 'win', m.result != null && !win && m.result !== 'draw' && 'lose'] },
          h('span', { class: 'pr-name' }, e ? e.name : 'Bye', e?.human ? h('span', { class: 'you-tag' }, 'You') : null),
          h('span', { class: 'pr-deck' }, e ? `${e.deck.name} · ${recordOf(e.id, st)}` : ''),
          h('span', { class: 'pr-score' }, score == null ? '' : String(score)),
        );
      return h(
        'div',
        { class: ['pr-row', isMe && 'me', m.result == null && 'pending', live && 'live'] },
        h('span', { class: 'pr-table' }, String(m.table)),
        h('div', { class: 'pr-players' }, line(A, m.result === 'a', m.result != null && B ? wa : null), line(B, m.result === 'b', m.result != null && B ? wb : null)),
      );
    });
    return h('section', { class: 'ios-group pairings' }, h('h2', { class: 'ios-group-h' }, 'Pairings'), h('div', { class: 'ios-list pr-list' }, rows));
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
    const heroArt = h('div', { class: 'lobby-art', 'aria-hidden': 'true' });
    artInto(heroArt, signatureCard(me.deck));
    return h(
      'div',
      { class: 'lobby' },
      h(
        'section',
        { class: 'lobby-hero' },
        heroArt,
        h('div', { class: 'lobby-shade' }),
        h(
          'div',
          { class: 'lobby-body' },
          h('div', { class: 'frame-eyebrow' }, 'Registration closed'),
          h('h2', null, `${t.size} duelists are ready`),
          h('p', null, `${t.swissRounds} Swiss rounds · Top ${t.topCut} · ${t.bestOf === 3 ? 'Best of 3' : 'Best of 1'} · ${t.simMode === 'full' ? 'Full' : 'Fast'} simulation`),
          h('div', { class: 'lobby-me' }, deckArt(snapInfo(me.deck), 'mm2-art'), h('div', null, h('div', { class: 'ios-desc' }, 'You are playing'), h('b', null, me.deck.name))),
          ctaButton('Begin Round 1', () => {
            advance(t);
            saveTournament(t);
            tab = 'round';
            redraw();
            maybeAutoSimulate();
          }, 'play'),
        ),
      ),
      h(
        'section',
        { class: 'ios-group' },
        h('h2', { class: 'ios-group-h' }, 'Metagame'),
        h(
          'div',
          { class: 'ios-list meta-list' },
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
          h('td', null, h('div', { class: 'pt-player' }, h('div', { class: 'pt-who' }, h('span', { class: 'pt-name' }, e.name, e.human ? h('span', { class: 'you-tag' }, 'You') : null), h('span', { class: 'pt-deck' }, e.deck.name)))),
          h('td', { class: 'num' }, `${s.w}-${s.l}${s.d ? '-' + s.d : ''}`),
          h('td', { class: 'num strong' }, String(s.mp)),
          h('td', { class: 'num hide-sm' }, pct(s.omw)),
          h('td', { class: 'num hide-sm' }, pct(s.gwp)),
          h('td', { class: 'num hide-sm' }, pct(s.ogw)),
        ),
      );
    });
    return h(
      'section',
      { class: 'ios-group standings' },
      h('h2', { class: 'ios-group-h' }, `After round ${Math.min(t.rounds.length, t.swissRounds)}`),
      h(
        'div',
        { class: 'ios-list table-wrap' },
        h(
          'table',
          { class: 'table standings-table' },
          h('thead', null, h('tr', null, h('th', { class: 'num' }, '#'), h('th', null, 'Player'), h('th', { class: 'num' }, 'Record'), h('th', { class: 'num' }, 'Pts'), h('th', { class: 'num hide-sm' }, 'OMW%'), h('th', { class: 'num hide-sm' }, 'GW%'), h('th', { class: 'num hide-sm' }, 'OGW%'))),
          h('tbody', null, rows),
        ),
      ),
      h('p', { class: 'ios-foot' }, `Top ${t.topCut} advance. Tiebreakers: OMW%, GW%, OGW%.`),
    );
  }

  // ---------------------------------------------------------------- bracket
  function bracketView(): HTMLElement {
    return bracket(t);
  }

  // ---------------------------------------------------------------- entrants
  function entrantsView(): HTMLElement {
    return iosGroup(
      `${t.entrants.length} duelists`,
      t.entrants.map((e) =>
        h(
          'div',
          { class: ['ios-row', 'ent-row', e.human && 'me'] },
          deckArt(snapInfo(e.deck), 'ent-art'),
          h('div', { class: 'ios-row-text' }, h('div', { class: 'ios-label' }, e.name, e.human ? h('span', { class: 'you-tag' }, 'You') : null), h('div', { class: 'ios-desc' }, `${e.deck.name} · ${e.human ? 'You' : e.title}`)),
          e.human ? null : h('span', { class: ['diff-tag', e.difficulty] }, difficultyLabel(e.difficulty)),
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

  function reportMine(m: Match) {
    const meA = m.a === t.humanId;
    const opp = E(meA ? m.b : m.a)!;
    type Opt = { label: string; mine: number; theirs: number; draws: number };
    const opts: Opt[] =
      t.bestOf === 3
        ? [
            { label: 'Won 2–0', mine: 2, theirs: 0, draws: 0 },
            { label: 'Won 2–1', mine: 2, theirs: 1, draws: 0 },
            { label: 'Lost 1–2', mine: 1, theirs: 2, draws: 0 },
            { label: 'Lost 0–2', mine: 0, theirs: 2, draws: 0 },
            ...(m.stage === 'swiss' ? [{ label: 'Draw 1–1–1', mine: 1, theirs: 1, draws: 1 }] : []),
          ]
        : [
            { label: 'Won', mine: 1, theirs: 0, draws: 0 },
            { label: 'Lost', mine: 0, theirs: 1, draws: 0 },
            ...(m.stage === 'swiss' ? [{ label: 'Draw', mine: 0, theirs: 0, draws: 1 }] : []),
          ];
    const pick = (o: Opt) => {
      const g = (w: 0 | 1 | null) => ({ winner: w, turns: 0, reason: 'Result reported', how: 'human' as const });
      const mineIdx: 0 | 1 = meA ? 0 : 1;
      const theirIdx: 0 | 1 = meA ? 1 : 0;
      const games = [...Array(o.mine).fill(g(mineIdx)), ...Array(o.theirs).fill(g(theirIdx)), ...Array(o.draws).fill(g(null))];
      const res = o.mine === o.theirs ? 'draw' : (o.mine > o.theirs) === meA ? 'a' : 'b';
      recordHumanMatch(t, m.id, games, res);
      saveTournament(t);
      recordMatch({ date: Date.now(), deckName: E(t.humanId)!.deck.name, oppName: opp.name, oppDeck: opp.deck.name, result: o.mine > o.theirs ? 'W' : o.mine < o.theirs ? 'L' : 'D', score: `${o.mine}-${o.theirs}`, context: `${t.name} · ${m.label} (reported)` });
      redraw();
      maybeAutoSimulate();
    };
    const mm = modal(
      'Report match result',
      h('div', { class: 'report' }, h('p', { class: 'muted' }, `${m.label} · Table ${m.table} — you vs ${opp.name} (${opp.deck.name})`), h('div', { class: 'report-opts' }, opts.map((o) => button(o.label, () => (mm.close(), pick(o)), { variant: o.mine > o.theirs ? 'primary' : 'ghost' })))),
      [{ label: 'Cancel' }],
    );
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
        }, { variant: 'primary', icon: 'trophy', cls: 'ui-btn-lg' }),
        button('Main menu', () => go('title'), { variant: 'ghost', icon: 'back', cls: 'ui-btn-lg' }),
      ),
    ),
  );
  return { el };
}

