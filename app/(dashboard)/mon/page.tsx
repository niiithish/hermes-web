'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '@/app/lib/api-client';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MonitoringResponse {
  ok: boolean;
  cpu?: string;
  cpu_pct?: number;
  memory?: string;
  mem_pct?: number;
  disk?: string;
  disk_pct?: number;
  processes?: number;
  load?: { avg1: string; avg5: string; avg15: string };
  network?: { interface: string; bytes: string; packets: string };
  node_memory?: { rss_mb: number; heap_used_mb: number; heap_total_mb: number };
  uptime?: string;
  hci_version?: string;
  hermes_version?: string;
  node_version?: string;
  error?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (!n) return '0';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function getBarColor(pct: number): string {
  if (pct > 80) return 'var(--danger, #ef4444)';
  if (pct > 60) return 'var(--warning, #eab308)';
  return 'var(--success, #22c55e)';
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  container: {
    padding: '24px',
    height: '100%',
    overflowY: 'auto',
  } as React.CSSProperties,

  pageHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '16px',
  } as React.CSSProperties,

  pageTitle: {
    fontSize: '20px',
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: 'var(--fg)',
  } as React.CSSProperties,

  pageSubtitle: {
    fontSize: '13px',
    color: 'var(--fg-muted)',
    marginTop: '4px',
  } as React.CSSProperties,

  refreshBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '6px 16px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius, 6px)',
    background: 'var(--bg-panel)',
    color: 'var(--fg)',
    fontFamily: 'var(--font, monospace)',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap',
  } as React.CSSProperties,

  // Overview bar
  overviewBar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0',
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius, 6px)',
    overflow: 'hidden',
    marginBottom: '16px',
  } as React.CSSProperties,

  overviewItem: {
    flex: '1 1 0',
    minWidth: '120px',
    padding: '12px 16px',
    borderRight: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
  } as React.CSSProperties,

  overviewLabel: {
    fontSize: '10px',
    fontWeight: 600,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: 'var(--fg-muted)',
  } as React.CSSProperties,

  overviewValue: {
    fontSize: '18px',
    fontWeight: 700,
    color: 'var(--fg)',
    textAlign: 'center',
  } as React.CSSProperties,

  // Card grid
  cardGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '16px',
    marginBottom: '16px',
  } as React.CSSProperties,

  cardGrid3: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '16px',
    marginBottom: '16px',
  } as React.CSSProperties,

  cardGrid2: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '16px',
  } as React.CSSProperties,

  card: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius, 6px)',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
  } as React.CSSProperties,

  cardTitle: {
    fontSize: '12px',
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: 'var(--fg-muted)',
    marginBottom: '12px',
  } as React.CSSProperties,

  bigValue: {
    fontSize: '36px',
    fontWeight: 700,
    color: 'var(--fg)',
    lineHeight: 1.2,
  } as React.CSSProperties,

  bigValueSm: {
    fontSize: '16px',
    fontWeight: 700,
    color: 'var(--fg)',
  } as React.CSSProperties,

  subtitle: {
    fontSize: '12px',
    color: 'var(--fg-muted)',
    marginTop: '2px',
  } as React.CSSProperties,

  // Progress bar
  progressTrack: {
    width: '100%',
    height: '6px',
    background: 'var(--bg-input)',
    borderRadius: '3px',
    marginTop: '12px',
    overflow: 'hidden',
  } as React.CSSProperties,

  progressFill: (pct: number, color: string): React.CSSProperties => ({
    height: '100%',
    width: `${Math.min(pct, 100)}%`,
    background: color,
    borderRadius: '3px',
    transition: 'width 0.4s ease, background 0.4s ease',
  }),

  progressLabel: (color: string): React.CSSProperties => ({
    fontSize: '11px',
    fontWeight: 600,
    color,
    marginTop: '6px',
  }),

  // Stat row
  statRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '4px 0',
  } as React.CSSProperties,

  statLabel: {
    fontSize: '12px',
    color: 'var(--fg-muted)',
  } as React.CSSProperties,

  statValue: {
    fontSize: '12px',
    fontWeight: 500,
    color: 'var(--fg)',
    textAlign: 'right',
  } as React.CSSProperties,

  // Load averages inline
  loadGroup: {
    display: 'flex',
    gap: '16px',
    alignItems: 'baseline',
  } as React.CSSProperties,

  loadItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px',
  } as React.CSSProperties,

  loadValue: {
    fontSize: '16px',
    fontWeight: 700,
    color: 'var(--fg)',
  } as React.CSSProperties,

  loadLabel: {
    fontSize: '10px',
    fontWeight: 600,
    textTransform: 'uppercase',
    color: 'var(--fg-muted)',
  } as React.CSSProperties,

  // Loading / Error
  errorBox: {
    color: 'var(--danger, #ef4444)',
    fontSize: '13px',
    padding: '12px 16px',
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius, 6px)',
    marginBottom: '16px',
  } as React.CSSProperties,
};

// ─── Component ─────────────────────────────────────────────────────────────────

export default function MonitorPage() {
  const [data, setData] = useState<MonitoringResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch metrics ───────────────────────────────────────────────────────────

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await api.get<MonitoringResponse>('/api/monitoring');
      if (res.ok) {
        setData(res);
        setError(null);
      } else {
        const errMsg = (res as { error?: string }).error || 'Failed to load metrics';
        setError(errMsg);
      }
    } catch {
      // Silent fail on refresh errors
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Initial load + auto-refresh (5s) ────────────────────────────────────────

  useEffect(() => {
    fetchMetrics();

    intervalRef.current = setInterval(() => {
      fetchMetrics();
    }, 5000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetchMetrics]);

  // ── Derived values ──────────────────────────────────────────────────────────

  const cpuRaw = data?.cpu?.replace('%', '') || '—';
  const cpuPct = data?.cpu_pct ?? (parseFloat(data?.cpu || '0') || 0);
  const memRaw = (data?.memory || '—').split(' ')[0] || '—';
  const memUnit = (data?.memory || '').includes('MB') ? 'MB' : '';
  const memPct = data?.mem_pct ?? 0;
  const diskRaw = (data?.disk || '—').split(' ')[0] || '—';
  const diskUnit = (data?.disk || '—').split(' ').slice(1).join(' ') || '';
  const diskPct = data?.disk_pct ?? 0;

  const barColorCpu = getBarColor(cpuPct);
  const barColorMem = getBarColor(memPct);
  const barColorDisk = getBarColor(diskPct);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={styles.container}>
      {/* ===== Page Header ===== */}
      <div style={styles.pageHeader}>
        <div>
          <div style={styles.pageTitle}>System Monitor</div>
          <div style={styles.pageSubtitle}>Real-time system resource metrics</div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            style={styles.refreshBtn}
            onClick={fetchMetrics}
            title="Refresh metrics"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* ===== Error ===== */}
      {error && (
        <div style={styles.errorBox}>{error}</div>
      )}

      {/* ===== Loading ===== */}
      {loading && !data && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px',
          color: 'var(--fg-muted)',
          fontStyle: 'italic',
          fontSize: '13px',
        }}>
          Loading metrics…
        </div>
      )}

      {data && (
        <>
          {/* ===== Overview Bar ===== */}
          <div style={styles.overviewBar}>
            <div style={{ ...styles.overviewItem, borderRight: '1px solid var(--border)' }}>
              <div style={styles.overviewLabel}>CPU</div>
              <div style={styles.overviewValue}>{data.cpu || '—'}</div>
            </div>
            <div style={{ ...styles.overviewItem, borderRight: '1px solid var(--border)' }}>
              <div style={styles.overviewLabel}>Memory</div>
              <div style={styles.overviewValue}>{data.memory || '—'}</div>
            </div>
            <div style={{ ...styles.overviewItem, borderRight: '1px solid var(--border)' }}>
              <div style={styles.overviewLabel}>Disk</div>
              <div style={styles.overviewValue}>{data.disk || '—'}</div>
            </div>
            <div style={{ ...styles.overviewItem, borderRight: '1px solid var(--border)' }}>
              <div style={styles.overviewLabel}>Processes</div>
              <div style={styles.overviewValue}>{data.processes ?? 0}</div>
            </div>
            <div style={{ ...styles.overviewItem, borderRight: 'none' }}>
              <div style={styles.overviewLabel}>Load</div>
              <div style={styles.overviewValue}>
                {data.load?.avg1 || '—'}, {data.load?.avg5 || '—'}, {data.load?.avg15 || '—'}
              </div>
            </div>
          </div>

          {/* ===== Primary Metrics Grid (4 cards) ===== */}
          <div style={styles.cardGrid}>
            {/* CPU Usage */}
            <div style={styles.card}>
              <div style={styles.cardTitle}>CPU Usage</div>
              <div style={styles.bigValue}>{cpuRaw}</div>
              <div style={styles.subtitle}>%</div>
              <div style={styles.progressTrack}>
                <div style={styles.progressFill(cpuPct, barColorCpu)} />
              </div>
              <div style={styles.progressLabel(barColorCpu)}>
                {cpuPct.toFixed(1)}%
              </div>
            </div>

            {/* Memory */}
            <div style={styles.card}>
              <div style={styles.cardTitle}>Memory</div>
              <div style={styles.bigValue}>{memRaw}</div>
              <div style={styles.subtitle}>{memUnit || '—'}</div>
              <div style={styles.progressTrack}>
                <div style={styles.progressFill(memPct, barColorMem)} />
              </div>
              <div style={styles.progressLabel(barColorMem)}>
                {memPct.toFixed(1)}% used
              </div>
            </div>

            {/* Disk */}
            <div style={styles.card}>
              <div style={styles.cardTitle}>Disk</div>
              <div style={styles.bigValue}>{diskRaw}</div>
              <div style={styles.subtitle}>{diskUnit || '—'}</div>
              <div style={styles.progressTrack}>
                <div style={styles.progressFill(diskPct, barColorDisk)} />
              </div>
              <div style={styles.progressLabel(barColorDisk)}>
                {diskPct.toFixed(1)}% used
              </div>
            </div>

            {/* Processes */}
            <div style={styles.card}>
              <div style={styles.cardTitle}>Processes</div>
              <div style={styles.bigValue}>{data.processes ?? 0}</div>
              <div style={styles.subtitle}>running</div>
              <div style={{ marginTop: '12px' }}>
                <div style={{ fontSize: '11px', color: 'var(--fg-muted)', marginBottom: '4px' }}>
                  Load Averages
                </div>
                <div style={styles.loadGroup}>
                  <div style={styles.loadItem}>
                    <div style={styles.loadValue}>{data.load?.avg1 || '—'}</div>
                    <div style={styles.loadLabel}>1m</div>
                  </div>
                  <div style={styles.loadItem}>
                    <div style={styles.loadValue}>{data.load?.avg5 || '—'}</div>
                    <div style={styles.loadLabel}>5m</div>
                  </div>
                  <div style={styles.loadItem}>
                    <div style={styles.loadValue}>{data.load?.avg15 || '—'}</div>
                    <div style={styles.loadLabel}>15m</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ===== Secondary Metrics Grid (3 cards) ===== */}
          <div style={styles.cardGrid3}>
            {/* Load Average */}
            <div style={styles.card}>
              <div style={styles.cardTitle}>Load Average</div>
              <div style={styles.loadGroup}>
                <div style={styles.loadItem}>
                  <div style={styles.loadValue}>{data.load?.avg1 || '—'}</div>
                  <div style={styles.loadLabel}>1m</div>
                </div>
                <div style={styles.loadItem}>
                  <div style={styles.loadValue}>{data.load?.avg5 || '—'}</div>
                  <div style={styles.loadLabel}>5m</div>
                </div>
                <div style={styles.loadItem}>
                  <div style={styles.loadValue}>{data.load?.avg15 || '—'}</div>
                  <div style={styles.loadLabel}>15m</div>
                </div>
              </div>
            </div>

            {/* Network I/O */}
            <div style={styles.card}>
              <div style={styles.cardTitle}>Network I/O</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={styles.statRow}>
                  <span style={styles.statLabel}>Interface</span>
                  <span style={styles.statValue}>{data.network?.interface || '—'}</span>
                </div>
                <div style={styles.statRow}>
                  <span style={styles.statLabel}>Bytes</span>
                  <span style={styles.statValue}>
                    {formatNumber(parseInt(data.network?.bytes || '') || 0)}
                  </span>
                </div>
                <div style={styles.statRow}>
                  <span style={styles.statLabel}>Packets</span>
                  <span style={styles.statValue}>
                    {formatNumber(parseInt(data.network?.packets || '') || 0)}
                  </span>
                </div>
              </div>
            </div>

            {/* Node.js Memory */}
            <div style={styles.card}>
              <div style={styles.cardTitle}>Node.js Memory</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={styles.statRow}>
                  <span style={styles.statLabel}>RSS</span>
                  <span style={styles.statValue}>
                    {data.node_memory?.rss_mb != null ? `${data.node_memory.rss_mb} MB` : '—'}
                  </span>
                </div>
                <div style={styles.statRow}>
                  <span style={styles.statLabel}>Heap Used</span>
                  <span style={styles.statValue}>
                    {data.node_memory?.heap_used_mb != null ? `${data.node_memory.heap_used_mb} MB` : '—'}
                  </span>
                </div>
                <div style={styles.statRow}>
                  <span style={styles.statLabel}>Heap Total</span>
                  <span style={styles.statValue}>
                    {data.node_memory?.heap_total_mb != null ? `${data.node_memory.heap_total_mb} MB` : '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ===== System Info Row (2 cards) ===== */}
          <div style={styles.cardGrid2}>
            {/* Uptime */}
            <div style={styles.card}>
              <div style={styles.cardTitle}>Uptime</div>
              <div style={{ fontSize: '18px', fontWeight: 600, color: 'var(--fg)' }}>
                {data.uptime || '—'}
              </div>
            </div>

            {/* Versions */}
            <div style={styles.card}>
              <div style={styles.cardTitle}>Versions</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={styles.statRow}>
                  <span style={styles.statLabel}>HCI</span>
                  <span style={styles.statValue}>{data.hci_version || '—'}</span>
                </div>
                <div style={styles.statRow}>
                  <span style={styles.statLabel}>Hermes</span>
                  <span style={styles.statValue}>{data.hermes_version || '—'}</span>
                </div>
                <div style={styles.statRow}>
                  <span style={styles.statLabel}>Node.js</span>
                  <span style={styles.statValue}>{data.node_version || '—'}</span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
