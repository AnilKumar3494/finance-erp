// Shared helpers for infinite (scroll) lists backed by the standard paginated
// list envelope every list endpoint returns: { total, page, page_size, results }.

export interface PagedResponse<T> {
  total: number
  page: number
  page_size: number
  results: T[]
}

// `getNextPageParam` for `useInfiniteQuery`: the next page number while unloaded
// rows remain, otherwise undefined so React Query knows the list is exhausted.
export function nextPageParam(lastPage: {
  total: number
  page: number
  page_size: number
}): number | undefined {
  return lastPage.page * lastPage.page_size < lastPage.total ? lastPage.page + 1 : undefined
}
