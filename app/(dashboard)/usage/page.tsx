'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/app/lib/api-client';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';


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

  // ── Daily totals ──────────────────────────────────────────────────────────

  const dailyTotals = daily?.daily?.reduce(
    (acc, row) => ({
      inputTokens: acc.inputTokens + (row.input_tokens || 0),
      outputTokens: acc.outputTokens + (row.output_tokens || 0),
      cacheReadTokens: acc.cacheReadTokens + (row.cache_read_tokens || 0),
      cost: acc.cost + (row.cost || 0),
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cost: 0 },
  );
  const dayCount = daily?.daily?.length ?? 0;

  // ─── Stats config ──────────────────────────────────────────────────────────

  const overviewStats = overview ? [
    { label: 'Sessions', value: overview.sessions },
    { label: 'Messages', value: (overview.messages || 0).toLocaleString() },
    { label: 'Input Tokens', value: formatNumber(overview.inputTokens) },
    { label: 'Output Tokens', value: formatNumber(overview.outputTokens) },
    { label: 'Total Tokens', value: formatNumber(overview.totalTokens) },
    { label: 'Est. Cost', value: overview.cost },
    { label: 'Active Time', value: overview.activeTime },
    { label: 'Avg Session', value: overview.avgSession },
  ] : [];

  return (
    <div className="flex flex-col h-full overflow-y-auto gap-4 p-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-wider uppercase">Usage &amp; Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">Token usage, costs, and activity breakdown</p>
        </div>

        {/* Filters row */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={days} onValueChange={v => v && setDays(v)}>
            <SelectTrigger size="sm" className="w-[110px]">
              <SelectValue placeholder="Days" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Today</SelectItem>
              <SelectItem value="7">7 days</SelectItem>
              <SelectItem value="30">30 days</SelectItem>
              <SelectItem value="90">90 days</SelectItem>
            </SelectContent>
          </Select>

          <Select value={agent} onValueChange={v => setAgent(v || '')}>
            <SelectTrigger size="sm" className="w-[140px]">
              <SelectValue placeholder="All agents" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All agents</SelectItem>
              {profiles.map(p => (
                <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            {loading ? <><Spinner className="size-3" /> Loading...</> : 'Apply'}
          </Button>

          <Separator orientation="vertical" className="h-5 mx-1" />

          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground whitespace-nowrap">Budget $</label>
            <Input
              type="number"
              value={budget || ''}
              onChange={e => handleBudgetChange(parseFloat(e.target.value) || 0)}
              min={0} step={1} placeholder="0"
              className="w-20 h-7 text-xs"
            />
          </div>

          {budgetStatus && (
            <Badge variant={budgetStatus.over ? 'destructive' : 'secondary'} className="text-xs">
              {budgetStatus.over
                ? `Over budget ${budgetStatus.percentage.toFixed(0)}%`
                : `${budgetStatus.percentage.toFixed(0)}% under`}
            </Badge>
          )}
        </div>
      </div>

      {error && (
        <div className="text-destructive text-sm px-3 py-2 rounded-md bg-destructive/10 border border-destructive/20">
          {error}
        </div>
      )}

      {/* Overview stats */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Overview</CardTitle>
          <CardDescription>Aggregated metrics for the selected period</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && !overview ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
              <Spinner className="size-3" /> Loading...
            </div>
          ) : overview ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4">
              {overviewStats.map((stat, i) => (
                <div key={i} className="flex flex-col items-center text-center gap-1">
                  <span className="text-lg font-bold text-primary tabular-nums">{stat.value}</span>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{stat.label}</span>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Daily Data Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Usage</CardTitle>
          <CardDescription>Token and cost summary for the selected period</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && !daily ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
              <Spinner className="size-3" /> Loading...
            </div>
          ) : daily?.daily && daily.daily.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="flex flex-col items-center text-center gap-1">
                <span className="text-lg font-bold text-primary tabular-nums">{formatNumber(dailyTotals?.inputTokens || 0)}</span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Input Tokens</span>
              </div>
              <div className="flex flex-col items-center text-center gap-1">
                <span className="text-lg font-bold text-primary tabular-nums">{formatNumber(dailyTotals?.outputTokens || 0)}</span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Output Tokens</span>
              </div>
              <div className="flex flex-col items-center text-center gap-1">
                <span className="text-lg font-bold text-primary tabular-nums">{formatNumber(dailyTotals?.cacheReadTokens || 0)}</span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Cache Tokens</span>
              </div>
              <div className="flex flex-col items-center text-center gap-1">
                <span className="text-lg font-bold text-primary tabular-nums">${dailyTotals?.cost.toFixed(2) || '0.00'}</span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Cost</span>
              </div>
              <div className="flex flex-col items-center text-center gap-1">
                <span className="text-lg font-bold text-primary tabular-nums">${(dailyTotals && dayCount > 0 ? dailyTotals.cost / dayCount : 0).toFixed(2)}</span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg Daily Cost</span>
              </div>
              <div className="flex flex-col items-center text-center gap-1">
                <span className="text-lg font-bold text-primary tabular-nums">{dayCount}</span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Days</span>
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground text-sm py-2">No daily data available</div>
          )}
        </CardContent>
      </Card>

      {/* Models + Platforms + Top Tools */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          {
            title: 'Models',
            desc: 'Token usage by model',
            data: overview?.models,
            render: (m: ModelEntry) => (
              <span>{m.name}: {m.sessions} · {formatNumber(m.tokens)}</span>
            ),
          },
          {
            title: 'Platforms',
            desc: 'Activity by platform',
            data: overview?.platforms,
            render: (p: PlatformEntry) => (
              <span>{p.name}: {p.sessions} · {formatNumber(p.tokens)}</span>
            ),
          },
          {
            title: 'Top Tools',
            desc: 'Most-used tools',
            data: overview?.topTools?.slice(0, 5),
            render: (t: ToolEntry) => (
              <span>{t.name}: {t.calls} ({t.pct})</span>
            ),
          },
        ].map((section, si) => (
          <Card key={si}>
            <CardHeader>
              <CardTitle>{section.title}</CardTitle>
              <CardDescription>{section.desc}</CardDescription>
            </CardHeader>
            <CardContent>
              {section.data && section.data.length > 0 ? (
                <div className="space-y-1">
                  {(section.data as any[]).map((item: any, i: number) => (
                    <div
                      key={i}
                      className="flex justify-between items-center py-1.5 border-b border-border last:border-0 text-sm"
                    >
                      <span className="text-muted-foreground truncate mr-2">{item.name}</span>
                      <span className="font-medium text-right shrink-0">{section.render(item)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-muted-foreground text-sm py-2">No data</div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
