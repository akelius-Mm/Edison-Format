// Thin adapter over the graphics modules owned by the duel-screen agent (card renderer,
// sleeves, playmats, avatars), plus a few shell-specific helpers built on them.
import type { CardData } from '../../engine/card';
import { renderCard as renderCardImpl } from '../cards/render';
import { AVATAR_IDS, renderAvatar as renderAvatarImpl } from '../theme/avatars';
import { PLAYMATS as PLAYMAT_LIST, applyPlaymat as applyPlaymatImpl } from '../theme/playmats';
import { SLEEVES as SLEEVE_LIST, applySleeve as applySleeveImpl } from '../theme/sleeves';

export type CardSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export interface RenderCardOpts {
  size?: CardSize;
  faceDown?: boolean;
  sleeve?: string;
  showLimit?: boolean;
}
export interface ThemeItem {
  id: string;
  name: string;
  description?: string;
}

export function renderCard(data: CardData, opts: RenderCardOpts = {}): HTMLElement {
  try {
    return renderCardImpl(data, opts);
  } catch (e) {
    console.error('renderCard failed', e);
    const el = document.createElement('div');
    el.className = `yc yc--${opts.size ?? 'md'} card-error`;
    el.textContent = data.name;
    return el;
  }
}

export const SLEEVES: ThemeItem[] = SLEEVE_LIST;
export const applySleeve = applySleeveImpl;
export const PLAYMATS: ThemeItem[] = PLAYMAT_LIST;
export const applyPlaymat = applyPlaymatImpl;
export const renderAvatar = renderAvatarImpl;

/** Preset avatar ids ('avatar-1' … 'avatar-12'). */
export const AVATAR_PRESETS: string[] = AVATAR_IDS.length ? AVATAR_IDS : Array.from({ length: 12 }, (_, i) => `avatar-${i + 1}`);

const DUMMY = { id: 'sleeve-preview', name: 'Sleeve', kind: 'spell', text: '' } as CardData;

/** A face-down card showing a sleeve. */
export function sleevePreview(id: string, size: CardSize = 'md'): HTMLElement {
  return renderCard(DUMMY, { size, faceDown: true, sleeve: id });
}
