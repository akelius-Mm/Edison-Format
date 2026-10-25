// Tap-to-hurry and fast-forward for the duel board.
//  - Tap anywhere on the board while a step animates: that step completes at once (and the tap
//    does nothing else, so it can't open a card by accident).
//  - The fast-forward button (shown during the opponent's turn): tap to speed through the rest of
//    the turn, tap again to stop; or hold it and let go to stop.
// Neither one answers or skips a decision prompt: fast-forward switches off whenever the player is
// asked something (DuelScreen.guard), and hurrying only ends animation and pacing waits.
import type { FxDirector } from './fx';

/** Animation speed factor while fast-forwarding (0 would skip the visuals entirely). */
export const FAST_FORWARD = 0.15;

export interface HurryHost {
  readonly root: HTMLElement;
  readonly fx: FxDirector;
  readonly spectator: boolean;
  setFastForward(on: boolean): void;
}

const FF_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M3.5 6.2v11.6c0 .8.9 1.3 1.6.8l8.2-5.8c.6-.4.6-1.2 0-1.6L5.1 5.4c-.7-.5-1.6 0-1.6.8Zm9 0v11.6c0 .8.9 1.3 1.6.8l8.2-5.8c.6-.4.6-1.2 0-1.6l-8.2-5.8c-.7-.5-1.6 0-1.6.8Z"/></svg>';

export function setupHurry(host: HurryHost, center: HTMLElement) {
  let swallow = 0;
  center.addEventListener(
    'pointerdown',
    (ev) => {
      if ((ev.target as HTMLElement).closest('.duel-ff, .dlg-layer')) return;
      if (!host.fx.busy) return;
      host.fx.hurry();
      // the click this tap produces is used up by the hurry
      swallow = performance.now();
    },
    true,
  );
  center.addEventListener(
    'click',
    (ev) => {
      if (!swallow) return;
      const fresh = performance.now() - swallow < 800;
      swallow = 0;
      if (!fresh) return;
      ev.stopPropagation();
      ev.preventDefault();
    },
    true,
  );

  if (host.spectator) return;
  const ff = document.createElement('button');
  ff.type = 'button';
  ff.className = 'duel-ff';
  ff.title = 'Fast-forward (tap, or hold)';
  ff.setAttribute('aria-label', "Fast-forward the opponent's turn");
  ff.setAttribute('aria-pressed', 'false');
  ff.innerHTML = `${FF_ICON}<span>Skip</span>`;
  const set = (on: boolean) => {
    host.setFastForward(on);
    ff.setAttribute('aria-pressed', String(on));
  };
  let downAt = 0;
  let wasOn = false;
  ff.addEventListener('pointerdown', (ev) => {
    ev.stopPropagation();
    downAt = performance.now();
    wasOn = host.root.classList.contains('is-ff');
    if (!wasOn) set(true);
  });
  const release = (ev: PointerEvent) => {
    ev.stopPropagation();
    if (!downAt) return;
    const held = performance.now() - downAt > 350;
    downAt = 0;
    // held: it ran while the finger was down; a tap on a running fast-forward stops it
    if (held || wasOn) set(false);
  };
  ff.addEventListener('pointerup', release);
  ff.addEventListener('pointercancel', release);
  ff.addEventListener('click', (ev) => {
    ev.stopPropagation();
    // keyboard (Enter / Space): a plain toggle
    if (ev.detail === 0) set(!host.root.classList.contains('is-ff'));
  });
  ff.addEventListener('contextmenu', (ev) => ev.preventDefault());
  center.appendChild(ff);
  // fast-forward stopped elsewhere (a decision came up): keep the button state honest
  new MutationObserver(() => ff.setAttribute('aria-pressed', String(host.root.classList.contains('is-ff')))).observe(host.root, { attributes: true, attributeFilter: ['class'] });
}
