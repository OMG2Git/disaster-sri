import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api';
import type { Role } from './types';

export interface Session {
  userId: string;
  role: Role;
}

interface AuthValue {
  session: Session | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

/** Reads claims for display only. The server verifies the signature on every request. */
function decode(token: string | null): Session | null {
  if (!token) return null;
  try {
    const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof claims.sub !== 'string' || (claims.role !== 'ADMIN' && claims.role !== 'CONTRIBUTOR')) return null;
    if (claims.exp && claims.exp * 1000 < Date.now()) return null;
    return { userId: claims.sub, role: claims.role };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => decode(getToken()));

  const logout = useCallback(() => {
    setToken(null);
    setSession(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ access_token: string }>('/auth/login', { method: 'POST', body: { email, password } });
    setToken(res.access_token);
    setSession(decode(res.access_token));
  }, []);

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      await api('/auth/register', { method: 'POST', body: { name, email, password } });
      await login(email, password);
    },
    [login],
  );

  const value = useMemo(() => ({ session, login, register, logout }), [session, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
