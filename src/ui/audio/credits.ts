// Audio credits: every recorded sound and music file shipped in public/audio/, where it came from,
// who made it and its license. Shown in Settings → Audio credits.
//
// All of it is CC0 (public domain dedication): free to use, change and redistribute, no attribution
// required. We credit the authors anyway. Nothing here is from the anime or from Konami.

export interface AudioCredit {
  /** What it is used for in the app. */
  use: string;
  title: string;
  author: string;
  license: string;
  licenseUrl: string;
  /** The author's page for the work. */
  page: string;
  /** Exact files we downloaded (commit-pinned public GitHub mirrors). */
  sources: string[];
  /** Files shipped in public/audio/ (without extension). */
  files: string[];
  /** How the original was changed. */
  edits: string;
}

const CC0 = { license: 'CC0 1.0 (public domain)', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' };

// Kenney's packs, from a public GitHub mirror of the original zips (each pack's License.txt is in
// the mirror next to the audio: "License: (Creative Commons Zero, CC0)").
const KENNEY_MIRROR = 'https://raw.githubusercontent.com/DickyDicky7/TokenTale-The-Elemental-Saga/8cf4a7001515d975e82ccc76018e2d908201eaad/game_asset_s/Audio/';
const kenney = (pack: string, page: string, folder: string, use: string, pairs: [shipped: string, source: string][]): AudioCredit => ({
  use,
  title: `${pack} (${pairs.map((p) => p[1]).join(', ')})`,
  author: 'Kenney (www.kenney.nl)',
  ...CC0,
  page,
  sources: pairs.map(([, src]) => `${KENNEY_MIRROR}${folder}${src}.ogg`),
  files: pairs.map(([f]) => `sfx/${f}`),
  edits: 'Trimmed, faded, loudness-matched; converted to AAC (.m4a) and Ogg Vorbis.',
});

export const SFX_CREDITS: AudioCredit[] = [
  kenney('Casino Audio', 'https://kenney.nl/assets/casino-audio', 'Casino%20Audio/Audio/', 'Card draw, set, summon, shuffle, coin toss', [
    ['card-slide-1', 'cardSlide1'],
    ['card-slide-2', 'cardSlide2'],
    ['card-slide-3', 'cardSlide3'],
    ['card-slide-4', 'cardSlide5'],
    ['card-slide-5', 'cardSlide6'],
    ['card-place-1', 'cardPlace1'],
    ['card-place-2', 'cardPlace2'],
    ['card-place-3', 'cardPlace3'],
    ['card-place-4', 'cardPlace4'],
    ['card-shuffle', 'cardShuffle'],
    ['coin-land-1', 'chipLay2'],
    ['coin-land-2', 'chipsCollide3'],
  ]),
  kenney('RPG Audio', 'https://kenney.nl/assets/rpg-audio', 'RPG%20Audio/Audio/', 'Card flip, coin flick', [
    ['card-flip-1', 'bookFlip2'],
    ['card-flip-2', 'bookFlip3'],
    ['coin-flick', 'metalLatch'],
  ]),
  kenney('Impact Sounds', 'https://kenney.nl/assets/impact-sounds', 'Impact%20Sounds/Audio/', 'Battle hits, damage, summon thud, destroy shatter', [
    ['punch-1', 'impactPunch_heavy_000'],
    ['punch-2', 'impactPunch_heavy_002'],
    ['punch-3', 'impactPunch_heavy_004'],
    ['thud-1', 'impactSoft_heavy_000'],
    ['thud-2', 'impactSoft_heavy_003'],
    ['clang-1', 'impactMetal_heavy_000'],
    ['clang-2', 'impactMetal_heavy_001'],
    ['shatter-1', 'impactGlass_heavy_000'],
    ['shatter-2', 'impactGlass_heavy_001'],
    ['shatter-3', 'impactGlass_heavy_004'],
    ['shards', 'impactGlass_light_002'],
  ]),
  kenney('Sci-Fi Sounds', 'https://kenney.nl/assets/sci-fi-sounds', 'Sci-Fi%20Sounds/Audio/', 'Synchro energy, big damage, negate, attack swoosh', [
    ['boom', 'lowFrequency_explosion_001'],
    ['crunch-1', 'explosionCrunch_000'],
    ['crunch-2', 'explosionCrunch_001'],
    ['energy-1', 'forceField_000'],
    ['energy-2', 'forceField_003'],
    ['barrier', 'impactMetal_001'],
    ['swoosh', 'thrusterFire_003'],
  ]),
  kenney('Foley Sounds', 'https://kenney.nl/assets/foley-sounds', 'Foley%20Sounds/Audio/Woosh/', 'Attack whoosh', [
    ['woosh-1', 'woosh3'],
    ['woosh-2', 'woosh4'],
    ['woosh-3', 'woosh6'],
    ['woosh-4', 'woosh8'],
  ]),
  kenney('Foley Sounds', 'https://kenney.nl/assets/foley-sounds', 'Foley%20Sounds/Audio/Swords/', 'Card activation "shing"', [
    ['shing-1', 'swordMetal1'],
    ['shing-2', 'swordMetal4'],
    ['shing-3', 'swordMetal5'],
  ]),
  kenney('Interface Sounds', 'https://kenney.nl/assets/interface-sounds', 'Interface%20Sounds/Audio/', 'Chimes, buttons, targeting, phases, LP counter', [
    ['chime-1', 'glass_001'],
    ['chime-2', 'glass_002'],
    ['sparkle', 'confirmation_002'],
    ['shimmer', 'glass_004'],
    ['select-1', 'select_001'],
    ['select-2', 'select_002'],
    ['switch-1', 'switch_002'],
    ['switch-2', 'switch_007'],
    ['click-1', 'click_001'],
    ['click-2', 'click_003'],
    ['error', 'error_006'],
    ['tick-1', 'tick_001'],
    ['tick-2', 'tick_002'],
  ]),
  kenney('Music Jingles', 'https://kenney.nl/assets/music-jingles', 'Music%20Jingles/Audio%20(Saxophone)/', 'Your turn, win and lose saxophone stings', [
    ['sax-turn', 'jingles-saxophone_07'],
    ['sax-win', 'jingles-saxophone_09'],
    ['sax-lose', 'jingles-saxophone_06'],
  ]),
];

const PHONOGRAPH = 'https://raw.githubusercontent.com/C-C-Minetest-Server/phonograph_albumm_holiznacc0/ce09fb19ea9a47d3444b00e31a417782118a8467/phonographs/002-winter-lofi/';

export const MUSIC_CREDITS: AudioCredit[] = [
  {
    use: 'Menu theme',
    title: 'First Snow (from "Winter Lofi")',
    author: 'HoliznaCC0',
    ...CC0,
    page: 'https://freemusicarchive.org/music/holiznacc0/winter-lofi',
    sources: [`${PHONOGRAPH}phonograph_album_holiznacc0_002-04-first-snow_ch0.ogg`, `${PHONOGRAPH}phonograph_album_holiznacc0_002-04-first-snow_ch1.ogg`],
    files: ['music/menu'],
    edits: 'A 32-bar loop (16.9 s to 110.5 s of the original, 82 BPM) with a one-beat crossfade at the seam; levelled to -16 LUFS; AAC 128 kbps.',
  },
  {
    use: 'Duel theme',
    title: 'Funky Hip Hop Lofi Jam',
    author: 'omfgdude',
    ...CC0,
    page: 'https://opengameart.org/content/funky-hip-hop-lofi-jam',
    sources: ['https://raw.githubusercontent.com/selkienova/parkour-game/6a37ce816d8a67bf6f446776d91b32bfb2c3eee2/Assets/Fmod/Without%20A%20Trace/Assets/CVP701Jam.ogg'],
    files: ['music/duel'],
    edits: 'Sped up 6% like a faster record (about 90 BPM); a 32-bar loop (22.6 s to 112.9 s of the original) with a one-beat crossfade at the seam; levelled to -16 LUFS; AAC 128 kbps.',
  },
  {
    use: 'Pinch theme (either player at 2000 LP or less)',
    title: 'Fire Place (from "Winter Lofi")',
    author: 'HoliznaCC0',
    ...CC0,
    page: 'https://freemusicarchive.org/music/holiznacc0/winter-lofi',
    sources: [`${PHONOGRAPH}phonograph_album_holiznacc0_002-02-fire-place_ch0.ogg`, `${PHONOGRAPH}phonograph_album_holiznacc0_002-02-fire-place_ch1.ogg`],
    files: ['music/pinch'],
    edits: 'Sped up 6% like a faster record (about 99 BPM, E minor up to F minor); a 32-bar loop (49.4 s to 132.0 s of the original) with a one-beat crossfade at the seam; levelled to -16 LUFS; AAC 128 kbps.',
  },
];

export const AUDIO_CREDITS: AudioCredit[] = [...MUSIC_CREDITS, ...SFX_CREDITS];
