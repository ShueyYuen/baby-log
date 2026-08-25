export type Locale = 'zh' | 'en';

export type MessageTree = { [key: string]: string | MessageTree };

export type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

export const LOCALES: { value: Locale; nativeLabel: string; htmlLang: string }[] = [
  { value: 'zh', nativeLabel: '中文', htmlLang: 'zh-CN' },
  { value: 'en', nativeLabel: 'English', htmlLang: 'en' },
];

export const LOCALE_STORAGE_KEY = 'locale';
