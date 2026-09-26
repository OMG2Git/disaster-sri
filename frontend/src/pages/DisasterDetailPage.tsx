import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Lock, MapPinOff, MessageSquare, Pencil, Radar, Trash2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { DisasterForm, type DisasterFormValues } from '../components/DisasterForm';
import { MapView, type MapFocus, type MapMarker } from '../components/MapView';
import { ConfirmDialog, Modal } from '../components/Modal';
import { ReportsPanel } from '../components/ReportsPanel';
import { RESOURCE_META } from '../components/resourceMeta';
import { ResourcesPanel } from '../components/ResourcesPanel';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, ErrorNote, ErrorState, IconButton, LocationBadge, Skeleton, StatusBadge, Tooltip, cx } from '../components/ui';
import { fmtDate, shortId, timeAgo } from '../format';
import { useDebounced } from '../hooks';
import type { Disaster, LatLng, ReportsResponse, Resource, ResourceType } from '../types';

function LocationBanner({ d }: { d: Disaster }) {
  if (d.location_status === 'PENDING')
    return (
      <div className="glass rounded-2xl p-4">
        <div className="mb-3 flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-warn/12 text-warn">
            <Radar className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">Locating the incident</p>
            <p className="text-xs text-muted">
              Extracting the place from the description, then geocoding it. This page updates on its own.
              {d.location_attempts > 0 && ` Retrying (attempt ${d.location_attempts + 1}) after: ${d.location_error}`}
            </p>
          </div>
        </div>
        <div className="progress-indeterminate" role="progressbar" aria-label="Resolving location" />
      </div>
    );
  if (d.location_status === 'FAILED')
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-danger/30 bg-danger/8 p-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-danger/12 text-danger">
          <TriangleAlert className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-danger">Location couldn't be resolved</p>
          <p className="text-xs text-muted">
            {d.location_error ?? 'Unknown error'} ({d.location_attempts || 1} attempt{d.location_attempts === 1 ? '' : 's'}). You can still click the map to search for resources around any point.
          </p>
        </div>
      </div>
    );
  return null;
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

export function DisasterDetailPage() {
  const { id = '' } = useParams();
  const { session } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const [tab, setTab] = useState<'resources' | 'reports'>('resources');
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [radius, setRadius] = useState(10);
  const [type, setType] = useState<ResourceType | ''>('');
  const [custom, setCustom] = useState<LatLng | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const searchRadius = useDebounced(radius, 350);

  const q = useQuery({
    queryKey: ['disaster', id],
    queryFn: () => api<Disaster>(`/disasters/${id}`),
    retry: false,
    // While the async pipeline is running, poll so the page flips to RESOLVED even if SSE is unavailable.
    refetchInterval: (query) => (query.state.data?.location_status === 'PENDING' ? 3000 : false),
  });
  const d = q.data;
  const center: LatLng | null = custom ?? d?.location ?? null;

  const resources = useQuery({
    queryKey: ['resources', id, custom?.lat, custom?.lng, searchRadius, type, d?.location?.lat, d?.location?.lng],
    enabled: !!d && !!center,
    retry: false,
    queryFn: () => {
      const p = new URLSearchParams({ radius: String(searchRadius) });
      if (custom) (p.set('lat', String(custom.lat)), p.set('lng', String(custom.lng)));
      if (type) p.set('type', type);
      return api<{ resources: Resource[] }>(`/disasters/${id}/resources?${p}`);
    },
  });

  const reports = useQuery({ queryKey: ['reports', id], queryFn: () => api<ReportsResponse>(`/disasters/${id}/reports`), retry: false, enabled: !!d, staleTime: 0 });

  const update = useMutation({
    mutationFn: (v: DisasterFormValues) => api<Disaster>(`/disasters/${id}`, { method: 'PATCH', body: v }),
    onSuccess: (updated, values) => {
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['disaster', id] });
      qc.invalidateQueries({ queryKey: ['disasters'] });
      qc.invalidateQueries({ queryKey: ['resources', id] });
      // A changed description sends the incident back through location resolution (server-side).
      const relocating = updated.location_status === 'PENDING' && values.description !== d?.description;
      toast({ title: 'Changes saved', description: relocating ? 'Re-locating the incident from the new description.' : undefined, tone: 'success' });
    },
  });

  const remove = useMutation({
    mutationFn: () => api<void>(`/disasters/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['disasters'] });
      toast({ title: 'Incident deleted', tone: 'success' });
      nav('/');
    },
  });

  if (q.isLoading)
    return (
      <div className="space-y-5">
        <Skeleton className="h-9 w-2/3" />
        <div className="grid gap-5 lg:grid-cols-12">
          <Skeleton className="h-[420px] rounded-2xl lg:col-span-7 xl:col-span-8" />
          <Skeleton className="h-[420px] rounded-2xl lg:col-span-5 xl:col-span-4" />
        </div>
      </div>
    );

  if (q.error || !d)
    return (
      <Card>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
        <div className="flex justify-center pb-6">
          <Link to="/">
            <Button icon={ArrowLeft}>Back to incidents</Button>
          </Link>
        </div>
      </Card>
    );

  const isAdmin = session?.role === 'ADMIN';
  const canEdit = !!session && (isAdmin || session.userId === d.created_by);

  const markers: MapMarker[] = [];
  if (d.location)
    markers.push({
      id: d.id,
      kind: 'disaster',
      position: d.location,
      status: d.status,
      popup: (
        <div className="space-y-1.5">
          <p className="text-sm font-semibold leading-snug">{d.title}</p>
          <p className="text-xs text-muted">{d.location_text}</p>
        </div>
      ),
    });
  if (custom) markers.push({ id: 'custom', kind: 'center', position: custom, popup: <p className="text-xs">Search point</p> });
  for (const r of resources.data?.resources ?? [])
    markers.push({
      id: r.id,
      kind: 'resource',
      type: r.type,
      position: r.location,
      selected: r.id === selected,
      popup: (
        <div className="space-y-0.5">
          <p className="text-sm font-semibold leading-snug">{r.name}</p>
          <p className="text-xs text-muted">
            {RESOURCE_META[r.type].label} · {r.distance_km} km away
          </p>
        </div>
      ),
    });

  const fitKey = `${center?.lat ?? ''},${center?.lng ?? ''},${searchRadius}`;
  const pick = (p: LatLng) => {
    setCustom(p);
    setSelected(null);
    setTab('resources');
  };

  const tabBtn = (active: boolean) =>
    cx('relative flex h-11 flex-1 items-center justify-center gap-2 text-[13px] font-medium transition', active ? 'text-fg' : 'text-muted hover:text-fg');

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link to="/" aria-label="Back to incidents" className="mt-0.5">
          <IconButton label="Back" icon={ArrowLeft} variant="secondary" tabIndex={-1} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold leading-tight tracking-tight">{d.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={d.status} />
            <LocationBadge status={d.location_status} />
            {d.tags.map((t) => (
              <Badge key={t}>{t}</Badge>
            ))}
            <span className="text-xs text-muted">Reported {timeAgo(d.created_at)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canEdit && (
            <Button icon={Pencil} onClick={() => setEditing(true)} aria-label="Edit incident">
              <span className="hidden sm:inline">Edit</span>
            </Button>
          )}
          {isAdmin && (
            <Button variant="danger" icon={Trash2} onClick={() => setConfirmDelete(true)} aria-label="Delete incident">
              <span className="hidden sm:inline">Delete</span>
            </Button>
          )}
          {session && !canEdit && (
            <Tooltip label="Only the owner or an admin can edit this incident">
              <Badge icon={Lock} className="h-8">
                Read-only
              </Badge>
            </Tooltip>
          )}
        </div>
      </div>

      <LocationBanner d={d} />

      {/* Map + side panel */}
      <div className="grid gap-5 lg:grid-cols-12">
        <MapView
          className="h-[340px] sm:h-[440px] lg:col-span-7 lg:h-[580px] xl:col-span-8"
          markers={markers}
          circle={center ? { center, radiusKm: searchRadius } : undefined}
          fitKey={fitKey}
          focus={focus}
          onPick={pick}
          overlay={
            !center ? (
              <div className="glass-strong pointer-events-none absolute inset-x-4 bottom-4 z-[1000] flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-xs text-muted sm:inset-x-auto sm:max-w-xs">
                <MapPinOff className="h-4 w-4 shrink-0" aria-hidden />
                {d.location_status === 'PENDING' ? 'Waiting for the location…' : 'No location. Click anywhere on the map to search there.'}
              </div>
            ) : null
          }
        />

        <Card className="flex h-[520px] flex-col overflow-hidden lg:col-span-5 lg:h-[580px] xl:col-span-4">
          <div role="tablist" className="flex border-b border-line">
            <button role="tab" aria-selected={tab === 'resources'} className={tabBtn(tab === 'resources')} onClick={() => setTab('resources')}>
              Resources
              {resources.data && <span className="rounded-full bg-fg/10 px-1.5 text-[11px] tabular-nums">{resources.data.resources.length}</span>}
              {tab === 'resources' && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" />}
            </button>
            <button role="tab" aria-selected={tab === 'reports'} className={tabBtn(tab === 'reports')} onClick={() => setTab('reports')}>
              <MessageSquare className="h-3.5 w-3.5" aria-hidden />
              Reports
              {reports.data && <span className="rounded-full bg-fg/10 px-1.5 text-[11px] tabular-nums">{reports.data.reports.length}</span>}
              {tab === 'reports' && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" />}
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {tab === 'resources' ? (
              <ResourcesPanel
                query={resources}
                radius={radius}
                onRadius={setRadius}
                type={type}
                onType={setType}
                custom={custom}
                onResetCenter={() => setCustom(null)}
                hasCenter={!!center}
                selectedId={selected}
                onSelect={(r) => {
                  setSelected(r.id);
                  setFocus({ position: r.location, nonce: Date.now() });
                }}
              />
            ) : (
              <ReportsPanel query={reports} />
            )}
          </div>
        </Card>
      </div>

      {/* Details */}
      <Card title="Details">
        <div className="space-y-4 p-4">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{d.description}</p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-4 sm:grid-cols-4">
            <Meta label="Location">{d.location_text ?? <span className="text-muted">—</span>}</Meta>
            <Meta label="Coordinates">
              {d.location ? (
                <span className="tabular-nums">
                  {d.location.lat.toFixed(5)}, {d.location.lng.toFixed(5)}
                </span>
              ) : (
                <span className="text-muted">—</span>
              )}
            </Meta>
            <Meta label="Reported">{fmtDate(d.created_at)}</Meta>
            <Meta label="Last updated">{fmtDate(d.updated_at)}</Meta>
            <Meta label="Owner">{d.created_by === session?.userId ? 'You' : <span className="font-mono text-xs">{shortId(d.created_by)}</span>}</Meta>
          </dl>
        </div>
      </Card>

      <Modal open={editing} onClose={() => setEditing(false)} title="Edit incident">
        <DisasterForm
          initial={{ title: d.title, description: d.description, tags: d.tags, status: d.status }}
          submitLabel="Save changes"
          descriptionHint="Changing the description re-locates the incident, so fix a mistyped place here."
          pending={update.isPending}
          onSubmit={(v) => update.mutate(v)}
          onCancel={() => setEditing(false)}
        />
        {update.error && (
          <div className="mt-4">
            <ErrorNote error={update.error} />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this incident?"
        message="This permanently removes the incident and its community reports."
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
      {remove.error && confirmDelete && <ErrorNote error={remove.error} />}
    </div>
  );
}
