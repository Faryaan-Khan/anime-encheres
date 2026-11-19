/** Display helpers for ranked modes. */
import { MIX_ID, getUniverse } from './data/characters';
import type { StringKey } from './i18n/strings';

type Translate = (key: StringKey, params?: Record<string, string | number>) => string;

/** "All mixed", the universe's name, "1v1v1", or for a 1v1v1 queue "1v1v1 · Naruto". */
export function modeName(mode: string, t: Translate): string {
  if (mode === 'trio') return t('mode.trio');
  if (mode.startsWith('trio:')) return `${t('mode.trio')} · ${modeName(mode.slice(5), t)}`;
  return mode === MIX_ID ? t('mode.mix') : getUniverse(mode).name || mode;
}
