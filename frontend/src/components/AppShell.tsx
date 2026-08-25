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
          </div>
        </nav>
        <label className="sidebar__locale">{t('language.label')}<select value={locale} onChange={(event) => setLocale(event.target.value as typeof locale)} aria-label={t('language.label')}><option value="ru">{t('language.ru')}</option><option value="en">{t('language.en')}</option></select></label>
        <div className="sidebar__health"><HealthIndicator /></div>
      </aside>
      <div className="route-content"><Outlet /></div>
    </div>
  );
}
