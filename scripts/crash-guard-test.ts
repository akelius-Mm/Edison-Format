// Crash-loop guards (iOS "A problem repeatedly occurred on …/#/events?view=run").
//
// When the browser kills the page, no code runs, and reopening the app would redo the same work into
// the same crash. These checks cover the guards that stop that:
//   1. engine: a turn that never ends stops at MAX_TURN_WORK as a draw (log lines and animation steps),
//      instead of allocating until the page dies; it keeps stopping if a card script swallows the error,
//      and a normal game never comes near the limit
//   2. saved duels: a restore that never finished is detected on the next resume (resume.ts), so that
//      game starts over instead of replaying into the same crash; other games are not affected
//   3. risky screen steps (crashGuard.ts): a step that was running when the app died is reported
//   4. saved events: validateEvent rejects damaged saves (bad cut, unknown players, empty rounds) and
//      accepts real ones (also an older save without `revealed`); bracketPairs refuses a cut that would
//      loop forever
// Usage: npx tsx scripts/crash-guard-test.ts
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
};

import { AIController } from '../src/ai/ai';
import { PREMADE_DECKS, buildDeckList } from '../src/decks';
import { Game, GameOver, MAX_TURN_WORK, RUNAWAY_REASON } from '../src/engine/game';
import { clearRestoring, markRestoring, restoreInterrupted, type SavedDuel } from '../src/ui/duel/resume';
import { beginRisky, bootGuard, endRisky, interruptedStep, risky } from '../src/ui/crashGuard';
import { KEYS } from '../src/events/storage';
import { advance, createEvent, finishRound, loadActiveEvent, pendingHumanMatch, reportScore, saveEvent, validateEvent, type EventRun } from '../src/events';
import { bracketPairs } from '../src/locals/swiss';
import { snapshot } from '../src/locals/meta';

let passed = 0;
const failures: string[] = [];
function check(ok: boolean, msg: string) {
  if (ok) passed++;
  else failures.push(msg);
}
const throwsGameOver = (f: () => unknown) => {
  try {
    f();
    return null;
  } catch (e) {
    return e instanceof GameOver ? e : null;
  }
};
const origError = console.error;
console.error = () => {};

(async () => {
  // ---------------------------------------------------------------- 1. engine runaway limit
  {
    const d = PREMADE_DECKS[0];
    const g = new Game([buildDeckList(d), buildDeckList(d)], [new AIController('easy', 1), new AIController('easy', 2)], { seed: 7 });
    let stopped: GameOver | null = null;
    for (let i = 0; i < MAX_TURN_WORK + 10 && !stopped; i++) stopped = throwsGameOver(() => g.log('again'));
    check(!!stopped && stopped.winner === null && stopped.reason === RUNAWAY_REASON, `runaway turn stops as a draw (${stopped?.reason})`);
    check(g.over && g.winner === null && g.winReason === RUNAWAY_REASON, 'the game is over after the limit');
    // a card script that swallows the error and carries on is stopped again at once, also by a fire-and-forget animation
    check(!!throwsGameOver(() => g.log('still looping')), 'a swallowed stop throws again on the next log line');
    check(!!throwsGameOver(() => void g.anim({ type: 'phase', phase: 'end', player: 0 } as any)), 'a fire-and-forget animation past the limit throws at the call');
  }
  {
    // normal games finish with their usual reasons, far below the limit
    let runaway = 0;
    for (let i = 0; i < 12; i++) {
      const a = PREMADE_DECKS[(i * 5) % PREMADE_DECKS.length];
      const b = PREMADE_DECKS[(i * 11 + 3) % PREMADE_DECKS.length];
      const g = new Game([buildDeckList(a), buildDeckList(b)], [new AIController('hard', i), new AIController('normal', i + 99)], { seed: 900 + i });
      const res = await g.start();
      if (res.reason === RUNAWAY_REASON) runaway++;
    }
    check(runaway === 0, `${runaway} normal games hit the runaway limit`);
  }

  // ---------------------------------------------------------------- 2. saved duel restore guard
  {
    store.clear();
    const duel = (key: string, index: number, seed: number) => ({ v: 1, tag: { kind: 'events', key, route: 'events' }, savedAt: 0, setup: {} as any, games: [], game: { index, seed, first: 'coin', skipFirstDraw: false, caption: '', log: [], turn: 3 } }) as unknown as SavedDuel;
    const d = duel('events:e1:s3-4', 1, 1234);
    check(!restoreInterrupted(d), 'no mark: the restore runs');
    markRestoring(d);
    check(restoreInterrupted(d), 'a mark left by a restore that never finished is found on the next resume');
    check(!restoreInterrupted(duel('events:e1:s3-4', 1, 999)), 'another game of the match (new seed) is not affected');
    check(!restoreInterrupted(duel('events:e1:s4-2', 1, 1234)), 'another match is not affected');
    clearRestoring();
    check(!restoreInterrupted(d), 'cleared once the restore is over');
    localStorage.setItem('edison.duel.restoring.v1', '{not json');
    check(!restoreInterrupted(d), 'a damaged mark is ignored');
  }

  // ---------------------------------------------------------------- 3. risky screen steps
  {
    store.clear();
    beginRisky('events:e1', 'pairing round 5');
    check(interruptedStep('events:e1')?.what === 'pairing round 5', 'an unfinished step is reported for its scope');
    check(interruptedStep('events:e2') === null, 'not for another event');
    endRisky('events:e2');
    check(interruptedStep('events:e1') !== null, "another scope's end does not clear it");
    endRisky('events:e1');
    check(interruptedStep('events:e1') === null, 'a finished step leaves nothing behind');
    try {
      risky('events:e1', 'opening the event', () => {
        throw new Error('boom');
      });
    } catch {
      /* expected */
    }
    check(interruptedStep('events:e1') === null, 'a step that throws (not a crash) is unmarked too');
  }

  // ---------------------------------------------------------------- 4. saved events
  {
    store.clear();
    const human = { name: 'You', avatar: 'avatar-1', sleeve: 'classic-red', deck: snapshot(PREMADE_DECKS[0]) };
    const r = createEvent({ kind: 'sjc', size: 128, human, sleeves: ['classic-red'], avatars: ['avatar-2'], seed: 5 });
    check(validateEvent(r) === null, `a new event is sound (${validateEvent(r)})`);
    // play into the middle of the Swiss and into the top cut: still sound
    for (let guard = 0; guard < 40 && r.phase !== 'top'; guard++) {
      if (pendingHumanMatch(r)) reportScore(r, 2, 0);
      finishRound(r);
      advance(r);
    }
    check(r.phase === 'top' && validateEvent(r) === null, `an event in its top cut is sound (${validateEvent(r)})`);
    const clone = (): EventRun => JSON.parse(JSON.stringify(r));
    const bad: [string, (x: EventRun) => void][] = [
      ['a cut of 0', (x) => (x.topCut = 0)],
      ['a cut of 12', (x) => (x.topCut = 12)],
      ['a huge cut', (x) => (x.topCut = 2 ** 30)],
      ['a missing player list', (x) => ((x as any).entrants = null)],
      ['the player not in the event', (x) => (x.humanId = 'nobody')],
      ['a match with an unknown player', (x) => (x.rounds[0][0].a = 'ghost')],
      ['an empty round', (x) => x.rounds.push([])],
      ['too many Swiss rounds', (x) => (x.swissRounds = x.rounds.length - 1)],
      ['top cut phase without a bracket', (x) => (x.top = [])],
      ['an unknown step', (x) => ((x as any).step = 'lunch')],
      ['a broken clock', (x) => ((x as any).roundStartedAt = null)],
    ];
    for (const [what, f] of bad) {
      const x = clone();
      f(x);
      check(validateEvent(x) !== null, `damaged save caught: ${what}`);
    }
    // an older save without `revealed` loads and is sound
    const old = clone() as any;
    delete old.revealed;
    localStorage.setItem(KEYS.activeEvent, JSON.stringify(old));
    const loaded = loadActiveEvent();
    check(!!loaded && Array.isArray(loaded.revealed) && validateEvent(loaded) === null, 'an older save without the revealed list loads');
    saveEvent(r);
    // bracketPairs: a damaged cut must throw at once, never spin
    for (const n of [0, 1, 3, 12, 2048, NaN, Infinity]) {
      let threw = false;
      try {
        bracketPairs(n);
      } catch {
        threw = true;
      }
      check(threw, `bracketPairs(${n}) refuses`);
    }
    check(bracketPairs(64).length === 32, 'bracketPairs(64) still works');
  }

  // 5. app-wide breaker: a mark left while the app is on screen means the browser killed it
  {
    const on: Record<string, (() => void)[]> = {};
    const target = { addEventListener: (t: string, f: () => void) => (on[t] ??= []).push(f) };
    const g = globalThis as any;
    g.window = target;
    g.document = { ...target, visibilityState: 'visible' };
    g.location = { hash: '#/events?view=run' };
    const fire = (t: string) => on[t]?.forEach((f) => f());
    localStorage.removeItem('edison.boot.v1');
    check(bootGuard() === null, 'boot: a first start is not a crash');
    // the app dies on the event screen: nothing runs, the mark stays
    for (const k of Object.keys(on)) delete on[k];
    const died = bootGuard();
    check(died?.hash === '#/events?view=run', 'boot: a start after the app was killed on screen reports where it died');
    // a normal close (background, then gone) is not a crash
    g.document.visibilityState = 'hidden';
    fire('visibilitychange');
    for (const k of Object.keys(on)) delete on[k];
    g.document.visibilityState = 'visible';
    check(bootGuard() === null, 'boot: going to the background drops the mark');
    fire('pagehide');
    for (const k of Object.keys(on)) delete on[k];
    check(bootGuard() === null, 'boot: closing the page drops the mark');
  }

  console.error = origError;
  console.log(`Crash guards: ${passed} checks passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  FAIL ${f}`);
    process.exit(1);
  }
  process.exit(0);
})();
