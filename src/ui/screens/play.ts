// Duel tab hub (route `play`): every way to play Constructed. Quick Duel opens the deck selection;
// Locals Night, Events, the practice Tournament and AI vs AI sit below it as card-art tiles.
import { h, icon } from './dom';
import { go, type Screen } from './nav';
import { getSettings } from '../settings';
import { loadActiveTournament, currentRoundLabel } from '../../tournament/tournament';
import { SEASON_WEEKS, loadActiveEvent, loadRatings, loadSeason } from '../../events';
import { avatar as initialsAvatar } from './locals';
import { artInto, modeTile, resumeRows } from './title';

export function playScreen(): Screen {
  const { duelCard, resume } = resumeRows();
  const season = loadSeason();
  const ev = loadActiveEvent();
  const tour = loadActiveTournament();

  const head = h(
    'header',
    { class: 'play-head' },
    h('div', null, h('div', { class: 'home-eyebrow' }, 'Constructed · Edison Format'), h('h1', { class: 'play-title' }, 'Duel')),
    h('button', { type: 'button', class: 'play-rating', 'aria-label': 'Profile and ratings', onclick: () => go('profile') }, initialsAvatar({ name: getSettings().playerName || 'You', human: true }, 28), h('span', null, h('b', null, String(loadRatings().constructed.rating)), h('small', null, 'Rating'))),
  );

  // Quick Duel: the two-step deck selection against the AI
  const art = h('div', { class: 'home-tile-art' });
  artInto(art, 'Black Luster Soldier - Envoy of the Beginning');
  const quick = h(
    'button',
    { type: 'button', class: 'play-quick', onclick: () => go('duel') },
    art,
    h('div', { class: 'home-tile-shade' }),
    h(
      'span',
      { class: 'play-quick-text' },
      h('span', { class: 'home-eyebrow' }, 'Quick Duel'),
      h('b', null, 'Duel vs AI'),
      h('span', null, 'Choose your deck, then your opponent · single game or best of three'),
    ),
    h('span', { class: 'play-quick-go' }, icon('swords'), 'Choose decks'),
  );

  const tiles = h(
    'section',
    { class: 'home-tiles play-tiles' },
    modeTile('locals', 'Locals Night', 'Friday at the card shop', 'Black Rose Dragon'),
    modeTile(
      'events',
      'Events',
      ev ? `In progress · ${ev.title}` : season && !season.done ? `Circuit · week ${season.week} of ${SEASON_WEEKS}` : 'Regionals, SJCs, Nationals',
      'Judgment Dragon',
      ev ? 'Live' : undefined,
    ),
    modeTile('tournament', 'Tournament', tour ? `${tour.name} · ${currentRoundLabel(tour)}` : 'Practice Swiss · unranked', 'Gladiator Beast Gyzarus', tour ? 'Live' : undefined),
    modeTile('exhibition', 'Watch AI vs AI', 'Spectate two AI duelists', 'Cyber Dragon'),
  );

  // Play a friend: online duel with a room code (src/net, screens/friend.ts)
  const friend = h('section', { class: 'home-tiles play-tiles play-tiles--friend' }, modeTile('friend', 'Play a friend', 'Online with a room code · on their own phone', 'Elemental HERO Stratos'));

  const el = h(
    'div',
    { class: 'home play', tabindex: '-1' },
    head,
    h('div', { class: 'home-body' }, duelCard, resume, quick, friend, h('h2', { class: 'home-h' }, 'Compete'), tiles),
  );
  return { el };
}
