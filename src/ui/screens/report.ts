// "Report a problem" (Settings, the duel's flag menu, and the toast after an uncaught error), and
// the in-app-browser banner on Home. No backend: the report is shared or copied by the player.
import './report.css';
import { browserInfo, buildReport, onCapturedError, publishedVersion, reportSummary, type Report } from '../diag';
import { haptic } from '../haptics';
import { button, h, icon, modal, toast, type ModalHandle } from './dom';

let open: ModalHandle | null = null;

/** Open the report sheet. */
export function openReportSheet(opts: { reason?: string } = {}) {
  if (open) return;
  void publishedVersion();
  const note = h('textarea', {
    class: 'rp-note',
    rows: 4,
    maxlength: 2000,
    placeholder: 'What did you tap, and what did you expect to happen?',
    'aria-label': 'What happened?',
  });
  let report: Report = buildReport('');
  const rebuild = () => (report = buildReport(note.value.trim()));
  const rec = (report.duel?.record ?? null) as { game?: { seed: number; turn: number; log: unknown[] } } | null;
  const included = h(
    'ul',
    { class: 'rp-list' },
    item('info', 'Version and device', `${report.app.version.slice(0, 10)} · ${report.device.label}`),
    item('search', 'Screen', report.app.route.replace(/^#\/?/, '') || 'title'),
    item('flag', 'Recent errors', report.errors.length ? `${report.errors.length} · ${report.errors[report.errors.length - 1].msg}` : 'None'),
    rec?.game ? item('swords', 'This duel', `Seed ${rec.game.seed} · turn ${rec.game.turn} · ${rec.game.log.length} decisions, to replay it exactly`) : null,
  );
  const preview = h('pre', { class: 'rp-json' });
  const details = h('details', { class: 'rp-details' }, h('summary', null, 'Show the full report'), preview);
  details.addEventListener('toggle', () => {
    if (details.open) preview.textContent = JSON.stringify(rebuild(), null, 1);
  });
  const body = h(
    'div',
    { class: 'rp' },
    opts.reason ? h('p', { class: 'rp-reason' }, opts.reason) : null,
    h('label', { class: 'rp-label' }, 'What happened?', note),
    h('div', { class: 'rp-h' }, 'Included in the report'),
    included,
    details,
    h('p', { class: 'rp-foot' }, icon('info'), h('span', null, 'Nothing is sent automatically. Share or copy it to the person who sent you the app.')),
  );

  const share = async () => {
    const r = rebuild();
    const text = reportSummary(r);
    const json = JSON.stringify(r);
    const name = `edison-report-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    try {
      const file = new File([json], name, { type: 'application/json' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: 'Edison problem report', text, files: [file] });
        done('Report shared. Thank you!');
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: 'Edison problem report', text: `${text}\n\n${json}` });
        done('Report shared. Thank you!');
        return;
      }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return; // the share sheet was closed
    }
    await copy();
  };
  const copy = async () => {
    const r = rebuild();
    const text = `${reportSummary(r)}\n\n${JSON.stringify(r)}`;
    if (await copyText(text)) done('Report copied. Paste it in a message. Thank you!');
    else toast('Couldn’t copy here. Open “Show the full report” and select it.', 'error', 4000);
  };
  const done = (msg: string) => {
    haptic('success');
    toast(msg, 'success', 3200);
    open?.close();
  };

  open = modal(
    'Report a problem',
    body,
    [
      { label: 'Copy', variant: 'ghost', icon: 'copy', onClick: () => (void copy(), false) },
      { label: 'Share', variant: 'primary', icon: 'upload', onClick: () => (void share(), false) },
    ],
    { cls: 'rp-sheet', onClose: () => (open = null) },
  );
}

function item(ic: Parameters<typeof icon>[0], label: string, detail: string) {
  return h('li', null, h('span', { class: 'rp-ic' }, icon(ic)), h('span', { class: 'rp-it' }, h('b', null, label), h('span', null, detail)));
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall back below (in-app browsers often block the clipboard API) */
  }
  try {
    const ta = h('textarea', { class: 'rp-copy', readonly: true });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ the toast after an error

let toastEl: HTMLElement | null = null;
let lastToast = 0;

/** After an uncaught error: a small, non-blocking "Something went wrong. Report it?" */
export function installErrorToast() {
  onCapturedError(() => {
    const now = Date.now();
    if (open || toastEl || now - lastToast < 20000) return;
    lastToast = now;
    const close = () => {
      const el = toastEl;
      toastEl = null;
      if (!el) return;
      el.classList.remove('in');
      setTimeout(() => el.remove(), 300);
    };
    const el = h(
      'div',
      { class: 'err-toast', role: 'status', 'aria-live': 'polite' },
      h('span', { class: 'err-toast-text' }, 'Something went wrong. Report it?'),
      button('Report', () => (close(), openReportSheet()), { variant: 'primary', small: true, cls: 'err-toast-report' }),
      h('button', { type: 'button', class: 'err-toast-x', 'aria-label': 'Dismiss', onclick: close }, icon('x')),
    );
    toastEl = el;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => toastEl === el && close(), 9000);
  });
}

// ------------------------------------------------------------------ in-app browser banner (Home)

const BANNER_KEY = 'edison.hint.browser.v1';

/** Home: in an in-app browser, or a Safari tab on iPhone, suggest Safari and the Home Screen. */
export function browserBanner(): HTMLElement | null {
  const b = browserInfo();
  if (b.standalone) return null;
  if (!b.inApp && !b.ios) return null;
  try {
    if (localStorage.getItem(BANNER_KEY)) return null;
  } catch {
    /* show it */
  }
  const el = h('section', { class: ['br-banner', b.inApp && 'br-banner--inapp'], role: 'note' });
  const dismiss = () => {
    try {
      localStorage.setItem(BANNER_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    el.classList.add('is-gone');
    setTimeout(() => el.remove(), 260);
  };
  const steps = b.inApp
    ? [
        h('li', null, 'Tap ', h('b', null, '⋯'), ' (top or bottom corner) → ', h('b', null, b.ios ? 'Open in Safari' : 'Open in browser')),
        h('li', null, 'Then ', h('b', null, 'Share'), ' → ', h('b', null, 'Add to Home Screen')),
      ]
    : [h('li', null, 'Tap ', h('b', null, 'Share'), ' → ', h('b', null, 'Add to Home Screen'))];
  el.append(
    h('span', { class: 'br-icon' }, icon(b.inApp ? 'upload' : 'plus')),
    h(
      'div',
      { class: 'br-text' },
      h('b', null, b.inApp ? 'For the best experience, open in Safari and Add to Home Screen' : 'For the best experience, Add to Home Screen'),
      h('ol', { class: 'br-steps' }, steps),
      b.inApp ? h('small', null, `${b.inApp}’s browser keeps its own data: decks and duels saved here stay here.`) : h('small', null, 'It opens full screen, works offline and keeps your duels safe.'),
    ),
    h('button', { type: 'button', class: 'br-x', 'aria-label': 'Dismiss', onclick: dismiss }, icon('x')),
  );
  return el;
}
