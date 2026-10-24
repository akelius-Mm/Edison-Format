// Hash router with animated screen transitions.
import { button, h, icon, type Child } from './dom';

export interface Screen {
  el: HTMLElement;
  /** Called when the screen is removed. */
  dispose?: () => void;
  /** Called after the screen is attached (focus management etc.). */
  onShow?: () => void;
  /** Return true if Escape was handled. */
  onEscape?: () => boolean;
}
export type Params = Record<string, string>;
export type ScreenFactory = (params: Params) => Screen;

const routes = new Map<string, ScreenFactory>();
let root: HTMLElement;
let current: { screen: Screen; key: string } | null = null;
let locked = 0;

export function registerRoute(name: string, f: ScreenFactory) {
  routes.set(name, f);
}

export function parseHash(): { name: string; params: Params } {
  const raw = location.hash.replace(/^#\/?/, '');
  const [name, q] = raw.split('?');
  const params: Params = {};
  if (q) new URLSearchParams(q).forEach((v, k) => (params[k] = v));
  return { name: name || 'title', params };
}

export function go(name: string, params: Params = {}, opts: { replace?: boolean } = {}) {
  const q = new URLSearchParams(params).toString();
  const hash = `#/${name}${q ? '?' + q : ''}`;
  if (location.hash === hash) {
    render();
    return;
  }
  if (opts.replace) {
    history.replaceState(null, '', hash);
    render();
  } else location.hash = hash;
}

export function back() {
  go('title');
}

/** Mount a screen that is not addressable by URL (results, interstitials). */
export function showScreen(screen: Screen, key = 'adhoc') {
  mount(screen, key);
}

/** While locked (e.g. a duel is running) Escape doesn't navigate. */
export function lockNav(on: boolean) {
  locked = Math.max(0, locked + (on ? 1 : -1));
}
export const isNavLocked = () => locked > 0;

function render() {
  const { name, params } = parseHash();
  const f = routes.get(name) ?? routes.get('title')!;
  let screen: Screen;
  try {
    screen = f(params);
  } catch (e) {
    console.error(e);
    screen = errorScreen(e);
  }
  mount(screen, name);
}

function mount(screen: Screen, key: string) {
  const prev = current;
  current = { screen, key };
  screen.el.classList.add('screen', 'screen-enter');
  root.appendChild(screen.el);
  window.scrollTo(0, 0);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => screen.el.classList.remove('screen-enter'));
  });
  if (prev) {
    const old = prev.screen;
    old.el.classList.add('screen-leave');
    old.el.setAttribute('aria-hidden', 'true');
    (old.el as any).inert = true;
    try {
      old.dispose?.();
    } catch (e) {
      console.error(e);
    }
    setTimeout(() => old.el.remove(), 380);
  }
  screen.onShow?.();
  if (!screen.el.contains(document.activeElement)) {
    const f = screen.el.querySelector<HTMLElement>('[autofocus], .screen-focus');
    (f ?? screen.el).focus?.({ preventScroll: true });
  }
}

function errorScreen(e: unknown): Screen {
  return {
    el: h(
      'div',
      { class: 'screen-error' },
      h('h1', null, 'Something went wrong'),
      h('pre', null, String((e as Error)?.stack ?? e)),
      button('Back to title', () => go('title'), { variant: 'primary' }),
    ),
  };
}

export function startRouter(el: HTMLElement) {
  root = el;
  window.addEventListener('hashchange', render);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || locked || e.defaultPrevented) return;
    if (document.querySelector('.modal-backdrop')) return;
    if (current?.screen.onEscape?.()) return;
    if (current && current.key !== 'title') {
      e.preventDefault();
      go('title');
    }
  });
  render();
}

/** Standard screen frame: header with back button, title and actions, then a body. */
export function frame(
  title: Child,
  opts: { subtitle?: Child; actions?: Child; cls?: string; backTo?: () => void; backLabel?: string },
  ...body: Child[]
) {
  const el = h(
    'div',
    { class: ['frame', opts.cls], tabindex: '-1' },
    h(
      'header',
      { class: 'frame-head' },
      button(opts.backLabel ?? 'Menu', opts.backTo ?? (() => go('title')), { variant: 'subtle', icon: 'back', cls: 'frame-back', title: 'Back (Esc)' }),
      h('div', { class: 'frame-titles' }, h('h1', { class: 'frame-title' }, title), opts.subtitle ? h('div', { class: 'frame-sub' }, opts.subtitle) : null),
      h('div', { class: 'frame-actions' }, opts.actions ?? null),
    ),
    h('main', { class: 'frame-body' }, ...body),
  );
  return el;
}

export { icon };
