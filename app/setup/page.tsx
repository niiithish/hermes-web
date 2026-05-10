'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/hooks/useAuth';

export default function SetupPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { user, loading, isFirstRun, setup } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!isFirstRun && !user) {
      router.replace('/login');
    } else if (user) {
      router.replace('/');
    }
  }, [user, loading, isFirstRun, router]);

  if (loading) return <div className="loading">Loading...</div>;
  if (!isFirstRun && !user) return <div className="loading">Redirecting...</div>;
  if (user) return <div className="loading">Redirecting...</div>;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setSubmitting(true);
    try {
      await setup(username, password);
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="overlay">
      <div className="login-card">
        <div className="login-brand">Hermes Control Interface</div>
        <div className="login-sub">First run — create admin account</div>
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
            placeholder="Password (min 8 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
          <input
            type="password"
            placeholder="Confirm password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Creating...' : 'create admin'}
          </button>
        </form>
        <div className="login-error">{error}</div>
      </div>
    </div>
  );
}
