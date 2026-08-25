import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it } from 'vitest';
import { I18nProvider, localeStorageKey, readStoredLocale, useI18n } from './i18n';

function Probe() {
  const { locale, setLocale, t } = useI18n();
  return <><span data-testid="locale">{locale}</span><span>{t('nav.map')}</span><button onClick={() => setLocale(locale === 'ru' ? 'en' : 'ru')}>switch</button></>;
}

beforeEach(() => localStorage.clear());
it('defaults to Russian and synchronizes document language', () => { render(<I18nProvider><Probe /></I18nProvider>); expect(screen.getByTestId('locale')).toHaveTextContent('ru'); expect(screen.getByText('Карта')).toBeInTheDocument(); expect(document.documentElement.lang).toBe('ru'); });
it('switches at runtime and persists the selected locale', async () => { const user = userEvent.setup(); render(<I18nProvider><Probe /></I18nProvider>); await user.click(screen.getByRole('button', { name: 'switch' })); expect(screen.getByText('Map')).toBeInTheDocument(); expect(localStorage.getItem(localeStorageKey)).toBe('en'); expect(document.documentElement.lang).toBe('en'); });
it('falls back from an invalid stored locale', () => { localStorage.setItem(localeStorageKey, 'invalid'); expect(readStoredLocale()).toBe('ru'); });
