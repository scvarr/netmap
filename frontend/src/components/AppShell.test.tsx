import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider, localeStorageKey } from '../i18n';
import { AppShell } from './AppShell';

vi.mock('./HealthIndicator', () => ({ HealthIndicator: () => <span>health</span> }));

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe('AppShell locale switch', () => {
  it('uses an accessible RU / EN text toggle that switches at runtime and persists the choice', async () => {
    render(<I18nProvider><MemoryRouter initialEntries={['/map']}><Routes><Route element={<AppShell />}><Route path="/map" element={<main>Map</main>} /></Route></Routes></MemoryRouter></I18nProvider>);

    expect(screen.getByRole('group', { name: 'Язык' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Язык: Русский' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Язык: English' })).toHaveTextContent('EN');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Язык: English' }));
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Language: English' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem(localeStorageKey)).toBe('en');
  });
});
