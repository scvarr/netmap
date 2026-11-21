import { useEffect, useRef, useState } from 'react';
import { matchPath, NavLink, Outlet, useLocation } from 'react-router-dom';
import { HealthIndicator } from './HealthIndicator';
import { useI18n } from '../i18n';

export const sidebarCollapsedStorageKey = 'netmap.sidebar-collapsed';

const groups = [
  { id: 'infrastructure', label: 'nav.infrastructure', icon: '▦', links: [
    ['/infrastructure/objects', 'nav.objects', '▦'],
    ['/infrastructure/locations', 'nav.locations', '⌖'],
    ['/infrastructure/cable-label-templates', 'cableTemplates.title', '⌁'],
  ] },
  { id: 'library', label: 'nav.library', icon: '▤', links: [
    ['/library/base-templates', 'nav.blueprints', '▤'],
  ] },
  { id: 'catalogs', label: 'portTypes.section', icon: '▣', links: [
    ['/catalogs/port-types', 'portTypes.title', '▣'],
    ['/catalogs/connector-types', 'physicalCatalog.connectorTypes', '◇'],
    ['/catalogs/cable-types', 'physicalCatalog.cableTypes', '∿'],
  ] },
  { id: 'settings', label: 'workspace.section', icon: '⚙', links: [
    ['/settings/data', 'workspace.title', '⚙'],
  ] },
] as const;

type GroupId = typeof groups[number]['id'];

const collapsedGroupsStorageKey = 'netmap.sidebar-collapsed-groups';
const compactMediaQuery = '(max-width: 760px)';

function readCollapsedGroups(): GroupId[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(collapsedGroupsStorageKey) ?? '[]');
    return Array.isArray(stored) ? groups.map(({ id }) => id).filter((id) => stored.includes(id)) : [];
  } catch {
    return [];
  }
}

const readStoredSidebarCollapsed = (): boolean => window.localStorage.getItem(sidebarCollapsedStorageKey) === 'true';

const navClassName = ({ isActive }: { isActive: boolean }) => (
  `shell-nav__link${isActive ? ' shell-nav__link--active' : ''}`
);

export function AppShell() {
  const { locale, setLocale, t } = useI18n();
  const { pathname, key: locationKey } = useLocation();
  const mapMode = pathname === '/map';
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readStoredSidebarCollapsed);

  const [narrow, setNarrow] = useState(() => window.matchMedia?.(compactMediaQuery).matches ?? false);
  const compact = sidebarCollapsed || narrow;
  const [collapsedGroups, setCollapsedGroups] = useState(readCollapsedGroups);
  const [popup, setPopup] = useState<{ id: GroupId; locationKey: string } | null>(null);
  const openPopup = compact && popup?.locationKey === locationKey ? popup.id : null;
  const popupGroup = useRef<HTMLDivElement>(null);
  const activeGroup = groups.find(({ id }) => matchPath({ path: `/${id}`, end: false }, pathname))?.id;

  useEffect(() => {
    const media = window.matchMedia?.(compactMediaQuery);
    if (!media) return;
    const sync = () => {
      setNarrow(media.matches);
      setPopup(null);
    };
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (activeGroup) {
      setCollapsedGroups((current) => current.includes(activeGroup)
        ? current.filter((id) => id !== activeGroup)
        : current);
    }
  }, [pathname, activeGroup]);

  useEffect(() => {
    localStorage.setItem(collapsedGroupsStorageKey, JSON.stringify(collapsedGroups));
  }, [collapsedGroups]);

  useEffect(() => {
    setPopup(null);
  }, [locationKey]);

  useEffect(() => {
    if (!openPopup) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!popupGroup.current?.contains(event.target as Node)) setPopup(null);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      popupGroup.current?.querySelector('button')?.focus();
      setPopup(null);
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissOnEscape, true);
    };
  }, [openPopup]);

  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [pathname]);

  useEffect(() => {
    window.localStorage.setItem(sidebarCollapsedStorageKey, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  return (
    <div className={`application-shell${mapMode ? ' application-shell--map' : ''}${compact ? ' application-shell--sidebar-collapsed' : ''}`}>
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
            hidden={narrow}
            onClick={() => {
              setPopup(null);
              setSidebarCollapsed((collapsed) => !collapsed);
            }}
          >
            {sidebarCollapsed ? '»' : '«'}
          </button>
        </div>
        <nav className="shell-nav">
          <NavLink className={navClassName} to="/map" title={t('nav.map')} data-tooltip={t('nav.map')}>
            <span className="shell-nav__icon" aria-hidden="true">◇</span>
            <span className="shell-nav__label">{t('nav.map')}</span>
          </NavLink>
          {groups.map(({ id, label, icon, links }) => {
            const expanded = compact ? openPopup === id : !collapsedGroups.includes(id);
            const panelId = `shell-nav-${id}`;
            return (
              <div className="shell-nav__group" key={id} ref={openPopup === id ? popupGroup : undefined}>
                <button
                  type="button"
                  className={`shell-nav__link shell-nav__group-toggle${activeGroup === id ? ' shell-nav__link--active' : ''}`}
                  aria-label={t(label)}
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  title={compact ? t(label) : undefined}
                  onClick={() => {
                    if (compact) {
                      setPopup(expanded ? null : { id, locationKey });
                    } else {
                      setCollapsedGroups((current) => expanded
                        ? [...current, id]
                        : current.filter((groupId) => groupId !== id));
                    }
                  }}
                >
                  <span className="shell-nav__icon shell-nav__group-icon" aria-hidden="true">{icon}</span>
                  <span className="shell-nav__group-label">{t(label)}</span>
                  <span className="shell-nav__chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                </button>
                <div id={panelId} className="shell-nav__children" hidden={!expanded}>
                  {links.map(([path, linkLabel, linkIcon]) => (
                    <NavLink
                      key={path}
                      className={navClassName}
                      to={path}
                      title={t(linkLabel)}
                      onClick={() => setPopup(null)}
                    >
                      <span className="shell-nav__icon" aria-hidden="true">{linkIcon}</span>
                      <span className="shell-nav__label">{t(linkLabel)}</span>
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
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
