const DEFAULTS_KEY = 'recordDefaults';
const RECENT_NAMES_KEY = 'recordRecentNames';

export interface RecordDefaults {
  bottle?: { milkType: 'breast_milk' | 'formula'; amountMl: number };
  breastfeed?: { leftMinutes: number; rightMinutes: number };
  water?: { amountMl: number };
  pump?: { amountMl: number; side: 'left' | 'right' | 'both'; durationMinutes: number; storage: 'fridge' | 'freezer' | 'direct_feed' };
  temperature?: { location: 'axillary' | 'ear' | 'forehead' | 'rectal' };
  supplement?: { name: string };
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function getRecordDefaults(): RecordDefaults {
  return readJson<RecordDefaults>(DEFAULTS_KEY, {});
}

export function patchRecordDefaults(patch: Partial<RecordDefaults>) {
  const next = { ...getRecordDefaults(), ...patch };
  localStorage.setItem(DEFAULTS_KEY, JSON.stringify(next));
}

export function rememberName(kind: 'solid' | 'supplement', name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const all = readJson<Record<string, string[]>>(RECENT_NAMES_KEY, {});
  const prev = all[kind] || [];
  all[kind] = [trimmed, ...prev.filter((n) => n !== trimmed)].slice(0, 8);
  localStorage.setItem(RECENT_NAMES_KEY, JSON.stringify(all));
}

export function getRecentNames(kind: 'solid' | 'supplement'): string[] {
  return readJson<Record<string, string[]>>(RECENT_NAMES_KEY, {})[kind] || [];
}
