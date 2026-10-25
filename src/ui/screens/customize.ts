// Customize: your real sleeves and playmat (photos or image links), plus plain colours.
import { getSettings, updateSettings } from '../settings';
import { addCustom, linkIntoCollection, listCustom, pickIntoCollection, removeCustom, type CustomKind } from '../theme/customImages';
import { clear, h, toast } from './dom';
import { PLAYMATS, SLEEVES, applyPlaymat, sleevePreview } from './ext';
import { frame, type Screen } from './nav';
import { getProfile, ordinal, tournamentSummary, winRate } from './store';

const SEARCH: Record<CustomKind, { label: string; url: string }[]> = {
  mat: [
    { label: 'Edison 2010 event mats', url: 'https://www.google.com/search?tbm=isch&q=yu-gi-oh+shonen+jump+championship+2010+playmat' },
    { label: '2009–2010 championship mats', url: 'https://www.google.com/search?tbm=isch&q=yu-gi-oh+2010+regional+championship+playmat' },
    { label: 'Starter deck game mat', url: 'https://www.google.com/search?tbm=isch&q=yu-gi-oh+5ds+starter+deck+game+mat' },
  ],
  sleeve: [
    { label: 'Konami sleeves 2010', url: 'https://www.google.com/search?tbm=isch&q=yu-gi-oh+konami+card+sleeves+2010' },
    { label: 'Matte deck sleeves', url: 'https://www.google.com/search?tbm=isch&q=small+size+matte+card+sleeves+yugioh' },
    { label: 'Yu-Gi-Oh card back', url: 'https://www.google.com/search?tbm=isch&q=yu-gi-oh+card+back' },
  ],
};

export function customizeScreen(): Screen {
  const s = getSettings();

  // ---- live preview: your mat with three of your sleeved cards on it
  const prevMat = h('div', { class: 'cz-mat' });
  const prevSleeve = h('div', { class: 'cz-psleeve' });
  const drawPreview = () => {
    const cur = getSettings();
    applyPlaymat(prevMat, cur.playmat);
    prevSleeve.replaceChildren(...[0, 1, 2].map((i) => h('div', { class: 'cz-stack', style: { '--i': i } }, sleevePreview(cur.sleeve, 'md'))));
  };
  const preview = h('div', { class: 'cz-preview' }, prevMat, h('div', { class: 'cz-preview-inner' }, prevSleeve));

  // ---- name
  const nameIn = h('input', { id: 'cz-name', class: 'input', type: 'text', value: s.playerName, maxlength: 20, 'aria-label': 'Player name' });
  nameIn.addEventListener('input', () => {
    const v = nameIn.value.trim();
    if (v) updateSettings({ playerName: v });
  });

  const sleeves = picker('sleeve', drawPreview);
  const mats = picker('mat', drawPreview);
  drawPreview();

  const section = (title: string, ...body: (Node | null)[]) => h('section', { class: 'cz-section' }, h('div', { class: 'section-title' }, h('h2', null, title)), ...body);

  const el = frame(
    'Customize',
    { subtitle: 'Bring your real sleeves and mat — changes save automatically', cls: 'customize' },
    h(
      'div',
      { class: 'cz-layout' },
      h(
        'div',
        { class: 'cz-main' },
        section('Playmat', mats),
        section('Card sleeves', sleeves),
        section('Duelist name', h('label', { class: 'field' }, nameIn)),
        section('Profile & statistics', profileStats()),
      ),
      h('aside', { class: 'cz-side' }, h('div', { class: 'section-title' }, h('h2', null, 'Preview')), preview),
    ),
  );
  return { el };
}

/** One picker: add a real photo/link, your saved ones, then plain built-ins. */
function picker(kind: CustomKind, onChange: () => void): HTMLElement {
  const isMat = kind === 'mat';
  const current = () => (isMat ? getSettings().playmat : getSettings().sleeve);
  const select = (id: string) => {
    updateSettings(isMat ? { playmat: id } : { sleeve: id });
    draw();
    onChange();
  };
  const tileFor = (id: string, label: string, removable: boolean) => {
    const sw = isMat ? h('span', { class: 'cz-matsw' }) : h('span', { class: 'cz-sleeve' }, sleevePreview(id, 'sm'));
    if (isMat) applyPlaymat(sw, id);
    const on = current() === id;
    return h(
      'div',
      { class: ['cz-opt', on && 'on'], style: { position: 'relative' } },
      h('button', { type: 'button', class: 'cz-pick', 'aria-pressed': String(on), style: { all: 'unset', cursor: 'pointer', display: 'grid', gap: '6px', justifyItems: 'center', width: '100%' }, onclick: () => select(id) }, sw, h('span', { class: 'cz-label' }, label)),
      removable
        ? h(
            'button',
            {
              type: 'button',
              class: 'cz-remove',
              'aria-label': `Remove ${label}`,
              title: 'Remove',
              style: { position: 'absolute', top: '6px', right: '6px', width: '28px', height: '28px', borderRadius: '50%', border: '1px solid rgba(255,255,255,.2)', background: 'rgba(0,0,0,.65)', color: '#fff', fontSize: '15px', lineHeight: '1', cursor: 'pointer' },
              onclick: (ev: MouseEvent) => {
                ev.stopPropagation();
                removeCustom(kind, id);
                if (current() === id) select(isMat ? PLAYMATS[0].id : SLEEVES[0].id);
                else draw();
              },
            },
            '×',
          )
        : null,
    );
  };

  const mine = h('div', { class: ['cz-grid', isMat ? 'mats' : 'sleeves'] });
  const builtIn = h('div', { class: ['cz-grid', isMat ? 'mats' : 'sleeves'] });
  const draw = () => {
    clear(mine);
    const items = listCustom(kind);
    items.forEach((it, i) => mine.appendChild(tileFor(it.id, `${isMat ? 'Mat' : 'Sleeve'} ${i + 1}`, true)));
    mine.hidden = !items.length;
    empty.hidden = !!items.length;
    clear(builtIn);
    for (const x of isMat ? PLAYMATS : SLEEVES) builtIn.appendChild(tileFor(x.id, x.name, false));
  };

  const empty = h('p', { class: 'muted', style: { margin: '0', fontSize: '14px' } }, isMat ? 'No playmat photos yet. Find one below, or upload a photo of your own mat.' : 'No sleeve photos yet. Find some below, or upload a photo of your own sleeves.');

  // add: upload / link / find
  const linkIn = h('input', {
    id: `cz-link-${kind}`,
    class: 'input',
    type: 'url',
    inputmode: 'url',
    placeholder: 'Paste an image link',
    style: { flex: '1 1 200px', minWidth: '0' },
    'aria-label': isMat ? 'Playmat image link' : 'Sleeve image link',
  }) as HTMLInputElement;
  const addLink = async () => {
    try {
      const id = await linkIntoCollection(kind, linkIn.value);
      linkIn.value = '';
      select(id);
      toast(isMat ? 'Playmat added.' : 'Sleeves added.', 'success', 1600);
    } catch (e) {
      toast((e as Error).message, 'error', 4500);
    }
  };
  linkIn.addEventListener('keydown', (ev) => {
    if ((ev as KeyboardEvent).key === 'Enter') void addLink();
  });
  const upload = async () => {
    try {
      const id = await pickIntoCollection(kind);
      if (id) {
        select(id);
        toast(isMat ? 'Playmat added.' : 'Sleeves added.', 'success', 1600);
      }
    } catch (e) {
      toast((e as Error).message, 'error', 4500);
    }
  };
  const row = (...kids: (Node | null)[]) => h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } }, ...kids);
  const add = h(
    'div',
    { class: 'cz-add', style: { display: 'grid', gap: '10px', marginBottom: '16px' } },
    row(h('button', { type: 'button', class: 'ui-btn ui-btn-primary', onclick: () => void upload() }, isMat ? 'Upload mat photo' : 'Upload sleeve photo'), linkIn, h('button', { type: 'button', class: 'ui-btn', onclick: () => void addLink() }, 'Add link')),
    row(
      h('span', { class: 'muted', style: { fontSize: '13px' } }, 'Find real ones:'),
      ...SEARCH[kind].map((q) => h('a', { class: 'ui-btn ui-btn-ghost', href: q.url, target: '_blank', rel: 'noopener', style: { textDecoration: 'none', fontSize: '13px' } }, q.label + ' ↗')),
    ),
    h('p', { class: 'muted', style: { margin: '0', fontSize: '12.5px', lineHeight: '1.45' } }, 'On iPhone: open a result, press and hold the picture, tap Copy Image Address (or Save to Photos), then come back and paste the link or upload the photo.'),
  );

  draw();
  return h('div', null, add, empty, mine, h('div', { class: 'cz-sub', style: { margin: '18px 0 10px', fontSize: '13px', color: 'var(--muted)' } }, isMat ? 'Plain mats' : 'Plain sleeves'), builtIn);
}

void addCustom;

function profileStats() {
  const p = getProfile();
  const ts = tournamentSummary();
  const chip = (v: string, l: string) => h('span', { class: 'stat-chip' }, h('b', null, v), h('span', null, l));
  const decks = Object.entries(p.decks).sort((a, b) => b[1].w + b[1].l + b[1].d - (a[1].w + a[1].l + a[1].d));
  return h(
    'div',
    null,
    h(
      'div',
      { class: 'pf-chips' },
      chip(`${p.games.w}-${p.games.l}${p.games.d ? '-' + p.games.d : ''}`, 'Games'),
      chip(`${Math.round(winRate(p.games) * 100)}%`, 'Game win rate'),
      chip(`${p.matches.w}-${p.matches.l}${p.matches.d ? '-' + p.matches.d : ''}`, 'Matches'),
      chip(String(ts.played), 'Tournaments'),
      chip(String(ts.wins), 'Titles'),
      chip(ts.best ? ordinal(ts.best) : '—', 'Best finish'),
    ),
    h(
      'div',
      { class: 'pf-grid' },
      h(
        'div',
        null,
        h('div', { class: 'pf-sub' }, 'Record by deck'),
        decks.length
          ? h('div', { class: 'pf-list' }, decks.slice(0, 10).map(([, d]) => h('div', { class: 'pf-row' }, h('span', null, d.name), h('b', null, `${d.w}-${d.l}${d.d ? '-' + d.d : ''}`), h('span', { class: 'pf-muted' }, `${Math.round(winRate(d) * 100)}%`))))
          : h('div', { class: 'pf-muted' }, 'Play a duel to start tracking your decks.'),
      ),
      h(
        'div',
        null,
        h('div', { class: 'pf-sub' }, 'Recent matches'),
        p.recent.length
          ? h('div', { class: 'pf-list' }, p.recent.slice(0, 8).map((m) => h('div', { class: 'pf-row' }, h('span', null, `${m.deckName} vs ${m.oppName} (${m.oppDeck})`), h('span', { class: 'pf-muted' }, m.score), h('span', { class: ['pf-res', m.result] }, m.result))))
          : h('div', { class: 'pf-muted' }, 'No matches played yet.'),
      ),
    ),
  );
}

