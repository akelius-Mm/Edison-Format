// Minimal DOM helpers and shared UI widgets for the app shell (no framework).

export type Child = Node | string | number | null | undefined | false | Child[];
type Handler = (ev: any) => void;
export interface Props {
  class?: string | (string | false | null | undefined)[];
  style?: string | Partial<Record<string, string | number>>;
  dataset?: Record<string, string>;
  [k: string]: unknown;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) applyProps(el, props);
  append(el, children);
  return el;
}

function applyProps(el: HTMLElement, props: Props) {
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') {
      el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : String(v);
    } else if (k === 'style') {
      if (typeof v === 'string') el.style.cssText = v;
      else for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) if (sv != null) el.style.setProperty(sk.startsWith('--') ? sk : kebab(sk), String(sv));
    } else if (k === 'dataset') {
      Object.assign(el.dataset, v);
    } else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as Handler);
    } else if (k === 'html') {
      el.innerHTML = String(v);
    } else if (k in el && typeof v !== 'string') {
      (el as any)[k] = v;
    } else if (v === true) {
      el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
}

function kebab(s: string) {
  return s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
}

export function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function svg(markup: string, cls = 'icon'): HTMLElement {
  const span = document.createElement('span');
  span.className = cls;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = markup;
  return span;
}

// --------------------------------------------------------------- icons
const I = (body: string, vb = '0 0 24 24') =>
  `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  swords: I('<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/><path d="M9.5 6.5 21 18v3h-3L6.5 9.5" opacity=".0"/><path d="M14.5 6.5 18 3h3v3l-3.5 3.5"/><path d="m5 14 6 6"/><path d="m7 17-3 3"/><path d="m3 19 2 2"/>'),
  trophy: I('<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M17 5h3v2a4 4 0 0 1-4 4"/><path d="M7 5H4v2a4 4 0 0 0 4 4"/>'),
  cards: I('<rect x="3" y="5" width="11" height="15" rx="1.5" transform="rotate(-8 8.5 12.5)"/><rect x="10" y="4" width="11" height="15" rx="1.5"/><path d="m15.5 8.5-2 3.5h3l-2 3.5"/>'),
  book: I('<path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6.5A2.5 2.5 0 0 0 4 21.5v-2Z"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H19"/><path d="M9 7h6M9 10.5h4"/>'),
  palette: I('<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4.1-4-7.4-9-7.4Z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10" cy="7" r="1.2"/><circle cx="15" cy="7.5" r="1.2"/>'),
  gear: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
  scroll: I('<path d="M8 21h11a2 2 0 0 0 2-2v-1H10v1a2 2 0 0 1-4 0V5a2 2 0 0 0-2-2h11a2 2 0 0 1 2 2v13"/><path d="M4 3a2 2 0 0 0-2 2v2h4"/><path d="M10 8h4M10 12h4"/>'),
  eye: I('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  search: I('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  back: I('<path d="M15 18 9 12l6-6"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  minus: I('<path d="M5 12h14"/>'),
  x: I('<path d="M18 6 6 18M6 6l12 12"/>'),
  check: I('<path d="m5 12 5 5L20 7"/>'),
  copy: I('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'),
  trash: I('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>'),
  save: I('<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M7 3v5h8V3"/><rect x="7" y="13" width="10" height="6" rx="1"/>'),
  edit: I('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  download: I('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'),
  upload: I('<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/>'),
  shuffle: I('<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/>'),
  sort: I('<path d="M3 6h13M3 12h9M3 18h5"/><path d="m17 15 3 3 3-3" transform="translate(-2 0)"/><path d="M18 6v12" transform="translate(-2 0)"/>'),
  play: I('<path d="M7 4v16l13-8Z"/>'),
  robot: I('<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 7V3"/><circle cx="12" cy="3" r="1"/><circle cx="9" cy="13" r="1.3"/><circle cx="15" cy="13" r="1.3"/><path d="M2 12v3M22 12v3"/>'),
  user: I('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  dice: I('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="16" cy="16" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="16" cy="8" r="1.2" fill="currentColor"/><circle cx="8" cy="16" r="1.2" fill="currentColor"/>'),
  flag: I('<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>'),
  bracket: I('<path d="M3 5h5v6H3M3 13h5v6H3"/><path d="M8 8h4v8H8"/><path d="M12 12h5"/><path d="M17 9h4v6h-4z"/>'),
  list: I('<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>'),
  grid: I('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  hand: I('<path d="M7 11V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M10 10V4a1.5 1.5 0 0 1 3 0v6"/><path d="M13 10V5a1.5 1.5 0 0 1 3 0v7"/><path d="M16 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L3 15a1.6 1.6 0 0 1 2.4-2.1L7 14.5V11"/>'),
  bolt: I('<path d="M13 2 4 14h7l-1 8 9-12h-7Z"/>'),
  info: I('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'),
  warn: I('<path d="M12 3 2 21h20Z"/><path d="M12 10v5M12 18v.5"/>'),
  crown: I('<path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5Z"/>'),
  medal: I('<circle cx="12" cy="15" r="6"/><path d="M8.5 10 6 3h4l2 4 2-4h4l-2.5 7"/><path d="m12 12 1 2h2l-1.5 1.3.5 2.2-2-1.2-2 1.2.5-2.2L9 14h2Z"/>'),
  refresh: I('<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>'),
  clipboard: I('<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M9 10h6M9 14h6M9 18h3"/>'),
  door: I('<path d="M14 3H6v18h8"/><path d="M10 12h11"/><path d="m18 8 4 4-4 4"/>'),
  keyboard: I('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
};

export function icon(name: keyof typeof ICONS, cls = 'icon') {
  return svg(ICONS[name], cls);
}

// --------------------------------------------------------------- buttons & controls

export function button(
  label: Child,
  onClick: (ev: MouseEvent) => void,
  opts: { variant?: 'primary' | 'ghost' | 'danger' | 'subtle' | 'gold'; icon?: keyof typeof ICONS; small?: boolean; title?: string; disabled?: boolean; cls?: string } = {},
) {
  const b = h(
    'button',
    {
      type: 'button',
      class: ['btn', opts.variant && `btn-${opts.variant}`, opts.small && 'btn-sm', opts.cls],
      title: opts.title,
      'aria-label': opts.title,
      onclick: (e: MouseEvent) => {
        if (b.disabled) return;
        onClick(e);
      },
    },
    opts.icon ? icon(opts.icon) : null,
    label != null && label !== '' ? h('span', { class: 'btn-label' }, label) : null,
  );
  if (opts.disabled) b.disabled = true;
  return b;
}

/** Segmented control (radio group). */
export function segmented<T extends string | number>(
  options: { value: T; label: string; hint?: string }[],
  value: T,
  onChange: (v: T) => void,
  ariaLabel = 'Options',
) {
  const wrap = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': ariaLabel });
  let cur = value;
  const btns = options.map((o) => {
    const b = h(
      'button',
      {
        type: 'button',
        class: 'seg-btn',
        role: 'radio',
        title: o.hint,
        onclick: () => set(o.value, true),
        onkeydown: (e: KeyboardEvent) => {
          const i = options.findIndex((x) => x.value === cur);
          let ni = -1;
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') ni = (i + 1) % options.length;
          if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ni = (i - 1 + options.length) % options.length;
          if (ni >= 0) {
            e.preventDefault();
            set(options[ni].value, true);
            btns[ni].focus();
          }
        },
      },
      o.label,
    );
    return b;
  });
  const set = (v: T, fire: boolean) => {
    cur = v;
    btns.forEach((b, i) => {
      const on = options[i].value === v;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    if (fire) onChange(v);
  };
  set(value, false);
  append(wrap, btns);
  return Object.assign(wrap, { setValue: (v: T) => set(v, false) });
}

export function toggle(checked: boolean, onChange: (v: boolean) => void, label = '') {
  const input = h('input', { type: 'checkbox', class: 'toggle-input', 'aria-label': label });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'toggle' }, input, h('span', { class: 'toggle-track' }, h('span', { class: 'toggle-thumb' })));
}

export function field(label: string, control: Node, hint?: string) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null);
}

export function select<T extends string>(options: { value: T; label: string }[], value: T, onChange: (v: T) => void, aria = '') {
  const s = h('select', { class: 'select', 'aria-label': aria });
  for (const o of options) {
    const opt = h('option', { value: o.value }, o.label);
    if (o.value === value) opt.selected = true;
    s.appendChild(opt);
  }
  s.addEventListener('change', () => onChange(s.value as T));
  return s;
}

export function panel(title: Child, ...children: Child[]) {
  return h('section', { class: 'panel' }, title ? h('header', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, title)) : null, h('div', { class: 'panel-body' }, ...children));
}

export function badge(text: string, kind = '') {
  return h('span', { class: ['badge', kind && `badge-${kind}`] }, text);
}

// --------------------------------------------------------------- overlays

let toastHost: HTMLElement | null = null;
export function toast(msg: string, kind: 'info' | 'success' | 'error' | 'gold' = 'info', ms = 2600) {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastHost);
  }
  const t = h('div', { class: ['toast', `toast-${kind}`] }, msg);
  toastHost.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => {
    t.classList.remove('in');
    t.classList.add('out');
    setTimeout(() => t.remove(), 400);
  }, ms);
}

export interface ModalHandle {
  el: HTMLElement;
  close: () => void;
}

/** Generic modal. Escape closes unless `dismissable` is false. */
export function modal(
  title: Child,
  body: Child,
  actions: { label: string; variant?: 'primary' | 'ghost' | 'danger' | 'gold'; onClick?: (m: ModalHandle) => void | boolean; icon?: keyof typeof ICONS }[] = [],
  opts: { dismissable?: boolean; wide?: boolean; onClose?: () => void; cls?: string } = {},
): ModalHandle {
  const prevFocus = document.activeElement as HTMLElement | null;
  const dismissable = opts.dismissable !== false;
  const backdrop = h('div', { class: ['modal-backdrop', opts.cls] });
  const box = h('div', { class: ['modal', opts.wide && 'modal-wide'], role: 'dialog', 'aria-modal': 'true' });
  const close = () => {
    backdrop.classList.add('out');
    document.removeEventListener('keydown', onKey, true);
    setTimeout(() => backdrop.remove(), 220);
    opts.onClose?.();
    prevFocus?.focus?.();
  };
  const handle: ModalHandle = { el: box, close };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && dismissable) {
      e.stopPropagation();
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      const f = [...box.querySelectorAll<HTMLElement>('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'));
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', onKey, true);
  if (dismissable) backdrop.addEventListener('mousedown', (e) => e.target === backdrop && close());
  append(box, [
    title ? h('header', { class: 'modal-head' }, h('h2', null, title), dismissable ? button('', close, { variant: 'subtle', icon: 'x', title: 'Close', cls: 'modal-x' }) : null) : null,
    h('div', { class: 'modal-body' }, body),
    actions.length
      ? h(
          'footer',
          { class: 'modal-foot' },
          actions.map((a) =>
            button(
              a.label,
              () => {
                const r = a.onClick?.(handle);
                if (r !== false) close();
              },
              { variant: a.variant ?? 'ghost', icon: a.icon },
            ),
          ),
        )
      : null,
  ]);
  backdrop.appendChild(box);
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => {
    backdrop.classList.add('in');
    const primary = box.querySelector<HTMLElement>('.modal-foot .btn-primary, .modal-foot .btn-gold, .modal-foot .btn-danger') ?? box.querySelector<HTMLElement>('input,button');
    primary?.focus();
  });
  return handle;
}

export function confirmDialog(title: string, message: string, okLabel = 'Confirm', danger = false): Promise<boolean> {
  return new Promise((res) => {
    let done = false;
    modal(
      title,
      h('p', { class: 'modal-text' }, message),
      [
        { label: 'Cancel', variant: 'ghost', onClick: () => void ((done = true), res(false)) },
        { label: okLabel, variant: danger ? 'danger' : 'primary', onClick: () => void ((done = true), res(true)) },
      ],
      { onClose: () => !done && res(false) },
    );
  });
}

export function promptDialog(title: string, label: string, initial = '', okLabel = 'OK'): Promise<string | null> {
  return new Promise((res) => {
    let done = false;
    const input = h('input', { class: 'input', type: 'text', value: initial, maxlength: 48, 'aria-label': label });
    const m = modal(
      title,
      field(label, input),
      [
        { label: 'Cancel', onClick: () => void ((done = true), res(null)) },
        { label: okLabel, variant: 'primary', onClick: () => void ((done = true), res(input.value.trim() || null)) },
      ],
      { onClose: () => !done && res(null) },
    );
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        done = true;
        res(input.value.trim() || null);
        m.close();
      }
    });
    setTimeout(() => {
      input.focus();
      input.select();
    }, 30);
  });
}

/** Choose between options; resolves with the chosen index (never rejects; not dismissable). */
export function choiceDialog(title: string, message: Child, choices: { label: string; variant?: 'primary' | 'ghost' | 'gold'; icon?: keyof typeof ICONS }[]): Promise<number> {
  return new Promise((res) => {
    modal(
      title,
      typeof message === 'string' ? h('p', { class: 'modal-text' }, message) : message,
      choices.map((c, i) => ({ label: c.label, variant: c.variant, icon: c.icon, onClick: () => res(i) })),
      { dismissable: false },
    );
  });
}

export function uid(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function pct(n: number) {
  return (n * 100).toFixed(1) + '%';
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
export const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0));
