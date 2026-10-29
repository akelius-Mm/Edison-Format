// Progress backup (Settings → Data): a backup holds every "edison." key except per-device ones, restores
// onto another device without touching that device's keys, rejects files that aren't backups, and puts
// the old progress back if the browser runs out of space part-way.
// Usage: npx tsx scripts/backup-test.ts
import { backupFileName, createBackup, describeBackup, parseBackup, restoreBackup } from '../src/ui/backup';

let passed = 0;
const failures: string[] = [];
function check(ok: boolean, msg: string) {
  if (ok) passed++;
  else failures.push(msg);
}
function throws(f: () => unknown, re: RegExp) {
  try {
    f();
  } catch (e) {
    return re.test((e as Error).message);
  }
  return false;
}

function memStore(init: Record<string, string> = {}, quota = Infinity) {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => {
      const size = [...m].reduce((n, [a, b]) => n + (a === k ? 0 : a.length + b.length), 0) + k.length + v.length;
      if (size > quota) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
      m.set(k, v);
    },
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

const phoneA = memStore({
  'edison.decks.v1': JSON.stringify([{ id: 'd1', name: 'Plants' }, { id: 'd2', name: 'Blackwings' }]),
  'edison.collection.v1': JSON.stringify({ v: 1, dp: 500, owned: { 'Card Trooper': { c: 3 }, 'Stardust Dragon': { ur: 1, sr: 1 } } }),
  'edison.profile.v1': JSON.stringify({ games: { w: 7, l: 4, d: 1 } }),
  'edison.settings.v1': '{"playerName":"Yugi"}',
  'edison.clientId': 'phone-a',
  'edison.errors.v1': '[]',
  'edison.boot.v1': '{}',
  'other.app': 'not ours',
});

// 1. what goes in a backup
const b = createBackup(phoneA, 'build-1', new Date('2026-10-29T12:00:00Z'));
check(Object.keys(b.data).length === 4, `backup holds the 4 progress keys (got ${Object.keys(b.data).join(', ')})`);
check(!('edison.clientId' in b.data) && !('edison.errors.v1' in b.data) && !('edison.boot.v1' in b.data), 'device keys are left out');
check(!('other.app' in b.data), 'keys of other apps are left out');
check(backupFileName(b) === 'edison-backup-2026-10-29.json', 'file name carries the date');
const d = describeBackup(b);
check(d.decks === 2 && d.cards === 5 && d.games === 12, `summary counts decks, cards and games (got ${JSON.stringify(d)})`);

// 2. round trip onto another phone
const phoneB = memStore({ 'edison.clientId': 'phone-b', 'edison.decks.v1': '[]', 'edison.draft.v1': '{"old":true}', 'other.app': 'keep' });
restoreBackup(phoneB, parseBackup(JSON.stringify(b)));
check(phoneB.getItem('edison.decks.v1') === phoneA.getItem('edison.decks.v1'), 'decks restored');
check(phoneB.getItem('edison.collection.v1') === phoneA.getItem('edison.collection.v1'), 'collection restored');
check(phoneB.getItem('edison.clientId') === 'phone-b', 'the device keeps its own online id');
check(phoneB.getItem('edison.draft.v1') === null, 'progress not in the backup is removed (a restore replaces, not merges)');
check(phoneB.getItem('other.app') === 'keep', 'other apps’ keys are untouched');

// 3. bad files
check(throws(() => parseBackup('not json'), /isn’t an Edison backup/), 'non-JSON is rejected');
check(throws(() => parseBackup('{"app":"something-else","data":{}}'), /isn’t an Edison backup/), 'another app’s JSON is rejected');
check(throws(() => parseBackup(JSON.stringify({ ...b, version: 99 })), /newer version/), 'a newer backup format is rejected');
const sneaky = parseBackup(JSON.stringify({ ...b, data: { ...b.data, 'edison.clientId': 'x', 'evil.key': 'x', 'edison.n': 5 } }));
check(!('edison.clientId' in sneaky.data) && !('evil.key' in sneaky.data) && !('edison.n' in sneaky.data), 'device keys, foreign keys and non-strings in a file are dropped');

// 4. out of space: nothing changes
const small = memStore({ 'edison.decks.v1': '["mine"]', 'edison.clientId': 'c' }, 60);
const big = parseBackup(JSON.stringify({ ...b, data: { 'edison.decks.v1': 'x'.repeat(200) } }));
check(throws(() => restoreBackup(small, big), /Not enough storage/), 'out of space reports a clear error');
check(small.getItem('edison.decks.v1') === '["mine"]' && small.getItem('edison.clientId') === 'c', 'out of space leaves the old progress in place');

if (failures.length) {
  console.error(`backup-test: ${failures.length} failed, ${passed} passed`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`backup-test: all ${passed} checks passed`);
