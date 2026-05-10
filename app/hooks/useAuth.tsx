'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { api, ApiError } from '@/app/lib/api-client';

interface User {
  username: string;
  role: string;
  permissions?: Record<string, boolean>;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isFirstRun: boolean | null;
  csrfToken: string | null;
  login: (username: string, password: string) => Promise<void>;
  setup: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  refreshCsrf: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFirstRun, setIsFirstRun] = useState<boolean | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);

  const refreshCsrf = useCallback(async () => {
    try {
      const data = await api.getMe();
      if (data.ok) {
        setCsrfToken(data.csrfToken);
        api.setCsrfToken(data.csrfToken);
      }
    } catch {
      // Not logged in
    }
  }, []);

  const checkAuth = useCallback(async () => {
    setLoading(true);
    try {
      // Check auth status
      const statusRes = await api.getAuthStatus();
      setIsFirstRun(statusRes.first_run);

      if (!statusRes.first_run) {
        try {
          const data = await api.getMe();
          if (data.ok) {
            setUser(data.user);
            setCsrfToken(data.csrfToken);
            api.setCsrfToken(data.csrfToken);
            setLoading(false);
            return;
          }
        } catch {
          // Not authenticated
        }
      }
    } catch (err) {
      console.error('Auth check failed:', err);
    }
    setUser(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = useCallback(async (username: string, password: string) => {
    const data = await api.login(username, password);
    if (data.ok) {
      setUser(data.user);
      setCsrfToken(data.csrfToken);
      api.setCsrfToken(data.csrfToken);
      setIsFirstRun(false);
    } else {
      throw new Error((data as unknown as { error?: string }).error || 'Login failed');
    }
  }, []);

  const setup = useCallback(async (username: string, password: string) => {
    const data = await api.setup(username, password);
    if (data.ok) {
      setUser(data.user);
      setCsrfToken(data.csrfToken);
      api.setCsrfToken(data.csrfToken);
      setIsFirstRun(false);
    } else {
      throw new Error((data as unknown as { error?: string }).error || 'Setup failed');
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Even if the request fails, clear local state
    }
    setUser(null);
    setCsrfToken(null);
    api.setCsrfToken(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, isFirstRun, csrfToken, login, setup, logout, checkAuth, refreshCsrf }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
