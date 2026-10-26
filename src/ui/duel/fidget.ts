// Hand-shuffle fidget: while the opponent plays, swipe sideways across your own hand and the cards
// cycle like a real hand being shuffled at locals: the back (leftmost) card arcs over to the front
// while the others slide down one place, card after card, until the hand is back in its original
// order. Purely cosmetic: it never changes the hand's order, never selects or plays a card, and only
// runs when you are not being asked to decide anything.
//  - one riffle per swipe (a swipe that keeps going queues one more)
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
  /** The player is being asked something right now (actions, a prompt, a menu, attack targets). */
  deciding(): boolean;
}

const HINT_KEY = 'edison.hint.shuffle';
/** Sideways travel (px) that counts as a swipe, and how much more queues another riffle. */
const SWIPE_PX = 34;
const AGAIN_PX = 90;
/** One card's move (ms at Normal speed). */
const STEP_MS = DUR.fast;

interface Slot {
  x: number;
  y: number;
  r: number;
}

export class HandFidget {
  private hand: HTMLElement;
  private cards: HTMLElement[] = [];
  private slots: Slot[] = [];
  /** How high the travelling card arcs (px): about a third of a card. */
  private lift = 0;
  private anims: Animation[] = [];
  private step = 0;
  private timer = 0;
  private raf = 0;
  private queued = 0;
  private swallowAt = 0;
  private gesture: { id: number; x0: number; y0: number; fired: number } | null = null;
  private off: (() => void)[] = [];

  constructor(private h: FidgetHost) {
    this.hand = h.board.sideOf(h.me).hand;
    if (h.spectator) return;
    const down = (ev: PointerEvent) => {
      if (ev.button !== 0 || !(ev.target as HTMLElement).closest('.dc')) return;
      this.gesture = { id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, fired: 0 };
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
      if (this.gesture && ev.pointerId === this.gesture.id) this.gesture = null;
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

  /** One full cycle through the hand (queued if one is playing). */
  private riffle() {
    if (this.running) {
      this.queued = Math.min(1, this.queued + 1);
      return;
    }
    this.cards = this.handCards();
    // where each card sits in the fan (one layout read for the whole riffle)
    this.slots = this.cards.map((c) => {
      const r = c.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: parseFloat(c.style.getPropertyValue('--fan-r')) || 0 };
    });
    this.lift = Math.max(12, (this.cards[0].offsetHeight || 0) * 0.32);
    this.step = 0;
    this.hand.classList.add('is-shuffling');
    this.watch();
    this.nextStep();
  }

  /** Transform that shows card i in fan slot j. */
  private at(i: number, j: number, lift = 0, scale = 1) {
    const a = this.slots[i];
    const b = this.slots[j];
    return `translate(${(b.x - a.x).toFixed(1)}px, ${(b.y - a.y + lift).toFixed(1)}px) rotate(${(b.r - a.r).toFixed(2)}deg) scale(${scale})`;
  }

  private nextStep() {
    const n = this.cards.length;
    const s = this.step;
    if (s >= n) return this.finish();
    const ms = STEP_MS * Math.min(1.5, Math.max(0.5, this.h.speed()));
    const prev = this.anims;
    this.anims = [];
    this.cards.forEach((c, i) => {
      const from = (((i - s) % n) + n) % n;
      const to = (((i - s - 1) % n) + n) % n;
      const fx = c.querySelector('.dc-fx') as HTMLElement | null;
      if (!fx) return;
      const wraps = from === 0;
      c.style.zIndex = String(wraps ? 70 : 10 + to);
      const frames = wraps
        ? // the back card: up, over the others and down onto the front
          [
            { transform: this.at(i, from) },
            { transform: this.at(i, Math.round((n - 1) / 2), -this.lift, 1.05), offset: 0.5 },
            { transform: this.at(i, to) },
          ]
        : [{ transform: this.at(i, from) }, { transform: this.at(i, to) }];
      const an = fx.animate(frames, { duration: ms, easing: wraps ? EASE.inOut : EASE.out, fill: 'forwards' });
      an.id = 'fidget';
      this.anims.push(an);
    });
    for (const a of prev) a.cancel();
    this.h.sfx.play('fidget');
    haptic('selection');
    this.step++;
    this.timer = window.setTimeout(() => this.nextStep(), ms * 0.92);
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
