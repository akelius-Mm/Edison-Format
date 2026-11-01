// Side panels: player info (avatar/LP), phase tracker, chain stack, duel log and card preview.
import type { CardData, CardInstance } from '../../engine/card';
import type { Game, LogEntry } from '../../engine/game';
import type { Phase, PlayerId } from '../../engine/types';
import { artThumb, liveStats, renderCard, typeLine } from '../cards/render';
import { zoomCard } from '../cards/zoom';
import { renderAvatar } from '../theme/avatars';
import { isTouchUI } from './dialogs';
import { esc } from '../theme/util';
import type { DuelSide } from './api';
import { lpEase } from './sound';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

// ---------------------------------------------------------------- player panel
const svg = (d: string) => `<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
/** Cards fanned in a hand. */
const ICON_HAND = svg('<rect x="3" y="6" width="9" height="13" rx="1.5" transform="rotate(-12 7.5 12.5)"/><rect x="12" y="5" width="9" height="13" rx="1.5" transform="rotate(10 16.5 11.5)"/>');
/** A deck: a stack of cards. */
const ICON_DECK = svg('<rect x="6" y="3" width="12" height="16" rx="1.5"/><path d="M6 21h12"/><path d="M7 23h10" opacity=".5"/>');
/** The Graveyard: a card face up with a discard mark. */
const ICON_GY = svg('<rect x="6" y="3" width="12" height="18" rx="1.5"/><path d="m9.5 9 5 5m0-5-5 5"/>');

export class PlayerPanel {
  readonly el: HTMLElement;
  private lpNum: HTMLElement;
  private lpFill: HTMLElement;
  private lpGhost: HTMLElement;
  private stats: HTMLElement;
  private shownLp: number;
  private targetLp: number;
  private raf = 0;
  readonly avatarEl: HTMLElement;
  readonly name: string;
  /** Every Life Point total this duel, with the turn it changed on (the scorepad). */
  readonly lpHistory: { lp: number; turn: number }[];
  /** Tap on the Life Points: open the scorepad. */
  onLpTap?: () => void;
  /** Called when the LP number starts rolling, with the roll length in ms (for the counter sound). */
  onLpRoll?: (ms: number, up: boolean, amount: number) => void;

  constructor(
    side: DuelSide,
    readonly p: PlayerId,
    readonly isMe: boolean,
    private startLp: number,
    private speed: () => number,
  ) {
    this.el = h('div', `pp ${isMe ? 'pp--me' : 'pp--opp'}`);
    this.avatarEl = h('div', 'pp-avatar');
    this.avatarEl.appendChild(renderAvatar(side.avatar, 64));
    const info = h('div', 'pp-info');
    const name = h('div', 'pp-name');
    name.textContent = side.name;
    const title = h('div', 'pp-title');
    title.textContent = side.title ?? (side.control === 'human' ? 'Duelist' : `AI · ${side.control[0].toUpperCase()}${side.control.slice(1)}`);
    this.name = side.name;
    this.lpHistory = [{ lp: startLp, turn: 0 }];
    const lpRow = h('div', 'pp-lprow');
    lpRow.title = 'Scorepad';
    lpRow.addEventListener('click', (ev) => {
      if (!this.onLpTap) return;
      ev.stopPropagation();
      this.onLpTap();
    });
    const lpLabel = h('span', 'pp-lplabel', 'LP');
    this.lpNum = h('span', 'pp-lp');
    lpRow.append(lpLabel, this.lpNum);
    const bar = h('div', 'pp-bar');
    this.lpGhost = h('div', 'pp-bar-ghost');
    this.lpFill = h('div', 'pp-bar-fill');
    bar.append(this.lpGhost, this.lpFill);
    this.stats = h('div', 'pp-stats');
    info.append(name, title, lpRow, bar, this.stats);
    this.el.append(this.avatarEl, info);
    this.shownLp = startLp;
    this.targetLp = startLp;
    this.lpNum.textContent = String(startLp);
  }

  update(game: Game) {
    const ps = game.players[this.p];
    this.el.classList.toggle('is-turn', game.turnPlayer === this.p && game.turn > 0);
    const s = `<span title="Hand" aria-label="Hand ${ps.hand.length}">${ICON_HAND}${ps.hand.length}</span><span title="Deck" aria-label="Deck ${ps.deck.length}">${ICON_DECK}${ps.deck.length}</span><span title="Graveyard" aria-label="Graveyard ${ps.grave.length}">${ICON_GY}${ps.grave.length}</span>`;
    if (this.stats.innerHTML !== s) this.stats.innerHTML = s;
    if (ps.lp !== this.lpHistory[this.lpHistory.length - 1].lp) this.lpHistory.push({ lp: ps.lp, turn: game.turn });
    this.setLp(ps.lp);
  }

  /** Tap-to-hurry: show the final LP now. */
  finishLp() {
    if (this.shownLp === this.targetLp) return;
    cancelAnimationFrame(this.raf);
    this.shownLp = this.targetLp;
    this.lpNum.textContent = String(this.targetLp);
    this.lpNum.classList.remove('dmg', 'heal');
  }

  /** Restart a one-shot CSS animation class (the LP flash and punch). */
  private pulse(el: HTMLElement, cls: string[], on: string[], ms: number) {
    el.classList.remove(...cls);
    void el.offsetWidth;
    el.classList.add(...on);
    window.setTimeout(() => el.classList.remove(...on), ms);
  }

  setLp(lp: number) {
    if (lp === this.targetLp) return;
    const from = this.shownLp;
    this.targetLp = lp;
    const pct = Math.max(0, Math.min(1, lp / Math.max(this.startLp, lp, 1)));
    // scaleX, not width: the bar animates on the compositor
    this.lpFill.style.transform = `scaleX(${pct.toFixed(4)})`;
    this.lpGhost.style.transform = `scaleX(${pct.toFixed(4)})`;
    this.el.classList.toggle('is-low', lp <= this.startLp * 0.25);
    // bigger changes roll a little longer (a 500 hit ~0.5 s, 4000 ~1.1 s at Normal speed)
    const amount = Math.abs(lp - from);
    const sp = this.speed();
    const dur = (450 + Math.min(650, amount * 0.16)) * sp;
    cancelAnimationFrame(this.raf);
    if (dur <= 0) {
      this.shownLp = lp;
      this.lpNum.textContent = String(lp);
      return;
    }
    this.lpNum.classList.toggle('dmg', lp < from);
    this.lpNum.classList.toggle('heal', lp > from);
    if (lp !== from) {
      this.onLpRoll?.(dur, lp > from, amount);
      // the panel flashes red (green when healing) and the number takes the hit; big hits jolt it
      const flash = lp < from ? (amount >= 2000 ? ['lp-hit', 'is-big'] : ['lp-hit']) : ['lp-heal'];
      this.pulse(this.el, ['lp-hit', 'lp-heal', 'is-big'], flash, 700 * sp + 60);
    }
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = lpEase(k);
      this.shownLp = Math.round(from + (lp - from) * e);
      this.lpNum.textContent = String(this.shownLp);
      if (k < 1) this.raf = requestAnimationFrame(step);
      else this.lpNum.classList.remove('dmg', 'heal');
    };
    this.raf = requestAnimationFrame(step);
  }
}

// ---------------------------------------------------------------- phase tracker
const PHASES: [Phase, string, string][] = [
  ['draw', 'DP', 'Draw'],
  ['standby', 'SP', 'Standby'],
  ['main1', 'M1', 'Main 1'],
  ['battle', 'BP', 'Battle'],
  ['main2', 'M2', 'Main 2'],
  ['end', 'EP', 'End'],
];

export class PhaseBar {
  readonly el: HTMLElement;
  private items = new Map<Phase, HTMLElement>();
  private turnEl: HTMLElement;
  /** Spectating: whose turn by name instead of "Your turn". */
  private names: [string, string] | null = null;
  readonly btnBattle: HTMLButtonElement;
  readonly btnMain2: HTMLButtonElement;
  readonly btnEnd: HTMLButtonElement;

  constructor(private me: PlayerId) {
    this.el = h('div', 'phasebar');
    this.turnEl = h('div', 'phasebar-turn');
    const list = h('div', 'phasebar-list');
    for (const [ph, abbr, full] of PHASES) {
      const it = h('div', 'ph', `<b>${abbr}</b><span>${full}</span>`);
      it.dataset.phase = ph;
      this.items.set(ph, it);
      list.appendChild(it);
    }
    const btns = h('div', 'phasebar-btns');
    this.btnBattle = h('button', 'btn btn--phase', '<span>Battle Phase</span>') as HTMLButtonElement;
    this.btnMain2 = h('button', 'btn btn--phase', '<span>Main Phase 2</span>') as HTMLButtonElement;
    this.btnEnd = h('button', 'btn btn--phase btn--end', '<span>End Turn</span>') as HTMLButtonElement;
    for (const b of [this.btnBattle, this.btnMain2, this.btnEnd]) b.disabled = true;
    btns.append(this.btnBattle, this.btnMain2, this.btnEnd);
    this.el.append(this.turnEl, list, btns);
  }

  update(game: Game) {
    const mine = game.turnPlayer === this.me;
    this.el.classList.toggle('is-opp-turn', !mine);
    const whose = this.names ? `${esc(this.names[game.turnPlayer])}'s turn` : mine ? 'Your turn' : "Opponent's turn";
    const t = game.turn ? `Turn ${game.turn} · <span>${whose}</span>` : 'Preparing…';
    if (this.turnEl.innerHTML !== t) this.turnEl.innerHTML = t;
    const idx = PHASES.findIndex(([p]) => p === game.phase);
    PHASES.forEach(([p], i) => {
      const it = this.items.get(p)!;
      it.classList.toggle('is-current', i === idx && game.turn > 0);
      it.classList.toggle('is-past', i < idx);
    });
  }

  setSpectatorLabels(names: [string, string]) {
    this.names = names;
    this.el.classList.add('is-spectating');
  }
}

// ---------------------------------------------------------------- chain stack
export class ChainStack {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private keys = '';

  constructor(private me: PlayerId) {
    this.el = h('div', 'chain');
    this.el.innerHTML = '<div class="chain-title">Chain</div>';
    this.list = h('div', 'chain-list');
    this.el.appendChild(this.list);
    this.el.hidden = true;
  }

  update(game: Game) {
    const links = game.chain;
    const resolving = game.resolvingLink?.index ?? 0;
    const key = links.map((l) => `${l.index}:${l.card.uid}:${l.negated ? 1 : 0}`).join('|') + `#${resolving}`;
    if (key === this.keys) return;
    this.keys = key;
    this.el.hidden = links.length === 0;
    const existing = new Map<string, HTMLElement>();
    for (const c of [...this.list.children] as HTMLElement[]) existing.set(c.dataset.k!, c);
    const frag: HTMLElement[] = [];
    for (const l of [...links].reverse()) {
      const k = `${l.index}:${l.card.uid}`;
      let row = existing.get(k);
      if (!row) {
        row = h('div', `chain-link ${l.player === this.me ? 'is-me' : 'is-opp'}`);
        row.dataset.k = k;
        row.innerHTML = `<div class="chain-num">${l.index}</div><div class="chain-info"><div class="chain-name">${esc(l.card.name)}</div><div class="chain-label">${esc(l.isCardActivation ? 'Activation' : l.effect.label ?? 'Effect')}</div></div>`;
        row.insertBefore(artThumb(l.card.data, 'chain-art'), row.querySelector('.chain-info'));
        row.classList.add('enter');
      }
      row.classList.toggle('is-resolving', l.index === resolving);
      row.classList.toggle('is-negated', l.negated);
      frag.push(row);
    }
    this.list.replaceChildren(...frag);
  }

  linkEl(index: number): HTMLElement | null {
    return [...this.list.children].find((c) => (c as HTMLElement).dataset.k?.startsWith(`${index}:`)) as HTMLElement | null;
  }
}

// ---------------------------------------------------------------- log
export class LogPanel {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private lastTurn = -1;

  constructor(private me: PlayerId) {
    this.el = h('div', 'log');
    const head = h('div', 'log-head', '<span>Duel Log</span>');
    this.list = h('div', 'log-list');
    this.el.append(head, this.list);
  }

  add(e: LogEntry) {
    if (e.turn !== this.lastTurn && e.turn > 0) {
      this.lastTurn = e.turn;
    }
    const row = h('div', `log-row log-${e.kind}${e.player === undefined ? '' : e.player === this.me ? ' log-me' : ' log-opp'}`);
    row.textContent = e.text;
    const stick = this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 30;
    this.list.appendChild(row);
    if (this.list.children.length > 400) this.list.firstElementChild?.remove();
    if (stick) this.list.scrollTop = this.list.scrollHeight;
  }

  /** Append many entries at once (a restored duel's history) and scroll to the newest. */
  addMany(entries: LogEntry[]) {
    if (!entries.length) return;
    const frag = document.createDocumentFragment();
    for (const e of entries.slice(-400)) {
      const row = h('div', `log-row log-${e.kind}${e.player === undefined ? '' : e.player === this.me ? ' log-me' : ' log-opp'}`);
      row.textContent = e.text;
      frag.appendChild(row);
      if (e.turn > 0) this.lastTurn = e.turn;
    }
    this.list.appendChild(frag);
    while (this.list.children.length > 400) this.list.firstElementChild?.remove();
    this.list.scrollTop = this.list.scrollHeight;
  }
}

// ---------------------------------------------------------------- preview
export class PreviewPanel {
  readonly el: HTMLElement;
  private cardHost: HTMLElement;
  private details: HTMLElement;
  private current: { data: CardData; inst?: CardInstance } | null = null;
  /** The card shown now, when it's a card in this duel (the judge looks at it). */
  get shownCard(): CardInstance | undefined {
    return this.current?.inst;
  }
  private sig = '';

  /** `canSee`: whether the viewer may see this card now; a shown card that turns hidden (bounced, Set, shuffled) is cleared. */
  constructor(
    private game: Game,
    private canSee: (c: CardInstance) => boolean = () => true,
  ) {
    this.el = h('div', 'preview');
    this.cardHost = h('div', 'preview-card');
    this.details = h('div', 'preview-details');
    this.el.append(this.cardHost, this.details);
    if (!isTouchUI()) this.cardHost.title = 'Click to enlarge';
    this.cardHost.style.cursor = 'zoom-in';
    this.cardHost.addEventListener('click', (ev) => {
      // On phones the sheet's own click handler decides; elsewhere enlarge directly.
      if (this.el.closest('.show-preview-sheet')) return;
      ev.stopPropagation();
      this.zoom();
    });
    this.showEmpty();
  }

  /** Enlarge the card currently shown. */
  zoom() {
    if (this.current) zoomCard(this.current.data, { instance: this.current.inst, game: this.game });
  }

  private showEmpty() {
    this.cardHost.innerHTML = `<div class="preview-empty">${isTouchUI() ? 'Tap a card' : 'Hover or click a card'}<br>to read it</div>`;
    this.details.innerHTML = '';
  }

  show(data: CardData | null, inst?: CardInstance) {
    if (!data) return;
    this.current = { data, inst };
    this.sig = '';
    this.refresh();
  }

  invalidate() {
    this.sig = '';
    this.refresh();
  }

  refresh() {
    if (!this.current) return;
    const { data, inst } = this.current;
    if (inst && !this.canSee(inst)) {
      // it left the viewer's sight: following it would show where it went and its live stats there
      this.current = null;
      this.sig = '';
      this.showEmpty();
      return;
    }
    const g = this.game;
    const s = data.kind === 'monster' ? liveStats(data, inst, g) : null;
    const neg = inst && inst.onField && inst.faceUp ? safe(() => g.isNegated(inst), false) : false;
    const sig = `${data.id}|${inst?.uid}|${s?.atk}|${s?.def}|${neg}|${inst?.location}|${JSON.stringify(inst?.counters ?? {})}`;
    if (sig === this.sig) return;
    this.sig = sig;
    const card = renderCard(data, { size: 'lg', instance: inst, game: g, showLimit: true });
    this.cardHost.replaceChildren(card);
    const parts: string[] = [];
    parts.push(`<div class="pv-name">${esc(data.name)}</div>`);
    const meta: string[] = [];
    if (data.kind === 'monster') {
      meta.push(`<span class="pv-chip pv-attr-${data.attribute}">${data.attribute}</span>`);
      meta.push(`<span class="pv-chip">Lv ${data.level ?? 0}</span>`);
    }
    meta.push(`<span class="pv-chip">${esc(typeLine(data))}</span>`);
    if (data.limit !== undefined && data.limit < 3) meta.push(`<span class="pv-chip pv-limit">${['Forbidden', 'Limited', 'Semi-Limited'][data.limit]}</span>`);
    parts.push(`<div class="pv-meta">${meta.join('')}</div>`);
    if (s) {
      const cls = (m: number) => (m > 0 ? 'up' : m < 0 ? 'down' : '');
      parts.push(`<div class="pv-stats"><span>ATK <b class="${cls(s.atkMod)}">${s.atk}</b></span><span>DEF <b class="${cls(s.defMod)}">${s.def}</b></span></div>`);
    }
    parts.push(`<div class="pv-text">${esc(data.text || '').replace(/\n/g, '<br>')}</div>`);
    const status: string[] = [];
    if (inst) {
      if (neg) status.push('<span class="pv-flag pv-neg">Effects negated</span>');
      for (const [k, n] of Object.entries(inst.counters)) if (n > 0) status.push(`<span class="pv-flag">${esc(k)} counters: ${n}</span>`);
      if (inst.equippedTo != null) {
        const host = g.card(inst.equippedTo);
        if (host) status.push(`<span class="pv-flag">Equipped to ${esc(host.faceUp ? host.name : 'a face-down monster')}</span>`);
      }
      if (inst.onField && inst.isMonster) {
        const eq = g.equipsOf(inst);
        if (eq.length) status.push(`<span class="pv-flag">Equips: ${eq.map((e) => esc(e.name)).join(', ')}</span>`);
      }
      if (inst.controller !== inst.owner) status.push('<span class="pv-flag">Controlled by the other player</span>');
    }
    if (status.length) parts.push(`<div class="pv-status">${status.join('')}</div>`);
    this.details.innerHTML = parts.join('');
  }
}

function safe<T>(fn: () => T, fb: T): T {
  try {
    return fn();
  } catch {
    return fb;
  }
}

// ---------------------------------------------------------------- scorepad
/**
 * The Life Points written down the way duelists kept score at a 2010 event: a notepad with a column per player,
 * each new total under the last and the old ones crossed out, with the change and the turn beside it.
 */
export function openScorepad(host: HTMLElement, panels: PlayerPanel[], me: PlayerId) {
  host.querySelector('.scorepad-layer')?.remove();
  const order = [panels[me], panels[me === 0 ? 1 : 0]];
  const col = (p: PlayerPanel) => {
    const rows = p.lpHistory.map((e, i) => {
      const prev = i ? p.lpHistory[i - 1].lp : null;
      const d = prev === null ? '' : `<small class="${e.lp < prev ? 'is-dmg' : 'is-heal'}">${e.lp < prev ? '−' : '+'}${Math.abs(e.lp - prev)}${e.turn ? ` · T${e.turn}` : ''}</small>`;
      const last = i === p.lpHistory.length - 1;
      return `<li class="${last ? 'is-now' : 'is-old'}"><span>${e.lp}</span>${d}</li>`;
    });
    return `<div class="sp-col"><h3>${esc(p.name)}</h3><ol>${rows.join('')}</ol></div>`;
  };
  const layer = h('div', 'scorepad-layer');
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-label', 'Scorepad');
  const pad = h('div', 'scorepad', `<div class="sp-head">Life Points</div><div class="sp-cols">${order.map(col).join('')}</div><div class="sp-foot">Tap to close</div>`);
  layer.appendChild(pad);
  const close = () => {
    layer.classList.add('is-closing');
    window.setTimeout(() => layer.remove(), 160);
    window.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  layer.addEventListener('click', close);
  window.addEventListener('keydown', onKey);
  host.appendChild(layer);
  // newest totals in view on a long duel
  pad.querySelectorAll<HTMLElement>('.sp-col ol').forEach((ol) => (ol.scrollTop = ol.scrollHeight));
}
