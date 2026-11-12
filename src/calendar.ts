// The real calendar. Events are dated in the present: Locals is this Friday, a Regional is this Saturday, and a
// season's weeks count on from the week you started it. (The cards, rules and banlist are still April 2010:
// CLAUDE.md. Only the world around the table is today's.)

const DAY = 86400000;

export interface EventDate {
  /** "2026-11-13" */
  iso: string;
  /** "Friday, November 13, 2026" */
  label: string;
}

/** The player's calendar day containing `at`, as UTC midnight (so date maths never crosses a DST change). */
function dayOf(at: number): number {
  const d = new Date(at);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

/** A day (UTC midnight, from the functions here) as an ISO date and a long label. */
export function eventDateOf(day: number): EventDate {
  const d = new Date(day);
  return { iso: d.toISOString().slice(0, 10), label: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) };
}

/** The next `weekday` (0 = Sunday ... 5 = Friday, 6 = Saturday) on or after the day containing `at`. */
export function nextWeekday(weekday: number, at = Date.now()): number {
  const day = dayOf(at);
  return day + ((weekday - new Date(day).getUTCDay() + 7) % 7) * DAY;
}

/** The Friday a season week falls on: week 1 is the first Friday on or after the day the season started. */
export function seasonFriday(startedAt: number, week: number): number {
  return nextWeekday(5, startedAt) + (week - 1) * 7 * DAY;
}

/** Is this ISO date the player's today? */
export function isToday(iso: string, at = Date.now()): boolean {
  return eventDateOf(dayOf(at)).iso === iso;
}

/**
 * A long date label for a line of text: "Friday, November 13" (the year is dropped when it is this year, and
 * for nights saved before events were dated in the present). `noWeekday` drops "Friday, " too.
 */
export function shortDate(label: string, opts: { noWeekday?: boolean; at?: number } = {}): string {
  const year = new Date(opts.at ?? Date.now()).getFullYear();
  let s = label.replace(new RegExp(`, (${year}|2010)$`), '');
  if (opts.noWeekday) s = s.replace(/^\w+, /, '');
  return s;
}

/** The year of an ISO date. */
export function yearOf(iso: string): string {
  return iso.slice(0, 4);
}
