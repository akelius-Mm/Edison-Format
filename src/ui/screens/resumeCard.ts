// "Duel in progress · vs Rei Mori · Game 2 · Turn 7 — Resume": the card that picks a saved duel
// back up, on Home and on the screen of the mode the duel belongs to.
import { duelSummary, MODE_LABEL, type SavedDuel } from '../duel/resume';
import { h, icon } from './dom';
import { go } from './nav';

/** Without `onResume` the card opens the duel's mode with resume=1, which resumes it. */
export function resumeDuelCard(d: SavedDuel, opts: { onResume?: () => void; showMode?: boolean; cls?: string } = {}) {
  const { line } = duelSummary(d);
  const where = opts.showMode && d.tag.kind !== 'vsai' ? ` · ${MODE_LABEL[d.tag.kind]}` : '';
  return h(
    'button',
    {
      type: 'button',
      class: ['home-resume', 'home-resume--duel', opts.cls],
      'aria-label': `Resume duel in progress, ${line}`,
      onclick: opts.onResume ?? (() => go(d.tag.route, { ...(d.tag.params ?? {}), resume: '1' })),
    },
    icon('swords'),
    h('span', { class: 'home-resume-text' }, h('b', null, 'Duel in progress'), h('span', null, `${line}${where}`)),
    h('span', { class: 'home-resume-go' }, 'Resume', icon('play')),
  );
}
