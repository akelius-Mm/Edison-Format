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
mem.set('edison.officialArt.v1', JSON.stringify({ 'Stardust Dragon': img('sd') }));

let mode: 'down' | 'up' = 'down';
let calls = 0;
globalThis.fetch = (async (url: string) => {
  calls++;
  if (mode === 'down') throw new TypeError('Load failed');
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
Date.now = realNow;

if (failures.length) {
  console.log(`official-art-test: ${passed} passed, ${failures.length} FAILED`);
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`official-art-test: all ${passed} checks passed`);
export {};
