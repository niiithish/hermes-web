'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/hooks/useAuth';

export default function HomeRedirect() {
  const { user, loading, isFirstRun } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (isFirstRun) {
      router.replace('/setup');
    } else if (!user) {
      router.replace('/login');
    }
    // If user is authed, stay on home page (rendered below)
  }, [user, loading, isFirstRun, router]);

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (!user) {
    return <div className="loading">Redirecting...</div>;
  }

  return <HomePage />;
}

function HomePage() {
  const router = useRouter();

  return (
    <div style={{ padding: '24px', height: '100%', overflowY: 'auto' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>
        Hermes Control Interface
      </h1>
      <p style={{ color: 'var(--fg-muted)', marginBottom: '24px' }}>
        Dashboard — system overview and quick actions
      </p>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: '16px',
      }}>
        <QuickActionCard
          title="Chat"
          description="Talk to your Hermes agents"
          onClick={() => router.push('/chat')}
        />
        <QuickActionCard
          title="Sessions"
          description="Browse agent conversation history"
          onClick={() => router.push('/agents')}
        />
        <QuickActionCard
          title="Usage"
          description="Token usage and cost insights"
          onClick={() => router.push('/usage')}
        />
        <QuickActionCard
          title="Logs"
          description="View real-time agent logs"
          onClick={() => router.push('/logs')}
        />
        <QuickActionCard
          title="Monitor"
          description="System resource monitoring"
          onClick={() => router.push('/mon')}
        />
        <QuickActionCard
          title="Files"
          description="Browse and edit project files"
          onClick={() => router.push('/files')}
        />
      </div>
    </div>
  );
}

function QuickActionCard({ title, description, onClick }: { title: string; description: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px',
        textAlign: 'left',
        cursor: 'pointer',
        backdropFilter: 'blur(8px)',
        transition: 'all var(--transition)',
        fontFamily: 'var(--font)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--accent)';
        e.currentTarget.style.background = 'var(--accent-dim)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.background = 'var(--bg-card)';
      }}
    >
      <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--fg-base)', marginBottom: '6px' }}>
        {title}
      </div>
      <div style={{ fontSize: '12px', color: 'var(--fg-muted)' }}>
        {description}
      </div>
    </button>
  );
}
