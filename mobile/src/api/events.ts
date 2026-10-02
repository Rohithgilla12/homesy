import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useSession } from '@/store/session';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080';

/** Data of one SSE event: the backend payload object with `type` and `resource` set to the event name. */
export type HomeEventData = {
  type?: string;
  resource?: string;
  list_id?: string;
};

/**
 * SSE hook that connects to GET /homes/{homeId}/events.
 * Listens for household change events and invalidates TanStack Query caches:
 * - lists: ['lists', homeId]
 * - items: ['items'] and ['items', listId]
 * - vault: ['vault', homeId]
 * - members/home: ['home', homeId] and ['homes']
 * - bulletin, activity, bills: ['bulletin' | 'activity' | 'bills', homeId]
 */
export function useHomeEvents(homeId: string | null) {
  const qc = useQueryClient();
  const token = useSession((s) => s.token);
  const signOut = useSession((s) => s.signOut);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelayRef = useRef(2000);

  useEffect(() => {
    if (!homeId || !token) return;

    let aborted = false;
    let xhr: XMLHttpRequest | null = null;

    const handleEventData = (eventType: string, dataRaw: string) => {
      let parsedData: HomeEventData | null = null;
      try {
        const parsed: unknown = JSON.parse(dataRaw);
        if (parsed && typeof parsed === 'object') parsedData = parsed as HomeEventData;
      } catch {
        // Non-JSON data: fall back to the SSE event name below
      }

      // Targeted cache invalidation based on event payload or type if present
      const resource = parsedData?.resource || parsedData?.type || eventType;

      if (!resource || resource === 'message' || resource === 'all') {
        // Broad invalidation
        qc.invalidateQueries({ queryKey: ['lists', homeId] });
        qc.invalidateQueries({ queryKey: ['items'] });
        qc.invalidateQueries({ queryKey: ['vault', homeId] });
        qc.invalidateQueries({ queryKey: ['home', homeId] });
        qc.invalidateQueries({ queryKey: ['homes'] });
        qc.invalidateQueries({ queryKey: ['bulletin', homeId] });
        qc.invalidateQueries({ queryKey: ['activity', homeId] });
        qc.invalidateQueries({ queryKey: ['bills', homeId] });
        return;
      }

      if (resource.includes('list') || resource === 'lists' || resource === 'items_cleared') {
        qc.invalidateQueries({ queryKey: ['lists', homeId] });
        qc.invalidateQueries({ queryKey: ['items'] });
      }
      if (resource.includes('item') || resource === 'items') {
        if (parsedData?.list_id) {
          qc.invalidateQueries({ queryKey: ['items', parsedData.list_id] });
        } else {
          qc.invalidateQueries({ queryKey: ['items'] });
        }
        qc.invalidateQueries({ queryKey: ['lists', homeId] });
      }
      if (resource.includes('vault') || resource === 'vault') {
        qc.invalidateQueries({ queryKey: ['vault', homeId] });
      }
      if (resource.includes('member') || resource.includes('home') || resource === 'members') {
        qc.invalidateQueries({ queryKey: ['home', homeId] });
        qc.invalidateQueries({ queryKey: ['homes'] });
      }
      if (resource.includes('bulletin') || resource.includes('notice')) {
        qc.invalidateQueries({ queryKey: ['bulletin', homeId] });
      }
      if (resource.includes('activity')) {
        qc.invalidateQueries({ queryKey: ['activity', homeId] });
      }
      if (resource.includes('bill')) {
        qc.invalidateQueries({ queryKey: ['bills', homeId] });
      }
    };

    const connect = () => {
      if (aborted) return;

      try {
        xhr = new XMLHttpRequest();
        const url = `${BASE}/homes/${homeId}/events`;
        xhr.open('GET', url, true);
        xhr.setRequestHeader('Accept', 'text/event-stream');
        xhr.setRequestHeader('Cache-Control', 'no-cache');
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);

        let processedLength = 0;
        let eventType = 'message';

        xhr.onreadystatechange = () => {
          if (aborted) return;

          if (xhr && (xhr.readyState === 3 || xhr.readyState === 4)) {
            if (xhr.status === 401) {
              signOut();
              return;
            }

            if (xhr.status === 404) {
              // Endpoint not found on backend yet; back off to 30s
              retryDelayRef.current = 30000;
            } else if (xhr.status >= 200 && xhr.status < 300) {
              // Successfully connected, reset backoff
              retryDelayRef.current = 2000;
            }

            const responseText = xhr.responseText || '';
            const newChunk = responseText.substring(processedLength);
            processedLength = responseText.length;

            if (newChunk) {
              const lines = newChunk.split(/\r?\n/);
              for (const line of lines) {
                if (line.startsWith('event:')) {
                  eventType = line.replace('event:', '').trim();
                } else if (line.startsWith('data:')) {
                  const dataRaw = line.replace('data:', '').trim();
                  if (dataRaw) {
                    handleEventData(eventType, dataRaw);
                  }
                  eventType = 'message';
                }
              }
            }
          }

          if (xhr && xhr.readyState === 4 && !aborted) {
            // Connection closed, schedule reconnect
            scheduleReconnect();
          }
        };

        xhr.onerror = () => {
          if (!aborted) {
            scheduleReconnect();
          }
        };

        xhr.send();
      } catch (err) {
        if (!aborted) {
          scheduleReconnect();
        }
      }
    };

    const scheduleReconnect = () => {
      if (aborted) return;
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      const delay = retryDelayRef.current;
      retryDelayRef.current = Math.min(retryDelayRef.current * 1.5, 30000);
      retryTimeoutRef.current = setTimeout(() => {
        if (!aborted) connect();
      }, delay);
    };

    connect();

    return () => {
      aborted = true;
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      if (xhr) {
        try {
          xhr.abort();
        } catch {
          // ignore abort error
        }
        xhr = null;
      }
    };
  }, [homeId, token, qc, signOut]);
}
