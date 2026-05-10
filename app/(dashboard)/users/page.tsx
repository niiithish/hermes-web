'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function UsersPage() {
  const [users, setUsers] = useState<Array<{ username: string; role: string; created_at: string; last_login: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const router = useRouter();

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/users', { credentials: 'include' });
      if (res.status === 403) {
        router.push('/');
        return;
      }
      const data = await res.json();
      if (data.ok) setUsers(data.users);
      else setError(data.error || 'Failed to load users');
    } catch (err) {
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '24px', height: '100%', overflowY: 'auto' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>User Management</h1>
      <p style={{ color: 'var(--fg-muted)', marginBottom: '24px' }}>
        Manage user accounts and permissions
      </p>
      {loading && <div className="loading">Loading users...</div>}
      {error && <div style={{ color: 'var(--red)', marginBottom: '12px' }}>{error}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {users.map((u) => (
          <div
            key={u.username}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '12px 16px',
            }}
          >
            <div>
              <div style={{ fontWeight: 500 }}>{u.username}</div>
              <div style={{ fontSize: '12px', color: 'var(--fg-muted)' }}>
                Role: {u.role} &middot; Created: {new Date(u.created_at).toLocaleDateString()}
                {u.last_login && ` · Last login: ${new Date(u.last_login).toLocaleDateString()}`}
              </div>
            </div>
            <span style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '4px',
              background: u.role === 'admin' ? 'var(--accent-dim)' : 'var(--bg-panel-hover)',
              color: u.role === 'admin' ? 'var(--accent)' : 'var(--fg-muted)',
              border: '1px solid var(--border)',
              textTransform: 'uppercase',
            }}>
              {u.role}
            </span>
          </div>
        ))}
        {!loading && users.length === 0 && (
          <div className="empty">No users found</div>
        )}
      </div>
    </div>
  );
}
