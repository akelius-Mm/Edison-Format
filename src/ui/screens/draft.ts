// Draft mode: arriving in the next update.
import { frame, type Screen } from './nav';
import { h } from './dom';

export function draftScreen(): Screen {
  return {
    el: frame(
      'Draft',
      { subtitle: 'Open packs, pick cards, build a deck' },
      h('p', { style: { padding: '0 20px', color: 'var(--muted)' } }, 'Draft Mode is almost ready and arrives in the next update.'),
    ),
  };
}
