import type { Locale, MessageTree, TranslateFn } from './types';
import { zh } from './locales/zh';
import { en } from './locales/en';

export const dictionaries: Record<Locale, MessageTree> = { zh, en };

export function getMessage(dict: MessageTree, key: string): string | undefined {
  const parts = key.split('.');
  let cur: string | MessageTree | undefined = dict;
  for (const part of parts) {
    if (cur == null || typeof cur === 'string') return undefined;
    cur = cur[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    params[name] == null ? `{${name}}` : String(params[name]),
  );
}

export function createTranslator(locale: Locale): TranslateFn {
  const dict = dictionaries[locale] ?? dictionaries.zh;
  const fallback = dictionaries.zh;
  return (key, params) => {
    const msg = getMessage(dict, key) ?? getMessage(fallback, key) ?? key;
    return interpolate(msg, params);
  };
}

export const tZh = createTranslator('zh');
export const tEn = createTranslator('en');

export function collectKeys(tree: MessageTree, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') keys.push(path);
    else keys.push(...collectKeys(v, path));
  }
  return keys;
}
