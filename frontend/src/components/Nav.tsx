import { useQuery } from '@tanstack/react-query';
import { BookOpen, ChevronDown, LogOut, Moon, Radar, ShieldCheck, Sun, User } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { API_URL, api } from '../api';
import { useAuth } from '../auth';
import { useLive, type LiveStatus } from '../live';
import { useTheme } from '../theme';
import type { Health } from '../types';
import { IconButton, Tooltip, buttonClasses, cx } from './ui';

const LIVE: Record<LiveStatus, { label: string; dot: string; hint: string }> = {
  live: { label: 'Live', dot: 'bg-ok', hint: 'Receiving realtime updates' },
  reconnecting: { label: 'Reconnecting', dot: 'bg-warn', hint: 'Realtime stream interrupted, retrying' },
  offline: { label: 'Offline', dot: 'bg-danger', hint: 'Realtime stream is closed' },
};

export function LiveIndicator() {
  const { status } = useLive();
  const s = LIVE[status];
  return (
    <Tooltip label={s.hint}>
      <span role="status" aria-label={s.hint} className="inline-flex h-8 items-center gap-2 rounded-full border border-line bg-panel px-2.5 text-xs font-medium">
        <span className="relative flex h-2 w-2">
          <span className={cx('absolute inline-flex h-full w-full rounded-full opacity-60', s.dot, status === 'live' && 'animate-ping')} />
          <span className={cx('relative inline-flex h-2 w-2 rounded-full', s.dot)} />
        </span>
        <span className="hidden sm:inline">{s.label}</span>
      </span>
    </Tooltip>
  );
}

function HealthDot() {
  const { data, isError } = useQuery({ queryKey: ['health'], queryFn: () => api<Health>('/health'), refetchInterval: 15_000, retry: false });
  const status = isError ? 'unreachable' : (data?.status ?? 'checking');
  const dot = status === 'ok' ? 'bg-ok' : status === 'degraded' ? 'bg-warn' : status === 'checking' ? 'bg-muted' : 'bg-danger';
  const detail = data ? Object.entries(data.checks).map(([k, v]) => `${k} ${v}`).join(' · ') : '';
  return (
    <Tooltip label={`API ${status}${detail ? ` — ${detail}` : ''}`}>
      <span role="status" aria-label={`API ${status}`} className="grid h-8 w-8 place-items-center rounded-full border border-line bg-panel text-[10px] font-semibold text-muted">
        <span className="relative">
          API
          <span className={cx('absolute -right-1.5 -top-1 h-1.5 w-1.5 rounded-full', dot)} />
        </span>
      </span>
    </Tooltip>
  );
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return <IconButton label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} icon={theme === 'dark' ? Sun : Moon} onClick={toggle} />;
}

function UserMenu() {
  const { session, logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!session)
    return (
      <div className="flex items-center gap-2">
        <Link to="/register" className={cx(buttonClasses('ghost', 'sm'), 'hidden sm:inline-flex')}>
          Create account
        </Link>
        <Link to="/login" className={buttonClasses('primary', 'sm')}>
          Sign in
        </Link>
      </div>
    );

  const admin = session.role === 'ADMIN';
  const RoleIcon = admin ? ShieldCheck : User;
  return (
    <div ref={ref} className="relative">
      <button
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-panel pl-2.5 pr-2 text-[13px] font-medium transition hover:bg-fg/10"
      >
        <RoleIcon className={cx('h-4 w-4', admin ? 'text-accent' : 'text-muted')} aria-hidden />
        <span className="hidden sm:inline">{admin ? 'Admin' : 'Contributor'}</span>
        <ChevronDown className={cx('h-3.5 w-3.5 text-muted transition', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="glass-strong animate-toast absolute right-0 top-full z-50 mt-2 w-52 rounded-xl p-1.5">
          <p className="px-2.5 py-1.5 text-xs text-muted">
            Signed in as <span className="font-medium text-fg">{admin ? 'Administrator' : 'Contributor'}</span>
          </p>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              logout();
              nav('/');
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-fg transition hover:bg-fg/10"
          >
            <LogOut className="h-4 w-4 text-muted" aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function TopNav() {
  return (
    <header className="glass-strong sticky top-0 z-40 rounded-none border-x-0 border-t-0">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-3 px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5" aria-label="Disaster Response home">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-accent-fg shadow-sm">
            <Radar className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">Disaster Response</span>
        </Link>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <LiveIndicator />
          <HealthDot />
          <a href={`${API_URL}/docs`} target="_blank" rel="noreferrer" className="hidden sm:inline-flex">
            <IconButton label="API documentation" icon={BookOpen} tabIndex={-1} />
          </a>
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
