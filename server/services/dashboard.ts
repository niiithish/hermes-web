/**
 * Dashboard state builder and system metrics.
 */
import os from 'os';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import yaml from 'js-yaml';
import {
  events, spriteState, CONTROL_HOME, PROJECT_ROOT, ROOTS,
  HCI_IDENTITY, quickActions, cronJobs, healthAlertCooldown,
} from '../state';
import { readAvatarOverride } from './avatar';
import { getSessions, getAllSessions, getProfiles } from './sessions';
import { getInsights, getTokens, buildUsageSummary, getCronJobs } from './insights';
import { ensureTerminalSession } from './terminal';
import type { SystemInfo } from '../types';

const { addNotification } = require('../../auth');

// ── System Info ──

export function getSystem(): SystemInfo {
  const memTotal = os.totalmem();
  const memUsed = memTotal - os.freemem();
  let disk: SystemInfo['disk'] = null;
  try {
    const st = fs.statfsSync('/');
    const total = st.blocks * st.bsize;
    const free = st.bavail * st.bsize;
    const used = total - free;
    disk = { total, used, free, percent: total ? Math.round((used / total) * 100) : 0 };
  } catch {
    disk = null;
  }
  return {
    host: os.hostname(),
    platform: `${os.platform()} ${os.release()}`,
    cpuCores: os.cpus().length,
    uptime: process.uptime(),
    load: os.loadavg(),
    memory: { total: memTotal, used: memUsed, percent: Math.round((memUsed / memTotal) * 100) },
    disk,
  };
}

// ── Health Alerts ──

export function checkSystemHealth(): void {
  const sys = getSystem();
  const now = Date.now();
  if (sys.disk && sys.disk.percent > 90) {
    const key = 'disk-high';
    if (!healthAlertCooldown[key] || now - healthAlertCooldown[key] > 3600000) {
      addNotification('error', `Disk usage critical: ${sys.disk.percent}% — clean up now`);
      healthAlertCooldown[key] = now;
    }
  }
  if (sys.memory.percent > 90) {
    const key = 'ram-high';
    if (!healthAlertCooldown[key] || now - healthAlertCooldown[key] > 3600000) {
      addNotification('warning', `RAM usage high: ${sys.memory.percent}% — watch for OOM kills`);
      healthAlertCooldown[key] = now;
    }
  }
  if (sys.load[0] > sys.cpuCores * 2) {
    const key = 'load-high';
    if (!healthAlertCooldown[key] || now - healthAlertCooldown[key] > 3600000) {
      addNotification('warning', `CPU load spike: ${sys.load[0].toFixed(1)} (${sys.cpuCores} cores)`);
      healthAlertCooldown[key] = now;
    }
  }
}

// ── Config Summary ──

export function extractConfigSummary(): Record<string, any> {
  const configPath = path.join(CONTROL_HOME, 'config.yaml');
  let raw = '';
  let config: any = {};
  try {
    raw = fs.readFileSync(configPath, 'utf8');
    config = yaml.load(raw) || {};
  } catch { }
  const model = config.model || {};
  const defaultModel = model.default || 'unknown';
  const provider = model.provider || 'unknown';
  const fallbackModel = config.alternate_models?.[0]?.model || 'none';
  const fallbackProvider = config.alternate_models?.[0]?.provider || 'none';
  return { defaultModel, provider, fallbackProvider, fallbackModel, raw };
}

// ── Skills ──

export function getSkills(): string[] {
  const roots = [
    path.join(CONTROL_HOME, 'skills'),
    path.join(CONTROL_HOME, 'hermes-agent', 'skills'),
  ];
  const skills = new Set<string>();
  for (const root of roots) {
    try {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory()) skills.add(entry.name);
      }
    } catch { }
  }
  return Array.from(skills).sort();
}

// ── Models ──

export function getModels(): { label: string; value: string }[] {
  const cfg = extractConfigSummary();
  return [
    { label: 'Default', value: cfg.defaultModel },
    { label: 'Provider', value: cfg.provider },
    { label: 'Fallback', value: `${cfg.fallbackProvider} / ${cfg.fallbackModel}` },
    { label: 'Session model', value: process.env.LLM_MODEL || 'openai/gpt-4o-mini' },
  ];
}

// ── Knowledge ──

async function buildKnowledgeMarkdown(): Promise<string> {
  const { shell } = require('./shell');
  const raw = await shell('hermes status');
  if (raw) {
    const status = raw.replace(/\r?\n/g, '\n').trim();
    return `## Hermes Status\n\`\`\`\n${status}\n\`\`\``;
  }
  return '## Hermes Status\n`hermes status` unavailable — is Hermes running?';
}

// ── Sprite ──

export function buildSpriteState(): typeof spriteState {
  const elapsed = Date.now() - spriteState.since;
  const states = ['idle', 'thinking', 'coding', 'executing'];
  const state = states[Math.floor(elapsed / 5000) % states.length];
  spriteState.state = state;
  spriteState.label = ({
    idle: 'ready',
    thinking: 'reasoning',
    coding: 'building',
    executing: 'running',
  } as Record<string, string>)[state] || 'ready';
  spriteState.details = `sessions`;
  spriteState.frame = Math.floor(elapsed / 500) % 3;
  return spriteState;
}

// ── Explorer ──

function buildExplorerRoot({ key, label, root }: { key: string; label: string; root: string }): any {
  const { IGNORED_DIRS } = require('../state');

  function listDirectory(current: string, depth: number, maxDepth: number, maxEntries: number, baseRoot: string): any[] {
    if (depth > maxDepth) return [];
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch { return []; }
    entries = entries
      .filter((e) => !e.name.startsWith('.DS_Store') && !IGNORED_DIRS.has(e.name))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    const output: any[] = [];
    for (const entry of entries) {
      if (output.length >= maxEntries) break;
      const abs = path.join(current, entry.name);
      const node: any = {
        name: entry.name,
        path: abs,
        rel: path.relative(baseRoot, abs) || entry.name,
        type: entry.isDirectory() ? 'dir' : 'file',
        depth,
        children: [],
      };
      if (entry.isDirectory() && depth < maxDepth) {
        node.children = listDirectory(abs, depth + 1, maxDepth, maxEntries, baseRoot);
      }
      output.push(node);
    }
    return output;
  }

  return {
    key,
    label,
    root,
    children: listDirectory(root, 0, 2, 140, root),
  };
}

// ── Dashboard State ──

export async function buildDashboardState(authed = false): Promise<Record<string, any>> {
  if (authed) checkSystemHealth();
  const terminal = ensureTerminalSession();
  const [sessionsData, allSessionsData, cronJobsData, knowledgeData, profilesData] = await Promise.all([
    getSessions(),
    getAllSessions(),
    getCronJobs(),
    buildKnowledgeMarkdown(),
    getProfiles(),
  ]);
  let insightsData = null;
  try {
    insightsData = await Promise.race([
      getInsights(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 2000)),
    ]);
  } catch { }
  return {
    title: 'Hermes Control Interface',
    now: new Date().toISOString(),
    passwordRequired: true,
    authed,
    agent: buildSpriteState(),
    system: getSystem(),
    sessionCount: sessionsData.length,
    sessions: sessionsData,
    allSessions: allSessionsData,
    cronJobs: cronJobsData,
    profiles: profilesData,
    quickActions,
    explorerRoots: ROOTS.map(buildExplorerRoot),
    tokens: getTokens(insightsData),
    usage: buildUsageSummary(insightsData),
    skills: getSkills(),
    models: getModels(),
    configSummary: extractConfigSummary(),
    knowledge: knowledgeData,
    logs: events.slice(-30),
    loginIdentity: HCI_IDENTITY,
    workingDir: PROJECT_ROOT,
    avatar: (() => {
      const override = readAvatarOverride();
      const hash = override ? crypto.createHash('md5').update(override).digest('hex').slice(0, 12) : 'default';
      return { url: '/api/avatar/image', custom: !!override, hash };
    })(),
    terminal: {
      ready: terminal.ready,
      buffer: terminal.buffer,
      prompt: terminal.prompt,
      cwd: terminal.cwd,
      lastError: terminal.lastError,
    },
  };
}
