// Placeholder — implemented by the duel UI.
import type { DuelOptions, DuelResult } from './api';

export async function startDuel(container: HTMLElement, opts: DuelOptions): Promise<DuelResult> {
  container.textContent = 'Duel screen not implemented yet.';
  void opts;
  return { winner: null, reason: 'not implemented', turns: 0 };
}
