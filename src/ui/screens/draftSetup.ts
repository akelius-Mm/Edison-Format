// Draft and Sealed setup: the remembered form, saved presets, the "Customize" sheet and the
// "Packs & Draft" group in Settings. Event rules and validation live in src/draft/sets.ts.
import {
  checkSetup,
  DEFAULT_OPTIONS,
  defaultPlan,
  edisonPoolSize,
  edisonSetChoices,
  EDISON_PACK,
  fitPlan,
  isRealPack,
  MIN_EDISON_POOL,
  optionsLabel,
  PACK_RANGE,
  packOption,
  planLabel,
  RECENT_FROM,
  resizePlan,
  roundsFor,
  SEAT_OPTIONS,
  type AiLevel,
  type EdisonPoolKind,
  type EventOptions,
  type EventSetup,
  type RealSize,
  type Seats,
  type TourneyKind,
} from '../../draft';
import { olderLegalSets, setShopShows, shopShows, type ShopShows } from '../../collection/catalog';
import { loadJSON, saveJSON } from '../settings';
import { iosAction, iosGroup, iosNav, iosRow } from './components';
import { button, confirmDialog, h, icon, modal, promptDialog, segmented, toast, toggle } from './dom';
import { go } from './nav';

export const FORM_KEY = 'edison.draft.form.v1';
const PRESETS_KEY = 'edison.draft.presets.v1';

type Mode = 'draft' | 'sealed';

/** The setup form as remembered between visits: one plan per format, shared options. */
export interface SetupForm {
  mode: Mode;
  plans: Record<Mode, string[]>;
  opts: EventOptions;
}

interface StoredForm {
  mode?: Mode;
  /** Old saves: number of Edison Packs in a draft. */
  packs?: number;
  /** Old saves: match format (now in opts). */
  bestOf?: 1 | 3;
  plans?: Partial<Record<Mode, unknown>>;
  opts?: Partial<EventOptions>;
}

const oneOf = <T>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

/** Clean up stored options (unknown values fall back to the defaults). */
export function cleanOptions(o: Partial<EventOptions> | undefined, legacyBestOf?: unknown): EventOptions {
  const d = DEFAULT_OPTIONS;
  const legal = new Set(edisonSetChoices().map((s) => s.code));
  return {
    seats: oneOf<Seats>(o?.seats, SEAT_OPTIONS, d.seats),
    bestOf: oneOf<1 | 3>(o?.bestOf ?? legacyBestOf, [1, 3], d.bestOf),
    tourney: oneOf<TourneyKind>(o?.tourney, ['swiss', 'single'], d.tourney),
    ai: oneOf<AiLevel>(o?.ai, ['easy', 'normal', 'hard'], d.ai),
    fillers: typeof o?.fillers === 'boolean' ? o.fillers : d.fillers,
    realSize: oneOf<RealSize>(o?.realSize, [9, 15], d.realSize),
    edisonPool: oneOf<EdisonPoolKind>(o?.edisonPool, ['all', 'recent', 'custom'], d.edisonPool),
    edisonSets: Array.isArray(o?.edisonSets) ? o!.edisonSets.filter((c) => typeof c === 'string' && legal.has(c)) : [],
  };
}

function cleanPlan(plan: unknown, mode: Mode, dev: boolean, fallback: string[]): string[] {
  const p = Array.isArray(plan) ? plan.filter((c): c is string => typeof c === 'string') : [];
  const [lo, hi] = PACK_RANGE[mode];
  if (p.length < lo || p.length > hi || p.some((c) => !packOption(c, dev).ready)) return fallback;
  return p;
}

export function loadSetupForm(dev: boolean): SetupForm {
  const raw = loadJSON<StoredForm>(FORM_KEY, {});
  return {
    mode: raw.mode === 'sealed' ? 'sealed' : 'draft',
    plans: {
      draft: cleanPlan(raw.plans?.draft, 'draft', dev, raw.packs === 3 ? resizePlan(defaultPlan('draft'), 3) : defaultPlan('draft')),
      sealed: cleanPlan(raw.plans?.sealed, 'sealed', dev, defaultPlan('sealed')),
    },
    opts: cleanOptions(raw.opts, raw.bestOf),
  };
}

export function saveSetupForm(f: SetupForm) {
  // bestOf and packs stay at the top level for older builds reading the same key.
  saveJSON(FORM_KEY, { mode: f.mode, plans: f.plans, opts: f.opts, bestOf: f.opts.bestOf, packs: f.plans.draft.length });
}

export const setupOf = (f: SetupForm): EventSetup => ({ mode: f.mode, plan: f.plans[f.mode], ...f.opts });

/** Make `f` use a whole setup (a saved preset). */
export function applySetup(f: SetupForm, x: EventSetup) {
  f.mode = x.mode;
  f.plans[x.mode] = [...x.plan];
  f.opts = cleanOptions(x);
}

const norm = (x: EventSetup) => JSON.stringify({ ...setupOfParts(x), edisonSets: x.edisonPool === 'custom' ? [...x.edisonSets].sort() : [] });
const setupOfParts = (x: EventSetup) => ({ mode: x.mode, plan: x.plan, ...cleanOptions(x) });
export const sameSetup = (a: EventSetup, b: EventSetup) => norm(a) === norm(b);

// ------------------------------------------------------------------ saved presets

export interface SavedPreset {
  id: string;
  name: string;
  setup: EventSetup;
}

export function savedPresets(): SavedPreset[] {
  const raw = loadJSON<SavedPreset[]>(PRESETS_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && p.setup && Array.isArray(p.setup.plan))
    .map((p) => ({ ...p, setup: { mode: p.setup.mode === 'sealed' ? 'sealed' : 'draft', plan: p.setup.plan.filter((c) => typeof c === 'string'), ...cleanOptions(p.setup) } }));
}

const storePresets = (list: SavedPreset[]) => saveJSON(PRESETS_KEY, list);

export function addPreset(name: string, setup: EventSetup): SavedPreset {
  const p: SavedPreset = { id: `p${Date.now().toString(36)}`, name: name.slice(0, 40), setup: { ...setup, plan: [...setup.plan], edisonSets: [...setup.edisonSets] } };
  storePresets([...savedPresets(), p]);
  return p;
}

export function renamePreset(id: string, name: string) {
  storePresets(savedPresets().map((p) => (p.id === id ? { ...p, name: name.slice(0, 40) } : p)));
}

export function deletePreset(id: string) {
  storePresets(savedPresets().filter((p) => p.id !== id));
}

/** A name for a new preset: "Draft · ABPF · SOVR · ANPR · 6 players". */
export function suggestName(x: EventSetup) {
  return `${x.mode === 'sealed' ? 'Sealed' : 'Draft'} · ${planLabel(x.plan)}${x.mode === 'draft' && x.seats !== 8 ? ` · ${x.seats}p` : ''}`;
}

export async function savePresetFlow(x: EventSetup): Promise<SavedPreset | null> {
  const name = await promptDialog('Save as preset', 'Name', suggestName(x), 'Save');
  if (!name) return null;
  const p = addPreset(name, x);
  toast(`Saved “${p.name}”`, 'success');
  return p;
}

// ------------------------------------------------------------------ small controls

/** − value + stepper. */
export function stepper(value: number, min: number, max: number, onChange: (v: number) => void, label: string, unit = '') {
  const out = h('output', { class: 'dr-step-n', 'aria-live': 'polite' }, `${value}${unit}`);
  const dec = h('button', { type: 'button', class: 'dr-step-btn', 'aria-label': `Fewer ${label}`, disabled: value <= min, onclick: () => value > min && onChange(value - 1) }, icon('minus'));
  const inc = h('button', { type: 'button', class: 'dr-step-btn', 'aria-label': `More ${label}`, disabled: value >= max, onclick: () => value < max && onChange(value + 1) }, icon('plus'));
  return h('div', { class: 'dr-step', role: 'group', 'aria-label': label }, dec, out, inc);
}

export function edisonPoolLabel(o: EventOptions) {
  if (o.edisonPool === 'all') return 'Every Edison-legal card';
  if (o.edisonPool === 'recent') return '2009–2010 sets only';
  return `${o.edisonSets.length} chosen set${o.edisonSets.length === 1 ? '' : 's'}`;
}

// ------------------------------------------------------------------ Customize sheet

/** The Customize sheet. Edits `f` in place, saves it and calls `onChange` after every change. */
export function customizeSheet(f: SetupForm, dev: boolean, onChange: () => void) {
  const host = h('div', { class: 'dr-root dr-cust' });
  const status = h('div', { class: 'dr-cust-status', role: 'status' });
  const commit = () => {
    saveSetupForm(f);
    onChange();
    render();
  };
  const plan = () => f.plans[f.mode];
  /** Keep the current plan playable after a rule change (only ever adds packs). */
  const refit = () => {
    const x = setupOf(f);
    f.plans[f.mode] = fitPlan((n) => resizePlan(x.plan, n), x.plan.length, x);
  };
  const seg = <T extends string | number>(opts: { value: T; label: string }[], v: T, set: (v: T) => void, label: string) =>
    segmented<T>(opts, v, (nv) => {
      set(nv);
      commit();
    }, label);

  const render = () => {
    const scroller = host.closest('.modal-body') ?? host.closest('.modal');
    const top = scroller?.scrollTop ?? 0;
    const o = f.opts;
    const x = setupOf(f);
    const chk = checkSetup(x, dev);
    const real = x.plan.some(isRealPack);
    const hasEdison = x.plan.includes(EDISON_PACK);
    const [lo, hi] = PACK_RANGE[f.mode];
    status.className = ['dr-cust-status', !chk.ok && 'warn'].filter(Boolean).join(' ');
    status.replaceChildren(icon(chk.ok ? 'check' : 'warn'), h('span', null, chk.ok ? chk.summary : chk.problems[0]));

    const table = iosGroup(
      f.mode === 'sealed' ? 'Sealed' : 'Draft table',
      [
        iosRow('Players', f.mode === 'sealed' ? 'You and the AI duelists in the tournament.' : null, seg<number>(SEAT_OPTIONS.map((n) => ({ value: n, label: String(n) })), o.seats, (v) => (o.seats = v as Seats), 'Players')),
        iosRow(
          'Packs per player',
          `${chk.cards} ${f.mode === 'sealed' ? 'cards in your pool' : 'picks each'} · needs ${chk.min}`,
          stepper(plan().length, lo, hi, (v) => ((f.plans[f.mode] = resizePlan(plan(), v)), commit()), 'packs per player'),
        ),
        iosRow(
          'Real booster size',
          o.realSize === 15 ? 'Draft booster: the printed 9 plus 6 extra commons.' : 'As printed: 7 commons, 1 rare, 1 foil slot.',
          seg<number>(
            [
              { value: 9, label: '9 cards' },
              { value: 15, label: '15 cards' },
            ],
            o.realSize,
            (v) => (o.realSize = v as RealSize),
            'Real booster size',
          ),
          { stack: true, cls: real ? '' : 'is-dim' },
        ),
      ],
      'The Edison Pack always has 15 cards.',
    );

    const matches = iosGroup('Matches', [
      iosRow('Games', null, seg<number>([{ value: 1, label: 'Best of 1' }, { value: 3, label: 'Best of 3' }], o.bestOf, (v) => (o.bestOf = v as 1 | 3), 'Games per match'), { stack: true }),
      iosRow(
        'Rounds',
        o.tourney === 'single' ? `${roundsFor(o.seats, 'single')} rounds, knockout. Lose once and you are out.` : '3 Swiss rounds: everyone plays every round.',
        seg<TourneyKind>([{ value: 'swiss', label: 'Swiss · 3' }, { value: 'single', label: 'Single elimination' }], o.tourney, (v) => (o.tourney = v), 'Rounds'),
        { stack: true },
      ),
      iosRow(
        'AI difficulty',
        'How sharply the AI drafts and plays.',
        seg<AiLevel>([{ value: 'easy', label: 'Easy' }, { value: 'normal', label: 'Normal' }, { value: 'hard', label: 'Hard' }], o.ai, (v) => (o.ai = v), 'AI difficulty'),
        { stack: true },
      ),
    ]);

    const deck = iosGroup(
      'Deck building',
      [
        iosRow(
          'Free basic monsters',
          'Vanilla monsters anyone may add to reach 40 cards, like basic lands.',
          toggle(o.fillers, (v) => {
            o.fillers = v;
            refit();
            commit();
          }, 'Free basic monsters'),
        ),
      ],
      o.fillers ? null : `Without them every card comes from your pool: at least ${chk.min} ${f.mode === 'sealed' ? 'cards' : 'picks'}.`,
    );

    const choices = edisonSetChoices();
    const poolSize = edisonPoolSize(o);
    const custom = o.edisonPool === 'custom';
    const pick = new Set(o.edisonSets);
    const edison = iosGroup(
      'Edison Pack contents',
      [
        iosRow(
          'Draws from',
          null,
          seg<EdisonPoolKind>(
            [
              { value: 'all', label: 'All cards' },
              { value: 'recent', label: '2009–2010' },
              { value: 'custom', label: 'Choose sets' },
            ],
            o.edisonPool,
            (v) => {
              o.edisonPool = v;
              if (v === 'custom' && !o.edisonSets.length) o.edisonSets = choices.filter((c) => c.released >= RECENT_FROM).map((c) => c.code);
            },
            'Edison Pack draws from',
          ),
          { stack: true },
        ),
        ...(custom
          ? choices.map((c) =>
              h(
                'label',
                { class: ['ios-row', 'dr-check', pick.has(c.code) && 'on'] },
                h('span', { class: 'ios-row-text' }, h('span', { class: 'ios-label' }, c.name), h('span', { class: 'ios-desc' }, `${c.code} · ${c.released.slice(0, 4)} · ${c.playable} cards`)),
                h('input', {
                  type: 'checkbox',
                  class: 'dr-check-input',
                  checked: pick.has(c.code),
                  onchange: (e: Event) => {
                    const on = (e.target as HTMLInputElement).checked;
                    o.edisonSets = on ? [...new Set([...o.edisonSets, c.code])] : o.edisonSets.filter((k) => k !== c.code);
                    commit();
                  },
                }),
                h('span', { class: 'dr-check-box', 'aria-hidden': 'true' }, icon('check')),
              ),
            )
          : []),
      ],
      `${o.edisonPool === 'all' ? 'Every playable Edison-legal card' : `${poolSize} cards`}${poolSize < MIN_EDISON_POOL ? ` · needs at least ${MIN_EDISON_POOL}` : ''}${hasEdison ? '' : ' · used when a round has an Edison Pack'}.`,
    );

    const presets = savedPresets();
    const presetGroup = iosGroup(
      'Presets',
      [
        iosAction('Save as preset…', () => void savePresetFlow(setupOf(f)).then((p) => p && commit())),
        ...presets.map((p) =>
          iosRow(
            p.name,
            `${p.setup.mode === 'sealed' ? 'Sealed' : 'Draft'} · ${planLabel(p.setup.plan)} · ${optionsLabel(p.setup)}`,
            h(
              'div',
              { class: 'dr-preset-tools' },
              button(
                '',
                async () => {
                  const name = await promptDialog('Rename preset', 'Name', p.name, 'Rename');
                  if (name) {
                    renamePreset(p.id, name);
                    commit();
                  }
                },
                { variant: 'subtle', icon: 'edit', small: true, title: `Rename ${p.name}` },
              ),
              button(
                '',
                async () => {
                  if (!(await confirmDialog('Delete preset?', `“${p.name}” will be removed.`, 'Delete', true))) return;
                  deletePreset(p.id);
                  commit();
                },
                { variant: 'subtle', icon: 'trash', small: true, title: `Delete ${p.name}` },
              ),
            ),
          ),
        ),
      ],
      presets.length ? 'Saved presets sit next to the built-in ones on the Draft screen.' : 'Save this setup to start it again with one tap.',
    );

    const reset = iosGroup(null, [
      iosAction('Restore defaults', () => {
        f.opts = { ...DEFAULT_OPTIONS };
        f.plans[f.mode] = defaultPlan(f.mode);
        commit();
      }),
    ]);

    host.replaceChildren(status, table, matches, deck, edison, presetGroup, reset);
    if (scroller) scroller.scrollTop = top;
  };

  render();
  modal('Customize', host, [{ label: 'Done', variant: 'primary' }], { cls: 'dr-cust-modal' });
}

// ------------------------------------------------------------------ Settings → Packs & Draft

/** The "Packs & Draft" group on the Settings screen. */
export function packsDraftSettingsGroup() {
  const f = loadSetupForm(false);
  const older = olderLegalSets();
  return iosGroup(
    'Packs & Draft',
    [
      iosNav('Draft & Sealed', () => go('draft', { customize: '1' }), { icon: 'cards', detail: `${f.opts.seats} players · Bo${f.opts.bestOf}` }),
      iosRow(
        'Shop shows',
        null,
        segmented<ShopShows>(
          [
            { value: 'shelf', label: '2010 shelf' },
            { value: 'legal', label: 'All Edison-legal sets' },
          ],
          shopShows(),
          (v) => {
            setShopShows(v);
            toast(v === 'legal' ? (older.ready.length ? 'The shop now also sells older Edison-legal sets.' : 'Older sets appear in the shop once their cards are ready.') : 'The shop shows the 2010 shelf.', 'info');
          },
          'Shop shows',
        ),
        { stack: true },
      ),
    ],
    `The 2010 shelf is ABPF, SOVR, ANPR, Hidden Arsenal and the Turbo Packs. Older Edison-legal sets join once their cards are complete${older.ready.length ? ` (now: ${older.ready.map((s) => s.code).join(', ')})` : ''}. Starter gifts and prizes always come from the shelf.`,
  );
}
