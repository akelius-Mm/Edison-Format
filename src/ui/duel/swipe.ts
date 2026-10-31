// Swipe up to play: drag a card in your hand up towards the field and let go to play it, one-handed.
//  - only while you are asked for your next play (your own priority, not a response prompt or the AI's
//    turn) and Settings → Swipe up to play is on; never when spectating or restoring a duel
//  - the card lifts once the finger has moved ~12px mostly upwards; a mostly sideways move is left to
//    the hand shuffle (fidget.ts) and a still hold to the card preview (DuelScreen.setupPhoneGestures)
//  - let go above the commit line (the top of the hand, and at least MIN_TRAVEL px up): the host plays
//    the card's only action, or opens the same menu a tap opens (several actions, or the reason it
//    can't be used); let go below it and the card settles back into the hand, nothing happens
//  - transforms only (inline on the .dc, cleared by BoardView when the card leaves the hand), lengths
//    scaled by the animation speed; no lift pop or settling animation for reduced motion / Instant
import type { CardInstance } from '../../engine/card';
import type { PlayerId } from '../../engine/types';
import { haptic } from '../haptics';
import { DUR, EASE, reducedMotion } from '../motion';
import type { BoardView } from './board';
import type { HandFidget } from './fidget';

export interface SwipeHost {
  readonly board: BoardView;
  readonly fidget: HandFidget;
  readonly me: PlayerId;
  readonly spectator: boolean;
  speed(): number;
  card(uid: number): CardInstance | undefined;
  /** Swiping is switched on and this card of yours can be picked up right now. */
  canSwipe(c: CardInstance): boolean;
  /**
   * Let go above the line: 'played' when the card's only action was taken (the card is leaving the
   * hand), 'menu' when the tap menu opened instead (or nothing could be done).
   */
  play(c: CardInstance, el: HTMLElement): 'played' | 'menu';
  /** A prompt is up (e.g. Tributes for the summon just made): a held card goes back to the hand. */
  prompting(): boolean;
}

/** Upward travel (px) that lifts the card, and how much more upward than sideways it must be. */
const LIFT_PX = 12;
const VERTICAL = 1.2;
/** The finger must also have travelled this far up to play (a lift near the hand's top edge isn't a play). */
const MIN_TRAVEL = 40;
/** The commit line sits this far (× card height) above the top of the hand. */
const LINE_ABOVE = 0.15;
/** A still hold this long opened the card preview instead (setupPhoneGestures uses 420 ms). */
const HOLD_MS = 400;
/** A played card waits at the drop point this long at most for the board to take it. */
const HOLD_PLAYED_MS = 1500;

interface Gesture {
  id: number;
  el: HTMLElement;
  uid: number;
  x0: number;
  y0: number;
  t0: number;
  /** When the finger first left the tap slop (0 = not yet). */
  movedAt: number;
  lifted: boolean;
  line: number;
  dx: number;
  dy: number;
  armed: boolean;
}

export class SwipePlay {
  private hand: HTMLElement;
  private side: HTMLElement;
  private g: Gesture | null = null;
  private raf = 0;
  private holdRaf = 0;
  private swallowAt = 0;
  private off: (() => void)[] = [];

  constructor(private h: SwipeHost) {
    this.hand = h.board.sideOf(h.me).hand;
    this.side = h.board.sideOf(h.me).root;
    if (h.spectator) return;
    const down = (ev: PointerEvent) => {
      if (ev.button !== 0 || !ev.isPrimary || this.g) return;
      const el = (ev.target as HTMLElement).closest('.dc') as HTMLElement | null;
      if (!el || el.parentElement !== this.hand || el.classList.contains('dc-ghost') || el.classList.contains('dc-moving')) return;
      const c = h.card(Number(el.dataset.uid));
      if (!c || !h.canSwipe(c)) return;
      this.swallowAt = 0;
      this.g = { id: ev.pointerId, el, uid: c.uid, x0: ev.clientX, y0: ev.clientY, t0: performance.now(), movedAt: 0, lifted: false, line: 0, dx: 0, dy: 0, armed: false };
    };
    const move = (ev: PointerEvent) => {
      const g = this.g;
      if (!g || ev.pointerId !== g.id) return;
      const dx = ev.clientX - g.x0;
      const dy = ev.clientY - g.y0;
      if (!g.lifted) {
        if (!g.movedAt && Math.hypot(dx, dy) > 10) {
          g.movedAt = performance.now();
          // held still first: that was a long-press (the preview opened), not a swipe
          if (g.movedAt - g.t0 >= HOLD_MS) return void (this.g = null);
        }
        // sideways: the shuffle's (or just a wobble); downwards: nothing
        if (dy >= LIFT_PX || (Math.abs(dx) >= LIFT_PX && Math.abs(dx) * VERTICAL >= -dy)) return void (this.g = null);
        if (-dy < LIFT_PX || -dy < Math.abs(dx) * VERTICAL) return;
        const c = h.card(g.uid);
        if (h.fidget.swiping || !c || !h.canSwipe(c)) return void (this.g = null);
        this.lift(g);
      }
      g.dx = dx;
      g.dy = dy;
      const armed = ev.clientY < g.line && -dy >= MIN_TRAVEL;
      if (armed !== g.armed) {
        g.armed = armed;
        this.side.classList.toggle('is-armed', armed);
      }
      if (!this.raf) this.raf = requestAnimationFrame(() => this.paint());
    };
    const up = (ev: PointerEvent) => {
      const g = this.g;
      if (!g || ev.pointerId !== g.id) return;
      this.g = null;
      if (!g.lifted) return;
      // the click this release may produce is the swipe's, not a tap
      this.swallowAt = performance.now();
      if (ev.type === 'pointerup' && g.armed) this.commit(g);
      else this.settle(g);
    };
    const click = (ev: MouseEvent) => {
      if (!this.swallowAt || performance.now() - this.swallowAt > 700) return;
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

  private still() {
    return reducedMotion() || this.h.speed() <= 0;
  }

  private lift(g: Gesture) {
    g.lifted = true;
    // the shuffle never starts from this touch, and an open card menu makes way
    this.h.fidget.release();
    const r = this.hand.getBoundingClientRect();
    g.line = r.top - g.el.offsetHeight * LINE_ABOVE;
    const el = g.el;
    el.classList.remove('is-pressed');
    el.classList.add('is-swiping');
    // a quick ease to the finger, then it follows exactly
    el.style.transition = this.still() ? 'none' : `transform ${DUR.fast}ms ${EASE.out}`;
    window.setTimeout(() => {
      if (el.classList.contains('is-swiping')) el.style.transition = 'none';
    }, DUR.fast);
    this.side.classList.add('swipe-drop');
    haptic('light');
  }

  private paint() {
    this.raf = 0;
    const g = this.g;
    if (!g?.lifted) return;
    const sc = this.still() ? 1 : 1.08;
    g.el.style.transform = `translate(${g.dx.toFixed(1)}px, ${g.dy.toFixed(1)}px) scale(${sc})`;
  }

  private clearDrop() {
    this.side.classList.remove('swipe-drop', 'is-armed');
  }

  private commit(g: Gesture) {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.g = g;
    this.paint();
    this.g = null;
    this.clearDrop();
    const c = this.h.card(g.uid);
    if (!c || !this.h.canSwipe(c)) return this.settle(g);
    haptic('light');
    if (this.h.play(c, g.el) === 'played') this.hold(g.el);
    else this.settle(g);
  }

  /**
   * The card was played: it stays where it was dropped so it flies to the field from there (BoardView
   * clears the drag transform when the card leaves the hand). If the play asks something first (a
   * Tribute, a target) or nothing moves, it goes back to the hand meanwhile.
   */
  private hold(el: HTMLElement) {
    cancelAnimationFrame(this.holdRaf);
    const t0 = performance.now();
    const tick = () => {
      this.holdRaf = 0;
      if (!el.isConnected || el.dataset.place !== 'hand' || !el.classList.contains('is-swiping')) return;
      if (this.h.prompting() || performance.now() - t0 > HOLD_PLAYED_MS) return this.settleEl(el);
      this.holdRaf = requestAnimationFrame(tick);
    };
    this.holdRaf = requestAnimationFrame(tick);
  }

  private settle(g: Gesture) {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.clearDrop();
    this.settleEl(g.el);
  }

  /** Back into the hand (the fan's own transform takes over again). */
  private settleEl(el: HTMLElement) {
    const done = () => {
      el.classList.remove('is-swiping');
      el.style.transition = '';
    };
    if (this.still() || !el.isConnected) {
      el.style.transition = 'none';
      el.style.transform = '';
      return done();
    }
    const ms = Math.round(DUR.slow * Math.min(1.5, Math.max(0.5, this.h.speed())));
    el.style.transition = `transform ${ms}ms ${EASE.out}`;
    el.style.transform = '';
    window.setTimeout(() => {
      // not picked up again in the meantime
      if (this.g?.el !== el && !el.style.transform) done();
    }, ms + 30);
  }

  /** Drop any drag at once (the duel is ending or the board is rebuilt). */
  cancel() {
    const g = this.g;
    this.g = null;
    if (g?.lifted) this.settle(g);
    cancelAnimationFrame(this.holdRaf);
    this.holdRaf = 0;
    this.clearDrop();
  }

  dispose() {
    this.cancel();
    for (const f of this.off) f();
    this.off = [];
  }
}
