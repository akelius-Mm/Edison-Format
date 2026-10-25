// Profile (route `profile`): ratings with their history, circuit rank and invites, trophies,
// best finishes, win rate by deck, rivals among the Locals regulars and the event history.
import {
  BEST_OF,
  EVENT_KINDS,
  EVENT_SPECS,
  RANK_WINDOW,
  YOU,
  loadEventHistory,
  loadRatings,
  loadSeason,
  loadSeasonArchive,
  yourRow,
  circuitStandings,
  type EventKind,
  type RatingTrack,
} from '../../events';
import { loadHistory as loadLocalsHistory, loadRivals } from '../../locals';
import { REGULARS } from '../../locals/regulars';
import { metaInfo } from '../../locals/meta';
import { getSettings } from '../settings';
import { iosGroup, iosNav } from './components';
import { h, icon, segmented, type Child } from './dom';
import { avatar } from './locals';
import { frame, go, type Screen } from './nav';
import { getProfile, ordinal, winRate } from './store';
import './locals.css';
import './events.css';

interface HistoryRow {
  id: string;
  kind: EventKind | 'tournament';
  title: string;
  /** Short location for summaries: the city, or the shop / event name. */
  where: string;
  sub: string;
  place: number;
  size: number;
  cut: boolean;
  when: number;
}

function allHistory(): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (const e of loadEventHistory())
    rows.push({
      id: e.id,
      kind: e.kind,
      title: e.title,
      where: e.city || e.title,
      sub: `${e.dateLabel.replace(/^\w+, /, '').replace(/, 2010$/, '')} · ${e.size} players · ${e.deckName} · ${e.record}${e.week ? ` · Season week ${e.week}` : ''}`,
      place: e.place,
      size: e.size,
      cut: e.madeCut,
      when: e.finishedAt,
    });
  for (const n of loadLocalsHistory())
    rows.push({
      id: n.id,
      kind: 'locals',
      title: n.shop,
      where: n.shop,
      sub: `Locals Night · ${n.dateLabel.replace(/^\w+, /, '').replace(/, 2010$/, '')} · ${n.size} players · ${n.deckName} · ${n.record}`,
      place: n.place,
      size: n.size,
      cut: n.madeCut,
      when: n.finishedAt,
    });
  for (const t of getProfile().tournaments)
    rows.push({ id: t.id, kind: 'tournament', title: t.name, where: t.name, sub: `Practice tournament · ${t.size} players · ${t.deckName} · ${t.record}`, place: t.place, size: t.size, cut: t.place <= 8, when: t.date });
  return rows.sort((a, b) => b.when - a.when);
}

/** Rating sparkline: one 2px line, endpoint dot, tap/hover for the value at any match. */
function sparkline(track: RatingTrack) {
  const pts = [{ t: 0, r: 1500 }, ...track.history];
  if (pts.length < 2) return h('p', { class: 'pf-spark-empty' }, 'Play rated matches to draw your rating line.');
  const min = Math.min(...pts.map((p) => p.r), 1500);
  const max = Math.max(...pts.map((p) => p.r), 1500);
  const pad = Math.max(10, (max - min) * 0.12);
  const lo = min - pad;
  const hi = max + pad;
  const W = 300;
  const H = 64;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (r: number) => H - ((r - lo) / (hi - lo)) * H;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.r).toFixed(1)}`).join(' ');
  const wrap = h('div', { class: 'pf-spark', role: 'img', 'aria-label': `Constructed rating over ${pts.length - 1} rated matches, from 1500 to ${track.rating}` });
  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><line class="pf-spark-base" x1="0" x2="${W}" y1="${y(1500).toFixed(1)}" y2="${y(1500).toFixed(1)}"/><path class="pf-spark-line" d="${d}"/></svg>`;
  const dot = h('span', { class: 'pf-spark-dot' });
  const tip = h('span', { class: 'pf-spark-tip', hidden: true });
  const place = (i: number) => {
    dot.style.left = `${(x(i) / W) * 100}%`;
    dot.style.top = `${(y(pts[i].r) / H) * 64}px`;
  };
  place(pts.length - 1);
  const show = (ev: PointerEvent) => {
    const r = wrap.getBoundingClientRect();
    const i = Math.max(0, Math.min(pts.length - 1, Math.round(((ev.clientX - r.left) / r.width) * (pts.length - 1))));
    place(i);
    tip.hidden = false;
    tip.style.left = dot.style.left;
    tip.textContent = i === 0 ? 'Start · 1500' : `Match ${i} · ${pts[i].r}`;
  };
  const hide = () => {
    tip.hidden = true;
    place(pts.length - 1);
  };
  wrap.addEventListener('pointermove', show);
  wrap.addEventListener('pointerdown', show);
  wrap.addEventListener('pointerleave', hide);
  wrap.addEventListener('pointerup', (e) => e.pointerType !== 'mouse' && setTimeout(hide, 1200));
  wrap.append(dot, tip);
  return h('div', null, wrap, h('div', { class: 'pf-spark-cap' }, h('span', null, 'First rated match'), h('span', null, `Peak ${track.peak}`)));
}

export function profileScreen(): Screen {
  const s = getSettings();
  const ratings = loadRatings();
  const hist = allHistory();
  const season = loadSeason();
  const archive = loadSeasonArchive();
  const profile = getProfile();
  let fmt = 'constructed' as 'constructed' | 'limited';

  // ---- ratings card
  const ratingCard = h('section', { class: 'pf-rating', 'aria-label': 'Ratings' });
  const drawRating = () => {
    const t = ratings[fmt];
    const other = fmt === 'constructed' ? ratings.limited : ratings.constructed;
    ratingCard.replaceChildren(
      h(
        'div',
        { class: 'pf-rating-top' },
        h('div', { class: 'pf-rating-v' }, h('span', { class: 'lx-k' }, fmt === 'constructed' ? 'Constructed rating' : 'Limited rating'), h('b', null, String(t.rating))),
        h('div', { class: 'pf-rating-side' }, h('span', null, `${t.w}-${t.l}${t.d ? `-${t.d}` : ''} in ${t.matches} rated`), h('span', null, `Peak ${t.peak}`)),
      ),
      fmt === 'constructed' || t.matches ? sparkline(t) : h('p', { class: 'pf-spark-empty' }, 'Limited rating comes from rated Draft matches.'),
      h('div', { class: 'pf-subrating' }, h('span', null, fmt === 'constructed' ? 'Limited (Draft)' : 'Constructed'), h('b', null, other.matches ? String(other.rating) : `${other.rating} · unrated`)),
    );
  };
  drawRating();
  const fmtSeg = segmented<typeof fmt>(
    [
      { value: 'constructed', label: 'Constructed' },
      { value: 'limited', label: 'Limited' },
    ],
    fmt,
    (v) => ((fmt = v), drawRating()),
    'Rating format',
  );

  // ---- circuit
  const circuitRows: Child[] = [];
  if (season) {
    const me = yourRow(season);
    const field = circuitStandings(season).length;
    const inv = season.invites[YOU] ?? {};
    circuitRows.push(
      iosNav(season.done ? `Season ${season.number} · final` : `Season ${season.number} · week ${season.week}`, () => go('events', { view: 'season' }), {
        icon: 'flag',
        desc: `${me.score} pts (best ${BEST_OF} in ${RANK_WINDOW} weeks)${inv.nationals ? ' · Nationals invite' : ''}`,
        detail: me.score ? `${ordinal(me.rank)} / ${field}` : 'Unranked',
      }),
    );
  }
  for (const a of archive.filter((x) => x.id !== season?.id).slice(0, 4))
    circuitRows.push(
      h(
        'div',
        { class: 'ios-row' },
        h('span', { class: 'ios-icon' }, icon('scroll')),
        h('span', { class: 'ios-row-text' }, h('span', { class: 'ios-label' }, `Season ${a.number}`), h('span', { class: 'ios-desc' }, `${a.score} pts · ${a.trophies.length} trophies${a.invites.nationals ? ' · Nationals' : ''}`)),
        h('span', { class: 'ios-detail' }, a.score ? `${ordinal(a.finalRank)} / ${a.field}` : '—'),
      ),
    );
  if (!circuitRows.length) circuitRows.push(iosNav('Start a season', () => go('events'), { icon: 'flag', desc: '12 weeks: Locals, Regionals, an SJC, then Nationals' }));

  // ---- trophies and best finishes
  const wins = hist.filter((x) => x.place === 1);
  const kindLabel = (k: HistoryRow['kind']) => (k === 'tournament' ? 'Practice tournament' : k === 'locals' ? 'Locals' : EVENT_SPECS[k].label);
  const trophyRows = wins.length
    ? wins.slice(0, 12).map((w) => h('div', { class: 'ios-row pf-trophy' }, h('span', { class: 'ios-icon' }, icon('trophy')), h('span', { class: 'ios-row-text' }, h('span', { class: 'ios-label' }, w.title), h('span', { class: 'ios-desc' }, `${kindLabel(w.kind)} · ${w.size} players`))))
    : [h('div', { class: 'ios-row' }, h('span', { class: 'ios-row-text' }, h('span', { class: 'ios-label' }, 'No trophies yet'), h('span', { class: 'ios-desc' }, 'Win an event and it is listed here.')))];
  const bestRows = [...EVENT_KINDS, 'tournament' as const]
    .map((k) => {
      const of = hist.filter((x) => x.kind === k);
      if (!of.length) return null;
      const best = [...of].sort((a, b) => a.place - b.place || b.size - a.size)[0];
      return h(
        'div',
        { class: 'ios-row' },
        h('span', { class: ['pf-place', best.place === 1 && 'is-first'] }, ordinal(best.place)),
        h('span', { class: 'ios-row-text' }, h('span', { class: 'ios-label' }, kindLabel(k)), h('span', { class: 'ios-desc' }, `${best.where} · of ${best.size} · ${of.length} played`)),
      );
    })
    .filter(Boolean) as HTMLElement[];

  // ---- decks
  const decks = Object.values(profile.decks)
    .map((d) => ({ ...d, n: d.w + d.l + d.d }))
    .filter((d) => d.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);
  const deckRows = decks.length
    ? decks.map((d) =>
        h(
          'div',
          { class: 'ios-row' },
          h('span', { class: 'ios-row-text' }, h('span', { class: 'ios-label' }, d.name), h('span', { class: 'ios-desc' }, `${d.w}-${d.l}${d.d ? `-${d.d}` : ''} in games`)),
          h('span', { class: 'pf-bar', 'aria-hidden': 'true' }, h('span', { style: { width: `${Math.round(winRate(d) * 100)}%` } })),
          h('span', { class: 'pf-pct' }, `${Math.round(winRate(d) * 100)}%`),
        ),
      )
    : [h('div', { class: 'ios-row' }, h('span', { class: 'ios-row-text' }, h('span', { class: 'ios-label' }, 'No games yet'), h('span', { class: 'ios-desc' }, 'Win rates appear after your first duels.')))];

  // ---- rivals
  const rivals = loadRivals();
  const rivalRows = REGULARS.map((r) => ({ r, rec: rivals[r.id] }))
    .sort((a, b) => (b.rec ? b.rec.w + b.rec.l + b.rec.d : -1) - (a.rec ? a.rec.w + a.rec.l + a.rec.d : -1))
    .map(({ r, rec }) => {
      const n = rec ? rec.w + rec.l + rec.d : 0;
      return h(
        'div',
        { class: 'lx-rival-row' },
        avatar(r, 40),
        h('span', { class: 'lx-rival-name' }, h('b', null, r.name), h('span', null, `${metaInfo(r.meta).label === 'Rogue' ? 'Rogue decks' : metaInfo(r.meta).label} · ${r.title}`)),
        h('span', { class: ['lx-rival-rec', n > 0 && rec.w > rec.l && 'is-up', n > 0 && rec.w < rec.l && 'is-down'] }, n ? `${rec.w}-${rec.l}${rec.d ? `-${rec.d}` : ''}` : '—'),
      );
    });

  // ---- history
  const histRows = hist.slice(0, 30).map((x) =>
    h(
      'div',
      { class: 'lx-night-row' },
      h('span', { class: ['lx-night-place', x.place === 1 && 'is-first', x.cut && 'is-cut'] }, ordinal(x.place)),
      h('span', { class: 'lx-night-main' }, h('b', null, x.title), h('span', null, x.sub)),
      h('span', { class: 'lx-night-prize' }, x.kind === 'tournament' ? 'Practice' : x.kind === 'locals' ? 'Locals' : EVENT_SPECS[x.kind].short),
    ),
  );

  const el = frame(
    'Profile',
    { eyebrow: 'Your duelist record', cls: 'lobby-screen lx-screen ev-screen pf-screen', backTo: () => history.length > 1 ? history.back() : go('title') },
    h(
      'div',
      { class: 'pf-head' },
      avatar({ name: s.playerName || 'You', human: true }, 56),
      h('div', { class: 'pf-head-text' }, h('b', null, s.playerName || 'Duelist'), h('span', null, `${profile.matches.w}-${profile.matches.l}${profile.matches.d ? `-${profile.matches.d}` : ''} in matches · ${hist.length} event${hist.length === 1 ? '' : 's'} · ${wins.length} ${wins.length === 1 ? 'trophy' : 'trophies'}`)),
    ),
    h('div', { style: { marginBottom: '10px' } }, fmtSeg),
    ratingCard,
    iosGroup('Circuit', circuitRows),
    iosGroup('Trophies', trophyRows),
    bestRows.length ? iosGroup('Best finishes', bestRows) : null,
    iosGroup('Win rate by deck', deckRows, 'Every game you have played, in any mode.'),
    h('section', { class: 'ios-group' }, h('h2', { class: 'ios-group-h' }, 'Rivals · the regulars'), h('div', { class: 'lob-group lx-rivals' }, rivalRows), h('p', { class: 'ios-foot' }, 'Your match record against the Locals Night regulars, at any event.')),
    h(
      'section',
      { class: 'ios-group' },
      h('h2', { class: 'ios-group-h' }, 'Event history'),
      histRows.length ? h('div', { class: 'lob-group lx-nights' }, histRows) : h('div', { class: 'lx-empty' }, icon('scroll'), h('b', null, 'No events yet'), h('span', null, 'Check in to an event and your placings land here.')),
    ),
  );
  return { el };
}
