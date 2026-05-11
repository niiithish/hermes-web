'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/app/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

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

const STRENGTH_CONFIG: Record<Strength, { label: string; color: string; pct: number }> = {
  weak: { label: 'Weak', color: 'text-red-500', pct: 25 },
  fair: { label: 'Fair', color: 'text-amber-500', pct: 50 },
  good: { label: 'Good', color: 'text-blue-500', pct: 75 },
  strong: { label: 'Strong', color: 'text-green-500', pct: 100 },
};

// ─── Component ────────────────────────────────────────────────────────

export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const router = useRouter();

  const strength = useMemo(() => getPasswordStrength(newPassword), [newPassword]);
  const cfg = STRENGTH_CONFIG[strength];

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!currentPassword) { setError('Current password is required'); return; }
    if (newPassword.length < 8) { setError('New password must be at least 8 characters'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match'); return; }
    if (currentPassword === newPassword) { setError('New password must differ from current'); return; }
    setSubmitting(true);
    try {
      const res = await api.changePassword(currentPassword, newPassword);
      if (res.ok) {
        setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
        showToast('Password changed successfully', 'success');
        setTimeout(() => router.push('/'), 1500);
      } else {
        setError((res as { error?: string }).error || 'Failed to change password');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex items-center justify-center h-full p-6">
      <Card className="w-full max-w-md backdrop-blur-sm">
        <CardHeader className="text-center">
          <CardTitle>Change Password</CardTitle>
          <CardDescription>Update your account password</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Input
              type="password"
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            <div>
              <Input
                type="password"
                placeholder="New password (min 8 chars)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
                className={newPassword ? `border-${cfg.color.replace('text-', '')}` : ''}
              />
              {newPassword && (
                <>
                  <Progress value={cfg.pct} className="mt-2 h-1" />
                  <p className={`text-xs text-right mt-1 ${cfg.color}`}>{cfg.label}</p>
                </>
              )}
            </div>
            <Input
              type="password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => router.push('/')}>Cancel</Button>
              <Button type="submit" className="flex-1" disabled={submitting}>
                {submitting ? 'Updating...' : 'Update'}
              </Button>
            </div>
          </form>
          {error && <p className="text-destructive text-xs text-center mt-3">{error}</p>}
        </CardContent>
      </Card>
      {toast && (
        <div className={`fixed top-[60px] right-6 z-50 px-4 py-2.5 rounded-lg text-sm font-medium border ${
          toast.type === 'success' ? 'bg-green-950/20 border-green-500 text-green-400' : 'bg-red-950/20 border-red-500 text-red-400'
        }`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
