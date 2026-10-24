// Board view: zones, piles and hands rendered from Game state with FLIP-animated card movement.
import type { CardInstance } from '../../engine/card';
import type { Game } from '../../engine/game';
import type { Location, PlayerId } from '../../engine/types';
import { liveStats, renderCard } from '../cards/render';
import { applySleeve } from '../theme/sleeves';
import { esc } from '../theme/util';

export const RATIO = 86 / 59;

interface View {
  uid: number;
  el: HTMLElement;
  fx: HTMLElement;
  rot: HTMLElement;
  stat: HTMLElement;
  badges: HTMLElement;
  sig: string;
  place: string;
}

interface SideEls {
  root: HTMLElement;
  m: HTMLElement[];
  s: HTMLElement[];
  f: HTMLElement;
  grave: HTMLElement;
  banished: HTMLElement;
  deck: HTMLElement;
  extra: HTMLElement;
  hand: HTMLElement;
  deckStack: HTMLElement;
  extraStack: HTMLElement;
  counts: Record<'deck' | 'extra' | 'grave' | 'banished', HTMLElement>;
}

export interface RenderOpts {
  /** Delay (ms) between successive new cards flying in (draw animations). */
  stagger?: number;
  /** Cards that should appear in place (fade) instead of flying. */
  instant?: Set<number>;
  /** Views to drop without a ghost animation (destroy shatter already played). */
  drop?: Set<number>;
}

export interface BoardConfig {
  /** Player shown at the bottom. */
  me: PlayerId;
  /** Player whose hidden information is visible (null = spectator, nothing hidden is shown). */
  viewer: PlayerId | null;
  sleeves: [string, string];
  /** Animation duration multiplier (0 = instant). */
  speed: () => number;
}

type Rect = { x: number; y: number; w: number };

export class BoardView {
  readonly stage: HTMLElement;
  readonly board: HTMLElement;
  readonly fxLayer: HTMLElement;
  readonly sides: [SideEls, SideEls];
  private views = new Map<number, View>();
  private lastLoc = new Map<number, Location>();
  private ro: ResizeObserver | null = null;
  cw = 90;

  onCardClick?: (c: CardInstance, el: HTMLElement, ev: MouseEvent) => void;
  onCardHover?: (c: CardInstance | null, el: HTMLElement | null) => void;
  onPileClick?: (p: PlayerId, loc: 'grave' | 'banished' | 'extra' | 'deck', ev: MouseEvent) => void;
  onLayout?: () => void;

  constructor(
    private game: Game,
    private cfg: BoardConfig,
  ) {
    this.stage = div('stage');
    this.board = div('board');
    this.fxLayer = div('fx-layer');
    const opp = this.buildSide(this.oppOf(cfg.me), false);
    const me = this.buildSide(cfg.me, true);
    const mid = div('midline');
    mid.innerHTML = '<div class="midline-glow"></div>';
    this.board.append(opp.root, mid, me.root);
    this.stage.append(this.board, opp.hand, me.hand, this.fxLayer);
    this.sides = cfg.me === 0 ? [me, opp] : [opp, me];

    this.stage.addEventListener('click', (ev) => {
      const t = ev.target as HTMLElement;
      const dc = t.closest('.dc') as HTMLElement | null;
      if (dc && dc.dataset.uid && !dc.classList.contains('dc-ghost')) {
        const c = this.game.card(Number(dc.dataset.uid));
        if (c && this.onCardClick) {
          ev.stopPropagation();
          this.onCardClick(c, dc, ev);
          return;
        }
      }
      const pile = t.closest('[data-pile]') as HTMLElement | null;
      if (pile && this.onPileClick) {
        ev.stopPropagation();
        this.onPileClick(Number(pile.dataset.p) as PlayerId, pile.dataset.pile as any, ev);
      }
    });
    this.stage.addEventListener('pointerover', (ev) => {
      const dc = (ev.target as HTMLElement).closest('.dc') as HTMLElement | null;
      if (dc && dc.dataset.uid) {
        const c = this.game.card(Number(dc.dataset.uid));
        this.onCardHover?.(c ?? null, dc);
      }
    });
  }

  private oppOf(p: PlayerId): PlayerId {
    return (1 - p) as PlayerId;
  }

  mount(parent: HTMLElement) {
    parent.appendChild(this.stage);
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(this.stage);
    this.layout();
  }

  destroy() {
    this.ro?.disconnect();
  }

  // ------------------------------------------------------------------ DOM build
  private buildSide(p: PlayerId, bottom: boolean): SideEls {
    const root = div(`side ${bottom ? 'side-me' : 'side-opp'}`);
    root.dataset.p = String(p);
    const zone = (cls: string, label = '') => {
      const z = div(`zone ${cls}`);
      z.dataset.p = String(p);
      if (label) z.innerHTML = `<span class="zone-label">${label}</span>`;
      return z;
    };
    const m = [0, 1, 2, 3, 4].map((i) => {
      const z = zone('zone--m');
      z.dataset.i = String(i);
      return z;
    });
    const s = [0, 1, 2, 3, 4].map((i) => {
      const z = zone('zone--s');
      z.dataset.i = String(i);
      return z;
    });
    const f = zone('zone--f', 'Field');
    const grave = zone('zone--pile zone--grave', 'GY');
    grave.dataset.pile = 'grave';
    const banished = zone('zone--pile zone--ban', 'Banished');
    banished.dataset.pile = 'banished';
    grave.appendChild(banished);
    const deck = zone('zone--pile zone--deck', 'Deck');
    deck.dataset.pile = 'deck';
    const extra = zone('zone--pile zone--extra', 'Extra');
    extra.dataset.pile = 'extra';
    const deckStack = div('pile-stack');
    applySleeve(deckStack, this.cfg.sleeves[p]);
    deck.appendChild(deckStack);
    const extraStack = div('pile-stack');
    applySleeve(extraStack, this.cfg.sleeves[p]);
    extra.appendChild(extraStack);
    const counts = {
      deck: div('pile-count'),
      extra: div('pile-count'),
      grave: div('pile-count'),
      banished: div('pile-count'),
    };
    deck.appendChild(counts.deck);
    extra.appendChild(counts.extra);
    grave.appendChild(counts.grave);
    banished.appendChild(counts.banished);

    if (bottom) {
      // row 1 (monster): Field, M0..M4, GY ; row 2: Extra, S0..S4, Deck
      root.append(f, ...m, grave, extra, ...s, deck);
    } else {
      // Mirrored: row 1 (S/T): Deck, S4..S0, Extra ; row 2 (monster): GY, M4..M0, Field
      root.append(deck, ...[...s].reverse(), extra, grave, ...[...m].reverse(), f);
    }
    const hand = div(`hand ${bottom ? 'hand-me' : 'hand-opp'}`);
    hand.dataset.p = String(p);
    return { root, m, s, f, grave, banished, deck, extra, hand, deckStack, extraStack, counts };
  }

  // ------------------------------------------------------------------ layout
  layout() {
    const r = this.stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const compact = r.width < 620;
    const unitW = 7 * 1.16 + 6 * 0.08 + (compact ? 0.3 : 2 * 0.86);
    const unitH = 4 * RATIO * 1.03 + 0.16 + 0.42 + 0.82 * RATIO * 0.55 + 1.08 * RATIO * 0.76 + 0.2;
    const cw = Math.max(34, Math.min(170, Math.floor(Math.min(r.width / unitW, r.height / unitH))));
    this.cw = cw;
    const s = this.stage.style;
    s.setProperty('--cw', `${cw}px`);
    s.setProperty('--ch', `${(cw * RATIO).toFixed(2)}px`);
    const boardH = 4 * cw * RATIO * 1.03 + cw * 0.16 + cw * 0.42;
    const topRes = 0.82 * cw * RATIO * 0.55;
    const botRes = 1.08 * cw * RATIO * 0.76;
    const free = r.height - topRes - botRes - boardH;
    s.setProperty('--board-top', `${Math.max(0, topRes + free * 0.45).toFixed(1)}px`);
    this.stage.classList.toggle('stage--compact', compact);
    this.fanHands();
    this.onLayout?.();
  }

  // ------------------------------------------------------------------ rendering
  sideOf(p: PlayerId) {
    return this.sides[p];
  }

  elFor(uid: number): HTMLElement | undefined {
    return this.views.get(uid)?.el;
  }

  /** Screen rect of a pile / hand / zone anchor. */
  anchor(p: PlayerId, loc: Location): HTMLElement | null {
    const s = this.sides[p];
    switch (loc) {
      case 'deck':
        return s.deck;
      case 'extra':
        return s.extra;
      case 'grave':
        return s.grave;
      case 'banished':
        return s.banished;
      case 'hand':
        return s.hand;
      default:
        return null;
    }
  }

  private rectOf(el: Element): Rect | null {
    const r = el.getBoundingClientRect();
    if (!r.width) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: (el as HTMLElement).offsetWidth || r.width };
  }

  private shownFace(c: CardInstance, place: string): { shown: boolean; peek: boolean } {
    const g = this.game;
    const viewer = this.cfg.viewer;
    if (place === 'grave' || place === 'banished') return { shown: c.faceUp, peek: false };
    if (place === 'hand') return { shown: c.owner === viewer || c.revealedUntil >= g.turn, peek: false };
    if (c.faceUp) return { shown: true, peek: false };
    return { shown: false, peek: viewer !== null && c.controller === viewer };
  }

  private createView(c: CardInstance): View {
    const el = div('dc');
    el.dataset.uid = String(c.uid);
    const fx = div('dc-fx');
    const rot = div('dc-rot');
    const stat = div('dc-stat');
    const badges = div('dc-badges');
    fx.append(rot, badges);
    el.append(fx, stat);
    return { uid: c.uid, el, fx, rot, stat, badges, sig: '', place: '' };
  }

  private updateView(v: View, c: CardInstance, place: string) {
    const g = this.game;
    const { shown, peek } = this.shownFace(c, place);
    const sleeve = this.cfg.sleeves[c.owner];
    const sig = shown ? `f:${c.data.id}` : `b:${sleeve}`;
    if (sig !== v.sig) {
      const wasFace = v.sig.startsWith('f:');
      const flipAnim = v.sig !== '' && wasFace !== shown && v.place === place && place !== 'hand';
      v.rot.innerHTML = '';
      const card = renderCard(c.data, { size: 'md', faceDown: !shown, sleeve });
      card.style.setProperty('--yc-w', '100%');
      v.rot.appendChild(card);
      v.sig = sig;
      if (flipAnim && this.cfg.speed() > 0) {
        v.rot.classList.remove('flip-in');
        void v.rot.offsetWidth;
        v.rot.classList.add('flip-in');
      }
    }
    v.place = place;
    const el = v.el;
    el.dataset.place = place;
    el.classList.toggle('is-def', place === 'mzone' && c.pos === 'def');
    el.classList.toggle('is-set', (place === 'mzone' || place === 'szone' || place === 'fzone') && !c.faceUp);
    el.classList.toggle('is-opp', c.controller !== this.cfg.me);
    el.classList.toggle('is-peek', peek);
    let negated = false;
    if (c.onField && c.faceUp) {
      try {
        negated = g.isNegated(c);
      } catch {
        negated = false;
      }
    }
    el.classList.toggle('is-negated', negated);

    // ATK/DEF chip
    if (place === 'mzone' && c.faceUp && c.isMonster) {
      const s = liveStats(c.data, c, g);
      const cls = (m: number) => (m > 0 ? 'up' : m < 0 ? 'down' : '');
      const html = `<span class="st-atk ${cls(s.atkMod)}">${s.atk}</span><span class="st-sep">/</span><span class="st-def ${cls(s.defMod)}">${s.def}</span>`;
      if (v.stat.innerHTML !== html) v.stat.innerHTML = html;
      v.stat.hidden = false;
    } else {
      v.stat.hidden = true;
    }
    // badges: counters, equip, peek name
    let b = '';
    const counters = Object.entries(c.counters).filter(([, n]) => n > 0);
    for (const [k, n] of counters) b += `<span class="dc-badge dc-badge--counter" title="${esc(k)} counters">${n}</span>`;
    if (c.equippedTo != null && c.onField) b += `<span class="dc-badge dc-badge--equip" title="Equipped">⚔</span>`;
    if (c.isMonster && c.onField && g.equipsOf(c).length) b += `<span class="dc-badge dc-badge--equipped" title="Has equips">+${g.equipsOf(c).length}</span>`;
    if (peek) b += `<span class="dc-peek">${esc(c.name)}</span>`;
    if (v.badges.innerHTML !== b) v.badges.innerHTML = b;
  }

  render(o: RenderOpts = {}) {
    const g = this.game;
    const dur = Math.round(430 * this.cfg.speed());
    // 1) snapshot current positions
    const before = new Map<number, Rect>();
    for (const [uid, v] of this.views) {
      if (!v.el.isConnected) continue;
      const r = this.rectOf(v.el);
      if (r) before.set(uid, r);
    }
    // 2) desired placements
    const want: { c: CardInstance; parent: HTMLElement; place: string }[] = [];
    for (const p of [0, 1] as PlayerId[]) {
      const ps = g.players[p];
      const z = this.sides[p];
      ps.mzone.forEach((c, i) => c && want.push({ c, parent: z.m[i], place: 'mzone' }));
      ps.szone.forEach((c, i) => c && want.push({ c, parent: z.s[i], place: 'szone' }));
      if (ps.fzone) want.push({ c: ps.fzone, parent: z.f, place: 'fzone' });
      const gt = ps.grave[ps.grave.length - 1];
      if (gt) want.push({ c: gt, parent: z.grave, place: 'grave' });
      const bt = ps.banished[ps.banished.length - 1];
      if (bt) want.push({ c: bt, parent: z.banished, place: 'banished' });
      for (const c of ps.hand) want.push({ c, parent: z.hand, place: 'hand' });
    }
    const wantSet = new Set(want.map((w) => w.c.uid));
    // 3) retire views no longer displayed
    for (const [uid, v] of [...this.views]) {
      if (wantSet.has(uid)) continue;
      this.views.delete(uid);
      this.retire(v, g.card(uid), before.get(uid), dur, o);
    }
    // 4) create / update / re-parent
    const handOrder: [HTMLElement[], HTMLElement[]] = [[], []];
    const fresh = new Set<number>();
    for (const w of want) {
      let v = this.views.get(w.c.uid);
      if (!v) {
        v = this.createView(w.c);
        this.views.set(w.c.uid, v);
        fresh.add(w.c.uid);
      }
      this.updateView(v, w.c, w.place);
      if (w.place === 'hand') handOrder[w.c.owner].push(v.el);
      else if (v.el.parentElement !== w.parent) w.parent.appendChild(v.el);
      else if ((w.place === 'grave' || w.place === 'banished') && w.parent.lastElementChild !== v.el) {
        // keep the top card above any lingering previous top
        w.parent.appendChild(v.el);
      }
    }
    for (const p of [0, 1] as PlayerId[]) {
      const hand = this.sides[p].hand;
      handOrder[p].forEach((el, i) => {
        if (hand.children[i] !== el) hand.insertBefore(el, hand.children[i] ?? null);
      });
    }
    this.fanHands();
    this.updatePiles();

    // 5) FLIP
    if (dur > 0) {
      const moves: { v: View; from: Rect; delay: number }[] = [];
      let k = 0;
      for (const w of want) {
        const v = this.views.get(w.c.uid)!;
        let from = before.get(w.c.uid);
        if (!from && fresh.has(w.c.uid) && !o.instant?.has(w.c.uid)) {
          const last = this.lastLoc.get(w.c.uid);
          const a = last ? this.anchor(w.c.owner, last) : null;
          if (a && last !== 'hand') from = this.rectOf(a) ?? undefined;
        }
        if (from) {
          const delay = fresh.has(w.c.uid) && o.stagger ? k++ * o.stagger : 0;
          moves.push({ v, from, delay });
        } else if (fresh.has(w.c.uid) && this.lastLoc.size) {
          v.el.classList.remove('dc-pop');
          void v.el.offsetWidth;
          v.el.classList.add('dc-pop');
        }
      }
      for (const m of moves) {
        m.v.el.style.transition = 'none';
        m.v.el.style.translate = '';
        m.v.el.style.scale = '';
      }
      const targets = moves.map((m) => this.rectOf(m.v.el));
      moves.forEach((m, i) => {
        const t = targets[i];
        if (!t) return;
        const dx = m.from.x - t.x;
        const dy = m.from.y - t.y;
        const sc = m.from.w / (t.w || 1);
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sc - 1) < 0.01) return;
        m.v.el.style.translate = `${dx.toFixed(1)}px ${dy.toFixed(1)}px`;
        m.v.el.style.scale = sc.toFixed(3);
        m.v.el.classList.add('dc-moving');
      });
      void this.stage.offsetWidth;
      moves.forEach((m) => {
        const el = m.v.el;
        if (!el.classList.contains('dc-moving')) return;
        el.style.transition = `translate ${dur}ms var(--ef-ease-out) ${m.delay}ms, scale ${dur}ms var(--ef-ease-out) ${m.delay}ms`;
        el.style.translate = '';
        el.style.scale = '';
        window.setTimeout(() => el.classList.remove('dc-moving'), dur + m.delay + 30);
      });
    }
    for (const c of g.allCards) this.lastLoc.set(c.uid, c.location);
  }

  private retire(v: View, c: CardInstance | undefined, rect: Rect | undefined, dur: number, o: RenderOpts) {
    const el = v.el;
    if (o.drop?.has(v.uid) || dur <= 0 || !rect || !el.isConnected) {
      el.remove();
      return;
    }
    const anchor = c ? this.anchor(c.owner, c.location) : null;
    if (anchor && anchor.contains(el)) {
      // was the top of this pile and got buried: remove once the new top has landed
      window.setTimeout(() => el.remove(), dur + 60);
      return;
    }
    const target = anchor ? this.rectOf(anchor) : null;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    el.classList.add('dc-ghost');
    el.style.transition = 'none';
    el.style.translate = '';
    el.style.scale = '';
    el.style.position = 'fixed';
    el.style.left = `${rect.x - w / 2}px`;
    el.style.top = `${rect.y - h / 2}px`;
    el.style.margin = '0';
    el.style.width = `${w}px`;
    el.style.setProperty('--fan-r', '0deg');
    el.style.setProperty('--fan-y', '0px');
    document.body.appendChild(el);
    void el.offsetWidth;
    if (target) {
      el.style.transition = `translate ${dur}ms var(--ef-ease-out), scale ${dur}ms var(--ef-ease-out), opacity ${dur}ms ease-in`;
      el.style.translate = `${(target.x - rect.x).toFixed(1)}px ${(target.y - rect.y).toFixed(1)}px`;
      el.style.scale = (target.w / (w || 1)).toFixed(3);
      el.style.opacity = c && (c.location === 'deck' || c.location === 'extra') ? '0.2' : '0.85';
    } else {
      el.style.transition = `opacity ${dur}ms ease, scale ${dur}ms ease`;
      el.style.opacity = '0';
      el.style.scale = '0.6';
    }
    window.setTimeout(() => el.remove(), dur + 40);
  }

  private fanHands() {
    for (const p of [0, 1] as PlayerId[]) {
      const hand = this.sides[p].hand;
      const cards = [...hand.children].filter((x) => x.classList.contains('dc')) as HTMLElement[];
      const n = cards.length;
      const isMe = p === this.cfg.me;
      const cardW = this.cw * (isMe ? 1.08 : 0.82);
      const maxW = this.stage.clientWidth * (isMe ? 0.7 : 0.6);
      const natural = n * cardW + (n - 1) * cardW * 0.06;
      let ml = cardW * 0.06;
      if (n > 1 && natural > maxW) ml = (maxW - n * cardW) / (n - 1);
      hand.style.setProperty('--hand-ml', `${ml.toFixed(1)}px`);
      const spread = Math.min(3.2, 18 / Math.max(1, n));
      cards.forEach((el, i) => {
        const o = i - (n - 1) / 2;
        el.style.setProperty('--fan-r', `${(o * spread * (isMe ? 1 : -1)).toFixed(2)}deg`);
        el.style.setProperty('--fan-y', `${((o * o * this.cw) / 90) * (isMe ? 1.6 : -1.2)}px`);
        el.style.zIndex = String(10 + i);
      });
    }
  }

  private updatePiles() {
    const g = this.game;
    for (const p of [0, 1] as PlayerId[]) {
      const ps = g.players[p];
      const z = this.sides[p];
      const set = (key: 'deck' | 'extra' | 'grave' | 'banished', n: number) => {
        const el = z.counts[key];
        const t = String(n);
        if (el.textContent !== t) el.textContent = t;
        el.hidden = n === 0;
      };
      set('deck', ps.deck.length);
      set('extra', ps.extra.length);
      set('grave', ps.grave.length);
      set('banished', ps.banished.length);
      const depth = (n: number) => `${Math.min(7, Math.ceil(n / 5))}`;
      z.deckStack.hidden = ps.deck.length === 0;
      z.deckStack.style.setProperty('--depth', depth(ps.deck.length));
      z.extraStack.hidden = ps.extra.length === 0;
      z.extraStack.style.setProperty('--depth', depth(ps.extra.length));
      z.grave.style.setProperty('--depth', depth(ps.grave.length));
      z.grave.classList.toggle('has-cards', ps.grave.length > 0);
      z.banished.classList.toggle('has-cards', ps.banished.length > 0);
      z.deck.classList.toggle('is-low', ps.deck.length > 0 && ps.deck.length <= 5);
    }
  }

  // ------------------------------------------------------------------ highlight helpers
  clearMarks(...classes: string[]) {
    for (const cls of classes) this.stage.querySelectorAll(`.${cls}`).forEach((e) => e.classList.remove(cls));
  }

  mark(uid: number, cls: string) {
    this.views.get(uid)?.el.classList.add(cls);
  }

  markPile(p: PlayerId, loc: 'grave' | 'banished' | 'extra' | 'deck', cls: string) {
    this.anchor(p, loc)?.classList.add(cls);
  }
}

function div(cls: string) {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}
