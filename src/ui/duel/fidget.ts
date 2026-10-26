// Hand-shuffle fidget: swipe sideways across your own hand and it is shuffled the way players do it at
// locals. The fan closes into a squared stack held up in front of you, the leftmost card in front and held
// there; then, one card at a time, the end card comes up from the back of the stack, over the top and down
// onto the front, so the held card is pushed further back with each one; then the hand fans back out.
// The same on either turn. Purely cosmetic: each card fans back out to its own place (the hand's order
// never changes), nothing is selected or played, and it never runs while you are asked to pick something
// (a prompt, a menu, attack targets). On your own turn a tap on the hand stops it at once, so the tap
// selects the card under your finger as usual.
//  - one shuffle per swipe (a swipe that keeps going queues one more)
//  - cancels at once (cards snap home) when a decision comes up or a card enters or leaves the hand
//  - transforms on each card's .dc-fx only (the fan itself sits on .dc), motion tokens, scaled by
//    the animation speed; off for reduced motion, at Instant speed and when spectating
//  - a soft card slide per card and a light haptic tick (both quieter than any gameplay feedback)
import type { PlayerId } from '../../engine/types';
import { haptic } from '../haptics';
import { DUR, EASE, reducedMotion } from '../motion';
import type { BoardView } from './board';
import type { Sfx } from './sound';

export interface FidgetHost {
  readonly board: BoardView;
  readonly sfx: Sfx;
  readonly me: PlayerId;
  readonly spectator: boolean;
  speed(): number;
  /** The player is being asked to pick something right now (a prompt, a menu, attack targets). */
  deciding(): boolean;
}

const HINT_KEY = 'edison.hint.shuffle';
/** Sideways travel (px) that counts as a swipe, and how much more queues another shuffle. */
const SWIPE_PX = 34;
const AGAIN_PX = 90;
/** Closing the fan into a stack / opening it again, and one card going from the back to the front (ms at Normal speed). */
const GATHER_MS = DUR.base;
const SPREAD_MS = DUR.slow;
const PULL_MS = DUR.fast * 1.3;
/** Most cards brought round in one shuffle. */
const MAX_PULLS = 7;

/** How many cards come from the back to the front in one shuffle: every card behind the held one, once. */
export function pullCount(n: number): number {
  return n < 2 ? 0 : Math.min(MAX_PULLS, n - 1);
}

/** The stack after one pull: `order[0]` is the front card; the end (back) card goes on the front. */
export function pullStep(order: number[]): number[] {
  return [order[order.length - 1], ...order.slice(0, -1)];
}

interface Slot {
  x: number;
  y: number;
  r: number;
}

export class HandFidget {
  private hand: HTMLElement;
  private cards: HTMLElement[] = [];
  private slots: Slot[] = [];
  private anims: Animation[] = [];
  /** The steps of the shuffle in progress (gather, pulls..., spread), run one after another. */
  private plan: (() => number)[] = [];
  /** order[depth] = the card (index into `cards`) at that depth of the stack, 0 = the front card. */
  private order: number[] = [];
  /** The stack's centre (page px) and card size. */
  private sx = 0;
  private sy = 0;
  private cw = 0;
  private ch = 0;
  private timer = 0;
  private raf = 0;
  private queued = 0;
  private swallowAt = 0;
  private gesture: {
    id: number;
    x0: number;
    y0: number;
    fired: number;
  } | null = null;
  private off: (() => void)[] = [];

  constructor(private h: FidgetHost) {
    this.hand = h.board.sideOf(h.me).hand;
    if (h.spectator) return;
    const down = (ev: PointerEvent) => {
      if (ev.button !== 0 || !(ev.target as HTMLElement).closest('.dc')) return;
      // a new touch: only the swipe's own click is swallowed, never the click of a later tap
      this.swallowAt = 0;
      this.gesture = {
        id: ev.pointerId,
        x0: ev.clientX,
        y0: ev.clientY,
        fired: 0,
      };
    };
    const move = (ev: PointerEvent) => {
      const g = this.gesture;
      if (!g || ev.pointerId !== g.id) return;
      const dx = ev.clientX - g.x0;
      const dy = ev.clientY - g.y0;
      const need = g.fired ? SWIPE_PX + AGAIN_PX * g.fired : SWIPE_PX;
      if (Math.abs(dx) < need || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      // a swipe, not a tap: whatever it was over is not selected
      this.swallowAt = performance.now();
      if (!this.allowed()) return;
      g.fired++;
      this.riffle();
    };
    const up = (ev: PointerEvent) => {
      if (!this.gesture || ev.pointerId !== this.gesture.id) return;
      // a tap (not a swipe) on the hand while it shuffles: cards snap home before the click picks one
      if (!this.gesture.fired && this.running) this.cancel();
      this.gesture = null;
    };
    const click = (ev: MouseEvent) => {
      if (performance.now() - this.swallowAt > 700) return;
      this.swallowAt = 0;
      ev.stopPropagation();
      ev.preventDefault();
    };
    this.hand.addEventListener('pointerdown', down, { passive: true });
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerup', up, { passive: true });
    document.addEventListener('pointercancel', up, { passive: true });
    this.hand.addEventListener('click', click, true);
    this.off.push(
      () => this.hand.removeEventListener('pointerdown', down),
      () => document.removeEventListener('pointermove', move),
      () => document.removeEventListener('pointerup', up),
      () => document.removeEventListener('pointercancel', up),
      () => this.hand.removeEventListener('click', click, true),
    );
  }

  /** A swipe was just used for shuffling (hurry.ts leaves it alone). */
  get swiping() {
    return performance.now() - this.swallowAt < 700 || !!this.gesture?.fired;
  }

  get running() {
    return this.cards.length > 0;
  }

  private allowed() {
    const h = this.h;
    if (h.spectator || h.speed() <= 0 || reducedMotion() || h.deciding()) return false;
    const cards = this.handCards();
    return cards.length >= 2 && !cards.some((c) => c.classList.contains('dc-moving'));
  }

  private handCards() {
    return [...this.hand.children].filter((c) => c.classList.contains('dc') && !c.classList.contains('dc-ghost')) as HTMLElement[];
  }

  /** One shuffle: close the fan, bring cards from the back to the front, open it again (queued if one is playing). */
  private riffle() {
    if (this.running) {
      this.queued = Math.min(1, this.queued + 1);
      return;
    }
    this.cards = this.handCards();
    const n = this.cards.length;
    // where each card sits in the fan (one layout read for the whole shuffle)
    this.slots = this.cards.map((c) => {
      const r = c.getBoundingClientRect();
      return {
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        r: parseFloat(c.style.getPropertyValue('--fan-r')) || 0,
      };
    });
    this.cw = this.cards[0].offsetWidth || 60;
    const ch = (this.ch = this.cards[0].offsetHeight || this.cw * 1.45);
    // the stack is held up in the middle of the hand, a little to the left
    const mid = this.slots[Math.floor((n - 1) / 2)];
    this.sx = (this.slots[0].x + this.slots[n - 1].x) / 2 - this.cw * 0.25;
    this.sy = mid.y - ch * 0.38;
    // the leftmost card in front
    this.order = this.cards.map((_, i) => i);
    this.plan = [() => this.gather()];
    for (let k = pullCount(n); k > 0; k--) this.plan.push(() => this.pull());
    this.plan.push(() => this.spread());
    this.hand.classList.add('is-shuffling');
    this.watch();
    this.nextStep();
  }

  private ms(base: number) {
    return base * Math.min(1.5, Math.max(0.5, this.h.speed()));
  }

  /** Transform that puts card i at page point (x, y), upright (or tilted by `r`), scaled. */
  private toPoint(i: number, x: number, y: number, r = 0, scale = 1) {
    const a = this.slots[i];
    return `translate(${(x - a.x).toFixed(1)}px, ${(y - a.y).toFixed(1)}px) rotate(${(r - a.r).toFixed(2)}deg) scale(${scale})`;
  }

  /** Card i squared up in the stack at this depth (deeper cards peek out a hair behind). */
  private inStack(i: number, depth: number) {
    return this.toPoint(i, this.sx + depth * 0.8, this.sy + depth * 0.6, 0, 1.06);
  }

  private stackZ() {
    this.order.forEach((card, depth) => (this.cards[card].style.zIndex = String(80 - depth)));
  }

  private animate(i: number, frames: Keyframe[], ms: number, easing: string) {
    const fx = this.cards[i].querySelector('.dc-fx') as HTMLElement | null;
    if (!fx) return;
    const an = fx.animate(frames, { duration: ms, easing, fill: 'forwards' });
    an.id = 'fidget';
    this.anims.push(an);
  }

  /** Close the fan into a squared stack. */
  private gather() {
    const ms = this.ms(GATHER_MS);
    this.stackZ();
    this.order.forEach((card, depth) => this.animate(card, [{ transform: 'none' }, { transform: this.inStack(card, depth) }], ms, EASE.out));
    return ms;
  }

  /** The end card comes up from the back of the stack, over the top and down onto the front. */
  private pull() {
    const ms = this.ms(PULL_MS);
    const n = this.order.length;
    const from = this.order;
    const to = pullStep(from);
    const card = from[n - 1];
    const [x0, y0] = [this.sx + (n - 1) * 0.8, this.sy + (n - 1) * 0.6];
    this.animate(
      card,
      [
        { transform: this.inStack(card, n - 1) },
        // drawn up out of the back, tilting a little as the fingers lift it
        { transform: this.toPoint(card, x0 + this.cw * 0.12, y0 - this.ch * 0.62, 6, 1.06), offset: 0.42 },
        // over the top edge of the stack, coming forward
        { transform: this.toPoint(card, this.sx + this.cw * 0.06, this.sy - this.ch * 0.5, 3, 1.08), offset: 0.62 },
        { transform: this.inStack(card, 0) },
      ],
      ms,
      EASE.inOut,
    );
    // the rest of the stack (the held card first) goes back one place
    from.slice(0, n - 1).forEach((c, d) => this.animate(c, [{ transform: this.inStack(c, d) }, { transform: this.inStack(c, d + 1) }], ms, EASE.out));
    this.order = to;
    // it lands on the front once it is above the stack
    window.setTimeout(() => {
      if (this.running && this.order === to) this.stackZ();
    }, ms * 0.5);
    this.h.sfx.play('fidget');
    haptic('selection');
    return ms * 0.92;
  }

  /** Open the stack back into the fan (every card to its own slot, in the original order). */
  private spread() {
    const ms = this.ms(SPREAD_MS);
    this.cards.forEach((c, i) => (c.style.zIndex = String(10 + i)));
    this.order.forEach((card, depth) => this.animate(card, [{ transform: this.inStack(card, depth) }, { transform: 'none' }], ms, EASE.out));
    return ms;
  }

  private nextStep() {
    const step = this.plan.shift();
    if (!step) return this.finish();
    const prev = this.anims;
    this.anims = [];
    const wait = step();
    for (const a of prev) a.cancel();
    this.timer = window.setTimeout(() => this.nextStep(), wait);
  }

  private finish() {
    this.reset();
    if (this.queued > 0 && this.allowed()) {
      this.queued--;
      this.riffle();
    } else this.queued = 0;
  }

  /** Cancel at once: every card snaps home in its original place and order. */
  cancel() {
    this.queued = 0;
    if (this.running) this.reset();
  }

  private reset() {
    window.clearTimeout(this.timer);
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const a of this.anims) a.cancel();
    this.anims = [];
    this.cards.forEach((c, i) => {
      if (c.parentElement === this.hand) c.style.zIndex = String(10 + i);
    });
    this.cards = [];
    this.plan = [];
    this.hand.classList.remove('is-shuffling');
  }

  /** While a riffle plays (only then): stop the moment a decision comes up. */
  private watch() {
    const tick = () => {
      if (!this.running) return;
      if (this.h.deciding() || this.h.speed() <= 0) return this.cancel();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** The opponent's first turn: a one-time tip (stored like the other edison.hint.* keys). */
  turnStarted(player: PlayerId) {
    if (this.h.spectator || player === this.h.me || this.h.speed() <= 0 || reducedMotion()) return;
    try {
      if (localStorage.getItem(HINT_KEY) === '1') return;
      if (this.handCards().length < 2) return;
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      return;
    }
    const tip = document.createElement('div');
    tip.className = 'fidget-hint';
    tip.textContent = 'Swipe your hand to shuffle';
    this.h.board.stage.appendChild(tip);
    window.setTimeout(() => tip.classList.add('is-gone'), 4500);
    window.setTimeout(() => tip.remove(), 4500 + DUR.slow + 50);
  }

  dispose() {
    this.cancel();
    for (const f of this.off) f();
    this.off = [];
  }
}
