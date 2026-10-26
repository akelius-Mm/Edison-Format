// Hand-shuffle fidget: swipe sideways across your own hand and it is shuffled the way players do it at
// locals. The leftmost card is held, lifted a little; then, one at a time from the right-hand end of the
// hand, each card travels across to the left and lands on top of it, building a stack there (the held
// card ends up at the back); then the stack fans back out. The same on either turn. Purely cosmetic: each
// card fans back out to its own place (the hand's order never changes), nothing is selected or played,
// and it never runs while you are asked to pick something (a prompt, a menu, attack targets). On your own
// turn a tap on the hand stops it at once, so the tap selects the card under your finger as usual.
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
/** Lifting the held card, one card's trip to the stack, and fanning the stack back out (ms at Normal speed). */
const HOLD_MS = DUR.fast;
const PULL_MS = DUR.fast * 1.3;
const SPREAD_MS = DUR.slow;
/** Most cards moved onto the stack in one shuffle (the rest of a big hand stays put). */
const MAX_PULLS = 9;

/** How many cards travel onto the stack in one shuffle: every card but the held one, from the right. */
export function pullCount(n: number): number {
  return n < 2 ? 0 : Math.min(MAX_PULLS, n - 1);
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
  /** The steps of the shuffle in progress (hold, pulls..., spread), run one after another. */
  private plan: (() => number)[] = [];
  /** The cards (indexes into `cards`) on the stack, bottom (the held card) to top. */
  private stack: number[] = [];
  /** Card size. */
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

  /** One shuffle: hold the leftmost card, bring the others onto it from the right, fan out again (queued if one is playing). */
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
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: parseFloat(c.style.getPropertyValue('--fan-r')) || 0 };
    });
    this.cw = this.cards[0].offsetWidth || 60;
    this.ch = this.cards[0].offsetHeight || this.cw * 1.45;
    this.stack = [0];
    this.plan = [() => this.hold()];
    for (let k = 1; k <= pullCount(n); k++) this.plan.push(() => this.pull(n - k));
    this.plan.push(() => this.spread());
    this.hand.classList.add('is-shuffling');
    this.watch();
    this.nextStep();
  }

  private ms(base: number) {
    return base * Math.min(1.5, Math.max(0.5, this.h.speed()));
  }

  /** Transform that puts card i at page point (x, y), tilted by `r` (deg), scaled. */
  private toPoint(i: number, x: number, y: number, r = 0, scale = 1) {
    const a = this.slots[i];
    return `translate(${(x - a.x).toFixed(1)}px, ${(y - a.y).toFixed(1)}px) rotate(${(r - a.r).toFixed(2)}deg) scale(${scale})`;
  }

  /** Where a card sits on the stack at this level (0 = the held card): over the leftmost slot, each card a hair higher. */
  private onStack(i: number, level: number) {
    const s = this.slots[0];
    return this.toPoint(i, s.x + this.cw * (0.18 + level * 0.035), s.y - this.ch * 0.14 - level * 0.8, s.r * 0.4 + level * 0.5, 1.04);
  }

  private animate(i: number, frames: Keyframe[], ms: number, easing: string) {
    const fx = this.cards[i].querySelector('.dc-fx') as HTMLElement | null;
    if (!fx) return;
    const an = fx.animate(frames, { duration: ms, easing, fill: 'forwards' });
    an.id = 'fidget';
    this.anims.push(an);
  }

  /** The cards already on the stack stay put (their pose is re-stated: the previous step's animations end). */
  private keepStack(ms: number) {
    this.stack.forEach((card, level) => this.animate(card, [{ transform: this.onStack(card, level) }, { transform: this.onStack(card, level) }], ms, 'linear'));
  }

  /** The leftmost card is taken up a little: the start of the stack. */
  private hold() {
    const ms = this.ms(HOLD_MS);
    this.cards[0].style.zIndex = '80';
    this.animate(0, [{ transform: 'none' }, { transform: this.onStack(0, 0) }], ms, EASE.out);
    return ms;
  }

  /** Card i travels from its place in the fan across to the left and lands on top of the stack. */
  private pull(i: number) {
    const ms = this.ms(PULL_MS);
    const level = this.stack.length;
    const a = this.slots[i];
    const s = this.slots[0];
    this.keepStack(ms);
    // it passes over the cards between, so it is on top from the start
    this.cards[i].style.zIndex = String(80 + level);
    this.animate(
      i,
      [
        { transform: 'none' },
        // lifted out of the fan and carried left, leaning into the move
        { transform: this.toPoint(i, (a.x + s.x) / 2 + this.cw * 0.1, Math.min(a.y, s.y) - this.ch * 0.3, -8, 1.06), offset: 0.5 },
        { transform: this.onStack(i, level) },
      ],
      ms,
      EASE.inOut,
    );
    this.stack.push(i);
    this.h.sfx.play('fidget');
    haptic('selection');
    return ms * 0.92;
  }

  /** The stack fans back out: every card to its own place, in the original order. */
  private spread() {
    const ms = this.ms(SPREAD_MS);
    this.stack.forEach((card, level) => this.animate(card, [{ transform: this.onStack(card, level) }, { transform: 'none' }], ms, EASE.out));
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
