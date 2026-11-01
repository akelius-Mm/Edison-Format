// The look-ahead AI (ai/planner.ts) is deterministic: rebuilding a duel from its seed and the other seat's decisions
// (resume, undo, "Report a problem") must reproduce every AI play, even with the AI's remembered choices forgotten.
// Also: every copy it makes matches the real duel (no failed copies), and it never sees hidden cards.
// Usage: npx tsx scripts/ai-planner-test.ts
import { AIController } from '../src/ai/ai';
import { PlannerAI, clearPlanMemo, planGame } from '../src/ai/planner';
import { RecordingController } from '../src/engine/replay';
import { PREMADE_DECKS, buildDeckList } from '../src/decks';

console.error = () => {};
let passed = 0;
const failures: string[] = [];
const check = (ok: boolean, msg: string) => (ok ? passed++ : failures.push(msg));

(async () => {
  for (let i = 0; i < 6; i++) {
    const a = PREMADE_DECKS[(i * 3) % 24];
    const b = PREMADE_DECKS[(i * 7 + 5) % 24];
    const decks = [buildDeckList(a), buildDeckList(b)] as [any, any];
    const seed = 500 + i;
    const diff = i % 2 ? 'normal' : 'hard';
    // 1. the first run: planner on seat 0, the plain AI on seat 1, both seats recorded
    clearPlanMemo();
    const p1 = new PlannerAI(diff, 77 + i);
    const g1 = planGame(decks, [p1, new AIController('hard', 99 + i)], { seed, maxTurns: 40 });
    const r1 = await g1.start();
    const logs = (g1.controllers as any as RecordingController[]).map((c) => c.log);
    check(p1.sims > 0, `${a.id} vs ${b.id}: the planner made copies`);
    check(p1.simFails === 0, `${a.id} vs ${b.id}: ${p1.simFails} copies failed`);
    // 2. rebuild with the opponent's decisions replayed and the AI's memory wiped: same plays, same result
    clearPlanMemo();
    let mismatch = '';
    const p2 = new PlannerAI(diff, 77 + i);
    const replayOpp = new RecordingController(new AIController('hard', 1), { replay: logs[1].slice(), onMismatch: (d) => (mismatch = d) });
    const g2 = planGame(decks, [p2, replayOpp], { seed, maxTurns: 40 });
    const r2 = await g2.start();
    const logs2 = (g2.controllers as any as RecordingController[]).map((c) => c.log);
    check(!mismatch, `${a.id} vs ${b.id}: rebuild drifted: ${mismatch}`);
    check(JSON.stringify(logs2[0]) === JSON.stringify(logs[0]), `${a.id} vs ${b.id}: the AI played differently on the rebuild`);
    check(r1.winner === r2.winner && r1.turns === r2.turns, `${a.id} vs ${b.id}: different result on the rebuild`);
  }
  if (failures.length) {
    console.log(`ai-planner-test: ${passed} passed, ${failures.length} FAILED`);
    for (const f of failures) console.log('  ✗ ' + f);
    process.exit(1);
  }
  console.log(`ai-planner-test: all ${passed} checks passed`);
})();
