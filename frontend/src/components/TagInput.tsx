import { X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { cx } from './ui';

const MAX_TAGS = 20;
const MAX_LEN = 50;

export function TagInput({ value, onChange, invalid }: { value: string[]; onChange: (v: string[]) => void; invalid?: boolean }) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const tag = draft.trim().toLowerCase().slice(0, MAX_LEN);
    setDraft('');
    if (tag && !value.includes(tag) && value.length < MAX_TAGS) onChange([...value, tag]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div
      aria-invalid={invalid || undefined}
      className={cx(
        'flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-line bg-panel px-2 py-1.5 transition focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/25',
        invalid && 'border-danger/60',
      )}
    >
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-md border border-line bg-fg/8 py-0.5 pl-2 pr-1 text-xs">
          {t}
          <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))} className="rounded p-0.5 text-muted hover:text-fg">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        placeholder={value.length ? '' : 'flood, urban…'}
        className="min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted/70"
      />
    </div>
  );
}
