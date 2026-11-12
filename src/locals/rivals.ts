// What the regulars remember about you: a tag for the state of the rivalry and a line about the last time you
// played. Pure functions over the saved record (night.ts: recordRivalMatch), so they can be tested headless.
import type { Regular } from './regulars';
import type { RivalRecord } from './types';

const DAY = 86400000;

export const rivalFirstName = (r: Pick<Regular, 'name'>) => r.name.replace(/^Big /, '').split(' ')[0];

export const rivalPlayed = (rec?: RivalRecord) => (rec ? rec.w + rec.l + rec.d : 0);

/** "2-1" or "2-1-1" (wins, losses, draws: yours first), or null before you have played. */
export function rivalRecordText(rec?: RivalRecord): string | null {
  return rec && rivalPlayed(rec) ? `${rec.w}-${rec.l}${rec.d ? `-${rec.d}` : ''}` : null;
}

/** "today", "yesterday", "3 days ago", "2 weeks ago", "3 months ago". */
export function agoText(at: number, now = Date.now()): string {
  const d0 = new Date(at);
  const d1 = new Date(now);
  const days = Math.round((Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate()) - Date.UTC(d0.getFullYear(), d0.getMonth(), d0.getDate())) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

export type RivalTag = 'nemesis' | 'rematch' | 'streak' | 'even' | 'new';

/**
 * The state of the rivalry in one word:
 * nemesis  they are ahead of you (and have beaten you at least twice)
 * streak   you have beaten them at least twice in a row
 * rematch  you won the last one: they want it back
 * even     you have played, and none of the above
 * new      never played
 */
export function rivalTag(rec?: RivalRecord): RivalTag {
  if (!rec || !rivalPlayed(rec)) return 'new';
  if (rec.l >= 2 && rec.l > rec.w) return 'nemesis';
  if ((rec.streak ?? 0) >= 2) return 'streak';
  if (rec.last?.result === 'W') return 'rematch';
  return 'even';
}

export const RIVAL_TAG_LABEL: Record<RivalTag, string> = { nemesis: 'Nemesis', streak: 'On the run', rematch: 'Wants a rematch', even: 'Rival', new: 'Not played' };

/** The line under a rival's name: the last meeting as they remember it, or their blurb before you have played. */
export function rivalMemory(r: Pick<Regular, 'name' | 'blurb'>, rec?: RivalRecord, now = Date.now()): string {
  const m = rec?.last;
  if (!rec || !m) {
    // records saved before meetings were remembered: only the count is known
    const t = rivalRecordText(rec);
    return t ? `You are ${t} against ${rivalFirstName(r)}. ${r.blurb}` : r.blurb;
  }
  const first = rivalFirstName(r);
  const where = m.where === 'a challenge' ? 'in a challenge' : `at ${m.where}`;
  const when = agoText(m.at, now);
  const streak = rec.streak ?? 0;
  if (m.result === 'W') {
    const tail = streak >= 3 ? `That is ${streak} in a row.` : streak === 2 ? 'Twice in a row now.' : `${first} wants it back.`;
    return `You won ${m.score}${m.myDeck ? ` with ${m.myDeck}` : ''} ${where}, ${when}. ${tail}`;
  }
  if (m.result === 'L') {
    const [a, b] = m.score.split('-');
    const tail = streak <= -3 ? `That is ${-streak} in a row.` : streak === -2 ? 'Twice in a row now.' : 'Your move.';
    return `${first} beat you ${b}-${a}${m.theirDeck ? ` with ${m.theirDeck}` : ''} ${where}, ${when}. ${tail}`;
  }
  return `You drew ${m.score} ${where}, ${when}. Unfinished business.`;
}
