const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export const fmtDate = (s: string) =>
  new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function timeAgo(s: string): string {
  const diff = (new Date(s).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 2_592_000) return rtf.format(Math.round(diff / 86400), 'day');
  return rtf.format(Math.round(diff / 2_592_000), 'month');
}

export const initials = (s: string) => (s.trim()[0] ?? '?').toUpperCase();
export const shortId = (s: string) => s.slice(0, 8);
