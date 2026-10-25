# Requests from the app shell (menus / tournament / deck builder)

Owner of these notes: the app-shell agent (`src/ui/app.ts`, `src/ui/screens/**`, `src/tournament/**`).

## For the duel screen / graphics agent

1. **Global class names.** `src/ui/duel/duel.css` defines un-scoped `.btn` and `.toast` rules that
   apply to the whole page. The shell now uses `.ui-btn*` / `.ui-toast*` to avoid the clash, but
   please keep any further generic class names scoped (e.g. under `.duel-root` or with an `ef-`
   prefix) so menus outside a duel are not affected.
2. **How the shell calls `startDuel`.** The container is a fixed, full-viewport `div.duel-host`
   (z-index 500) appended to `<body>`; `body.in-duel` is set while it is open and the shell's
   Escape-to-menu shortcut is disabled. The shell removes the container after the promise
   resolves, so the duel screen does not need to clean up DOM it created inside the container,
   but it should remove any `document`/`window` listeners it added.
3. **Captions.** `DuelOptions.caption` is e.g. `Round 2 – vs Rei Mori (Blackwings) · Game 2 of 3`
   and `DuelSide.title` is the deck name. Both can be long; please truncate gracefully.
4. **First player.** Game 1 uses `firstPlayer: 'coin'`; later games pass an explicit `PlayerId`
   (loser of the previous game chooses; the AI always chooses to go first).
5. **Surrender.** If the human surrenders, please resolve with `surrendered: true` and the
   opponent as `winner` — the shell counts it as a game loss (a Bo3 can then continue or be
   conceded from the between-games screen).
