// Tells the player what a finished duel or event earned them (Duel Points and packs).
import type { Grant } from '../../collection';
import { toast } from './dom';

export function announceReward(g: Grant) {
  const packs = g.packs.reduce((a, p) => a + p.count, 0);
  const parts = [g.coins ? `+${g.coins} DP` : '', packs ? `+${packs} pack${packs === 1 ? '' : 's'}` : ''].filter(Boolean);
  if (parts.length) toast(`${parts.join(' · ')} · ${g.reason}`, 'gold', 3600);
}
