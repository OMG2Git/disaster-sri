import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, CircleCheck, Clock, MapPin, Plus, Search, SearchX, Siren, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { ActivityFeed } from '../components/ActivityFeed';
import { DisasterForm, type DisasterFormValues } from '../components/DisasterForm';
import { MapView, type MapMarker } from '../components/MapView';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { Button, Card, EmptyState, ErrorNote, ErrorState, Input, Segmented, Skeleton, StatusBadge, Spinner, cx } from '../components/ui';
import { timeAgo } from '../format';
import { useDebounced, useTick } from '../hooks';
import { useLive } from '../live';
import type { Disaster, DisasterStatus } from '../types';

function Stat({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: number | string; tone: string }) {
  return (
    <div className="glass flex items-center gap-3 rounded-2xl px-4 py-3.5">
      <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', tone)}>
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <div>
        <p className="text-2xl font-semibold leading-none tabular-nums">{value}</p>
        <p className="mt-1 text-xs text-muted">{label}</p>
      </div>
    </div>
  );
}

function LocationLine({ d }: { d: Disaster }) {
  if (d.location_status === 'PENDING')
    return (
      <span className="inline-flex items-center gap-1.5 text-warn">
        <Spinner className="h-3 w-3" /> Locating…
      </span>
    );
  if (d.location_status === 'FAILED')
    return (
      <span className="inline-flex items-center gap-1.5 text-danger">
        <TriangleAlert className="h-3 w-3" aria-hidden /> Location unavailable
      </span>
    );
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <MapPin className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{d.location_text}</span>
    </span>
  );
}

export function DisastersPage() {
  const { session } = useAuth();
  const { fresh } = useLive();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  useTick();

  const [tagInput, setTagInput] = useState('');
  const [status, setStatus] = useState<DisasterStatus | 'ALL'>('ALL');
  const [creating, setCreating] = useState(false);
  const tag = useDebounced(tagInput.trim().toLowerCase(), 300);

  const params = new URLSearchParams();
  if (tag) params.set('tag', tag);
  if (status !== 'ALL') params.set('status', status);
  const qs = params.toString();

  const list = useQuery({ queryKey: ['disasters', qs], queryFn: () => api<Disaster[]>(`/disasters${qs ? `?${qs}` : ''}`) });
  // Unfiltered set for the stat strip and the map; shares its cache entry with the list when no filter is set.
  const all = useQuery({ queryKey: ['disasters', ''], queryFn: () => api<Disaster[]>('/disasters') });

  const create = useMutation({
    mutationFn: (v: DisasterFormValues) => api<Disaster>('/disasters', { method: 'POST', body: v }),
    onSuccess: (d) => {
      setCreating(false);
      qc.invalidateQueries({ queryKey: ['disasters'] });
      toast({ title: 'Incident reported', description: 'Resolving its location in the background.', tone: 'success' });
      nav(`/disasters/${d.id}`);
    },
  });

  const everything = all.data ?? [];
  const located = everything.filter((d) => d.location);
  const stats = {
    active: everything.filter((d) => d.status === 'ACTIVE').length,
    resolved: everything.filter((d) => d.status === 'RESOLVED').length,
    located: located.length,
    pending: everything.filter((d) => d.location_status === 'PENDING').length,
  };

  const markers: MapMarker[] = located.map((d) => ({
    id: d.id,
    kind: 'disaster',
    position: d.location!,
    status: d.status,
    popup: (
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold leading-snug">{d.title}</p>
          <StatusBadge status={d.status} />
        </div>
        <p className="text-xs text-muted">{d.location_text}</p>
        <Link to={`/disasters/${d.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
          Open incident <ChevronRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>
    ),
  }));

  const openCreate = () => (session ? setCreating(true) : nav('/login'));
  const filtered = tag !== '' || status !== 'ALL';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Incidents</h1>
        <Button variant="primary" icon={Plus} onClick={openCreate}>
          Report incident
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {all.isLoading ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[74px] rounded-2xl" />)
        ) : (
          <>
            <Stat icon={Siren} label="Active" value={stats.active} tone="bg-danger/12 text-danger" />
            <Stat icon={CircleCheck} label="Resolved" value={stats.resolved} tone="bg-ok/12 text-ok" />
            <Stat icon={MapPin} label="Located" value={`${stats.located}/${everything.length}`} tone="bg-accent/12 text-accent" />
            <Stat icon={Clock} label="Awaiting location" value={stats.pending} tone="bg-warn/12 text-warn" />
          </>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <MapView
            className="h-[340px] sm:h-[440px]"
            markers={markers}
            fitKey={located.length ? 'data' : 'empty'}
            overlay={
              all.isLoading ? (
                <div className="skeleton absolute inset-0" />
              ) : located.length === 0 ? (
                <div className="glass-strong absolute bottom-4 left-4 z-[1000] rounded-xl px-3 py-2 text-xs text-muted">No located incidents yet</div>
              ) : null
            }
          />

          <Card>
            <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="sm:w-64">
                <Input icon={Search} value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="Filter by tag" aria-label="Filter by tag" />
              </div>
              <Segmented
                label="Filter by status"
                value={status}
                onChange={setStatus}
                options={[
                  { value: 'ALL', label: 'All' },
                  { value: 'ACTIVE', label: 'Active' },
                  { value: 'RESOLVED', label: 'Resolved' },
                  { value: 'CLOSED', label: 'Closed' },
                ]}
              />
            </div>

            {list.isLoading ? (
              <ul className="divide-y divide-line">
                {[0, 1, 2, 3].map((i) => (
                  <li key={i} className="space-y-2 p-4">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3 w-1/3" />
                  </li>
                ))}
              </ul>
            ) : list.error ? (
              <ErrorState error={list.error} onRetry={() => list.refetch()} />
            ) : list.data?.length === 0 ? (
              <EmptyState
                icon={SearchX}
                title={filtered ? 'No incidents match these filters' : 'No incidents yet'}
                description={filtered ? undefined : 'Reported incidents will appear here.'}
                action={
                  filtered ? (
                    <Button size="sm" onClick={() => (setTagInput(''), setStatus('ALL'))}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ul className="divide-y divide-line p-1.5">
                {list.data?.map((d) => (
                  <li key={d.id} className={cx('rounded-xl', fresh.has(d.id) && 'animate-fresh')}>
                    <Link to={`/disasters/${d.id}`} className="group flex items-center gap-3 rounded-xl px-3 py-3 transition hover:bg-fg/5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-[15px] font-medium">{d.title}</p>
                          <StatusBadge status={d.status} />
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                          <LocationLine d={d} />
                          <span>{timeAgo(d.created_at)}</span>
                          {d.tags.slice(0, 3).map((t) => (
                            <span key={t} className="rounded-md border border-line bg-panel px-1.5 py-0.5">
                              {t}
                            </span>
                          ))}
                          {d.tags.length > 3 && <span>+{d.tags.length - 3}</span>}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-fg" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside>
          <ActivityFeed className="xl:sticky xl:top-20" />
        </aside>
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="Report an incident" description="It's saved immediately; its location is resolved in the background.">
        <DisasterForm submitLabel="Report incident" pending={create.isPending} onSubmit={(v) => create.mutate(v)} onCancel={() => setCreating(false)} />
        {create.error && (
          <div className="mt-4">
            <ErrorNote error={create.error} />
          </div>
        )}
      </Modal>
    </div>
  );
}
