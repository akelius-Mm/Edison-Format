// AI strength check: the look-ahead AI (ai/planner.ts) against the plain heuristic AI on the same decks and seeds,
// each side taking each seat. Fails if the look-ahead AI does not win clearly more than half, or a copy crashes a game.
// Usage: npx tsx scripts/ai-strength.ts [--games N] [--width K] [--diff hard|normal] [--min 0.55]
import { AIController, type Difficulty } from '../src/ai/ai';
import { PlannerAI, planDebug, planGame } from '../src/ai/planner';
import { PREMADE_DECKS, buildDeckList } from '../src/decks';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const games = Number(arg('games', '24'));
const diff = arg('diff', 'hard') as Difficulty;
const width = Number(arg('width', diff === 'hard' ? '6' : '4'));
const min = Number(arg('min', '0.55'));
const horizon = Number(arg('horizon', '2'));
const fromDeck = arg('guess', 'deck') === 'deck';
const mirror = !args.includes('--mixed');
planDebug.noResponses = args.includes('--no-resp');
planDebug.battle = args.includes('--battle');
const offset = Number(arg('offset', '0'));
console.error = () => {};

(async () => {
  let planWins = 0;
  let baseWins = 0;
  let draws = 0;
  let sims = 0;
  let fails = 0;
  let crashes = 0;
  const t0 = Date.now();
  // archetype decks (the first 24 premades), paired round the list
  const decks = PREMADE_DECKS.slice(0, 24);
  for (let i = offset; i < offset + games; i++) {
    const a = decks[Math.floor(i / 2) % decks.length];
    // mirror matches: both sides play the same deck, so only the play decides (not the matchup)
    const b = mirror ? a : decks[(i * 5 + 7) % decks.length];
    const seed = 1000 + Math.floor(i / 2);
    // game i and i+1 play the same decks and seed with the seats swapped
    const planSeat = (i % 2) as 0 | 1;
    const planner = new PlannerAI(diff, seed * 3 + 1, width, undefined, horizon, fromDeck);
    const base = new AIController(diff, seed * 3 + 2);
    const ctl: [any, any] = planSeat === 0 ? [planner, base] : [base, planner];
    const g = planGame([buildDeckList(a), buildDeckList(b)], ctl, { seed, maxTurns: 60 });
    try {
      const r = await g.start();
      if (r.winner === planSeat) planWins++;
      else if (r.winner === null) draws++;
      else baseWins++;
    } catch (e) {
      crashes++;
      console.log(`CRASH game ${i}: ${(e as Error).stack}`);
    }
    sims += planner.sims;
    fails += planner.simFails;
  }
  const ms = Date.now() - t0;
  const rate = planWins / Math.max(1, planWins + baseWins);
  console.log(`look-ahead (${diff}, width ${width}, horizon ${horizon}, guess ${fromDeck ? 'deck' : 'generic'}) vs heuristic: ${planWins}-${baseWins}-${draws} (${(rate * 100).toFixed(0)}% of decided games), ${sims} copies (${fails} failed), ${(ms / Math.max(1, sims)).toFixed(1)} ms/copy, ${(ms / games / 1000).toFixed(1)} s/game${planDebug.noResponses ? ' [no responses]' : ''}${planDebug.battle ? ' [battle]' : ''}`);
  if (crashes) {
    console.log(`FAIL: ${crashes} crash(es)`);
    process.exit(1);
  }
  if (rate < min) {
    console.log(`FAIL: win rate ${(rate * 100).toFixed(0)}% < ${(min * 100).toFixed(0)}%`);
    process.exit(1);
  }
  console.log('ai-strength: OK');
})();
