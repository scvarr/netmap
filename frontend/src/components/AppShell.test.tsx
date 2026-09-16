import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider, localeStorageKey } from '../i18n';
import { AppShell, sidebarCollapsedStorageKey } from './AppShell';

vi.mock('./HealthIndicator', () => ({ HealthIndicator: () => <span>health</span> }));

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

const renderShell = (initialEntry = '/map') => render(
  <I18nProvider>
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/map" element={<main>Map</main>} />
          <Route path="/infrastructure/objects" element={<main>Objects</main>} />
        </Route>
      </Routes>
    </MemoryRouter>
  </I18nProvider>
);

describe('AppShell locale switch', () => {
  it('uses an accessible RU / EN text toggle that switches at runtime and persists the choice', async () => {
    renderShell();

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

describe('AppShell sidebar collapse preference', () => {
  it('keeps map navigation expanded by default', () => {
    renderShell();

    expect(screen.getByText('NetMap')).toBeInTheDocument();
    expect(screen.getByText('Инфраструктура')).toBeInTheDocument();
    expect(screen.getByText('Карта')).toBeInTheDocument();
    expect(document.querySelector('.application-shell')).not.toHaveClass('application-shell--sidebar-collapsed');
  });

  it('collapses on user action, persists the choice, and exposes the expand action', async () => {
    renderShell();

    await userEvent.click(screen.getByRole('button', { name: 'Свернуть боковую панель' }));

    expect(document.querySelector('.application-shell')).toHaveClass('application-shell--sidebar-collapsed');
    expect(screen.getByRole('button', { name: 'Развернуть боковую панель' })).toBeInTheDocument();
    expect(localStorage.getItem(sidebarCollapsedStorageKey)).toBe('true');
  });

  it('restores the saved collapsed preference after remount', () => {
    localStorage.setItem(sidebarCollapsedStorageKey, 'true');
    const { unmount } = renderShell();
    unmount();
    renderShell();

    expect(document.querySelector('.application-shell')).toHaveClass('application-shell--sidebar-collapsed');
    expect(screen.getByRole('button', { name: 'Развернуть боковую панель' })).toBeInTheDocument();
  });

  it('keeps full navigation names and native tooltips when collapsed', async () => {
    renderShell();
    await userEvent.click(screen.getByRole('button', { name: 'Свернуть боковую панель' }));

    const mapLink = screen.getByRole('link', { name: 'Карта' });
    const objectsLink = screen.getByRole('link', { name: 'Объекты' });
    expect(mapLink).toHaveAttribute('title', 'Карта');
    expect(mapLink).toHaveAttribute('data-tooltip', 'Карта');
    expect(objectsLink).toHaveAttribute('title', 'Объекты');
    expect(objectsLink).toHaveAttribute('data-tooltip', 'Объекты');
  });

  it('does not change the sidebar preference when the route changes', async () => {
    renderShell();
    await userEvent.click(screen.getByRole('button', { name: 'Свернуть боковую панель' }));
    await userEvent.click(screen.getByRole('link', { name: 'Объекты' }));

    expect(screen.getByText('Objects')).toBeInTheDocument();
    expect(document.querySelector('.application-shell')).toHaveClass('application-shell--sidebar-collapsed');
  });
});
