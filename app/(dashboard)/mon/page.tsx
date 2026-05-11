'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '@/app/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { RiRefreshLine } from '@remixicon/react';

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

function getBarVariant(pct: number): 'danger' | 'warning' | 'success' {
  if (pct > 80) return 'danger';
  if (pct > 60) return 'warning';
  return 'success';
}

const variantClasses: Record<string, string> = {
  danger: 'text-red-500',
  warning: 'text-yellow-500',
  success: 'text-green-500',
};

// ─── Component ─────────────────────────────────────────────────────────────────

export default function MonitorPage() {
  const [data, setData] = useState<MonitoringResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await api.get<MonitoringResponse>('/api/monitoring');
      if (res.ok) {
        setData(res);
        setError(null);
      } else {
        setError((res as { error?: string }).error || 'Failed to load metrics');
      }
    } catch {
      // Silent on refresh
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
    intervalRef.current = setInterval(fetchMetrics, 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchMetrics]);

  const cpuPct = data?.cpu_pct ?? (parseFloat(data?.cpu || '0') || 0);
  const memPct = data?.mem_pct ?? 0;
  const diskPct = data?.disk_pct ?? 0;
  const cpuVar = getBarVariant(cpuPct);
  const memVar = getBarVariant(memPct);
  const diskVar = getBarVariant(diskPct);

  return (
    <div className="p-6 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex justify-between items-start mb-4">
        <div>
          <h1 className="text-xl font-bold tracking-wider uppercase">System Monitor</h1>
          <p className="text-sm text-muted-foreground mt-1">Real-time system resource metrics</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchMetrics}>
          <RiRefreshLine className="mr-1 h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {error && (
        <Card className="mb-4 border-destructive">
          <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-10 text-muted-foreground italic text-sm">
          Loading metrics...
        </div>
      )}

      {data && (
        <>
          {/* Overview Bar */}
          <div className="flex flex-wrap border rounded-lg overflow-hidden mb-4 bg-card">
            {[
              { label: 'CPU', value: data.cpu || '—' },
              { label: 'Memory', value: data.memory || '—' },
              { label: 'Disk', value: data.disk || '—' },
              { label: 'Processes', value: data.processes ?? 0 },
              { label: 'Load', value: [data.load?.avg1, data.load?.avg5, data.load?.avg15].filter(Boolean).join(', ') || '—' },
            ].map((item, i, arr) => (
              <div
                key={item.label}
                className={`flex-1 min-w-[120px] flex flex-col items-center gap-1 px-4 py-3 ${i < arr.length - 1 ? 'border-r' : ''}`}
              >
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{item.label}</span>
                <span className="text-lg font-bold">{item.value}</span>
              </div>
            ))}
          </div>

          {/* Resource Cards */}
          <div className="grid grid-cols-4 gap-4 mb-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wider">CPU Usage</CardTitle></CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{data.cpu?.replace('%', '') || '—'}</div>
                <div className="text-sm text-muted-foreground">%</div>
                <Progress value={cpuPct} className="mt-3 h-1.5" />
                <p className={`text-xs font-semibold mt-2 ${variantClasses[cpuVar]}`}>{cpuPct.toFixed(1)}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wider">Memory</CardTitle></CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{(data.memory || '—').split(' ')[0] || '—'}</div>
                <div className="text-sm text-muted-foreground">{(data.memory || '').includes('MB') ? 'MB' : '—'}</div>
                <Progress value={memPct} className="mt-3 h-1.5" />
                <p className={`text-xs font-semibold mt-2 ${variantClasses[memVar]}`}>{memPct.toFixed(1)}% used</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wider">Disk</CardTitle></CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{(data.disk || '—').split(' ')[0] || '—'}</div>
                <div className="text-sm text-muted-foreground">{(data.disk || '—').split(' ').slice(1).join(' ') || '—'}</div>
                <Progress value={diskPct} className="mt-3 h-1.5" />
                <p className={`text-xs font-semibold mt-2 ${variantClasses[diskVar]}`}>{diskPct.toFixed(1)}% used</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wider">Processes</CardTitle></CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{data.processes ?? 0}</div>
                <div className="text-sm text-muted-foreground">running</div>
                <div className="mt-3">
                  <p className="text-[10px] text-muted-foreground mb-1.5 uppercase font-semibold">Load Averages</p>
                  <div className="flex gap-4">
                    {[
                      { v: data.load?.avg1, l: '1m' },
                      { v: data.load?.avg5, l: '5m' },
                      { v: data.load?.avg15, l: '15m' },
                    ].map(({ v, l }) => (
                      <div key={l} className="flex flex-col items-center gap-0.5">
                        <span className="text-base font-bold">{v || '—'}</span>
                        <span className="text-[10px] uppercase font-semibold text-muted-foreground">{l}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Info Cards */}
          <div className="grid grid-cols-3 gap-4 mb-4">
            <Card>
              <CardHeader><CardTitle className="text-xs uppercase tracking-wider">Load Average</CardTitle></CardHeader>
              <CardContent className="flex gap-6">
                {[
                  { v: data.load?.avg1, l: '1m' },
                  { v: data.load?.avg5, l: '5m' },
                  { v: data.load?.avg15, l: '15m' },
                ].map(({ v, l }) => (
                  <div key={l} className="flex flex-col items-center gap-0.5">
                    <span className="text-lg font-bold">{v || '—'}</span>
                    <span className="text-[10px] uppercase font-semibold text-muted-foreground">{l}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-xs uppercase tracking-wider">Network I/O</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Interface</span><span className="font-medium">{data.network?.interface || '—'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Bytes</span><span className="font-medium">{formatNumber(parseInt(data.network?.bytes || '') || 0)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Packets</span><span className="font-medium">{formatNumber(parseInt(data.network?.packets || '') || 0)}</span></div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-xs uppercase tracking-wider">Node.js Memory</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">RSS</span><span className="font-medium">{data.node_memory?.rss_mb != null ? `${data.node_memory.rss_mb} MB` : '—'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Heap Used</span><span className="font-medium">{data.node_memory?.heap_used_mb != null ? `${data.node_memory.heap_used_mb} MB` : '—'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Heap Total</span><span className="font-medium">{data.node_memory?.heap_total_mb != null ? `${data.node_memory.heap_total_mb} MB` : '—'}</span></div>
              </CardContent>
            </Card>
          </div>

          {/* Bottom row */}
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-xs uppercase tracking-wider">Uptime</CardTitle></CardHeader>
              <CardContent className="text-lg font-semibold">{data.uptime || '—'}</CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-xs uppercase tracking-wider">Versions</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">HCI</span><span className="font-medium">{data.hci_version || '—'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Hermes</span><span className="font-medium">{data.hermes_version || '—'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Node.js</span><span className="font-medium">{data.node_version || '—'}</span></div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
