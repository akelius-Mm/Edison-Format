// Reusable UI pieces: deck tiles & pickers, avatar picker, persona editor, card detail.
import type { Difficulty } from '../../ai/ai';
import type { CardData } from '../../engine/card';
import { findCard } from '../../cards';
import { randomPersona } from '../../tournament/personas';
import { badge, button, clear, h, icon, modal, segmented, type Child } from './dom';
import { AVATAR_PRESETS, renderAvatar, renderCard } from './ext';
import { coverCard, deckCount, getProfile, type DeckInfo } from './store';

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
    h('div', { class: 'cd-card' }, renderCard(c, { size: opts.size ?? 'lg', showLimit: true })),
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
