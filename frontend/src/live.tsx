import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SSE_URL } from './api';
import { useToast } from './components/Toast';
import type { DisasterEvent } from './types';

export type LiveStatus = 'live' | 'reconnecting' | 'offline';

export interface FeedItem {
  key: string;
  type: string;
  at: string;
  disasterId: string;
  title?: string;
  detail?: string;
}

interface LiveValue {
  status: LiveStatus;
  feed: FeedItem[];
  /** Disaster ids touched in the last few seconds, used to flash rows that just changed. */
  fresh: Set<string>;
}

const LiveContext = createContext<LiveValue>({ status: 'reconnecting', feed: [], fresh: new Set() });
const EVENT_TYPES = ['disaster.created', 'disaster.updated', 'disaster.deleted', 'disaster.location_resolved'];
const FRESH_MS = 2600;

/**
 * One EventSource for the whole app (native SSE; the browser reconnects on its own).
 * Every event refreshes the affected queries, adds a feed entry and raises a quiet toast.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [status, setStatus] = useState<LiveStatus>('reconnecting');
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  useEffect(() => {
    const es = new EventSource(`${SSE_URL}/events/disasters`);
    es.onopen = () => setStatus('live');
    es.onerror = () => setStatus(es.readyState === EventSource.CLOSED ? 'offline' : 'reconnecting');

    const handle = (e: MessageEvent) => {
      let ev: DisasterEvent;
      try {
        ev = JSON.parse(e.data);
      } catch {
        return;
      }
      const p = ev.payload ?? {};
      const located = ev.event_type === 'disaster.location_resolved' && p.location;

      setFeed((f) =>
        [
          {
            key: ev.event_id,
            type: ev.event_type,
            at: ev.occurred_at,
            disasterId: ev.aggregate_id,
            title: p.title,
            detail: located ? `${p.location_text}` : undefined,
          },
          ...f.filter((x) => x.key !== ev.event_id), // delivery is at-least-once: de-dupe on event_id
        ].slice(0, 25),
      );

      setFresh((s) => new Set(s).add(ev.aggregate_id));
      window.setTimeout(
        () =>
          setFresh((s) => {
            const n = new Set(s);
            n.delete(ev.aggregate_id);
            return n;
          }),
        FRESH_MS,
      );

      const t = toastRef.current;
      if (ev.event_type === 'disaster.created') t({ title: 'New incident reported', description: p.title, tone: 'info' });
      else if (ev.event_type === 'disaster.location_resolved') t({ title: 'Location resolved', description: `${p.title} · ${p.location_text}`, tone: 'success' });
      else if (ev.event_type === 'disaster.updated') t({ title: 'Incident updated', description: p.title, tone: 'info' });
      else if (ev.event_type === 'disaster.deleted') t({ title: 'Incident removed', tone: 'warn' });

      qc.invalidateQueries({ queryKey: ['disasters'] });
      qc.invalidateQueries({ queryKey: ['disaster', ev.aggregate_id] });
    };

    EVENT_TYPES.forEach((t) => es.addEventListener(t, handle as EventListener));
    return () => es.close();
  }, [qc]);

  const value = useMemo(() => ({ status, feed, fresh }), [status, feed, fresh]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export const useLive = () => useContext(LiveContext);
