// Modal dialogs and prompts used by the human controller.
import type { CardData, CardInstance } from '../../engine/card';
import type { Activation, ConfirmRequest, OptionRequest, ResponseRequest, SelectRequest } from '../../engine/controller';
import type { Game } from '../../engine/game';
import type { BattlePos, PlayerId } from '../../engine/types';
import { artThumb, renderCard } from '../cards/render';
import { ICONS } from '../cards/icons';
import { zoomCard } from '../cards/zoom';
import { findCard } from '../../cards/define';
import { esc } from '../theme/util';
import type { Sfx } from './sound';

export interface ActionBtn {
  label: string;
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  onClick: () => void;
  disabled?: boolean;
  hotkey?: string;
}

export interface ModalOpts {
  title: string;
  subtitle?: string;
  source?: CardData;
  body?: HTMLElement;
  actions?: ActionBtn[];
  className?: string;
  /** Docked, non-blocking panel instead of a centered modal. */
  docked?: boolean;
  /** Allow temporarily hiding the dialog to look at the board. */
  peek?: boolean;
  /** Clicking the backdrop / pressing Escape closes (viewers). */
  dismissible?: boolean;
  onDismiss?: () => void;
}

export interface ModalHandle {
  el: HTMLElement;
  close(): void;
  setDisabled(i: number, d: boolean): void;
  setSubtitle(s: string): void;
}

export interface PromptCtx {
  game: Game;
  viewer: PlayerId;
  sleeves: [string, string];
  sfx: Sfx;
  preview(c: CardInstance | CardData): void;
  highlight(uids: number[], cls: string): void;
  clearHighlight(cls: string): void;
}

const LOC_NAMES: Record<string, string> = {
  hand: 'Hand',
  mzone: 'Field',
  szone: 'Field',
  fzone: 'Field Zone',
  grave: 'GY',
  banished: 'Banished',
  deck: 'Deck',
  extra: 'Extra Deck',
  none: '',
};

/** Touch screens (no hover): prompts say "Tap" instead of "Click". */
export function isTouchUI() {
  return typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

/** Hold a finger on `el` (about 400 ms) to run `fn`; the tap that ends the hold does nothing else. */
export function onLongPress(el: HTMLElement, fn: () => void, ms = 400) {
  let timer = 0;
  let x = 0;
  let y = 0;
  let fired = false;
  const cancel = () => {
    window.clearTimeout(timer);
    timer = 0;
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    fired = false;
    x = e.clientX;
    y = e.clientY;
    cancel();
    timer = window.setTimeout(() => {
      timer = 0;
      fired = true;
      navigator.vibrate?.(8);
      fn();
    }, ms);
  });
  el.addEventListener('pointermove', (e) => {
    if (timer && Math.hypot(e.clientX - x, e.clientY - y) > 10) cancel();
  });
  for (const t of ['pointerup', 'pointercancel', 'pointerleave'] as const) el.addEventListener(t, cancel);
  el.addEventListener(
    'click',
    (e) => {
      if (!fired) return;
      fired = false;
      e.stopImmediatePropagation();
      e.preventDefault();
    },
    true,
  );
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const READ_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15 15l5 5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';

/** A small corner button that opens the card to read it, without triggering the tile. */
function readButton(fn: () => void, cls = 'tile-zoom'): HTMLButtonElement {
  const b = h('button', cls, READ_SVG) as HTMLButtonElement;
  b.type = 'button';
  b.title = 'Read card';
  b.setAttribute('aria-label', 'Read card');
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    fn();
  });
  return b;
}

/** Corner read button plus long-press on `el`, both opening the card enlarged. */
function readable(el: HTMLElement, open: () => void, btnCls?: string) {
  onLongPress(el, open);
  const b = readButton(open, btnCls);
  el.appendChild(b);
  return b;
}

/** One-line hint above card choices, for touch screens. */
function touchHint(text: string): HTMLElement | null {
  return isTouchUI() ? h('div', 'dlg-hint', esc(text)) : null;
}

export class Dialogs {
  private open = new Set<ModalHandle>();
  private keyHandler: (e: KeyboardEvent) => void;
  private menu: HTMLElement | null = null;

  constructor(
    readonly host: HTMLElement,
    private sfx: Sfx,
  ) {
    this.keyHandler = (e) => {
      if (e.key === 'Escape') {
        if (this.menu) {
          this.closeMenu();
          return;
        }
        const top = [...this.open].pop();
        const dis = top?.el.dataset.dismissible === '1';
        if (top && dis) top.el.dispatchEvent(new CustomEvent('dismiss'));
      }
      const top = [...this.open].pop();
      if (!top) return;
      const btn = top.el.querySelector(`[data-hotkey="${e.key === ' ' ? 'Space' : e.key}"]`) as HTMLButtonElement | null;
      if (btn && !btn.disabled && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        btn.click();
      }
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  dispose() {
    window.removeEventListener('keydown', this.keyHandler);
    this.closeAll();
  }

  closeAll() {
    for (const m of [...this.open]) m.close();
    this.closeMenu();
  }

  modal(o: ModalOpts): ModalHandle {
    const layer = h('div', `dlg-layer${o.docked ? ' dlg-layer--docked' : ''} ${o.className ?? ''}`);
    const box = h('div', 'dlg');
    const head = h('div', 'dlg-head');
    if (o.source) {
      const src = artThumb(o.source, 'dlg-src');
      const data = o.source;
      src.title = 'Read card';
      src.addEventListener('click', () => zoomCard(data));
      head.appendChild(src);
    }
    const titles = h('div', 'dlg-titles');
    const t = h('div', 'dlg-title');
    t.textContent = o.title;
    const sub = h('div', 'dlg-sub');
    if (o.subtitle) sub.textContent = o.subtitle;
    titles.append(t, sub);
    head.appendChild(titles);
    if (o.peek) {
      const pk = h('button', 'icon-btn dlg-peek', ICONS.eye) as HTMLButtonElement;
      pk.title = 'Hide to view the field';
      pk.onclick = () => layer.classList.add('is-peeking');
      head.appendChild(pk);
      const restore = h('button', 'btn btn--primary dlg-restore', `${ICONS.eye}<span>Show: ${esc(o.title)}</span>`) as HTMLButtonElement;
      restore.onclick = () => layer.classList.remove('is-peeking');
      layer.appendChild(restore);
    }
    if (o.dismissible) {
      const x = h('button', 'icon-btn dlg-x', ICONS.close) as HTMLButtonElement;
      x.title = 'Close';
      x.onclick = () => layer.dispatchEvent(new CustomEvent('dismiss'));
      head.appendChild(x);
      layer.dataset.dismissible = '1';
      layer.addEventListener('pointerdown', (e) => {
        if (e.target === layer) layer.dispatchEvent(new CustomEvent('dismiss'));
      });
    }
    box.appendChild(head);
    if (o.body) {
      o.body.classList.add('dlg-body');
      box.appendChild(o.body);
    }
    const buttons: HTMLButtonElement[] = [];
    if (o.actions?.length) {
      const bar = h('div', 'dlg-actions');
      for (const a of o.actions) {
        const b = h('button', `btn btn--${a.kind ?? 'secondary'}`) as HTMLButtonElement;
        b.innerHTML = `<span>${esc(a.label)}</span>${a.hotkey ? `<kbd>${a.hotkey === ' ' ? 'Space' : a.hotkey}</kbd>` : ''}`;
        if (a.hotkey) b.dataset.hotkey = a.hotkey === ' ' ? 'Space' : a.hotkey;
        b.disabled = !!a.disabled;
        b.onclick = () => {
          this.sfx.play('click');
          a.onClick();
        };
        buttons.push(b);
        bar.appendChild(b);
      }
      box.appendChild(bar);
    }
    layer.appendChild(box);
    this.host.appendChild(layer);
    requestAnimationFrame(() => layer.classList.add('is-open'));
    const handle: ModalHandle = {
      el: layer,
      close: () => {
        if (!this.open.has(handle)) return;
        this.open.delete(handle);
        layer.classList.remove('is-open');
        layer.classList.add('is-closing');
        window.setTimeout(() => layer.remove(), 180);
      },
      setDisabled: (i, d) => {
        if (buttons[i]) buttons[i].disabled = d;
      },
      setSubtitle: (s) => {
        sub.textContent = s;
      },
    };
    layer.addEventListener('dismiss', () => {
      handle.close();
      o.onDismiss?.();
    });
    this.open.add(handle);
    return handle;
  }

  // ------------------------------------------------------------ context menu
  menuAt(x: number, y: number, title: string, items: { label: string; sub?: string; onClick: () => void; kind?: string }[]) {
    this.closeMenu();
    const m = h('div', 'ctx-menu');
    if (title) m.appendChild(h('div', 'ctx-title', esc(title)));
    for (const it of items) {
      const b = h('button', `ctx-item ${it.kind ?? ''}`, `<span>${esc(it.label)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}`) as HTMLButtonElement;
      b.onclick = (e) => {
        e.stopPropagation();
        this.sfx.play('click');
        this.closeMenu();
        it.onClick();
      };
      m.appendChild(b);
    }
    this.host.appendChild(m);
    const hr = this.host.getBoundingClientRect();
    const mr = m.getBoundingClientRect();
    let left = x - hr.left - mr.width / 2;
    let top = y - hr.top - mr.height - 12;
    if (top < 8) top = y - hr.top + 16;
    left = Math.max(8, Math.min(hr.width - mr.width - 8, left));
    top = Math.max(8, Math.min(hr.height - mr.height - 8, top));
    m.style.left = `${left}px`;
    m.style.top = `${top}px`;
    this.menu = m;
    const off = (e: Event) => {
      if (this.menu && !this.menu.contains(e.target as Node)) {
        this.closeMenu();
      }
    };
    window.setTimeout(() => window.addEventListener('pointerdown', off, { once: true, capture: true }), 0);
  }

  closeMenu() {
    this.menu?.remove();
    this.menu = null;
  }

  // ------------------------------------------------------------ helpers
  cardTile(c: CardInstance, ctx: PromptCtx, opts: { caption?: string; faceDown?: boolean; readable?: boolean } = {}): HTMLElement {
    const tile = h('div', 'tile');
    const visible = !opts.faceDown;
    const card = renderCard(c.data, { size: 'md', faceDown: !visible, sleeve: ctx.sleeves[c.owner], instance: c, game: ctx.game });
    tile.appendChild(card);
    if (opts.caption) tile.appendChild(h('div', 'tile-cap', esc(opts.caption)));
    if (visible) tile.addEventListener('pointerenter', () => ctx.preview(c));
    if (visible && opts.readable) readable(tile, () => zoomCard(c.data, { instance: c, game: ctx.game }));
    return tile;
  }
}

export function visibleTo(game: Game, c: CardInstance, viewer: PlayerId) {
  if (game.isPublic(c, viewer)) return true;
  if ((c.location === 'deck' || c.location === 'hand' || c.location === 'extra') && c.owner === viewer) return true;
  if (c.onField && c.controller === viewer) return true;
  return false;
}

export function locCaption(game: Game, c: CardInstance, viewer: PlayerId) {
  const side = (c.onField ? c.controller : c.owner) === viewer ? 'Your' : "Opp.";
  let loc = LOC_NAMES[c.location] ?? c.location;
  if (c.location === 'mzone') loc = c.faceUp ? (c.pos === 'atk' ? 'Field · ATK' : 'Field · DEF') : 'Field · Set';
  if (c.location === 'szone' && !c.faceUp) loc = 'Field · Set';
  return `${side} ${loc}`;
}

// ---------------------------------------------------------------- request dialogs
export function selectDialog(d: Dialogs, ctx: PromptCtx, req: SelectRequest): { promise: Promise<CardInstance[]>; close(): void } {
  const sel: CardInstance[] = [];
  let resolve!: (v: CardInstance[]) => void;
  const promise = new Promise<CardInstance[]>((r) => (resolve = r));
  const body = h('div', 'sel');
  const grid = h('div', 'sel-grid');
  const hint = touchHint('Tap to select · hold or tap the magnifier to read');
  if (hint) body.appendChild(hint);
  body.appendChild(grid);
  // Copies of one card in the Deck, Extra Deck or your hand are interchangeable: show them as
  // one tile with a ×N badge. Cards on the field or in a GY stay separate.
  type Group = { cards: CardInstance[]; tile: HTMLElement };
  const groups: Group[] = [];
  const byKey = new Map<string, Group>();
  const range = req.min === req.max ? `${req.min}` : `${req.min}–${req.max}`;
  const subtitle = () => `Selected ${sel.length} / ${range === '0' ? req.max : range}`;
  const ok = () => sel.length >= req.min && sel.length <= req.max;
  const refresh = () => {
    for (const g of groups) {
      const picked = g.cards.filter((c) => sel.includes(c));
      g.tile.classList.toggle('is-selected', picked.length > 0);
      const badge = g.tile.querySelector('.tile-sel') as HTMLElement;
      badge.innerHTML = !picked.length ? '' : g.cards.length > 1 && picked.length > 1 ? `×${picked.length}` : CHECK_SVG;
    }
    m.setDisabled(0, !ok());
    m.setSubtitle(subtitle());
  };
  const finish = (v: CardInstance[]) => {
    ctx.clearHighlight('is-candidate');
    m.close();
    resolve(v);
  };
  for (const c of req.candidates) {
    const vis = visibleTo(ctx.game, c, ctx.viewer);
    const stackable = vis && c.owner === ctx.viewer && (c.location === 'deck' || c.location === 'extra' || c.location === 'hand');
    const key = stackable ? `${c.location}:${c.data.id}` : '';
    const existing = key ? byKey.get(key) : undefined;
    if (existing) {
      existing.cards.push(c);
      const n = existing.tile.querySelector('.tile-count') ?? existing.tile.appendChild(h('div', 'tile-count'));
      n.textContent = `×${existing.cards.length}`;
      continue;
    }
    const tile = d.cardTile(c, ctx, { caption: locCaption(ctx.game, c, ctx.viewer), faceDown: !vis, readable: true });
    const g: Group = { cards: [c], tile };
    groups.push(g);
    if (key) byKey.set(key, g);
    tile.classList.add('tile--pick');
    tile.appendChild(h('div', 'tile-sel'));
    tile.addEventListener('click', () => {
      ctx.sfx.play('click');
      const picked = g.cards.filter((x) => sel.includes(x));
      const next = g.cards.find((x) => !sel.includes(x));
      if (req.max === 1) {
        // tap toggles: tapping the chosen card again clears the choice
        const was = picked.length > 0;
        sel.length = 0;
        if (!was) sel.push(g.cards[0]);
      } else if (next && sel.length < req.max) sel.push(next);
      // a full stack (or a full selection) gives back one copy per tap
      else if (picked.length) sel.splice(sel.indexOf(picked[picked.length - 1]), 1);
      else return;
      refresh();
    });
    tile.addEventListener('dblclick', () => {
      if (ok()) finish([...sel]);
    });
    grid.appendChild(tile);
  }
  const actions: ActionBtn[] = [{ label: 'Confirm', kind: 'primary', onClick: () => ok() && finish([...sel]), hotkey: 'Enter' }];
  if (req.cancelable) actions.push({ label: 'Cancel', kind: 'ghost', onClick: () => finish([]) });
  const m = d.modal({
    title: req.prompt,
    subtitle: subtitle(),
    source: req.source?.data,
    body,
    actions,
    peek: true,
    className: 'dlg--select',
  });
  ctx.highlight(
    req.candidates.filter((c) => c.onField).map((c) => c.uid),
    'is-candidate',
  );
  refresh();
  return { promise, close: () => finish([]) };
}

export function optionDialog(d: Dialogs, req: OptionRequest): Promise<number> {
  return new Promise((resolve) => {
    // Short choices (amounts, levels, attributes) read best as a grid of chips.
    const chips = req.options.length >= 3 && req.options.every((o) => o.length <= 12);
    const body = h('div', chips ? 'opt-list opt-list--chips' : 'opt-list');
    let m: ModalHandle;
    req.options.forEach((o, i) => {
      const b = h('button', 'btn btn--option', `<span>${esc(o)}</span>`) as HTMLButtonElement;
      b.onclick = () => {
        m.close();
        resolve(i);
      };
      body.appendChild(b);
    });
    m = d.modal({ title: req.prompt, source: req.source?.data, body, peek: true, className: 'dlg--option' });
  });
}

export function confirmDialog(d: Dialogs, req: ConfirmRequest, yes = 'Yes', no = 'No'): Promise<boolean> {
  return new Promise((resolve) => {
    let m: ModalHandle;
    const body = h('div', 'confirm-body');
    if (req.source && !req.prompt.includes(req.source.name)) body.textContent = req.source.name;
    m = d.modal({
      title: req.prompt,
      source: req.source?.data,
      body,
      peek: true,
      className: 'dlg--confirm',
      actions: [
        { label: yes, kind: 'primary', hotkey: 'Enter', onClick: () => (m.close(), resolve(true)) },
        { label: no, kind: 'ghost', hotkey: 'Escape', onClick: () => (m.close(), resolve(false)) },
      ],
    });
  });
}

export function positionDialog(d: Dialogs, ctx: PromptCtx, card: CardInstance, allowed: (BattlePos | 'set')[]): Promise<BattlePos | 'set'> {
  return new Promise((resolve) => {
    let m: ModalHandle;
    const body = h('div', 'pos-list');
    const labels: Record<string, string> = { atk: 'Attack Position', def: 'Defense Position', set: 'Set (face-down)' };
    for (const a of allowed) {
      const opt = h('button', `pos-opt pos-${a}`) as HTMLButtonElement;
      const holder = h('div', 'pos-card');
      const c = renderCard(card.data, { size: 'md', faceDown: a === 'set', sleeve: ctx.sleeves[card.owner] });
      holder.appendChild(c);
      opt.append(holder, h('div', 'pos-label', labels[a]));
      if (a !== 'set') onLongPress(opt, () => zoomCard(card.data, { instance: card, game: ctx.game }));
      opt.onclick = () => {
        ctx.sfx.play('click');
        m.close();
        resolve(a);
      };
      body.appendChild(opt);
    }
    m = d.modal({ title: `Choose a position for ${card.name}`, source: card.data, body, className: 'dlg--pos' });
  });
}

export function responseDialog(d: Dialogs, ctx: PromptCtx, req: ResponseRequest, title: string): Promise<Activation | null> {
  return new Promise((resolve) => {
    let m: ModalHandle;
    const body = h('div', 'resp-list');
    const top = ctx.game.chain[ctx.game.chain.length - 1];
    if (top && req.kind === 'chain') {
      const t = h('div', 'resp-top', `<div><small>Chain Link ${top.index}</small><b>${esc(top.card.name)}</b></div>`);
      t.prepend(artThumb(top.card.data));
      readable(t, () => zoomCard(top.card.data, { instance: top.card, game: ctx.game }), 'resp-read');
      t.addEventListener('pointerenter', () => ctx.preview(top.card));
      body.appendChild(t);
    }
    for (const o of req.options) {
      const row = h('button', 'resp-opt') as HTMLButtonElement;
      row.innerHTML = `<div class="resp-txt"><b>${esc(o.card.name)}</b><small>${esc(o.label === 'Activate' || o.label === 'Use effect' ? describeLoc(o.card) : o.label)}</small></div><span class="resp-go">Activate</span>`;
      row.prepend(artThumb(o.card.data));
      const read = readButton(() => zoomCard(o.card.data, { instance: o.card, game: ctx.game }), 'resp-read');
      row.insertBefore(read, row.querySelector('.resp-go'));
      onLongPress(row, () => zoomCard(o.card.data, { instance: o.card, game: ctx.game }));
      row.addEventListener('pointerenter', () => ctx.preview(o.card));
      row.onclick = () => {
        m.close();
        ctx.clearHighlight('is-response');
        resolve(o);
      };
      body.appendChild(row);
    }
    ctx.highlight(
      req.options.map((o) => o.card.uid),
      'is-response',
    );
    m = d.modal({
      title,
      subtitle: req.prompt,
      body,
      docked: true,
      className: 'dlg--response',
      actions: [
        {
          label: 'Pass',
          kind: 'secondary',
          hotkey: ' ',
          onClick: () => {
            m.close();
            ctx.clearHighlight('is-response');
            resolve(null);
          },
        },
      ],
    });
  });
}

function describeLoc(c: CardInstance) {
  if (c.location === 'hand') return 'From hand';
  if (c.location === 'szone' || c.location === 'fzone') return c.faceUp ? 'Face-up card' : 'Set card';
  if (c.location === 'grave') return 'From GY';
  return 'Effect';
}

export function declareDialog(d: Dialogs, prompt: string, names: string[]): Promise<string> {
  return new Promise((resolve) => {
    let m: ModalHandle;
    const body = h('div', 'declare');
    const input = h('input', 'declare-input') as HTMLInputElement;
    input.placeholder = 'Search card name…';
    const list = h('div', 'declare-list');
    const sorted = [...new Set(names)].sort();
    const draw = () => {
      const q = input.value.toLowerCase();
      list.innerHTML = '';
      for (const n of sorted.filter((x) => x.toLowerCase().includes(q)).slice(0, 120)) {
        const b = h('button', 'declare-item') as HTMLButtonElement;
        b.textContent = n;
        const data = findCard(n);
        if (data) onLongPress(b, () => zoomCard(data));
        b.onclick = () => {
          m.close();
          resolve(n);
        };
        list.appendChild(b);
      }
    };
    input.oninput = draw;
    body.append(input, list);
    draw();
    m = d.modal({ title: prompt, body, className: 'dlg--declare' });
    window.setTimeout(() => input.focus(), 50);
  });
}

/** Pile viewer (GY / banished / extra deck), optionally with per-card actions. */
export function pileViewer(
  d: Dialogs,
  ctx: PromptCtx,
  title: string,
  cards: CardInstance[],
  opts: {
    faceDown?: (c: CardInstance) => boolean;
    actions?: (c: CardInstance) => { label: string; onClick: () => void }[];
    /** Other piles to jump to (e.g. Banished from the Graveyard). */
    links?: { label: string; onClick: () => void }[];
  } = {},
): ModalHandle {
  const body = h('div', 'viewer');
  let m: ModalHandle;
  if (opts.links?.length) {
    const bar = h('div', 'viewer-links');
    for (const l of opts.links) {
      const b = h('button', 'viewer-link', `<span>${esc(l.label)}</span>`) as HTMLButtonElement;
      b.type = 'button';
      b.onclick = () => {
        m.close();
        l.onClick();
      };
      bar.appendChild(b);
    }
    body.appendChild(bar);
  }
  if (!cards.length) body.appendChild(h('div', 'viewer-empty', 'No cards.'));
  else if (cards.some((c) => !opts.faceDown?.(c))) {
    const hint = touchHint('Tap a card to read it');
    if (hint) body.appendChild(hint);
  }
  const grid = h('div', 'sel-grid');
  for (const c of [...cards].reverse()) {
    const hidden = !!opts.faceDown?.(c);
    const tile = d.cardTile(c, ctx, { faceDown: hidden });
    if (!hidden) {
      // Tapping the card itself always opens it to read; actions sit underneath.
      const face = tile.firstElementChild as HTMLElement;
      face.classList.add('tile-face');
      face.addEventListener('click', (e) => {
        e.stopPropagation();
        zoomCard(c.data, { instance: c, game: ctx.game });
      });
    }
    const acts = opts.actions?.(c) ?? [];
    if (acts.length) {
      tile.classList.add('tile--act');
      const bar = h('div', 'tile-acts');
      for (const a of acts) {
        const b = h('button', 'btn btn--primary btn--xs', `<span>${esc(a.label)}</span>`) as HTMLButtonElement;
        b.onclick = (e) => {
          e.stopPropagation();
          m.close();
          a.onClick();
        };
        bar.appendChild(b);
      }
      tile.appendChild(bar);
    }
    grid.appendChild(tile);
  }
  body.appendChild(grid);
  m = d.modal({ title, subtitle: `${cards.length} card${cards.length === 1 ? '' : 's'}`, body, dismissible: true, className: 'dlg--viewer' });
  return m;
}
