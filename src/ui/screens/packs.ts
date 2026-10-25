// Packs: your unopened era boosters, the DP shop, and the pack opening itself
// (tear → deal → flip → rarity reveal → summary).
import {
  boxPrice,
  buyPacks,
  buyStructureDeck,
  dp,
  getCollection,
  onCollectionChange,
  openNextPack,
  packCount,
  packPrice,
  PRICES,
  recentGrants,
  setCompletion,
  unopenedPacks,
  type Grant,
  type OpenedPull,
} from '../../collection';
import { olderLegalSets, playableSet, playableSets, rarityRank, setShopShows, shopShows, structureDeckCards, type ShopShows } from '../../collection/catalog';
import { oddsLines, PACK_FORMATS } from '../../collection/packs';
import { STRUCTURE_DECKS } from '../../collection/sets';
import { RARITY_NAMES, type Rarity } from '../../collection/types';
import { findCard } from '../../cards';
import { zoomCard } from '../cards/zoom';
import { renderCard } from '../cards/render';
import { Sfx } from '../duel/sound';
import { getSettings, loadJSON, saveJSON } from '../settings';
import { button, clear, h, icon, modal, segmented, toast } from './dom';
import { dpChip, foilCard, fmtDP, packArt, rarityPill, releaseLabel } from './collectionUi';
import { frame, go, type Params, type Screen } from './nav';

const SEEN_KEY = 'edison.packs.seenGrant.v1';
const SEL_KEY = 'edison.packs.selected.v1';
const SPOTLIGHT_FROM: Rarity = 'UR';

const isHit = (r: Rarity) => rarityRank(r) >= rarityRank(SPOTLIGHT_FROM);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const reduceMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function packsScreen(params: Params): Screen {
  let tab: 'packs' | 'shop' = params.tab === 'shop' ? 'shop' : 'packs';
  let selected = params.set?.toUpperCase() || loadJSON<string>(SEL_KEY, '');
  const sfx = new Sfx();
  const st = getSettings();
  sfx.enabled = st.sound;
  sfx.volume = st.volume;

  const chipHost = h('div', { class: 'ps-dp' }, dpChip(dp()));
  const body = h('div', { class: 'ps-body' });
  const seg = segmented(
    [
      { value: 'packs', label: 'My packs' },
      { value: 'shop', label: 'Shop' },
    ],
    tab,
    (v) => {
      tab = v as typeof tab;
      draw();
    },
    'Packs or shop',
  );
  const el = frame('Packs', { actions: chipHost, cls: 'ps-frame' }, h('div', { class: 'ps-seg' }, seg), body);

  let stage: Stage | null = null;
  const off = onCollectionChange(() => {
    chipHost.replaceChildren(dpChip(dp()));
    if (!stage) draw();
  });

  function draw() {
    clear(body);
    if (tab === 'shop') body.appendChild(shopView());
    else body.appendChild(shelfView());
  }

  // ------------------------------------------------------------ my packs

  function shelfView() {
    const packs = unopenedPacks();
    const wrap = h('div', { class: 'ps-shelfview' });
    const notice = grantNotice();
    if (!packs.length) {
      if (notice) wrap.appendChild(notice);
      wrap.appendChild(
        h(
          'div',
          { class: 'ps-empty' },
          h('div', { class: 'ps-empty-packs', 'aria-hidden': 'true' }, packArt('PTDN', { cls: 'pk--ghost' }), packArt('TDGS', { cls: 'pk--ghost' })),
          h('h2', null, 'No unopened packs'),
          h('p', null, 'Win duels and events to earn packs, or buy them in the Shop with Duel Points.'),
          button('Go to Shop', () => (seg.setValue('shop'), (tab = 'shop'), draw()), { variant: 'primary', icon: 'cards' }),
        ),
      );
      const hv = hitsView();
      if (hv) wrap.appendChild(hv);
      return wrap;
    }
    if (!packs.some((p) => p.code === selected)) selected = packs[0].code;
    const shelf = h('div', { class: 'ps-shelf', role: 'listbox', 'aria-label': 'Unopened packs' });
    const detail = h('div', { class: 'ps-detail' });
    const slots = packs.map((p) => {
      const b = h(
        'button',
        {
          type: 'button',
          class: 'ps-slot',
          role: 'option',
          dataset: { code: p.code },
          'aria-label': `${playableSet(p.code)?.data.name}, ${p.count} unopened`,
          onclick: () => {
            if (selected === p.code) return startOpening(p.code, false);
            select(p.code, true);
          },
        },
        packArt(p.code),
        h('span', { class: 'ps-count' }, `×${p.count}`),
      );
      return b;
    });
    shelf.append(h('div', { class: 'ps-shelf-pad' }), ...slots, h('div', { class: 'ps-shelf-pad' }));
    const select = (code: string, scroll: boolean) => {
      selected = code;
      saveJSON(SEL_KEY, code);
      for (const s of slots) {
        const on = s.dataset.code === code;
        s.classList.toggle('on', on);
        s.setAttribute('aria-selected', String(on));
      }
      if (scroll) slots.find((s) => s.dataset.code === code)?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', inline: 'center', block: 'nearest' });
      drawDetail(detail, code);
    };
    // Follow the centred pack while scrolling.
    let raf = 0;
    shelf.addEventListener(
      'scroll',
      () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          const mid = shelf.scrollLeft + shelf.clientWidth / 2;
          let best = slots[0];
          let bd = Infinity;
          for (const s of slots) {
            const d = Math.abs(s.offsetLeft + s.offsetWidth / 2 - mid);
            if (d < bd) [bd, best] = [d, s];
          }
          if (best.dataset.code !== selected) select(best.dataset.code!, false);
        });
      },
      { passive: true },
    );
    const hv = hitsView();
    wrap.append(shelf, detail);
    if (notice) wrap.appendChild(notice);
    if (hv) wrap.appendChild(hv);
    select(selected, false);
    requestAnimationFrame(() => {
      const s = slots.find((x) => x.dataset.code === selected);
      if (s) shelf.scrollLeft = s.offsetLeft + s.offsetWidth / 2 - shelf.clientWidth / 2;
    });
    return wrap;
  }

  function drawDetail(host: HTMLElement, code: string) {
    const set = playableSet(code)!;
    const n = packCount(code);
    const comp = setCompletion(code);
    const pct = comp.playable ? Math.round((comp.owned / comp.playable) * 100) : 0;
    const odds = oddsLines(code);
    host.replaceChildren(
      h(
        'div',
        { class: 'ps-info' },
        h('div', { class: 'ps-info-eyebrow' }, `${code} · ${releaseLabel(set.data.released)}`),
        h('h2', { class: 'ps-info-name' }, set.data.name),
        h(
          'div',
          { class: 'ps-info-meta' },
          `${PACK_FORMATS[set.data.format].cardsPerPack} cards per pack · ${set.playable.length} of ${set.printed} cards playable`,
        ),
        h('div', { class: 'ps-progress', title: `${comp.owned} of ${comp.playable} collected` }, h('span', { style: { width: pct + '%' } })),
        h('div', { class: 'ps-progress-label' }, `${comp.owned} / ${comp.playable} collected`),
      ),
      h(
        'div',
        { class: 'ps-actions' },
        button(n > 1 ? 'Open pack' : 'Open', () => startOpening(code, false), { variant: 'primary', cls: 'ui-btn-lg ps-open' }),
        n > 1 ? button(`Open all ${n}`, () => startOpening(code, true), { variant: 'ghost', cls: 'ui-btn-lg' }) : null,
      ),
      h(
        'details',
        { class: 'ps-odds' },
        h('summary', null, 'Pull rates', icon('chevron')),
        h(
          'ul',
          null,
          odds.map((o) => h('li', null, rarityPill(o.rarity, { long: true }), h('span', null, o.text))),
        ),
        h('p', { class: 'ps-odds-note' }, 'Odds as printed for this product. Only implemented cards are in the packs; a rarity with no implemented card falls to the next lower one.'),
      ),
    );
  }

  function hitsView() {
    const hits = getCollection().hits.slice(0, 8);
    if (!hits.length) return null;
    return h(
      'section',
      { class: 'ps-hits' },
      h('div', { class: 'lob-h' }, h('h2', null, 'Best pulls'), h('h3', null, 'Ultra Rare and above')),
      h(
        'div',
        { class: 'ps-hits-row' },
        hits.map((x) =>
          h(
            'button',
            {
              type: 'button',
              class: 'ps-hit',
              'aria-label': `${x.name}, ${RARITY_NAMES[x.rarity]}`,
              onclick: () => {
                const c = findCard(x.name);
                if (c) zoomCard(c);
              },
            },
            foilCard(x.name, x.rarity),
            h('span', { class: 'ps-hit-set' }, x.set),
          ),
        ),
      ),
    );
  }

  function grantNotice() {
    const seen = loadJSON<number>(SEEN_KEY, 0);
    const fresh = recentGrants().filter((g) => g.at > seen);
    if (!fresh.length) return null;
    const dismiss = () => {
      saveJSON(SEEN_KEY, Math.max(...fresh.map((g) => g.at)));
      box.remove();
    };
    const box = h(
      'div',
      { class: 'ps-grant', role: 'status' },
      h('div', { class: 'ps-grant-text' }, fresh.slice(0, 3).map((g) => h('div', { class: 'ps-grant-row' }, h('b', null, g.reason), h('span', null, describeGrant(g))))),
      button('', dismiss, { variant: 'subtle', icon: 'x', title: 'Dismiss', small: true }),
    );
    return box;
  }

  // ------------------------------------------------------------ shop

  function shopView() {
    const wrap = h('div', { class: 'ps-shop' });
    const sets = playableSets().filter((s) => s.available);
    const sold = sets.filter((s) => packPrice(s.code) != null);
    const prize = sets.filter((s) => packPrice(s.code) == null);
    const row = (code: string, name: string, meta: string, price: number | null, onBuy: () => void, art: HTMLElement) =>
      h(
        'div',
        { class: 'ps-row' },
        h('div', { class: 'ps-row-art' }, art),
        h('div', { class: 'ps-row-text' }, h('div', { class: 'ps-row-name' }, name), h('div', { class: 'ps-row-meta' }, meta)),
        price == null
          ? h('span', { class: 'ps-row-tag' }, 'Prize only')
          : button(fmtDP(price), onBuy, { variant: 'ghost', small: true, cls: 'ps-buy', disabled: dp() < price, title: `Buy ${name}` }),
      );
    const prizeEl = prize.length
      ? h(
          'div',
          { class: 'ps-prize' },
          h('div', { class: 'lob-h' }, h('h2', null, 'Turbo Packs')),
          h('p', null, 'Never sold in stores — Konami handed them out at Turbo tournaments. Earn them by entering tournaments and Locals.'),
          h('div', { class: 'lob-group ps-list' }, prize.map((s) => row(s.code, s.data.name, `${s.code} · ${s.data.released.slice(0, 4)} · 3 cards`, null, () => {}, packArt(s.code)))),
        )
      : null;
    const shows = shopShows();
    const older = olderLegalSets();
    const showsSeg = segmented<ShopShows>(
      [
        { value: 'shelf', label: '2010 shelf' },
        { value: 'legal', label: 'All Edison-legal sets' },
      ],
      shows,
      (v) => {
        setShopShows(v);
        draw();
      },
      'Shop shows',
    );
    const soonNote =
      shows === 'legal'
        ? h(
            'p',
            { class: 'ps-shows-note' },
            older.ready.length ? `Older sets on sale: ${older.ready.map((x) => x.code).join(', ')}. ` : '',
            older.soon.length ? `Joining once their cards are ready: ${older.soon.filter((x) => x.data.format === 'core').map((x) => x.code).join(', ')}.` : '',
          )
        : null;
    wrap.append(
      h('div', { class: 'ps-balance' }, h('div', { class: 'ps-balance-label' }, 'Balance'), h('div', { class: 'ps-balance-n' }, fmtDP(dp()))),
      h('div', { class: 'lob-h' }, h('h2', null, 'Booster packs')),
      h('div', { class: 'ps-shows' }, showsSeg),
      soonNote ?? '',
      h(
        'div',
        { class: 'lob-group ps-list' },
        sold.map((s) =>
          row(
            s.code,
            s.data.name,
            `${s.code} · ${s.data.released.slice(0, 4)} · ${s.playable.length} playable`,
            packPrice(s.code),
            () => buySheet(s.code),
            packArt(s.code),
          ),
        ),
      ),
      h('div', { class: 'lob-h' }, h('h2', null, 'Structure Decks')),
      h(
        'div',
        { class: 'lob-group ps-list' },
        STRUCTURE_DECKS.map((d) => {
          const cards = structureDeckCards(d);
          const n = cards.reduce((a, c) => a + c.copies, 0);
          return row(d.code, `${d.name} Structure Deck`, `${d.code} · ${d.released.slice(0, 4)} · ${n} playable cards`, PRICES.structureDeck, () => buyDeck(d.code), packArt(d.code));
        }),
      ),
    );
    if (prizeEl) wrap.appendChild(prizeEl);
    wrap.appendChild(h('p', { class: 'ps-foot-note' }, 'Prices follow the shelf prices of the time: 100 DP is about $1. A booster was $3.99, a Structure Deck $9.99. Earn DP by dueling.'));
    return wrap;
  }

  function buySheet(code: string) {
    const set = playableSet(code)!;
    const p = packPrice(code)!;
    const box = boxPrice(code)!;
    const per = PACK_FORMATS[set.data.format].packsPerBox;
    const opt = (label: string, sub: string, cost: number, n: number, isBox = false) =>
      h(
        'button',
        {
          type: 'button',
          class: 'ps-opt',
          disabled: dp() < cost,
          onclick: () => {
            if (!buyPacks(code, n, isBox)) return toast('Not enough Duel Points.', 'error');
            sfx.play('coin');
            m.close();
            toast(`${n} ${set.data.name} pack${n > 1 ? 's' : ''} added.`, 'success');
            selected = code;
          },
        },
        h('span', { class: 'ps-opt-text' }, h('b', null, label), h('span', null, sub)),
        h('span', { class: 'ps-opt-price' }, fmtDP(cost)),
      );
    const m = modal(
      set.data.name,
      h(
        'div',
        { class: 'ps-sheet' },
        h('div', { class: 'ps-sheet-art' }, packArt(code)),
        h('div', { class: 'ps-sheet-meta' }, `${code} · ${releaseLabel(set.data.released)} · ${set.playable.length} of ${set.printed} cards playable`),
        h(
          'div',
          { class: 'ps-opts' },
          opt('1 pack', `${PACK_FORMATS[set.data.format].cardsPerPack} cards`, p, 1),
          opt('3 packs', 'A night at the card shop', p * 3, 3),
          opt(`Booster box`, `${per} packs for the price of ${Math.round(box / p)}`, box, per, true),
        ),
        h('div', { class: 'ps-sheet-bal' }, `Balance ${fmtDP(dp())}`),
      ),
      [],
      { cls: 'ps-modal' },
    );
  }

  function buyDeck(code: string) {
    const d = STRUCTURE_DECKS.find((x) => x.code === code)!;
    const cards = structureDeckCards(d);
    const m = modal(
      `${d.name} Structure Deck`,
      h(
        'div',
        { class: 'ps-sheet' },
        h('div', { class: 'ps-sheet-art' }, packArt(code)),
        h('div', { class: 'ps-sheet-meta' }, `${code} · ${releaseLabel(d.released)} · adds ${cards.reduce((a, c) => a + c.copies, 0)} playable cards`),
        h('ul', { class: 'ps-decklist' }, cards.map((c) => h('li', null, h('span', null, `${c.copies}×`), c.name, c.rarity !== 'C' ? rarityPill(c.rarity) : null))),
      ),
      [
        { label: 'Cancel' },
        {
          label: `Buy · ${fmtDP(PRICES.structureDeck)}`,
          variant: 'primary',
          onClick: () => {
            if (!buyStructureDeck(code)) {
              toast('Not enough Duel Points.', 'error');
              return false;
            }
            sfx.play('coin');
            toast(`${d.name} added to your collection.`, 'success');
          },
        },
      ],
      { cls: 'ps-modal' },
    );
    void m;
  }

  // ------------------------------------------------------------ opening

  function startOpening(code: string, all: boolean) {
    if (stage || packCount(code) <= 0) return;
    stage = new Stage(code, sfx, () => {
      stage = null;
      draw();
    });
    document.body.appendChild(stage.el);
    if (all) void stage.openAll();
    else stage.showPack();
  }

  draw();
  if (params.open && packCount(params.open.toUpperCase()) > 0) setTimeout(() => startOpening(params.open.toUpperCase(), false), 60);

  return {
    el,
    dispose: () => {
      off();
      stage?.destroy();
      sfx.dispose();
    },
    onEscape: () => {
      if (stage) {
        stage.close();
        return true;
      }
      return false;
    },
  };
}

function describeGrant(g: Grant) {
  const parts: string[] = [];
  const packs = g.packs.reduce((a, p) => a + p.count, 0);
  if (packs) parts.push(`${packs} pack${packs > 1 ? 's' : ''}`);
  if (g.coins) parts.push(fmtDP(g.coins));
  const out = parts.join(' · ');
  return g.note ? `${out}. ${g.note}` : out;
}

// ================================================================ the opening stage

class Stage {
  readonly el: HTMLElement;
  private main: HTMLElement;
  private foot: HTMLElement;
  private title: HTMLElement;
  private sub: HTMLElement;
  private cards: { el: HTMLElement; pull: OpenedPull; flipped: boolean }[] = [];
  private busy = false;
  private spot: Promise<void> | null = null;
  private dead = false;
  /** Bumped on every screen change so stale timers do nothing. */
  private gen = 0;
  private opened = 0;

  constructor(
    private code: string,
    private sfx: Sfx,
    private onClose: () => void,
  ) {
    const set = playableSet(code)!;
    this.title = h('div', { class: 'po-title' }, set.data.name);
    this.sub = h('div', { class: 'po-sub' });
    this.main = h('div', { class: 'po-main' });
    this.foot = h('div', { class: 'po-foot' });
    this.el = h(
      'div',
      { class: 'po', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Opening ${set.data.name}` },
      h('div', { class: 'po-bg', style: { '--pk-deep': set.data.colors[0] } }),
      h(
        'header',
        { class: 'po-head' },
        button('', () => this.close(), { variant: 'subtle', icon: 'x', title: 'Close', cls: 'po-x' }),
        h('div', { class: 'po-titles' }, this.title, this.sub),
        h('div', { class: 'po-head-pad' }),
      ),
      this.main,
      this.foot,
    );
    document.body.classList.add('po-open');
    requestAnimationFrame(() => this.el.classList.add('in'));
  }

  private updateSub(sealed = false) {
    const left = packCount(this.code);
    const total = this.opened + left;
    const cur = sealed ? this.opened + 1 : this.opened;
    this.sub.textContent = total > 1 ? `Pack ${cur} of ${total}` : 'Booster pack';
  }

  // ---------------------------------------------------- 1. the sealed pack

  showPack() {
    this.cards = [];
    this.updateSub(true);
    const TEAR = 6; // % from the top, just under the crimp
    const zig = (from: number, to: number) => {
      const pts: string[] = [];
      const N = 16;
      for (let i = 0; i <= N; i++) {
        const k = from < to ? i : N - i;
        pts.push(`${(k / N) * 100}% ${TEAR + (k % 2 ? 1 : -1)}%`);
      }
      return pts.join(', ');
    };
    const topClip = `polygon(0% 0%, 100% 0%, ${zig(100, 0)})`;
    const bodyClip = `polygon(${zig(0, 100)}, 100% 100%, 0% 100%)`;
    const top = h('div', { class: 'po-pack-top', style: { clipPath: topClip } }, packArt(this.code));
    const bodyPart = h('div', { class: 'po-pack-body', style: { clipPath: bodyClip } }, packArt(this.code));
    const line = h('div', { class: 'po-tearline', style: { top: TEAR + '%' } });
    const pack = h('div', { class: 'po-pack', tabindex: '0', 'aria-label': 'Sealed pack. Swipe across the top, or tap, to open.' }, bodyPart, top, line);
    const hint = h('div', { class: 'po-hint' }, h('span', { class: 'po-hint-swipe', 'aria-hidden': 'true' }), 'Swipe across the top, or tap');
    const zone = h('div', { class: 'po-packzone' }, pack, hint);
    this.main.replaceChildren(zone);
    this.foot.replaceChildren();

    let progress = 0;
    let start: { x: number; y: number; id: number } | null = null;
    let done = false;
    const setP = (p: number) => {
      progress = Math.max(0, Math.min(1, p));
      pack.style.setProperty('--tear', String(progress));
    };
    const finish = () => {
      if (done) return;
      done = true;
      setP(1);
      void this.tear(pack, top, bodyPart, hint);
    };
    const autoTear = () => {
      if (done) return;
      pack.classList.add('auto');
      const t0 = performance.now();
      const from = progress;
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / 320);
        setP(from + (1 - from) * (1 - Math.pow(1 - k, 2)));
        if (k < 1) requestAnimationFrame(step);
        else finish();
      };
      requestAnimationFrame(step);
    };
    pack.addEventListener('pointerdown', (e) => {
      if (done) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      pack.setPointerCapture(e.pointerId);
      pack.classList.add('touching');
    });
    pack.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id || done) return;
      const w = pack.clientWidth;
      const dx = Math.abs(e.clientX - start.x);
      setP(dx / (w * 0.75));
      if (progress >= 1) finish();
    });
    const up = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      start = null;
      pack.classList.remove('touching');
      if (done) return;
      if (moved < 10 || progress > 0.55) autoTear();
      else setP(0);
    };
    pack.addEventListener('pointerup', up);
    pack.addEventListener('pointercancel', () => {
      start = null;
      pack.classList.remove('touching');
      if (!done) setP(0);
    });
    pack.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        autoTear();
      }
    });
    requestAnimationFrame(() => pack.focus({ preventScroll: true }));
  }

  // ---------------------------------------------------- 2. tear and deal

  private async tear(pack: HTMLElement, top: HTMLElement, bodyPart: HTMLElement, hint: HTMLElement) {
    const res = openNextPack(this.code);
    if (!res) return this.close();
    this.opened++;
    this.updateSub();
    this.sfx.play('draw');
    hint.classList.add('gone');
    pack.classList.add('torn');
    const rm = reduceMotion();
    await wait(rm ? 0 : 380);
    const packRect = bodyPart.getBoundingClientRect();
    bodyPart.classList.add('drop');
    await wait(rm ? 0 : 140);
    this.deal(res.pulls, packRect);
  }

  private layout(n: number) {
    const cols = n <= 3 ? n : n <= 9 ? 3 : n <= 16 ? 4 : 5;
    const rows = Math.ceil(n / cols);
    const gap = n > 12 ? 6 : 10;
    const W = Math.min(window.innerWidth - 32, 620);
    const H = window.innerHeight - 190;
    const w = Math.floor(Math.min((W - (cols - 1) * gap) / cols, (((H - (rows - 1) * gap) / rows) * 59) / 86, n <= 3 ? 150 : 200));
    return { cols, gap, w };
  }

  private deal(pulls: OpenedPull[], from: DOMRect) {
    const { cols, gap, w } = this.layout(pulls.length);
    const grid = h('div', { class: ['po-grid', pulls.length > 12 && 'po-grid--dense'], style: { '--po-w': w + 'px', '--po-gap': gap + 'px', gridTemplateColumns: `repeat(${cols}, var(--po-w))` } });
    this.cards = pulls.map((pull, i) => {
      const face = foilCard(pull.name, pull.rarity);
      const back = h('div', { class: 'po-back' }, renderCard(findCard(pull.name)!, { faceDown: true, size: 'md' }));
      const tags = h(
        'div',
        { class: 'po-tags' },
        pull.isNew ? h('span', { class: 'po-new' }, 'New') : pull.isNewRarity ? h('span', { class: 'po-new po-new--r' }, 'New rarity') : null,
        pull.rarity !== 'C' ? rarityPill(pull.rarity) : null,
      );
      const card = h(
        'button',
        {
          type: 'button',
          class: ['po-card', rarityRank(pull.rarity) >= rarityRank('SR') && 'po-card--foil', isHit(pull.rarity) && 'po-card--hit'],
          dataset: { r: pull.rarity },
          style: { '--i': i },
          'aria-label': `Face-down card ${i + 1}. Tap to flip.`,
        },
        h('div', { class: 'po-flip' }, back, h('div', { class: 'po-face' }, face)),
        tags,
      );
      const entry = { el: card, pull, flipped: false };
      card.addEventListener('click', () => {
        if (!entry.flipped) void this.flip(entry);
        else {
          const c = findCard(pull.name);
          if (c) zoomCard(c);
        }
      });
      return entry;
    });
    grid.append(...this.cards.map((c) => c.el));
    this.main.replaceChildren(grid);
    this.foot.replaceChildren(
      h('div', { class: 'po-foot-note' }, 'Tap a card to flip it'),
      button('Reveal all', () => void this.revealAll(), { variant: 'primary', cls: 'po-reveal' }),
    );
    if (reduceMotion()) return;
    // Deal: every card starts on the pack and glides to its place.
    const cx = from.left + from.width / 2;
    const cy = from.top + from.height * 0.45;
    for (const [i, c] of this.cards.entries()) {
      const r = c.el.getBoundingClientRect();
      const dx = cx - (r.left + r.width / 2);
      const dy = cy - (r.top + r.height / 2);
      c.el.style.transition = 'none';
      c.el.style.transform = `translate(${dx}px, ${dy}px) rotate(${(i % 2 ? 1 : -1) * (2 + (i % 3))}deg) scale(0.9)`;
      c.el.style.opacity = '0';
    }
    void grid.offsetWidth;
    for (const [i, c] of this.cards.entries()) {
      const delay = i * (pulls.length > 12 ? 28 : 60);
      c.el.style.transition = `transform 520ms var(--ease-out) ${delay}ms, opacity 200ms ease ${delay}ms`;
      c.el.style.transform = '';
      c.el.style.opacity = '';
      setTimeout(() => !this.dead && this.sfx.play('draw'), delay);
    }
    setTimeout(() => this.cards.forEach((c) => (c.el.style.transition = '')), 600 + pulls.length * 60);
  }

  // ---------------------------------------------------- 3. flip and reveal

  private async flip(c: { el: HTMLElement; pull: OpenedPull; flipped: boolean }) {
    if (c.flipped || this.dead) return;
    if (this.spot) await this.spot;
    if (c.flipped || this.dead) return;
    c.flipped = true;
    c.el.classList.add('is-flipped');
    c.el.setAttribute('aria-label', `${c.pull.name}, ${RARITY_NAMES[c.pull.rarity]}${c.pull.isNew ? ', new' : ''}. Tap to enlarge.`);
    this.sfx.play('flip');
    const rf = c.el.querySelector('.rf');
    setTimeout(() => rf?.classList.add('is-live'), 260);
    if (isHit(c.pull.rarity)) {
      await wait(reduceMotion() ? 0 : 460);
      this.spot = this.spotlight(c.el, c.pull);
      await this.spot;
      this.spot = null;
    }
    if (this.cards.every((x) => x.flipped)) this.summary();
  }

  private async revealAll() {
    if (this.busy) return;
    this.busy = true;
    this.foot.querySelector<HTMLButtonElement>('.po-reveal')?.setAttribute('disabled', '');
    for (const c of this.cards) {
      if (this.dead) return;
      if (c.flipped) continue;
      await this.flip(c);
      await wait(reduceMotion() ? 0 : 110);
    }
    this.busy = false;
  }

  /** The "moment": dim the table and present an Ultra Rare or better up close. */
  private spotlight(from: HTMLElement, pull: OpenedPull): Promise<void> {
    return new Promise((resolve) => {
      const r = from.getBoundingClientRect();
      const W = Math.min(window.innerWidth * 0.7, 300, ((window.innerHeight - 220) * 59) / 86);
      const card = h('div', { class: 'po-spot-card', style: { width: W + 'px' } }, foilCard(pull.name, pull.rarity, { live: true }));
      const ov = h(
        'div',
        { class: 'po-spot', dataset: { r: pull.rarity }, role: 'status' },
        card,
        h('div', { class: 'po-spot-r' }, RARITY_NAMES[pull.rarity]),
        h('div', { class: 'po-spot-name' }, pull.name),
        pull.isNew ? h('div', { class: 'po-spot-new' }, 'New to your collection') : null,
      );
      this.el.appendChild(ov);
      this.sfx.play(pull.rarity === 'ScR' || pull.rarity === 'GR' ? 'synchro' : 'summon');
      const rm = reduceMotion();
      if (!rm) {
        const cr = card.getBoundingClientRect();
        const s = r.width / cr.width;
        card.style.transition = 'none';
        card.style.transform = `translate(${r.left + r.width / 2 - (cr.left + cr.width / 2)}px, ${r.top + r.height / 2 - (cr.top + cr.height / 2)}px) scale(${s})`;
        void card.offsetWidth;
        card.style.transition = '';
        card.style.transform = '';
      }
      requestAnimationFrame(() => ov.classList.add('in'));
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        ov.classList.remove('in');
        ov.classList.add('out');
        setTimeout(() => {
          ov.remove();
          resolve();
        }, rm ? 0 : 260);
      };
      ov.addEventListener('click', close);
      setTimeout(close, 2600);
    });
  }

  // ---------------------------------------------------- 4. summary

  private summary() {
    if (this.dead) return;
    const pulls = this.cards.map((c) => c.pull);
    const news = pulls.filter((p) => p.isNew).length;
    const best = pulls.reduce((a, p) => (rarityRank(p.rarity) > rarityRank(a.rarity) ? p : a), pulls[0]);
    const left = packCount(this.code);
    this.foot.replaceChildren(
      h(
        'div',
        { class: 'po-sum' },
        h('div', { class: 'po-sum-line' }, h('b', null, news ? `${news} new card${news > 1 ? 's' : ''}` : 'No new cards'), h('span', null, ` · Best: ${RARITY_NAMES[best.rarity]}`)),
        h(
          'div',
          { class: 'po-sum-btns' },
          button('Done', () => this.close(), { variant: 'ghost' }),
          left ? button(`Open next`, () => this.next(), { variant: 'primary', cls: 'po-next' }) : null,
          left > 1 ? button(`Open all ${left}`, () => void this.openAll(), { variant: 'ghost' }) : null,
        ),
      ),
    );
    this.foot.classList.add('is-sum');
    (this.foot.querySelector('.po-next') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  private next() {
    const gen = ++this.gen;
    this.foot.classList.remove('is-sum');
    this.foot.replaceChildren();
    this.main.classList.add('swap');
    setTimeout(
      () => {
        if (gen !== this.gen || this.dead) return;
        this.main.classList.remove('swap');
        this.showPack();
      },
      reduceMotion() ? 0 : 220,
    );
  }

  /** Open every remaining pack of this set at once and show the haul. */
  async openAll() {
    this.gen++;
    this.main.classList.remove('swap');
    this.foot.classList.remove('is-sum');
    this.foot.replaceChildren();
    const all: OpenedPull[] = [];
    let n = 0;
    while (packCount(this.code) > 0) {
      const r = openNextPack(this.code);
      if (!r) break;
      n++;
      all.push(...r.pulls);
    }
    this.opened += n;
    this.updateSub();
    this.sub.textContent = `${n} pack${n === 1 ? '' : 's'} opened`;
    // Group identical pulls.
    const groups = new Map<string, { pull: OpenedPull; count: number; isNew: boolean }>();
    for (const p of all) {
      const k = p.name + '|' + p.rarity;
      const g = groups.get(k);
      if (g) {
        g.count++;
        g.isNew ||= p.isNew;
      } else groups.set(k, { pull: p, count: 1, isNew: p.isNew });
    }
    const list = [...groups.values()].sort((a, b) => rarityRank(b.pull.rarity) - rarityRank(a.pull.rarity) || Number(b.isNew) - Number(a.isNew) || a.pull.name.localeCompare(b.pull.name));
    const tally = new Map<Rarity, number>();
    for (const p of all) tally.set(p.rarity, (tally.get(p.rarity) ?? 0) + 1);
    const news = new Set(all.filter((p) => p.isNew).map((p) => p.name)).size;
    const grid = h(
      'div',
      { class: 'po-haul-grid' },
      list.map((g) =>
        h(
          'button',
          {
            type: 'button',
            class: 'po-haul-card',
            'aria-label': `${g.pull.name}, ${RARITY_NAMES[g.pull.rarity]}, ${g.count} copies`,
            onclick: () => {
              const c = findCard(g.pull.name);
              if (c) zoomCard(c);
            },
          },
          foilCard(g.pull.name, g.pull.rarity, { live: isHit(g.pull.rarity) }),
          h('div', { class: 'po-tags' }, g.isNew ? h('span', { class: 'po-new' }, 'New') : null, g.pull.rarity !== 'C' ? rarityPill(g.pull.rarity) : null),
          g.count > 1 ? h('span', { class: 'po-x-n' }, `×${g.count}`) : null,
        ),
      ),
    );
    const head = h(
      'div',
      { class: 'po-haul-head' },
      h('div', { class: 'po-haul-n' }, `${all.length} cards`, h('span', null, ` from ${n} pack${n === 1 ? '' : 's'} · ${news} new`)),
      h(
        'div',
        { class: 'po-haul-tally' },
        [...tally]
          .filter(([r]) => r !== 'C')
          .sort((a, b) => rarityRank(b[0]) - rarityRank(a[0]))
          .map(([r, c]) => h('span', { class: 'po-tally' }, rarityPill(r), `×${c}`)),
      ),
    );
    this.main.replaceChildren(h('div', { class: 'po-haul' }, head, grid));
    this.foot.replaceChildren(h('div', { class: 'po-sum' }, h('div', { class: 'po-sum-btns' }, button('Done', () => this.close(), { variant: 'primary' }))));
    this.foot.classList.add('is-sum');
    this.sfx.play('draw');
    // Short spotlight for the best few hits.
    const hits = list.filter((g) => isHit(g.pull.rarity)).slice(0, 3);
    const cardEls = [...grid.children] as HTMLElement[];
    await wait(reduceMotion() ? 0 : 420);
    for (const g of hits) {
      if (this.dead) return;
      const idx = list.indexOf(g);
      cardEls[idx]?.scrollIntoView({ block: 'nearest' });
      this.spot = this.spotlight(cardEls[idx], g.pull);
      await this.spot;
      this.spot = null;
    }
  }

  close() {
    if (this.dead) return;
    this.destroy();
    this.onClose();
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    document.body.classList.remove('po-open');
    this.el.classList.remove('in');
    this.el.classList.add('out');
    setTimeout(() => this.el.remove(), reduceMotion() ? 0 : 240);
  }
}

/** Convenience for other screens: jump straight into opening a set's pack. */
export function openPacksScreen(set?: string) {
  go('packs', set ? { open: set } : {});
}
