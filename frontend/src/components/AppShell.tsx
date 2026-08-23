import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { HealthIndicator } from './HealthIndicator';

const navClassName = ({ isActive }: { isActive: boolean }) => (
  `shell-nav__link${isActive ? ' shell-nav__link--active' : ''}`
);

export function AppShell() {
  const { pathname } = useLocation();
  const mapMode = pathname === '/map';

  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [pathname]);

  return (
    <div className={`application-shell${mapMode ? ' application-shell--map' : ''}`}>
      <aside className="sidebar" aria-label="Основная навигация">
        <NavLink className="sidebar__brand" to="/map" aria-label="NetMap — карта">
          <span className="sidebar__brand-mark">N</span>
          <strong>NetMap</strong>
        </NavLink>
        <nav className="shell-nav">
          <NavLink className={navClassName} to="/map">
            <span className="shell-nav__icon" aria-hidden="true">◇</span>
            <span className="shell-nav__label">Карта</span>
          </NavLink>
          <div className="shell-nav__group">
            <span className="shell-nav__group-label">Инфраструктура</span>
            <NavLink className={navClassName} to="/infrastructure/objects">
              <span className="shell-nav__icon" aria-hidden="true">▦</span>
              <span className="shell-nav__label">Объекты</span>
            </NavLink>
          </div>
        </nav>
        <div className="sidebar__health"><HealthIndicator /></div>
      </aside>
      <div className="route-content"><Outlet /></div>
    </div>
  );
}
