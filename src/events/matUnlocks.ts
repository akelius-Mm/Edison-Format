// Prestige playmats (art in src/ui/theme/playmats.ts): which ones you've earned, and which mat an event
// puts on the table. Unlocks are kept in their own key so they outlive the 200-entry event history.
import type { EventKind } from './catalog';
import { YOU, loadSeason, loadSeasonArchive } from './circuit';
import { loadEventHistory, type EventHistoryEntry } from './run';
import { KEYS, load, save } from './storage';

export const MAT_REGIONAL = 'regional-silver';
export const MAT_REGIONAL_TOP = 'regional-top16';
export const MAT_SJC = 'championship-edison';
export const MAT_FEATURE = 'feature-table';
export const MAT_NATIONALS = 'nationals-indy';
export const MAT_CHAMPION = 'national-champion';

/** How each prestige mat is earned, as shown on a locked mat. */
export const MAT_UNLOCK_TEXT: Record<string, string> = {
  [MAT_REGIONAL]: 'Play a Regional Qualifier',
  [MAT_REGIONAL_TOP]: 'Make the top cut at a Regional',
  [MAT_SJC]: 'Play the Championship Series',
  [MAT_FEATURE]: 'Play at a feature table',
  [MAT_NATIONALS]: 'Earn a Nationals invite',
  [MAT_CHAMPION]: 'Win Nationals',
};

/** Feature tables: the first 8 tables of a big event's Swiss rounds (as shown on the event sheet). */
export const FEATURE_TABLES = 8;
export const BIG_FIELD = 40;

export function isFeatureMatch(size: number, m: { stage: 'swiss' | 'top'; table: number }) {
  return size > BIG_FIELD && m.stage === 'swiss' && m.table <= FEATURE_TABLES;
}

/**
 * The mat the event puts on the table for a match, or null for Locals (bring your own).
 * Nationals is always the Nationals mat; a Regional top cut gets the Top Cut mat; feature tables
 * and the Championship Series top cut are played on the Feature Table mat.
 */
export function eventTableMat(kind: EventKind, size: number, m: { stage: 'swiss' | 'top'; table: number }): string | null {
  switch (kind) {
    case 'nationals':
      return MAT_NATIONALS;
    case 'regional':
      return m.stage === 'top' ? MAT_REGIONAL_TOP : isFeatureMatch(size, m) ? MAT_FEATURE : MAT_REGIONAL;
    case 'sjc':
      return m.stage === 'top' || isFeatureMatch(size, m) ? MAT_FEATURE : MAT_SJC;
    default:
      return null;
  }
}

/** Mats earned from finished events, plus the Nationals mat once you hold an invite. */
export function matsEarnedFrom(history: Pick<EventHistoryEntry, 'kind' | 'place' | 'madeCut'>[], invitedToNationals: boolean): string[] {
  const out = new Set<string>();
  for (const e of history) {
    if (e.kind === 'regional') {
      out.add(MAT_REGIONAL);
      if (e.madeCut) out.add(MAT_REGIONAL_TOP);
    } else if (e.kind === 'sjc') {
      out.add(MAT_SJC);
      if (e.madeCut) out.add(MAT_FEATURE);
    } else if (e.kind === 'nationals') {
      out.add(MAT_NATIONALS);
      if (e.madeCut) out.add(MAT_FEATURE);
      if (e.place === 1) out.add(MAT_CHAMPION);
    }
  }
  if (invitedToNationals) out.add(MAT_NATIONALS);
  return [...out];
}

export function loadUnlockedMats(): string[] {
  const v = load<unknown>(KEYS.matUnlocks, []);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x in MAT_UNLOCK_TEXT) : [];
}

export const isMatUnlocked = (id: string) => !(id in MAT_UNLOCK_TEXT) || loadUnlockedMats().includes(id);

/** Record mats as earned; returns the ones that are new. */
export function unlockMats(ids: (string | null | undefined)[]): string[] {
  const have = loadUnlockedMats();
  const fresh = [...new Set(ids)].filter((id): id is string => !!id && id in MAT_UNLOCK_TEXT && !have.includes(id));
  if (fresh.length) save(KEYS.matUnlocks, [...have, ...fresh]);
  return fresh;
}

/** Re-check event history and invites (current season and archived ones); returns newly earned mats. */
export function syncMatUnlocks(): string[] {
  const season = loadSeason();
  const invited = !!season?.invites?.[YOU]?.nationals || loadSeasonArchive().some((a) => !!a.invites?.nationals);
  return unlockMats(matsEarnedFrom(loadEventHistory(), invited));
}
