import type { UseQueryResult } from '@tanstack/react-query';
import { Database, MessageSquareOff, RefreshCw, TriangleAlert, Zap, type LucideIcon } from 'lucide-react';
import { fmtDate, initials, timeAgo } from '../format';
import type { ReportsResponse } from '../types';
import { Badge, EmptyState, ErrorState, IconButton, Skeleton, Tooltip } from './ui';

const SOURCE: Record<ReportsResponse['meta']['source'], { label: string; hint: string; tone: 'ok' | 'accent' | 'warn'; icon: LucideIcon }> = {
  external: { label: 'Live', hint: 'Fetched from the community service just now', tone: 'ok', icon: Zap },
  cache: { label: 'Cached', hint: 'Served from the Redis cache', tone: 'accent', icon: Database },
  'stale-cache': { label: 'Stale', hint: 'Community service is unavailable; showing the last known reports', tone: 'warn', icon: TriangleAlert },
};

export function ReportsPanel({ query }: { query: UseQueryResult<ReportsResponse> }) {
  const data = query.data;
  const src = data ? SOURCE[data.meta.source] : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <p className="text-xs text-muted">Community reports</p>
        <div className="flex items-center gap-1.5">
          {src && (
            <Tooltip label={src.hint}>
              <Badge tone={src.tone} icon={src.icon}>
                {src.label}
              </Badge>
            </Tooltip>
          )}
          <IconButton label="Refresh reports" icon={RefreshCw} onClick={() => query.refetch()} disabled={query.isFetching} className={query.isFetching ? '[&_svg]:animate-spin' : ''} />
        </div>
      </div>

      {data?.meta.stale && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 p-2.5 text-xs text-warn">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          The reports service is failing. These reports may be out of date.
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {query.isLoading ? (
          <ul className="space-y-3 p-4">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex gap-3">
                <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-3.5 w-full" />
                </div>
              </li>
            ))}
          </ul>
        ) : query.error ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : data && data.reports.length === 0 ? (
          <EmptyState icon={MessageSquareOff} title="No reports yet" description="Nothing has been posted about this incident." />
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {data?.reports.map((r) => (
              <li key={`${r.source}:${r.external_id}`} className="flex gap-3 px-4 py-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line bg-panel text-xs font-semibold text-muted">{initials(r.author ?? '?')}</span>
                <div className="min-w-0">
                  <p className="text-xs text-muted">
                    <span className="font-medium text-fg">{r.author ?? 'Anonymous'}</span> ·{' '}
                    <time dateTime={r.reported_at} title={fmtDate(r.reported_at)}>
                      {timeAgo(r.reported_at)}
                    </time>
                  </p>
                  <p className="mt-0.5 text-sm leading-relaxed">{r.content}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
