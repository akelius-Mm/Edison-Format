// Locals Night: check in at a card shop on a Friday in spring 2010, read the pairings off the
// wall, play your match, watch the result slips come in, check standings, make the cut, collect
// prize packs. Engine in src/locals.
import {
  PRIZE_TABLE,
  REGULARS,
  acceptIntentionalDraw,
  advance,
  closeNight,
  computeStandings,
  createNight,
  currentRound,
  declineIntentionalDraw,
  deckLabel,
  dropHuman,
  entrantOf,
  finalizeNight,
  finishRound,
  humanEliminated,
  humanIdOffer,
  humanMatch,
  humanStanding,
  inTopCut,
  involves,
  loadActiveNight,
  loadHistory,
  loadRivals,
  markRevealed,
  metaInfo,
  opponentOf,
  pendingHumanMatch,
  placeOf,
  postStandings,
  prizeTotals,
  recordHumanResult,
  recordString,
  regularDeck,
  regularsAttending,
  roundLabel,
  saveNight,
  scoreFor,
  upcomingNight,
  winnerOf,
  type DeckSnapshot,
  type FieldSize,
  type HistoryEntry,
  type LocalsEntrant,
  type LocalsMatch,
  type LocalsNight,
  type LocalsStanding,
} from '../../locals';
import { metaLabel } from '../../locals/meta';
import { swissRoundsFor, topCutFor } from '../../locals/shops';
import type { DuelSide } from '../duel/api';
import { getSettings, loadJSON, saveJSON } from '../settings';
import { artInto, ctaButton, deckShelf, linkButton, lobbySection, signatureCard, stickyBar } from './components';
import { confirmDialog, h, icon, segmented, toast, type Child } from './dom';
import { AVATAR_PRESETS, SLEEVES, sleevePreview } from './ext';
import { runMatch, type MatchSetup } from './match';
import { reconcileActiveDuel, type SavedDuel } from '../duel/resume';
import { resumeDuelCard } from './resumeCard';
import { frame, go, type Screen } from './nav';
import { showResults } from './results';
import { allDeckInfos, ordinal, recordMatch, toDeckList, type DeckInfo } from './store';
import './locals.css';
// Events agent: Locals Night matches you play count toward your Constructed rating.
import { aiRating, recordConstructedResult, signed } from '../../events/ratings';

const FORM_KEY = 'edison.locals.form.v1';

interface CheckInForm {
  deck: string | null;
  /** Turnout override per night number. */
  size?: { night: number; size: FieldSize };
}

/** Round whose result slips should animate in on the next render (set right after your match). */
let animateRound: string | null = null;
/** Match id whose deck should flip over on the next render. */
let flipMatch: string | null = null;
/** Round id whose pairings sheet should be "taped up" on the next render. */
let postRound: string | null = null;

export function localsScreen(params: Record<string, string>): Screen {
  if (params.view === 'history') return historyScreen();
  const n = loadActiveNight();
  if (params.resume) history.replaceState(null, '', '#/locals');
  if (!n) {
    reconcileActiveDuel('locals', null);
    return checkInScreen();
  }
  return hubScreen(n, params.resume === '1');
}

/** The saved-duel key of a Locals match. */
const duelKey = (n: LocalsNight, m: LocalsMatch) => `locals:${n.id}:${m.id}`;

// =================================================================== small pieces

const roundKey = (ms: LocalsMatch[]) => ms[0]?.id.replace(/-\d+$|-bye$/, '') ?? '';

/** Initials monogram (the app does not show duelist pictures). */
export function avatar(e: { name: string; human?: boolean }, size: number) {
  const words = e.name.replace(/^Big /, '').replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  const ini = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? '?').slice(0, 1);
  return h('span', { class: ['lx-av', e.human && 'is-you'], style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.36)}px` }, 'aria-hidden': 'true' }, ini.toUpperCase());
}

/** The app scrolls inside <body>; reset both scrollers. */
export function toTop() {
  window.scrollTo(0, 0);
  document.body.scrollTo?.({ top: 0 });
}

export function deckArtEl(deck: Pick<DeckSnapshot, 'id' | 'main' | 'extra' | 'color'>, cls: string) {
  const el = h('span', { class: cls, style: { '--deck': deck.color }, 'aria-hidden': 'true' });
  artInto(el, signatureCard({ id: deck.id, main: deck.main, extra: deck.extra }));
  return el;
}

/** Decks the player has seen: their own, opponents they sat down with, the top cut once posted. */
function knownDeck(n: LocalsNight, id: string) {
  if (id === n.humanId || n.phase === 'done') return true;
  if (n.phase === 'top' && n.top[0]?.some((m) => involves(m, id))) return true;
  for (const m of [...n.rounds.flat(), ...n.top.flat()])
    if (involves(m, n.humanId) && involves(m, id) && (m.result != null || n.revealed.includes(m.id))) return true;
  return false;
}

function rivalLine(e: LocalsEntrant): Child {
  if (!e.regular) return null;
  const r = loadRivals()[e.regular];
  const rec = r && r.w + r.l + r.d ? `${r.w}-${r.l}${r.d ? `-${r.d}` : ''}` : null;
  return h('span', { class: 'lx-rival' }, icon('user'), rec ? `Store record vs you · ${rec}` : 'First time you meet');
}

export function timer(n: LocalsNight) {
  const el = h('span', { class: 'lx-timer-v' });
  const tick = () => {
    const left = Math.round(n.roundMinutes * 60 - (Date.now() - n.roundStartedAt) / 1000);
    if (left <= 0) {
      el.textContent = 'Time';
      el.classList.add('is-over');
      return;
    }
    const m = Math.floor(left / 60);
    const s = left % 60;
    el.textContent = `${m}:${String(s).padStart(2, '0')}`;
    el.classList.toggle('is-low', left < 300);
  };
  tick();
  return { el, tick };
}

function placeText(place: number) {
  return ordinal(place);
}

// =================================================================== check-in

function checkInScreen(): Screen {
  const up = upcomingNight();
  const decks = allDeckInfos();
  const form = loadJSON<CheckInForm>(FORM_KEY, { deck: null });
  let deckKey = form.deck && decks.some((d) => d.key === form.deck) ? form.deck : (decks.find((d) => d.ref.kind === 'premade' && !d.problems.length)?.key ?? null);
  let size: FieldSize = form.size?.night === up.number ? form.size.size : up.size;
  const persist = () => saveJSON(FORM_KEY, { deck: deckKey, size: { night: up.number, size } } satisfies CheckInForm);

  const facts = h('div', { class: 'lx-facts' });
  const formatLine = h('div', { class: 'lx-flyer-format' });
  const drawFacts = () => {
    const [wd, md] = up.dateLabel.split(', ');
    facts.replaceChildren(
      fact(wd.slice(0, 3), md, '2010'),
      fact('Players', String(size), size === 16 ? 'Quiet week' : size === 24 ? 'Usual crowd' : 'Packed house'),
      fact('Entry', 'Free', 'Store-sponsored'),
    );
    formatLine.replaceChildren(
      h('span', null, `${swissRoundsFor(size)} Swiss rounds`),
      h('span', null, 'Best of 3'),
      h('span', null, `Top ${topCutFor(size)} cut`),
      h('span', null, '45-min rounds'),
    );
  };
  const fact = (k: string, v: string, sub: string) => h('div', { class: 'lx-fact' }, h('span', { class: 'lx-fact-k' }, k), h('b', { class: 'lx-fact-v' }, v), h('span', { class: 'lx-fact-s' }, sub));
  drawFacts();

  const flyer = h(
    'section',
    { class: 'lx-flyer', 'aria-label': 'Tonight' },
    h('div', { class: 'lx-flyer-eyebrow' }, h('span', null, 'Friday Locals'), h('span', { class: 'lx-dot' }), h('span', null, 'Edison Format')),
    h('h2', { class: 'lx-flyer-shop' }, up.shop.name),
    h('div', { class: 'lx-flyer-where' }, up.shop.where),
    facts,
    formatLine,
    h('p', { class: 'lx-flyer-blurb' }, up.shop.blurb),
  );

  const turnout = segmented<FieldSize>(
    [
      { value: 16, label: '16', hint: 'Quiet week: 4 rounds, Top 4' },
      { value: 24, label: '24', hint: 'Usual crowd: 5 rounds, Top 8' },
      { value: 32, label: '32', hint: 'Packed house: 5 rounds, Top 8' },
    ],
    size,
    (v) => {
      size = v;
      persist();
      drawFacts();
      drawRegulars();
      drawBar();
    },
    'Turnout',
  );

  const regularsRow = h('div', { class: 'lx-regs' });
  const rivals = loadRivals();
  const drawRegulars = () => {
    const regs = regularsAttending(up.number, size);
    regularsRow.replaceChildren(
      ...regs.map((r) => {
        const deck = regularDeck(r.id, up.number);
        const rec = rivals[r.id];
        const has = rec && rec.w + rec.l + rec.d;
        return h(
          'div',
          { class: 'lx-reg', title: r.blurb },
          avatar(r, 48),
          h('b', { class: 'lx-reg-name' }, r.name.split(' ')[0] === 'Big' ? 'Big Dave' : r.name.split(' ')[0]),
          h('span', { class: 'lx-reg-deck' }, deck ? metaLabel(r.meta, deck) : metaInfo(r.meta).label),
          h('span', { class: ['lx-reg-rec', !!has && 'has'] }, has ? `${rec.w}-${rec.l}${rec.d ? `-${rec.d}` : ''}` : 'New'),
        );
      }),
    );
  };
  drawRegulars();

  const prizeList = h(
    'div',
    { class: 'lx-prize-list' },
    prizeRow('1st place', PRIZE_TABLE.first.packs, PRIZE_TABLE.first.coins),
    prizeRow('2nd place', PRIZE_TABLE.second.packs, PRIZE_TABLE.second.coins),
    prizeRow('Top 4', PRIZE_TABLE.top4.packs, PRIZE_TABLE.top4.coins),
    prizeRow('Top 8', PRIZE_TABLE.top8.packs, PRIZE_TABLE.top8.coins, 'With 24+ players'),
    prizeRow('X-1 or better', PRIZE_TABLE.xMinusOne.packs, PRIZE_TABLE.xMinusOne.coins, 'If you miss the cut'),
    prizeRow('Everyone', 0, PRIZE_TABLE.participation.coins, 'For showing up'),
  );

  const summary = h('div', { class: 'lob-bar-sum' });
  const drawBar = () => {
    const d = decks.find((x) => x.key === deckKey);
    summary.replaceChildren(d ? h('span', null, 'Playing ', h('b', null, d.name)) : h('span', null, 'Choose a deck'), h('span', null, ` · ${size} players`));
  };
  drawBar();

  const history = loadHistory();
  const el = frame(
    'Locals Night',
    { eyebrow: `Night ${up.number} · ${up.dateLabel.replace(/, 2010$/, '')}`, cls: 'lobby-screen lx-screen lx-checkin', backTo: () => go('play'), backLabel: 'Duel' },
    flyer,
    lobbySection('Turnout', h('span', { class: 'lob-count' }, 'Who shows up'), turnout),
    lobbySection(
      'Your deck',
      linkButton('Deck Builder', () => go('deck-builder')),
      deckShelf(decks, deckKey, (d) => {
        deckKey = d?.key ?? null;
        persist();
        drawBar();
      }, { label: 'Your deck' }),
    ),
    lobbySection('Regulars tonight', h('span', { class: 'lob-count' }, 'Your store record'), regularsRow),
    lobbySection('Prize support', null, prizeList),
    history.length
      ? h(
          'button',
          { type: 'button', class: 'lx-linkrow', onclick: () => go('locals', { view: 'history' }) },
          h('span', { class: 'lx-linkrow-icon' }, icon('scroll')),
          h('span', { class: 'lx-linkrow-text' }, h('b', null, 'Past nights'), h('span', null, historyLine(history))),
          icon('chevron'),
        )
      : null,
    stickyBar(summary, ctaButton('Check in', () => void checkIn(), 'clipboard')),
  );

  async function checkIn() {
    const info: DeckInfo | undefined = decks.find((d) => d.key === deckKey);
    if (!info) return toast('Choose your deck first.', 'error');
    if (info.problems.length && !(await confirmDialog('Deck is not tournament legal', `${info.name}: ${info.problems.slice(0, 2).join(' ')} Check in anyway?`, 'Check in anyway'))) return;
    const s = getSettings();
    const deck: DeckSnapshot = { id: info.key, name: info.name, archetype: info.archetype, tier: info.tier, color: info.color, main: info.main, extra: info.extra };
    const n = createNight({
      human: { name: s.playerName || 'You', avatar: s.avatar, sleeve: s.sleeve, deck },
      size,
      number: up.number,
      sleeves: SLEEVES.map((x) => x.id),
      avatars: AVATAR_PRESETS.filter((a) => a !== s.avatar),
    });
    saveNight(n);
    postRound = roundKey(currentRound(n));
    go('locals', {}, { replace: true });
  }

  return { el };
}

export function prizeRow(label: string, packs: number, coins: number, note?: string) {
  return h(
    'div',
    { class: 'lx-prize-row' },
    h('span', { class: 'lx-prize-k' }, h('b', null, label), note ? h('span', null, note) : null),
    h('span', { class: 'lx-prize-v' }, packs ? h('span', { class: 'lx-packs-mini' }, packIcon(), `${packs}`) : null, h('span', { class: 'lx-dp' }, `${coins} DP`)),
  );
}

export function packIcon() {
  return h('span', { class: 'lx-pack-ico', 'aria-hidden': 'true' });
}

function historyLine(hs: HistoryEntry[]) {
  const best = Math.min(...hs.map((x) => x.place));
  return `${hs.length} night${hs.length === 1 ? '' : 's'} · best finish ${placeText(best)}`;
}

// =================================================================== the night

type Tab = 'round' | 'standings' | 'bracket' | 'prizes';

function hubScreen(n: LocalsNight, autoResume = false): Screen {
  if (n.phase === 'done') finalizeNight(n);
  let tab: Tab = n.phase === 'done' ? 'prizes' : n.step === 'standings' ? 'standings' : 'round';
  const timers: (() => void)[] = [];
  // a night resumed much later gets a fresh clock rather than a long-expired one
  if (Date.now() - n.roundStartedAt > (n.roundMinutes + 30) * 60000) {
    n.roundStartedAt = Date.now();
    saveNight(n);
  }
  const interval = setInterval(() => timers.forEach((t) => t()), 1000);
  let revealTimers: ReturnType<typeof setTimeout>[] = [];
  let busy = false;

  const header = h('div', { class: 'lx-hub-head' });
  const tabsHost = h('div', { class: 'lx-tabs' });
  const content = h('div', { class: 'lx-content' });
  const bar = h('div', { class: 'lx-bar-host' });

  const dropBtn = h('button', { type: 'button', class: 'lx-head-btn', 'aria-label': 'Drop from the event', title: 'Drop', onclick: () => void drop() }, icon('door'));
  const el = frame('Locals Night', { compact: true, cls: 'lobby-screen lx-screen lx-hub', actions: dropBtn, backTo: () => go('play'), backLabel: 'Duel' }, header, tabsHost, content, bar);

  /** A duel of this night's current match that was left (or cut off) mid-game. */
  let saved: SavedDuel | null = null;
  const syncSaved = () => {
    const m = pendingHumanMatch(n);
    saved = reconcileActiveDuel('locals', m && m.b != null ? duelKey(n, m) : null);
  };

  function redraw() {
    timers.length = 0;
    revealTimers.forEach(clearTimeout);
    revealTimers = [];
    syncSaved();
    dropBtn.hidden = n.phase === 'done' || humanEliminated(n);
    drawHeader();
    drawTabs();
    drawContent();
    drawBar();
  }

  function drawHeader() {
    const st = humanStanding(n);
    const done = n.phase === 'done';
    const pill = done ? `${placeText(placeOf(n))} of ${n.size}` : `${recordString(st)} · ${ordinal(st.rank)}`;
    header.replaceChildren(
      h('div', { class: 'lx-hub-eyebrow' }, n.shop.name),
      h(
        'div',
        { class: 'lx-hub-row' },
        h('h1', { class: 'lx-hub-title' }, done ? 'Final standings' : roundLabel(n)),
        h('span', { class: ['lx-pill', done && placeOf(n) <= n.topCut && 'is-gold'] }, pill),
      ),
      h('div', { class: 'lx-hub-sub' }, `${n.dateLabel.replace(/, 2010$/, '')} · ${n.size} players · Top ${n.topCut}`, n.phase === 'top' && humanEliminated(n) ? ' · Spectating' : ''),
    );
  }

  function drawTabs() {
    const opts: { value: Tab; label: string }[] = [];
    if (n.phase === 'done') opts.push({ value: 'prizes', label: 'Prizes' });
    else opts.push({ value: 'round', label: n.step === 'results' ? 'Results' : 'Pairings' });
    opts.push({ value: 'standings', label: 'Standings' });
    if (n.top.length) opts.push({ value: 'bracket', label: `Top ${n.topCut}` });
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
    if (tab === 'standings') body = standingsView(n);
    else if (tab === 'bracket') body = bracketView(n);
    else if (tab === 'prizes') body = ceremonyView(n);
    else body = n.step === 'results' ? resultsView() : pairingsView();
    content.replaceChildren(body);
  }

  // ---------------------------------------------------------------- pairings
  function pairingsView() {
    const round = currentRound(n);
    const m = humanMatch(n);
    const key = roundKey(round);
    const sheetEl = sheet(n, round, 'pairings');
    if (postRound === key) {
      sheetEl.classList.add('is-posting');
      postRound = null;
    }
    return h('div', { class: 'lx-round' }, saved ? resumeDuelCard(saved, { onResume: () => void playMine(), cls: 'mode-resume' }) : null, seatCard(m), sheetEl);
  }

  function seatCard(m: LocalsMatch | null): HTMLElement {
    const t = timer(n);
    timers.push(t.tick);
    const head = (label: string, value: Child) =>
      h(
        'div',
        { class: 'lx-seat-head' },
        h('div', { class: 'lx-seat-table' }, h('span', { class: 'lx-k' }, label), h('b', null, value)),
        h('div', { class: 'lx-timer' }, h('span', { class: 'lx-k' }, 'Round timer'), t.el),
      );
    const me = entrantOf(n, n.humanId)!;
    if (!m) {
      // not in this round (missed the cut, knocked out, or dropped)
      const why = me.dropped != null ? 'You dropped from the event.' : !inTopCut(n) ? `You finished ${ordinal(humanStanding(n).rank)} after Swiss — just outside the Top ${n.topCut}.` : 'You were knocked out of the top cut.';
      return h('section', { class: 'lx-seat lx-seat--out' }, head('Spectating', currentRound(n)[0]?.label ?? ''), h('p', { class: 'lx-seat-note' }, why, ' Grab a soda and watch the feature match.'));
    }
    if (m.b == null)
      return h(
        'section',
        { class: 'lx-seat lx-seat--bye' },
        head('Bye', '—'),
        h('div', { class: 'lx-bye' }, h('span', { class: 'lx-bye-ico' }, icon('check')), h('div', null, h('b', null, 'You have a bye this round'), h('p', null, 'Odd number of players after a drop. You take the match win — go trade some binders.'))),
      );
    const opp = opponentOf(n, m)!;
    const revealed = n.revealed.includes(m.id) || m.result != null;
    const prior = n.phase === 'swiss' ? computeStandings({ entrants: n.entrants, rounds: n.rounds.slice(0, -1) }) : computeStandings(n);
    const rec = (id: string) => {
      const s = prior.find((x) => x.id === id)!;
      return n.phase === 'top' ? `Seed ${seedOf(n, id)}` : `${recordString(s)} · ${s.mp} pts`;
    };
    const side = (e: LocalsEntrant, right = false) =>
      h(
        'div',
        { class: ['lx-seat-player', right && 'right'] },
        avatar(e, 40),
        h('div', { class: 'lx-seat-pn' }, h('b', null, e.human ? 'You' : e.name), h('span', null, rec(e.id))),
      );
    const flip = flipMatch === m.id;
    flipMatch = null;
    const deckBox = h(
      'div',
      { class: ['lx-reveal', revealed && !flip && 'is-open', flip && 'is-flipping'] },
      h(
        'div',
        { class: 'lx-reveal-inner' },
        h('div', { class: 'lx-reveal-back' }, sleevePreview(opp.sleeve, 'sm')),
        h('div', { class: 'lx-reveal-front', style: { '--deck': opp.deck.color } }, deckArtEl(opp.deck, 'lx-reveal-art'), h('span', { class: 'lx-reveal-shade' })),
      ),
    );
    if (flip) requestAnimationFrame(() => requestAnimationFrame(() => deckBox.classList.add('is-open')));
    const info = revealed
      ? h(
          'div',
          { class: 'lx-deckinfo' },
          h('span', { class: 'lx-k' }, `${opp.name.split(' ')[0]} is on`),
          h('b', { class: 'lx-deckinfo-name' }, deckLabel(opp)),
          h('span', { class: 'lx-deckinfo-list' }, listLine(opp.deck, deckLabel(opp))),
          opp.blurb ? h('p', { class: 'lx-deckinfo-blurb' }, opp.blurb) : null,
          rivalLine(opp),
        )
      : h(
          'div',
          { class: 'lx-deckinfo' },
          h('span', { class: 'lx-k' }, 'Their deck'),
          h('b', { class: 'lx-deckinfo-name is-hidden' }, 'Face down'),
          h('span', { class: 'lx-deckinfo-list' }, opp.regular ? `${opp.title} · a regular` : opp.title),
          opp.blurb ? h('p', { class: 'lx-deckinfo-blurb' }, opp.blurb) : null,
          rivalLine(opp),
        );
    const offer = revealed && m.result == null ? humanIdOffer(n) : null;
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
              h('button', { type: 'button', class: 'lx-btn', onclick: () => acceptId() }, icon('hand'), 'Accept the ID'),
              h('button', { type: 'button', class: 'lx-btn lx-btn--quiet', onclick: () => (declineIntentionalDraw(n), saveNight(n), redraw()) }, 'Play it out'),
            ),
          )
        : null,
    );
  }

  // ---------------------------------------------------------------- results
  function resultsView() {
    const round = currentRound(n);
    const key = roundKey(round);
    const animate = animateRound === key;
    animateRound = null;
    const sheetEl = sheet(n, round, 'results');
    const rows = [...sheetEl.querySelectorAll<HTMLElement>('.lx-row[data-pending]')];
    const progress = h('span', { class: 'lx-progress-v' });
    const total = rows.length + 1;
    let shown = 0;
    const setProgress = () => {
      progress.textContent = shown >= rows.length ? `All ${total} tables reported` : `${shown + 1} of ${total} tables reported`;
      if (shown >= rows.length) progressWrap.classList.add('is-done');
    };
    const progressWrap = h('div', { class: 'lx-progress' }, h('span', { class: 'lx-progress-dot' }), progress);
    if (animate && rows.length) {
      for (const r of rows) r.classList.add('is-pending');
      // slips come in out of order, a little faster as the room empties
      const order = rows.map((r, i) => ({ r, k: Math.sin(i * 12.9898 + rows.length) })).sort((a, b) => a.k - b.k);
      let t = 450;
      order.forEach(({ r }, i) => {
        t += Math.max(110, 380 - i * 22);
        revealTimers.push(
          setTimeout(() => {
            r.classList.remove('is-pending');
            r.classList.add('is-in');
            shown++;
            setProgress();
          }, t),
        );
      });
    } else shown = rows.length;
    setProgress();
    const mine = humanMatch(n);
    return h('div', { class: 'lx-round' }, mine ? myResultCard(mine) : null, progressWrap, sheetEl);
  }

  function myResultCard(m: LocalsMatch) {
    if (m.b == null) return h('section', { class: 'lx-myres is-win' }, h('span', { class: 'lx-myres-mark' }, 'W'), h('div', null, h('b', null, 'Bye'), h('span', null, 'Match win, no games played')));
    const opp = opponentOf(n, m)!;
    const won = winnerOf(m) === n.humanId;
    const kind = m.result === 'draw' ? 'draw' : won ? 'win' : 'loss';
    const head = m.intentional ? 'Intentional draw' : m.time ? 'Draw — time called' : kind === 'win' ? `Won ${scoreFor(m, n.humanId)}` : kind === 'loss' ? `Lost ${scoreFor(m, n.humanId)}` : `Draw ${scoreFor(m, n.humanId)}`;
    return h(
      'section',
      { class: ['lx-myres', `is-${kind}`] },
      h('span', { class: 'lx-myres-mark' }, kind === 'win' ? 'W' : kind === 'loss' ? 'L' : 'D'),
      h('div', null, h('b', null, head), h('span', null, `vs ${opp.name} · ${deckLabel(opp)}`)),
    );
  }

  // ---------------------------------------------------------------- sticky bar
  function drawBar() {
    let sum: Child = null;
    let cta: HTMLElement | null = null;
    const m = pendingHumanMatch(n);
    if (n.phase === 'done') {
      cta = ctaButton('Open your packs', () => go('packs'), 'cards');
      const totals = prizeTotals(n.prizes ?? []);
      sum = h('span', null, h('b', null, `${totals.packs} pack${totals.packs === 1 ? '' : 's'}`), ` and ${totals.coins} DP added to your collection`);
      bar.replaceChildren(
        stickyBar(
          h('div', { class: 'lob-bar-sum' }, sum),
          totals.packs ? cta : null,
          h('div', { class: 'lx-bar-row' }, h('button', { type: 'button', class: 'lx-btn lx-btn--quiet', onclick: () => go('locals', { view: 'history' }) }, 'Past nights'), h('button', { type: 'button', class: 'lx-btn', onclick: () => leave() }, 'Next Friday', icon('chevron'))),
        ),
      );
      return;
    }
    if (m) {
      const opp = opponentOf(n, m)!;
      const revealed = n.revealed.includes(m.id);
      sum = h('span', null, m.stage === 'top' ? `${m.label} · ` : `Table ${m.table} · `, 'vs ', h('b', null, opp.name));
      cta = saved ? ctaButton('Resume match', () => void playMine(), 'play') : revealed ? ctaButton('Play match', () => void playMine(), 'swords') : ctaButton('Sit down', () => sitDown(m), 'hand');
    } else if (n.step === 'pairings') {
      const mine = humanMatch(n);
      sum = mine?.b == null && mine ? h('span', null, 'Bye this round') : h('span', null, `${currentRound(n).length} table${currentRound(n).length === 1 ? '' : 's'} in play`);
      cta = ctaButton('Get results', () => collect(), 'clipboard');
    } else if (n.step === 'results') {
      if (n.phase === 'swiss') {
        sum = h('span', null, 'Results are in');
        cta = ctaButton('Post standings', () => {
          postStandings(n);
          saveNight(n);
          tab = 'standings';
          redraw();
          toTop();
        }, 'list');
      } else {
        const last = currentRound(n).length === 1;
        sum = last ? h('span', null, 'The final is over') : h('span', null, `${currentRound(n)[0].label}s are done`);
        cta = ctaButton(last ? 'Prize ceremony' : `Next: ${currentRound(n).length === 4 ? 'Semifinals' : 'Final'}`, () => next(), last ? 'trophy' : 'bracket');
      }
    } else if (n.step === 'standings') {
      const lastSwiss = n.rounds.length >= n.swissRounds;
      const st = humanStanding(n);
      sum = h('span', null, 'You are ', h('b', null, ordinal(st.rank)), ` at ${recordString(st)}`);
      cta = ctaButton(lastSwiss ? `Announce the Top ${n.topCut}` : `Post Round ${n.rounds.length + 1} pairings`, () => next(), lastSwiss ? 'trophy' : 'clipboard');
    }
    bar.replaceChildren(stickyBar(sum ? h('div', { class: 'lob-bar-sum' }, sum) : null, cta));
  }

  // ---------------------------------------------------------------- actions
  function sitDown(m: LocalsMatch) {
    markRevealed(n, m.id);
    saveNight(n);
    flipMatch = m.id;
    tab = 'round';
    redraw();
    requestAnimationFrame(() => el.querySelector('.lx-seat')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }

  function acceptId() {
    acceptIntentionalDraw(n);
    finishRound(n);
    saveNight(n);
    const m = humanMatch(n)!;
    const opp = opponentOf(n, m)!;
    recordMatch({ date: Date.now(), deckName: entrantOf(n, n.humanId)!.deck.name, oppName: opp.name, oppDeck: opp.deck.name, result: 'D', score: 'ID', context: `${n.shop.name} · Round ${m.round}` });
    animateRound = roundKey(currentRound(n));
    toast('Intentional draw reported. Hands shaken.', 'info');
    redraw();
    toTop();
  }

  function collect() {
    finishRound(n);
    saveNight(n);
    animateRound = roundKey(currentRound(n));
    tab = 'round';
    redraw();
    toTop();
  }

  function next() {
    const r = advance(n);
    if (r === 'done') finalizeNight(n);
    saveNight(n);
    if (r === 'round' || r === 'topcut' || r === 'top-round') postRound = roundKey(currentRound(n));
    tab = r === 'done' ? 'prizes' : r === 'topcut' ? 'bracket' : 'round';
    if (r === 'topcut') toast(inTopCut(n) ? `You made the Top ${n.topCut}!` : `Top ${n.topCut} is set. You just missed it.`, inTopCut(n) ? 'gold' : 'info', 3200);
    redraw();
    toTop();
  }

  async function playMine() {
    if (busy) return;
    const m = pendingHumanMatch(n);
    if (!m || m.b == null) return;
    busy = true;
    const s = getSettings();
    const me = entrantOf(n, n.humanId)!;
    const opp = opponentOf(n, m)!;
    const meA = m.a === n.humanId;
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
      resume: { kind: 'locals', key: duelKey(n, m), route: 'locals' },
    };
    try {
      const outcome = await runMatch(setup);
      const games = outcome.games.map((g) => (meA ? g : { ...g, winner: g.winner == null ? null : ((1 - g.winner) as 0 | 1) }));
      const res = outcome.result === 'draw' ? 'draw' : (outcome.result === 'a') === meA ? 'a' : 'b';
      recordHumanResult(n, games, res);
      finishRound(n);
      saveNight(n);
      animateRound = roundKey(currentRound(n));
      const wa = outcome.games.filter((g) => g.winner === 0).length;
      const wb = outcome.games.filter((g) => g.winner === 1).length;
      const my = outcome.result === 'a' ? 'W' : outcome.result === 'b' ? 'L' : 'D';
      const rated = recordConstructedResult(aiRating(opp.difficulty, opp.skill), my);
      recordMatch({ date: Date.now(), deckName: me.deck.name, oppName: opp.name, oppDeck: opp.deck.name, result: my, score: `${wa}-${wb}`, context: `${n.shop.name} · ${where}` });
      showResults({
        setup,
        outcome,
        human: 0,
        context: `Locals Night · ${where} · Rating ${rated.after} (${signed(rated.delta)})`,
        actions: [{ label: 'Back to the tables', variant: 'primary', icon: 'clipboard', onClick: () => go('locals', {}, { replace: true }) }],
      });
    } finally {
      busy = false;
    }
  }

  async function drop() {
    if (!(await confirmDialog('Drop from the event?', 'Your current match is conceded and the rest of the night plays out without you. You keep any prizes you have earned.', 'Drop', true))) return;
    dropHuman(n);
    finalizeNight(n);
    saveNight(n);
    tab = 'prizes';
    redraw();
    toTop();
  }

  function leave() {
    closeNight();
    go('locals', {}, { replace: true });
  }

  redraw();
  if (autoResume) {
    if (saved) setTimeout(() => void playMine(), 0);
    else toast('That duel can no longer be resumed.', 'error');
  }
  return {
    el,
    dispose: () => {
      clearInterval(interval);
      revealTimers.forEach(clearTimeout);
    },
  };
}

function seedOf(n: LocalsNight, id: string) {
  const first = n.top[0] ?? [];
  const order = n.topCut === 8 ? [0, 7, 3, 4, 1, 6, 2, 5] : [0, 3, 1, 2];
  const flat = first.flatMap((m) => [m.a, m.b]);
  const i = flat.indexOf(id);
  return i < 0 ? 0 : order[i] + 1;
}

/** The list behind the archetype: a pilot's placing list, or the build's own archetype line. */
export function listLine(deck: DeckSnapshot, label: string) {
  const m = deck.name.match(/^(.*) \((.+)\)$/);
  if (m) return `${m[1]} · ${m[2]}'s list`;
  if (deck.name !== label) return deck.name;
  if (deck.archetype !== label) return deck.archetype;
  return deck.tier === 1 ? 'Tier 1 build' : deck.tier === 2 ? 'Tier 2 build' : 'Rogue build';
}

// =================================================================== pairings / results sheet

function sheet(n: LocalsNight, round: LocalsMatch[], mode: 'pairings' | 'results') {
  const prior = n.phase === 'swiss' ? computeStandings({ entrants: n.entrants, rounds: n.rounds.slice(0, -1) }) : computeStandings(n);
  const pts = new Map(prior.map((x) => [x.id, x.mp]));
  const top = round[0]?.stage === 'top';
  const name = (id: string | null) => (id === n.humanId ? 'You' : (entrantOf(n, id)?.name ?? ''));
  const label = top ? round[0].label : `Round ${round[0]?.round ?? 1}`;
  const rows = [...round].sort((a, b) => (a.b == null ? 1 : 0) - (b.b == null ? 1 : 0) || a.table - b.table);
  const firstRound = !top && (round[0]?.round ?? 1) === 1;
  const sub = (id: string) => (top ? `#${seedOf(n, id)}` : firstRound ? '' : `${pts.get(id) ?? 0}`);
  const cell = (id: string | null, m: LocalsMatch, right = false) => {
    if (!id) return h('span', { class: ['lx-cell', 'is-bye', right && 'right'] }, h('span', { class: 'lx-cell-n' }, 'Bye'));
    const lost = mode === 'results' && m.result && m.result !== 'draw' && winnerOf(m) !== id;
    const won = mode === 'results' && winnerOf(m) === id;
    return h(
      'span',
      { class: ['lx-cell', right && 'right', id === n.humanId && 'is-me', lost && 'is-lost', won && 'is-won'] },
      h('span', { class: 'lx-cell-n' }, name(id)),
      h('span', { class: 'lx-cell-p' }, sub(id)),
    );
  };
  const mid = (m: LocalsMatch) => {
    if (mode === 'pairings' || !m.result) return h('span', { class: 'lx-mid' }, 'vs');
    if (m.b == null) return h('span', { class: 'lx-mid is-res' }, 'Bye');
    if (m.intentional) return h('span', { class: 'lx-mid is-res is-id' }, 'ID');
    const [wa, wb] = [m.games.filter((g) => g.winner === 0).length, m.games.filter((g) => g.winner === 1).length];
    return h('span', { class: ['lx-mid', 'is-res', m.result === 'draw' && 'is-draw'] }, m.time ? `${wa}–${wb} T` : `${wa}–${wb}`);
  };
  return h(
    'section',
    { class: ['lx-sheet', `lx-sheet--${mode}`], 'aria-label': `${mode === 'results' ? 'Results' : 'Pairings'}, ${label}` },
    h('span', { class: 'lx-tape lx-tape--l', 'aria-hidden': 'true' }),
    h('span', { class: 'lx-tape lx-tape--r', 'aria-hidden': 'true' }),
    h(
      'header',
      { class: 'lx-sheet-head' },
      h('div', { class: 'lx-sheet-title' }, h('b', null, mode === 'results' ? 'Results' : 'Pairings'), h('span', null, label)),
      h('div', { class: 'lx-sheet-meta' }, h('span', null, n.shop.name), h('span', null, n.dateLabel.replace(/^\w+, /, ''))),
    ),
    h('div', { class: ['lx-sheet-cols', firstRound && 'no-pts'], 'aria-hidden': 'true' }, h('span', null, 'Tbl'), h('span', null, 'Player'), h('span', null, top ? 'Seed' : 'Pts'), h('span', null, ''), h('span', null, top ? 'Seed' : 'Pts'), h('span', { class: 'right' }, 'Opponent')),
    h(
      'div',
      { class: 'lx-rows' },
      rows.map((m) => {
        const mine = involves(m, n.humanId);
        return h(
          'div',
          { class: ['lx-row', mine && 'is-mine'], dataset: mode === 'results' && !mine ? { pending: '1' } : undefined },
          h('span', { class: 'lx-tbl' }, m.b == null ? '—' : String(m.table)),
          cell(m.a, m),
          mid(m),
          cell(m.b, m, true),
        );
      }),
    ),
    h('footer', { class: 'lx-sheet-foot' }, mode === 'results' ? 'T = time called · ID = intentional draw' : top ? 'Single elimination · Best of 3 · Higher seed chooses to go first' : 'Best of 3 · Report results to the judge table'),
  );
}

// =================================================================== standings

function standingsView(n: LocalsNight) {
  const st = computeStandings(n);
  const played = n.rounds.filter((r) => r.every((m) => m.result != null)).length;
  if (!played)
    return h('div', { class: 'lx-empty' }, icon('list'), h('b', null, 'No standings yet'), h('span', null, 'Standings go up after round one.'));
  const pctTxt = (x: number) => (x * 100).toFixed(1);
  const cutAfter = n.phase === 'swiss' ? n.topCut : 0;
  const cutIds = new Set(n.top[0]?.flatMap((m) => [m.a, m.b]) ?? []);
  const rows: HTMLElement[] = [];
  let eligible = 0;
  st.forEach((s: LocalsStanding) => {
    const e = entrantOf(n, s.id)!;
    if (!s.dropped) eligible++;
    const deck = knownDeck(n, s.id) ? deckLabel(e) : null;
    rows.push(
      h(
        'div',
        { class: ['lx-st-row', s.id === n.humanId && 'is-me', s.dropped && 'is-drop', cutIds.has(s.id) && 'is-cut'] },
        h('span', { class: 'lx-st-rank' }, String(s.rank)),
        h(
          'span',
          { class: 'lx-st-name' },
          h('b', null, s.id === n.humanId ? `${e.name} (you)` : e.name),
          (() => {
            const line = s.dropped ? 'Dropped' : [deck, e.regular ? 'Regular' : null].filter(Boolean).join(' · ');
            return line ? h('span', null, line) : null;
          })(),
        ),
        h('span', { class: 'lx-st-rec' }, recordString(s)),
        h('span', { class: 'lx-st-pts' }, String(s.mp)),
        h('span', { class: 'lx-st-tb' }, pctTxt(s.omw)),
        h('span', { class: 'lx-st-tb' }, pctTxt(s.oomw)),
      ),
    );
    if (cutAfter && eligible === cutAfter && !s.dropped) rows.push(h('div', { class: 'lx-cutline' }, h('span', null, `Top ${n.topCut} cut`)));
  });
  return h(
    'section',
    { class: 'lx-standings' },
    h('div', { class: 'lx-st-caption' }, n.phase === 'swiss' ? `After round ${played} of ${n.swissRounds}` : 'Final Swiss standings', h('span', null, 'OMW% and OOMW% break ties')),
    h(
      'div',
      { class: 'lx-st-table', role: 'table' },
      h('div', { class: 'lx-st-row lx-st-hd', role: 'row' }, h('span', { class: 'lx-st-rank' }, '#'), h('span', { class: 'lx-st-name' }, 'Player'), h('span', { class: 'lx-st-rec' }, 'Rec'), h('span', { class: 'lx-st-pts' }, 'Pts'), h('span', { class: 'lx-st-tb' }, 'OMW'), h('span', { class: 'lx-st-tb' }, 'OOMW')),
      rows,
    ),
  );
}

// =================================================================== bracket

function bracketView(n: LocalsNight) {
  if (!n.top.length) return h('div', { class: 'lx-empty' }, icon('bracket'), h('b', null, 'Top cut after Swiss'), h('span', null, `The Top ${n.topCut} is single elimination, best of 3.`));
  const labels = n.topCut === 8 ? ['Quarterfinals', 'Semifinals', 'Final'] : ['Semifinals', 'Final'];
  const rounds = labels.map((label, i) => ({ label, ms: n.top[i] ?? null }));
  const slot = (id: string | null, m: LocalsMatch | null, i: number) => {
    if (!id) return h('div', { class: 'lx-br-slot is-tbd' }, h('span', { class: 'lx-br-seed' }, ''), h('span', { class: 'lx-br-name' }, 'TBD'));
    const e = entrantOf(n, id)!;
    const won = m && winnerOf(m) === id;
    const lost = m && m.result && !won;
    const score = m && m.result ? scoreFor(m, id).split('-')[0] : '';
    void i;
    return h(
      'div',
      { class: ['lx-br-slot', id === n.humanId && 'is-me', won && 'is-won', lost && 'is-lost'] },
      h('span', { class: 'lx-br-seed' }, String(seedOf(n, id))),
      avatar(e, 26),
      h('span', { class: 'lx-br-name' }, h('b', null, id === n.humanId ? 'You' : e.name), h('span', null, deckLabel(e))),
      h('span', { class: 'lx-br-score' }, score),
    );
  };
  const champ = n.phase === 'done' && n.placements ? entrantOf(n, n.placements[0]) : null;
  return h(
    'section',
    { class: 'lx-bracket' },
    champ
      ? h('div', { class: 'lx-champ' }, icon('trophy'), h('div', null, h('span', { class: 'lx-k' }, 'Champion'), h('b', null, champ.human ? 'You' : champ.name), h('span', null, deckLabel(champ))))
      : null,
    rounds.map((r, ri) => {
      const count = (n.topCut >> (ri + 1)) || 1;
      const ms = r.ms ?? Array.from({ length: count }, () => null);
      return h(
        'div',
        { class: 'lx-br-round' },
        h('h3', { class: 'lx-br-h' }, r.label, r.ms && r.ms.every((m) => m.result) ? h('span', null, 'Complete') : r.ms ? h('span', { class: 'is-live' }, 'In progress') : null),
        h(
          'div',
          { class: 'lx-br-grid' },
          ms.map((m, i) =>
            h('div', { class: ['lx-br-match', m && (involves(m, n.humanId)) && 'has-me'] }, slot(m?.a ?? null, m, i), slot(m?.b ?? null, m, i)),
          ),
        ),
      );
    }),
  );
}

// =================================================================== prize ceremony

function ceremonyView(n: LocalsNight) {
  const place = placeOf(n);
  const me = entrantOf(n, n.humanId)!;
  const st = humanStanding(n);
  const champ = entrantOf(n, n.placements?.[0])!;
  const lines = n.prizes ?? [];
  const totals = prizeTotals(lines);
  const cut = inTopCut(n);
  const headline = place === 1 ? 'Champion' : cut ? (place === 2 ? 'Finalist' : place <= 4 ? 'Top 4' : 'Top 8') : st.l <= 1 && me.dropped == null ? 'X-1 finish' : 'Thanks for playing';
  const art = deckArtEl(me.deck, 'lx-cer-art');
  const packs = Math.min(totals.packs, 12);
  return h(
    'section',
    { class: ['lx-ceremony', place === 1 && 'is-champ'] },
    h(
      'div',
      { class: 'lx-cer-hero' },
      art,
      h('span', { class: 'lx-cer-shade' }),
      h(
        'div',
        { class: 'lx-cer-body' },
        h('span', { class: 'lx-k' }, headline),
        h('div', { class: 'lx-cer-place' }, h('b', null, placeText(place)), h('span', null, `of ${n.size}`)),
        h('div', { class: 'lx-cer-line' }, `${me.deck.name} · Swiss ${recordString(st)}${cut ? ` · Top ${n.topCut}` : ''}`),
      ),
    ),
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
      h(
        'div',
        { class: 'lx-cer-lines' },
        lines.map((l) => h('div', { class: 'lx-cer-row' }, h('span', null, l.reason.replace(/^Locals Night · /, '')), h('span', null, [l.packs ? `${l.packs} packs` : '', l.coins ? `${l.coins} DP` : ''].filter(Boolean).join(' · ')))),
      ),
    ),
    h(
      'div',
      { class: 'lx-cer-champ' },
      avatar(champ, 40),
      h('div', null, h('span', { class: 'lx-k' }, `Champion · ${n.shop.name}`), h('b', null, champ.human ? 'You' : champ.name), h('span', null, `${deckLabel(champ)} · ${listLine(champ.deck, deckLabel(champ))}`)),
    ),
    topEightDecks(n),
  );
}

/** "Decklists posted": the top cut's decks, as the store would pin them up. */
function topEightDecks(n: LocalsNight) {
  const ids = (n.placements ?? []).slice(0, n.topCut);
  return lobbySection(
    `Top ${n.topCut} decks`,
    null,
    h(
      'div',
      { class: 'lx-t8' },
      ids.map((id, i) => {
        const e = entrantOf(n, id)!;
        return h(
          'div',
          { class: ['lx-t8-row', id === n.humanId && 'is-me'] },
          h('span', { class: 'lx-t8-place' }, i < 2 ? ordinal(i + 1) : i < 4 ? 'T4' : 'T8'),
          deckArtEl(e.deck, 'lx-t8-art'),
          h('span', { class: 'lx-t8-name' }, h('b', null, e.human ? 'You' : e.name), h('span', null, deckLabel(e))),
        );
      }),
    ),
  );
}

// =================================================================== history

function historyScreen(): Screen {
  const hs = loadHistory();
  const rivals = loadRivals();
  const best = hs.length ? Math.min(...hs.map((x) => x.place)) : null;
  const tops = hs.filter((x) => x.madeCut).length;
    const packs = hs.reduce((a, x) => a + x.packs, 0);
  const stat = (v: string, k: string) => h('div', { class: 'lx-stat' }, h('b', null, v), h('span', null, k));
  const el = frame(
    'Past Nights',
    { eyebrow: 'Locals Night', cls: 'lobby-screen lx-screen lx-history', backTo: () => go('locals'), backLabel: 'Locals' },
    h('div', { class: 'lx-stats' }, stat(String(hs.length), 'Nights'), stat(best ? placeText(best) : '—', 'Best finish'), stat(String(tops), 'Top cuts'), stat(String(packs), 'Packs')),
    lobbySection(
      'The regulars',
      h('span', { class: 'lob-count' }, 'Your record'),
      h(
        'div',
        { class: 'lob-group lx-rivals' },
        REGULARS.map((r) => {
          const rec = rivals[r.id];
          const n = rec ? rec.w + rec.l + rec.d : 0;
          return h(
            'div',
            { class: 'lx-rival-row' },
            avatar(r, 40),
            h('span', { class: 'lx-rival-name' }, h('b', null, r.name), h('span', null, `${metaInfo(r.meta).label === 'Rogue' ? 'Rogue decks' : metaInfo(r.meta).label} · ${r.title}`)),
            h('span', { class: ['lx-rival-rec', n > 0 && rec.w > rec.l && 'is-up', n > 0 && rec.w < rec.l && 'is-down'] }, n ? `${rec.w}-${rec.l}${rec.d ? `-${rec.d}` : ''}` : '—'),
          );
        }),
      ),
    ),
    lobbySection(
      'Your nights',
      null,
      hs.length
        ? h(
            'div',
            { class: 'lob-group lx-nights' },
            hs.map((x) =>
              h(
                'div',
                { class: 'lx-night-row' },
                h('span', { class: ['lx-night-place', x.place === 1 && 'is-first', x.madeCut && 'is-cut'] }, placeText(x.place)),
                h('span', { class: 'lx-night-main' }, h('b', null, x.shop), h('span', null, `${x.dateLabel.replace(/, 2010$/, '')} · ${x.size} players`), h('span', null, `${x.deckName} · ${x.record}${x.madeCut ? ` · Top ${x.topCut}` : ''}`)),
                h('span', { class: 'lx-night-prize' }, x.packs ? `${x.packs} packs` : `${x.coins} DP`),
              ),
            ),
          )
        : h('div', { class: 'lx-empty' }, icon('scroll'), h('b', null, 'No nights yet'), h('span', null, 'Check in on Friday and your placings land here.')),
    ),
  );
  return { el };
}

