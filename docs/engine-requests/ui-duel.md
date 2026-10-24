# Engine requests from the duel UI

None of these block the UI; each has a UI-side workaround today.

1. **Abort / concede at any time.** `Game` only accepts `{type:'surrender'}` from the turn player's
   `chooseAction`. The duel screen lets a human surrender at any moment by throwing `GameOver` from its
   controller promises and from `hooks.anim`. A `game.abort(winner, reason)` that makes the main loop stop at
   the next await would be cleaner.
2. **`negateLink` fires `anim({type:'negate'})` without awaiting it.** The UI therefore never throws from the
   `negate` animation and doesn't pace on it. Awaiting it (making `negateLink` async) would allow proper pacing.
3. **Reveal events for non-search reveals.** `anim({type:'reveal'})` is only emitted by `Ctx.search`. Cards
   added to hand by other effects (salvage, bounce) set `revealedUntil` but emit no reveal animation, so the UI
   can only show them face-up in the opponent's hand. A `reveal` anim from `Game.toHand` would be nicer.
4. **Shuffle animation.** `AnimEvent` has a `shuffle` type, but `shuffleDeck` never emits it.
