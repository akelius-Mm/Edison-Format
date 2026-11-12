// Events are dated on the real calendar (src/calendar.ts): Locals is this Friday, other events this Saturday,
// and a season's weeks count on from the week it was started. Run: tsx scripts/calendar-test.ts
import { eventDateOf, isToday, nextWeekday, seasonFriday, shortDate } from '../src/calendar';
import { eventDate, standaloneDate } from '../src/events/catalog';
import { buildCalendar } from '../src/events/circuit';
import { nightDate } from '../src/locals';

let failed = 0;
function check(cond: boolean, msg: string) {
  if (!cond) {
    failed++;
    console.log(`  FAIL ${msg}`);
  }
}
/** Noon on a local calendar day. */
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime();

console.log('Calendar (events dated in the present)');

// Thursday, November 12, 2026
const thu = at(2026, 11, 12);
check(nightDate(thu).iso === '2026-11-13', `Locals on a Thursday is tomorrow: ${nightDate(thu).iso}`);
check(nightDate(thu).label === 'Friday, November 13, 2026', `label: ${nightDate(thu).label}`);
check(nightDate(at(2026, 11, 13)).iso === '2026-11-13', 'Locals on a Friday is tonight');
check(nightDate(at(2026, 11, 14)).iso === '2026-11-20', 'Locals on a Saturday is next Friday');
check(standaloneDate('regional', thu).iso === '2026-11-14', 'a one-off Regional is this Saturday');
check(standaloneDate('regional', at(2026, 11, 14)).iso === '2026-11-14', 'a Regional on a Saturday is today');
check(standaloneDate('sjc', at(2026, 11, 15)).iso === '2026-11-21', 'on a Sunday the next Saturday');
check(standaloneDate('locals', thu).iso === nightDate(thu).iso, 'one-off Locals matches Locals Night');

// every day of a year: always a Friday, never in the past, less than a week away
for (let i = 0; i < 366; i++) {
  const now = at(2026, 1, 1) + i * 86400000;
  const d = new Date(`${nightDate(now).iso}T00:00:00Z`);
  const today = new Date(`${eventDateOf(nextWeekday(new Date(now).getDay(), now)).iso}T00:00:00Z`);
  const ahead = (d.getTime() - today.getTime()) / 86400000;
  if (d.getUTCDay() !== 5 || ahead < 0 || ahead > 6) {
    check(false, `day ${i}: ${nightDate(now).iso} (ahead ${ahead})`);
    break;
  }
}

// a season started on a Thursday: week 1 is that week, week 12 eleven weeks on; year rolls over
check(eventDate('locals', 1, thu).iso === '2026-11-13', 'season week 1 Locals');
check(eventDate('regional', 1, thu).iso === '2026-11-14', 'season week 1 Saturday event');
check(eventDate('nationals', 12, thu).iso === '2027-01-30', `week 12 Nationals: ${eventDate('nationals', 12, thu).iso}`);
check(eventDateOf(seasonFriday(thu, 5)).iso === '2026-12-11', 'week 5 Friday');
const cal = buildCalendar(1234, thu);
check(cal.every((e) => !e.date.startsWith('2010')), 'no season event is dated 2010');
check(cal.every((e) => new Date(`${e.date}T00:00:00Z`).getUTCDay() === (e.kind === 'locals' ? 5 : 6)), 'Locals on Fridays, everything else on Saturdays');
check(cal.every((e, i) => i === 0 || e.date >= cal[i - 1].date), 'season dates run forward');
check(cal[0].date === '2026-11-13', `the season starts this week: ${cal[0].date}`);

// labels
check(isToday('2026-11-12', thu) && !isToday('2026-11-13', thu), 'isToday');
check(shortDate('Friday, November 13, 2026', { at: thu }) === 'Friday, November 13', 'this year is dropped');
check(shortDate('Saturday, January 30, 2027', { at: thu }) === 'Saturday, January 30, 2027', 'another year is kept');
check(shortDate('Friday, April 23, 2010', { at: thu }) === 'Friday, April 23', 'nights saved under 2010 dates lose the year');
check(shortDate('Friday, November 13, 2026', { at: thu, noWeekday: true }) === 'November 13', 'noWeekday');

console.log(failed ? `${failed} failed` : '  all passed');
process.exit(failed ? 1 : 0);
