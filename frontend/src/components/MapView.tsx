import L from 'leaflet';
import { Crosshair, Maximize2, Minus, Plus, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AttributionControl, Circle, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { prefersReducedMotion } from '../hooks';
import type { DisasterStatus, LatLng, ResourceType } from '../types';
import { RESOURCE_META } from './resourceMeta';
import { cx } from './ui';

export type MapMarker =
  | { id: string; kind: 'disaster'; position: LatLng; status: DisasterStatus; popup: ReactNode }
  | { id: string; kind: 'resource'; position: LatLng; type: ResourceType; selected?: boolean; popup: ReactNode }
  | { id: string; kind: 'center'; position: LatLng; popup: ReactNode };

// Standard OpenStreetMap tiles need no API key. The dark theme recolours them with a CSS filter (see index.css).
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const icons = new Map<string, L.DivIcon>();
function pin(key: string, size: number, html: string): L.DivIcon {
  let icon = icons.get(key);
  if (!icon) {
    icon = L.divIcon({ className: 'pin-wrap', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2] });
    icons.set(key, icon);
  }
  return icon;
}

function iconFor(m: MapMarker): L.DivIcon {
  if (m.kind === 'disaster') {
    const svg = renderToStaticMarkup(<TriangleAlert strokeWidth={2.4} />);
    const pulse = m.status === 'ACTIVE' ? '<span class="pin-pulse"></span>' : '';
    return pin(`d:${m.status}`, 38, `<div class="pin pin-active-wrap pin-${m.status.toLowerCase()}">${pulse}<span class="pin-core">${svg}</span></div>`);
  }
  if (m.kind === 'resource') {
    const meta = RESOURCE_META[m.type];
    const svg = renderToStaticMarkup(<meta.icon strokeWidth={2.2} />);
    return pin(
      `r:${m.type}:${m.selected ? 1 : 0}`,
      32,
      `<div class="pin pin-resource ${m.selected ? 'is-selected' : ''}"><span class="pin-core" style="background:${meta.color}">${svg}</span></div>`,
    );
  }
  const svg = renderToStaticMarkup(<Crosshair strokeWidth={2.4} />);
  return pin('center', 32, `<div class="pin pin-center"><span class="pin-core">${svg}</span></div>`);
}

/** Fly/fit to the given content whenever `fitKey` or the manual "fit" nonce changes. */
function FitController({ markers, circle, fitKey, nonce }: { markers: MapMarker[]; circle?: MapCircle; fitKey: string; nonce: number }) {
  const map = useMap();
  useEffect(() => {
    let bounds: L.LatLngBounds | null = markers.length ? L.latLngBounds(markers.map((m) => [m.position.lat, m.position.lng] as [number, number])) : null;
    if (circle) {
      const cb = L.latLng(circle.center.lat, circle.center.lng).toBounds(circle.radiusKm * 2000);
      bounds = bounds ? bounds.extend(cb) : cb;
    }
    if (!bounds) return;
    map.invalidateSize();
    const still = prefersReducedMotion();
    if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
      map.setView(bounds.getCenter(), 12, { animate: !still });
    } else if (still) {
      map.fitBounds(bounds, { padding: [56, 56], maxZoom: 14, animate: false });
    } else {
      map.flyToBounds(bounds, { padding: [56, 56], maxZoom: 14, duration: 0.9 });
    }
    // Only refit when the caller says the "subject" changed (not on every marker update)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, nonce]);
  return null;
}

function FocusController({ focus }: { focus?: MapFocus | null }) {
  const map = useMap();
  useEffect(() => {
    if (!focus) return;
    const zoom = Math.max(map.getZoom(), 14);
    if (prefersReducedMotion()) map.setView([focus.position.lat, focus.position.lng], zoom, { animate: false });
    else map.flyTo([focus.position.lat, focus.position.lng], zoom, { duration: 0.7 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);
  return null;
}

function ClickHandler({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: +e.latlng.lat.toFixed(5), lng: +e.latlng.lng.toFixed(5) }) });
  return null;
}

function Controls({ onFit }: { onFit: () => void }) {
  const map = useMap();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) {
      L.DomEvent.disableClickPropagation(ref.current);
      L.DomEvent.disableScrollPropagation(ref.current);
    }
  }, []);
  const btn = 'grid h-9 w-9 place-items-center text-muted transition hover:bg-fg/10 hover:text-fg active:scale-95';
  return (
    <div ref={ref} className="glass-strong absolute right-3 top-3 z-[1000] flex flex-col overflow-hidden rounded-xl divide-y divide-[var(--line)]">
      <button aria-label="Zoom in" className={btn} onClick={() => map.zoomIn()}>
        <Plus className="h-4 w-4" />
      </button>
      <button aria-label="Zoom out" className={btn} onClick={() => map.zoomOut()}>
        <Minus className="h-4 w-4" />
      </button>
      <button aria-label="Fit to content" className={btn} onClick={onFit}>
        <Maximize2 className="h-4 w-4" />
      </button>
    </div>
  );
}

export interface MapCircle {
  center: LatLng;
  radiusKm: number;
}
export interface MapFocus {
  position: LatLng;
  nonce: number;
}

export function MapView({
  markers,
  circle,
  fitKey,
  focus,
  onPick,
  overlay,
  className,
  defaultCenter = { lat: 25, lng: 0 },
  defaultZoom = 2,
}: {
  markers: MapMarker[];
  circle?: MapCircle;
  fitKey: string;
  focus?: MapFocus | null;
  onPick?: (p: LatLng) => void;
  overlay?: ReactNode;
  className?: string;
  defaultCenter?: LatLng;
  defaultZoom?: number;
}) {
  const [nonce, setNonce] = useState(0);
  const start = useMemo(() => [defaultCenter.lat, defaultCenter.lng] as [number, number], [defaultCenter.lat, defaultCenter.lng]);

  return (
    <div className={cx('relative isolate overflow-hidden rounded-2xl border border-line', className)}>
      <MapContainer
        center={start}
        zoom={defaultZoom}
        zoomControl={false}
        attributionControl={false}
        worldCopyJump
        className={cx('h-full w-full', onPick && 'map-pick')}
      >
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} maxZoom={19} />
        <AttributionControl position="bottomright" prefix={false} />
        <FitController markers={markers} circle={circle} fitKey={fitKey} nonce={nonce} />
        <FocusController focus={focus} />
        {onPick && <ClickHandler onPick={onPick} />}
        {circle && (
          <Circle
            center={[circle.center.lat, circle.center.lng]}
            radius={circle.radiusKm * 1000}
            pathOptions={{ className: 'radius-ring', interactive: false }}
          />
        )}
        {markers.map((m) => (
          <Marker key={`${m.kind}:${m.id}:${m.kind === 'resource' && m.selected ? 's' : ''}`} position={[m.position.lat, m.position.lng]} icon={iconFor(m)}>
            <Popup closeButton={false} minWidth={190} offset={[0, -4]}>
              {m.popup}
            </Popup>
          </Marker>
        ))}
        <Controls onFit={() => setNonce((n) => n + 1)} />
      </MapContainer>
      {overlay}
    </div>
  );
}
