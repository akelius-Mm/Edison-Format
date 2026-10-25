// Full-screen "enlarge card" view, shared by the duel screen, deck builder and card database.
import type { CardData, CardInstance } from '../../engine/card';
import type { Game } from '../../engine/game';
import { findCard } from '../../cards/define';
import { getOfficialImage, officialArtEnabled } from './officialArt';
import { renderCard } from './render';

let styleAdded = false;
function addStyle() {
  if (styleAdded) return;
  styleAdded = true;
  const st = document.createElement('style');
  st.textContent = `
.card-zoom {
  position: fixed; inset: 0; z-index: 10000;
  display: grid; place-items: center;
  padding: max(16px, env(safe-area-inset-top, 0px)) max(16px, env(safe-area-inset-right, 0px)) max(16px, env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px));
  background: rgba(8, 9, 11, 0.86);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  animation: czIn 160ms ease-out;
  cursor: zoom-out;
}
.card-zoom-inner { position: relative; display: grid; justify-items: center; gap: 10px; animation: czPop 220ms cubic-bezier(.2,1.3,.4,1); }
.card-zoom .yc { --yc-w: min(88vw, calc((100dvh - 90px) * 59 / 86), 560px); box-shadow: 0 20px 60px rgba(0,0,0,.8), 0 0 0 1px rgba(255,255,255,.08); }
.card-zoom-scan { width: min(88vw, calc((100dvh - 90px) * 59 / 86), 560px); aspect-ratio: 59 / 86; border-radius: 3.5%; box-shadow: 0 20px 60px rgba(0,0,0,.8); display: block; }
.card-zoom-hint { font: 500 13px -apple-system, BlinkMacSystemFont, system-ui, sans-serif; color: rgba(236, 235, 231, .6); }
@keyframes czIn { from { opacity: 0; } }
@keyframes czPop { from { transform: scale(.82); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .card-zoom, .card-zoom-inner { animation: none; } }
`;
  document.head.appendChild(st);
}

let open: HTMLElement | null = null;

export function closeCardZoom() {
  open?.remove();
  open = null;
}

/** Show a card enlarged. Tap/click anywhere or press Escape to close. */
export function zoomCard(data: CardData, opts: { instance?: CardInstance; game?: Game } = {}) {
  addStyle();
  closeCardZoom();
  const ov = document.createElement('div');
  ov.className = 'card-zoom';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-label', `${data.name} (enlarged)`);
  const inner = document.createElement('div');
  inner.className = 'card-zoom-inner';
  const card = renderCard(data, { size: 'xl', instance: opts.instance, game: opts.game, showLimit: true });
  inner.appendChild(card);
  const hint = document.createElement('div');
  hint.className = 'card-zoom-hint';
  hint.textContent = 'Tap anywhere to close';
  inner.appendChild(hint);
  ov.appendChild(inner);
  // With official images on, show the full card scan once it loads.
  if (officialArtEnabled() && !data.isToken) {
    void getOfficialImage(data.name).then((img) => {
      if (!img || open !== ov) return;
      const scan = new Image();
      scan.className = 'card-zoom-scan';
      scan.alt = data.name;
      scan.onload = () => {
        if (open === ov) card.replaceWith(scan);
      };
      scan.src = img.full;
    });
  }
  const close = (ev?: Event) => {
    ev?.stopPropagation();
    ev?.preventDefault();
    closeCardZoom();
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape' || ev.key === 'Enter' || ev.key === ' ') close(ev);
  };
  // Ignore the tap that opened it (a long-press ends with a click on whatever is underneath).
  const opened = performance.now();
  ov.addEventListener('click', (ev) => {
    if (performance.now() - opened < 350) return;
    close(ev);
  });
  window.addEventListener('keydown', onKey, true);
  document.body.appendChild(ov);
  open = ov;
}

/** Double-click (desktop) any face-up rendered card to enlarge it. */
export function installGlobalCardZoom() {
  document.addEventListener('dblclick', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('.yc[data-card-id]');
    if (!el || el.closest('.card-zoom')) return;
    const data = findCard(el.dataset.cardName ?? '');
    if (data) {
      ev.preventDefault();
      zoomCard(data);
    }
  });
}
