/** Display helpers for ranked modes. */
import { MIX_ID, getUniverse } from './data/characters';
import type { StringKey } from './i18n/strings';

type Translate = (key: StringKey, params?: Record<string, string | number>) => string;

/** "All mixed" or the universe's name. */
export function modeName(mode: string, t: Translate): string {
  return mode === MIX_ID ? t('mode.mix') : getUniverse(mode).name || mode;
}
