import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { HealthIndicator } from './HealthIndicator';
import { useI18n } from '../i18n';

const navClassName = ({ isActive }: { isActive: boolean }) => (
  `shell-nav__link${isActive ? ' shell-nav__link--active' : ''}`
);

export function AppShell() {
  const { locale, setLocale, t } = useI18n();
  const { pathname } = useLocation();
  const mapMode = pathname === '/map';

  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [pathname]);

  return (
    <div className={`application-shell${mapMode ? ' application-shell--map' : ''}`}>
      <aside className="sidebar" aria-label={t('nav.primary')}>
        <NavLink className="sidebar__brand" to="/map" aria-label={`NetMap — ${t('nav.map')}`}>
          <span className="sidebar__brand-mark">N</span>
          <strong>NetMap</strong>
        </NavLink>
        <nav className="shell-nav">
          <NavLink className={navClassName} to="/map">
            <span className="shell-nav__icon" aria-hidden="true">◇</span>
            <span className="shell-nav__label">{t('nav.map')}</span>
          </NavLink>
          <div className="shell-nav__group">
            <span className="shell-nav__group-label">{t('nav.infrastructure')}</span>
            <NavLink className={navClassName} to="/infrastructure/objects">
              <span className="shell-nav__icon" aria-hidden="true">▦</span>
              <span className="shell-nav__label">{t('nav.objects')}</span>
            </NavLink>
          </div>
          <div className="shell-nav__group">
            <span className="shell-nav__group-label">{t('nav.library')}</span>
            <NavLink className={navClassName} to="/library/object-blueprints">
              <span className="shell-nav__icon" aria-hidden="true">▤</span>
              <span className="shell-nav__label">{t('nav.blueprints')}</span>
            </NavLink>
            <NavLink className={navClassName} to="/library/port-blocks">
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
