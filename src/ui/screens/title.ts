// Title screen with the main menu.
import { getSettings } from '../settings';
import { loadActiveTournament, currentRoundLabel } from '../../tournament/tournament';
import { h, icon, ICONS, type Child } from './dom';
import { renderAvatar, sleevePreview } from './ext';
import { go, type Screen } from './nav';
import { getOfficialImage } from '../cards/officialArt';
import { getProfile, tournamentSummary, ordinal } from './store';

interface MenuItem {
  route: string;
  label: string;
  desc: string;
  icon: keyof typeof ICONS;
  primary?: boolean;
  key: string;
}

const MENU: MenuItem[] = [
  { route: 'duel', label: 'Duel vs AI', desc: 'Single game or best-of-three against a computer opponent', icon: 'swords', primary: true, key: '1' },
  { route: 'draft', label: 'Draft', desc: 'Open packs, pick cards and build a draft deck', icon: 'cards', key: '2' },
  { route: 'tournament', label: 'Tournament', desc: 'Swiss rounds and a top cut against a field of AI duelists', icon: 'trophy', key: '2' },
  { route: 'deck-builder', label: 'Deck Builder', desc: 'Build, tune, import and export your decks', icon: 'cards', key: '3' },
  { route: 'database', label: 'Card Database', desc: 'Browse every card in the Edison card pool', icon: 'search', key: '4' },
  { route: 'exhibition', label: 'Watch AI vs AI', desc: 'Spectate an exhibition match between two AI duelists', icon: 'eye', key: '5' },
  { route: 'customize', label: 'Customize', desc: 'Sleeves, playmat, avatar and duelist name', icon: 'palette', key: '6' },
  { route: 'settings', label: 'Settings', desc: 'Animation, sound, prompts and data', icon: 'gear', key: '7' },
  { route: 'rules', label: 'How to Play', desc: 'Edison Format rules, card pool and banlist', icon: 'book', key: '8' },
];

export function emblemSVG(cls = 'emblem') {
  const ticks = Array.from({ length: 48 }, (_, i) => {
    const a = (i / 48) * Math.PI * 2;
    const r1 = i % 4 === 0 ? 86 : 89;
    return `<line x1="${100 + Math.cos(a) * r1}" y1="${100 + Math.sin(a) * r1}" x2="${100 + Math.cos(a) * 93}" y2="${100 + Math.sin(a) * 93}"/>`;
  }).join('');
  const star = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const b = a + Math.PI / 8;
    return `${100 + Math.cos(a) * 74},${100 + Math.sin(a) * 74} ${100 + Math.cos(b) * 58},${100 + Math.sin(b) * 58}`;
  }).join(' ');
  const el = document.createElement('div');
  el.className = cls;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<svg viewBox="0 0 200 200">
  <defs>
    <linearGradient id="eg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbe7a5"/><stop offset=".45" stop-color="#d4af37"/><stop offset="1" stop-color="#7d5c14"/></linearGradient>
    <radialGradient id="eglow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="rgba(212,175,55,.35)"/><stop offset="1" stop-color="rgba(212,175,55,0)"/></radialGradient>
  </defs>
  <circle cx="100" cy="100" r="100" fill="url(#eglow)"/>
  <g class="em-ring-a" stroke="url(#eg)" stroke-width="1.2" fill="none">
    <circle cx="100" cy="100" r="95"/>${ticks}
  </g>
  <g class="em-ring-b" fill="none" stroke="url(#eg)" stroke-width="1.1">
    <circle cx="100" cy="100" r="80" stroke-dasharray="2 5"/>
    <polygon points="${star}" opacity=".85"/>
  </g>
  <circle cx="100" cy="100" r="52" fill="rgba(8,10,16,.85)" stroke="url(#eg)" stroke-width="1.6"/>
  <g transform="rotate(-9 100 100)">
    <rect x="80" y="70" width="40" height="58" rx="4" fill="none" stroke="url(#eg)" stroke-width="2.4"/>
    <rect x="85" y="76" width="30" height="27" rx="1.5" fill="rgba(212,175,55,.12)" stroke="url(#eg)" stroke-width="1"/>
  </g>
  <path d="M104 74 L88 102 H100 L94 128 L114 96 H102 Z" fill="url(#eg)" stroke="#2a1e05" stroke-width=".8"/>
</svg>`;
  return el;
}

export function titleScreen(): Screen {
  const profile = getProfile();
  const ts = tournamentSummary();
  const active = loadActiveTournament();
  const gp = profile.games.w + profile.games.l + profile.games.d;

  // ---- hero: full-bleed Dark Armed Dragon artwork with the main call to action
  const heroArt = h('div', { class: 'home-hero-art' });
  artInto(heroArt, 'Dark Armed Dragon');
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
      h('button', { type: 'button', class: 'home-cta', onclick: () => go('duel') }, icon('swords'), h('span', null, 'Duel')),
    ),
  );

  const resume: Child = active
    ? h(
        'button',
        { type: 'button', class: 'home-resume', onclick: () => go('tournament') },
        icon('trophy'),
        h('span', { class: 'home-resume-text' }, h('b', null, 'Resume tournament'), h('span', null, `${active.name} · ${currentRoundLabel(active)}`)),
        icon('play'),
      )
    : null;

  // ---- mode tiles with card art
  const tile = (route: string, label: string, sub: string, art: string, badge?: string) => {
    const bg = h('div', { class: 'home-tile-art' });
    artInto(bg, art);
    return h(
      'button',
      { type: 'button', class: 'home-tile', onclick: () => go(route) },
      bg,
      h('div', { class: 'home-tile-shade' }),
      badge ? h('span', { class: 'home-badge' }, badge) : null,
      h('span', { class: 'home-tile-text' }, h('b', null, label), h('span', null, sub)),
    );
  };
  const tiles = h(
    'section',
    { class: 'home-tiles' },
    tile('draft', 'Draft', 'Open packs, build a deck', 'Gold Sarcophagus', 'New'),
    tile('tournament', 'Tournament', 'Swiss + Top 8', 'Judgment Dragon'),
    tile('exhibition', 'Watch', 'AI vs AI', 'Stardust Dragon'),
    tile('deck-builder', 'Decks', 'Build and edit', 'Brionac, Dragon of the Ice Barrier'),
  );

  const row = (route: string, label: string, ic: keyof typeof ICONS) =>
    h('button', { type: 'button', class: 'home-row', onclick: () => go(route) }, h('span', { class: 'home-row-icon' }, icon(ic)), h('span', { class: 'home-row-label' }, label), icon('chevron'));
  const more = h(
    'section',
    { class: 'home-more' },
    row('database', 'Card Database', 'search'),
    row('customize', 'Sleeves & Playmat', 'palette'),
    row('rules', 'How to Play & Banlist', 'book'),
    row('settings', 'Settings', 'gear'),
  );

  const el = h(
    'div',
    { class: 'home', tabindex: '-1' },
    hero,
    h('div', { class: 'home-body' }, resume, h('h2', { class: 'home-h' }, 'Play'), tiles, more, h('p', { class: 'home-foot' }, 'Fan-made, non-commercial simulator. Not affiliated with the card game’s publisher.')),
  );

  return { el };
}

/** Fill an element with a card's official artwork as a background (fails quietly). */
function artInto(el: HTMLElement, cardName: string) {
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

void MENU;
void renderAvatar;
void sleevePreview;
void getSettings;
void emblemSVG;

/** Dark Armed Dragon artwork as the app mark; hidden where outside images are blocked. */
function titleMark(): HTMLElement {
  const img = new Image();
  img.className = 'title-mark';
  img.alt = '';
  img.decoding = 'async';
  img.hidden = true;
  img.onload = () => (img.hidden = false);
  img.onerror = () => img.remove();
  img.src = 'https://images.ygoprodeck.com/images/cards_cropped/65192027.jpg';
  return img;
}
