/**
 * Table primitives.
 *
 * A small, presentational table system: it renders structure and alignment and
 * nothing else. Sorting, pagination and row actions belong to the feature that
 * uses it (see components/EmailTable.tsx), which keeps this file reusable and
 * easy to reason about.
 *
 * Uses a real <table> rather than CSS grid: screen readers announce column
 * headers for each cell, which a div-based layout does not do without extra ARIA.
 */
import type { ReactNode } from 'react';

export interface Column<T> {
  /** Stable key, also used as the React key. */
  key: string;
  header: ReactNode;
  /** Renders one cell. */
  render: (row: T, index: number) => ReactNode;
  /** Tailwind classes for width/alignment, e.g. 'w-32 text-right'. */
  className?: string;
  /** Hidden below `md` — keeps the mobile view readable instead of scrolling sideways. */
  hideOnMobile?: boolean;
}

interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  /** Stable identity for React keys; defaults to a generated index. */
  rowKey: (row: T, index: number) => string;
  /** Optional per-row class hook (e.g. to tint failed rows). */
  rowClassName?: (row: T) => string;
  /** Extra content rendered as a full-width row beneath a row (expandable detail). */
  renderExpanded?: (row: T) => ReactNode | null;
  expandedKey?: string | null;
  caption?: string;
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  rowClassName,
  renderExpanded,
  expandedKey,
  caption,
}: TableProps<T>) {
  return (
    // overflow-x-auto + whitespace-nowrap keeps wide tables usable on narrow
    // screens without breaking the page layout.
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}

        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={[
                  'px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500',
                  column.hideOnMobile ? 'hidden md:table-cell' : '',
                  column.className ?? '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-100">
          {rows.map((row, index) => {
            const key = rowKey(row, index);
            const expanded = renderExpanded ? renderExpanded(row) : null;

            return (
              <RowGroup
                key={key}
                columns={columns}
                row={row}
                index={index}
                className={rowClassName?.(row) ?? ''}
                expanded={expanded}
                isExpanded={expandedKey === key}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface RowGroupProps<T> {
  columns: Column<T>[];
  row: T;
  index: number;
  className: string;
  expanded: ReactNode;
  isExpanded: boolean;
}

function RowGroup<T>({ columns, row, index, className, expanded, isExpanded }: RowGroupProps<T>) {
  return (
    <>
      <tr className={`transition-colors hover:bg-slate-50/70 ${className}`}>
        {columns.map((column) => (
          <td
            key={column.key}
            className={[
              'px-4 py-3 align-middle text-slate-700',
              column.hideOnMobile ? 'hidden md:table-cell' : '',
              column.className ?? '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {column.render(row, index)}
          </td>
        ))}
      </tr>

      {expanded ? (
        <tr className="bg-slate-50/60">
          <td colSpan={columns.length} className="px-4 py-3">
            {isExpanded ? expanded : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Pagination                                                                */
/* -------------------------------------------------------------------------- */

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onChange: (page: number) => void;
}

/**
 * Pagination footer. The range text ("Showing 21–40 of 137") is more useful than
 * page numbers alone, because it tells the user where they are in the whole set.
 */
export function Pagination({ page, totalPages, total, limit, onChange }: PaginationProps) {
  if (total === 0) return null;

  const first = (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
      <p className="text-xs text-slate-500">
        Showing <span className="font-medium text-slate-700">{first}</span>–
        <span className="font-medium text-slate-700">{last}</span> of{' '}
        <span className="font-medium text-slate-700">{total}</span>
      </p>

      <div className="flex items-center gap-2">
        <PaginationButton disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Previous
        </PaginationButton>
        <span className="text-xs text-slate-500">
          Page {page} of {totalPages}
        </span>
        <PaginationButton disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          Next
        </PaginationButton>
      </div>
    </div>
  );
}

function PaginationButton({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
    >
      {children}
    </button>
  );
}
