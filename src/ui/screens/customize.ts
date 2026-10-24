// Customize: sleeve, playmat, avatar and player name.
import { getSettings, updateSettings } from '../settings';
import { avatarGrid } from './components';
import { clear, h, toast } from './dom';
import { PLAYMATS, SLEEVES, applyPlaymat, renderAvatar, sleevePreview } from './ext';
import { frame, type Screen } from './nav';
import { getProfile, ordinal, tournamentSummary, winRate } from './store';

export function customizeScreen(): Screen {
  const s = getSettings();

  // ---- live preview
  const prevMat = h('div', { class: 'cz-mat' });
  const prevAvatar = h('span', { class: 'avatar-ring' });
  const prevName = h('div', { class: 'cz-pname' });
  const prevSleeve = h('div', { class: 'cz-psleeve' });
  const drawPreview = () => {
    const cur = getSettings();
    applyPlaymat(prevMat, cur.playmat);
    prevAvatar.replaceChildren(renderAvatar(cur.avatar, 76));
    prevName.textContent = cur.playerName;
    prevSleeve.replaceChildren(...[0, 1, 2].map((i) => h('div', { class: 'cz-stack', style: { '--i': i } }, sleevePreview(cur.sleeve, 'md'))));
  };
  const preview = h(
    'div',
    { class: 'cz-preview' },
    prevMat,
    h('div', { class: 'cz-preview-inner' }, h('div', { class: 'cz-pplayer' }, prevAvatar, h('div', null, h('div', { class: 'setup-role' }, 'Duelist'), prevName)), prevSleeve),
  );

  // ---- name
  const nameIn = h('input', { class: 'input', type: 'text', value: s.playerName, maxlength: 20, 'aria-label': 'Player name' });
  nameIn.addEventListener('input', () => {
    const v = nameIn.value.trim();
    if (v) {
      updateSettings({ playerName: v });
      drawPreview();
    }
  });

  // ---- sleeves
  const sleeveGrid = h('div', { class: 'cz-grid sleeves', role: 'radiogroup', 'aria-label': 'Sleeves' });
  const drawSleeves = () => {
    clear(sleeveGrid);
    const cur = getSettings().sleeve;
    for (const sl of SLEEVES)
      sleeveGrid.appendChild(
        h(
          'button',
          {
            type: 'button',
            class: ['cz-opt', cur === sl.id && 'on'],
            role: 'radio',
            'aria-checked': String(cur === sl.id),
            onclick: () => {
              updateSettings({ sleeve: sl.id });
              drawSleeves();
              drawPreview();
            },
          },
          h('span', { class: 'cz-sleeve' }, sleevePreview(sl.id, 'sm')),
          h('span', { class: 'cz-label' }, sl.name),
        ),
      );
  };

  // ---- playmats
  const matGrid = h('div', { class: 'cz-grid mats', role: 'radiogroup', 'aria-label': 'Playmats' });
  const drawMats = () => {
    clear(matGrid);
    const cur = getSettings().playmat;
    for (const m of PLAYMATS) {
      const sw = h('span', { class: 'cz-matsw' });
      applyPlaymat(sw, m.id);
      matGrid.appendChild(
        h(
          'button',
          {
            type: 'button',
            class: ['cz-opt', cur === m.id && 'on'],
            role: 'radio',
            'aria-checked': String(cur === m.id),
            title: m.description,
            onclick: () => {
              updateSettings({ playmat: m.id });
              drawMats();
              drawPreview();
            },
          },
          sw,
          h('span', { class: 'cz-label' }, m.name),
        ),
      );
    }
  };

  drawSleeves();
  drawMats();
  drawPreview();

  const section = (title: string, ...body: (Node | null)[]) => h('section', { class: 'cz-section' }, h('div', { class: 'section-title' }, h('h2', null, title)), ...body);

  const el = frame(
    'Customize',
    { subtitle: 'Make the duel table yours — changes save automatically', cls: 'customize' },
    h(
      'div',
      { class: 'cz-layout' },
      h(
        'div',
        { class: 'cz-main' },
        section(
          'Duelist',
          h(
            'div',
            { class: 'cz-duelist' },
            h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Player name'), nameIn),
            h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Avatar'), avatarGrid(s.avatar, (id) => (updateSettings({ avatar: id }), drawPreview(), toast('Avatar updated.', 'success', 1200)), 64)),
          ),
        ),
        section('Card sleeves', sleeveGrid),
        section('Playmat', matGrid),
        section('Profile & statistics', profileStats()),
      ),
      h('aside', { class: 'cz-side' }, h('div', { class: 'section-title' }, h('h2', null, 'Preview')), preview),
    ),
  );
  return { el };
}

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
