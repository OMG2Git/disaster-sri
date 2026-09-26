import { MapPin, Pencil, Plus, Radio, Trash2, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { timeAgo } from '../format';
import { useTick } from '../hooks';
import { useLive } from '../live';
import { Card, EmptyState, cx } from './ui';

const META: Record<string, { icon: LucideIcon; label: string; cls: string }> = {
  'disaster.created': { icon: Plus, label: 'Reported', cls: 'text-accent bg-accent/10' },
  'disaster.updated': { icon: Pencil, label: 'Updated', cls: 'text-muted bg-fg/8' },
  'disaster.deleted': { icon: Trash2, label: 'Removed', cls: 'text-danger bg-danger/10' },
  'disaster.location_resolved': { icon: MapPin, label: 'Located', cls: 'text-ok bg-ok/10' },
};

export function ActivityFeed({ className }: { className?: string }) {
  const { feed } = useLive();
  useTick();

  return (
    <Card title="Recent activity" icon={Radio} className={className}>
      {feed.length === 0 ? (
        <EmptyState icon={Radio} title="Listening for events" description="Reports, updates and resolved locations appear here as they happen." />
      ) : (
        <ul className="max-h-[420px] divide-y divide-[var(--line)] overflow-auto">
          {feed.map((f) => {
            const m = META[f.type] ?? META['disaster.updated'];
            return (
              <li key={f.key} className="animate-toast flex items-start gap-3 px-4 py-3">
                <span className={cx('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg', m.cls)}>
                  <m.icon className="h-3.5 w-3.5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    {f.type === 'disaster.deleted' ? (
                      <span className="text-muted">An incident was removed</span>
                    ) : (
                      <Link to={`/disasters/${f.disasterId}`} className="font-medium hover:text-accent">
                        {f.title ?? 'Incident'}
                      </Link>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {m.label}
                    {f.detail ? ` · ${f.detail}` : ''} · {timeAgo(f.at)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
