import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { HealthIndicator } from './HealthIndicator';
import { useI18n } from '../i18n';

export const sidebarCollapsedStorageKey = 'netmap.sidebar-collapsed';

const readStoredSidebarCollapsed = (): boolean => window.localStorage.getItem(sidebarCollapsedStorageKey) === 'true';

const navClassName = ({ isActive }: { isActive: boolean }) => (
  `shell-nav__link${isActive ? ' shell-nav__link--active' : ''}`
);

export function AppShell() {
  const { locale, setLocale, t } = useI18n();
  const { pathname } = useLocation();
  const mapMode = pathname === '/map';
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readStoredSidebarCollapsed);

  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [pathname]);

  useEffect(() => {
    window.localStorage.setItem(sidebarCollapsedStorageKey, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  return (
    <div className={`application-shell${mapMode ? ' application-shell--map' : ''}${sidebarCollapsed ? ' application-shell--sidebar-collapsed' : ''}`}>
      <aside className="sidebar" aria-label={t('nav.primary')}>
        <div className="sidebar__header">
          <NavLink className="sidebar__brand" to="/map" aria-label={`NetMap — ${t('nav.map')}`}>
            <span className="sidebar__brand-mark">N</span>
            <strong>NetMap</strong>
          </NavLink>
          <button
            type="button"
            className="sidebar__collapse-toggle"
            aria-label={t(sidebarCollapsed ? 'nav.sidebarExpand' : 'nav.sidebarCollapse')}
            title={t(sidebarCollapsed ? 'nav.sidebarExpand' : 'nav.sidebarCollapse')}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            {sidebarCollapsed ? '»' : '«'}
          </button>
        </div>
        <nav className="shell-nav">
          <NavLink className={navClassName} to="/map" title={t('nav.map')} data-tooltip={t('nav.map')}>
            <span className="shell-nav__icon" aria-hidden="true">◇</span>
            <span className="shell-nav__label">{t('nav.map')}</span>
          </NavLink>
          <div className="shell-nav__group">
            <span className="shell-nav__group-label">{t('nav.infrastructure')}</span>
            <NavLink className={navClassName} to="/infrastructure/objects" title={t('nav.objects')} data-tooltip={t('nav.objects')}>
              <span className="shell-nav__icon" aria-hidden="true">▦</span>
              <span className="shell-nav__label">{t('nav.objects')}</span>
            </NavLink>
            <NavLink className={navClassName} to="/infrastructure/locations" title={t('nav.locations')} data-tooltip={t('nav.locations')}>
              <span className="shell-nav__icon" aria-hidden="true">⌖</span>
              <span className="shell-nav__label">{t('nav.locations')}</span>
            </NavLink>
            <NavLink className={navClassName} to="/infrastructure/cable-label-templates" title={t('cableTemplates.title')} data-tooltip={t('cableTemplates.title')}><span className="shell-nav__icon" aria-hidden="true">⌁</span><span className="shell-nav__label">{t('cableTemplates.title')}</span></NavLink>
          </div>
          <div className="shell-nav__group">
            <span className="shell-nav__group-label">{t('nav.library')}</span>
            <NavLink className={navClassName} to="/library/object-blueprints" title={t('nav.blueprints')} data-tooltip={t('nav.blueprints')}>
              <span className="shell-nav__icon" aria-hidden="true">▤</span>
              <span className="shell-nav__label">{t('nav.blueprints')}</span>
            </NavLink>
            <NavLink className={navClassName} to="/library/port-blocks" title={t('nav.portBlocks')} data-tooltip={t('nav.portBlocks')}>
              <span className="shell-nav__icon" aria-hidden="true">▥</span>
              <span className="shell-nav__label">{t('nav.portBlocks')}</span>
            </NavLink>
          </div>
        </nav>
        <div className="sidebar__health"><HealthIndicator /></div>
      </aside>
      <div className="shell-locale" role="group" aria-label={t('language.label')}>
        <button type="button" className={`shell-locale__option${locale === 'ru' ? ' shell-locale__option--active' : ''}`} aria-label={`${t('language.label')}: ${t('language.ru')}`} aria-pressed={locale === 'ru'} onClick={() => setLocale('ru')}>RU</button>
        <span className="shell-locale__divider" aria-hidden="true">/</span>
        <button type="button" className={`shell-locale__option${locale === 'en' ? ' shell-locale__option--active' : ''}`} aria-label={`${t('language.label')}: ${t('language.en')}`} aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>EN</button>
      </div>
      <div className="route-content"><Outlet /></div>
    </div>
  );
}
