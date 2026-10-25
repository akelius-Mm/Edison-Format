import { zoomCard } from '../cards/zoom';
// Reusable UI pieces: deck tiles & pickers, avatar picker, persona editor, card detail.
import type { Difficulty } from '../../ai/ai';
import type { CardData } from '../../engine/card';
import { findCard } from '../../cards';
import { PREMADE_DECKS } from '../../decks';
import { randomPersona } from '../../tournament/personas';
import { badge, button, clear, h, icon, modal, segmented, type Child } from './dom';
import { AVATAR_PRESETS, renderAvatar, renderCard } from './ext';
import { getOfficialImage } from '../cards/officialArt';
import { getSettings } from '../settings';
import { coverCard, deckCount, getCustomDeck, getProfile, type DeckInfo } from './store';
import { haptic } from '../haptics';

// ------------------------------------------------------------------ deck tiles

export function tierBadge(tier: 1 | 2 | 3) {
  return badge(tier === 1 ? 'Tier 1' : tier === 2 ? 'Tier 2' : 'Rogue', tier === 1 ? 'gold' : tier === 2 ? 'blue' : '');
}

export function deckTile(d: DeckInfo, opts: { selected?: boolean; onClick?: () => void; compact?: boolean; extra?: Child } = {}) {
  const cover = coverCard(d);
  const main = deckCount(d.main);
  const extra = deckCount(d.extra);
  const el = h(
    'button',
    {
      type: 'button',
      class: ['deck-tile', opts.selected && 'on', opts.compact && 'compact', d.problems.length > 0 && 'invalid'],
      style: { '--deck': d.color },
      onclick: opts.onClick,
      'aria-pressed': opts.selected ? 'true' : 'false',
      title: d.description,
    },
    h('span', { class: 'deck-box' }, cover ? renderCard(cover, { size: 'xs' }) : h('span', { class: 'deck-box-empty' }, icon('cards'))),
    h(
      'span',
      { class: 'deck-tile-text' },
      h('span', { class: 'deck-tile-name' }, d.name),
      h('span', { class: 'deck-tile-arch' }, d.archetype),
      h(
        'span',
        { class: 'deck-tile-meta' },
        d.ref.kind === 'premade' ? tierBadge(d.tier) : badge('Custom', 'violet'),
        h('span', { class: 'deck-tile-count' }, `${main} + ${extra}`),
        recordChip(d.key),
        d.problems.length ? h('span', { class: 'deck-tile-warn', title: d.problems.join('\n') }, icon('warn'), `${d.problems.length}`) : null,
      ),
    ),
    opts.extra ?? null,
    opts.selected ? h('span', { class: 'deck-tile-check' }, icon('check')) : null,
  );
  return el;
}

let statsCache: { at: number; decks: ReturnType<typeof getProfile>['decks'] } | null = null;
function recordChip(key: string) {
  if (!statsCache || Date.now() - statsCache.at > 1000) statsCache = { at: Date.now(), decks: getProfile().decks };
  const r = statsCache.decks[key];
  if (!r || !(r.w + r.l + r.d)) return null;
  return h('span', { class: 'deck-tile-rec', title: 'Your games with this deck' }, `${r.w}W ${r.l}L`);
}

/** Scrollable list of decks grouped into "My decks" and "Premade decks", with a filter box. */
export function deckPicker(
  decks: DeckInfo[],
  selected: string | null,
  onSelect: (d: DeckInfo) => void,
  opts: { allowInvalid?: boolean; randomOption?: { selected: boolean; onSelect: () => void }; emptyText?: string } = {},
) {
  let cur = selected;
  const list = h('div', { class: 'deck-list', role: 'listbox' });
  const filter = h('input', { class: 'input deck-filter', type: 'search', placeholder: 'Filter decks…', 'aria-label': 'Filter decks' });
  const draw = () => {
    clear(list);
    const q = filter.value.trim().toLowerCase();
    const match = (d: DeckInfo) => !q || d.name.toLowerCase().includes(q) || d.archetype.toLowerCase().includes(q);
    if (opts.randomOption && !q) {
      list.appendChild(
        h(
          'button',
          {
            type: 'button',
            class: ['deck-tile', 'random', opts.randomOption.selected && cur == null && 'on'],
            onclick: () => {
              cur = null;
              opts.randomOption!.onSelect();
              draw();
            },
          },
          h('span', { class: 'deck-box random-box' }, icon('dice')),
          h('span', { class: 'deck-tile-text' }, h('span', { class: 'deck-tile-name' }, 'Random deck'), h('span', { class: 'deck-tile-arch' }, 'Any premade deck, weighted by tier')),
          opts.randomOption.selected && cur == null ? h('span', { class: 'deck-tile-check' }, icon('check')) : null,
        ),
      );
    }
    const groups: [string, DeckInfo[]][] = [
      ['My decks', decks.filter((d) => d.ref.kind === 'custom' && match(d))],
      ['Premade decks', decks.filter((d) => d.ref.kind === 'premade' && match(d)).sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name))],
    ];
    let any = false;
    for (const [title, ds] of groups) {
      if (!ds.length) continue;
      any = true;
      list.appendChild(h('div', { class: 'deck-group' }, title));
      for (const d of ds)
        list.appendChild(
          deckTile(d, {
            selected: cur === d.key,
            onClick: () => {
              cur = d.key;
              onSelect(d);
              draw();
            },
          }),
        );
    }
    if (!any) list.appendChild(h('div', { class: 'empty' }, icon('cards'), opts.emptyText ?? (q ? 'No deck matches your filter.' : 'No decks available yet.')));
  };
  filter.addEventListener('input', draw);
  draw();
  return h('div', { class: 'deck-picker' }, filter, list);
}

// ------------------------------------------------------------------ deck art & carousel

/** The card whose artwork represents each premade deck. */
const SIGNATURE: Record<string, string> = {
  'quickdraw-plant': 'Black Rose Dragon',
  zombies: 'Doomkaiser Dragon',
  lightsworn: 'Judgment Dragon',
  blackwings: 'Blackwing Armor Master',
  'x-sabers': 'XX-Saber Hyunlei',
  'gladiator-beasts': 'Gladiator Beast Gyzarus',
  'frog-monarchs': 'Caius the Shadow Monarch',
  'tele-dad': 'Dark Armed Dragon',
  'hero-beat': 'Elemental Hero Absolute Zero',
};

/** Name of the card whose art stands for a deck (premade signature, else its cover card). */
export function signatureCard(d: Pick<DeckInfo, 'main' | 'extra'> & { ref?: DeckInfo['ref']; id?: string }): string | undefined {
  const key = d.ref ? `${d.ref.kind}:${d.ref.id}` : (d.id ?? '');
  const [kind, ...rest] = key.includes(':') ? key.split(':') : ['premade', key];
  const id = rest.join(':');
  if (kind === 'premade') {
    if (SIGNATURE[id]) return SIGNATURE[id];
    // historical lists borrow the art of the matching archetype deck
    const def = PREMADE_DECKS.find((x) => x.id === id);
    const twin = def && PREMADE_DECKS.find((x) => x.archetype === def.archetype && SIGNATURE[x.id]);
    if (twin) return SIGNATURE[twin.id];
  }
  if (kind === 'custom') {
    const base = getCustomDeck(id)?.basedOn;
    if (base && SIGNATURE[base]) return SIGNATURE[base];
  }
  return coverCard(d)?.name;
}

/** Signature card for a deck known only by name (e.g. a duel side). */
export function signatureForDeckName(name: string | undefined, main?: { name: string; kind: string }[]): string | undefined {
  const p = PREMADE_DECKS.find((x) => x.name === name);
  if (p) return SIGNATURE[p.id];
  if (!main?.length) return undefined;
  const n = new Map<string, number>();
  for (const c of main) if (c.kind === 'monster') n.set(c.name, (n.get(c.name) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** Fill an element with a card's official artwork as a background (fails quietly). */
export function artInto(el: HTMLElement, cardName: string | undefined) {
  if (!cardName || !getSettings().officialImages) return el;
  void getOfficialImage(cardName).then((img) => {
    if (!img) return;
    const pre = new Image();
    pre.onload = () => {
      el.style.backgroundImage = `url("${img.art}")`;
      el.classList.add('has-art');
    };
    pre.src = img.art;
  });
  return el;
}

/** A square of deck artwork (falls back to the deck colour). */
export function deckArt(d: DeckInfo | null, cls = 'deck-art') {
  const el = h('span', { class: cls, style: d ? { '--deck': d.color } : undefined, 'aria-hidden': 'true' });
  if (d) artInto(el, signatureCard(d));
  return el;
}

type DeckEvent = NonNullable<(typeof PREMADE_DECKS)[number]['event']>;

/** The tournament a premade decklist placed at, if it is a historical list. */
export function deckEvent(d: Pick<DeckInfo, 'ref'>): DeckEvent | undefined {
  return d.ref.kind === 'premade' ? PREMADE_DECKS.find((x) => x.id === d.ref.id)?.event : undefined;
}

/** "SJC Edison · Apr 2010" */
export function eventShort(e: DeckEvent) {
  const name = e.name
    .replace(/Shonen Jump Championship/i, 'SJC')
    .replace(/Yu-Gi-Oh! Championship Series/i, 'YCS')
    .replace(/World Championship Qualifier/i, 'WCQ')
    .replace(/National Championships?/i, 'Nationals')
    .replace(/Regional Qualifier/i, 'Regional');
  const dt = new Date(`${e.date}T12:00:00`);
  const when = isNaN(dt.getTime()) ? e.date : dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  return `${name} · ${when}`;
}

export interface DeckGroup {
  key: 'mine' | 'winners' | 'archetypes';
  title: string;
  short: string;
  decks: DeckInfo[];
}

/** Your decks, historical tournament-winning lists, and the archetype premades. */
export function deckGroups(decks: DeckInfo[]): DeckGroup[] {
  const placeRank = (p: string) => (/^1/.test(p) ? 1 : /^2/.test(p) ? 2 : parseInt(p.replace(/\D+/g, '') || '99', 10) + 2);
  const winners = decks
    .filter((d) => deckEvent(d))
    .sort((a, b) => {
      const ea = deckEvent(a)!;
      const eb = deckEvent(b)!;
      return placeRank(ea.place) - placeRank(eb.place) || eb.date.localeCompare(ea.date) || a.name.localeCompare(b.name);
    });
  return [
    { key: 'mine', title: 'Your decks', short: 'Yours', decks: decks.filter((d) => d.ref.kind === 'custom') },
    { key: 'winners', title: 'Tournament winners', short: 'Winners', decks: winners },
    {
      key: 'archetypes',
      title: 'Archetypes',
      short: 'Archetypes',
      decks: decks.filter((d) => d.ref.kind === 'premade' && !deckEvent(d)).sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name)),
    },
  ];
}

export type DeckRow = HTMLElement & { setSelected: (key: string | null) => void };

/**
 * Horizontal, swipeable row of deck boxes (scroll-snap). Optional leading "Random" box (selected
 * when the selection is null) and trailing "New deck" box.
 */
export function deckCarousel(
  decks: DeckInfo[],
  selected: string | null,
  onSelect: (d: DeckInfo | null) => void,
  opts: { random?: boolean; label?: string; emptyText?: string; keepOrder?: boolean; newDeck?: () => void } = {},
): DeckRow {
  let cur = selected;
  const sorted = opts.keepOrder
    ? decks
    : [
        ...decks.filter((d) => d.ref.kind === 'custom'),
        ...decks.filter((d) => d.ref.kind === 'premade').sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name)),
      ];
  const track = h('div', { class: 'dkc-track', role: 'radiogroup', 'aria-label': opts.label ?? 'Deck' });
  const boxes: { key: string | null; el: HTMLButtonElement }[] = [];
  const sync = () => {
    for (const b of boxes) {
      const on = b.key === cur;
      b.el.classList.toggle('on', on);
      b.el.setAttribute('aria-checked', String(on));
      b.el.tabIndex = on ? 0 : -1;
    }
    if (!boxes.some((b) => b.key === cur) && boxes[0]) boxes[0].el.tabIndex = 0;
  };
  const pick = (key: string | null, d: DeckInfo | null) => {
    cur = key;
    sync();
    onSelect(d);
  };
  const onKey = (e: KeyboardEvent) => {
    const i = boxes.findIndex((b) => b.el === e.currentTarget);
    let ni = -1;
    if (e.key === 'ArrowRight') ni = Math.min(boxes.length - 1, i + 1);
    if (e.key === 'ArrowLeft') ni = Math.max(0, i - 1);
    if (ni < 0 || ni === i) return;
    e.preventDefault();
    boxes[ni].el.focus();
  };
  if (opts.random) {
    const el = h(
      'button',
      { type: 'button', class: 'dkc-box dkc-random', role: 'radio', onclick: () => pick(null, null), onkeydown: onKey },
      h('span', { class: 'dkc-art' }, icon('dice')),
      h('span', { class: 'dkc-shade' }),
      h('span', { class: 'dkc-check' }, icon('check')),
      h('span', { class: 'dkc-text' }, h('b', null, 'Random'), h('span', null, 'Any premade deck')),
    );
    boxes.push({ key: null, el });
  }
  for (const d of sorted) {
    const n = deckCount(d.main);
    const ev = deckEvent(d);
    const tag = ev ? ev.place : d.ref.kind === 'custom' ? 'Custom' : d.tier === 1 ? 'Tier 1' : d.tier === 2 ? 'Tier 2' : 'Rogue';
    const line = d.problems.length
      ? h('span', { class: 'dkc-warn' }, icon('warn'), 'Not legal')
      : ev
        ? eventShort(ev)
        : `${d.archetype.replace(/ \(custom\)$/, '')} · ${n} cards`;
    const el = h(
      'button',
      {
        type: 'button',
        class: ['dkc-box', d.problems.length > 0 && 'invalid', ev && 'event'],
        role: 'radio',
        style: { '--deck': d.color },
        title: d.problems.length ? d.problems.join('\n') : ev ? `${ev.place} · ${ev.name}${ev.pilot ? ` · ${ev.pilot}` : ''}` : d.description,
        onclick: () => pick(d.key, d),
        onkeydown: onKey,
      },
      deckArt(d, 'dkc-art'),
      h('span', { class: 'dkc-shade' }),
      h('span', { class: ['dkc-tag', ev && 'dkc-tag--event'] }, tag),
      h('span', { class: 'dkc-check' }, icon('check')),
      h('span', { class: 'dkc-text' }, h('b', null, ev?.pilot ? d.name.replace(` (${ev.pilot})`, '') : d.name), h('span', null, line)),
    );
    boxes.push({ key: d.key, el });
  }
  for (const b of boxes) track.appendChild(b.el);
  if (opts.newDeck)
    track.appendChild(
      h(
        'button',
        { type: 'button', class: 'dkc-box dkc-new', onclick: opts.newDeck },
        h('span', { class: 'dkc-art' }, icon('plus')),
        h('span', { class: 'dkc-text' }, h('b', null, sorted.length ? 'New deck' : 'Build a deck'), h('span', null, 'Deck Builder')),
      ),
    );
  else if (!sorted.length && !opts.random) track.appendChild(h('div', { class: 'dkc-empty' }, icon('cards'), opts.emptyText ?? 'No decks yet.'));
  sync();
  const reveal = () => {
    const on = boxes.find((b) => b.key === cur)?.el;
    if (on && track.scrollWidth > track.clientWidth) track.scrollLeft = Math.max(0, on.offsetLeft - track.offsetLeft - 16);
  };
  requestAnimationFrame(reveal);
  return Object.assign(h('div', { class: 'dkc' }, track), {
    setSelected: (key: string | null) => {
      cur = key;
      sync();
    },
  });
}

/**
 * Deck chooser without a long scroll: segmented tabs (Your decks / Winners / Archetypes) over one
 * swipeable row. Empty groups are left out.
 */
export function deckShelf(
  decks: DeckInfo[],
  selected: string | null,
  onSelect: (d: DeckInfo | null) => void,
  opts: { random?: boolean; label?: string; newDeck?: () => void } = {},
) {
  const groups = deckGroups(decks).filter((g) => g.decks.length || (g.key === 'mine' && opts.newDeck));
  const holder = h('div', { class: 'shelf-rows' });
  const rows: DeckRow[] = [];
  let cur = selected;
  const rowFor = (g: DeckGroup, withRandom: boolean) => {
    const r = deckCarousel(
      g.decks,
      cur,
      (d) => {
        cur = d?.key ?? null;
        for (const x of rows) if (x !== r) x.setSelected(cur ?? '\u0000');
        onSelect(d);
      },
      { keepOrder: true, random: withRandom, label: `${opts.label ?? 'Deck'}: ${g.title}`, newDeck: g.key === 'mine' ? opts.newDeck : undefined },
    );
    rows.push(r);
    return r;
  };
  // Random sits in the archetypes row (or the first row if there are none)
  const randomIn = opts.random ? (groups.find((g) => g.key === 'archetypes') ?? groups[0])?.key : undefined;
  const els = groups.map((g) => rowFor(g, g.key === randomIn));
  // rows that don't hold the current pick show nothing selected
  for (const r of rows) if (!r.querySelector('.dkc-box.on')) r.setSelected('\u0000');
  const start = Math.max(
    0,
    groups.findIndex((g) => (cur == null ? g.key === randomIn : g.decks.some((d) => d.key === cur))),
  );
  let tab = start;
  const show = (i: number) => {
    tab = i;
    holder.replaceChildren(els[i]);
    requestAnimationFrame(() => {
      const t = els[i].querySelector<HTMLElement>('.dkc-track');
      const on = els[i].querySelector<HTMLElement>('.dkc-box.on');
      if (t) t.scrollLeft = on ? Math.max(0, on.offsetLeft - t.offsetLeft - 16) : 0;
    });
  };
  const seg =
    groups.length > 1
      ? segmented<number>(
          groups.map((g, i) => ({ value: i, label: g.short, hint: g.title })),
          tab,
          (i) => show(i),
          `${opts.label ?? 'Deck'} group`,
        )
      : null;
  show(tab);
  return h('div', { class: 'shelf' }, seg, holder);
}

// ------------------------------------------------------------------ avatars & personas

export function avatarGrid(current: string, onPick: (id: string) => void, size = 64) {
  const grid = h('div', { class: 'avatar-grid', role: 'radiogroup', 'aria-label': 'Avatar' });
  let cur = current;
  const draw = () => {
    clear(grid);
    for (const id of AVATAR_PRESETS) {
      grid.appendChild(
        h(
          'button',
          {
            type: 'button',
            class: ['avatar-opt', cur === id && 'on'],
            role: 'radio',
            'aria-checked': String(cur === id),
            'aria-label': `Avatar ${id.replace('avatar-', '')}`,
            onclick: () => {
              cur = id;
              onPick(id);
              draw();
            },
          },
          renderAvatar(id, size),
        ),
      );
    }
  };
  draw();
  return grid;
}

export function pickAvatarModal(current: string): Promise<string | null> {
  return new Promise((res) => {
    let pick = current;
    let done = false;
    modal('Choose avatar', avatarGrid(current, (id) => (pick = id), 72), [
      { label: 'Cancel', onClick: () => void ((done = true), res(null)) },
      { label: 'Use avatar', variant: 'primary', onClick: () => void ((done = true), res(pick)) },
    ], { onClose: () => !done && res(null) });
  });
}

export interface PersonaState {
  name: string;
  avatar: string;
  difficulty: Difficulty;
}

export function randomAvatar() {
  return AVATAR_PRESETS[Math.floor(Math.random() * AVATAR_PRESETS.length)];
}

export function newPersona(difficulty: Difficulty): PersonaState {
  return { name: randomPersona().name, avatar: randomAvatar(), difficulty };
}

/** Persona editor: avatar button + name input + randomise + difficulty. */
export function personaEditor(p: PersonaState, onChange: () => void, opts: { hideDifficulty?: boolean } = {}) {
  const avatarBtn = h('button', { type: 'button', class: 'persona-avatar avatar-ring', title: 'Change avatar', 'aria-label': 'Change avatar' });
  const drawAvatar = () => {
    clear(avatarBtn);
    avatarBtn.appendChild(renderAvatar(p.avatar, 64));
  };
  drawAvatar();
  avatarBtn.addEventListener('click', async () => {
    const a = await pickAvatarModal(p.avatar);
    if (a) {
      p.avatar = a;
      drawAvatar();
      onChange();
    }
  });
  const name = h('input', { class: 'input', type: 'text', value: p.name, maxlength: 28, 'aria-label': 'Opponent name' });
  name.addEventListener('input', () => {
    p.name = name.value.trim() || 'Rival';
    onChange();
  });
  const dice = button(
    '',
    () => {
      const r = newPersona(p.difficulty);
      p.name = r.name;
      p.avatar = r.avatar;
      name.value = p.name;
      drawAvatar();
      onChange();
    },
    { variant: 'ghost', icon: 'dice', title: 'Randomize persona' },
  );
  const diff = segmented<Difficulty>(
    [
      { value: 'easy', label: 'Easy', hint: 'Makes mistakes, plays loosely' },
      { value: 'normal', label: 'Normal', hint: 'Solid, straightforward play' },
      { value: 'hard', label: 'Hard', hint: 'Careful and punishing' },
    ],
    p.difficulty,
    (v) => {
      p.difficulty = v;
      onChange();
    },
    'AI difficulty',
  );
  return h(
    'div',
    { class: 'persona' },
    avatarBtn,
    h('div', { class: 'persona-fields' }, h('div', { class: 'persona-name-row' }, name, dice), opts.hideDifficulty ? null : diff),
  );
}

/** Opponent card for match lobbies: name with a shuffle button, and difficulty as a segmented control. */
export function opponentEditor(p: PersonaState, onChange: () => void, opts: { hideDifficulty?: boolean; nameLabel?: string } = {}) {
  const name = h('input', { class: 'opp-name-input', type: 'text', value: p.name, maxlength: 28, 'aria-label': opts.nameLabel ?? 'Opponent name', autocomplete: 'off', spellcheck: false });
  name.addEventListener('input', () => {
    p.name = name.value.trim() || 'Rival';
    onChange();
  });
  const shuffle = h(
    'button',
    {
      type: 'button',
      class: 'opp-shuffle',
      title: 'New random opponent',
      'aria-label': 'New random opponent',
      onclick: () => {
        const r = newPersona(p.difficulty);
        p.name = r.name;
        p.avatar = r.avatar;
        name.value = p.name;
        onChange();
      },
    },
    icon('dice'),
  );
  const diff = segmented<Difficulty>(
    [
      { value: 'easy', label: 'Easy', hint: 'Makes mistakes, plays loosely' },
      { value: 'normal', label: 'Normal', hint: 'Solid, straightforward play' },
      { value: 'hard', label: 'Hard', hint: 'Careful and punishing' },
    ],
    p.difficulty,
    (v) => {
      p.difficulty = v;
      onChange();
    },
    'AI difficulty',
  );
  return h(
    'div',
    { class: 'opp-editor' },
    h('div', { class: 'opp-row' }, h('span', { class: 'opp-row-icon' }, icon('robot')), name, shuffle),
    opts.hideDifficulty ? null : h('div', { class: 'opp-diff' }, diff),
  );
}

// ------------------------------------------------------------------ lobby building blocks

/** Large off-white call to action (matches the home screen's Duel button). */
export function ctaButton(label: string, onClick: () => void, ic?: Parameters<typeof icon>[0], cls = '') {
  return h('button', { type: 'button', class: ['cta', cls], onclick: onClick }, ic ? icon(ic) : null, h('span', null, label));
}

/** Section with an iOS-style header (title + optional trailing link). */
export function lobbySection(title: string, trailing: Child, ...body: Child[]) {
  return h('section', { class: 'lob-sec' }, h('header', { class: 'lob-h' }, h('h2', null, title), trailing ?? null), ...body);
}

/** Small text link-button used in section headers. */
export function linkButton(label: string, onClick: () => void, ic: Parameters<typeof icon>[0] = 'chevron') {
  return h('button', { type: 'button', class: 'lob-link', onclick: onClick }, h('span', null, label), icon(ic));
}

/** Sticky bottom bar holding the screen's main action (sits above the tab bar). */
export function stickyBar(...children: Child[]) {
  return h('div', { class: 'lob-bar' }, h('div', { class: 'lob-bar-in' }, ...children));
}

// ------------------------------------------------------------------ iOS grouped lists

/** A grouped list section: small header, rounded list, optional footer note. */
export function iosGroup(title: string | null, rows: Child[], foot?: Child) {
  return h(
    'section',
    { class: 'ios-group' },
    title ? h('h2', { class: 'ios-group-h' }, title) : null,
    h('div', { class: 'ios-list' }, rows),
    foot ? h('p', { class: 'ios-foot' }, foot) : null,
  );
}

/** Row with a label (and optional description) and a trailing control. */
export function iosRow(label: Child, desc: Child | null, control: Child, opts: { icon?: Parameters<typeof icon>[0]; stack?: boolean; cls?: string } = {}) {
  return h(
    'div',
    { class: ['ios-row', opts.stack && 'ios-row--stack', opts.cls] },
    opts.icon ? h('span', { class: 'ios-icon' }, icon(opts.icon)) : null,
    h('div', { class: 'ios-row-text' }, h('div', { class: 'ios-label' }, label), desc ? h('div', { class: 'ios-desc' }, desc) : null),
    control != null ? h('div', { class: 'ios-ctl' }, control) : null,
  );
}

/** Tappable navigation row with a chevron. */
export function iosNav(label: Child, onClick: () => void, opts: { icon?: Parameters<typeof icon>[0]; detail?: Child; desc?: Child } = {}) {
  return h(
    'button',
    {
      type: 'button',
      class: 'ios-row ios-row--nav',
      onclick: () => {
        haptic('selection');
        onClick();
      },
    },
    opts.icon ? h('span', { class: 'ios-icon' }, icon(opts.icon)) : null,
    h('span', { class: 'ios-row-text' }, h('span', { class: 'ios-label' }, label), opts.desc ? h('span', { class: 'ios-desc' }, opts.desc) : null),
    opts.detail != null ? h('span', { class: 'ios-detail' }, opts.detail) : null,
    icon('chevron', 'icon ios-chev'),
  );
}

/** Full-width text button row (iOS "Reset…" style). */
export function iosAction(label: string, onClick: () => void, danger = false) {
  return h(
    'button',
    {
      type: 'button',
      class: ['ios-row', 'ios-row--action', danger && 'danger'],
      onclick: () => {
        haptic('selection');
        onClick();
      },
    },
    h('span', { class: 'ios-label' }, label),
  );
}

// ------------------------------------------------------------------ card detail

export function limitBadge(c: CardData) {
  const l = c.limit ?? 3;
  if (l === 0) return badge('Forbidden', 'red');
  if (l === 1) return badge('Limited', 'orange');
  if (l === 2) return badge('Semi-Limited', 'blue');
  return null;
}

export function typeLine(c: CardData) {
  if (c.kind === 'spell') return `${cap(c.stype ?? 'normal')} Spell`;
  if (c.kind === 'trap') return `${cap(c.ttype ?? 'normal')} Trap`;
  const t = (c.mtypes ?? []).filter((x) => x !== 'normal' || (c.mtypes ?? []).length === 1);
  return `${c.race ?? ''} / ${t.map(cap).join(' / ')}`;
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function cardDetail(c: CardData | null, opts: { actions?: Child; size?: 'lg' | 'xl' } = {}) {
  if (!c)
    return h('div', { class: 'card-detail empty-detail' }, h('div', { class: 'empty' }, icon('cards'), 'Hover or select a card to see its details.'));
  return h(
    'div',
    { class: 'card-detail' },
    h('div', { class: 'cd-card', title: 'Click to enlarge', style: { cursor: 'zoom-in' }, onclick: () => zoomCard(c) }, renderCard(c, { size: opts.size ?? 'lg', showLimit: true })),
    h(
      'div',
      { class: 'cd-info' },
      h('h3', { class: 'cd-name' }, c.name),
      h(
        'div',
        { class: 'cd-tags' },
        c.kind === 'monster' && c.attribute ? badge(c.attribute, attrBadge(c.attribute)) : null,
        c.kind === 'monster' && c.level ? badge(`Level ${c.level}`, 'gold') : null,
        limitBadge(c),
        ...(c.sets ?? []).map((s) => badge(s, 'violet')),
      ),
      h('div', { class: 'cd-type' }, `[ ${typeLine(c)} ]`),
      h('p', { class: 'cd-text' }, c.text || (c.mtypes?.includes('normal') ? 'A Normal Monster with no effect.' : '')),
      c.kind === 'monster' ? h('div', { class: 'cd-stats' }, h('span', null, 'ATK ', h('b', null, String(c.atk ?? '?'))), h('span', null, 'DEF ', h('b', null, String(c.def ?? '?')))) : null,
      opts.actions ? h('div', { class: 'cd-actions' }, opts.actions) : null,
    ),
  );
}

function attrBadge(a: string) {
  return ({ DARK: 'violet', LIGHT: 'gold', WATER: 'blue', FIRE: 'red', EARTH: 'orange', WIND: 'green' } as Record<string, string>)[a] ?? '';
}

export function cardByNameSafe(n: string) {
  return findCard(n) ?? null;
}

export function sectionTitle(text: string, extra?: Child) {
  return h('div', { class: 'section-title' }, h('h2', null, text), extra ?? null);
}
