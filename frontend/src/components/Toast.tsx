import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { cx } from './ui';

type Tone = 'info' | 'success' | 'warn' | 'danger';
export interface ToastInput {
  title: string;
  description?: string;
  tone?: Tone;
  icon?: LucideIcon;
}
interface ToastItem extends ToastInput {
  id: number;
}

const TONE: Record<Tone, { icon: LucideIcon; cls: string }> = {
  info: { icon: Info, cls: 'text-accent' },
  success: { icon: CircleCheck, cls: 'text-ok' },
  warn: { icon: TriangleAlert, cls: 'text-warn' },
  danger: { icon: CircleAlert, cls: 'text-danger' },
};

const ToastContext = createContext<(t: ToastInput) => void>(() => {});
const MAX_VISIBLE = 3;
const LIFETIME_MS = 4500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (t: ToastInput) => {
      const id = nextId.current++;
      setItems((l) => [...l, { ...t, id }].slice(-MAX_VISIBLE));
      window.setTimeout(() => dismiss(id), LIFETIME_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => push, [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-[2000] flex flex-col items-end gap-2 sm:left-auto sm:right-5">
        {items.map((t) => {
          const tone = TONE[t.tone ?? 'info'];
          const Icon = t.icon ?? tone.icon;
          return (
            <div key={t.id} className="glass-strong animate-toast pointer-events-auto flex w-full items-start gap-3 rounded-xl p-3.5 sm:w-80">
              <Icon className={cx('mt-0.5 h-4 w-4 shrink-0', tone.cls)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{t.title}</p>
                {t.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{t.description}</p>}
              </div>
              <button aria-label="Dismiss" onClick={() => dismiss(t.id)} className="text-muted transition hover:text-fg">
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
