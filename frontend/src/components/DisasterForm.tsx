import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { DISASTER_STATUSES, type DisasterStatus } from '../types';
import { TagInput } from './TagInput';
import { Button, Field, Input, Segmented, Textarea } from './ui';

// Mirrors the backend rules so most mistakes are caught before a request is sent.
// The server stays the authority; its errors are shown by the caller.
const schema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200, 'Max 200 characters'),
  description: z.string().trim().min(1, 'Description is required').max(5000, 'Max 5000 characters'),
  tags: z.array(z.string().max(50)).max(20, 'Max 20 tags'),
  status: z.enum(DISASTER_STATUSES),
});

export interface DisasterFormValues {
  title: string;
  description: string;
  tags: string[];
  status: DisasterStatus;
}

export function DisasterForm({
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
  descriptionHint = 'Name the affected place; it is used to locate the incident.',
}: {
  initial?: Partial<DisasterFormValues>;
  submitLabel: string;
  pending?: boolean;
  onSubmit: (v: DisasterFormValues) => void;
  onCancel?: () => void;
  descriptionHint?: string;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [status, setStatus] = useState<DisasterStatus>(initial?.status ?? 'ACTIVE');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ title, description, tags, status });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    onSubmit(parsed.data);
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Title" error={errors.title}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} invalid={!!errors.title} placeholder="Flooding in Manhattan" autoFocus />
      </Field>
      <Field label="Description" error={errors.description} hint={descriptionHint}>
        <Textarea
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          invalid={!!errors.description}
          placeholder="Heavy flooding has affected Manhattan, NYC and nearby areas."
        />
      </Field>
      <Field label="Tags" error={errors.tags}>
        <TagInput value={tags} onChange={setTags} invalid={!!errors.tags} />
      </Field>
      <div className="space-y-1.5">
        <span className="text-xs font-medium text-muted">Status</span>
        <div>
          <Segmented
            label="Status"
            value={status}
            onChange={setStatus}
            options={DISASTER_STATUSES.map((s) => ({ value: s, label: s[0] + s.slice(1).toLowerCase() }))}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
