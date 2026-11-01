// Play tab (route `title`, also `play`): the hero with Duel vs AI, anything in progress, this week's event,
// playing friends and Watch AI vs AI (the practice Tournament lives under Events). Settings and Profile sit in the hero's corner. Also the Collection tab.
import { getSettings, loadJSON } from '../settings';
import { applyPlaymat } from '../theme/playmats';
import { renderCard, sleevePreview } from './ext';
import { signatureCard } from './components';
import { allDeckInfos } from './store';
import { findCard } from '../../cards';
import { loadActiveTournament, currentRoundLabel } from '../../tournament/tournament';
import { h, icon, type Child } from './dom';
import { frame, go, type Screen } from './nav';
import { friendsLocalsLive } from './friendLocals';
import { getOfficialImage } from '../cards/officialArt';
import { dp, totalUnopened } from '../../collection';
import { getProfile, tournamentSummary, ordinal } from './store';
// Events agent: Events tile, Profile chip and event resume.
import { EVENT_SPECS, SEASON_WEEKS, eventsThisWeek, loadActiveEvent, loadRatings, loadSeason, roundLabel as eventRoundLabel } from '../../events';
import { avatar as initialsAvatar } from './locals';
import { loadActiveDuel } from '../duel/resume';
import { resumeDuelCard } from './resumeCard';
import { browserBanner } from './report';
import { rulesNotesCard } from './rulesNotes';
import { FORBIDDEN, LIMITED, SEMI_LIMITED } from '../../cards/banlist';

export function titleScreen(): Screen {
  const profile = getProfile();
  const ts = tournamentSummary();
  const gp = profile.games.w + profile.games.l + profile.games.d;

  // ---- hero: your table (your mat, your sleeved deck and its ace) with the main call to action; profile and
  // settings in the corner
  const heroArt = yourTable();
  const hero = h(
    'section',
    { class: 'home-hero' },
    heroArt,
    h('div', { class: 'home-hero-shade' }),
    h(
      'div',
      { class: 'home-hero-body' },
      h('div', { class: 'home-eyebrow' }, 'Edison Format · April 2010'),
      h('h1', { class: 'home-title' }, 'Edison'),
      h(
        'div',
        { class: 'home-record' },
        gp ? `${profile.games.w}–${profile.games.l}${profile.games.d ? `–${profile.games.d}` : ''} record` : 'Ready to duel',
        ts.played ? ` · ${ts.wins} title${ts.wins === 1 ? '' : 's'} · best ${ordinal(ts.best!)}` : '',
      ),
      h('button', { type: 'button', class: 'home-cta', onclick: () => go('duel') }, icon('swords'), h('span', null, 'Duel vs AI')),
    ),
    h(
      'div',
      { class: 'home-corner' },
      h('button', { type: 'button', class: 'home-profile', 'aria-label': 'Profile', onclick: () => go('profile') }, initialsAvatar({ name: getSettings().playerName || 'You', human: true }, 28), String(loadRatings().constructed.rating)),
      h('button', { type: 'button', class: 'home-gear', 'aria-label': 'Settings', 'data-test': 'home-settings', onclick: () => go('settings') }, icon('gear')),
    ),
  );

  const { duelCard, resume } = resumeRows();
  const fl = friendsLocalsLive();
  const flLive = !!fl && fl.phase !== 'done';

  const friends = h(
    'section',
    { class: 'home-tiles' },
    tile('friend', 'Play a friend', 'Online with a room code', 'Elemental HERO Stratos'),
    tile(
      'friend-locals',
      'Friends Locals',
      flLive ? `In progress · ${fl!.phase === 'lobby' ? 'lobby' : fl!.phase === 'swiss' ? `round ${fl!.rounds.length} of ${fl!.swissRounds}` : 'top cut'}` : 'Swiss for 3–8 friends',
      'Black Rose Dragon',
      flLive ? 'Live' : undefined,
    ),
  );
  const watch = h(
    'button',
    { type: 'button', class: 'home-resume home-week', onclick: () => go('exhibition') },
    icon('eye'),
    h('span', { class: 'home-resume-text' }, h('b', null, 'Watch AI vs AI'), h('span', null, 'Spectate two decks, handy for testing a matchup')),
    icon('chevron'),
  );

  const el = h(
    'div',
    { class: 'home', tabindex: '-1' },
    hero,
    h(
      'div',
      { class: 'home-body' },
      duelCard,
      resume,
      thisWeekCard(),
      h('h2', { class: 'home-h' }, 'With friends'),
      friends,
      watch,
      browserBanner(),
      rulesNotesCard(),
      banlistCard(),
      h('p', { class: 'home-foot' }, 'Fan-made, non-commercial simulator. Not affiliated with the card game’s publisher.'),
    ),
  );

  return { el };
}

/** Your mat with your sleeved deck on it and the ace of the deck you last chose, face up. Tap to change them. */
function yourTable(): HTMLElement {
  const st = getSettings();
  const table = h('div', { class: 'home-hero-art home-table has-art' });
  applyPlaymat(table, st.playmat);
  const stack = (n: number, cls: string, label: string) =>
    h(
      'button',
      { type: 'button', class: ['home-stack', cls], 'aria-label': label, 'data-test': cls, onclick: () => go('customize') },
      ...Array.from({ length: n }, (_, i) => h('span', { class: 'home-stack-card', style: { '--i': i } }, sleevePreview(st.sleeve, 'md'))),
    );
  const ace = lastDeckAce();
  table.append(
    h(
      'div',
      { class: 'home-table-cards' },
      stack(3, 'home-extra', 'Extra Deck · Sleeves & Playmat'),
      ace ? h('button', { type: 'button', class: 'home-ace', 'aria-label': `${ace.name} · choose decks`, onclick: () => go('duel') }, renderCard(ace, { size: 'md' })) : null,
      stack(6, 'home-deck', 'Your deck · Sleeves & Playmat'),
    ),
  );
  return table;
}

/** The signature card of the deck you last picked for Duel vs AI (or Dark Armed Dragon before you have). */
function lastDeckAce() {
  const key = loadJSON<{ myDeck?: string | null }>('edison.duelSetup.v1', {}).myDeck;
  const deck = key ? allDeckInfos().find((d) => d.key === key) : undefined;
  const name = (deck && signatureCard(deck)) ?? 'Dark Armed Dragon';
  return findCard(name) ?? findCard('Dark Armed Dragon');
}

/** Collection tab: packs, the Card Shop, trades and your binder. */
export function collectionScreen(): Screen {
  const unopened = totalUnopened();
  const el = frame(
    'Collection',
    { cls: 'collection-screen', actions: h('span', { class: 'col-dp' }, `${dp()} DP`), root: true },
    h(
      'section',
      { class: 'home-tiles' },
      tile('packs', 'Packs', unopened ? `${unopened} to open` : 'Boosters and Structure Decks', 'Pot of Avarice', unopened ? String(unopened) : undefined),
      tile('shop', 'Card Shop', 'Buy and sell singles', 'Card Trader'),
      tile('shop', 'Trades', 'Trade with the regulars', 'Swap Frog', undefined, { tab: 'trade' }),
      tile('binder', 'Binder', 'Your collection by set', 'Stardust Dragon'),
    ),
  );
  return { el };
}

/** Card-art tile (Play and Collection). */
export function modeTile(route: string, label: string, sub: string, art: string, badge?: string, params?: Record<string, string>) {
  const bg = h('div', { class: 'home-tile-art' });
  artInto(bg, art);
  return h(
    'button',
    { type: 'button', class: 'home-tile', onclick: () => go(route, params) },
    bg,
    h('div', { class: 'home-tile-shade' }),
    badge ? h('span', { class: 'home-badge' }, badge) : null,
    h('span', { class: 'home-tile-text' }, h('b', null, label), h('span', null, sub)),
  );
}
const tile = modeTile;

/** A duel left in the middle (or cut off when the app was closed) comes first, then an event or tournament in progress. */
export function resumeRows(): { duelCard: Child; resume: Child } {
  const active = loadActiveTournament();
  const duel = loadActiveDuel();
  const duelCard: Child = duel ? resumeDuelCard(duel, { showMode: true }) : null;
  const ev = duel?.tag.kind === 'events' ? null : loadActiveEvent();
  const tour = duel?.tag.kind === 'tournament' ? null : active;
  const resume: Child = ev
    ? h(
        'button',
        { type: 'button', class: 'home-resume', onclick: () => go('events', { view: 'run' }) },
        icon('trophy'),
        h('span', { class: 'home-resume-text' }, h('b', null, 'Resume event'), h('span', null, `${ev.title} · ${eventRoundLabel(ev)}`)),
        icon('play'),
      )
    : tour
    ? h(
        'button',
        { type: 'button', class: 'home-resume', onclick: () => go('tournament') },
        icon('trophy'),
        h('span', { class: 'home-resume-text' }, h('b', null, 'Resume tournament'), h('span', null, `${tour.name} · ${currentRoundLabel(tour)}`)),
        icon('play'),
      )
    : null;

  return { duelCard, resume };
}

/** Home shortcut to this week's play: the Circuit week when a season is running, else Locals Night. */
function thisWeekCard(): Child {
  const s = loadSeason();
  const live = s && !s.done;
  const label = live ? `The Circuit · Week ${s.week} of ${SEASON_WEEKS}` : 'Locals Night';
  const desc = live ? eventsThisWeek(s).map((e) => EVENT_SPECS[e.kind].short).join(' · ') + ' this week' : 'Friday at the card shop';
  return h(
    'button',
    { type: 'button', class: 'home-resume home-week', onclick: () => (live ? go('events', { view: 'season' }) : go('locals')) },
    icon(live ? 'flag' : 'trophy'),
    h('span', { class: 'home-resume-text' }, h('b', null, label), h('span', null, desc)),
    icon('chevron'),
  );
}

/** Fill an element with a card's official artwork as a background (fails quietly). */
export function artInto(el: HTMLElement, cardName: string) {
  void getOfficialImage(cardName).then((img) => {
    if (!img) return;
    const pre = new Image();
    pre.onload = () => {
      el.style.backgroundImage = `url("${img.art}")`;
      el.classList.add('has-art');
    };
    pre.src = img.art;
  });
}

/** Always-on Home row at the bottom: the official March 2010 Forbidden & Limited list (How to Play → Banlist). */
function banlistCard(): HTMLElement {
  return h(
    'section',
    { class: 'rn-card rn-card--ban', 'aria-label': 'Banlist' },
    h(
      'button',
      { type: 'button', class: 'rn-open', 'data-test': 'home-banlist', onclick: () => go('rules', { tab: 'banlist' }) },
      h('span', { class: 'rn-icon' }, icon('warn')),
      h(
        'span',
        { class: 'rn-text' },
        h('b', null, 'Banlist · March 2010'),
        h('small', null, `${FORBIDDEN.length} Forbidden · ${LIMITED.length} Limited · ${SEMI_LIMITED.length} Semi-Limited`),
      ),
      icon('chevron'),
    ),
  );
}

/** Home row under the banlist (same style): the in-app Guide. Also shown on How to Play. */
export function guideCard(): HTMLElement {
  return h(
    'section',
    { class: 'rn-card rn-card--guide', 'aria-label': 'Guide' },
    h(
      'button',
      { type: 'button', class: 'rn-open', 'data-test': 'home-guide', onclick: () => go('guide') },
      h('span', { class: 'rn-icon' }, icon('info')),
      h('span', { class: 'rn-text' }, h('b', null, 'Guide · How the app works'), h('small', null, 'Getting around, duels, playing friends, where the rules come from')),
      icon('chevron'),
    ),
  );
}
