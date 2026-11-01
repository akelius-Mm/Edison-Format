// Immediate press feedback. Mobile browsers apply :active late (Chromium waits to rule out a
// scroll) or not at all (iOS Safari, without a touchstart listener), so the shared press state in
// app.css is also driven by an `is-pressed` class set right on pointerdown. It stays at least a
// few frames, so even a quick tap shows it, and is dropped as soon as the finger moves (a scroll).
const PRESSABLE = "button, [role='button'], a[href], summary, .chip, .tile, .cb-row, .ios-row--nav, .ios-row--action, .duel-root .dc";
const MIN_SHOWN_MS = 90;
const MOVE_SLOP = 10;

let installed = false;

export function installPressFeedback() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  let cur: Element | null = null;
  let downAt = 0;
  let x = 0;
  let y = 0;
  let timer = 0;
  const clear = () => {
    window.clearTimeout(timer);
    cur?.classList.remove('is-pressed');
    cur = null;
  };
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return;
      clear();
      const t = (e.target as Element | null)?.closest?.(PRESSABLE);
      if (!t || (t as HTMLButtonElement).disabled || t.getAttribute('aria-disabled') === 'true' || t.classList.contains('is-disabled')) return;
      cur = t;
      downAt = performance.now();
      x = e.clientX;
      y = e.clientY;
      t.classList.add('is-pressed');
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    'pointermove',
    (e) => {
      if (cur && Math.abs(e.clientX - x) + Math.abs(e.clientY - y) > MOVE_SLOP) clear();
    },
    { capture: true, passive: true },
  );
  const release = () => {
    if (!cur) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(clear, Math.max(0, MIN_SHOWN_MS - (performance.now() - downAt)));
  };
  document.addEventListener('pointerup', release, { capture: true, passive: true });
  document.addEventListener('pointercancel', clear, { capture: true, passive: true });
  window.addEventListener('blur', clear);
  // iOS Safari only applies :active when the page listens for touches.
  document.addEventListener('touchstart', () => {}, { passive: true });
}
