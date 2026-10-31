// Prestige playmats: the six event mats exist and render, unlock from event results and invites, and the
// event puts the right mat on the table (tier mat, Regional top-cut mat, feature tables, Nationals).
// Usage: npx tsx scripts/mat-unlock-test.ts
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};

import { EVENT_KEYS, eventTableMat, isMatUnlocked, loadUnlockedMats, matsEarnedFrom, syncMatUnlocks, unlockMats, MAT_UNLOCK_TEXT } from '../src/events';
import { PLAYMATS, PRESTIGE_MAT_IDS, opponentMat, playmatById } from '../src/ui/theme/playmats';

let passed = 0;
const failures: string[] = [];
function check(ok: boolean, msg: string) {
  if (ok) passed++;
  else failures.push(msg);
}
const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

// ---- the mats exist, are offered, and render as SVG with balanced tags
for (const id of PRESTIGE_MAT_IDS) {
  const m = playmatById(id);
  check(m.id === id, `${id}: registered in PLAYMATS`);
  check(!!MAT_UNLOCK_TEXT[id], `${id}: has unlock text`);
  check(m.printedZones === true, `${id}: printed zones`);
  const svg = decodeURIComponent(/data:image\/svg\+xml;utf8,(.*?)"\)/.exec(m.css)?.[1] ?? '');
  check(svg.startsWith('<svg') && svg.endsWith('</svg>'), `${id}: css holds an SVG`);
  const open = (svg.match(/<(g|defs|filter|svg|text)[\s>]/g) ?? []).length;
  const close = (svg.match(/<\/(g|defs|filter|svg|text)>/g) ?? []).length;
  check(open === close, `${id}: balanced tags (${open} open, ${close} close)`);
  check(!/NaN|undefined/.test(svg), `${id}: no NaN/undefined in the SVG`);
}
check(PLAYMATS.length === 13, `13 mats offered (got ${PLAYMATS.length})`);
// opponents never bring an event mat you have to earn
for (const name of ['Nick Ma', 'Bryan Ortiz', 'Renaldo Lainez', 'Sara', 'Tom', 'Jae', 'Ana', 'Marcus', 'Dami', 'Edwin']) check(!(PRESTIGE_MAT_IDS as readonly string[]).includes(opponentMat(name, 'tournament-black')), `opponentMat(${name}) is not a prestige mat`);

// ---- which mat the event puts on the table
const swiss = (table: number) => ({ stage: 'swiss' as const, table });
const top = { stage: 'top' as const, table: 1 };
check(eventTableMat('locals', 16, swiss(1)) === null, 'Locals: bring your own mat');
check(eventTableMat('regional', 96, swiss(20)) === 'regional-silver', 'Regional Swiss: Silver Series');
check(eventTableMat('regional', 96, swiss(3)) === 'feature-table', 'Regional table 3 of a big field: Feature Table');
check(eventTableMat('regional', 32, swiss(3)) === 'regional-silver', 'small Regional has no feature tables');
check(eventTableMat('regional', 96, top) === 'regional-top16', 'Regional top cut: Top Cut mat');
check(eventTableMat('sjc', 512, swiss(40)) === 'championship-edison', 'SJC Swiss: Championship Series');
check(eventTableMat('sjc', 512, swiss(8)) === 'feature-table', 'SJC table 8: Feature Table');
check(eventTableMat('sjc', 512, swiss(9)) === 'championship-edison', 'SJC table 9 is not a feature table');
check(eventTableMat('sjc', 512, top) === 'feature-table', 'SJC top cut: Feature Table');
check(eventTableMat('nationals', 256, swiss(2)) === 'nationals-indy', 'Nationals feature table keeps the Nationals mat');
check(eventTableMat('nationals', 256, top) === 'nationals-indy', 'Nationals top cut: Nationals mat');

// ---- what results earn
const e = (kind: 'locals' | 'regional' | 'sjc' | 'nationals', place: number, madeCut: boolean) => ({ kind, place, madeCut });
check(same(matsEarnedFrom([], false), []), 'nothing played: nothing earned');
check(same(matsEarnedFrom([e('locals', 1, true)], false), []), 'winning Locals earns no event mat');
check(same(matsEarnedFrom([e('regional', 40, false)], false), ['regional-silver']), 'playing a Regional: Silver Series');
check(same(matsEarnedFrom([e('regional', 7, true)], false), ['regional-silver', 'regional-top16']), 'Regional top cut adds the Top Cut mat');
check(same(matsEarnedFrom([e('sjc', 300, false)], false), ['championship-edison']), 'playing the SJC');
check(same(matsEarnedFrom([e('sjc', 20, true)], false), ['championship-edison', 'feature-table']), 'SJC top cut adds Feature Table');
check(same(matsEarnedFrom([], true), ['nationals-indy']), 'a Nationals invite earns the Nationals mat');
check(same(matsEarnedFrom([e('nationals', 2, true)], false), ['nationals-indy', 'feature-table']), 'Nationals finalist: no Champion mat');
check(matsEarnedFrom([e('nationals', 1, true)], false).includes('national-champion'), 'winning Nationals earns the Champion mat');

// ---- storage: unlocks persist, are deduplicated, and ignore unknown ids
check(!isMatUnlocked('regional-silver'), 'locked before any event');
check(isMatUnlocked('tournament-black'), 'ordinary mats are never locked');
check(same(unlockMats(['regional-silver', 'regional-silver', 'tournament-black', null, 'bogus']), ['regional-silver']), 'unlockMats returns only new prestige mats');
check(same(unlockMats(['regional-silver']), []), 'unlocking again is not new');
check(isMatUnlocked('regional-silver'), 'unlocked after unlockMats');
store.set(EVENT_KEYS.matUnlocks, '{"broken":true}');
check(same(loadUnlockedMats(), []), 'a damaged unlock list reads as empty');

// sync from history + archived invites
store.set(EVENT_KEYS.matUnlocks, '[]');
store.set(EVENT_KEYS.eventHistory, JSON.stringify([{ id: 'x', kind: 'nationals', place: 1, madeCut: true }, { id: 'y', kind: 'regional', place: 50, madeCut: false }]));
check(same(syncMatUnlocks(), ['regional-silver', 'nationals-indy', 'feature-table', 'national-champion']), 'sync unlocks from event history');
check(same(syncMatUnlocks(), []), 'second sync finds nothing new');
store.set(EVENT_KEYS.matUnlocks, '[]');
store.set(EVENT_KEYS.eventHistory, '[]');
store.set(EVENT_KEYS.seasonArchive, JSON.stringify([{ id: 's1', number: 1, invites: { nationals: 'Regional Top 8' } }]));
check(same(syncMatUnlocks(), ['nationals-indy']), 'an archived season invite unlocks the Nationals mat');

if (failures.length) {
  console.log(`mat-unlock-test: ${passed} passed, ${failures.length} FAILED`);
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`mat-unlock-test: all ${passed} checks passed`);
