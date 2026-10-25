# Edison Format Simulator

A browser-based Yu-Gi-Oh! **Edison Format** duel simulator — the April 2010 TCG format
(SJC Edison, Master Rule 2 era) — with a full rules engine, AI opponents, a deck builder and
a Swiss + Top Cut tournament mode.

> Fan-made, non-commercial project. Card names belong to their owners; all card art, sleeves,
> playmats and avatars are procedurally generated, and card texts are paraphrased.

## Features

- **Rules engine** (`src/engine`) — chains with spell speeds, SEGOC trigger ordering,
  "missing the timing", summon negation windows (Solemn/Royal Oppression), damage step,
  battle replays, Synchro & Fusion summons, contact fusions, equips, continuous effects,
  tokens, flip effects, once-per-turn tracking, Edison-era rules (first player skips the draw,
  one face-up Field Spell, 6-card hand limit).
- **Edison card pool** — every card used by the format's competitive decks, scripted with
  real effects, plus the Edison Forbidden & Limited list.
- **Premade meta decks** — Quickdraw Plant, Lightsworn, Zombies, Blackwings, X-Sabers,
  Gladiator Beasts, Frog Monarchs, Tele-DAD, Hero Beat.
- **AI opponents** — easy / normal / hard heuristic AI that summons, synchros, chains traps,
  plays around set cards and uses card-specific hints.
- **Duel UI** — animated board with playmats, sleeves, card previews, chain display,
  duel log and synthesized sound effects.
- **Deck builder** — searchable card database, live banlist validation, import/export.
- **Tournament mode** — 8/16/32-player Swiss with OMW% tiebreakers, Top 8 single
  elimination, best-of-3 matches, simulated or fully played-out AI matches, saved progress.
- **Customization** — 12 sleeves, 10 playmats, 12+ avatars, player name, animation speed, sound.
- **Optional official card images** — Settings → "Load official card images" fetches artwork
  from the public YGOPRODeck database when online (falls back to generated art).

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run build:single  # single self-contained HTML file in dist-single/
```

Developer harness: `npm run dev` then open `/duel-dev.html` (`?gallery` shows every card,
sleeve, playmat and avatar; `?mode=spectate&seed=N` runs AI-vs-AI duels).

## Testing

```bash
npm run typecheck
npm run test:rules   # deterministic rules tests (battle, chains, negation, synchro...)
npm run test:sim     # AI-vs-AI duels across all premade decks (catches script errors)
npx tsx scripts/sim.ts --deck blackwings --vs lightsworn --games 50 --verbose
npx tsx scripts/sim.ts --deck quickdraw-plant --games 1 --log   # full duel log
```

## Project layout

| Path | Contents |
| --- | --- |
| `src/engine/` | Game state, chain/battle/summon rules, effect context API |
| `src/cards/` | Card DSL (`define.ts`), helpers, banlist and card sets (`sets/*.ts`) |
| `src/decks/` | Premade decks and deck validation |
| `src/ai/` | Heuristic AI controller |
| `src/ui/` | Duel screen, card rendering, themes, menus, deck builder |
| `src/tournament/` | Swiss pairing, standings, top cut, match simulation |
| `scripts/` | Headless simulator and rules tests |
| `docs/CARD_SCRIPTING.md` | How to add or script new cards |

## Known simplifications

The engine covers the format's real interactions, but a few rare mechanics are approximated
(each is documented in `docs/engine-requests/`): Gemini monsters use a "Gemini Summon" effect
that consumes the Normal Summon, "destroy this instead" replacement effects (Nettles, Power Tool
Dragon) are partial, effects that "end the Battle Phase" stop further attacks instead, Swap Frog's
extra Normal Summon isn't limited to Frogs, Fusion Summons made by card effects can't be negated
by Solemn Judgment, and some lingering effects (Swords of Revealing Light's countdown) use the
chain. No side-decking between Best-of-3 games yet.
