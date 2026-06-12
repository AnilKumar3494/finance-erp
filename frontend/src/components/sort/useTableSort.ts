import { useMemo } from 'react'

// Shared sort primitives used by every sortable table in the app. Server-side
// tables (loans, customers, reports, worklist) carry sort_by/sort_order in the
// URL/state and let the backend order; fully-loaded tables sort their rows in
// the browser via useClientSort. Both share the header-click semantics in
// toggleSort so the UX is identical everywhere.

export type SortOrder = 'asc' | 'desc'

export interface SortState<F extends string = string> {
  sort_by: F
  sort_order: SortOrder
}

// Header-click behaviour, matching the original loans/customers tables:
// clicking the already-active column flips direction; clicking a different
// column applies that column's natural default direction.
export function toggleSort<F extends string>(
  current: SortState<F>,
  field: F,
  defaultDir: SortOrder,
): SortState<F> {
  if (current.sort_by === field) {
    return { sort_by: field, sort_order: current.sort_order === 'asc' ? 'desc' : 'asc' }
  }
  return { sort_by: field, sort_order: defaultDir }
}

type Accessor<T> = (row: T) => string | number | null | undefined

// Compare two cell values. Blank/null always sort LAST regardless of
// direction; numbers compare numerically, everything else case-insensitively.
function compareCells(a: ReturnType<Accessor<unknown>>, b: ReturnType<Accessor<unknown>>, dir: 1 | -1): number {
  const aEmpty = a == null || a === ''
  const bEmpty = b == null || b === ''
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1
  if (bEmpty) return -1
  let base: number
  if (typeof a === 'number' && typeof b === 'number') {
    base = a - b
  } else {
    base = String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
  }
  return base * dir
}

// Returns a sorted COPY of rows for a fully-loaded (client-side) table.
// `accessors` maps each sortable field to a value getter; a field with no
// accessor leaves the rows unsorted. The sort is stable (ties keep their
// original order).
export function useClientSort<T, F extends string>(
  rows: readonly T[],
  sort_by: F,
  sort_order: SortOrder,
  accessors: Partial<Record<F, Accessor<T>>>,
): T[] {
  return useMemo(() => {
    const get = accessors[sort_by] as Accessor<T> | undefined
    if (!get) return [...rows]
    const dir: 1 | -1 = sort_order === 'asc' ? 1 : -1
    return rows
      .map((row, i) => [row, i] as const)
      .sort(([a, ai], [b, bi]) => {
        const c = compareCells(get(a), get(b), dir)
        return c !== 0 ? c : ai - bi
      })
      .map(([row]) => row)
  }, [rows, sort_by, sort_order, accessors])
}
