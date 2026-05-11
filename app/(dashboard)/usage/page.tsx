'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/app/lib/api-client';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js';
import { Bar, Line, Doughnut } from 'react-chartjs-2';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (!n) return '0';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

const BUDGET_LS_KEY = 'hci-usage-budget';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Profile { name: string; active: boolean; }
interface ModelEntry { name: string; sessions?: number; tokens: number; }
interface PlatformEntry { name: string; sessions: number; tokens: number; }
interface ToolEntry { name: string; calls: number; pct: string; }
interface DailyRow { date: string; input_tokens: number; output_tokens: number; cache_read_tokens: number; cost: number; }
interface UsageOverview {
  sessions: number; messages: number; inputTokens: number; outputTokens: number;
  totalTokens: number; cost: string; activeTime: string; avgSession: string;
  models: ModelEntry[]; platforms: PlatformEntry[]; topTools: ToolEntry[];
}
interface DailyResponse {
  ok: boolean; daily: DailyRow[];
  byModel: { name?: string; model?: string; tokens?: number; total_tokens?: number }[];
}
interface BudgetStatus { over: boolean; percentage: number; }

// ─── Component ───────────────────────────────────────────────────────────────

export default function UsagePage() {
  const [days, setDays] = useState('7');
  const [agent, setAgent] = useState('');
  const [budget, setBudget] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(BUDGET_LS_KEY);
      return stored ? parseFloat(stored) || 0 : 0;
    }
    return 0;
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [overview, setOverview] = useState<UsageOverview | null>(null);
  const [daily, setDaily] = useState<DailyResponse | null>(null);
  const [budgetStatus, setBudgetStatus] = useState<BudgetStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getProfiles().then(res => {
      if (!cancelled && res.ok && res.profiles) setProfiles(res.profiles);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleBudgetChange = useCallback((val: number) => {
    setBudget(val);
    if (val > 0) localStorage.setItem(BUDGET_LS_KEY, String(val));
    else localStorage.removeItem(BUDGET_LS_KEY);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = agent ? `?profile=${encodeURIComponent(agent)}` : '';
      const [usageRes, dailyRes] = await Promise.all([
        api.get<{ ok: boolean; sessions: number; messages: number; inputTokens: number; outputTokens: number; totalTokens: number; cost: string; activeTime: string; avgSession: string; models: ModelEntry[]; platforms: PlatformEntry[]; topTools: ToolEntry[]; error?: string }>(`/api/usage/${days}${query}`),
        api.get<DailyResponse>(`/api/usage/daily/${days}${query}`),
      ]);
      if (!usageRes.ok) { setError((usageRes as { error?: string }).error || 'Failed to load'); return; }
      const ov: UsageOverview = {
        sessions: usageRes.sessions ?? 0, messages: usageRes.messages ?? 0,
        inputTokens: usageRes.inputTokens ?? 0, outputTokens: usageRes.outputTokens ?? 0,
        totalTokens: usageRes.totalTokens ?? 0, cost: usageRes.cost || '$0.00',
        activeTime: usageRes.activeTime || '—', avgSession: usageRes.avgSession || '—',
        models: usageRes.models || [], platforms: usageRes.platforms || [], topTools: usageRes.topTools || [],
      };
      setOverview(ov);
      setDaily(dailyRes.ok ? dailyRes : null);

      if (budget > 0 && dailyRes.ok && dailyRes.daily && dailyRes.daily.length > 0) {
        const costData = dailyRes.daily.map((r: DailyRow) => r.cost || 0);
        const totalCost = costData.reduce((s: number, v: number) => s + v, 0);
        let weightedSum = 0, weightTotal = 0;
        for (let i = 0; i < costData.length; i++) {
          const w = Math.pow(0.85, costData.length - 1 - i);
          weightedSum += costData[i] * w; weightTotal += w;
        }
        const avgDailyCost = weightTotal > 0 ? weightedSum / weightTotal : 0;
        const simpleAvg = costData.length > 0 ? totalCost / costData.length : 0;
        const projAvg = costData.length >= 3 ? avgDailyCost : simpleAvg;
        const monthlyPace = projAvg * 30;
        if (monthlyPace > budget) {
          setBudgetStatus({ over: true, percentage: ((monthlyPace / budget - 1) * 100) });
        } else {
          setBudgetStatus({ over: false, percentage: ((1 - monthlyPace / budget) * 100) });
        }
      } else {
        setBudgetStatus(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load usage data');
    } finally { setLoading(false); }
  }, [days, agent, budget]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Chart config
  const chartTextColor = 'var(--foreground)';
  const chartGridColor = 'rgba(220,203,181,0.08)';
  const chartColors = ['#ffac02', '#4ecdc4', '#ff6b6b', '#a78bfa', '#34d399', '#60a5fa', '#fb923c', '#f472b6'];

  function getTokenChartData() {
    const hasDaily = !!(daily && daily.daily && daily.daily.length > 0);
    let labels: string[], datasets: any[], stacked = true;
    if (hasDaily) {
      labels = daily!.daily.map(r => r.date);
      datasets = [
        { label: 'Input', data: daily!.daily.map(r => r.input_tokens || 0), backgroundColor: '#ffac02', borderRadius: 4 },
        { label: 'Output', data: daily!.daily.map(r => r.output_tokens || 0), backgroundColor: '#4ecdc4', borderRadius: 4 },
        { label: 'Cache', data: daily!.daily.map(r => r.cache_read_tokens || 0), backgroundColor: '#a78bfa', borderRadius: 4 },
      ];
    } else if (overview?.models && overview.models.length > 0) {
      const top = overview.models.slice(0, 8);
      labels = top.map(m => m.name);
      datasets = [{ label: 'Tokens', data: top.map(m => m.tokens || 0), backgroundColor: chartColors.slice(0, 8), borderRadius: 4 }];
      stacked = false;
    } else { labels = []; datasets = []; }
    return {
      labels, datasets,
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: hasDaily, labels: { color: chartTextColor, font: { size: 10 } } } },
        scales: {
          x: { stacked, ticks: { color: chartTextColor, maxRotation: 45, font: { size: 10 } }, grid: { color: chartGridColor } },
          y: { stacked, ticks: { color: chartTextColor, callback: (v: any) => formatNumber(Number(v)), font: { size: 10 } }, grid: { color: chartGridColor } },
        },
      } as const,
    };
  }

  function getCostChartData() {
    if (!daily?.daily || daily.daily.length === 0) {
      if (overview?.models && overview.models.length > 0) {
        const top = overview.models.slice(0, 6);
        return {
          labels: top.map(m => m.name),
          datasets: [{ label: 'Sessions', data: top.map(m => m.sessions || 0), backgroundColor: chartColors.slice(0, 6), borderRadius: 4 }],
          options: {
            responsive: true, maintainAspectRatio: false, indexAxis: 'y' as const,
            plugins: { legend: { display: false } },
            scales: { x: { ticks: { color: chartTextColor }, grid: { color: chartGridColor } }, y: { ticks: { color: chartTextColor }, grid: { color: chartGridColor } } },
          },
        };
      }
      return null;
    }
    const costData = daily.daily.map(r => r.cost || 0);
    const baseLabels = daily.daily.map(r => r.date);
    const totalCost = costData.reduce((s: number, v: number) => s + v, 0);
    let weightedSum = 0, weightTotal = 0;
    for (let i = 0; i < costData.length; i++) { const w = Math.pow(0.85, costData.length - 1 - i); weightedSum += costData[i] * w; weightTotal += w; }
    const avgDailyCost = weightTotal > 0 ? weightedSum / weightTotal : 0;
    const simpleAvg = costData.length > 0 ? totalCost / costData.length : 0;
    const projAvg = costData.length >= 3 ? avgDailyCost : simpleAvg;
    const today = new Date(); const year = today.getFullYear(); const month = today.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const endOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
    const extendedLabels = [...baseLabels];
    const projectionData: (number | null)[] = new Array(baseLabels.length).fill(null);
    let cursor = new Date(baseLabels[baseLabels.length - 1] + 'T00:00:00');
    const endDate = new Date(endOfMonth + 'T00:00:00');
    while (cursor < endDate) { cursor.setDate(cursor.getDate() + 1); extendedLabels.push(cursor.toISOString().slice(0, 10)); projectionData.push(null); }
    const cumulativeActual: number[] = []; let cumSum = 0;
    for (const c of costData) { cumSum += c; cumulativeActual.push(cumSum); }
    const lastCumCost = cumulativeActual.length > 0 ? cumulativeActual[cumulativeActual.length - 1] : 0;
    const projStart = baseLabels.length;
    for (let i = 0; i < projectionData.length - projStart; i++) { projectionData[projStart + i] = lastCumCost + projAvg * (i + 1); }
    const actualPadded = [...cumulativeActual, ...new Array(extendedLabels.length - cumulativeActual.length).fill(null)];
    const datasets: any[] = [
      { label: 'Cumulative Cost ($)', data: actualPadded, borderColor: '#ffac02', backgroundColor: 'rgba(255,172,2,0.1)', fill: true, tension: 0.3, pointRadius: 3, spanGaps: false },
      { label: 'Monthly Projection', data: projectionData, borderColor: 'rgba(255,172,2,0.45)', borderDash: [6, 4], backgroundColor: 'transparent', fill: false, tension: 0.3, pointRadius: 0, spanGaps: false },
    ];
    if (budget > 0) datasets.push({ label: `Budget ($${budget})`, data: new Array(extendedLabels.length).fill(budget), borderColor: '#ff6b6b', borderDash: [8, 4], backgroundColor: 'transparent', fill: false, pointRadius: 0, borderWidth: 2, spanGaps: true });
    return {
      labels: extendedLabels, datasets, monthlyPace: projAvg * 30,
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: true, labels: { color: chartTextColor, font: { size: 10 }, boxWidth: 12, padding: 8 } }, tooltip: { callbacks: { label: (ctx: any) => `${ctx.dataset.label}: $${ctx.parsed.y.toFixed(4)}` } } },
        scales: { x: { ticks: { color: chartTextColor, maxRotation: 45, font: { size: 10 } }, grid: { color: chartGridColor } }, y: { ticks: { color: chartTextColor, callback: (v: any) => '$' + Number(v).toFixed(2), font: { size: 10 } }, grid: { color: chartGridColor }, beginAtZero: true } },
      } as const,
    };
  }

  function getModelChartData() {
    const models = daily?.byModel || overview?.models || [];
    if (!models || models.length === 0) return null;
    const top = models.slice(0, 6);
    return {
      labels: top.map(m => m.name || (m as any).model),
      datasets: [{ data: top.map(m => m.tokens || (m as any).total_tokens || 0), backgroundColor: chartColors.slice(0, 6), borderWidth: 0 }],
      options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'bottom' as const, labels: { color: chartTextColor, font: { size: 10 }, padding: 8 } } } } as const,
    };
  }

  const tokenChart = getTokenChartData();
  const costChart = getCostChartData();
  const modelChart = getModelChartData();

  return (
    <div className="p-6 h-full overflow-y-auto space-y-4">
      {/* Page Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-xl font-bold tracking-wider uppercase">Usage &amp; Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">Token usage, costs, and activity breakdown</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <select value={days} onChange={e => setDays(e.target.value)} className="h-7 rounded-md border border-input bg-input/20 px-2 text-xs">
            <option value="1">Today</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option>
          </select>
          <select value={agent} onChange={e => setAgent(e.target.value)} className="h-7 rounded-md border border-input bg-input/20 px-2 text-xs">
            <option value="">All agents</option>
            {profiles.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            {loading ? <><Spinner className="size-3" /> Loading...</> : 'Apply'}
          </Button>
          <div className="flex items-center gap-1">
            <label className="text-xs text-muted-foreground whitespace-nowrap">Budget $</label>
            <Input type="number" value={budget || ''} onChange={e => handleBudgetChange(parseFloat(e.target.value) || 0)} min={0} step={1} placeholder="0" className="w-20 h-7 text-xs" />
          </div>
          {budgetStatus && (
            <Badge variant={budgetStatus.over ? 'destructive' : 'secondary'} className="text-xs">
              {budgetStatus.over ? `Over budget ${budgetStatus.percentage.toFixed(0)}%` : `${budgetStatus.percentage.toFixed(0)}% under`}
            </Badge>
          )}
        </div>
      </div>

      {error && <div className="text-destructive text-sm py-2">{error}</div>}

      {/* Overview stats bar */}
      <Card>
        <CardContent className="pt-4">
          {loading && !overview ? (
            <div className="flex gap-6 flex-wrap items-center text-muted-foreground text-sm"><Spinner className="size-3" /> Loading...</div>
          ) : overview ? (
            <div className="flex gap-6 flex-wrap items-center">
              {[{ label: 'Sessions', value: overview.sessions, color: '#ffac02' },
                { label: 'Messages', value: (overview.messages || 0).toLocaleString(), color: '#ffac02' },
                { label: 'Input Tokens', value: formatNumber(overview.inputTokens), color: '#4ecdc4' },
                { label: 'Output Tokens', value: formatNumber(overview.outputTokens), color: '#ff6b6b' },
                { label: 'Total Tokens', value: formatNumber(overview.totalTokens), color: '#ffac02' },
                { label: 'Est. Cost', value: overview.cost, color: '#ffac02' },
              ].map((stat, i) => (
                <div key={i} className="text-center min-w-[60px]">
                  <div className="text-lg font-bold" style={{ color: stat.color }}>{stat.value}</div>
                  <div className="text-[10px] text-muted-foreground">{stat.label}</div>
                </div>
              ))}
              <div className="text-center min-w-[80px]">
                <div className="text-base font-semibold text-muted-foreground">{overview.activeTime}</div>
                <div className="text-[10px] text-muted-foreground">Active Time</div>
              </div>
              <div className="text-center min-w-[80px]">
                <div className="text-base font-semibold text-muted-foreground">{overview.avgSession}</div>
                <div className="text-[10px] text-muted-foreground">Avg Session</div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Charts: 2-column layout */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Daily Token Trend</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[200px]">
              {tokenChart && tokenChart.labels.length > 0 ? (
                <Bar data={{ labels: tokenChart.labels, datasets: tokenChart.datasets }} options={tokenChart.options} />
              ) : <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No data available</div>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Daily Cost
              {costChart && 'monthlyPace' in costChart && (
                <span className="text-xs font-normal text-muted-foreground">· ~${(costChart as any).monthlyPace.toFixed(2)}/mo pace</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="h-[140px]">
              {costChart ? <Line data={{ labels: costChart.labels, datasets: costChart.datasets }} options={costChart.options} /> : <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No data available</div>}
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Model Distribution</div>
              <div className="h-[160px]">
                {modelChart ? <Doughnut data={{ labels: modelChart.labels, datasets: modelChart.datasets }} options={modelChart.options} /> : <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No data available</div>}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Models + Platforms + Top Tools */}
      <div className="grid grid-cols-3 gap-4">
        {[{
          title: 'Models', data: overview?.models,
          render: (m: ModelEntry, i: number) => <span key={i}>{m.name}: {m.sessions} · {formatNumber(m.tokens)}</span>
        }, {
          title: 'Platforms', data: overview?.platforms,
          render: (p: PlatformEntry, i: number) => <span key={i}>{p.name}: {p.sessions} · {formatNumber(p.tokens)}</span>
        }, {
          title: 'Top Tools', data: overview?.topTools?.slice(0, 5),
          render: (t: ToolEntry, i: number) => <span key={i}>{t.name}: {t.calls} ({t.pct})</span>
        }].map((section, si) => (
          <Card key={si}>
            <CardHeader><CardTitle>{section.title}</CardTitle></CardHeader>
            <CardContent>
              {section.data && section.data.length > 0 ? (
                <div className="space-y-1">
                  {(section.data as any[]).map((item: any, i: number) => (
                    <div key={i} className="flex justify-between items-center py-1 border-b border-border last:border-0 text-sm">
                      <span className="text-muted-foreground">{item.name}</span>
                      <span className="font-medium">{section.render(item, i)}</span>
                    </div>
                  ))}
                </div>
              ) : <div className="text-muted-foreground text-sm">No data</div>}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
