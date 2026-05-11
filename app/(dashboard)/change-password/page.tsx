'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/app/lib/api-client';

// ─── Helpers ──────────────────────────────────────────────────────────

type Strength = 'weak' | 'fair' | 'good' | 'strong';

function getPasswordStrength(password: string): Strength {
  if (!password) return 'weak';
  const len = password.length;
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/.test(password);
  const variety = [hasLower, hasUpper, hasDigit, hasSpecial].filter(Boolean).length;

  if (len >= 12 && variety >= 4) return 'strong';
  if (len >= 10 && variety >= 3) return 'good';
  if (len >= 8 && variety >= 2) return 'fair';
  return 'weak';
}

const STRENGTH_CONFIG: Record<
  Strength,
  { label: string; color: string; pct: number; bgColor: string }
> = {
  weak: { label: 'Weak', color: 'var(--red)', pct: 25, bgColor: 'var(--red)' },
  fair: { label: 'Fair', color: 'var(--amber)', pct: 50, bgColor: 'var(--amber)' },
  good: { label: 'Good', color: 'var(--blue)', pct: 75, bgColor: 'var(--blue)' },
  strong: { label: 'Strong', color: 'var(--green)', pct: 100, bgColor: 'var(--green)' },
};

// ─── Styles ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const STYLES: Record<string, any> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    padding: '24px',
  },
  card: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: '32px',
    minWidth: '400px',
    maxWidth: '90vw',
    backdropFilter: 'blur(12px)',
    boxShadow: 'var(--shadow)',
  },
  title: {
    fontSize: '20px',
    fontWeight: 600,
    textAlign: 'center' as const,
    marginBottom: '4px',
  },
  subtitle: {
    fontSize: '12px',
    textAlign: 'center' as const,
    color: 'var(--fg-muted)',
    marginBottom: '20px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '10px',
  },
  input: {
    background: 'var(--bg-input)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    color: 'var(--fg)',
    fontFamily: 'var(--font)',
    fontSize: '14px',
    padding: '10px 14px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
    transition: 'border-color var(--transition)',
  },
  strengthBar: {
    height: '4px',
    borderRadius: '2px',
    background: 'var(--border)',
    overflow: 'hidden',
    marginTop: '2px',
  },
  strengthFill: (strength: Strength): React.CSSProperties => {
    const cfg = STRENGTH_CONFIG[strength];
    return {
      height: '100%',
      width: `${cfg.pct}%`,
      borderRadius: '2px',
      background: cfg.bgColor,
      transition: 'width 0.3s ease, background 0.3s ease',
    };
  },
  strengthLabel: (strength: Strength): React.CSSProperties => ({
    fontSize: '11px',
    color: STRENGTH_CONFIG[strength].color,
    textAlign: 'right' as const,
    marginTop: '2px',
  }),
  actions: {
    display: 'flex',
    gap: '8px',
    marginTop: '6px',
  },
  btnPrimary: {
    flex: 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '10px',
    border: 'none',
    borderRadius: 'var(--radius)',
    background: 'var(--accent)',
    color: '#fff',
    fontFamily: 'var(--font)',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'opacity var(--transition)',
  },
  btnGhost: {
    flex: 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '10px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    background: 'var(--bg-panel)',
    color: 'var(--fg)',
    fontFamily: 'var(--font)',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background var(--transition)',
  },
  error: {
    color: 'var(--red)',
    fontSize: '12px',
    textAlign: 'center' as const,
    marginTop: '8px',
    minHeight: '1.2em',
  },
  toast: (type: 'success' | 'error'): React.CSSProperties => ({
    position: 'fixed' as const,
    top: '60px',
    right: '24px',
    padding: '10px 18px',
    borderRadius: 'var(--radius)',
    background:
      type === 'success'
        ? 'rgba(124, 148, 92, 0.2)'
        : 'rgba(196, 92, 92, 0.2)',
    border: `1px solid ${type === 'success' ? 'var(--green)' : 'var(--red)'}`,
    color: type === 'success' ? 'var(--green)' : 'var(--red)',
    fontSize: '13px',
    zIndex: 2000,
    fontWeight: 500,
  }),
};

// ─── Component ────────────────────────────────────────────────────────

export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);
  const router = useRouter();

  const strength = useMemo(() => getPasswordStrength(newPassword), [newPassword]);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!currentPassword) {
      setError('Current password is required');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (currentPassword === newPassword) {
      setError('New password must be different from current password');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.changePassword(currentPassword, newPassword);
      if (res.ok) {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        showToast('Password changed successfully', 'success');
        setTimeout(() => router.push('/'), 1500);
      } else {
        setError((res as unknown as { error?: string }).error || 'Failed to change password');
      }
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Failed to change password',
        'error',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={STYLES.container}>
      <div style={STYLES.card}>
        <div style={STYLES.title}>Change Password</div>
        <div style={STYLES.subtitle}>Update your account password</div>

        <form onSubmit={handleSubmit} style={STYLES.form}>
          <input
            style={STYLES.input}
            type="password"
            placeholder="Current password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
          />

          <div>
            <input
              style={{
                ...STYLES.input,
                borderColor: newPassword
                  ? STRENGTH_CONFIG[strength].color
                  : 'var(--border)',
              }}
              type="password"
              placeholder="New password (min 8 chars)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            {newPassword && (
              <>
                <div style={STYLES.strengthBar}>
                  <div style={STYLES.strengthFill(strength)} />
                </div>
                <div style={STYLES.strengthLabel(strength)}>
                  {STRENGTH_CONFIG[strength].label}
                </div>
              </>
            )}
          </div>

          <input
            style={STYLES.input}
            type="password"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            required
          />

          <div style={STYLES.actions}>
            <button
              type="button"
              style={STYLES.btnGhost}
              onClick={() => router.push('/')}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={STYLES.btnPrimary}
              disabled={submitting}
            >
              {submitting ? 'Updating...' : 'Update'}
            </button>
          </div>
        </form>

        <div style={STYLES.error}>{error}</div>
      </div>

      {/* Toast */}
      {toast && <div style={STYLES.toast(toast.type)}>{toast.message}</div>}
    </div>
  );
}
