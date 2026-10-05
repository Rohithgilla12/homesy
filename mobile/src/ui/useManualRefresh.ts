import { useCallback, useState } from 'react';

/**
 * Pull-to-refresh state that only reflects a pull. TanStack's `isRefetching` also flips on every
 * background refetch (SSE invalidation, mutation settle), which would show the spinner and push
 * the content down each time something changes.
 */
export function useManualRefresh(refetch: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await refetch(); } finally { setRefreshing(false); }
  }, [refetch]);
  return { refreshing, onRefresh };
}
