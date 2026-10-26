// Motion tokens for code: the same curves and lengths as the CSS variables in theme/theme.css
// (--ease-*, --dur-*), for Web Animations (element.animate) and timers. Keep the two in step.

export const EASE = {
  /** Things arriving, settling. */
  out: 'cubic-bezier(0.22, 1, 0.36, 1)',
  /** Things leaving, falling away. */
  in: 'cubic-bezier(0.55, 0, 0.75, 0.2)',
  /** Moves from A to B, loops. */
  inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  /** A small overshoot: lifts, pops. */
  spring: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
  /** A card slapped down: squash and settle. */
  land: 'cubic-bezier(0.3, 1.6, 0.5, 1)',
} as const;

/** Lengths in ms (--dur-fast / --dur-base / --dur-slow / --dur-big). */
export const DUR = { fast: 150, base: 220, slow: 300, big: 600 } as const;

/** The system asks for less motion (no shaking, lunging or flying; things fade in place). */
export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
