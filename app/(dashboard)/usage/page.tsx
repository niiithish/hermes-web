'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/app/lib/api-client';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Bar, Line, Doughnut } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (!n) return '0';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

const BUDGET_LS_KEY = 'hci-usage-budget';

// ── Shared styles ────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: '20px',
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--fg)',
  marginBottom: '16px',
};

const selectStyle: React.CSSProperties = {
  padding: '6px 28px 6px 10px',
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  color: 'var(--fg)',
  fontFamily: 'var(--font)',
  fontSize: '11px',
  outline: 'none',
  cursor: 'pointer',
  appearance: 'none',
  WebkitAppearance: 'none',
};

const btnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  padding: '6px 16px',
  fontFamily: 'var(--font)',
  fontSize: '12px',
  fontWeight: 500,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  border: '1px solid color-mix(in oklab, #ffac02 25%, transparent)',
  borderRadius: 'var(--radius)',
  background: 'color-mix(in oklab, #ffac02 15%, transparent)',
  color: 'var(--fg)',
  cursor: 'pointer',
  transition: 'all 0.2s',
  whiteSpace: 'nowrap',
};

const statRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '6px 0',
  borderBottom: '1px solid var(--border)',
  fontSize: '13px',
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
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface Profile {
  name: string;
  active: boolean;
}

interface ModelEntry {
  name: string;
  sessions?: number;
  tokens: number;
}

interface PlatformEntry {
  name: string;
  sessions: number;
  tokens: number;
}

interface ToolEntry {
  name: string;
  calls: number;
  pct: string;
}

interface DailyRow {
  date: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost: number;
}

interface UsageOverview {
  sessions: number;
  messages: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: string;
  activeTime: string;
  avgSession: string;
  models: ModelEntry[];
  platforms: PlatformEntry[];
  topTools: ToolEntry[];
}

interface DailyResponse {
  ok: boolean;
  daily: DailyRow[];
  byModel: { name?: string; model?: string; tokens?: number; total_tokens?: number }[];
}

interface BudgetStatus {
  over: boolean;
  percentage: number;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function UsagePage() {
  // Filter state
  const [days, setDays] = useState('7');
  const [agent, setAgent] = useState('');
  const [budget, setBudget] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(BUDGET_LS_KEY);
      return stored ? parseFloat(stored) || 0 : 0;
    }
    return 0;
  });

  // Data state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [overview, setOverview] = useState<UsageOverview | null>(null);
  const [daily, setDaily] = useState<DailyResponse | null>(null);
  const [budgetStatus, setBudgetStatus] = useState<BudgetStatus | null>(null);

  // ── Load profiles on mount ─────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    api.getProfiles().then(res => {
      if (!cancelled && res.ok && res.profiles) {
        setProfiles(res.profiles);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // ── Persist budget on change ──────────────────────────────────────────

  const handleBudgetChange = useCallback((val: number) => {
    setBudget(val);
    if (val > 0) {
      localStorage.setItem(BUDGET_LS_KEY, String(val));
    } else {
      localStorage.removeItem(BUDGET_LS_KEY);
    }
  }, []);

  // ── Fetch usage data ──────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = agent ? `?profile=${encodeURIComponent(agent)}` : '';
      const [usageRes, dailyRes] = await Promise.all([
        api.get<{ ok: boolean; sessions: number; messages: number; inputTokens: number; outputTokens: number; totalTokens: number; cost: string; activeTime: string; avgSession: string; models: ModelEntry[]; platforms: PlatformEntry[]; topTools: ToolEntry[]; error?: string }>(`/api/usage/${days}${query}`),
        api.get<DailyResponse>(`/api/usage/daily/${days}${query}`),
      ]);

      if (!usageRes.ok) {
        setError((usageRes as { error?: string }).error || 'Failed to load usage data');
        return;
      }

      const ov: UsageOverview = {
        sessions: usageRes.sessions ?? 0,
        messages: usageRes.messages ?? 0,
        inputTokens: usageRes.inputTokens ?? 0,
        outputTokens: usageRes.outputTokens ?? 0,
        totalTokens: usageRes.totalTokens ?? 0,
        cost: usageRes.cost || '$0.00',
        activeTime: usageRes.activeTime || '—',
        avgSession: usageRes.avgSession || '—',
        models: usageRes.models || [],
        platforms: usageRes.platforms || [],
        topTools: usageRes.topTools || [],
      };
      setOverview(ov);
      setDaily(dailyRes.ok ? dailyRes : null);

      // Compute budget status
      if (budget > 0 && dailyRes.ok && dailyRes.daily && dailyRes.daily.length > 0) {
        const costData = dailyRes.daily.map((r: DailyRow) => r.cost || 0);
        const totalCost = costData.reduce((s: number, v: number) => s + v, 0);
        let weightedSum = 0, weightTotal = 0;
        for (let i = 0; i < costData.length; i++) {
          const w = Math.pow(0.85, costData.length - 1 - i);
          weightedSum += costData[i] * w;
          weightTotal += w;
        }
        const avgDailyCost = weightTotal > 0 ? weightedSum / weightTotal : 0;
        const simpleAvg = costData.length > 0 ? totalCost / costData.length : 0;
        const projAvg = costData.length >= 3 ? avgDailyCost : simpleAvg;
        const monthlyPace = projAvg * 30;

        if (monthlyPace > budget) {
          const over = ((monthlyPace / budget - 1) * 100);
          setBudgetStatus({ over: true, percentage: over });
        } else {
          const remaining = ((1 - monthlyPace / budget) * 100);
          setBudgetStatus({ over: false, percentage: remaining });
        }
      } else {
        setBudgetStatus(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load usage data');
    } finally {
      setLoading(false);
    }
  }, [days, agent, budget]);

  // ── Load data on mount and when filters change ────────────────────────

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Chart config helpers ──────────────────────────────────────────────

  const chartTextColor = 'var(--fg)';
  const chartGridColor = 'rgba(220,203,181,0.08)';
  const chartColors = ['#ffac02', '#4ecdc4', '#ff6b6b', '#a78bfa', '#34d399', '#60a5fa', '#fb923c', '#f472b6'];

  // Daily Token Trend chart data
  function getTokenChartData() {
    const hasDaily = !!(daily && daily.daily && daily.daily.length > 0);
    let labels: string[];
    let datasets: any[];
    let stacked = true;

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
    } else {
      labels = [];
      datasets = [];
    }

    return {
      labels,
      datasets,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: hasDaily, labels: { color: chartTextColor, font: { size: 10 } } },
        },
        scales: {
          x: {
            stacked,
            ticks: { color: chartTextColor, maxRotation: 45, font: { size: 10 } },
            grid: { color: chartGridColor },
          },
          y: {
            stacked,
            ticks: { color: chartTextColor, callback: (v: any) => formatNumber(Number(v)), font: { size: 10 } },
            grid: { color: chartGridColor },
          },
        },
      } as const,
    };
  }

  // Daily Cost chart data
  function getCostChartData() {
    if (!daily?.daily || daily.daily.length === 0) {
      if (overview?.models && overview.models.length > 0) {
        const top = overview.models.slice(0, 6);
        return {
          labels: top.map(m => m.name),
          datasets: [{ label: 'Sessions', data: top.map(m => m.sessions || 0), backgroundColor: chartColors.slice(0, 6), borderRadius: 4 }],
          options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y' as const,
            plugins: { legend: { display: false } },
            scales: {
              x: { ticks: { color: chartTextColor }, grid: { color: chartGridColor } },
              y: { ticks: { color: chartTextColor }, grid: { color: chartGridColor } },
            },
          },
        };
      }
      return null;
    }

    const costData = daily.daily.map(r => r.cost || 0);
    const baseLabels = daily.daily.map(r => r.date);

    // Monthly projection
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const endOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

    const lastDate = baseLabels[baseLabels.length - 1];
    const extendedLabels = [...baseLabels];
    const projectionData: (number | null)[] = new Array(baseLabels.length).fill(null);
    let cursor = new Date(lastDate + 'T00:00:00');
    const endDate = new Date(endOfMonth + 'T00:00:00');
    while (cursor < endDate) {
      cursor.setDate(cursor.getDate() + 1);
      const ds = cursor.toISOString().slice(0, 10);
      extendedLabels.push(ds);
      projectionData.push(null);
    }

    // Weighted average daily cost
    const totalCost = costData.reduce((s: number, v: number) => s + v, 0);
    let weightedSum = 0, weightTotal = 0;
    for (let i = 0; i < costData.length; i++) {
      const w = Math.pow(0.85, costData.length - 1 - i);
      weightedSum += costData[i] * w;
      weightTotal += w;
    }
    const avgDailyCost = weightTotal > 0 ? weightedSum / weightTotal : 0;
    const simpleAvg = costData.length > 0 ? totalCost / costData.length : 0;
    const projAvg = costData.length >= 3 ? avgDailyCost : simpleAvg;

    // Cumulative actual
    const cumulativeActual: number[] = [];
    let cumSum = 0;
    for (const c of costData) { cumSum += c; cumulativeActual.push(cumSum); }
    const lastCumCost = cumulativeActual.length > 0 ? cumulativeActual[cumulativeActual.length - 1] : 0;
    const projStart = baseLabels.length;
    for (let i = 0; i < projectionData.length - projStart; i++) {
      projectionData[projStart + i] = lastCumCost + projAvg * (i + 1);
    }
    const actualPadded = [...cumulativeActual, ...new Array(extendedLabels.length - cumulativeActual.length).fill(null)];

    const datasets: any[] = [
      {
        label: 'Cumulative Cost ($)',
        data: actualPadded,
        borderColor: '#ffac02',
        backgroundColor: 'rgba(255,172,2,0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        spanGaps: false,
      },
      {
        label: 'Monthly Projection',
        data: projectionData,
        borderColor: 'rgba(255,172,2,0.45)',
        borderDash: [6, 4],
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.3,
        pointRadius: 0,
        spanGaps: false,
      },
    ];

    const monthlyPace = projAvg * 30;

    if (budget > 0) {
      const budgetLine = new Array(extendedLabels.length).fill(budget);
      datasets.push({
        label: `Budget ($${budget})`,
        data: budgetLine,
        borderColor: '#ff6b6b',
        borderDash: [8, 4],
        backgroundColor: 'transparent',
        fill: false,
        pointRadius: 0,
        borderWidth: 2,
        spanGaps: true,
      });
    }

    return {
      labels: extendedLabels,
      datasets,
      monthlyPace,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, labels: { color: chartTextColor, font: { size: 10 }, boxWidth: 12, padding: 8 } },
          tooltip: { callbacks: { label: (ctx: any) => `${ctx.dataset.label}: $${ctx.parsed.y.toFixed(4)}` } },
        },
        scales: {
          x: {
            ticks: { color: chartTextColor, maxRotation: 45, font: { size: 10 } },
            grid: { color: chartGridColor },
          },
          y: {
            ticks: { color: chartTextColor, callback: (v: any) => '$' + Number(v).toFixed(2), font: { size: 10 } },
            grid: { color: chartGridColor },
            beginAtZero: true,
          },
        },
      } as const,
    };
  }

  // Model Distribution doughnut chart data
  function getModelChartData() {
    const models = daily?.byModel || overview?.models || [];
    if (!models || models.length === 0) return null;
    const top = models.slice(0, 6);
    return {
      labels: top.map(m => m.name || (m as any).model),
      datasets: [{
        data: top.map(m => m.tokens || (m as any).total_tokens || 0),
        backgroundColor: chartColors.slice(0, 6),
        borderWidth: 0,
      }],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: { position: 'bottom' as const, labels: { color: chartTextColor, font: { size: 10 }, padding: 8 } },
        },
      } as const,
    };
  }

  // ── Render ─────────────────────────────────────────────────────────────

  const tokenChart = getTokenChartData();
  const costChart = getCostChartData();
  const modelChart = getModelChartData();

  return (
    <div style={{ padding: '24px', height: '100%', overflowY: 'auto' }}>
      {/* ── Page Header ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--fg)' }}>
            Usage &amp; Analytics
          </div>
          <div style={{ fontSize: '13px', color: 'var(--fg-muted)', marginTop: '4px' }}>
            Token usage, costs, and activity breakdown
          </div>
        </div>

        {/* ── Filter bar ────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={days}
            onChange={e => setDays(e.target.value)}
            style={selectStyle}
          >
            <option value="1">Today</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
          </select>

          <select
            value={agent}
            onChange={e => setAgent(e.target.value)}
            style={selectStyle}
          >
            <option value="">All agents</option>
            {profiles.map(p => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>

          <button
            style={{ ...btnStyle, opacity: loading ? 0.6 : 1 }}
            onClick={fetchData}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Apply'}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <label style={{ fontSize: '11px', color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>Budget $</label>
            <input
              type="number"
              value={budget || ''}
              onChange={e => handleBudgetChange(parseFloat(e.target.value) || 0)}
              min={0}
              step={1}
              placeholder="0"
              style={{
                padding: '6px 10px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                color: 'var(--fg)',
                fontFamily: 'var(--font)',
                fontSize: '11px',
                width: '72px',
                outline: 'none',
              }}
            />
          </div>

          {budgetStatus && (
            <span style={{
              fontSize: '11px',
              padding: '3px 8px',
              borderRadius: '999px',
              fontWeight: 600,
              backgroundColor: budgetStatus.over
                ? 'rgba(255,107,107,0.15)'
                : 'rgba(78,205,196,0.15)',
              color: budgetStatus.over ? '#ff6b6b' : '#4ecdc4',
            }}>
              {budgetStatus.over
                ? `⚠ Over budget by ${budgetStatus.percentage.toFixed(0)}%`
                : `✓ ${budgetStatus.percentage.toFixed(0)}% under budget`}
            </span>
          )}
        </div>
      </div>

      {/* ── Error message ────────────────────────────────────────────────── */}
      {error && (
        <div style={{ color: 'var(--red)', fontSize: '13px', padding: '8px 0', marginBottom: '12px' }}>{error}</div>
      )}

      {/* ── Overview stats bar ───────────────────────────────────────────── */}
      <div style={{ ...cardStyle, marginTop: '4px' }}>
        {loading && !overview ? (
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'center', color: 'var(--fg-muted)', fontSize: '13px' }}>Loading…</div>
        ) : overview ? (
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ textAlign: 'center', minWidth: '60px' }}>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#ffac02' }}>{overview.sessions}</div>
              <div style={{ fontSize: '10px', color: 'var(--fg-muted)' }}>Sessions</div>
            </div>
            <div style={{ textAlign: 'center', minWidth: '70px' }}>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#ffac02' }}>{(overview.messages || 0).toLocaleString()}</div>
              <div style={{ fontSize: '10px', color: 'var(--fg-muted)' }}>Messages</div>
            </div>
            <div style={{ textAlign: 'center', minWidth: '90px' }}>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#4ecdc4' }}>{formatNumber(overview.inputTokens)}</div>
              <div style={{ fontSize: '10px', color: 'var(--fg-muted)' }}>Input Tokens</div>
            </div>
            <div style={{ textAlign: 'center', minWidth: '90px' }}>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#ff6b6b' }}>{formatNumber(overview.outputTokens)}</div>
              <div style={{ fontSize: '10px', color: 'var(--fg-muted)' }}>Output Tokens</div>
            </div>
            <div style={{ textAlign: 'center', minWidth: '90px' }}>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#ffac02' }}>{formatNumber(overview.totalTokens)}</div>
              <div style={{ fontSize: '10px', color: 'var(--fg-muted)' }}>Total Tokens</div>
            </div>
            <div style={{ textAlign: 'center', minWidth: '70px' }}>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#ffac02' }}>{overview.cost}</div>
              <div style={{ fontSize: '10px', color: 'var(--fg-muted)' }}>Est. Cost</div>
            </div>
            <div style={{ textAlign: 'center', minWidth: '80px' }}>
              <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--fg-muted)' }}>{overview.activeTime}</div>
              <div style={{ fontSize: '10px', color: 'var(--fg-muted)' }}>Active Time</div>
            </div>
            <div style={{ textAlign: 'center', minWidth: '80px' }}>
              <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--fg-muted)' }}>{overview.avgSession}</div>
              <div style={{ fontSize: '10px', color: 'var(--fg-muted)' }}>Avg Session</div>
            </div>
          </div>
        ) : null}
      </div>

      {/* ── Charts: 2-column layout ──────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px' }}>
        {/* Daily Token Trend */}
        <div style={cardStyle}>
          <div style={cardTitleStyle}>Daily Token Trend</div>
          <div style={{ height: '200px' }}>
            {tokenChart && tokenChart.labels.length > 0 ? (
              <Bar data={{ labels: tokenChart.labels, datasets: tokenChart.datasets }} options={tokenChart.options} />
            ) : (
              <div style={{ color: 'var(--fg-muted)', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                No data available
              </div>
            )}
          </div>
        </div>

        {/* Daily Cost + Model Distribution */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <div style={{ ...cardTitleStyle, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                Daily Cost
                {costChart && 'monthlyPace' in costChart && (
                  <span style={{ fontSize: '11px', fontWeight: 'normal', color: 'var(--fg-muted)' }}>
                    · ~${(costChart as any).monthlyPace.toFixed(2)}/mo pace
                  </span>
                )}
              </div>
              <div style={{ height: '140px' }}>
                {costChart ? (
                  <Line data={{ labels: costChart.labels, datasets: costChart.datasets }} options={costChart.options} />
                ) : (
                  <div style={{ color: 'var(--fg-muted)', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                    No data available
                  </div>
                )}
              </div>
            </div>
            <div>
              <div style={{ ...cardTitleStyle, marginBottom: '8px' }}>Model Distribution</div>
              <div style={{ height: '160px' }}>
                {modelChart ? (
                  <Doughnut data={{ labels: modelChart.labels, datasets: modelChart.datasets }} options={modelChart.options} />
                ) : (
                  <div style={{ color: 'var(--fg-muted)', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                    No data available
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Models + Platforms + Top Tools ───────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginTop: '16px' }}>
        {/* Models */}
        <div style={cardStyle}>
          <div style={cardTitleStyle}>Models</div>
          {overview?.models && overview.models.length > 0 ? (
            overview.models.map((m, i) => (
              <div key={i} style={statRowStyle}>
                <span style={statLabelStyle}>{m.name}</span>
                <span style={statValueStyle}>{m.sessions} · {formatNumber(m.tokens)}</span>
              </div>
            ))
          ) : (
            <div style={statRowStyle}><span style={statLabelStyle}>No data</span></div>
          )}
        </div>

        {/* Platforms */}
        <div style={cardStyle}>
          <div style={cardTitleStyle}>Platforms</div>
          {overview?.platforms && overview.platforms.length > 0 ? (
            overview.platforms.map((p, i) => (
              <div key={i} style={statRowStyle}>
                <span style={statLabelStyle}>{p.name}</span>
                <span style={statValueStyle}>{p.sessions} · {formatNumber(p.tokens)}</span>
              </div>
            ))
          ) : (
            <div style={statRowStyle}><span style={statLabelStyle}>No data</span></div>
          )}
        </div>

        {/* Top Tools */}
        <div style={cardStyle}>
          <div style={cardTitleStyle}>Top Tools</div>
          {overview?.topTools && overview.topTools.length > 0 ? (
            overview.topTools.slice(0, 5).map((t, i) => (
              <div key={i} style={statRowStyle}>
                <span style={statLabelStyle}>{t.name}</span>
                <span style={statValueStyle}>{t.calls} ({t.pct})</span>
              </div>
            ))
          ) : (
            <div style={statRowStyle}><span style={statLabelStyle}>No data</span></div>
          )}
        </div>
      </div>
    </div>
  );
}
