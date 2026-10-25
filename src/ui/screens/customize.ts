// Customize: your real sleeves and playmat (photos or image links), plus plain colours.
import { getSettings, updateSettings } from '../settings';
import { addCustom, linkIntoCollection, listCustom, pickIntoCollection, removeCustom, type CustomKind } from '../theme/customImages';
import { clear, h, icon, toast } from './dom';
import { iosAction, iosGroup, iosRow } from './components';
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
  const nameIn = h('input', { id: 'cz-name', class: 'ios-input', type: 'text', value: s.playerName, maxlength: 20, 'aria-label': 'Duelist name', autocomplete: 'nickname', spellcheck: false });
  nameIn.addEventListener('input', () => {
    const v = nameIn.value.trim();
    if (v) updateSettings({ playerName: v });
  });

  const sleeves = picker('sleeve', drawPreview);
  const mats = picker('mat', drawPreview);
  drawPreview();

  const el = frame(
    'Sleeves & Playmat',
    { subtitle: 'Bring your real sleeves and mat. Changes save automatically.', cls: 'customize-screen' },
    h(
      'div',
      { class: 'cz-layout' },
      h('div', { class: 'cz-side' }, preview),
      h(
        'div',
        { class: 'cz-main' },
        iosGroup('Duelist name', [h('div', { class: 'ios-row ios-row--input' }, nameIn)]),
        mats,
        sleeves,
        profileStats(),
      ),
    ),
  );
  return { el };
}

/** One picker: plain built-ins and your own photos as a swatch grid, plus add-your-own rows. */
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
      { class: ['cz-opt', on && 'on'] },
      h('button', { type: 'button', class: 'cz-pick', role: 'radio', 'aria-checked': String(on), onclick: () => select(id) }, sw, h('span', { class: 'cz-label' }, label), h('span', { class: 'cz-tick', 'aria-hidden': 'true' }, icon('check'))),
      removable
        ? h(
            'button',
            {
              type: 'button',
              class: 'cz-remove',
              'aria-label': `Remove ${label}`,
              title: 'Remove',
              onclick: (ev: MouseEvent) => {
                ev.stopPropagation();
                removeCustom(kind, id);
                if (current() === id) select(isMat ? PLAYMATS[0].id : SLEEVES[0].id);
                else draw();
              },
            },
            icon('x'),
          )
        : null,
    );
  };

  const grid = h('div', { class: ['cz-grid', isMat ? 'mats' : 'sleeves'], role: 'radiogroup', 'aria-label': isMat ? 'Playmat' : 'Sleeves' });
  const draw = () => {
    clear(grid);
    listCustom(kind).forEach((it, i) => grid.appendChild(tileFor(it.id, `${isMat ? 'Mat' : 'Sleeve'} ${i + 1}`, true)));
    for (const x of isMat ? PLAYMATS : SLEEVES) grid.appendChild(tileFor(x.id, x.name, false));
  };

  const linkIn = h('input', {
    id: `cz-link-${kind}`,
    class: 'ios-input',
    type: 'url',
    inputmode: 'url',
    placeholder: 'Paste an image link',
    'aria-label': isMat ? 'Playmat image link' : 'Sleeve image link',
  }) as HTMLInputElement;
  const addLink = async () => {
    if (!linkIn.value.trim()) return linkIn.focus();
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

  draw();
  return h(
    'div',
    { class: 'cz-block' },
    h('section', { class: 'ios-group' }, h('h2', { class: 'ios-group-h' }, isMat ? 'Playmat' : 'Card sleeves'), h('div', { class: 'cz-grid-wrap' }, grid)),
    iosGroup(
      null,
      [
        iosAction(isMat ? 'Upload a photo of your mat' : 'Upload a photo of your sleeves', () => void upload()),
        h('div', { class: 'ios-row ios-row--input' }, linkIn, h('button', { type: 'button', class: 'ios-inline-btn', onclick: () => void addLink() }, 'Add')),
        ...SEARCH[kind].map((q) => h('a', { class: 'ios-row ios-row--nav', href: q.url, target: '_blank', rel: 'noopener' }, h('span', { class: 'ios-row-text' }, h('span', { class: 'ios-label' }, q.label)), icon('upload', 'icon ios-chev ios-ext'))),
      ],
      'On iPhone: open a result, press and hold the picture, tap Copy Image Address (or Save to Photos), then paste the link or upload the photo here.',
    ),
  );
}

void addCustom;

function profileStats() {
  const p = getProfile();
  const ts = tournamentSummary();
  const stat = (v: string, l: string) => h('div', { class: 'res-stat' }, h('b', null, v), h('span', null, l));
  const decks = Object.entries(p.decks).sort((a, b) => b[1].w + b[1].l + b[1].d - (a[1].w + a[1].l + a[1].d));
  const rec = (r: { w: number; l: number; d: number }) => `${r.w}-${r.l}${r.d ? '-' + r.d : ''}`;
  return h(
    'div',
    { class: 'cz-profile' },
    h('section', { class: 'ios-group' }, h('h2', { class: 'ios-group-h' }, 'Your record'), h(
      'div',
      { class: 'res-stats cz-stats' },
      stat(rec(p.games), 'Games'),
      stat(`${Math.round(winRate(p.games) * 100)}%`, 'Win rate'),
      stat(rec(p.matches), 'Matches'),
      stat(String(ts.played), 'Events'),
      stat(String(ts.wins), 'Titles'),
      stat(ts.best ? ordinal(ts.best) : '—', 'Best finish'),
    )),
    iosGroup(
      'Record by deck',
      decks.length
        ? decks.slice(0, 10).map(([, d]) => iosRow(d.name, null, h('span', { class: 'ios-detail' }, `${rec(d)} · ${Math.round(winRate(d) * 100)}%`)))
        : [iosRow(h('span', { class: 'muted' }, 'Play a duel to start tracking your decks.'), null, null)],
    ),
    iosGroup(
      'Recent matches',
      p.recent.length
        ? p.recent.slice(0, 8).map((m) =>
            iosRow(`vs ${m.oppName}`, `${m.deckName} vs ${m.oppDeck}`, h('span', { class: 'ios-ctl-res' }, h('span', { class: 'ios-detail' }, m.score), h('span', { class: ['pf-res', m.result] }, m.result))),
          )
        : [iosRow(h('span', { class: 'muted' }, 'No matches played yet.'), null, null)],
    ),
  );
}
