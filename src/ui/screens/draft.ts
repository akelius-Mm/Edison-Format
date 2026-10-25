// Draft mode screen (implemented in src/draft and here).
import { frame, type Screen } from './nav';
import { h } from './dom';

export function draftScreen(): Screen {
  return { el: frame('Draft', { subtitle: 'Open packs, pick cards, build a deck' }, h('p', null, 'Coming soon.')) };
}
