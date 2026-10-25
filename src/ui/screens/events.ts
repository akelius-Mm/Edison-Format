// Events hub (route `events`): every 2010 Organized Play event, playable any time, plus the
// optional Circuit season on top. Views: hub (default), check-in (?view=checkin&kind= or
// &event= for a season event), live event (?view=run), season (?view=season) and circuit
// standings (?view=standings). Engine in src/events; the live event screen is eventRun.ts.
import { loadActiveNight } from '../../locals';
import { REGULARS } from '../../locals/regulars';
import { metaLabel } from '../../locals/meta';
import { deckById } from '../../decks';
import { loadActiveTournament, currentRoundLabel } from '../../tournament/tournament';
import {
  BEST_OF,
  CIRCUIT_INVITE_RANK,
  EVENT_KINDS,
  EVENT_SPECS,
  INVITE_DEADLINE_WEEK,
  NATIONALS_WEEK,
  PRIZES,
  RANK_WINDOW,
  SEASON_WEEKS,
  SJC_INVITE_CUT,
  YOU,
  abandonSeason,
  advanceBlocked,
  advanceWeek,
  attendeesFor,
  canEnter,
  circuitStandings,
  countingRows,
  createEvent,
  eventDate,
  eventsThisWeek,
  formatLine,
  loadActiveEvent,
  loadRatings,
  loadSeason,
  nextStandaloneNumber,
  regionalInviteCut,
  roundLabel,
  saveEvent,
  standaloneDate,
  startSeason,
  startSeasonEvent,
  swissRoundsFor,
  topCutFor,
  venueFor,
  yourRow,
  type EventKind,
  type Season,
  type SeasonEvent,
  type CircuitRow,
} from '../../events';
import { getSettings, loadJSON, saveJSON } from '../settings';
import { artInto, ctaButton, deckShelf, iosGroup, iosNav, linkButton, lobbySection, stickyBar } from './components';
import { confirmDialog, h, icon, segmented, toast, type Child } from './dom';
import { reconcileActiveDuel } from '../duel/resume';
import { eventRunScreen } from './eventRun';
import { AVATAR_PRESETS, SLEEVES } from './ext';
import { avatar, packIcon } from './locals';
import { frame, go, type Screen } from './nav';
import { allDeckInfos, ordinal, type DeckInfo } from './store';
import type { DeckSnapshot } from '../../locals/types';
import './locals.css';
import './events.css';

const FORM_KEY = 'edison.events.form.v1';

interface CheckInForm {
  deck: string | null;
  sizes?: Partial<Record<EventKind, number>>;
}

export function eventsScreen(params: Record<string, string>): Screen {
  const run = loadActiveEvent();
  if (!run) reconcileActiveDuel('events', null);
  if (params.resume) history.replaceState(null, '', `#/events${params.view ? `?view=${params.view}` : ''}`);
  switch (params.view) {
    case 'run':
      return run ? eventRunScreen(run, params.resume === '1') : hubScreen();
    case 'checkin':
      return checkInScreen(params);
    case 'season': {
      const s = loadSeason();
      return s ? seasonScreen(s) : hubScreen();
    }
    case 'standings': {
      const s = loadSeason();
      return s ? standingsScreen(s) : hubScreen();
    }
    default:
      return hubScreen();
  }
}

// =================================================================== small pieces

const KIND_ICON = (k: EventKind) => EVENT_SPECS[k].icon;

function kindArt(k: EventKind) {
  const el = h('span', { class: 'ev-kind-art', 'aria-hidden': 'true' }, icon(KIND_ICON(k)));
  return artInto(el, EVENT_SPECS[k].art);
}

function kindDesc(k: EventKind) {
  const s = EVENT_SPECS[k];
  const sizes = s.sizes;
  const rounds = [...new Set(sizes.map((n) => swissRoundsFor(k, n)))];
  const cuts = [...new Set(sizes.map((n) => topCutFor(k, n)))];
  // non-breaking spaces keep each fact on one line when the row wraps
  return [`${s.sizeRange}\u00a0players`, `${rounds.join('–')}\u00a0rounds`, `Top\u00a0${cuts.join('/')}`].join('\u00a0· ');
}

function inviteTags(inv: { nationals?: string } | undefined) {
  return [
    inv?.nationals ? h('span', { class: 'ev-tag is-gold' }, icon('medal'), 'Nationals') : null,
  ];
}

function weekRange(week: number) {
  const fri = eventDate('locals', week).label.replace(/^\w+, /, '').replace(/, 2010$/, '');
  return `Week of ${fri}`;
}

// =================================================================== hub

function hubScreen(): Screen {
  const run = loadActiveEvent();
  const season = loadSeason();
  const night = loadActiveNight();
  const practice = loadActiveTournament();
  const ratings = loadRatings();

  const resume: Child[] = [];
  if (run)
    resume.push(
      h(
        'button',
        { type: 'button', class: 'ev-resume', onclick: () => go('events', { view: 'run' }) },
        icon(KIND_ICON(run.kind)),
        h('span', { class: 'ev-resume-text' }, h('b', null, run.phase === 'done' ? 'Collect your prizes' : 'Resume event'), h('span', null, `${run.title} · ${roundLabel(run)}`)),
        icon('play'),
      ),
    );
  if (night && !run)
    resume.push(
      h(
        'button',
        { type: 'button', class: 'ev-resume', onclick: () => go('locals') },
        icon('clipboard'),
        h('span', { class: 'ev-resume-text' }, h('b', null, 'Resume Locals Night'), h('span', null, night.shop.name)),
        icon('play'),
      ),
    );

  const el = frame(
    'Events',
    { eyebrow: 'Organized Play · Spring 2010', cls: 'lobby-screen ev-screen ev-hub' },
    resume,
    circuitCard(season),
    iosGroup(
      'Events',
      [
        eventRow('locals', 'Locals Night', 'Friday at the card shop\u00a0· 16–32\u00a0players\u00a0· Top\u00a04/8', () => go('locals'), night ? 'In progress' : undefined),
        ...EVENT_KINDS.filter((k) => k !== 'locals').map((k) => eventRow(k, EVENT_SPECS[k].label, kindDesc(k), () => go('events', { view: 'checkin', kind: k }), run?.kind === k && !run.season ? 'In progress' : undefined)),
      ],
      'Every event is open any time as a one-off. Bigger events bring stronger fields: more real SJC lists, higher-tier decks and harder AI.',
    ),
    iosGroup('Practice', [
      iosNav('Tournament', () => go('tournament'), {
        icon: 'trophy',
        desc: practice ? `In progress · ${currentRoundLabel(practice)}` : 'Custom Swiss + top cut, your field size and AI mix',
      }),
    ]),
    iosGroup(
      'You',
      [
        iosNav('Profile', () => go('profile'), {
          icon: 'user',
          desc: 'Ratings, trophies, rivals and event history',
          detail: String(ratings.constructed.rating),
        }),
      ],
      'Event matches you play count toward your Constructed rating. Auto-played matches and intentional draws do not.',
    ),
  );
  return { el };
}

function eventRow(k: EventKind, label: string, desc: string, onClick: () => void, badge?: string) {
  return h(
    'button',
    { type: 'button', class: 'ios-row ios-row--nav ev-row', onclick: onClick },
    kindArt(k),
    h('span', { class: 'ios-row-text' }, h('span', { class: 'ios-label' }, label), h('span', { class: 'ios-desc' }, desc)),
    badge ? h('span', { class: 'ev-tag is-gold' }, badge) : null,
    icon('chevron', 'icon ios-chev'),
  );
}

function ladder(active?: EventKind) {
  const items: [EventKind, string][] = [
    ['locals', 'Locals'],
    ['regional', 'Regionals'],
    ['sjc', 'SJC'],
    ['nationals', 'Nationals'],
  ];
  return h(
    'ol',
    { class: 'ev-ladder', 'aria-label': 'The 2010 Organized Play ladder' },
    items.map(([k, l]) => h('li', { class: [active === k && 'is-on'] }, h('span', { class: 'ev-ladder-dot' }, icon(KIND_ICON(k))), h('span', null, l))),
  );
}

function circuitCard(s: Season | null) {
  if (!s)
    return h(
      'section',
      { class: 'ev-circuit', 'aria-label': 'The Circuit' },
      h('div', { class: 'ev-circuit-eyebrow' }, 'The Circuit · Optional'),
      h('h2', null, 'Play a 12-week season'),
      h('p', null, `Locals every Friday, Regional Qualifiers, an SJC mid-season, then an invite-only Nationals to close it out. Your rank counts your best ${BEST_OF} results from the last ${RANK_WINDOW} weeks, so every week you need to prove yourself.`),
      ladder(),
      ctaButton('Start a season', () => void begin(), 'flag'),
    );
  if (s.done && s.summary)
    return h(
      'section',
      { class: 'ev-circuit', 'aria-label': 'The Circuit' },
      h('div', { class: 'ev-circuit-eyebrow' }, `Season ${s.number} · Complete`),
      h('h2', null, s.summary.score ? `Finished ${ordinal(s.summary.finalRank)} of ${s.summary.field}` : 'Finished unranked'),
      h('p', null, `${s.summary.score} circuit points · ${s.summary.trophies.length} trophies`),
      h('div', { class: 'ev-circuit-tags', style: { marginTop: '12px' } }, inviteTags(s.summary.invites)),
      h('div', { class: 'lx-bar-row' }, h('button', { type: 'button', class: 'lx-btn', onclick: () => go('events', { view: 'season' }) }, 'Season recap'), h('button', { type: 'button', class: 'lx-btn', onclick: () => void begin(true) }, 'New season')),
    );
  const me = yourRow(s);
  const thisWeek = eventsThisWeek(s);
  const big = thisWeek.find((e) => e.kind !== 'locals');
  return h(
    'section',
    { class: 'ev-circuit', 'aria-label': 'Your season' },
    h('div', { class: 'ev-circuit-eyebrow' }, `Season ${s.number} · ${weekRange(s.week)}`),
    h('h2', null, `Week ${s.week} of ${SEASON_WEEKS}`),
    h('p', null, big ? `This week: Locals and ${big.title}.` : 'This week: Locals.'),
    h(
      'div',
      { class: 'ev-circuit-stats' },
      h('div', null, h('b', null, me.score ? ordinal(me.rank) : '—'), h('span', null, `of ${circuitStandings(s).length}`)),
      h('div', null, h('b', null, String(me.score)), h('span', null, `Pts · ${RANK_WINDOW} wk`)),
      h('div', null, h('b', null, String(loadRatings().constructed.rating)), h('span', null, 'Rating')),
    ),
    s.invites[YOU]?.nationals ? h('div', { class: 'ev-circuit-tags' }, inviteTags(s.invites[YOU])) : null,
    ctaButton('Open season', () => go('events', { view: 'season' }), 'flag'),
  );
}

async function begin(replace = false) {
  const cur = loadSeason();
  if (cur && !cur.done && !(await confirmDialog('Start a new season?', `Season ${cur.number} is in week ${cur.week}. Starting over ends it without a final ranking.`, 'Start over', true))) return;
  if (cur && !cur.done) abandonSeason();
  void replace;
  startSeason();
  toast('Season started. Week 1: Friday Locals.', 'gold');
  go('events', { view: 'season' });
}

// =================================================================== check-in

function checkInScreen(params: Record<string, string>): Screen {
  const season = params.event ? loadSeason() : null;
  const sev = season?.events.find((e) => e.id === params.event) ?? null;
  const kind = (sev?.kind ?? (EVENT_KINDS.includes(params.kind as EventKind) ? params.kind : 'regional')) as EventKind;
  const spec = EVENT_SPECS[kind];
  const decks = allDeckInfos();
  const form = loadJSON<CheckInForm>(FORM_KEY, { deck: null });
  let deckKey = form.deck && decks.some((d) => d.key === form.deck) ? form.deck : (decks.find((d) => d.ref.kind === 'premade' && !d.problems.length)?.key ?? null);
  let size = sev?.size ?? (form.sizes?.[kind] && spec.sizes.includes(form.sizes[kind]!) ? form.sizes[kind]! : spec.defaultSize);
  const number = nextStandaloneNumber(kind);
  const venue = sev ? { ...venueFor(kind, kind === 'locals' ? `${season!.seed}-${sev.week}` : sev.id), name: sev.title, city: sev.city } : venueFor(kind, String(number));
  const date = sev ? { iso: sev.date, label: sev.dateLabel } : standaloneDate(kind, number);
  const persist = () => saveJSON(FORM_KEY, { deck: deckKey, sizes: { ...(form.sizes ?? {}), ...(sev ? {} : { [kind]: size }) } } satisfies CheckInForm);

  const facts = h('div', { class: 'lx-facts' });
  const formatEl = h('div', { class: 'lx-flyer-format' });
  const fact = (k: string, v: string, sub: string) => h('div', { class: 'lx-fact' }, h('span', { class: 'lx-fact-k' }, k), h('b', { class: 'lx-fact-v' }, v), h('span', { class: 'lx-fact-s' }, sub));
  const drawFacts = () => {
    const [wd, md] = date.label.split(', ');
    facts.replaceChildren(fact(wd.slice(0, 3), md, '2010'), fact('Players', String(size), spec.inviteOnly ? 'Invitation only' : size >= 384 ? 'Two-day open' : 'Open'), fact('Rounds', String(swissRoundsFor(kind, size)), `Top ${topCutFor(kind, size)} cut`));
    formatEl.replaceChildren(h('span', null, formatLine(kind, size)), h('span', null, 'Best of 3'), h('span', null, `${spec.roundMinutes}-min rounds`), sev ? h('span', null, `Season week ${sev.week}`) : h('span', null, 'One-off'));
  };
  drawFacts();

  const flyer = h(
    'section',
    { class: 'lx-flyer', 'aria-label': 'The event' },
    h('div', { class: 'lx-flyer-eyebrow' }, h('span', null, spec.label.length > 20 ? spec.short : spec.label), h('span', { class: 'lx-dot' }), h('span', null, 'Edison Format')),
    h('h2', { class: 'lx-flyer-shop' }, kind === 'sjc' || !venue.city ? venue.name : venue.city),
    h('div', { class: 'lx-flyer-where' }, venue.where),
    facts,
    formatEl,
    h('p', { class: 'lx-flyer-blurb' }, venue.blurb),
  );

  const sizePicker =
    !sev && spec.sizes.length > 1
      ? lobbySection(
          'Field size',
          h('span', { class: 'lob-count' }, spec.sizeRange),
          segmented<number>(
            spec.sizes.map((n) => ({ value: n, label: String(n), hint: formatLine(kind, n) })),
            size,
            (v) => {
              size = v;
              persist();
              drawFacts();
              drawBar();
            },
            'Field size',
          ),
        )
      : null;

  // who is coming: circuit duelists for season events; a preview of the tier otherwise
  let notable: Child = null;
  if (season && sev) {
    const att = attendeesFor(season, sev, true)
      .slice()
      .sort((a, b) => Number(!!b.regular) - Number(!!a.regular) || b.rating - a.rating)
      .slice(0, 10);
    const st = circuitStandings(season);
    const rankOf = new Map(st.map((r) => [r.id, r.rank]));
    notable = lobbySection(
      kind === 'locals' ? 'Regulars and locals tonight' : 'Circuit players registered',
      h('span', { class: 'lob-count' }, 'Circuit rank'),
      h(
        'div',
        { class: 'ev-notables' },
        att.map((d) => {
          const deck = deckById(d.deckId);
          const pts = st.find((r) => r.id === d.id)?.score ?? 0;
          return h(
            'div',
            { class: 'lx-reg', title: d.blurb ?? d.title },
            avatar(d, 48),
            h('b', { class: 'lx-reg-name' }, d.name.split(' ')[0] === 'Big' ? 'Big Dave' : d.name.split(' ')[0]),
            h('span', { class: 'lx-reg-deck' }, metaLabel(d.meta, deck)),
            h('span', { class: ['lx-reg-rec', pts > 0 && 'has'] }, pts > 0 ? `#${rankOf.get(d.id)}` : 'Unranked'),
          );
        }),
      ),
    );
  }

  const t = PRIZES[kind];
  const prizeRows = [
    ...t.cut.filter((b) => b.upTo <= Math.max(...spec.sizes.map((n) => topCutFor(kind, n)))).map((b) => prizeLine(b.label, b.packs, b.coins, sev ? b.points : null)),
    prizeLine(`${t.x.label}`, t.x.packs, t.x.coins, sev ? t.x.points : null, 'If you miss the cut'),
    prizeLine('Everyone', t.participation.packs, t.participation.coins, sev ? t.participation.points : null, 'For playing'),
  ];
  const inviteNote =
    kind === 'regional'
      ? `Top ${regionalInviteCut(size)} earn a Nationals invite during a season.`
      : kind === 'sjc'
        ? `Top ${SJC_INVITE_CUT} earn a Nationals invite during a season.`
        : null;

  const summary = h('div', { class: 'lob-bar-sum' });
  const drawBar = () => {
    const d = decks.find((x) => x.key === deckKey);
    summary.replaceChildren(d ? h('span', null, 'Playing ', h('b', null, d.name)) : h('span', null, 'Choose a deck'), h('span', null, ` · ${size} players`));
  };
  drawBar();

  const blocked = sev && season && !canEnter(season, sev);
  const el = frame(
    sev ? spec.short : spec.label,
    {
      eyebrow: sev ? `Season ${season!.number} · Week ${sev.week}` : `${date.label.replace(/, 2010$/, '')}`,
      cls: 'lobby-screen lx-screen ev-screen ev-checkin',
      backTo: () => go('events', sev ? { view: 'season' } : {}),
      backLabel: sev ? 'Season' : 'Events',
    },
    flyer,
    sizePicker,
    lobbySection('Your deck', linkButton('Deck Builder', () => go('deck-builder')), deckShelf(decks, deckKey, (d) => ((deckKey = d?.key ?? null), persist(), drawBar()), { label: 'Your deck' })),
    notable,
    lobbySection(sev ? 'Prizes and circuit points' : 'Prize support', null, h('div', { class: 'lx-prize-list' }, prizeRows)),
    inviteNote ? h('p', { class: 'ev-points-note', style: { marginTop: '-14px' } }, inviteNote) : null,
    stickyBar(summary, blocked ? h('div', { class: 'lob-bar-sum' }, 'This event is not open to you this week.') : ctaButton('Check in', () => void checkIn(), 'clipboard')),
  );

  async function checkIn() {
    const info: DeckInfo | undefined = decks.find((d) => d.key === deckKey);
    if (!info) return toast('Choose your deck first.', 'error');
    const active = loadActiveEvent();
    if (active && active.phase !== 'done') {
      toast(`Finish or drop from ${active.title} first.`, 'error');
      return go('events', { view: 'run' });
    }
    if (info.problems.length && !(await confirmDialog('Deck is not tournament legal', `${info.name}: ${info.problems.slice(0, 2).join(' ')} Check in anyway?`, 'Check in anyway'))) return;
    const s = getSettings();
    const deck: DeckSnapshot = { id: info.key, name: info.name, archetype: info.archetype, tier: info.tier, color: info.color, main: info.main, extra: info.extra };
    const human = { name: s.playerName || 'You', avatar: s.avatar, sleeve: s.sleeve, deck };
    const sleeves = SLEEVES.map((x) => x.id);
    const avatars = AVATAR_PRESETS.filter((a) => a !== s.avatar);
    const run =
      sev && season
        ? startSeasonEvent(season, sev.id, human, sleeves, avatars)
        : createEvent({ kind, size, human, sleeves, avatars, number, venue, date });
    if (!run) return toast('Could not check in to this event.', 'error');
    saveEvent(run);
    go('events', { view: 'run' }, { replace: true });
  }

  return { el };
}

function prizeLine(label: string, packs: number, coins: number, points: number | null, note?: string) {
  return h(
    'div',
    { class: 'lx-prize-row' },
    h('span', { class: 'lx-prize-k' }, h('b', null, label), note ? h('span', null, note) : null),
    h(
      'span',
      { class: 'lx-prize-v' },
      packs ? h('span', { class: 'lx-packs-mini' }, packIcon(), `${packs}`) : null,
      h('span', { class: 'lx-dp' }, `${coins} DP`),
      points != null ? h('span', { class: 'ev-tag is-gold' }, `${points} pts`) : null,
    ),
  );
}

// =================================================================== season

function seasonScreen(s: Season): Screen {
  if (s.done) return seasonSummaryScreen(s);
  const me = yourRow(s);
  const st = circuitStandings(s);
  const run = loadActiveEvent();
  const runHere = run && run.season?.seasonId === s.id ? run : null;
  const week = eventsThisWeek(s);

  const progress = h(
    'div',
    { class: 'ev-progress', 'aria-hidden': 'true' },
    Array.from({ length: SEASON_WEEKS }, (_, i) => {
      const w = i + 1;
      return h('span', { class: [w < s.week && 'is-past', w === s.week && 'is-now'] });
    }),
  );
  const head = h(
    'section',
    { class: 'ev-week' },
    h(
      'div',
      { class: 'ev-week-top' },
      h('div', null, h('div', { class: 'ev-week-k' }, weekRange(s.week)), h('h2', { class: 'ev-week-title' }, `Week ${s.week} of ${SEASON_WEEKS}`), h('div', { class: 'ev-week-date' }, week.map((e) => `${EVENT_SPECS[e.kind].short} ${e.dateLabel.slice(0, 3)}`).join(' · '))),
      h('span', { class: ['lx-pill', me.score > 0 && me.rank <= CIRCUIT_INVITE_RANK && 'is-gold'] }, me.score ? `${ordinal(me.rank)} · ${me.score} pts` : 'Unranked'),
    ),
    progress,
  );

  const cards = week.map((ev) => weekCard(s, ev, runHere));

  const counting = countingRows(s.points[YOU], s.week);
  const countingGroup = iosGroup(
    `Your best ${BEST_OF} · last ${RANK_WINDOW} weeks`,
    counting.length
      ? counting.map((r) => {
          const ev = s.events.find((e) => e.id === r.e);
          const drop = r.w + RANK_WINDOW;
          return h(
            'div',
            { class: 'ios-row' },
            h('span', { class: 'ios-icon' }, icon(KIND_ICON(r.k))),
            h('span', { class: 'ios-row-text' }, h('span', { class: 'ios-label' }, ev?.title ?? r.e), h('span', { class: 'ios-desc' }, `Week ${r.w} · ${ordinal(r.p)} · ${drop <= SEASON_WEEKS ? `drops off after week ${drop - 1}` : 'counts to the end'}`)),
            h('span', { class: 'ev-circ-pts' }, String(r.pts)),
          );
        })
      : [h('div', { class: 'ios-row' }, h('span', { class: 'ios-row-text' }, h('span', { class: 'ios-label' }, 'No points yet'), h('span', { class: 'ios-desc' }, 'Play this week’s Locals to get on the board.')))],
    s.week < RANK_WINDOW ? `Each result counts for ${RANK_WINDOW} weeks, then drops off. Keep playing to stay ranked.` : `Only results from weeks ${s.week - RANK_WINDOW + 1}–${s.week} count. Older results have dropped off.`,
  );

  const inv = s.invites[YOU] ?? {};
  const inviteGroup = iosGroup(
    'Invites',
    [
      h(
        'div',
        { class: 'ios-row' },
        h('span', { class: 'ios-icon' }, icon('medal')),
        h('span', { class: 'ios-row-text' }, h('span', { class: 'ios-label' }, `Nationals · week ${NATIONALS_WEEK}`), h('span', { class: 'ios-desc' }, inv.nationals ?? `Regional Top 8/16, SJC Top ${SJC_INVITE_CUT}, or circuit Top ${CIRCUIT_INVITE_RANK} after week ${INVITE_DEADLINE_WEEK}`)),
        h('span', { class: ['ev-tag', inv.nationals ? 'is-gold' : 'is-lock'] }, inv.nationals ? 'Invited' : 'Not yet'),
      ),
    ],
  );

  const around = standingsSlice(st, 5);
  const standingsGroup = h(
    'section',
    { class: 'ios-group' },
    h('header', { class: 'lob-h', style: { margin: '0 0 7px 16px' } }, h('h2', { class: 'ios-group-h', style: { margin: '0' } }, 'Circuit standings'), linkButton(`All ${st.length}`, () => go('events', { view: 'standings' }))),
    h('div', { class: 'ios-list' }, around),
  );

  const calendar = iosGroup(
    'Calendar',
    Array.from({ length: SEASON_WEEKS }, (_, i) => {
      const w = i + 1;
      const evs = s.events.filter((e) => e.week === w);
      const big = evs.find((e) => e.kind !== 'locals');
      const loc = evs.find((e) => e.kind === 'locals');
      const mine = evs.filter((e) => e.status === 'played' && e.result);
      return h(
        'div',
        { class: ['ios-row', 'ev-cal-row', w === s.week && 'is-now', w < s.week && 'is-past'] },
        h('span', { class: 'ev-cal-wk' }, `W${w}`),
        h(
          'span',
          { class: 'ios-row-text' },
          h('span', { class: 'ios-label' }, big ? big.title : (loc?.title ?? 'Locals'), big?.kind === 'nationals' ? h('span', { class: 'ev-tag is-lock' }, icon('flag'), 'Invite') : null),
          h('span', { class: 'ios-desc' }, mine.length ? mine.map((e) => `${EVENT_SPECS[e.kind].short} ${ordinal(e.result!.place)} (+${e.result!.points})`).join(' · ') : w < s.week ? 'Skipped' : big ? `${eventDate(big.kind, w).label.replace(/^\w+, /, '').replace(/, 2010$/, '')} · ${big.size} players · plus Locals` : `${eventDate('locals', w).label.replace(/, 2010$/, '')} · Locals`),
        ),
      );
    }),
  );

  const block = advanceBlocked(s);
  const unplayed = week.filter((e) => e.status === 'upcoming' && canEnter(s, e));
  const barSum = h('div', { class: 'lob-bar-sum' }, runHere && runHere.phase !== 'done' ? h('span', null, 'In progress: ', h('b', null, runHere.title)) : unplayed.length ? h('span', null, `${unplayed.length} event${unplayed.length > 1 ? 's' : ''} open this week`) : h('span', null, 'Week complete'));
  const cta =
    block === 'active-event'
      ? ctaButton('Continue event', () => go('events', { view: 'run' }), 'play')
      : ctaButton(s.week === SEASON_WEEKS ? 'Finish the season' : `Advance to week ${s.week + 1}`, () => void nextWeek(), 'chevron');

  async function nextWeek() {
    if (unplayed.length) {
      const names = unplayed.map((e) => EVENT_SPECS[e.kind].short).join(' and ');
      if (!(await confirmDialog(`Skip ${names}?`, 'The circuit plays without you this week. You earn no points from these events.', 'Skip and advance'))) return;
    }
    const res = advanceWeek(s);
    if (res === 'active-event') return toast('Finish your event first.', 'error');
    const after = loadSeason();
    if (after?.done) toast('Season complete.', 'gold');
    else if (after) {
      const r = yourRow(after);
      toast(`Week ${after.week}. You are ${r.score ? ordinal(r.rank) : 'unranked'} on the circuit.`, 'info');
    }
    go('events', { view: 'season' }, { replace: true });
  }

  const el = frame(
    `Season ${s.number}`,
    { eyebrow: 'The Circuit', cls: 'lobby-screen ev-screen ev-season', backTo: () => go('events'), backLabel: 'Events' },
    head,
    lobbySection('This week', null, cards),
    countingGroup,
    inviteGroup,
    standingsGroup,
    calendar,
    iosGroup(null, [h('button', { type: 'button', class: 'ios-row ios-row--action danger', onclick: () => void endSeason() }, h('span', { class: 'ios-label' }, 'Abandon season'))]),
    stickyBar(barSum, cta),
  );

  async function endSeason() {
    if (!(await confirmDialog('Abandon this season?', 'Your circuit points and invites for this season are lost. Ratings and prizes stay.', 'Abandon', true))) return;
    abandonSeason();
    go('events', {}, { replace: true });
  }
  return { el };
}

function weekCard(s: Season, ev: SeasonEvent, run: ReturnType<typeof loadActiveEvent>) {
  const spec = EVENT_SPECS[ev.kind];
  const sub = `${ev.dateLabel.replace(/, 2010$/, '')} · ${ev.size} players · ${formatLine(ev.kind, ev.size)}`;
  const top = h('div', { class: 'ev-card-top' }, kindArt(ev.kind), h('div', { class: 'ev-card-text' }, h('b', null, ev.title), h('span', null, sub)));
  let body: Child = null;
  if (ev.status === 'played' && ev.result) {
    body = h(
      'div',
      { class: 'ev-card-result' },
      h('span', null, h('b', null, ordinal(ev.result.place)), ` · ${ev.result.record} · ${ev.result.placing}`),
      h('span', { class: 'ev-tag is-gold' }, `+${ev.result.points} pts`),
    );
  } else if (ev.status === 'active' && run?.season?.eventId === ev.id) {
    body = h('div', { class: 'ev-card-actions' }, h('button', { type: 'button', class: 'lx-btn lx-btn--primary', onclick: () => go('events', { view: 'run' }) }, icon('play'), run.phase === 'done' ? 'Collect prizes' : `Continue · ${roundLabel(run)}`));
  } else if (!canEnter(s, ev)) {
    body = h('p', { class: 'ev-card-note' }, icon('flag'), ` ${spec.short} is invitation only. Earn an invite at a Regional, the SJC, or by ranking in the circuit Top ${CIRCUIT_INVITE_RANK}. The field plays without you.`);
  } else {
    body = h('div', { class: 'ev-card-actions' }, h('button', { type: 'button', class: 'lx-btn lx-btn--primary', onclick: () => go('events', { view: 'checkin', event: ev.id }) }, icon('clipboard'), 'Register'));
  }
  return h('section', { class: 'ev-card' }, top, body);
}

/** Top 5, a gap, then the rows around you. */
function standingsSlice(st: CircuitRow[], head: number) {
  const meI = st.findIndex((r) => r.you);
  const pick = new Set<number>();
  for (let i = 0; i < Math.min(head, st.length); i++) pick.add(i);
  for (let i = Math.max(0, meI - 1); i <= Math.min(st.length - 1, meI + 1); i++) pick.add(i);
  const out: HTMLElement[] = [];
  let prev = -1;
  [...pick].sort((a, b) => a - b).forEach((i) => {
    if (prev >= 0 && i > prev + 1) out.push(h('div', { class: 'ev-gap' }, '···'));
    prev = i;
    out.push(circuitRowEl(st[i]));
  });
  return out;
}

function circuitRowEl(r: CircuitRow) {
  const d = r.duelist;
  const deck = d ? metaLabel(d.meta, deckById(d.deckId)) : 'Your decks';
  const tier = d ? (d.regular ? 'Regular' : d.tier === 'pro' ? 'Pro' : d.tier === 'regional' ? 'Traveller' : 'Local') : 'You';
  return h(
    'div',
    { class: ['ios-row', 'ev-circ-row', r.you && 'is-you'] },
    h('span', { class: 'ev-circ-rank' }, r.score ? String(r.rank) : '—'),
    avatar({ name: r.you ? getSettings().playerName || 'You' : r.name, human: r.you }, 32),
    h('span', { class: 'ios-row-text' }, h('span', { class: 'ios-label' }, r.you ? 'You' : r.name, ...inviteTags(r.invite)), h('span', { class: 'ios-desc' }, r.you ? `Rating ${loadRatings().constructed.rating} · ${r.events} event${r.events === 1 ? '' : 's'} played` : `${tier} · ${deck}`)),
    h('span', { class: 'ev-circ-pts' }, String(r.score), h('small', null, 'pts')),
  );
}

function standingsScreen(s: Season): Screen {
  const st = circuitStandings(s);
  type Filter = 'all' | 'invited' | 'regulars';
  let filter = 'all' as Filter;
  const list = h('div', { class: 'ios-list' });
  const draw = () => {
    const rows = st.filter((r) => filter === 'all' || r.you || (filter === 'invited' ? !!r.invite.nationals : !!r.duelist?.regular));
    list.replaceChildren(...rows.map(circuitRowEl));
  };
  draw();
  const el = frame(
    'Circuit Standings',
    { eyebrow: `Season ${s.number} · ${s.done ? 'Final' : `Week ${Math.min(s.week, SEASON_WEEKS)}`}`, cls: 'lobby-screen ev-screen ev-standings', backTo: () => go('events', { view: 'season' }), backLabel: 'Season' },
    h(
      'div',
      { style: { marginBottom: '14px' } },
      segmented<Filter>(
        [
          { value: 'all', label: 'Everyone' },
          { value: 'invited', label: 'Invited' },
          { value: 'regulars', label: 'Regulars' },
        ],
        filter,
        (v) => ((filter = v), draw()),
        'Filter standings',
      ),
    ),
    h('section', { class: 'ios-group' }, list, h('p', { class: 'ios-foot' }, `Best ${BEST_OF} results from the last ${RANK_WINDOW} weeks. Top ${CIRCUIT_INVITE_RANK} after week ${INVITE_DEADLINE_WEEK} are invited to Nationals.`)),
  );
  return { el };
}

function seasonSummaryScreen(s: Season): Screen {
  const sum = s.summary!;
  const st = circuitStandings(s, SEASON_WEEKS);
  const trophies = sum.trophies;
  const el = frame(
    `Season ${s.number}`,
    { eyebrow: 'The Circuit · Final standings', cls: 'lobby-screen ev-screen ev-season', backTo: () => go('events'), backLabel: 'Events' },
    h(
      'section',
      { class: 'ev-summary' },
      icon(sum.finalRank === 1 ? 'crown' : sum.finalRank <= 16 ? 'trophy' : 'flag'),
      h('span', { class: 'lx-k' }, 'Final circuit rank'),
      sum.score ? h('div', { class: 'ev-summary-rank' }, ordinal(sum.finalRank), h('small', null, ` of ${sum.field}`)) : h('div', { class: 'ev-summary-rank is-none' }, 'Unranked'),
      h('p', null, `${sum.score} points in the final ${RANK_WINDOW} weeks · ${sum.totalPoints} all season · ${sum.played} events played`),
      sum.invites.nationals ? h('div', { class: 'ev-circuit-tags', style: { marginTop: '10px' } }, inviteTags(sum.invites)) : null,
    ),
    iosGroup(
      'Trophies',
      trophies.length
        ? trophies.map((t) => h('div', { class: 'ios-row pf-trophy' }, h('span', { class: 'ios-icon' }, icon('trophy')), h('span', { class: 'ios-row-text' }, h('span', { class: 'ios-label' }, t.title), h('span', { class: 'ios-desc' }, `Week ${t.week} · Champion`))))
        : [h('div', { class: 'ios-row' }, h('span', { class: 'ios-row-text' }, h('span', { class: 'ios-label' }, 'No event wins this season'), h('span', { class: 'ios-desc' }, sum.best ? `Best finish: ${ordinal(sum.best.place)} at ${sum.best.title}` : 'Next season, then.')))],
    ),
    iosGroup('Final standings', standingsSlice(st, 10), `Circuit champion: ${sum.champion.id === YOU ? 'you' : sum.champion.name}.`),
    iosGroup(
      'Season recap',
      s.events
        .filter((e) => e.kind !== 'locals' || e.status === 'played')
        .map((e) =>
          h(
            'div',
            { class: 'ios-row' },
            h('span', { class: 'ios-icon' }, icon(KIND_ICON(e.kind))),
            h('span', { class: 'ios-row-text' }, h('span', { class: 'ios-label' }, e.title), h('span', { class: 'ios-desc' }, `Week ${e.week} · ${e.result ? `${ordinal(e.result.place)} · ${e.result.placing}` : 'Skipped'}${e.champion ? ` · Won by ${e.champion.name}` : ''}`)),
            e.result ? h('span', { class: 'ev-circ-pts' }, `+${e.result.points}`) : null,
          ),
        ),
    ),
    stickyBar(h('div', { class: 'lob-bar-sum' }, 'Ratings, prizes and history carry over.'), ctaButton('Start a new season', () => void begin(true), 'flag')),
  );
  return { el };
}

void REGULARS;
