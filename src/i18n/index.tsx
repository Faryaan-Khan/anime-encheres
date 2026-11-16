import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { readStored, writeStored } from '../storage';
import { STRINGS, formatMoney, type Lang, type StringKey } from './strings';

interface I18n {
  lang: Lang;
  setLang(lang: Lang): void;
  t(key: StringKey, params?: Record<string, string | number>): string;
  money(millions: number): string;
}

const I18nContext = createContext<I18n | null>(null);

function initialLang(): Lang {
  const stored = readStored('ae.lang');
  if (stored === 'fr' || stored === 'en') return stored;
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('fr')
    ? 'fr'
    : 'en';
}

export function translate(
  lang: Lang,
  key: StringKey,
  params?: Record<string, string | number>,
): string {
  const template = STRINGS[lang][key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    writeStored('ae.lang', next);
  }, []);

  const value = useMemo<I18n>(
    () => ({
      lang,
      setLang,
      t: (key, params) => translate(lang, key, params),
      money: (millions) => formatMoney(millions, lang),
    }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
