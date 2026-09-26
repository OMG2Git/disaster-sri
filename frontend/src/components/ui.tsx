import {
  Loader2,
  MapPin,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { ApiError } from '../api';
import type { DisasterStatus, LocationStatus } from '../types';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return <Loader2 className={cx('animate-spin', className)} aria-hidden />;
}

/* ---------- Buttons ---------- */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'icon';

export function buttonClasses(variant: Variant = 'secondary', size: Size = 'md') {
  const variants: Record<Variant, string> = {
    primary: 'bg-accent text-accent-fg shadow-sm hover:brightness-110',
    secondary: 'border border-line bg-panel text-fg hover:bg-fg/10',
    ghost: 'text-muted hover:bg-fg/10 hover:text-fg',
    danger: 'border border-danger/30 bg-danger/10 text-danger hover:bg-danger/20',
  };
  const sizes: Record<Size, string> = {
    sm: 'h-8 gap-1.5 px-3 text-[13px]',
    md: 'h-10 gap-2 px-4 text-sm',
    icon: 'h-9 w-9',
  };
  return cx(
    'inline-flex shrink-0 select-none items-center justify-center rounded-lg font-medium transition duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50',
    variants[variant],
    sizes[size],
  );
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon: Icon,
  children,
  className,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean; icon?: LucideIcon }) {
  return (
    <button {...props} disabled={disabled || loading} className={cx(buttonClasses(variant, size), className)}>
      {loading ? <Spinner /> : Icon && <Icon className="h-4 w-4" aria-hidden />}
      {children}
    </button>
  );
}

export function Tooltip({ label, children, side = 'bottom' }: { label: ReactNode; children: ReactNode; side?: 'top' | 'bottom' }) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cx(
          'glass-strong pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-1 text-xs text-fg opacity-0 transition-opacity duration-150 group-focus-within/tt:opacity-100 group-hover/tt:opacity-100',
          side === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2',
        )}
      >
        {label}
      </span>
    </span>
  );
}

export function IconButton({
  label,
  icon: Icon,
  variant = 'ghost',
  side,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: LucideIcon; variant?: Variant; side?: 'top' | 'bottom' }) {
  return (
    <Tooltip label={label} side={side}>
      <button {...props} aria-label={label} className={cx(buttonClasses(variant, 'icon'), props.className)}>
        <Icon className="h-[18px] w-[18px]" aria-hidden />
      </button>
    </Tooltip>
  );
}

/* ---------- Form controls ---------- */
const inputBase =
  'h-10 w-full rounded-lg border border-line bg-panel px-3 text-sm text-fg outline-none transition placeholder:text-muted/70 focus:border-accent/60 focus:ring-2 focus:ring-accent/25 aria-[invalid=true]:border-danger/60 aria-[invalid=true]:ring-danger/20';

export function Input({
  icon: Icon,
  right,
  invalid,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { icon?: LucideIcon; right?: ReactNode; invalid?: boolean }) {
  return (
    <div className="relative">
      {Icon && <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />}
      <input aria-invalid={invalid || undefined} {...props} className={cx(inputBase, Icon && 'pl-9', !!right && 'pr-10', className)} />
      {right && <div className="absolute right-1 top-1/2 -translate-y-1/2">{right}</div>}
    </div>
  );
}

export function Textarea({ invalid, className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea aria-invalid={invalid || undefined} {...props} className={cx(inputBase, 'h-auto min-h-24 resize-y py-2.5', className)} />;
}

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {error ? (
        <span role="alert" className="block text-xs text-danger">
          {error}
        </span>
      ) : (
        hint && <span className="block text-xs text-muted/80">{hint}</span>
      )}
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: LucideIcon }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-panel p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cx(
              'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition',
              active ? 'bg-fg/12 text-fg shadow-sm' : 'text-muted hover:text-fg',
            )}
          >
            {o.icon && <o.icon className="h-3.5 w-3.5" aria-hidden />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Status ---------- */
type Tone = 'danger' | 'ok' | 'warn' | 'accent' | 'muted';
const TONES: Record<Tone, string> = {
  danger: 'border-danger/30 bg-danger/10 text-danger',
  ok: 'border-ok/30 bg-ok/10 text-ok',
  warn: 'border-warn/30 bg-warn/10 text-warn',
  accent: 'border-accent/30 bg-accent/10 text-accent',
  muted: 'border-line bg-panel text-muted',
};

export function Badge({ tone = 'muted', icon: Icon, children, className }: { tone?: Tone; icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium', TONES[tone], className)}>
      {Icon && <Icon className="h-3 w-3" aria-hidden />}
      {children}
    </span>
  );
}

const STATUS_TONE: Record<DisasterStatus, Tone> = { ACTIVE: 'danger', RESOLVED: 'ok', CLOSED: 'muted' };
export function StatusBadge({ status }: { status: DisasterStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} className="uppercase tracking-wide">
      <span className={cx('h-1.5 w-1.5 rounded-full bg-current', status === 'ACTIVE' && 'animate-pulse')} />
      {status}
    </Badge>
  );
}

export function LocationBadge({ status }: { status: LocationStatus }) {
  if (status === 'PENDING')
    return (
      <Badge tone="warn">
        <Spinner className="h-3 w-3" /> Locating
      </Badge>
    );
  if (status === 'FAILED')
    return (
      <Badge tone="danger" icon={TriangleAlert}>
        No location
      </Badge>
    );
  return (
    <Badge tone="ok" icon={MapPin}>
      Located
    </Badge>
  );
}

/* ---------- Layout / feedback ---------- */
export function Card({
  title,
  icon: Icon,
  right,
  children,
  className,
}: {
  title?: string;
  icon?: LucideIcon;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('glass rounded-2xl', className)}>
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-fg">
            {Icon && <Icon className="h-4 w-4 text-muted" aria-hidden />}
            {title}
          </h2>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export const Skeleton = ({ className }: { className?: string }) => <div className={cx('skeleton rounded-md', className)} aria-hidden />;

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-xl border border-line bg-panel text-muted">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-xs text-xs text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function describeError(error: unknown): { title: string; message: string; details?: { path?: string; message: string }[] } {
  if (error instanceof ApiError) {
    const title =
      error.code === 'NETWORK_ERROR' ? 'Cannot reach the server' : error.status >= 500 ? 'Service unavailable' : error.code.replace(/_/g, ' ').toLowerCase();
    return { title, message: error.message, details: error.details };
  }
  return { title: 'Something went wrong', message: error instanceof Error ? error.message : String(error) };
}

/** Compact inline error, e.g. under a form. */
export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const e = describeError(error);
  return (
    <div role="alert" className="flex gap-2.5 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p>{e.message}</p>
        {e.details && e.details.length > 0 && (
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[13px]">
            {e.details.map((d, i) => (
              <li key={i}>
                {d.path ? `${d.path}: ` : ''}
                {d.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Block-level error state with retry. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = describeError(error);
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-xl border border-danger/30 bg-danger/10 text-danger">
        <TriangleAlert className="h-5 w-5" aria-hidden />
      </span>
      <p className="text-sm font-medium capitalize">{e.title}</p>
      <p className="max-w-sm text-xs text-muted">{e.message}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry} className="mt-2">
          Try again
        </Button>
      )}
    </div>
  );
}
