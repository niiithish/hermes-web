'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/hooks/useAuth';
import { api } from '@/app/lib/api-client';

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

// ── Shared styles ────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  padding: '18px',
  backdropFilter: 'blur(8px)',
  minHeight: '200px',
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--fg-muted)',
  marginBottom: '14px',
  paddingBottom: '10px',
  borderBottom: '1px solid var(--border)',
};

const statRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '4px 0',
  fontSize: '12px',
};

const statLabelStyle: React.CSSProperties = {
  color: 'var(--fg-muted)',
  flexShrink: 0,
  marginRight: '12px',
};

const statValueStyle: React.CSSProperties = {
  color: 'var(--fg)',
  fontWeight: 500,
  textAlign: 'right',
  wordBreak: 'break-all',
};

const btnPrimaryStyle: React.CSSProperties = {
  background: 'var(--accent)',
  color: 'var(--bg)',
  border: 'none',
  borderRadius: 'var(--radius)',
  padding: '7px 16px',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'var(--font)',
};

const btnGhostStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--fg-muted)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: '7px 14px',
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'var(--font)',
};

// ── HomePage ─────────────────────────────────────────────────────────────────

function HomePage() {
  const router = useRouter();
  const [refreshKey, setRefreshKey] = useState(0);

  // Agent Overview card state
  const [agentData, setAgentData] = useState<Record<string, unknown> | null>(null);
  const [cronJobCount, setCronJobCount] = useState<number | null>(null);
  const [agentLoading, setAgentLoading] = useState(true);
  const [agentError, setAgentError] = useState<string | null>(null);

  // Gateways card state
  const [profiles, setProfiles] = useState<{ name: string; gateway: string }[]>([]);
  const [gwLoading, setGwLoading] = useState(true);

  // Auth card state
  const [authProviders, setAuthProviders] = useState<{ name: string; set: boolean }[]>([]);
  const [authLoading, setAuthLoading] = useState(true);

  // Setup Health card state
  const [setupChecks, setSetupChecks] = useState<{ ok: boolean; label: string; detail?: string }[]>([]);
  const [setupLoading, setSetupLoading] = useState(true);

  const fetchData = useCallback(async () => {
    // Reset states for refresh
    setAgentLoading(true);
    setGwLoading(true);
    setAuthLoading(true);
    setSetupLoading(true);
    setAgentError(null);

    // ── Batch 1: Agent, Profiles, Cron ─────────────────────────────
    try {
      const [agentRes, profilesRes, cronRes] = await Promise.all([
        api.get<Record<string, unknown>>('/api/agent/status').catch(() => null),
        api.get<{ ok: boolean; profiles: { name: string; gateway: string }[] }>('/api/profiles').catch(() => null),
        api.post<{ ok: boolean; jobs: unknown[] }>('/api/cron/list', {}).catch(() => null),
      ]);

      if (agentRes && agentRes.ok) {
        setAgentData(agentRes);
      } else {
        setAgentError((agentRes as { error?: string } | null)?.error || 'Failed to load agent status');
      }

      if (profilesRes && profilesRes.ok) {
        setProfiles(profilesRes.profiles || []);
      } else {
        setProfiles([]);
      }

      if (cronRes && cronRes.ok) {
        setCronJobCount((cronRes.jobs || []).length);
      } else {
        setCronJobCount(0);
      }
    } catch {
      setAgentError('Failed to load system status');
    } finally {
      setAgentLoading(false);
      setGwLoading(false);
    }

    // ── Batch 2: Auth Providers ────────────────────────────────────
    try {
      const authRes = await api.get<{ ok: boolean; providers: { name: string; set: boolean }[] }>('/api/auth/providers');
      if (authRes && authRes.ok) {
        setAuthProviders(authRes.providers || []);
      }
    } catch {
      // leave empty list
    } finally {
      setAuthLoading(false);
    }

    // ── Batch 3: Setup Health ──────────────────────────────────────
    try {
      const checkRes = await api.get<{ ok: boolean; checks: { ok: boolean; label: string; detail?: string }[] }>('/api/setup/check');
      if (checkRes && checkRes.ok) {
        setSetupChecks(checkRes.checks || []);
      }
    } catch {
      // leave empty
    } finally {
      setSetupLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshKey]);

  // ── Helpers ──────────────────────────────────────────────────────

  function statusColor(running: boolean): string {
    return running ? 'var(--green)' : 'var(--red)';
  }

  function gatewayStatusIcon(status: string | undefined): { color: string; text: string } {
    if (status && status.includes('running')) {
      return { color: 'var(--green)', text: '● running' };
    }
    return { color: 'var(--red)', text: '○ stopped' };
  }

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div style={{ padding: '24px', height: '100%', overflowY: 'auto' }}>
      {/* ── Page Header ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--fg)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Home
          </div>
          <div style={{ fontSize: '12px', color: 'var(--fg-muted)', marginTop: '2px' }}>
            System overview
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            style={btnPrimaryStyle}
            onClick={() => router.push('/chat')}
          >
            ⌘ Terminal
          </button>
          <button
            style={btnGhostStyle}
            onClick={() => setRefreshKey(k => k + 1)}
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* ── 4-Column Card Grid ──────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '16px',
      }}>
        {/* ─── Card 1: Agent Overview ─────────────────────────── */}
        <div style={cardStyle}>
          <div style={cardTitleStyle}>Agent Overview</div>
          {agentLoading ? (
            <div style={{ color: 'var(--fg-muted)', fontSize: '12px' }}>Loading...</div>
          ) : agentError ? (
            <div style={{ color: 'var(--red)', fontSize: '12px' }}>{agentError}</div>
          ) : agentData ? (
            <>
              <StatRow label="Model" value={String(agentData.model || 'N/A')} />
              <StatRow label="Provider" value={String(agentData.provider || 'N/A')} />
              <StatRow
                label="Gateway"
                value={String(agentData.gatewayStatus || 'N/A')}
                valueColor={statusColor(String(agentData.gatewayStatus || '').includes('running'))}
              />
              <StatRow
                label="API Keys"
                value={
                  agentData.apiKeys
                    ? `${(agentData.apiKeys as { active: number; total: number }).active}/${(agentData.apiKeys as { active: number; total: number }).total} active`
                    : 'N/A'
                }
              />
              <StatRow
                label="Platforms"
                value={
                  Array.isArray(agentData.platforms)
                    ? (agentData.platforms as { name: string; configured: boolean }[])
                        .filter(p => p.configured)
                        .map(p => p.name)
                        .join(', ') || 'None'
                    : 'N/A'
                }
              />
              <StatRow label="Cron" value={`${cronJobCount ?? 0} jobs`} />
              <StatRow label="Sessions" value={`${agentData.activeSessions ?? 0} active`} />
            </>
          ) : (
            <div style={{ color: 'var(--fg-muted)', fontSize: '12px' }}>No data available</div>
          )}
        </div>

        {/* ─── Card 2: Gateways ────────────────────────────────── */}
        <div style={cardStyle}>
          <div style={cardTitleStyle}>Gateways</div>
          {gwLoading ? (
            <div style={{ color: 'var(--fg-muted)', fontSize: '12px' }}>Loading...</div>
          ) : profiles.length > 0 ? (
            profiles.map(p => {
              const status = gatewayStatusIcon(p.gateway);
              return (
                <div key={p.name} style={statRowStyle}>
                  <span style={statLabelStyle}>{p.name}</span>
                  <span style={{ ...statValueStyle, color: status.color }}>{status.text}</span>
                </div>
              );
            })
          ) : (
            <div style={statRowStyle}>
              <span style={statLabelStyle}>No profiles</span>
            </div>
          )}
        </div>

        {/* ─── Card 3: Hermes Auth ─────────────────────────────── */}
        <div style={cardStyle}>
          <div style={cardTitleStyle}>Hermes Auth</div>
          {authLoading ? (
            <div style={{ color: 'var(--fg-muted)', fontSize: '12px' }}>Loading auth...</div>
          ) : authProviders.length > 0 ? (
            authProviders.map(p => (
              <div key={p.name} style={statRowStyle}>
                <span style={statLabelStyle}>{p.name}</span>
                <span style={{ ...statValueStyle, color: p.set ? 'var(--green)' : 'var(--red)' }}>
                  {p.set ? '● set' : '○ not set'}
                </span>
              </div>
            ))
          ) : (
            <div style={statRowStyle}>
              <span style={statLabelStyle}>Auth info unavailable</span>
            </div>
          )}
        </div>

        {/* ─── Card 4: Setup Health ────────────────────────────── */}
        <div style={cardStyle}>
          <div style={cardTitleStyle}>Setup Health</div>
          {setupLoading ? (
            <div style={{ color: 'var(--fg-muted)', fontSize: '12px' }}>Checking...</div>
          ) : setupChecks.length > 0 ? (
            setupChecks.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 0', fontSize: '12px' }}>
                <span style={{ color: c.ok ? 'var(--green)' : 'var(--red)' }}>{c.ok ? '✅' : '❌'}</span>
                <span style={{ color: 'var(--fg)' }}>{c.label}</span>
                {c.detail ? (
                  <span style={{ color: 'var(--fg-muted)', fontSize: '11px', marginLeft: 'auto' }}>{c.detail}</span>
                ) : null}
              </div>
            ))
          ) : (
            <div style={{ color: 'var(--fg-muted)', fontSize: '12px' }}>No check data available</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── StatRow helper ───────────────────────────────────────────────────────────

function StatRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div style={statRowStyle}>
      <span style={statLabelStyle}>{label}</span>
      <span style={{ ...statValueStyle, color: valueColor ?? 'var(--fg)' }}>{value}</span>
    </div>
  );
}
