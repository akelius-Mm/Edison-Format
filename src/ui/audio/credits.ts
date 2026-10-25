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
  {
    use: 'Turn, win and lose stings',
    title: 'Vibraphone, soft mallets (Versilian Community Sample Library)',
    author: 'Versilian Studios (Sam Gossner)',
    ...CC0,
    page: 'https://github.com/sgossner/VCSL',
    sources: ['F2', 'A2', 'C3', 'E3', 'G3', 'B3', 'D4', 'F4', 'A4', 'C5', 'E5'].map(
      (n) => `https://raw.githubusercontent.com/sgossner/VCSL/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Idiophones/Struck%20Idiophones/Vibraphone/Soft%20Mallets/Vibes_soft_${n}_v1_rr${n === 'C3' || n === 'E3' ? 2 : 1}_Main.wav`,
    ),
    files: ['sfx/vibe-turn', 'sfx/vibe-win', 'sfx/vibe-lose'],
    edits: 'Single notes level-matched, re-pitched by up to two semitones and played as short phrases: a rising fifth (turn), a rolled Fmaj9 (win), a falling line onto D minor (lose); gently low-passed and faded; AAC and Ogg Vorbis.',
  },
];

const PHONOGRAPH = 'https://raw.githubusercontent.com/C-C-Minetest-Server/phonograph_albumm_holiznacc0/ce09fb19ea9a47d3444b00e31a417782118a8467/phonographs/002-winter-lofi/phonograph_album_holiznacc0_002-';
const WINTER_LOFI = 'https://freemusicarchive.org/music/holiznacc0/winter-lofi';
const winterLofi = (n: string) => [`${PHONOGRAPH}${n}_ch0.ogg`, `${PHONOGRAPH}${n}_ch1.ogg`];
const SLOT_USE = { menu: 'Menu playlist', duel: 'Duel playlist', pinch: 'Pinch playlist (either player at 2000 LP or less)' };
const loopEdit = (bars: number, from: number, to: number, bpm: number, speed = '') =>
  `${speed}A ${bars}-bar section (${from} s to ${to} s of the original, about ${bpm} BPM as played) with a seamless loop point and a one-beat crossfade at the seam; levelled to -16 LUFS; AAC.`;
const FASTER = 'Sped up 6% like a faster record (tempo and pitch, about a semitone up). ';

/** One entry per built-in track (see MUSIC_TRACKS in samples.ts). */
export const MUSIC_CREDITS: AudioCredit[] = [
  {
    use: SLOT_USE.menu,
    title: 'First Snow (from "Winter Lofi")',
    author: 'HoliznaCC0',
    ...CC0,
    page: WINTER_LOFI,
    sources: winterLofi('04-first-snow'),
    files: ['music/first-snow'],
    edits: loopEdit(32, 16.9, 110.5, 82),
  },
  {
    use: SLOT_USE.menu,
    title: 'Snow Drift (from "Winter Lofi")',
    author: 'HoliznaCC0',
    ...CC0,
    page: WINTER_LOFI,
    sources: winterLofi('03-snow-drift'),
    files: ['music/snow-drift'],
    edits: loopEdit(32, 58.0, 148.4, 85),
  },
  {
    use: SLOT_USE.menu,
    title: '2 Hour Delay (from "Winter Lofi")',
    author: 'HoliznaCC0',
    ...CC0,
    page: WINTER_LOFI,
    sources: winterLofi('01-2-hour-delay'),
    files: ['music/two-hour-delay'],
    edits: loopEdit(32, 19.8, 115.8, 80),
  },
  {
    use: SLOT_USE.menu,
    title: 'Chill Lofi Inspired (seamless loop edit)',
    author: 'omfgdude; loop edit by Iwan Gabovitch (qubodup)',
    ...CC0,
    page: 'https://opengameart.org/content/chill-lofi-inspired-loop-edit',
    sources: ['https://raw.githubusercontent.com/kunal-raj-dev/flowtask/b2e8726b5a353f4a2ee3ebfb6faba74f2654d88c/public/media/audio/music/chillhop-inspired.mp3'],
    files: ['music/chill-lofi'],
    edits: loopEdit(24, 15.2, 88.2, 79),
  },
  {
    use: SLOT_USE.duel,
    title: 'Funky Hip Hop Lofi Jam',
    author: 'omfgdude',
    ...CC0,
    page: 'https://opengameart.org/content/funky-hip-hop-lofi-jam',
    sources: ['https://raw.githubusercontent.com/selkienova/parkour-game/6a37ce816d8a67bf6f446776d91b32bfb2c3eee2/Assets/Fmod/Without%20A%20Trace/Assets/CVP701Jam.ogg'],
    files: ['music/funky-lofi-jam'],
    edits: loopEdit(32, 22.6, 112.9, 90, FASTER),
  },
  {
    use: SLOT_USE.duel,
    title: 'Winter Blues (from "Winter Lofi")',
    author: 'HoliznaCC0',
    ...CC0,
    page: WINTER_LOFI,
    sources: winterLofi('05-winter-blues'),
    files: ['music/winter-blues'],
    edits: loopEdit(32, 86.6, 182.6, 85, FASTER),
  },
  {
    use: SLOT_USE.duel,
    title: 'Lofi Hip Hop',
    author: 'omfgdude',
    ...CC0,
    page: 'https://opengameart.org/content/lofi-hip-hop',
    sources: ['https://raw.githubusercontent.com/jwon345/AvatarCustomization/11b3350935fba750fb0ba5c46fc2ccbc01e46dc8/Assets/lofihiphop.ogg'],
    files: ['music/lofi-hip-hop'],
    edits: loopEdit(32, 15.3, 111.3, 85, FASTER),
  },
  {
    use: SLOT_USE.duel,
    title: 'Autumn (from "Lofi And Chill")',
    author: 'HoliznaCC0',
    ...CC0,
    page: 'https://holiznacc0.bandcamp.com/album/lofi-and-chill',
    sources: ['https://raw.githubusercontent.com/Hasnat4763/catch-the-leaves/bed1d1ffa572ea64212ef9385aa2fb417c20d342/sounds/HoliznaCC0%20-%20Autumn.mp3'],
    files: ['music/autumn'],
    edits: loopEdit(32, 49.4, 138.0, 92, FASTER),
  },
  {
    use: SLOT_USE.pinch,
    title: 'Fire Place (from "Winter Lofi")',
    author: 'HoliznaCC0',
    ...CC0,
    page: WINTER_LOFI,
    sources: winterLofi('02-fire-place'),
    files: ['music/fire-place'],
    edits: loopEdit(32, 49.4, 132.0, 99, FASTER + 'E minor up to F minor. '),
  },
  {
    use: SLOT_USE.pinch,
    title: 'A Little Shade (from "Lofi And Chill")',
    author: 'HoliznaCC0',
    ...CC0,
    page: 'https://holiznacc0.bandcamp.com/album/lofi-and-chill',
    sources: ['https://raw.githubusercontent.com/Fantasiel/GameJam25/d47829539968f06663f37a59e2eca56677852b63/art/music/HoliznaCC0%20-%20A%20Little%20Shade.mp3'],
    files: ['music/a-little-shade'],
    edits: loopEdit(32, 41.2, 130.5, 91, FASTER + 'B minor up to C minor. '),
  },
];

export const AUDIO_CREDITS: AudioCredit[] = [...MUSIC_CREDITS, ...SFX_CREDITS];
