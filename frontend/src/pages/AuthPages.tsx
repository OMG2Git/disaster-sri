import { Eye, EyeOff, KeyRound, Mail, Radar, User } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '../auth';
import { ThemeToggle } from '../components/Nav';
import { Button, ErrorNote, Field, IconButton, Input } from '../components/ui';

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden px-4 py-10">
      <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden />
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="animate-modal glass-strong relative w-full max-w-sm rounded-2xl p-6 sm:p-7">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-accent text-accent-fg shadow-sm">
            <Radar className="h-6 w-6" aria-hidden />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-[13px] text-muted">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function PasswordInput({ value, onChange, invalid, autoComplete }: { value: string; onChange: (v: string) => void; invalid?: boolean; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <Input
      icon={KeyRound}
      type={show ? 'text' : 'password'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      invalid={invalid}
      autoComplete={autoComplete}
      placeholder="••••••••"
      right={<IconButton type="button" label={show ? 'Hide password' : 'Show password'} icon={show ? EyeOff : Eye} side="top" onClick={() => setShow((s) => !s)} />}
    />
  );
}

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});
const registerSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(200),
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(8, 'Use at least 8 characters').max(128),
});

function useSubmit(action: () => Promise<void>) {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await action();
      nav('/');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function LoginPage() {
  const { session, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, error, run } = useSubmit(() => login(email.trim(), password));

  if (session) return <Navigate to="/" replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
      return setErrors(errs);
    }
    setErrors({});
    void run();
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to report and manage incidents.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email" error={errors.email}>
          <Input icon={Mail} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} invalid={!!errors.email} placeholder="you@example.com" autoFocus />
        </Field>
        <Field label="Password" error={errors.password}>
          <PasswordInput value={password} onChange={setPassword} invalid={!!errors.password} autoComplete="current-password" />
        </Field>
        <ErrorNote error={error} />
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          Sign in
        </Button>
      </form>

      <div className="mt-5 border-t border-line pt-4">
        <p className="mb-2 text-center text-xs text-muted">Seeded test accounts</p>
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" onClick={() => (setEmail('admin@example.com'), setPassword('Admin1234!'))}>
            Admin
          </Button>
          <Button size="sm" onClick={() => (setEmail('contributor@example.com'), setPassword('Contributor1234!'))}>
            Contributor
          </Button>
        </div>
      </div>

      <p className="mt-5 text-center text-[13px] text-muted">
        New here?{' '}
        <Link to="/register" className="font-medium text-accent hover:underline">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { session, register } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, error, run } = useSubmit(() => register(name.trim(), email.trim(), password));

  if (session) return <Navigate to="/" replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = registerSchema.safeParse({ name, email, password });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
      return setErrors(errs);
    }
    setErrors({});
    void run();
  };

  return (
    <AuthShell title="Create your account" subtitle="Contributors can report incidents and edit their own.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Name" error={errors.name}>
          <Input icon={User} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} invalid={!!errors.name} placeholder="Alex Rivera" autoFocus />
        </Field>
        <Field label="Email" error={errors.email}>
          <Input icon={Mail} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} invalid={!!errors.email} placeholder="you@example.com" />
        </Field>
        <Field label="Password" error={errors.password} hint="At least 8 characters.">
          <PasswordInput value={password} onChange={setPassword} invalid={!!errors.password} autoComplete="new-password" />
        </Field>
        <ErrorNote error={error} />
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          Create account
        </Button>
      </form>
      <p className="mt-5 text-center text-[13px] text-muted">
        Already registered?{' '}
        <Link to="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
