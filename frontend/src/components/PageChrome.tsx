import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export interface BreadcrumbItem {
  label: ReactNode;
  to?: string;
}

export function PageShell({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <main className={`page-shell ${className}`.trim()}>{children}</main>;
}

export function Breadcrumbs({
  items,
  label,
}: {
  items: BreadcrumbItem[];
  label: string;
}) {
  return (
    <nav className="page-breadcrumbs" aria-label={label}>
      {items.map((item, index) => (
        <span className="page-breadcrumbs__item" key={index}>
          {item.to ? (
            <Link to={item.to}>{item.label}</Link>
          ) : (
            <span aria-current={index === items.length - 1 ? "page" : undefined}>{item.label}</span>
          )}
          {index < items.length - 1 && <span aria-hidden="true">/</span>}
        </span>
      ))}
    </nav>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  notice,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  notice?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        {eyebrow && <span className="page-header__eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && (
          <p className="page-header__description">{description}</p>
        )}
        {notice && <div className="page-header__notice">{notice}</div>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}
