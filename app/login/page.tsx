'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/hooks/useAuth';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { user, loading, isFirstRun, login } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (isFirstRun) {
      router.replace('/setup');
    } else if (user) {
      router.replace('/');
    }
  }, [user, loading, isFirstRun, router]);

  if (loading) return <div className="loading">Loading...</div>;
  if (user) return <div className="loading">Redirecting...</div>;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(username, password);
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="overlay">
      <div className="login-card">
        <div className="login-brand">Hermes Control Interface</div>
        <div className="login-sub">Enter credentials to continue</div>
        <form onSubmit={handleSubmit} className="login-form">
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Signing in...' : 'unlock'}
          </button>
        </form>
        <div className="login-error">{error}</div>
      </div>
    </div>
  );
}
