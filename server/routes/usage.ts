/**
 * Usage & insights routes — token usage, daily breakdown, profile insights.
 */
import { Router } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { requireAuth, requirePerm } from '../middleware/auth';
import { execHermes } from '../services/shell';
import { getInsights, buildUsageSummary } from '../services/insights';
import { calculateCost } from '../services/pricing';

const Database = require('../../lib/database');
const router = Router();

function sanitizeProfileName(name: any): string | null {
  const s = String(name || '').trim();
  return /^[a-zA-Z0-9_-]+$/.test(s) ? s : null;
}

// GET /usage
router.get('/usage', requireAuth, requirePerm('usage.view'), async (req, res) => {
  const insights = await getInsights().catch(() => null);
  res.json(buildUsageSummary(insights));
});

// GET /insights
router.get('/insights', requireAuth, requirePerm('usage.view'), async (req: any, res) => {
  const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 7));
  const source = String(req.query.source || '').trim();
  const data = await getInsights(days, source);
  res.json({ ok: true, ...data, filter: { days, source: source || 'all' } });
});

// GET /insights/:profile/:days
router.get('/insights/:profile/:days', requireAuth, requirePerm('usage.view'), async (req: any, res) => {
  try {
    const profile = sanitizeProfileName(req.params.profile);
    if (!profile) return res.status(400).json({ ok: false, error: 'invalid profile name' });
    const days = Math.min(parseInt(req.params.days || '7', 10), 90);
    const output = await execHermes(['--profile', profile, 'insights', '--days', String(days)], 60000);
    res.json({ ok: true, output });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

// GET /usage/:days — aggregate across profiles
router.get('/usage/:days', requireAuth, requirePerm('usage.view'), async (req: any, res) => {
  try {
    const days = Math.min(parseInt(req.params.days || '7', 10), 90);
    const profile = sanitizeProfileName(req.query.profile) || undefined;
    let dbPaths: { profile: string; path: string }[] = [];
    if (profile) {
      const p = profile !== 'default' ? path.join(os.homedir(), '.hermes', 'profiles', profile, 'state.db') : path.join(os.homedir(), '.hermes', 'state.db');
      if (!fs.existsSync(p)) return res.json({ ok: false, error: 'state.db not found' });
      dbPaths = [{ profile: profile || 'default', path: p }];
    } else {
      const profilesDir = path.join(os.homedir(), '.hermes', 'profiles');
      if (fs.existsSync(profilesDir)) {
        for (const entry of fs.readdirSync(profilesDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const dbPath = path.join(profilesDir, entry.name, 'state.db');
          if (fs.existsSync(dbPath)) dbPaths.push({ profile: entry.name, path: dbPath });
        }
      }
      const defaultDbPath = path.join(os.homedir(), '.hermes', 'state.db');
      if (fs.existsSync(defaultDbPath)) dbPaths.push({ profile: 'default', path: defaultDbPath });
      if (dbPaths.length === 0) return res.json({ ok: false, error: 'No state.db found' });
    }

    const modelMap: Record<string, any> = {}, platformMap: Record<string, any> = {}, toolMap: Record<string, any> = {};
    let totalSessions = 0, totalMessages = 0, totalToolCalls = 0, totalInput = 0, totalOutput = 0, totalCost = 0;

    for (const { path: dbPath } of dbPaths) {
      const db = new Database(dbPath, { readonly: true });
      try {
        const sessions = db.prepare("SELECT model, source, billing_provider, input_tokens, output_tokens, cache_read_tokens, message_count, tool_call_count FROM sessions WHERE started_at > strftime('%s', 'now', ? || ' days')").all(`-${days}`);
        for (const s of sessions) {
          const cost = calculateCost(s.model, s.input_tokens || 0, s.output_tokens || 0, s.cache_read_tokens || 0, s.billing_provider);
          const tokens = (s.input_tokens || 0) + (s.output_tokens || 0);
          totalSessions++; totalInput += s.input_tokens || 0; totalOutput += s.output_tokens || 0; totalCost += cost; totalMessages += s.message_count || 0; totalToolCalls += s.tool_call_count || 0;
          const mKey = s.model || 'unknown';
          if (!modelMap[mKey]) modelMap[mKey] = { name: mKey, sessions: 0, tokens: 0 };
          modelMap[mKey].sessions++; modelMap[mKey].tokens += tokens;
          const pKey = s.source || 'unknown';
          if (!platformMap[pKey]) platformMap[pKey] = { name: pKey, sessions: 0, tokens: 0 };
          platformMap[pKey].sessions++; platformMap[pKey].tokens += tokens;
        }
        const tools = db.prepare("SELECT tool_name, COUNT(*) as calls FROM messages WHERE tool_name IS NOT NULL AND tool_name != '' AND timestamp > strftime('%s', 'now', ? || ' days') GROUP BY tool_name ORDER BY calls DESC LIMIT 10").all(`-${days}`);
        for (const t of tools || []) {
          if (!toolMap[t.tool_name]) toolMap[t.tool_name] = { name: t.tool_name, calls: 0 };
          toolMap[t.tool_name].calls += t.calls;
        }
      } finally { db.close(); }
    }

    let avgDuration = 0;
    for (const { path: dbPath } of dbPaths) {
      const db = new Database(dbPath, { readonly: true });
      try {
        const dur = db.prepare("SELECT AVG(ended_at - started_at) as avg_dur FROM sessions WHERE started_at > strftime('%s', 'now', ? || ' days') AND ended_at > 0").get(`-${days}`);
        if (dur?.avg_dur) avgDuration += dur.avg_dur;
      } finally { db.close(); }
    }
    avgDuration = dbPaths.length > 0 ? avgDuration / dbPaths.length : 0;
    const formatDuration = (secs: number) => { if (!secs || secs < 60) return '—'; const h = Math.floor(secs / 3600); const m = Math.floor((secs % 3600) / 60); return h > 0 ? `${h}h ${m}m` : `${m}m`; };
    const topTools = Object.values(toolMap).sort((a: any, b: any) => b.calls - a.calls).slice(0, 5).map((t: any) => ({ ...t, pct: totalToolCalls > 0 ? ((t.calls / totalToolCalls) * 100).toFixed(1) + '%' : '0%' }));

    res.json({ ok: true, sessions: totalSessions, messages: totalMessages, toolCalls: totalToolCalls, inputTokens: totalInput, outputTokens: totalOutput, totalTokens: totalInput + totalOutput, cost: '$' + totalCost.toFixed(2), activeTime: formatDuration(avgDuration), avgSession: formatDuration(avgDuration), period: `${days} days${profile ? ` (${profile})` : ' (all profiles)'}`, models: Object.values(modelMap).sort((a: any, b: any) => b.tokens - a.tokens), platforms: Object.values(platformMap).sort((a: any, b: any) => b.sessions - a.sessions), topTools });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

// GET /usage/daily/:days
router.get('/usage/daily/:days', requireAuth, requirePerm('usage.view'), async (req: any, res) => {
  try {
    const days = Math.min(parseInt(req.params.days || '7', 10), 90);
    const profile = sanitizeProfileName(req.query.profile);
    const stateDbPath = profile && profile !== 'default' ? path.join(os.homedir(), '.hermes', 'profiles', profile, 'state.db') : path.join(os.homedir(), '.hermes', 'state.db');
    if (!fs.existsSync(stateDbPath)) return res.json({ ok: false, error: 'state.db not found' });

    const db = new Database(stateDbPath, { readonly: true });
    try {
      const since = `-${days}`;
      const rawSessions = db.prepare("SELECT DATE(started_at, 'unixepoch', 'localtime') as date, model, source, billing_provider, input_tokens, output_tokens, cache_read_tokens, message_count, tool_call_count FROM sessions WHERE started_at > strftime('%s', 'now', ? || ' days')").all(since);
      const dailyMap: Record<string, any> = {}, modelMap: Record<string, any> = {}, platformMap: Record<string, any> = {};
      let totalSessions = 0, totalInput = 0, totalOutput = 0, totalCost = 0, totalMessages = 0, totalToolCalls = 0;

      for (const s of rawSessions) {
        const cost = calculateCost(s.model, s.input_tokens || 0, s.output_tokens || 0, s.cache_read_tokens || 0, s.billing_provider);
        const tokens = (s.input_tokens || 0) + (s.output_tokens || 0);
        if (!dailyMap[s.date]) dailyMap[s.date] = { date: s.date, sessions: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, cost: 0, messages: 0, tool_calls: 0 };
        const d = dailyMap[s.date]; d.sessions++; d.input_tokens += s.input_tokens || 0; d.output_tokens += s.output_tokens || 0; d.total_tokens += tokens; d.cost += cost; d.messages += s.message_count || 0; d.tool_calls += s.tool_call_count || 0;
        const mKey = s.model || 'unknown'; if (!modelMap[mKey]) modelMap[mKey] = { model: mKey, sessions: 0, total_tokens: 0, cost: 0 }; modelMap[mKey].sessions++; modelMap[mKey].total_tokens += tokens; modelMap[mKey].cost += cost;
        const pKey = s.source || 'unknown'; if (!platformMap[pKey]) platformMap[pKey] = { platform: pKey, sessions: 0, total_tokens: 0, cost: 0 }; platformMap[pKey].sessions++; platformMap[pKey].total_tokens += tokens; platformMap[pKey].cost += cost;
        totalSessions++; totalInput += s.input_tokens || 0; totalOutput += s.output_tokens || 0; totalCost += cost; totalMessages += s.message_count || 0; totalToolCalls += s.tool_call_count || 0;
      }

      const byHour = db.prepare("SELECT CAST(strftime('%H', started_at, 'unixepoch', 'localtime') AS INTEGER) as hour, COUNT(*) as sessions, SUM(input_tokens + output_tokens) as total_tokens FROM sessions WHERE started_at > strftime('%s', 'now', ? || ' days') GROUP BY hour ORDER BY hour ASC").all(since);
      const topTools = db.prepare("SELECT tool_name, COUNT(*) as calls FROM messages WHERE tool_name IS NOT NULL AND tool_name != '' AND timestamp > strftime('%s', 'now', ? || ' days') GROUP BY tool_name ORDER BY calls DESC LIMIT 10").all(since);
      const avgDur = db.prepare("SELECT AVG(ended_at - started_at) as avg_duration FROM sessions WHERE started_at > strftime('%s', 'now', ? || ' days')").get(since);

      res.json({ ok: true, days, daily: Object.values(dailyMap).sort((a: any, b: any) => a.date.localeCompare(b.date)), byModel: Object.values(modelMap).sort((a: any, b: any) => b.total_tokens - a.total_tokens), byPlatform: Object.values(platformMap).sort((a: any, b: any) => b.total_tokens - a.total_tokens), byHour: byHour || [], topTools: topTools || [], totals: { sessions: totalSessions, input_tokens: totalInput, output_tokens: totalOutput, total_tokens: totalInput + totalOutput, cost: totalCost, messages: totalMessages, tool_calls: totalToolCalls, avg_duration: avgDur?.avg_duration || 0 } });
    } finally { db.close(); }
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

export default router;
