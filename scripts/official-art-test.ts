// Official card art (src/ui/cards/officialArt.ts) under a flaky network: one failed lookup must not switch the art
// off for the session (it used to: every mat, sleeve and card went back to the drawn art until the app restarted),
// art already looked up keeps showing, a failure is not remembered as "no art", and lookups resume after a pause.
// Usage: npx tsx scripts/official-art-test.ts
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
} as Storage;
const img = (n: string) => ({ full: `https://img/full/${n}.jpg`, art: `https://img/crop/${n}.jpg` });
mem.set('edison.settings.v1', JSON.stringify({ officialImages: true }));
// v1 as left by the old code: found art, plus "no art" recorded for cards asked about while the API refused requests
mem.set('edison.officialArt.v1', JSON.stringify({ 'Stardust Dragon': img('sd'), 'Judgment Dragon': null }));

let mode: 'down' | 'up' | 'refused' | 'unknown' = 'down';
let calls = 0;
globalThis.fetch = (async (url: string) => {
  calls++;
  if (mode === 'down') throw new TypeError('Load failed');
  if (mode === 'refused') return { ok: false, status: 403, json: async () => ({}) } as unknown as Response;
  if (mode === 'unknown') return { ok: false, status: 400, json: async () => ({ error: 'No card matching your query was found' }) } as unknown as Response;
  const names = decodeURIComponent(String(url).split('name=')[1]).split('|');
  return { ok: true, status: 200, json: async () => ({ data: names.map((n) => ({ name: n, card_images: [{ image_url: `https://img/full/${n}.jpg`, image_url_cropped: `https://img/crop/${n}.jpg` }] })) }) } as unknown as Response;
}) as typeof fetch;

let passed = 0;
const failures: string[] = [];
const check = (ok: boolean, msg: string) => (ok ? passed++ : failures.push(msg));

const realNow = Date.now;
let now = realNow();
Date.now = () => now;

const art = await import('../src/ui/cards/officialArt');
check(art.officialArtEnabled(), 'art on with the setting');
// the old store: found art carried over, its "no art" entries dropped (they may be refusals taken as misses)
check(art.cachedOfficialImage('Stardust Dragon')?.art === img('sd').art, 'v1 art carried over');
check(art.cachedOfficialImage('Judgment Dragon') === undefined, 'v1 "no art" entries are dropped, so the card is looked up again');
check(!mem.has('edison.officialArt.v1') && mem.has('edison.officialArt.v2'), 'moved to the v2 store');
const miss = await art.getOfficialImage('Caius the Shadow Monarch');
check(miss === null && calls === 1, 'a lookup while offline gives no art');
check(art.officialArtEnabled(), 'one failed lookup does not switch official art off');
check(art.cachedOfficialImage('Stardust Dragon')?.art === img('sd').art, 'art looked up earlier still shows while offline');
check(art.cachedOfficialImage('Caius the Shadow Monarch') === undefined, 'a failed lookup is not remembered as "no art"');
await art.getOfficialImage('Caius the Shadow Monarch');
check(calls === 1, 'no new lookups right after a failure');
mode = 'up';
now += 61_000;
const hit = await art.getOfficialImage('Caius the Shadow Monarch');
check(hit?.art === 'https://img/crop/Caius the Shadow Monarch.jpg' && calls === 2, 'lookups resume a minute later');
check(art.cachedOfficialImage('Caius the Shadow Monarch')?.art === hit?.art, 'and the found art is remembered');
// the API refusing requests (rate limit, blocked) is not an answer: nothing is remembered as "no art"
now += 61_000;
mode = 'refused';
check((await art.getOfficialImage('Raiza the Storm Monarch')) === null, 'refused lookup gives no art now');
check(art.cachedOfficialImage('Raiza the Storm Monarch') === undefined, 'a refused lookup is not remembered as "no art"');
// a real "not found" is remembered, for a week
now += 61_000;
mode = 'unknown';
check((await art.getOfficialImage('Not A Real Card')) === null, 'unknown card: no art');
check(art.cachedOfficialImage('Not A Real Card') === null, 'unknown card remembered as no art');
check(JSON.parse(mem.get('edison.officialArt.miss.v2') ?? '{}')['Not A Real Card'] > 0, 'with the time it was learned');
Date.now = realNow;

// after a crash, art is paused for one launch without touching the setting; switching it on in Settings resumes it
art.pauseOfficialArtThisLaunch();
check(!art.officialArtEnabled(), 'paused for this launch');
check(JSON.parse(mem.get('edison.settings.v1') ?? '{}').officialImages === true, 'the setting itself stays on');
art.resumeOfficialArt();
check(art.officialArtEnabled(), 'resumed');

if (failures.length) {
  console.log(`official-art-test: ${passed} passed, ${failures.length} FAILED`);
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`official-art-test: all ${passed} checks passed`);
export {};
