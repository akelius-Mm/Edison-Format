// App-style bottom tab bar (hidden during duels).
import { h, icon, ICONS } from './dom';
import { go, parseHash } from './nav';

const TABS: { route: string; label: string; icon: keyof typeof ICONS; match: string[] }[] = [
  { route: 'title', label: 'Home', icon: 'home', match: ['title', '', 'packs', 'binder', 'locals', 'events', 'profile'] },
  { route: 'duel', label: 'Duel', icon: 'swords', match: ['duel', 'exhibition'] },
  { route: 'draft', label: 'Draft', icon: 'cards', match: ['draft'] },
  { route: 'deck-builder', label: 'Decks', icon: 'edit', match: ['deck-builder', 'database'] },
  { route: 'settings', label: 'More', icon: 'gear', match: ['settings', 'customize', 'rules', 'tournament'] },
];

export function mountTabBar() {
  const bar = h(
    'nav',
    { class: 'tabbar', 'aria-label': 'Main' },
    ...TABS.map((t) =>
      h('button', { type: 'button', class: 'tab', 'data-route': t.route, onclick: () => go(t.route) }, icon(t.icon), h('span', null, t.label)),
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
