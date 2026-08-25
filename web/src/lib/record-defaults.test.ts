import { beforeEach, describe, expect, it } from 'vitest';
import {
  getRecentNames,
  getRecordDefaults,
  patchRecordDefaults,
  rememberName,
} from './record-defaults';

describe('record defaults', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts empty and merges patches', () => {
    expect(getRecordDefaults()).toEqual({});
    patchRecordDefaults({ bottle: { milkType: 'formula', amountMl: 120 } });
    patchRecordDefaults({ water: { amountMl: 40 } });
    expect(getRecordDefaults()).toEqual({
      bottle: { milkType: 'formula', amountMl: 120 },
      water: { amountMl: 40 },
    });
  });

  it('remembers names per kind and ignores blanks', () => {
    rememberName('solid', '  ');
    rememberName('solid', '米粉');
    rememberName('solid', '南瓜泥');
    rememberName('solid', '米粉');
    rememberName('supplement', '维生素D');
    expect(getRecentNames('solid')).toEqual(['米粉', '南瓜泥']);
    expect(getRecentNames('supplement')).toEqual(['维生素D']);
  });

  it('falls back when stored JSON is invalid', () => {
    localStorage.setItem('recordDefaults', '{not-json');
    expect(getRecordDefaults()).toEqual({});
  });
});
