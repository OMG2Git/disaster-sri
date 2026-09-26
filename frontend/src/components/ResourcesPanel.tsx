import type { UseQueryResult } from '@tanstack/react-query';
import { LocateFixed, MapPinOff, X } from 'lucide-react';
import type { LatLng, Resource, ResourceType } from '../types';
import { RESOURCE_META } from './resourceMeta';
import { Button, EmptyState, ErrorNote, Skeleton, cx } from './ui';

const TYPES = Object.keys(RESOURCE_META) as ResourceType[];

export function ResourcesPanel({
  query,
  radius,
  onRadius,
  type,
  onType,
  custom,
  onResetCenter,
  hasCenter,
  selectedId,
  onSelect,
}: {
  query: UseQueryResult<{ resources: Resource[] }>;
  radius: number;
  onRadius: (n: number) => void;
  type: ResourceType | '';
  onType: (t: ResourceType | '') => void;
  custom: LatLng | null;
  onResetCenter: () => void;
  hasCenter: boolean;
  selectedId: string | null;
  onSelect: (r: Resource) => void;
}) {
  const resources = query.data?.resources ?? [];
  const chip = (active: boolean) =>
    cx(
      'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition',
      active ? 'border-accent/40 bg-accent/12 text-accent' : 'border-line bg-panel text-muted hover:text-fg',
    );

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-line p-4">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Resource type">
          <button className={chip(type === '')} onClick={() => onType('')}>
            All
          </button>
          {TYPES.map((t) => {
            const m = RESOURCE_META[t];
            return (
              <button key={t} className={chip(type === t)} onClick={() => onType(type === t ? '' : t)} aria-pressed={type === t}>
                <m.icon className="h-3.5 w-3.5" aria-hidden />
                {m.label}
              </button>
            );
          })}
        </div>

        <label className="block">
          <span className="mb-1 flex items-center justify-between text-xs text-muted">
            Search radius <span className="font-medium tabular-nums text-fg">{radius} km</span>
          </span>
          <input type="range" min={1} max={50} value={radius} onChange={(e) => onRadius(Number(e.target.value))} className="h-1.5 w-full cursor-pointer accent-accent" />
        </label>

        {custom ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-accent/25 bg-accent/8 px-3 py-2 text-xs">
            <span className="flex items-center gap-2 text-accent">
              <LocateFixed className="h-3.5 w-3.5" aria-hidden />
              <span className="tabular-nums">
                {custom.lat.toFixed(4)}, {custom.lng.toFixed(4)}
              </span>
            </span>
            <Button size="sm" variant="ghost" icon={X} onClick={onResetCenter} className="!h-6 !px-2">
              Reset
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted">Searching around the incident. Click the map to search around any other point.</p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {!hasCenter ? (
          <EmptyState icon={MapPinOff} title="No search point yet" description="The incident has no location. Click the map to choose where to search." />
        ) : query.isLoading ? (
          <ul className="space-y-1 p-3">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="flex items-center gap-3 p-2">
                <Skeleton className="h-9 w-9 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </li>
            ))}
          </ul>
        ) : query.error ? (
          <div className="p-4">
            <ErrorNote error={query.error} />
          </div>
        ) : resources.length === 0 ? (
          <EmptyState icon={MapPinOff} title={`Nothing within ${radius} km`} description="Try a larger radius or another resource type." />
        ) : (
          <ul className="p-2">
            {resources.map((r) => {
              const m = RESOURCE_META[r.type];
              return (
                <li key={r.id}>
                  <button
                    onClick={() => onSelect(r)}
                    className={cx('flex w-full items-center gap-3 rounded-xl p-2 text-left transition hover:bg-fg/6', selectedId === r.id && 'bg-fg/8')}
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white" style={{ background: m.color }}>
                      <m.icon className="h-[18px] w-[18px]" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.name}</span>
                      <span className="block text-xs text-muted">{m.label}</span>
                    </span>
                    <span className="text-right text-sm font-medium tabular-nums">
                      {r.distance_km}
                      <span className="ml-0.5 text-xs font-normal text-muted">km</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
