'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/hooks/useAuth';
import Topbar from '@/app/components/layout/Topbar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, isFirstRun } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (isFirstRun) {
      router.replace('/setup');
    } else if (!user) {
      router.replace('/login');
    }
  }, [user, loading, isFirstRun, router]);

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (!user) {
    return <div className="loading">Redirecting...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Topbar />
      <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {children}
      </main>
    </div>
  );
}
