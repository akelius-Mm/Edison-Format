// Collection-mode hooks for the deck builder, kept self-contained so the builder only needs
// two calls: collectionAddBlock() inside its "add a copy" check, and
// installCollectionOverlay() once on its card browser element.
// Premade and AI decks never pass through these hooks, so they stay free to use.
import './packs.css';
import { collectionCap, isCollectionMode, onCollectionChange, ownedCount, setCollectionMode, totalOwned } from '../../collection';
import { h, toggle } from './dom';

/** Why another copy can't be added under Collection mode, or null when it can. */
export function collectionAddBlock(name: string, copiesInDeck: number): string | null {
  if (!isCollectionMode()) return null;
  const cap = collectionCap(name);
  if (copiesInDeck < cap) return null;
  return cap === 0 ? `You don't own ${name} yet. Open packs to find it.` : `You own ${cap} ${cap === 1 ? 'copy' : 'copies'} of ${name}.`;
}

/**
 * Show owned counts on a card browser's results and add a "Use my collection" switch to its
 * header. Cleans itself up when the browser leaves the page.
 */
export function installCollectionOverlay(browserEl: HTMLElement): void {
  const head = browserEl.querySelector<HTMLElement>('.cb-head');
  const results = browserEl.querySelector<HTMLElement>('.cb-results');
  if (!head || !results) return;

  const summary = h('small');
  const row = h(
    'div',
    { class: 'col-mode' },
    h('span', null, 'Use my collection ', summary),
    toggle(isCollectionMode(), (v) => setCollectionMode(v), 'Use my collection'),
  );
  head.prepend(row);

  const annotate = (item: Element) => {
    const name = item.querySelector<HTMLElement>('.yc[data-card-name]')?.dataset.cardName;
    if (!name) return;
    const host = item.querySelector<HTMLElement>('.cb-badges') ?? item;
    let b = host.querySelector<HTMLElement>(':scope > .col-own');
    if (!isCollectionMode()) {
      b?.remove();
      item.classList.remove('col-unowned');
      return;
    }
    const n = ownedCount(name);
    if (!b) host.appendChild((b = h('span', { class: 'col-own' })));
    b.textContent = n ? `Own ${n}` : 'Not owned';
    b.classList.toggle('col-own--none', !n);
    item.classList.toggle('col-unowned', !n);
  };
  const all = () => {
    summary.textContent = isCollectionMode() ? `· ${totalOwned().toLocaleString('en-US')} cards` : '';
    for (const it of results.querySelectorAll('.cb-row, .cb-cell')) annotate(it);
  };
  const mo = new MutationObserver((recs) => {
    for (const r of recs) for (const n of r.addedNodes) if (n instanceof HTMLElement && (n.matches('.cb-row, .cb-cell') || n.querySelector('.yc'))) annotate(n.closest('.cb-row, .cb-cell') ?? n);
  });
  mo.observe(results, { childList: true, subtree: true });
  const off = onCollectionChange(() => {
    if (!browserEl.isConnected) {
      off();
      mo.disconnect();
      return;
    }
    all();
  });
  all();
}
