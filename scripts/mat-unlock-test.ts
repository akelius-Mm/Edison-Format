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
import { PLAYMATS, PRESTIGE_MAT_IDS, artMatId, opponentMat, playmatById } from '../src/ui/theme/playmats';
import { SLEEVES, artSleeveId, sleeveById } from '../src/ui/theme/sleeves';
import { allCards } from '../src/cards';

const cardNames = new Set(allCards().map((c) => c.name));

let passed = 0;
const failures: string[] = [];
function check(ok: boolean, msg: string) {
  if (ok) passed++;
  else failures.push(msg);
}
const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

// ---- the mats exist, are offered, and are real-world mats: a card's official artwork on neoprene, with the
// event printed in the corner (an SVG text layer) and a stitched edge
for (const id of PRESTIGE_MAT_IDS) {
  const m = playmatById(id);
  check(m.id === id, `${id}: registered in PLAYMATS`);
  check(!!MAT_UNLOCK_TEXT[id], `${id}: has unlock text`);
  check(m.printedZones === true, `${id}: printed zones`);
  check(!!m.art && !!cardNames.has(m.art), `${id}: artwork of an Edison-era card (${m.art})`);
  check(!!m.edge, `${id}: stitched edge colour`);
  const svgs = [...m.css.matchAll(/data:image\/svg\+xml;utf8,([^"]*)"\)/g)].map((x) => decodeURIComponent(x[1]));
  const svg = svgs.find((x) => x.includes('<text')) ?? '';
  check(svg.startsWith('<svg') && svg.endsWith('</svg>'), `${id}: css holds the event print`);
  const open = (svg.match(/<(g|defs|filter|svg|text)[\s>]/g) ?? []).length;
  const close = (svg.match(/<\/(g|defs|filter|svg|text)>/g) ?? []).length;
  check(open === close, `${id}: balanced tags (${open} open, ${close} close)`);
  check(!/NaN|undefined/.test(m.css), `${id}: no NaN/undefined in the css`);
}
check(PLAYMATS.length === 20, `20 mats offered (got ${PLAYMATS.length})`);
check(new Set(PLAYMATS.map((m) => m.id)).size === PLAYMATS.length, 'mat ids are unique');
for (const m of PLAYMATS) if (m.art) check(cardNames.has(m.art), `${m.id}: art card ${m.art} is in the card pool`);
for (const s of SLEEVES) if (s.art) check(cardNames.has(s.art), `${s.id}: art card ${s.art} is in the card pool`);

// ---- older saves named drawn designs: they still load, as the closest real mat or sleeve
check(playmatById('edison-2010').id === artMatId('Dark Armed Dragon'), 'legacy edison-2010 mat: Dark Armed Dragon art mat');
check(playmatById('shadow-realm').id === 'tournament-black', 'legacy fantasy mat: black neoprene');
check(playmatById('no-such-mat').id === PLAYMATS[0].id, 'unknown mat: the first mat');
check(playmatById(artMatId('Cyber Dragon')).art === 'Cyber Dragon', 'any card can be printed on a mat');
check(sleeveById('classic-red').id === 'matte-red', 'legacy classic-red sleeve: matte red');
check(sleeveById('arcane-circle').id === 'matte-purple', 'legacy arcane-circle sleeve: matte purple');
check(sleeveById('stardust-wings').id === artSleeveId('Stardust Dragon'), 'legacy stardust-wings sleeve: Stardust Dragon art sleeve');
check(sleeveById(artSleeveId('Cyber Dragon')).art === 'Cyber Dragon', 'any card can be an art sleeve');
check(sleeveById('nope').id === SLEEVES[0].id, 'unknown sleeve: the first sleeve');
// without official images an art mat or sleeve falls back to its plain surface (no artwork URL in the css)
check(!/url\("https?:/.test(playmatById(artMatId('Stardust Dragon')).css), 'art mat without the artwork: plain neoprene');
check(!/url\("https?:/.test(sleeveById(artSleeveId('Stardust Dragon')).css), 'art sleeve without the artwork: plain sleeve');

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
