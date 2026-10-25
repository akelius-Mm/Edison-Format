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

/** Reset scrolling (the page may scroll on the window or on <body>). */
export function scrollToTop() {
  window.scrollTo(0, 0);
  document.body.scrollTop = 0;
  document.documentElement.scrollTop = 0;
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
  scrollToTop();
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

/**
 * Standard screen frame, iOS style: a slim sticky bar (back chevron, compact title, actions)
 * over a large title that scrolls away. Once the large title leaves the viewport the bar turns
 * translucent and shows the compact title. `compact` keeps only the slim bar (app-like screens).
 */
export function frame(
  title: Child,
  opts: { subtitle?: Child; actions?: Child; cls?: string; backTo?: () => void; backLabel?: string; compact?: boolean; eyebrow?: Child },
  ...body: Child[]
) {
  const compact = !!opts.compact;
  const back = h(
    'button',
    {
      type: 'button',
      class: 'frame-back',
      'aria-label': `Back to ${opts.backLabel ?? 'Home'}`,
      title: 'Back (Esc)',
      onclick: opts.backTo ?? (() => go('title')),
    },
    icon('back'),
    h('span', { class: 'frame-back-label' }, opts.backLabel ?? 'Home'),
  );
  const sub = opts.subtitle ? h('div', { class: 'frame-sub' }, opts.subtitle) : null;
  const head = h(
    'header',
    { class: 'frame-head' },
    back,
    h('div', { class: 'frame-titles' }, compact ? h('h1', { class: 'frame-title' }, title) : h('div', { class: 'frame-title', 'aria-hidden': 'true' }, cloneText(title))),
    h('div', { class: 'frame-actions' }, opts.actions ?? null),
  );
  const large = compact
    ? null
    : h(
        'div',
        { class: 'frame-large' },
        opts.eyebrow ? h('div', { class: 'frame-eyebrow' }, opts.eyebrow) : null,
        h('h1', { class: 'frame-large-title' }, title),
        sub,
      );
  const el = h('div', { class: ['frame', compact ? 'frame--compact' : 'frame--large', opts.cls], tabindex: '-1' }, head, large, h('main', { class: 'frame-body' }, ...body));
  if (large && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (ents) => {
        if (!el.isConnected) return io.disconnect();
        for (const e of ents) el.classList.toggle('is-scrolled', !e.isIntersecting && e.boundingClientRect.top < 80);
      },
      { rootMargin: '-56px 0px 0px 0px' },
    );
    const title = large.querySelector('.frame-large-title')!;
    requestAnimationFrame(() => io.observe(title));
  }
  return el;
}

/** The compact bar repeats the title as plain text. */
function cloneText(c: Child): Child {
  if (c instanceof Node) return c.textContent ?? '';
  return Array.isArray(c) ? c.map(cloneText) : c;
}

export { icon };
