import type { ReactNode } from "react";
import type { Band, Grade, Status } from "../api";
import { BAND_LABEL, GRADE_LABEL, STATUS_LABEL, percent } from "../format";

/** Priority is always shown as a word plus the score, never as colour alone. */
export function PriorityBadge({ band, score }: { band: Band; score?: number }) {
  return (
    <span className={`badge priority-${band}`}>
      <span className="dot" aria-hidden="true" />
      {BAND_LABEL[band]}
      {score !== undefined && <span className="badge-score">{percent(score)}</span>}
    </span>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge status-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function GradeBadge({ grade }: { grade: Grade }) {
  return <span className={`badge grade-${grade}`}>{GRADE_LABEL[grade]}</span>;
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="muted">
        {from.toLocaleString("en-US")}–{to.toLocaleString("en-US")} of {total.toLocaleString("en-US")}
      </span>
      <div className="pagination-buttons">
        <button className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <span className="muted" aria-current="page">
          Page {page} of {pages}
        </span>
        <button className="btn" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </nav>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions}
    </header>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="state" role="status">
      {label}…
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div className="state state-error" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/** A horizontal bar for a 0-1 share, with the value written next to it. */
export function ShareBar({ value, label }: { value: number; label?: string }) {
  return (
    <span className="sharebar" title={label}>
      <span className="sharebar-track" aria-hidden="true">
        <span className="sharebar-fill" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
      </span>
      <span className="num">{percent(value)}</span>
    </span>
  );
}

/** Outcome mix as one stacked bar. Segments are also listed as text for screen readers. */
export function OutcomeBar({ tp, bp, fp }: { tp: number; bp: number; fp: number }) {
  const total = tp + bp + fp;
  if (total === 0) return <span className="muted">No graded incidents</span>;
  const parts: [Grade, number][] = [
    ["true_positive", tp],
    ["benign_positive", bp],
    ["false_positive", fp],
  ];
  const text = parts.map(([g, n]) => `${GRADE_LABEL[g]} ${percent(n / total)}`).join(", ");
  return (
    <span className="outcomebar" role="img" aria-label={text} title={text}>
      {parts.map(([g, n]) =>
        n > 0 ? <span key={g} className={`seg seg-${g}`} style={{ flexGrow: n }} /> : null,
      )}
    </span>
  );
}
