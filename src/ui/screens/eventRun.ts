// A live event of any tier (route events?view=run): the Locals Night table experience scaled up
// to Regionals, SJCs and Nationals. Big fields show feature tables, your table and your
// neighbourhood in the standings, with "show all" for the full sheet. Engine in src/events.
import {
  EVENT_SPECS,
  acceptId,
  advance,
  autoPlay,
  closeOutEvent,
  concede,
  currentRound,
  declineId,
  deckLabel,
  dropHuman,
  entrantOf,
  finishRound,
  humanEliminated,
  humanIdOffer,
  humanMatch,
  humanStanding,
  inTopCut,
  loadSeason,
  markRevealed,
  night,
  opponentOf,
  pendingHumanMatch,
  placeOf,
  prizeTotals,
  recordString,
  reportPlayed,
  roundLabel,
  runToEnd,
  saveEvent,
  seedOf,
  signed,
  standingsOf,
  winnerOf,
  clearActiveEvent,
  loadRatings,
  type EventRun,
  type RatingChange,
} from '../../events';
import { computeStandings } from '../../locals/swiss';
import type { LocalsMatch, LocalsStanding } from '../../locals/types';
import { topRoundLabel } from '../../tournament/swiss';
import type { DuelSide } from '../duel/api';
import { getSettings } from '../settings';
import { ctaButton, lobbySection, stickyBar } from './components';
import { confirmDialog, h, icon, segmented, toast, type Child } from './dom';
import { sleevePreview } from './ext';
import { avatar, deckArtEl, listLine, timer, toTop } from './locals';
import { runMatch, type MatchSetup } from './match';
import { reconcileActiveDuel, type SavedDuel } from '../duel/resume';
import { beginRisky, endRisky } from '../crashGuard';
import { resumeDuelCard } from './resumeCard';
import { frame, go, type Screen } from './nav';
import { showResults } from './results';
import { ordinal, recordMatch, toDeckList } from './store';
import './locals.css';
import './events.css';

/** Round whose result slips animate in on the next render. */
let animateRound: string | null = null;
let flipMatch: string | null = null;
let postRound: string | null = null;

/** "Final", "Semifinals", "Quarterfinals", "Top 16" for a top-cut round with `count` matches. */
export function roundTitle(count: number) {
  const l = topRoundLabel(count * 2);
  return count === 1 || /^Top /.test(l) ? l : `${l}s`;
}

const roundKey = (ms: LocalsMatch[]) => ms[0]?.id.replace(/-\d+$|-bye$/, '') ?? '';
const involves = (m: LocalsMatch, id: string) => m.a === id || m.b === id;
/** Sheets longer than this show feature tables + your table until expanded. */
const SHEET_LIMIT = 24;
const FEATURE_TABLES = 8;

function scoreFor(m: LocalsMatch, id: string) {
  const wa = m.games.filter((g) => g.winner === 0).length;
  const wb = m.games.filter((g) => g.winner === 1).length;
  const dr = m.games.filter((g) => g.winner == null).length;
  const [w, l] = m.a === id ? [wa, wb] : [wb, wa];
  return `${w}-${l}${dr ? `-${dr}` : ''}`;
}

function knownDeck(r: EventRun, id: string) {
  if (id === r.humanId || r.phase === 'done') return true;
  if (r.phase === 'top' && r.top[0]?.some((m) => involves(m, id))) return true;
  for (const m of [...r.rounds.flat(), ...r.top.flat()]) if (involves(m, r.humanId) && involves(m, id) && (m.result != null || r.revealed.includes(m.id))) return true;
  return false;
}

/** Crash-guard scope of an event (crashGuard.ts): events.ts checks it before opening the screen. */
export const eventScope = (r: Pick<EventRun, 'id'>) => `events:${r.id}`;

/** The saved-duel key of an event match. */
const duelKey = (r: EventRun, m: LocalsMatch) => `events:${r.id}:${m.id}`;

export function eventRunScreen(r: EventRun, autoResume = false): Screen {
  const scope = eventScope(r);
  // opening runs the whole sheet from the save: if that ever kills the app, the next open offers a way out
  beginRisky(scope, 'opening the event');
  const opened = setTimeout(() => endRisky(scope), 4000);
  /** A step that simulates or re-pairs the field, guarded the same way. */
  const step = <T>(what: string, fn: () => T): T => {
    beginRisky(scope, what);
    try {
      return fn();
    } finally {
      endRisky(scope);
    }
  };
  if (r.phase === 'done') closeOutEvent(r);
  const spec = EVENT_SPECS[r.kind];
  const big = r.size > 40;
  type Tab = 'round' | 'standings' | 'bracket' | 'prizes';
  let tab: Tab = r.phase === 'done' ? 'prizes' : r.step === 'standings' ? 'standings' : 'round';
  let showAllTables = false;
  let showAllStandings = false;
  let lastRating: RatingChange | null = null;
  const timers: (() => void)[] = [];
  if (Date.now() - r.roundStartedAt > (r.roundMinutes + 30) * 60000) {
    r.roundStartedAt = Date.now();
    saveEvent(r);
  }
  const interval = setInterval(() => timers.forEach((t) => t()), 1000);
  let revealTimers: ReturnType<typeof setTimeout>[] = [];
  let busy = false;

  const header = h('div', { class: 'lx-hub-head' });
  const tabsHost = h('div', { class: 'lx-tabs' });
  const content = h('div', { class: 'lx-content' });
  const bar = h('div', { class: 'lx-bar-host' });
  const dropBtn = h('button', { type: 'button', class: 'lx-head-btn', 'aria-label': 'Drop from the event', title: 'Drop', onclick: () => void drop() }, icon('door'));
  const backTo = () => go('events', r.season ? { view: 'season' } : {});
  const el = frame(spec.short, { compact: true, cls: 'lobby-screen lx-screen lx-hub ev-run', actions: dropBtn, backTo, backLabel: r.season ? 'Season' : 'Events' }, header, tabsHost, content, bar);

  /** A duel of this event's current match that was left (or cut off) mid-game. */
  let saved: SavedDuel | null = null;
  const syncSaved = () => {
    const m = pendingHumanMatch(r);
    saved = reconcileActiveDuel('events', m && m.b != null ? duelKey(r, m) : null);
  };

  function redraw() {
    timers.length = 0;
    revealTimers.forEach(clearTimeout);
    revealTimers = [];
    syncSaved();
    dropBtn.hidden = r.phase === 'done' || humanEliminated(r);
    drawHeader();
    drawTabs();
    drawContent();
    drawBar();
  }

  function drawHeader() {
    const st = humanStanding(r);
    const done = r.phase === 'done';
    const anyResults = r.rounds.some((x) => x.some((m) => m.result != null && m.b != null));
    const pill = done ? `${ordinal(placeOf(r))} of ${r.size}` : anyResults ? `${recordString(st)} · ${ordinal(st.rank)}` : `${r.size} players`;
    const rating = loadRatings().constructed.rating;
    header.replaceChildren(
      h('div', { class: 'lx-hub-eyebrow' }, r.title),
      h('div', { class: 'lx-hub-row' }, h('h1', { class: 'lx-hub-title' }, done ? 'Final standings' : roundLabel(r)), h('span', { class: ['lx-pill', done && inTopCut(r) && 'is-gold'] }, pill)),
      h(
        'div',
        { class: 'lx-hub-sub' },
        `${r.dateLabel.replace(/, 2010$/, '')} · ${r.size} players · Top ${r.topCut}`,
        r.season ? ` · Week ${r.season.week}` : '',
        r.phase === 'top' && humanEliminated(r) ? ' · Spectating' : '',
      ),
      h('div', { class: 'ev-rating-line' }, icon('bolt'), `Rating ${rating}`, r.ratingDelta ? h('span', { class: ['ev-delta', r.ratingDelta > 0 ? 'is-up' : 'is-down'] }, `${signed(r.ratingDelta)} today`) : null),
    );
  }

  function drawTabs() {
    const opts: { value: Tab; label: string }[] = [];
    if (r.phase === 'done') opts.push({ value: 'prizes', label: 'Prizes' });
    else opts.push({ value: 'round', label: r.step === 'results' ? 'Results' : 'Pairings' });
    opts.push({ value: 'standings', label: 'Standings' });
    if (r.top.length) opts.push({ value: 'bracket', label: `Top ${r.topCut}` });
    if (!opts.some((o) => o.value === tab)) tab = opts[0].value;
    tabsHost.replaceChildren(
      segmented<Tab>(opts, tab, (v) => {
        tab = v;
        drawContent();
        drawBar();
      }, 'Event view'),
    );
  }

  function drawContent() {
    revealTimers.forEach(clearTimeout);
    revealTimers = [];
    let body: HTMLElement;
    if (tab === 'standings') body = standingsView();
    else if (tab === 'bracket') body = bracketView();
    else if (tab === 'prizes') body = ceremonyView();
    else body = r.step === 'results' ? resultsView() : pairingsView();
    content.replaceChildren(body);
  }

  // ---------------------------------------------------------------- pairings
  function pairingsView() {
    const round = currentRound(r);
    const m = humanMatch(r);
    const key = roundKey(round);
    const sheetEl = sheet(round, 'pairings');
    if (postRound === key) {
      sheetEl.classList.add('is-posting');
      postRound = null;
    }
    return h('div', { class: 'lx-round' }, saved ? resumeDuelCard(saved, { onResume: () => void playMine(), cls: 'mode-resume' }) : null, seatCard(m), sheetEl);
  }

  function seatCard(m: LocalsMatch | null): HTMLElement {
    const t = timer(night(r));
    timers.push(t.tick);
    const head = (label: string, value: Child) =>
      h(
        'div',
        { class: 'lx-seat-head' },
        h('div', { class: 'lx-seat-table' }, h('span', { class: 'lx-k' }, label), h('b', null, value)),
        h('div', { class: 'lx-timer' }, h('span', { class: 'lx-k' }, 'Round timer'), t.el),
      );
    const me = entrantOf(r, r.humanId)!;
    if (!m) {
      const why = me.dropped != null ? 'You dropped from the event.' : !inTopCut(r) ? `You finished ${ordinal(humanStanding(r).rank)} after Swiss, outside the Top ${r.topCut}.` : 'You were knocked out of the top cut.';
      return h('section', { class: 'lx-seat lx-seat--out' }, head('Spectating', currentRound(r)[0]?.label ?? ''), h('p', { class: 'lx-seat-note' }, why, ' Watch the feature match, or skip to the end.'));
    }
    if (m.b == null)
      return h(
        'section',
        { class: 'lx-seat lx-seat--bye' },
        head('Bye', '—'),
        h('div', { class: 'lx-bye' }, h('span', { class: 'lx-bye-ico' }, icon('check')), h('div', null, h('b', null, 'You have a bye this round'), h('p', null, 'An odd number of players. You take the match win.'))),
      );
    const opp = opponentOf(r, m)!;
    const revealed = r.revealed.includes(m.id) || m.result != null;
    const prior = r.phase === 'swiss' ? computeStandings({ entrants: r.entrants, rounds: r.rounds.slice(0, -1) }) : standingsOf(r);
    const rec = (id: string) => {
      const s = prior.find((x) => x.id === id)!;
      return r.phase === 'top' ? `Seed ${seedOf(r, id)}` : `${recordString(s)} · ${s.mp} pts`;
    };
    const side = (e: typeof me, right = false) => h('div', { class: ['lx-seat-player', right && 'right'] }, avatar(e, 40), h('div', { class: 'lx-seat-pn' }, h('b', null, e.human ? 'You' : e.name), h('span', null, rec(e.id))));
    const flip = flipMatch === m.id;
    flipMatch = null;
    const deckBox = h(
      'div',
      { class: ['lx-reveal', revealed && !flip && 'is-open', flip && 'is-flipping'] },
      h('div', { class: 'lx-reveal-inner' }, h('div', { class: 'lx-reveal-back' }, sleevePreview(opp.sleeve, 'sm')), h('div', { class: 'lx-reveal-front', style: { '--deck': opp.deck.color } }, deckArtEl(opp.deck, 'lx-reveal-art'), h('span', { class: 'lx-reveal-shade' }))),
    );
    if (flip) requestAnimationFrame(() => requestAnimationFrame(() => deckBox.classList.add('is-open')));
    const strength = h('span', { class: 'ev-opp-meta' }, opp.title, opp.circuitId ? ' · Circuit' : '', ` · ${opp.difficulty === 'hard' ? 'Hard AI' : opp.difficulty === 'normal' ? 'Normal AI' : 'Easy AI'}`);
    const info = revealed
      ? h(
          'div',
          { class: 'lx-deckinfo' },
          h('span', { class: 'lx-k' }, `${opp.name.split(' ')[0]} is on`),
          h('b', { class: 'lx-deckinfo-name' }, deckLabel(opp)),
          h('span', { class: 'lx-deckinfo-list' }, listLine(opp.deck, deckLabel(opp))),
          opp.blurb ? h('p', { class: 'lx-deckinfo-blurb' }, opp.blurb) : null,
          strength,
        )
      : h('div', { class: 'lx-deckinfo' }, h('span', { class: 'lx-k' }, 'Their deck'), h('b', { class: 'lx-deckinfo-name is-hidden' }, 'Face down'), strength, opp.blurb ? h('p', { class: 'lx-deckinfo-blurb' }, opp.blurb) : null);
    const offer = revealed && m.result == null ? humanIdOffer(r) : null;
    return h(
      'section',
      { class: ['lx-seat', m.stage === 'top' && 'lx-seat--top'] },
      head(m.stage === 'top' ? m.label : 'Table', m.stage === 'top' ? `Table ${m.table}` : String(m.table)),
      h('div', { class: 'lx-seat-vs' }, side(me), h('span', { class: 'lx-vs' }, 'vs'), side(opp, true)),
      h('div', { class: 'lx-seat-deck' }, deckBox, info),
      offer
        ? h(
            'div',
            { class: 'lx-id' },
            h('p', { class: 'lx-id-quote' }, `“${offer.check.guaranteed ? 'We both make the cut whatever happens. Draw?' : "If we draw we're both probably in on tiebreakers. ID?"}”`),
            h('div', { class: 'lx-id-who' }, `${offer.opponent.name} offers an intentional draw`),
            h(
              'div',
              { class: 'lx-id-actions' },
              h('button', { type: 'button', class: 'lx-btn', onclick: () => takeId() }, icon('hand'), 'Accept the ID'),
              h('button', { type: 'button', class: 'lx-btn lx-btn--quiet', onclick: () => (declineId(r), saveEvent(r), redraw()) }, 'Play it out'),
            ),
          )
        : null,
    );
  }

  // ---------------------------------------------------------------- results
  function resultsView() {
    const round = currentRound(r);
    const key = roundKey(round);
    const animate = animateRound === key;
    animateRound = null;
    const sheetEl = sheet(round, 'results');
    const rows = [...sheetEl.querySelectorAll<HTMLElement>('.lx-row[data-pending]')];
    const progress = h('span', { class: 'lx-progress-v' });
    const total = round.filter((m) => m.b != null).length;
    let shown = 0;
    const progressWrap = h('div', { class: 'lx-progress' }, h('span', { class: 'lx-progress-dot' }), progress);
    const setProgress = () => {
      const done = shown >= rows.length;
      progress.textContent = done ? `All ${total} tables reported` : `${Math.max(1, Math.round(((shown + 1) / (rows.length + 1)) * total))} of ${total} tables reported`;
      if (done) progressWrap.classList.add('is-done');
    };
    if (animate && rows.length) {
      for (const x of rows) x.classList.add('is-pending');
      const order = rows.map((x, i) => ({ x, k: Math.sin(i * 12.9898 + rows.length) })).sort((a, b) => a.k - b.k);
      let t = 450;
      order.forEach(({ x }, i) => {
        t += Math.max(110, 380 - i * 22);
        revealTimers.push(
          setTimeout(() => {
            x.classList.remove('is-pending');
            x.classList.add('is-in');
            shown++;
            setProgress();
          }, t),
        );
      });
    } else shown = rows.length;
    setProgress();
    const mine = humanMatch(r);
    return h('div', { class: 'lx-round' }, mine ? myResultCard(mine) : null, progressWrap, sheetEl);
  }

  function myResultCard(m: LocalsMatch) {
    if (m.b == null) return h('section', { class: 'lx-myres is-win' }, h('span', { class: 'lx-myres-mark' }, 'W'), h('div', null, h('b', null, 'Bye'), h('span', null, 'Match win, no games played')));
    const opp = opponentOf(r, m)!;
    const won = winnerOf(m) === r.humanId;
    const kind = m.result === 'draw' ? 'draw' : won ? 'win' : 'loss';
    const auto = m.games.length > 0 && m.games.every((g) => g.how === 'fast');
    const head = m.intentional ? 'Intentional draw' : m.time ? 'Draw · time called' : kind === 'win' ? `Won ${scoreFor(m, r.humanId)}` : kind === 'loss' ? `Lost ${scoreFor(m, r.humanId)}` : `Draw ${scoreFor(m, r.humanId)}`;
    const rated = lastRating && r.rated[r.rated.length - 1] === m.id ? lastRating : null;
    return h(
      'section',
      { class: ['lx-myres', `is-${kind}`] },
      h('span', { class: 'lx-myres-mark' }, kind === 'win' ? 'W' : kind === 'loss' ? 'L' : 'D'),
      h('div', null, h('b', null, head), h('span', null, `vs ${opp.name} · ${deckLabel(opp)}`)),
      rated ? h('span', { class: ['ev-delta', rated.delta >= 0 ? 'is-up' : 'is-down'] }, signed(rated.delta)) : auto ? h('span', { class: 'ev-delta' }, 'Unrated') : null,
    );
  }

  // ---------------------------------------------------------------- the sheet
  function sheet(round: LocalsMatch[], mode: 'pairings' | 'results') {
    const prior = r.phase === 'swiss' ? computeStandings({ entrants: r.entrants, rounds: r.rounds.slice(0, -1) }) : standingsOf(r);
    const pts = new Map(prior.map((x) => [x.id, x.mp]));
    const top = round[0]?.stage === 'top';
    const name = (id: string | null) => (id === r.humanId ? 'You' : (entrantOf(r, id)?.name ?? ''));
    const label = top ? round[0].label : `Round ${round[0]?.round ?? 1}`;
    const all = [...round].sort((a, b) => (a.b == null ? 1 : 0) - (b.b == null ? 1 : 0) || a.table - b.table);
    const trimmed = all.length > SHEET_LIMIT && !showAllTables;
    const rows = trimmed ? all.filter((m) => m.table <= FEATURE_TABLES && m.b != null || involves(m, r.humanId)) : all;
    const firstRound = !top && (round[0]?.round ?? 1) === 1;
    const sub = (id: string) => (top ? `#${seedOf(r, id)}` : firstRound ? '' : `${pts.get(id) ?? 0}`);
    const cell = (id: string | null, m: LocalsMatch, right = false) => {
      if (!id) return h('span', { class: ['lx-cell', 'is-bye', right && 'right'] }, h('span', { class: 'lx-cell-n' }, 'Bye'));
      const lost = mode === 'results' && m.result && m.result !== 'draw' && winnerOf(m) !== id;
      const won = mode === 'results' && winnerOf(m) === id;
      return h('span', { class: ['lx-cell', right && 'right', id === r.humanId && 'is-me', lost && 'is-lost', won && 'is-won'] }, h('span', { class: 'lx-cell-n' }, name(id)), h('span', { class: 'lx-cell-p' }, sub(id)));
    };
    const mid = (m: LocalsMatch) => {
      if (mode === 'pairings' || !m.result) return h('span', { class: 'lx-mid' }, 'vs');
      if (m.b == null) return h('span', { class: 'lx-mid is-res' }, 'Bye');
      if (m.intentional) return h('span', { class: 'lx-mid is-res is-id' }, 'ID');
      const [wa, wb] = [m.games.filter((g) => g.winner === 0).length, m.games.filter((g) => g.winner === 1).length];
      return h('span', { class: ['lx-mid', 'is-res', m.result === 'draw' && 'is-draw'] }, m.time ? `${wa}–${wb} T` : `${wa}–${wb}`);
    };
    const rowEls: HTMLElement[] = [];
    let prevTable = 0;
    for (const m of rows) {
      if (trimmed && m.table > prevTable + 1 && prevTable >= FEATURE_TABLES) rowEls.push(h('div', { class: 'ev-gap', 'aria-hidden': 'true' }, '···'));
      prevTable = m.table;
      const mine = involves(m, r.humanId);
      rowEls.push(
        h('div', { class: ['lx-row', mine && 'is-mine'], dataset: mode === 'results' && !mine ? { pending: '1' } : undefined }, h('span', { class: 'lx-tbl' }, m.b == null ? '—' : String(m.table)), cell(m.a, m), mid(m), cell(m.b, m, true)),
      );
    }
    const more = all.length > SHEET_LIMIT
      ? h(
          'button',
          { type: 'button', class: 'ev-more', onclick: () => ((showAllTables = !showAllTables), drawContent()) },
          showAllTables ? 'Show feature tables only' : `Show all ${all.length} tables`,
        )
      : null;
    return h(
      'section',
      { class: ['lx-sheet', `lx-sheet--${mode}`], 'aria-label': `${mode === 'results' ? 'Results' : 'Pairings'}, ${label}` },
      h('span', { class: 'lx-tape lx-tape--l', 'aria-hidden': 'true' }),
      h('span', { class: 'lx-tape lx-tape--r', 'aria-hidden': 'true' }),
      h('header', { class: 'lx-sheet-head' }, h('div', { class: 'lx-sheet-title' }, h('b', null, mode === 'results' ? 'Results' : 'Pairings'), h('span', null, label)), h('div', { class: 'lx-sheet-meta' }, h('span', null, r.venue.city || r.title), h('span', null, r.dateLabel.replace(/^\w+, /, '')))),
      h('div', { class: ['lx-sheet-cols', firstRound && 'no-pts'], 'aria-hidden': 'true' }, h('span', null, 'Tbl'), h('span', null, 'Player'), h('span', null, top ? 'Seed' : 'Pts'), h('span', null, ''), h('span', null, top ? 'Seed' : 'Pts'), h('span', { class: 'right' }, 'Opponent')),
      h('div', { class: 'lx-rows' }, rowEls),
      more,
      h('footer', { class: 'lx-sheet-foot' }, mode === 'results' ? 'T = time called · ID = intentional draw' : top ? 'Single elimination · Best of 3 · Higher seed chooses to go first' : trimmed ? `Feature tables 1–${FEATURE_TABLES} and your table · Best of 3` : 'Best of 3 · Report results to the judge station'),
    );
  }

  // ---------------------------------------------------------------- standings
  function standingsView() {
    const st = standingsOf(r);
    const played = r.rounds.filter((x) => x.every((m) => m.result != null)).length;
    if (!played) return h('div', { class: 'lx-empty' }, icon('list'), h('b', null, 'No standings yet'), h('span', null, 'Standings go up after round one.'));
    const pctTxt = (x: number) => (x * 100).toFixed(1);
    const cutAfter = r.phase === 'swiss' ? r.topCut : 0;
    const cutIds = new Set(r.top[0]?.flatMap((m) => [m.a, m.b]) ?? []);
    const meRank = st.find((x) => x.id === r.humanId)!.rank;
    const headCount = Math.min(st.length, r.topCut + 8, 40);
    const trimmed = st.length > 48 && !showAllStandings;
    const visible = (s: LocalsStanding) => !trimmed || s.rank <= headCount || Math.abs(s.rank - meRank) <= 3;
    const rows: HTMLElement[] = [];
    let eligible = 0;
    let prevShown = 0;
    st.forEach((s) => {
      if (!s.dropped) eligible++;
      const show = visible(s);
      if (show) {
        if (trimmed && s.rank > prevShown + 1) rows.push(h('div', { class: 'ev-gap', 'aria-hidden': 'true' }, '···'));
        prevShown = s.rank;
        const e = entrantOf(r, s.id)!;
        const deck = knownDeck(r, s.id) ? deckLabel(e) : null;
        const line = s.dropped ? 'Dropped' : [deck, e.regular ? 'Regular' : e.circuitId && r.season ? 'Circuit' : null].filter(Boolean).join(' · ');
        rows.push(
          h(
            'div',
            { class: ['lx-st-row', s.id === r.humanId && 'is-me', s.dropped && 'is-drop', cutIds.has(s.id) && 'is-cut'] },
            h('span', { class: 'lx-st-rank' }, String(s.rank)),
            h('span', { class: 'lx-st-name' }, h('b', null, s.id === r.humanId ? `${e.name} (you)` : e.name), line ? h('span', null, line) : null),
            h('span', { class: 'lx-st-rec' }, recordString(s)),
            h('span', { class: 'lx-st-pts' }, String(s.mp)),
            h('span', { class: 'lx-st-tb' }, pctTxt(s.omw)),
            h('span', { class: 'lx-st-tb' }, pctTxt(s.oomw)),
          ),
        );
      }
      if (cutAfter && eligible === cutAfter && !s.dropped && show) rows.push(h('div', { class: 'lx-cutline' }, h('span', null, `Top ${r.topCut} cut`)));
    });
    const more =
      st.length > 48
        ? h('button', { type: 'button', class: 'ev-more', onclick: () => ((showAllStandings = !showAllStandings), drawContent()) }, showAllStandings ? 'Show the top and your spot' : `Show all ${st.length} players`)
        : null;
    return h(
      'section',
      { class: 'lx-standings' },
      h('div', { class: 'lx-st-caption' }, r.phase === 'swiss' ? `After round ${played} of ${r.swissRounds}` : 'Final Swiss standings', h('span', null, 'OMW% and OOMW% break ties')),
      h(
        'div',
        { class: 'lx-st-table', role: 'table' },
        h('div', { class: 'lx-st-row lx-st-hd', role: 'row' }, h('span', { class: 'lx-st-rank' }, '#'), h('span', { class: 'lx-st-name' }, 'Player'), h('span', { class: 'lx-st-rec' }, 'Rec'), h('span', { class: 'lx-st-pts' }, 'Pts'), h('span', { class: 'lx-st-tb' }, 'OMW'), h('span', { class: 'lx-st-tb' }, 'OOMW')),
        rows,
      ),
      more,
    );
  }

  // ---------------------------------------------------------------- bracket
  function bracketView() {
    if (!r.top.length) return h('div', { class: 'lx-empty' }, icon('bracket'), h('b', null, 'Top cut after Swiss'), h('span', null, `The Top ${r.topCut} is single elimination, best of 3.`));
    const roundsCount = Math.log2(r.topCut);
    const slot = (id: string | null, m: LocalsMatch | null) => {
      if (!id) return h('div', { class: 'lx-br-slot is-tbd' }, h('span', { class: 'lx-br-seed' }, ''), h('span', { class: 'lx-br-name' }, 'TBD'));
      const e = entrantOf(r, id)!;
      const won = m && winnerOf(m) === id;
      const lost = m && m.result && !won;
      const score = m && m.result ? scoreFor(m, id).split('-')[0] : '';
      return h(
        'div',
        { class: ['lx-br-slot', id === r.humanId && 'is-me', won && 'is-won', lost && 'is-lost'] },
        h('span', { class: 'lx-br-seed' }, String(seedOf(r, id))),
        avatar(e, 26),
        h('span', { class: 'lx-br-name' }, h('b', null, id === r.humanId ? 'You' : e.name), h('span', null, deckLabel(e))),
        h('span', { class: 'lx-br-score' }, score),
      );
    };
    const champ = r.phase === 'done' && r.placements ? entrantOf(r, r.placements[0]) : null;
    const rounds = Array.from({ length: roundsCount }, (_, i) => i).reverse();
    return h(
      'section',
      { class: 'lx-bracket' },
      champ ? h('div', { class: 'lx-champ' }, icon('trophy'), h('div', null, h('span', { class: 'lx-k' }, 'Champion'), h('b', null, champ.human ? 'You' : champ.name), h('span', null, deckLabel(champ)))) : null,
      // latest round first: on a Top 64 the final matters more than 32 first-round tables
      rounds.map((ri) => {
        const count = r.topCut >> (ri + 1);
        const ms = r.top[ri] ?? null;
        const title = roundTitle(count);
        const list = ms ?? (count <= 4 ? Array.from({ length: count }, () => null) : []);
        if (!list.length) return h('div', { class: 'lx-br-round' }, h('h3', { class: 'lx-br-h' }, title, h('span', null, `${count} matches`)));
        return h(
          'div',
          { class: 'lx-br-round' },
          h('h3', { class: 'lx-br-h' }, title, ms && ms.every((m) => m.result) ? h('span', null, 'Complete') : ms ? h('span', { class: 'is-live' }, 'In progress') : null),
          h('div', { class: 'lx-br-grid' }, list.map((m) => h('div', { class: ['lx-br-match', m && involves(m, r.humanId) && 'has-me'] }, slot(m?.a ?? null, m), slot(m?.b ?? null, m)))),
        );
      }),
    );
  }

  // ---------------------------------------------------------------- prize ceremony
  function ceremonyView() {
    const place = placeOf(r);
    const me = entrantOf(r, r.humanId)!;
    const st = humanStanding(r);
    const champ = entrantOf(r, r.placements?.[0])!;
    const lines = r.prizes ?? [];
    const totals = prizeTotals(lines);
    const cut = inTopCut(r);
    const packs = Math.min(totals.packs, 12);
    const season = r.season ? loadSeason() : null;
    const ev = season?.events.find((e) => e.id === r.season?.eventId);
    const invite = season?.invites.you;
    const facts: Child[] = [
      h('div', { class: 'ev-fact' }, h('span', { class: 'lx-k' }, 'Rating'), h('b', null, String(loadRatings().constructed.rating)), h('span', { class: ['ev-delta', r.ratingDelta > 0 ? 'is-up' : r.ratingDelta < 0 && 'is-down'] }, `${signed(r.ratingDelta)} today`)),
      h('div', { class: 'ev-fact' }, h('span', { class: 'lx-k' }, 'Swiss'), h('b', null, recordString(st)), h('span', null, me.dropped != null ? `Dropped after round ${me.dropped}` : `${ordinal(st.rank)} after Swiss`)),
      r.season ? h('div', { class: 'ev-fact' }, h('span', { class: 'lx-k' }, 'Circuit points'), h('b', null, `+${ev?.result?.points ?? r.points ?? 0}`), h('span', null, `Week ${r.season.week}`)) : null,
    ];
    const inviteNote =
      r.season && invite && ((r.kind === 'regional' || r.kind === 'sjc') && invite.nationals?.includes(r.title) ? 'nationals' : null);
    return h(
      'section',
      { class: ['lx-ceremony', place === 1 && 'is-champ'] },
      h(
        'div',
        { class: 'lx-cer-hero' },
        deckArtEl(me.deck, 'lx-cer-art'),
        h('span', { class: 'lx-cer-shade' }),
        h(
          'div',
          { class: 'lx-cer-body' },
          h('span', { class: 'lx-k' }, r.placing && r.placing !== 'Participation' ? r.placing : me.dropped != null ? 'Dropped' : 'Thanks for playing'),
          h('div', { class: 'lx-cer-place' }, h('b', null, ordinal(place)), h('span', null, `of ${r.size}`)),
          h('div', { class: 'lx-cer-line' }, `${me.deck.name} · Swiss ${recordString(st)}${cut ? ` · Top ${r.topCut}` : ''}`),
        ),
      ),
      inviteNote
        ? h('div', { class: 'ev-invite' }, icon('medal'), h('div', null, h('b', null, 'Invited to Nationals'), h('span', null, invite!.nationals!)))
        : null,
      h('div', { class: 'ev-facts' }, facts),
      h(
        'div',
        { class: 'lx-cer-prize' },
        h('span', { class: 'lx-k' }, 'Your prize'),
        totals.packs
          ? h(
              'div',
              { class: 'lx-packstack', style: { '--n': String(packs) } },
              Array.from({ length: packs }, (_, i) => h('span', { class: 'lx-pack', style: { '--i': String(i) } }, h('span', { class: 'lx-pack-crimp' }), h('span', { class: 'lx-pack-mark' }, 'EDISON'), h('span', { class: 'lx-pack-crimp' }))),
            )
          : null,
        h('div', { class: 'lx-cer-total' }, totals.packs ? h('b', null, `${totals.packs} booster pack${totals.packs === 1 ? '' : 's'}`) : null, h('span', null, `${totals.packs ? ' + ' : ''}${totals.coins} DP`)),
        h('div', { class: 'lx-cer-lines' }, lines.map((l) => h('div', { class: 'lx-cer-row' }, h('span', null, l.reason.replace(/^[^·]+ · /, '')), h('span', null, [l.packs ? `${l.packs} packs` : '', l.coins ? `${l.coins} DP` : ''].filter(Boolean).join(' · '))))),
      ),
      h('div', { class: 'lx-cer-champ' }, avatar(champ, 40), h('div', null, h('span', { class: 'lx-k' }, `Champion · ${r.venue.city || r.title}`), h('b', null, champ.human ? 'You' : champ.name), h('span', null, `${deckLabel(champ)} · ${listLine(champ.deck, deckLabel(champ))}`))),
      topDecks(),
    );
  }

  function topDecks() {
    const n = Math.min(8, r.topCut);
    const ids = (r.placements ?? []).slice(0, n);
    return lobbySection(
      `Top ${n} decks`,
      null,
      h(
        'div',
        { class: 'lx-t8' },
        ids.map((id, i) => {
          const e = entrantOf(r, id)!;
          return h('div', { class: ['lx-t8-row', id === r.humanId && 'is-me'] }, h('span', { class: 'lx-t8-place' }, i < 2 ? ordinal(i + 1) : i < 4 ? 'T4' : 'T8'), deckArtEl(e.deck, 'lx-t8-art'), h('span', { class: 'lx-t8-name' }, h('b', null, e.human ? 'You' : e.name), h('span', null, deckLabel(e))));
        }),
      ),
    );
  }

  // ---------------------------------------------------------------- sticky bar
  function drawBar() {
    const m = pendingHumanMatch(r);
    const quiet = (label: string, fn: () => void, ic?: Parameters<typeof icon>[0]) => h('button', { type: 'button', class: 'lx-btn lx-btn--quiet', onclick: fn }, ic ? icon(ic) : null, label);
    if (r.phase === 'done') {
      const totals = prizeTotals(r.prizes ?? []);
      bar.replaceChildren(
        stickyBar(
          h('div', { class: 'lob-bar-sum' }, h('span', null, h('b', null, `${totals.packs} pack${totals.packs === 1 ? '' : 's'}`), ` and ${totals.coins} DP added to your collection`)),
          r.season ? ctaButton('Back to the season', () => leave(true), 'flag') : totals.packs ? ctaButton('Open your packs', () => go('packs'), 'cards') : null,
          h('div', { class: 'lx-bar-row' }, r.season && totals.packs ? quiet('Open packs', () => go('packs')) : quiet('Profile', () => go('profile')), h('button', { type: 'button', class: 'lx-btn', onclick: () => leave(false) }, 'Events', icon('chevron'))),
        ),
      );
      return;
    }
    let sum: Child = null;
    let cta: HTMLElement | null = null;
    let extra: HTMLElement | null = null;
    if (m) {
      const opp = opponentOf(r, m)!;
      const revealed = r.revealed.includes(m.id);
      sum = h('span', null, m.stage === 'top' ? `${m.label} · ` : `Table ${m.table} · `, 'vs ', h('b', null, opp.name));
      cta = saved ? ctaButton('Resume match', () => void playMine(), 'play') : revealed ? ctaButton('Play match', () => void playMine(), 'swords') : ctaButton('Sit down', () => sitDown(m), 'hand');
      if (revealed) extra = h('div', { class: 'lx-bar-row' }, quiet('Concede', () => void concedeMine(), 'flag'), quiet('Auto-play · unrated', () => autoMine(), 'robot'));
    } else if (r.step === 'pairings') {
      const mine = humanMatch(r);
      sum = mine?.b == null && mine ? h('span', null, 'Bye this round') : h('span', null, `${currentRound(r).length} tables in play`);
      cta = ctaButton('Get results', () => collect(), 'clipboard');
    } else if (r.step === 'results') {
      if (r.phase === 'swiss') {
        sum = h('span', null, 'Results are in');
        cta = ctaButton('Post standings', () => {
          r.step = 'standings';
          saveEvent(r);
          tab = 'standings';
          redraw();
          toTop();
        }, 'list');
      } else {
        const ms = currentRound(r);
        const last = ms.length === 1;
        sum = last ? h('span', null, 'The final is over') : h('span', null, `${roundTitle(ms.length)} results are in`);
        cta = ctaButton(last ? 'Prize ceremony' : `Next: ${roundTitle(ms.length / 2)}`, () => next(), last ? 'trophy' : 'bracket');
      }
    } else if (r.step === 'standings') {
      const lastSwiss = r.rounds.length >= r.swissRounds;
      const st = humanStanding(r);
      sum = h('span', null, 'You are ', h('b', null, ordinal(st.rank)), ` at ${recordString(st)}`);
      cta = ctaButton(lastSwiss ? `Announce the Top ${r.topCut}` : `Post Round ${r.rounds.length + 1} pairings`, () => next(), lastSwiss ? 'trophy' : 'clipboard');
    }
    if (!m && humanEliminated(r)) extra = h('div', { class: 'lx-bar-row' }, quiet('Skip to the end', () => skipToEnd(), 'play'));
    bar.replaceChildren(stickyBar(sum ? h('div', { class: 'lob-bar-sum' }, sum) : null, cta, extra));
  }

  // ---------------------------------------------------------------- actions
  function sitDown(m: LocalsMatch) {
    markRevealed(r, m.id);
    saveEvent(r);
    flipMatch = m.id;
    tab = 'round';
    redraw();
    requestAnimationFrame(() => el.querySelector('.lx-seat')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }

  function afterMine(msg?: string) {
    step('playing out the round', () => finishRound(r));
    saveEvent(r);
    animateRound = roundKey(currentRound(r));
    tab = 'round';
    if (msg) toast(msg, 'info');
    redraw();
    toTop();
  }

  function takeId() {
    acceptId(r);
    const m = humanMatch(r)!;
    const opp = opponentOf(r, m)!;
    recordMatch({ date: Date.now(), deckName: entrantOf(r, r.humanId)!.deck.name, oppName: opp.name, oppDeck: opp.deck.name, result: 'D', score: 'ID', context: `${r.title} · Round ${m.round}` });
    afterMine('Intentional draw reported. Hands shaken.');
  }

  async function concedeMine() {
    const m = pendingHumanMatch(r);
    if (!m) return;
    if (!(await confirmDialog('Concede this match?', 'It is recorded as a 0-2 loss and counts toward your rating.', 'Concede', true))) return;
    const opp = opponentOf(r, m)!;
    lastRating = concede(r);
    recordMatch({ date: Date.now(), deckName: entrantOf(r, r.humanId)!.deck.name, oppName: opp.name, oppDeck: opp.deck.name, result: 'L', score: '0-2', context: `${r.title} · Conceded` });
    afterMine();
  }

  function autoMine() {
    lastRating = null;
    autoPlay(r);
    afterMine('Your deck played it out. Auto-played matches are unrated.');
  }

  function collect() {
    step('playing out the round', () => finishRound(r));
    saveEvent(r);
    animateRound = roundKey(currentRound(r));
    tab = 'round';
    redraw();
    toTop();
  }

  function next() {
    const res = step(r.phase === 'swiss' && r.rounds.length < r.swissRounds ? `pairing round ${r.rounds.length + 1}` : 'pairing the top cut', () => {
      const out = advance(r);
      if (out === 'done') closeOutEvent(r);
      return out;
    });
    saveEvent(r);
    if (res === 'round' || res === 'topcut' || res === 'top-round') postRound = roundKey(currentRound(r));
    tab = res === 'done' ? 'prizes' : res === 'topcut' ? 'bracket' : 'round';
    if (res === 'topcut') toast(inTopCut(r) ? `You made the Top ${r.topCut}!` : `Top ${r.topCut} is set. You just missed it.`, inTopCut(r) ? 'gold' : 'info', 3200);
    redraw();
    toTop();
  }

  function skipToEnd() {
    step('playing out the rest of the event', () => {
      runToEnd(r);
      closeOutEvent(r);
    });
    saveEvent(r);
    tab = 'prizes';
    redraw();
    toTop();
  }

  async function playMine() {
    if (busy) return;
    const m = pendingHumanMatch(r);
    if (!m || m.b == null) return;
    busy = true;
    // the duel has its own restore guard (match.ts)
    clearTimeout(opened);
    endRisky(scope);
    const s = getSettings();
    const me = entrantOf(r, r.humanId)!;
    const opp = opponentOf(r, m)!;
    const meA = m.a === r.humanId;
    const sides: [DuelSide, DuelSide] = [
      { name: me.name, deck: toDeckList(me.deck), avatar: s.avatar, sleeve: s.sleeve, control: 'human', title: me.deck.name },
      { name: opp.name, deck: toDeckList(opp.deck), avatar: opp.avatar, sleeve: opp.sleeve, control: opp.difficulty, title: deckLabel(opp) },
    ];
    const where = m.stage === 'top' ? m.label : `Round ${m.round} · Table ${m.table}`;
    const setup: MatchSetup = {
      sides,
      bestOf: 3,
      caption: `${where} – vs ${opp.name}`,
      requireWinner: m.stage === 'top',
      stats: { deckKey: me.deck.id, deckName: me.deck.name },
      resume: { kind: 'events', key: duelKey(r, m), route: 'events', params: { view: 'run' } },
    };
    try {
      const outcome = await runMatch(setup);
      const games = outcome.games.map((g) => (meA ? g : { ...g, winner: g.winner == null ? null : ((1 - g.winner) as 0 | 1) }));
      const res = outcome.result === 'draw' ? 'draw' : (outcome.result === 'a') === meA ? 'a' : 'b';
      lastRating = reportPlayed(r, games, res);
      finishRound(r);
      saveEvent(r);
      animateRound = roundKey(currentRound(r));
      const wa = outcome.games.filter((g) => g.winner === 0).length;
      const wb = outcome.games.filter((g) => g.winner === 1).length;
      const my = outcome.result === 'a' ? 'W' : outcome.result === 'b' ? 'L' : 'D';
      recordMatch({ date: Date.now(), deckName: me.deck.name, oppName: opp.name, oppDeck: opp.deck.name, result: my, score: `${wa}-${wb}`, context: `${r.title} · ${where}` });
      showResults({
        setup,
        outcome,
        human: 0,
        context: `${spec.short} · ${where}${lastRating ? ` · Rating ${lastRating.after} (${signed(lastRating.delta)})` : ''}`,
        actions: [{ label: 'Back to the tables', variant: 'primary', icon: 'clipboard', onClick: () => go('events', { view: 'run' }, { replace: true }) }],
      });
    } finally {
      busy = false;
    }
  }

  async function drop() {
    if (!(await confirmDialog('Drop from the event?', 'Your current match is conceded and the rest of the event plays out without you. You keep any prizes you have earned.', 'Drop', true))) return;
    const m = pendingHumanMatch(r);
    if (m && m.b != null) lastRating = concede(r);
    step('playing out the rest of the event', () => {
      dropHuman(r);
      closeOutEvent(r);
    });
    saveEvent(r);
    tab = 'prizes';
    redraw();
    toTop();
  }

  function leave(toSeason: boolean) {
    clearActiveEvent();
    go('events', toSeason ? { view: 'season' } : {}, { replace: true });
  }

  redraw();
  if (autoResume) {
    if (saved) setTimeout(() => void playMine(), 0);
    else toast('That duel can no longer be resumed.', 'error');
  }
  return {
    el,
    dispose: () => {
      clearTimeout(opened);
      endRisky(scope);
      clearInterval(interval);
      revealTimers.forEach(clearTimeout);
    },
  };
}
