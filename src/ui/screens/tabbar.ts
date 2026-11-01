// App-style bottom tab bar (hidden during duels).
import { h, icon, ICONS } from './dom';
import { go, parseHash } from './nav';
import { haptic } from '../haptics';

// Five tabs, one area each. Settings and Profile open from the corner of the Play tab, which stays lit on them.
const TABS: { route: string; label: string; icon: keyof typeof ICONS; match: string[] }[] = [
  { route: 'title', label: 'Play', icon: 'swords', match: ['title', '', 'play', 'duel', 'exhibition', 'friend', 'friend-locals', 'profile', 'settings', 'customize', 'rules', 'guide'] },
  { route: 'events', label: 'Events', icon: 'trophy', match: ['events', 'locals', 'tournament'] },
  { route: 'draft', label: 'Draft', icon: 'cards', match: ['draft'] },
  { route: 'collection', label: 'Collection', icon: 'store', match: ['collection', 'packs', 'binder', 'shop', 'trade'] },
  { route: 'deck-builder', label: 'Decks', icon: 'edit', match: ['deck-builder', 'database'] },
];

export function mountTabBar() {
  const bar = h(
    'nav',
    { class: 'tabbar', 'aria-label': 'Main' },
    ...TABS.map((t) =>
      h('button', { type: 'button', class: 'tab', 'data-route': t.route, onclick: () => (haptic('selection'), go(t.route)) }, icon(t.icon), h('span', null, t.label)),
    ),
  );
  document.body.appendChild(bar);
  document.body.classList.add('has-tabbar');
  const sync = () => {
    const name = parseHash().name;
    for (const b of bar.querySelectorAll<HTMLButtonElement>('.tab')) {
      const t = TABS.find((x) => x.route === b.dataset.route)!;
      const on = t.match.includes(name);
      b.classList.toggle('on', on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    }
  };
  window.addEventListener('hashchange', sync);
  sync();
}
