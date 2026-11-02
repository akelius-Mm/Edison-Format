// One-time settings reset (src/ui/settings.ts): the old crash breaker switched Official card images off for good,
// which left mats, sleeves and cards on the drawn art. A saved profile gets the default (on) back once; after that,
// switching images off in Settings sticks.
// Usage: npx tsx scripts/settings-art-test.ts
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Partial<Storage> }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
};
// a profile as the old crash breaker left it
mem.set('edison.settings.v1', JSON.stringify({ officialImages: false, music: false, playmat: 'art:Stardust Dragon' }));
mem.set('edison.settings.musicOn.v1', 'true');

let passed = 0;
const failures: string[] = [];
const check = (ok: boolean, msg: string) => (ok ? passed++ : failures.push(msg));

const { getSettings, updateSettings } = await import('../src/ui/settings');
check(getSettings().officialImages === true, 'card images are back on');
check(getSettings().playmat === 'art:Stardust Dragon' && getSettings().music === false, 'the rest of the profile is kept');
check(mem.get('edison.settings.artOn.v1') === 'true', 'the reset is marked done');
updateSettings({ officialImages: false });
check(JSON.parse(mem.get('edison.settings.v1')!).officialImages === false, 'switching images off is saved');

if (failures.length) {
  console.log(`settings-art-test: ${passed} passed, ${failures.length} FAILED`);
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`settings-art-test: all ${passed} checks passed`);
export {};
