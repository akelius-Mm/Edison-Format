// Rivals: your record against the regulars, the streak, and what they remember of the last meeting
// (src/locals/night.ts recordRivalMatch, src/locals/rivals.ts). Run: tsx scripts/rivals-test.ts
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

async function main() {
  const { REGULARS, agoText, loadRivals, recordRivalMatch, regularById, rivalMemory, rivalRecordText, rivalTag } = await import('../src/locals');
  let failed = 0;
  const check = (cond: boolean, msg: string) => {
    if (!cond) {
      failed++;
      console.log(`  FAIL ${msg}`);
    }
  };
  console.log('Rivals (record, streak, memory)');

  const now = new Date(2026, 10, 12, 12).getTime();
  const DAY = 86400000;
  const marcus = regularById('marcus')!;
  const meet = (result: 'W' | 'L' | 'D', score: string, daysAgo = 0, where = 'Kettle Hill Cards & Games') => ({ at: now - daysAgo * DAY, result, score, myDeck: 'Blackwings', theirDeck: 'Plant Synchro', where });

  check(rivalTag(undefined) === 'new' && rivalRecordText(undefined) === null, 'never played: new, no record');
  check(rivalMemory(marcus, undefined, now) === marcus.blurb, 'never played: their blurb');

  // a loss, then another: they are your nemesis and the streak runs against you
  let r = recordRivalMatch('marcus', meet('L', '1-2', 3));
  check(r.l === 1 && r.streak === -1 && rivalTag(r) === 'even', `one loss: ${JSON.stringify(r)}`);
  r = recordRivalMatch('marcus', meet('L', '0-2', 2));
  check(r.l === 2 && r.streak === -2 && rivalTag(r) === 'nemesis', 'two losses: nemesis');
  check(rivalMemory(marcus, r, now) === 'Marcus beat you 2-0 with Plant Synchro at Kettle Hill Cards & Games, 2 days ago. Twice in a row now.', `loss memory: ${rivalMemory(marcus, r, now)}`);

  // a win breaks the streak; they still lead, so still the nemesis, and they remember your deck
  r = recordRivalMatch('marcus', meet('W', '2-1', 0, 'a challenge'));
  check(r.w === 1 && r.streak === 1 && rivalTag(r) === 'nemesis', 'a win resets the streak');
  check(rivalMemory(marcus, r, now) === 'You won 2-1 with Blackwings in a challenge, today. Marcus wants it back.', `win memory: ${rivalMemory(marcus, r, now)}`);
  r = recordRivalMatch('marcus', meet('W', '2-0'));
  check(r.streak === 2 && rivalTag(r) === 'streak' && rivalRecordText(r) === '2-2', 'level at 2-2 on a two-match run: on the run');
  r = recordRivalMatch('marcus', meet('W', '2-0'));
  check(rivalMemory(marcus, r, now).endsWith('That is 3 in a row.'), 'three in a row');

  // a draw ends any streak
  r = recordRivalMatch('marcus', meet('D', '1-1'));
  check(r.d === 1 && r.streak === 0 && rivalRecordText(r) === '3-2-1', `draw: ${rivalRecordText(r)}`);
  check(rivalMemory(marcus, r, now).startsWith('You drew 1-1'), 'draw memory');

  // one win, last result a win: they want a rematch
  const p = recordRivalMatch('priya', meet('W', '2-0'));
  check(rivalTag(p) === 'rematch', 'won the last one: wants a rematch');

  // saved and separate per regular
  const all = loadRivals();
  check(all.marcus.w === 3 && all.priya.w === 1 && Object.keys(all).length === 2, 'records are saved per regular');

  // records saved before meetings were remembered (counts only) still read
  const old = { w: 1, l: 1, d: 0 };
  check(rivalTag(old) === 'even' && rivalMemory(marcus, old, now).startsWith('You are 1-1 against Marcus.'), 'old records without a last meeting');
  check(recordRivalMatch('theo', meet('L', '0-2')).streak === -1, 'a first match starts a streak');

  check(agoText(now, now) === 'today' && agoText(now - DAY, now) === 'yesterday' && agoText(now - 9 * DAY, now) === '9 days ago' && agoText(now - 21 * DAY, now) === '3 weeks ago' && agoText(now - 90 * DAY, now) === '3 months ago', 'agoText');
  check(new Set(REGULARS.map((x) => x.id)).size === REGULARS.length && REGULARS.length >= 9, 'the cast has unique ids');

  console.log(failed ? `${failed} failed` : '  all passed');
  process.exit(failed ? 1 : 0);
}
void main();
