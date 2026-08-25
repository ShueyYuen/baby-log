import { afterEach, describe, expect, it, vi } from 'vitest';
import { addFeedingReminderToCalendar, addPlanToCalendar } from './calendar';

function captureDownload() {
  let blob: Blob | undefined;
  const click = vi.fn();
  vi.spyOn(URL, 'createObjectURL').mockImplementation((obj) => {
    blob = obj as Blob;
    return 'blob:test';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'a') {
      return { href: '', download: '', click, style: {} } as unknown as HTMLAnchorElement;
    }
    return document.createElementNS('http://www.w3.org/1999/xhtml', tag);
  });
  vi.spyOn(document.body, 'appendChild').mockImplementation((n) => n);
  vi.spyOn(document.body, 'removeChild').mockImplementation((n) => n);
  return {
    click,
    ics: async () => {
      if (!blob) throw new Error('no blob captured');
      return blob.text();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('calendar ICS export', () => {
  it('downloads a plan as an iCalendar event with an alarm', async () => {
    const cap = captureDownload();
    addPlanToCalendar('疫苗接种', '2026-09-01T09:00:00.000Z', '乙肝', 30);
    expect(cap.click).toHaveBeenCalled();
    const ics = await cap.ics();
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('SUMMARY:疫苗接种');
    expect(ics).toContain('DESCRIPTION:乙肝');
    expect(ics).toContain('BEGIN:VALARM');
    expect(ics).toContain('TRIGGER:-PT30M');
  });

  it('falls back to ICS when the Android alarm intent is unavailable', async () => {
    const cap = captureDownload();
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0)',
    });
    addFeedingReminderToCalendar(45);
    const ics = await cap.ics();
    expect(ics).toContain('宝宝喂奶时间到');
    expect(ics).toContain('TRIGGER:PT0S');
  });

  it('opens an Android alarm intent when the user agent matches', () => {
    const click = vi.fn();
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Linux; Android 14)',
    });
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        return { href: '', download: '', click, style: {}, appendChild: () => {} } as unknown as HTMLAnchorElement;
      }
      return document.createElementNS('http://www.w3.org/1999/xhtml', tag);
    });
    vi.spyOn(document.body, 'appendChild').mockImplementation((n) => n);
    vi.spyOn(document.body, 'removeChild').mockImplementation((n) => n);
    addFeedingReminderToCalendar(15);
    expect(click).toHaveBeenCalled();
  });
});
