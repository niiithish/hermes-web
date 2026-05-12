/**
 * Insights, cron, token usage, and usage summary services.
 */
import { shell } from './shell';
import { events, cronJobs } from '../state';
import type { InsightsData, CronJob } from '../types';

// ── Insights ──

export function parseHermesInsights(raw: string): InsightsData {
  const text = String(raw || '');
  const grab = (label: string): number => {
    const m = text.match(new RegExp(label + ':\\s+([\\d,]+)'));
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
  };
  const sessions = grab('Sessions');
  const messages = grab('Messages');
  const toolCalls = grab('Tool calls');
  const userMessages = grab('User messages');
  const inputTokens = grab('Input tokens');
  const outputTokens = grab('Output tokens');
  const cacheRead = grab('Cache read');
  const cacheWrite = grab('Cache write');
  const totalTokens = grab('Total tokens');

  const modelBreakdown: { model: string; sessions: number; tokens: number }[] = [];
  const modelLines = text.split('\n').filter((l: string) => /^\s+[\w.-]+\s+\d+\s+[\d,]+/.test(l));
  for (const line of modelLines) {
    const parts = line.trim().split(/\s{2,}/);
    if (parts.length >= 3) {
      modelBreakdown.push({
        model: parts[0].trim(),
        sessions: parseInt(parts[1].replace(/,/g, ''), 10) || 0,
        tokens: parseInt(parts[2].replace(/,/g, ''), 10) || 0,
      });
    }
  }

  const periodMatch = text.match(/Period:\s+(.+)/);
  const period = periodMatch ? periodMatch[1].trim() : '';

  return {
    sessions, messages, toolCalls, userMessages,
    inputTokens, outputTokens, cacheRead, cacheWrite, totalTokens,
    modelBreakdown, period,
    raw: text,
  };
}

// ── Insights cache ──

const insightsCache: Record<string, { at: number; data: InsightsData }> = {};

export async function getInsights(days = 7, source = ''): Promise<InsightsData> {
  const cacheKey = `${days}|${source}`;
  const now = Date.now();
  if (insightsCache[cacheKey] && now - insightsCache[cacheKey].at < 300_000) {
    return insightsCache[cacheKey].data;
  }
  let cmd = `hermes insights --days ${days}`;
  if (source) cmd += ` --source ${source}`;
  const raw = await shell(cmd, '60s');
  if (raw) {
    const data = parseHermesInsights(raw);
    insightsCache[cacheKey] = { at: now, data };
    return data;
  }
  if (insightsCache[cacheKey]?.data) return insightsCache[cacheKey].data;
  return {
    sessions: 0, messages: 0, toolCalls: 0, userMessages: 0,
    inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    modelBreakdown: [], period: 'unavailable',
  };
}

// ── Token usage ──

export function getTokens(insights: InsightsData | null): Record<string, any> {
  const data = insights || { totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, sessions: 0, messages: 0, toolCalls: 0, period: '', modelBreakdown: [] };
  return {
    totalTokens: data.totalTokens,
    inputTokens: data.inputTokens,
    outputTokens: data.outputTokens,
    cacheRead: data.cacheRead,
    cacheWrite: data.cacheWrite,
    promptTokens: data.inputTokens,
    completionTokens: data.outputTokens,
    sessions: data.sessions,
    messages: data.messages,
    toolCalls: data.toolCalls,
    period: data.period,
    modelBreakdown: data.modelBreakdown.map((m: any) => ({ model: m.model, tokens: m.tokens })),
  };
}

export function buildUsageSummary(insights: InsightsData | null): Record<string, any> {
  const data = insights || { sessions: 0, messages: 0, toolCalls: 0, userMessages: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, period: '', modelBreakdown: [] };
  const recentKinds = events.slice(-50).reduce((acc: Record<string, number>, event) => {
    acc[event.kind] = (acc[event.kind] || 0) + 1;
    return acc;
  }, {});
  return {
    generatedAt: new Date().toISOString(),
    sessionCount: data.sessions,
    messageCount: data.messages,
    toolCalls: data.toolCalls,
    userMessages: data.userMessages,
    inputTokens: data.inputTokens,
    outputTokens: data.outputTokens,
    cacheRead: data.cacheRead,
    cacheWrite: data.cacheWrite,
    totalTokens: data.totalTokens,
    period: data.period,
    modelBreakdown: data.modelBreakdown,
    eventCount: events.length,
    cronCount: cronJobs.length,
    recentKinds,
    tokenUsage: getTokens(insights),
    lastEvent: events.at(-1) || null,
  };
}

// ── Cron job parsing ──

export function parseHermesCronList(raw: string): CronJob[] {
  const lines = String(raw || '').split(/\r?\n/).map((line) => line.trimEnd());
  const jobs: CronJob[] = [];
  let current: CronJob | null = null;

  const flush = (): void => {
    if (current) jobs.push(current);
    current = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { flush(); continue; }
    if (/^┌|^└|^│\s*Scheduled Jobs|^─+$/.test(trimmed)) continue;

    const header = trimmed.match(/^([0-9a-f]{6,})\s+\[(active|paused|inactive|running|stopped)\]$/i);
    if (header) {
      flush();
      current = {
        id: header[1], status: header[2].toUpperCase(), name: header[1],
        schedule: 'n/a', repeat: null, nextRun: null, lastRun: null,
        deliver: 'n/a', source: 'hermes cron list',
      };
      continue;
    }
    if (!current) continue;
    const kv = trimmed.match(/^([A-Za-z ]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const value = kv[2].trim();
    if (key === 'name') current.name = value || current.name;
    else if (key === 'schedule') current.schedule = value || 'n/a';
    else if (key === 'repeat') current.repeat = value || null;
    else if (key === 'next run') current.nextRun = value || null;
    else if (key === 'last run') current.lastRun = value || null;
    else if (key === 'deliver') current.deliver = value || 'n/a';
  }
  flush();
  return jobs;
}

let cronCache: { at: number; data: CronJob[] } = { at: 0, data: [] };

export async function getCronJobs(): Promise<CronJob[]> {
  const now = Date.now();
  if (cronCache.data.length && now - cronCache.at < 10_000) return cronCache.data;
  const raw = await shell('hermes cron list');
  if (raw) {
    const data = parseHermesCronList(raw);
    cronCache = { at: now, data };
    return data;
  }
  if (cronCache.data?.length) return cronCache.data;
  const fallback = cronJobs.map((job: any) => ({
    ...job,
    id: job.id || job.name,
    schedule: job.schedule || 'n/a',
    source: job.source || 'local',
    nextRun: job.nextRun || null,
    lastRun: job.lastRun || null,
  }));
  cronCache = { at: now, data: fallback };
  return fallback;
}
