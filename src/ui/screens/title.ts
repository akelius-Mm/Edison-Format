// Title screen with the main menu.
import { getSettings } from '../settings';
import { loadActiveTournament, currentRoundLabel } from '../../tournament/tournament';
import { h, icon, ICONS, type Child } from './dom';
import { renderAvatar, sleevePreview } from './ext';
import { go, type Screen } from './nav';
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
  const s = getSettings();
  const profile = getProfile();
  const ts = tournamentSummary();
  const active = loadActiveTournament();

  const items: HTMLButtonElement[] = [];
  const menu = h(
    'nav',
    { class: 'title-menu', 'aria-label': 'Main menu' },
    MENU.map((m, i) => {
      const b = h(
        'button',
        {
          type: 'button',
          class: ['menu-item', m.primary && 'menu-primary'],
          style: { '--i': i },
          onclick: () => go(m.route),
          onkeydown: (e: KeyboardEvent) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const n = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
              items[n].focus();
            } else if (e.key === 'Home') {
              e.preventDefault();
              items[0].focus();
            } else if (e.key === 'End') {
              e.preventDefault();
              items[items.length - 1].focus();
            }
          },
        },
        h('span', { class: 'menu-icon' }, icon(m.icon)),
        h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, m.label), h('span', { class: 'menu-desc' }, m.desc)),
        h('span', { class: 'menu-key', 'aria-hidden': 'true' }, m.key),
      );
      items.push(b);
      return b;
    }),
  );

  const gp = profile.games.w + profile.games.l + profile.games.d;
  const _plate = h(
    'button',
    { type: 'button', class: 'player-plate', onclick: () => go('customize'), title: 'Customize your profile' },
    h('span', { class: 'avatar-ring' }, renderAvatar(s.avatar, 52)),
    h(
      'span',
      { class: 'plate-text' },
      h('span', { class: 'plate-name' }, s.playerName),
      h(
        'span',
        { class: 'plate-stats' },
        gp ? `${profile.games.w}W · ${profile.games.l}L${profile.games.d ? ` · ${profile.games.d}D` : ''}` : 'No duels yet',
        ts.played ? ` · ${ts.wins} title${ts.wins === 1 ? '' : 's'} · best ${ordinal(ts.best!)}` : '',
      ),
    ),
  );

  const resume: Child = active
    ? h(
        'button',
        { type: 'button', class: 'resume-banner', onclick: () => go('tournament') },
        icon('trophy'),
        h('span', null, h('b', null, 'Resume tournament'), h('span', null, `${active.name} — ${currentRoundLabel(active)}`)),
        icon('play'),
      )
    : null;

  // decorative floating sleeves
  const floaters = h(
    'div',
    { class: 'title-floaters', 'aria-hidden': 'true' },
    [0, 1, 2, 3, 4].map((i) => {
      const c = sleevePreview(s.sleeve, 'md');
      return h('div', { class: `floater f${i}` }, c);
    }),
  );

  const el = h(
    'div',
    { class: 'title-screen', tabindex: '-1' },
    floaters,
    h(
      'div',
      { class: 'title-grid' },
      h(
        'section',
        { class: 'title-hero' },
        emblemSVG('emblem title-emblem'),
        titleMark(),
        h('div', { class: 'title-eyebrow' }, 'The April 2010 meta · Revived'),
        h('h1', { class: 'title-logo' }, h('span', { class: 'logo-main' }, 'Edison'), h('span', { class: 'logo-sub' }, 'Format Simulator')),
        h('p', { class: 'title-tag' }, 'Synchros, Plants, Blackwings and Monarchs. Duel the format many players still call the best ever.'),
      ),
      h('section', { class: 'title-side' }, resume, menu),
    ),
    h(
      'footer',
      { class: 'title-foot' },
      h('span', null, 'Fan-made, non-commercial simulator. Not affiliated with or endorsed by the trading card game’s publisher.'),
      h('span', { class: 'title-keys' }, h('span', { class: 'kbd' }, '↑'), h('span', { class: 'kbd' }, '↓'), ' navigate · ', h('span', { class: 'kbd' }, 'Enter'), ' select · ', h('span', { class: 'kbd' }, '1–8'), ' shortcuts'),
    ),
  );

  const onKey = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if ((e.target as HTMLElement)?.matches?.('input,textarea,select')) return;
    if (document.querySelector('.modal-backdrop')) return;
    const m = MENU.find((x) => x.key === e.key);
    if (m) {
      e.preventDefault();
      go(m.route);
    }
  };
  document.addEventListener('keydown', onKey);

  return {
    el,
    onShow: () => setTimeout(() => items[0]?.focus({ preventScroll: true }), 60),
    dispose: () => document.removeEventListener('keydown', onKey),
  };
}

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
