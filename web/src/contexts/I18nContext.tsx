import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { LOCALES, LOCALE_STORAGE_KEY, type Locale, type TranslateFn } from '../i18n/types';
import { createTranslator } from '../i18n/translate';

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TranslateFn;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const fallback: I18nContextValue = {
  locale: 'zh',
  setLocale: () => {},
  t: createTranslator('zh'),
};

function isLocale(value: string | null): value is Locale {
  return value === 'zh' || value === 'en';
}

export function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'zh';
  const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
  if (isLocale(saved)) return saved;
  const lang = (navigator.language || '').toLowerCase();
  if (lang.startsWith('en')) return 'en';
  return 'zh';
}

function applyLocale(locale: Locale) {
  const meta = LOCALES.find((l) => l.value === locale) ?? LOCALES[0];
  document.documentElement.lang = meta.htmlLang;
  dayjs.locale(locale === 'zh' ? 'zh-cn' : 'en');
  const title = createTranslator(locale)('app.title');
  if (title) document.title = title;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => detectLocale());
  const t = useMemo(() => createTranslator(locale), [locale]);

  useEffect(() => {
    applyLocale(locale);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
  }, []);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext) ?? fallback;
}
