import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

export interface Crumb {
  label: string;
  to?: string;
}

/**
 * The page-title row that opens every page inside TeacherLayout: title (and
 * optional one-line subtitle) on the left, breadcrumb + page actions on the
 * right. Flat by design — no card, no shadow; it sits on the canvas.
 */
export function PageTitle({
  title,
  subtitle,
  breadcrumbs,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 pb-6">
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold text-foreground">{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb">
            <ol className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {breadcrumbs.map((crumb, i) => {
                const last = i === breadcrumbs.length - 1;
                return (
                  <Fragment key={`${crumb.label}-${i}`}>
                    <li>
                      {crumb.to && !last ? (
                        <Link to={crumb.to} className="transition-colors hover:text-brand">
                          {crumb.label}
                        </Link>
                      ) : (
                        <span className={last ? 'font-medium text-foreground' : undefined} aria-current={last ? 'page' : undefined}>
                          {crumb.label}
                        </span>
                      )}
                    </li>
                    {!last && (
                      <li aria-hidden>
                        <ChevronRight className="h-3 w-3" />
                      </li>
                    )}
                  </Fragment>
                );
              })}
            </ol>
          </nav>
        )}
        {actions}
      </div>
    </div>
  );
}
