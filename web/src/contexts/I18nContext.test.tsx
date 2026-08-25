import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { I18nProvider, useI18n } from './I18nContext';
import { LOCALE_STORAGE_KEY } from '../i18n/types';

function Probe() {
  const { locale, t, setLocale } = useI18n();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="nav">{t('nav.records')}</span>
      <button onClick={() => setLocale('en')}>en</button>
      <button onClick={() => setLocale('zh')}>zh</button>
    </div>
  );
}

describe('I18nProvider', () => {
  it('defaults to zh in tests and persists locale changes', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('locale').textContent).toBe('zh');
    expect(screen.getByTestId('nav').textContent).toBe('记录');

    await user.click(screen.getByText('en'));
    expect(screen.getByTestId('locale').textContent).toBe('en');
    expect(screen.getByTestId('nav').textContent).toBe('Log');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    expect(document.documentElement.lang).toBe('en');

    await user.click(screen.getByText('zh'));
    expect(screen.getByTestId('nav').textContent).toBe('记录');
    expect(document.documentElement.lang).toBe('zh-CN');
  });
});
