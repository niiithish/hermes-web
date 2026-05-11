'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/app/lib/api-client';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentProfile {
  name: string;
  active: boolean;
  gateway?: string;
  model?: string;
  alias?: string;
}

interface GatewayInfo {
  ok: boolean;
  active: boolean;
  service?: string;
  enabled?: boolean;
  error?: string;
}

interface GatewayHealth {
  ok: boolean;
  healthy: boolean;
  port?: string;
  gatewayMode?: string;
  checks: Record<string, boolean>;
  issues: string[];
  error?: string;
}

interface GatewayConnections {
  ok: boolean;
  platforms?: { name: string; connected: boolean; detail?: string }[];
}

interface SessionRow {
  id: string;
  title?: string;
  source?: string;
  messageCount?: number;
  message_count?: number;
  updated_at?: string;
}

interface UsageData {
  ok: boolean;
  sessions: number;
  messages: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: string;
  activeTime: string;
  models?: { name: string; tokens: number }[];
  platforms?: { name: string; tokens: number }[];
  topTools?: { name: string; calls: number; pct: string }[];
}

interface SkillItem {
  name: string;
  category: string;
  source: string;
  trust: string;
}

interface CronJob {
  id: string;
  name: string;
  schedule: string;
  status: string;
  nextRun?: string;
}

interface CronData {
  ok: boolean;
  schedulerRunning?: boolean;
  jobs: CronJob[];
  error?: string;
}

interface ConfigData {
  ok: boolean;
  config?: Record<string, Record<string, unknown>>;
  raw_yaml?: string;
  error?: string;
}

interface MemoryData {
  ok: boolean;
  memory_chars?: number;
  memory_max?: number;
  user_chars?: number;
  user_max?: number;
  soul_chars?: number;
  memory_content?: string;
  user_content?: string;
  soul_content?: string;
  honcho_data?: {
    connected: boolean;
    enabled?: boolean;
    host?: string;
    workspace?: string;
    ai_peer?: string;
    user_peer?: string;
    session_key?: string;
    recall_mode?: string;
    write_freq?: string;
    config_path?: string;
    representation?: string;
  };
  connected?: boolean;
}

// ─── Parse helpers ───────────────────────────────────────────────────────────

function parseSkillTable(output: string): SkillItem[] {
  const lines = String(output || '').split('\n');
  const skills: SkillItem[] = [];
  const rowPattern = /[│┃]\s*([^│┃\s][^│┃]*?)\s*[│┃]\s*([^│┃]*?)\s*[│┃]\s*(\S+)\s*[│┃]\s*(\S+)\s*[│┃]/;
  for (const line of lines) {
    if (line.includes('┏') || line.includes('┗') || line.includes('┡') || line.includes('┩') || line.includes('╍')) continue;
    const match = line.match(rowPattern);
    if (match) {
      const name = match[1].trim();
      if (!name || name === 'Name' || name === '#') continue;
      skills.push({
        name,
        category: match[2].trim(),
        source: match[3].trim(),
        trust: match[4].trim(),
      });
    }
  }
  return skills;
}

function formatNumber(n: number): string {
  if (!n) return '0';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

// ─── Shared Styles ───────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase' as const,
  color: 'var(--fg)',
  marginBottom: '8px',
};

const cardGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: '16px',
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

const btnGhostStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  padding: '6px 16px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--bg-panel)',
  color: 'var(--fg)',
  fontFamily: 'var(--font)',
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.2s',
  whiteSpace: 'nowrap' as const,
};

const btnPrimaryStyle: React.CSSProperties = {
  ...btnGhostStyle,
  background: 'var(--accent)',
  color: '#fff',
  border: 'none',
};

const btnSmStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: '11px',
};

const btnDangerStyle: React.CSSProperties = {
  ...btnGhostStyle,
  ...btnSmStyle,
  color: 'var(--red)',
  borderColor: 'var(--red)',
};

const tabBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0',
  marginBottom: '16px',
  borderBottom: '1px solid var(--border)',
  overflowX: 'auto',
};

const tabStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: '13px',
  fontWeight: 500,
  color: 'var(--fg-muted)',
  background: 'none',
  border: 'none',
  borderBottom: '2px solid transparent',
  cursor: 'pointer',
  transition: 'all 0.2s',
  fontFamily: 'var(--font)',
  whiteSpace: 'nowrap' as const,
};

const tabActiveStyle: React.CSSProperties = {
  ...tabStyle,
  color: 'var(--fg)',
  borderBottom: '2px solid var(--accent)',
};

const badgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 6px',
  fontSize: '10px',
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase' as const,
  borderRadius: '4px',
  border: '1px solid var(--border)',
};

const statusOk: React.CSSProperties = { color: 'var(--green)' };
const statusOff: React.CSSProperties = { color: 'var(--fg-muted)' };

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0,0,0,0.6)',
  zIndex: 999,
};

const modalCardStyle: React.CSSProperties = {
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  padding: '24px',
  minWidth: '360px',
  maxWidth: '90vw',
  boxShadow: 'var(--shadow)',
};

const modalTitleStyle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 600,
  marginBottom: '16px',
  color: 'var(--fg-base)',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  color: 'var(--fg)',
  fontFamily: 'var(--font)',
  fontSize: '12px',
  outline: 'none',
};

const toastBase: React.CSSProperties = {
  position: 'fixed',
  bottom: '24px',
  right: '24px',
  padding: '10px 20px',
  borderRadius: 'var(--radius)',
  fontSize: '13px',
  fontWeight: 500,
  zIndex: 9999,
  boxShadow: 'var(--shadow)',
};

const TABS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'gateway', label: 'Gateway' },
  { key: 'config', label: 'Config' },
  { key: 'memory', label: 'Memory' },
  { key: 'skills', label: 'Skills' },
  { key: 'cron', label: 'Cron' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

// ─── Component ───────────────────────────────────────────────────────────────

export default function AgentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const name = decodeURIComponent(String(params?.id ?? ''));

  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tabLoading, setTabLoading] = useState(false);
  const [tabError, setTabError] = useState<string | null>(null);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Confirm
  const confirmResolveRef = useRef<((v: boolean) => void) | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; title: string } | null>(null);

  // ── Dashboard data ─────────────────────────────────────────────────────

  const [dashboardProfile, setDashboardProfile] = useState<AgentProfile | null>(null);
  const [gatewayInfo, setGatewayInfo] = useState<GatewayInfo | null>(null);
  const [tokenUsage, setTokenUsage] = useState<UsageData | null>(null);
  const [tokenLoading, setTokenLoading] = useState(true);

  // ── Sessions data ──────────────────────────────────────────────────────

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionSearch, setSessionSearch] = useState('');
  const [sessionPage, setSessionPage] = useState(0);
  const [sessionStats, setSessionStats] = useState<{
    total: string;
    messages: string;
    dbSize: string;
    cli?: string;
    telegram?: string;
    whatsapp?: string;
  } | null>(null);
  const PAGE_SIZE = 50;

  // ── Gateway data ───────────────────────────────────────────────────────

  const [gwInfo, setGwInfo] = useState<GatewayInfo | null>(null);
  const [gwHealth, setGwHealth] = useState<GatewayHealth | null>(null);
  const [gwConnections, setGwConnections] = useState<GatewayConnections | null>(null);
  const [gwLoading, setGwLoading] = useState(false);
  const [gwHealthLoading, setGwHealthLoading] = useState(false);

  // ── Config data ────────────────────────────────────────────────────────

  const [configData, setConfigData] = useState<ConfigData | null>(null);
  const [configCat, setConfigCat] = useState('model');
  const [configEditMode, setConfigEditMode] = useState(false);
  const configCategories = [
    { key: 'model', label: 'Model & Provider' },
    { key: 'agent', label: 'Agent Behavior' },
    { key: 'terminal', label: 'Terminal' },
    { key: 'display', label: 'Display & Streaming' },
    { key: 'compression', label: 'Context & Compression' },
    { key: 'platforms', label: 'Platforms' },
    { key: 'mcp', label: 'MCP Servers' },
    { key: 'secrets', label: 'Secrets (.env)' },
    { key: 'raw', label: 'Raw YAML' },
  ];

  // ── Memory data ────────────────────────────────────────────────────────

  const [memoryData, setMemoryData] = useState<MemoryData | null>(null);
  const [memoryProvider, setMemoryProvider] = useState('built-in');

  // ── Skills data ────────────────────────────────────────────────────────

  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [skillsOutput, setSkillsOutput] = useState('');
  const [skillsLoading, setSkillsLoading] = useState(false);

  // ── Cron data ──────────────────────────────────────────────────────────

  const [cronData, setCronData] = useState<CronData | null>(null);
  const [cronLoading, setCronLoading] = useState(false);
  const [showCreateCron, setShowCreateCron] = useState(false);
  const [showEditCron, setShowEditCron] = useState(false);
  const [editCronJob, setEditCronJob] = useState<CronJob | null>(null);

  // ── Toast ───────────────────────────────────────────────────────────────

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // ── Confirm ─────────────────────────────────────────────────────────────

  const confirm = useCallback((message: string, title: string): Promise<boolean> => {
    return new Promise((resolve) => {
      confirmResolveRef.current = resolve;
      setConfirmDialog({ message, title });
    });
  }, []);

  const handleConfirmYes = useCallback(() => {
    confirmResolveRef.current?.(true);
    confirmResolveRef.current = null;
    setConfirmDialog(null);
  }, []);

  const handleConfirmNo = useCallback(() => {
    confirmResolveRef.current?.(false);
    confirmResolveRef.current = null;
    setConfirmDialog(null);
  }, []);

  // ── Load tab content on tab change ─────────────────────────────────────

  useEffect(() => {
    if (!name) return;
    setTabLoading(true);
    setTabError(null);

    const loadTab = async () => {
      try {
        switch (activeTab) {
          case 'dashboard': await loadDashboardTab(); break;
          case 'sessions': await loadSessionsTab(); break;
          case 'gateway': await loadGatewayTab(); break;
          case 'config': await loadConfigTab(); break;
          case 'memory': await loadMemoryTab(); break;
          case 'skills': await loadSkillsTab(); break;
          case 'cron': await loadCronTab(); break;
        }
      } catch (e) {
        setTabError(e instanceof Error ? e.message : 'Failed to load tab');
      } finally {
        setTabLoading(false);
      }
    };

    loadTab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, name]);

  // ── Dashboard tab ──────────────────────────────────────────────────────

  const loadDashboardTab = useCallback(async () => {
    setTokenLoading(true);
    try {
      const [gatewayRes, profilesRes, usageRes] = await Promise.all([
        api.get<GatewayInfo>(`/api/gateway/${name}`),
        api.get<{ ok: boolean; profiles: AgentProfile[] }>('/api/profiles'),
        api.get<UsageData>('/api/usage/1'),
      ]);

      const profile = profilesRes.ok ? profilesRes.profiles.find(p => p.name === name) || null : null;
      setDashboardProfile(profile);
      setGatewayInfo(gatewayRes);
      setTokenUsage(usageRes.ok ? usageRes : null);
    } catch {
      // errors shown in per-section states
    } finally {
      setTokenLoading(false);
    }
  }, [name]);

  // ── Sessions tab ───────────────────────────────────────────────────────

  const loadSessionsTab = useCallback(async () => {
    setSessionsLoading(true);
    setSessionPage(0);
    setSessionSearch('');

    // Load stats
    try {
      const statsRes = await api.get<{ ok: boolean; stats: string }>('/api/sessions/stats');
      if (statsRes.ok && statsRes.stats) {
        const raw = statsRes.stats;
        const totalMatch = raw.match(/Total sessions:\s+(\d+)/);
        const messagesMatch = raw.match(/Total messages:\s+([\d,]+)/);
        const dbMatch = raw.match(/Database size:\s+(.+)/);
        const cliMatch = raw.match(/cli:\s+(\d+)\s+sessions/);
        const tgMatch = raw.match(/telegram:\s+(\d+)\s+sessions/);
        const waMatch = raw.match(/whatsapp:\s+(\d+)\s+sessions/);
        setSessionStats({
          total: totalMatch?.[1] || '—',
          messages: messagesMatch?.[1] || '—',
          dbSize: dbMatch?.[1] || '—',
          cli: cliMatch?.[1],
          telegram: tgMatch?.[1],
          whatsapp: waMatch?.[1],
        });
      }
    } catch { /* ignore */ }

    // Load sessions
    try {
      const res = await api.get<{ ok: boolean; sessions: SessionRow[] }>(`/api/all-sessions?profile=${encodeURIComponent(name)}`);
      if (res.ok && res.sessions) {
        setSessions(res.sessions);
      } else {
        setSessions([]);
      }
    } catch (e) {
      setTabError(e instanceof Error ? e.message : 'Failed to load sessions');
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, [name]);

  const filteredSessions = sessions.filter(s => {
    if (!sessionSearch) return true;
    const q = sessionSearch.toLowerCase();
    return (s.title || '').toLowerCase().includes(q) ||
           (s.id || '').toLowerCase().includes(q) ||
           (s.source || '').toLowerCase().includes(q);
  });

  const totalSessionPages = Math.ceil(filteredSessions.length / PAGE_SIZE);
  const pagedSessions = filteredSessions.slice(sessionPage * PAGE_SIZE, (sessionPage + 1) * PAGE_SIZE);

  // ── Gateway tab ────────────────────────────────────────────────────────

  const loadGatewayTab = useCallback(async () => {
    setGwLoading(true);
    setGwHealthLoading(true);
    try {
      const [infoRes, connectionsRes] = await Promise.all([
        api.get<GatewayInfo>(`/api/gateway/${name}`),
        api.get<GatewayConnections>(`/api/gateway/${name}/connections`),
      ]);
      setGwInfo(infoRes);
      setGwConnections(connectionsRes);
    } catch (e) {
      setTabError(e instanceof Error ? e.message : 'Failed to load gateway');
    } finally {
      setGwLoading(false);
    }

    // Health check separately (slower)
    try {
      const healthRes = await api.get<GatewayHealth>(`/api/gateway/${name}/health`);
      setGwHealth(healthRes);
    } catch { /* ignore */ }
    setGwHealthLoading(false);
  }, [name]);

  const gatewayAction = useCallback(async (action: string) => {
    const messages: Record<string, string> = {
      start: `Start gateway for ${name}?`,
      stop: `Stop gateway for ${name}?`,
      restart: `Restart gateway for ${name}? This may interrupt active sessions.`,
    };
    const ok = await confirm(messages[action] || `${action} gateway for ${name}?`, action.charAt(0).toUpperCase() + action.slice(1) + ' Gateway');
    if (!ok) return;
    try {
      const res = await api.post<{ ok: boolean; error?: string }>(`/api/gateway/${name}/${action}`);
      if (res.ok) {
        showToast(`Gateway ${action} successful`, 'success');
        loadGatewayTab();
      } else {
        showToast(`Gateway ${action} failed: ${res.error || 'Unknown error'}`, 'error');
      }
    } catch (e) {
      showToast(`Gateway ${action} failed: ${e instanceof Error ? e.message : 'Error'}`, 'error');
    }
  }, [name, confirm, showToast, loadGatewayTab]);

  const fixGateway = useCallback(async () => {
    const ok = await confirm(`Restart gateway service for profile ${name}?`, 'Fix Gateway');
    if (!ok) return;
    try {
      const res = await api.post<{ ok: boolean; error?: string }>(`/api/gateway/${name}/start`);
      if (res.ok) {
        showToast('Gateway restarted', 'success');
        setTimeout(() => loadGatewayTab(), 3000);
      } else {
        showToast('Failed: ' + (res.error || 'unknown'), 'error');
      }
    } catch (e) {
      showToast('Error: ' + (e instanceof Error ? e.message : 'Error'), 'error');
    }
  }, [name, confirm, showToast, loadGatewayTab]);

  // ── Config tab ─────────────────────────────────────────────────────────

  const loadConfigTab = useCallback(async () => {
    try {
      const res = await api.get<ConfigData>(`/api/config/${name}`);
      setConfigData(res);
      setConfigCat('model');
      setConfigEditMode(false);
    } catch (e) {
      setTabError(e instanceof Error ? e.message : 'Failed to load config');
    }
  }, [name]);

  const renderConfigValue = (key: string, value: unknown): string => {
    if (typeof value === 'boolean') return value ? '✓ Yes' : '✗ No';
    if (value === null || value === undefined) return '—';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  // ── Memory tab ─────────────────────────────────────────────────────────

  const loadMemoryTab = useCallback(async () => {
    try {
      const [memoryRes, configRes] = await Promise.all([
        api.get<MemoryData>(`/api/memory/${name}`),
        api.get<ConfigData>(`/api/config/${name}`),
      ]);
      setMemoryData(memoryRes.ok ? memoryRes : null);
      setMemoryProvider(configRes.ok ? (configRes.config as any)?.memory?.provider || 'built-in' : 'built-in');
    } catch (e) {
      setTabError(e instanceof Error ? e.message : 'Failed to load memory');
    }
  }, [name]);

  // ── Skills tab ─────────────────────────────────────────────────────────

  const loadSkillsTab = useCallback(async () => {
    setSkillsLoading(true);
    try {
      const res = await api.get<{ ok: boolean; output: string; error?: string }>(`/api/skills/list/${name}`);
      if (res.ok && res.output) {
        setSkillsOutput(res.output);
        setSkills(parseSkillTable(res.output));
      } else {
        setSkillsOutput(res.error || 'Failed to load');
        setSkills([]);
      }
    } catch (e) {
      setSkillsOutput(e instanceof Error ? e.message : 'Failed to load');
      setSkills([]);
    } finally {
      setSkillsLoading(false);
    }
  }, [name]);

  const handleUpdateSkill = useCallback(async (skillName: string) => {
    const ok = await confirm(`Update skill "${skillName}" on ${name}?`, 'Update Skill');
    if (!ok) return;
    try {
      const res = await api.post<{ ok: boolean; output?: string }>('/api/skills/update', { skill: skillName, profile: name });
      showToast(res.ok ? 'Skill updated!' : (res.output || 'Update failed'), res.ok ? 'success' : 'error');
      if (res.ok) loadSkillsTab();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Error', 'error');
    }
  }, [name, confirm, showToast, loadSkillsTab]);

  const handleUninstallSkill = useCallback(async (skillName: string) => {
    const ok = await confirm(`Are you sure you want to uninstall "${skillName}" from ${name}?`, 'Uninstall Skill');
    if (!ok) return;
    try {
      const res = await api.post<{ ok: boolean; output?: string }>('/api/skills/uninstall', { skill: skillName, profile: name });
      showToast(res.ok ? 'Skill uninstalled!' : (res.output || 'Uninstall failed'), res.ok ? 'success' : 'error');
      if (res.ok) loadSkillsTab();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Error', 'error');
    }
  }, [name, confirm, showToast, loadSkillsTab]);

  const handleCheckSkillUpdates = useCallback(async () => {
    try {
      showToast('Checking for updates...', 'info');
      const res = await api.post<{ ok: boolean; output?: string; error?: string }>('/api/skills/check', { profile: name });
      if (res.ok && res.output) {
        if (res.output.includes('up to date') || res.output.includes('0 update')) {
          await confirm('All skills are up to date!', 'Skill Updates');
        } else if (res.output.includes('unavailable')) {
          await confirm('Some installed skills could not be checked (source unavailable).', 'Skill Updates');
        } else {
          // Has updates — parse and show
          const updates = parseSkillTable(res.output);
          if (updates.length === 0) {
            await confirm('All skills are up to date!', 'Skill Updates');
          } else {
            const msg = updates.map(u =>
              `${u.name}: ${u.trust || u.source}`
            ).join('\n');
            const hasUpdates = updates.some(u => u.trust !== 'up_to_date');
            await confirm(
              hasUpdates ? `Updates available:\n\n${msg}` : 'All skills are up to date!',
              'Skill Updates'
            );
          }
        }
      } else if (res.error) {
        showToast(res.error || 'Check failed', 'error');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Error', 'error');
    }
  }, [name, confirm, showToast]);

  // ── Cron tab ───────────────────────────────────────────────────────────

  const loadCronTab = useCallback(async () => {
    setCronLoading(true);
    try {
      const res = await api.get<CronData>(`/api/hermes-cron/${encodeURIComponent(name)}`);
      setCronData(res);
    } catch (e) {
      setTabError(e instanceof Error ? e.message : 'Failed to load cron jobs');
    } finally {
      setCronLoading(false);
    }
  }, [name]);

  const cronAction = useCallback(async (jobId: string, action: string) => {
    const labels: Record<string, string> = { run: 'Run', pause: 'Pause', resume: 'Resume' };
    const ok = await confirm(`${labels[action] || action} cron job on ${name}?`, (labels[action] || action) + ' Job');
    if (!ok) return;
    try {
      await api.post(`/api/hermes-cron/${encodeURIComponent(name)}/${jobId}/${action}`);
      showToast('Job ' + action + 'd', 'success');
      setTimeout(() => loadCronTab(), 500);
    } catch (e) {
      showToast(action + ' failed: ' + (e instanceof Error ? e.message : 'Error'), 'error');
    }
  }, [name, confirm, showToast, loadCronTab]);

  const cronRemove = useCallback(async (jobId: string, jobName: string) => {
    const ok = await confirm(`Remove job "${jobName}"?`, 'Remove Job');
    if (!ok) return;
    try {
      await api.post(`/api/hermes-cron/${encodeURIComponent(name)}/${jobId}/remove`);
      showToast('Job removed', 'success');
      setTimeout(() => loadCronTab(), 500);
    } catch (e) {
      showToast('Remove failed: ' + (e instanceof Error ? e.message : 'Error'), 'error');
    }
  }, [name, confirm, showToast, loadCronTab]);

  const handleCreateCron = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const schedule = (form.querySelector('[name="schedule"]') as HTMLInputElement).value.trim();
    const prompt = (form.querySelector('[name="prompt"]') as HTMLTextAreaElement).value.trim();
    const jobName = (form.querySelector('[name="name"]') as HTMLInputElement).value.trim();
    const deliver = (form.querySelector('[name="deliver"]') as HTMLSelectElement).value;
    const repeat = (form.querySelector('[name="repeat"]') as HTMLSelectElement).value;

    if (!schedule) { showToast('Schedule required', 'error'); return; }
    if (!prompt) { showToast('Prompt required', 'error'); return; }

    try {
      const res = await api.post<{ ok: boolean; error?: string }>(`/api/hermes-cron/${encodeURIComponent(name)}/create`, {
        schedule, prompt, name: jobName, deliver, repeat: repeat || undefined,
      });
      if (res.ok) {
        showToast('Cron job created', 'success');
        setShowCreateCron(false);
        setTimeout(() => loadCronTab(), 500);
      } else {
        showToast(res.error || 'Create failed', 'error');
      }
    } catch (err) {
      showToast('Create failed: ' + (err instanceof Error ? err.message : 'Error'), 'error');
    }
  }, [name, showToast, loadCronTab]);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '24px', height: '100%', overflowY: 'auto' }}>
      {/* ── Page Header ────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--fg)' }}>
            Agent: {name}
          </div>
          <div style={{ fontSize: '13px', color: 'var(--fg-muted)', marginTop: '4px' }}>Agent detail</div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button style={btnGhostStyle} onClick={() => router.push('/agents')}>← Back</button>
        </div>
      </div>

      {/* ── Tab Bar ────────────────────────────────────────────────────── */}
      <div style={tabBarStyle}>
        {TABS.map(t => (
          <button
            key={t.key}
            style={activeTab === t.key ? tabActiveStyle : tabStyle}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab Error ──────────────────────────────────────────────────── */}
      {tabError && (
        <div style={{ color: 'var(--red)', fontSize: '13px', padding: '8px 0', marginBottom: '12px' }}>{tabError}</div>
      )}

      {/* ── Tab Loading ────────────────────────────────────────────────── */}
      {tabLoading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', color: 'var(--fg-muted)', fontStyle: 'italic' }}>
          Loading...
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          DASHBOARD TAB
          ══════════════════════════════════════════════════════════════════ */}
      {!tabLoading && activeTab === 'dashboard' && (
        <div style={cardGridStyle}>
          {/* Identity card */}
          <div style={cardStyle}>
            <div style={cardTitleStyle}>Identity</div>
            <div style={statRowStyle}><span style={statLabelStyle}>Profile</span><span style={statValueStyle}>{name}</span></div>
            <div style={statRowStyle}><span style={statLabelStyle}>Model</span><span style={statValueStyle}>{dashboardProfile?.model || '—'}</span></div>
            <div style={statRowStyle}>
              <span style={statLabelStyle}>Status</span>
              <span style={{ ...statValueStyle, ...(gatewayInfo?.ok && gatewayInfo?.active ? statusOk : statusOff) }}>
                {gatewayInfo?.ok && gatewayInfo?.active ? '● Active' : '○ Inactive'}
              </span>
            </div>
            {dashboardProfile?.alias && (
              <div style={statRowStyle}><span style={statLabelStyle}>Alias</span><span style={statValueStyle}>{dashboardProfile.alias}</span></div>
            )}
            {dashboardProfile?.active && (
              <div style={statRowStyle}>
                <span style={statLabelStyle}>Default</span><span style={{ ...statValueStyle, ...statusOk }}>Yes</span>
              </div>
            )}
          </div>

          {/* Gateway card */}
          <div style={cardStyle}>
            <div style={cardTitleStyle}>Gateway</div>
            <div style={statRowStyle}><span style={statLabelStyle}>Service</span><span style={statValueStyle}>{gatewayInfo?.service || '—'}</span></div>
            <div style={statRowStyle}>
              <span style={statLabelStyle}>Status</span>
              <span style={{ ...statValueStyle, ...(gatewayInfo?.ok && gatewayInfo?.active ? statusOk : statusOff) }}>
                {gatewayInfo?.ok && gatewayInfo?.active ? '● Running' : '○ Stopped'}
              </span>
            </div>
            <div style={statRowStyle}><span style={statLabelStyle}>Enabled</span><span style={statValueStyle}>{gatewayInfo?.enabled ? 'Yes' : 'No'}</span></div>
          </div>

          {/* Token Usage card */}
          <div style={{ ...cardStyle, gridColumn: 'span 2' }}>
            <div style={cardTitleStyle}>Token Usage (today)</div>
            {tokenLoading ? (
              <div style={{ color: 'var(--fg-muted)', fontStyle: 'italic', padding: '16px 0' }}>Loading...</div>
            ) : tokenUsage ? (
              <>
                <div style={statRowStyle}><span style={statLabelStyle}>Sessions</span><span style={statValueStyle}>{tokenUsage.sessions}</span></div>
                <div style={statRowStyle}><span style={statLabelStyle}>Messages</span><span style={statValueStyle}>{(tokenUsage.messages || 0).toLocaleString()}</span></div>
                <div style={statRowStyle}><span style={statLabelStyle}>Input tokens</span><span style={statValueStyle}>{formatNumber(tokenUsage.inputTokens)}</span></div>
                <div style={statRowStyle}><span style={statLabelStyle}>Output tokens</span><span style={statValueStyle}>{formatNumber(tokenUsage.outputTokens)}</span></div>
                <div style={statRowStyle}><span style={statLabelStyle}>Total tokens</span><span style={statValueStyle}>{formatNumber(tokenUsage.totalTokens)}</span></div>
                <div style={statRowStyle}><span style={statLabelStyle}>Est. cost</span><span style={statValueStyle}>{tokenUsage.cost || '$0.00'}</span></div>
                <div style={statRowStyle}><span style={statLabelStyle}>Active time</span><span style={statValueStyle}>{tokenUsage.activeTime || '—'}</span></div>
                {tokenUsage.models && tokenUsage.models.length > 0 && (
                  <>
                    <div style={{ marginTop: '8px', fontSize: '10px', color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Models</div>
                    {tokenUsage.models.slice(0, 3).map((m, i) => (
                      <div key={i} style={statRowStyle}>
                        <span style={statLabelStyle}>{m.name}</span><span style={statValueStyle}>{m.tokens} tokens</span>
                      </div>
                    ))}
                  </>
                )}
              </>
            ) : (
              <div style={statRowStyle}><span style={statLabelStyle}>No data</span></div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          SESSIONS TAB
          ══════════════════════════════════════════════════════════════════ */}
      {!tabLoading && activeTab === 'sessions' && (
        <div>
          {/* Stats */}
          {sessionStats && (
            <div style={{ ...cardStyle, marginBottom: '16px' }}>
              <div style={cardTitleStyle}>Session Stats</div>
              <div style={statRowStyle}><span style={statLabelStyle}>Total sessions</span><span style={statValueStyle}>{sessionStats.total}</span></div>
              <div style={statRowStyle}><span style={statLabelStyle}>Total messages</span><span style={statValueStyle}>{sessionStats.messages}</span></div>
              <div style={statRowStyle}><span style={statLabelStyle}>DB size</span><span style={statValueStyle}>{sessionStats.dbSize}</span></div>
              <div style={{ marginTop: '6px', fontSize: '10px', color: 'var(--fg-subtle)', textTransform: 'uppercase' }}>By Platform</div>
              {sessionStats.cli && <div style={statRowStyle}><span style={statLabelStyle}>CLI</span><span style={statValueStyle}>{sessionStats.cli} sessions</span></div>}
              {sessionStats.telegram && <div style={statRowStyle}><span style={statLabelStyle}>Telegram</span><span style={statValueStyle}>{sessionStats.telegram} sessions</span></div>}
              {sessionStats.whatsapp && <div style={statRowStyle}><span style={statLabelStyle}>WhatsApp</span><span style={statValueStyle}>{sessionStats.whatsapp} sessions</span></div>}
            </div>
          )}

          {/* Search & Refresh */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Search sessions..."
              value={sessionSearch}
              onChange={e => { setSessionSearch(e.target.value); setSessionPage(0); }}
              style={{ ...inputStyle, flex: 1, marginBottom: 0 }}
            />
            <button style={btnGhostStyle} onClick={loadSessionsTab}>↻ Refresh</button>
          </div>

          {/* Sessions table */}
          {sessionsLoading ? (
            <div style={{ padding: '20px', color: 'var(--fg-muted)', fontStyle: 'italic' }}>Loading sessions...</div>
          ) : sessions.length === 0 ? (
            <div style={{ ...cardStyle, alignItems: 'center', padding: '40px', color: 'var(--fg-muted)' }}>No sessions found</div>
          ) : pagedSessions.length === 0 ? (
            <div style={{ ...cardStyle, alignItems: 'center', padding: '40px', color: 'var(--fg-muted)' }}>No matching sessions</div>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--fg-muted)', fontWeight: 500, fontSize: '11px' }}>Session ID</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--fg-muted)', fontWeight: 500, fontSize: '11px' }}>Title</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--fg-muted)', fontWeight: 500, fontSize: '11px' }}>Source</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--fg-muted)', fontWeight: 500, fontSize: '11px' }}>Messages</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--fg-muted)', fontWeight: 500, fontSize: '11px' }}>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedSessions.map(s => (
                      <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: '11px', color: 'var(--fg)' }}>
                          {s.id || '—'}
                        </td>
                        <td style={{ padding: '8px 12px', color: 'var(--fg)' }}>{s.title || 'Untitled'}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <span style={badgeStyle}>{s.source || '—'}</span>
                        </td>
                        <td style={{ padding: '8px 12px', color: 'var(--fg)' }}>
                          {s.messageCount ?? s.message_count ?? '—'}
                        </td>
                        <td style={{ padding: '8px 12px', fontSize: '11px', color: 'var(--fg-muted)' }}>
                          {s.updated_at ? new Date(s.updated_at).toLocaleDateString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                <div style={{ fontSize: '11px', color: 'var(--fg-muted)' }}>
                  {sessionPage * PAGE_SIZE + 1}–{Math.min((sessionPage + 1) * PAGE_SIZE, filteredSessions.length)} of {filteredSessions.length} sessions
                </div>
                {totalSessionPages > 1 && (
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      style={{ ...btnGhostStyle, ...btnSmStyle, opacity: sessionPage <= 0 ? 0.3 : 1 }}
                      onClick={() => setSessionPage(p => p - 1)}
                      disabled={sessionPage <= 0}
                    >
                      ← Prev
                    </button>
                    <span style={{ fontSize: '11px', color: 'var(--fg-muted)', padding: '4px 8px' }}>
                      {sessionPage + 1} / {totalSessionPages}
                    </span>
                    <button
                      style={{ ...btnGhostStyle, ...btnSmStyle, opacity: sessionPage >= totalSessionPages - 1 ? 0.3 : 1 }}
                      onClick={() => setSessionPage(p => p + 1)}
                      disabled={sessionPage >= totalSessionPages - 1}
                    >
                      Next →
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          GATEWAY TAB
          ══════════════════════════════════════════════════════════════════ */}
      {!tabLoading && activeTab === 'gateway' && (
        <div>
          {/* Health check */}
          <div style={{ marginBottom: '12px' }}>
            {gwHealthLoading ? (
              <div style={{ ...cardStyle, padding: '12px', color: 'var(--fg-muted)', fontStyle: 'italic' }}>
                Checking gateway health...
              </div>
            ) : gwHealth ? (
              <div style={cardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                  <span style={{ fontSize: '20px' }}>{gwHealth.healthy ? '🟢' : '🔴'}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px' }}>{gwHealth.healthy ? 'Healthy' : 'Issues Found'}</div>
                    <div style={{ fontSize: '12px', color: 'var(--fg-muted)' }}>
                      Profile: {name} · Port: {gwHealth.port || 'N/A'} · Mode: {gwHealth.gatewayMode}
                    </div>
                  </div>
                </div>
                {gwHealth.checks && Object.entries(gwHealth.checks).map(([key, value]) => (
                  <div key={key} style={{ padding: '3px 0', fontSize: '12px', color: 'var(--fg-muted)' }}>
                    {value ? '✅' : '❌'} {key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                  </div>
                ))}
                {gwHealth.issues && gwHealth.issues.length > 0 && (
                  <div style={{ marginTop: '8px' }}>
                    {gwHealth.issues.map((issue, i) => (
                      <div key={i} style={{ padding: '2px 0', fontSize: '12px', color: 'var(--amber)' }}>⚠️ {issue}</div>
                    ))}
                  </div>
                )}
                {!gwHealth.healthy && (
                  <div style={{ marginTop: '12px' }}>
                    <button style={{ ...btnPrimaryStyle, ...btnSmStyle }} onClick={fixGateway}>
                      🔧 Auto-Fix
                    </button>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Gateway service + connections */}
          <div style={cardGridStyle}>
            <div style={cardStyle}>
              <div style={cardTitleStyle}>Gateway Service</div>
              {gwLoading ? (
                <div style={{ color: 'var(--fg-muted)', fontStyle: 'italic' }}>Loading...</div>
              ) : gwInfo ? (
                <>
                  <div style={statRowStyle}><span style={statLabelStyle}>Service</span><span style={statValueStyle}>{gwInfo.service || '—'}</span></div>
                  <div style={statRowStyle}>
                    <span style={statLabelStyle}>Status</span>
                    <span style={{ ...statValueStyle, ...(gwInfo.active ? statusOk : statusOff) }}>
                      {gwInfo.active ? '● Running' : '○ Stopped'}
                    </span>
                  </div>
                  <div style={statRowStyle}><span style={statLabelStyle}>Enabled</span><span style={statValueStyle}>{gwInfo.enabled ? 'Yes' : 'No'}</span></div>
                  <div style={{ marginTop: '12px', display: 'flex', gap: '6px' }}>
                    <button style={btnGhostStyle} onClick={() => gatewayAction('start')} disabled={gwInfo.active}>Start</button>
                    <button style={btnGhostStyle} onClick={() => gatewayAction('stop')} disabled={!gwInfo.active}>Stop</button>
                    <button style={btnGhostStyle} onClick={() => gatewayAction('restart')}>Restart</button>
                  </div>
                </>
              ) : null}
            </div>

            <div style={cardStyle}>
              <div style={cardTitleStyle}>Connections</div>
              {gwLoading ? (
                <div style={{ color: 'var(--fg-muted)', fontStyle: 'italic' }}>Loading...</div>
              ) : gwConnections?.platforms && gwConnections.platforms.length > 0 ? (
                gwConnections.platforms.map((p, i) => (
                  <div key={i} style={statRowStyle}>
                    <span style={statLabelStyle}>{p.name}</span>
                    <span style={{ ...statValueStyle, ...(p.connected ? statusOk : statusOff) }}>
                      {p.connected ? '● connected' : '○ not configured'}
                      {p.detail && <span style={{ fontSize: '10px', color: 'var(--fg-muted)', marginLeft: '4px' }}>{p.detail}</span>}
                    </span>
                  </div>
                ))
              ) : (
                <div style={statRowStyle}><span style={statLabelStyle}>No platform data</span></div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          CONFIG TAB
          ══════════════════════════════════════════════════════════════════ */}
      {!tabLoading && activeTab === 'config' && (
        <div>
          {!configData ? (
            <div style={{ ...cardStyle, alignItems: 'center', padding: '40px', color: 'var(--fg-muted)' }}>Loading config...</div>
          ) : !configData.ok ? (
            <div style={{ ...cardStyle, padding: '16px', color: 'var(--red)' }}>{configData.error || 'Failed to load config'}</div>
          ) : (
            <>
              {/* Config category tabs */}
              <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', flexWrap: 'wrap' }}>
                {configCategories.map(cat => (
                  <button
                    key={cat.key}
                    style={{
                      ...btnGhostStyle,
                      ...btnSmStyle,
                      borderColor: configCat === cat.key ? 'var(--accent)' : 'var(--border)',
                      color: configCat === cat.key ? 'var(--accent)' : 'var(--fg-muted)',
                    }}
                    onClick={() => { setConfigCat(cat.key); setConfigEditMode(false); }}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {/* Config content */}
              <div style={cardStyle}>
                {configCat === 'raw' ? (
                  <pre style={{
                    fontSize: '11px',
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: '60vh',
                    overflowY: 'auto',
                    color: 'var(--fg-muted)',
                    margin: 0,
                    background: 'var(--bg-inset)',
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                  }}>
                    {configData.raw_yaml || '(empty)'}
                  </pre>
                ) : configCat === 'secrets' ? (
                  <div>
                    <div style={{ fontSize: '13px', color: 'var(--fg-muted)', marginBottom: '8px' }}>
                      Environment variables for this profile
                    </div>
                    {/* Secrets are shown as key-value pairs */}
                    <div style={{ padding: '16px', background: 'var(--bg-inset)', borderRadius: '8px', border: '1px solid var(--border)', color: 'var(--fg-muted)', fontStyle: 'italic' }}>
                      Secrets are managed via the .env file for the profile.
                    </div>
                  </div>
                ) : configData.config && (configData.config as any)[configCat] ? (
                  <div>
                    {Object.entries((configData.config as any)[configCat] as Record<string, unknown>).map(([key, value]) => (
                      <div key={key} style={statRowStyle}>
                        <span style={statLabelStyle}>{key}</span>
                        <span style={statValueStyle}>{renderConfigValue(key, value)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: 'var(--fg-muted)', textAlign: 'center', padding: '20px' }}>
                    No configuration for this category.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          MEMORY TAB
          ══════════════════════════════════════════════════════════════════ */}
      {!tabLoading && activeTab === 'memory' && (
        <div>
          {!memoryData ? (
            <div style={{ ...cardStyle, alignItems: 'center', padding: '40px', color: 'var(--fg-muted)' }}>Loading memory...</div>
          ) : (
            <div style={cardGridStyle}>
              {/* Built-in Memory */}
              <div style={cardStyle}>
                <div style={cardTitleStyle}>Built-in Memory</div>
                <div style={statRowStyle}>
                  <span style={statLabelStyle}>MEMORY.md</span>
                  <span style={statValueStyle}>{memoryData.memory_chars || 0} / {memoryData.memory_max || 2200} chars</span>
                </div>
                <div style={{ marginTop: '8px' }}>
                  <div style={{
                    height: '6px',
                    background: 'var(--bg-inset)',
                    borderRadius: '3px',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.min(100, ((memoryData.memory_chars || 0) / (memoryData.memory_max || 2200)) * 100)}%`,
                      background: ((memoryData.memory_chars || 0) / (memoryData.memory_max || 2200)) > 0.9 ? 'var(--red)' : 'var(--green)',
                      borderRadius: '3px',
                      transition: 'width 0.3s',
                    }} />
                  </div>
                </div>
                <div style={{ ...statRowStyle, marginTop: '8px' }}>
                  <span style={statLabelStyle}>USER.md</span>
                  <span style={statValueStyle}>{memoryData.user_chars || 0} / {memoryData.user_max || 1375} chars</span>
                </div>
                <div style={statRowStyle}>
                  <span style={statLabelStyle}>SOUL.md</span>
                  <span style={statValueStyle}>{memoryData.soul_chars || 0} chars</span>
                </div>
              </div>

              {/* File Contents */}
              <div style={cardStyle}>
                <div style={cardTitleStyle}>File Contents</div>
                <details style={{ marginBottom: '12px' }}>
                  <summary style={{ cursor: 'pointer', color: 'var(--fg)', fontWeight: 600, fontSize: '13px', padding: '8px 0' }}>
                    MEMORY.md <span style={{ color: 'var(--fg-muted)', fontWeight: 400, fontSize: '11px' }}>({memoryData.memory_chars || 0} chars)</span>
                  </summary>
                  <pre style={{
                    background: 'var(--bg-inset)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '12px',
                    fontSize: '11px',
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: '300px',
                    overflowY: 'auto',
                    color: 'var(--fg)',
                  }}>
                    {memoryData.memory_content || '(empty)'}
                  </pre>
                </details>
                <details style={{ marginBottom: '12px' }}>
                  <summary style={{ cursor: 'pointer', color: 'var(--fg)', fontWeight: 600, fontSize: '13px', padding: '8px 0' }}>
                    USER.md <span style={{ color: 'var(--fg-muted)', fontWeight: 400, fontSize: '11px' }}>({memoryData.user_chars || 0} chars)</span>
                  </summary>
                  <pre style={{
                    background: 'var(--bg-inset)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '12px',
                    fontSize: '11px',
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: '300px',
                    overflowY: 'auto',
                    color: 'var(--fg)',
                  }}>
                    {memoryData.user_content || '(empty)'}
                  </pre>
                </details>
                <details>
                  <summary style={{ cursor: 'pointer', color: 'var(--fg)', fontWeight: 600, fontSize: '13px', padding: '8px 0' }}>
                    SOUL.md <span style={{ color: 'var(--fg-muted)', fontWeight: 400, fontSize: '11px' }}>({memoryData.soul_chars || 0} chars)</span>
                  </summary>
                  <pre style={{
                    background: 'var(--bg-inset)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '12px',
                    fontSize: '11px',
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: '300px',
                    overflowY: 'auto',
                    color: 'var(--fg)',
                  }}>
                    {memoryData.soul_content || '(empty)'}
                  </pre>
                </details>
              </div>

              {/* External Provider */}
              <div style={cardStyle}>
                {memoryProvider === 'honcho' ? (
                  <>
                    <div style={cardTitleStyle}>Honcho Memory</div>
                    <div style={statRowStyle}>
                      <span style={statLabelStyle}>Provider</span>
                      <span style={{ ...statValueStyle, ...statusOk }}>honcho</span>
                    </div>
                    <div style={statRowStyle}>
                      <span style={statLabelStyle}>Status</span>
                      <span style={{ ...statValueStyle, ...(memoryData.honcho_data?.connected ? statusOk : statusOff) }}>
                        {memoryData.honcho_data?.connected ? '● Connected' : '○ Disconnected'}
                      </span>
                    </div>
                    {memoryData.honcho_data?.enabled !== undefined && (
                      <div style={statRowStyle}><span style={statLabelStyle}>Enabled</span><span style={statValueStyle}>{memoryData.honcho_data.enabled ? 'Yes' : 'No'}</span></div>
                    )}
                    {memoryData.honcho_data?.host && (
                      <div style={statRowStyle}><span style={statLabelStyle}>Host</span><span style={statValueStyle}>{memoryData.honcho_data.host}</span></div>
                    )}
                    {memoryData.honcho_data?.workspace && (
                      <div style={statRowStyle}><span style={statLabelStyle}>Workspace</span><span style={statValueStyle}>{memoryData.honcho_data.workspace}</span></div>
                    )}
                    {memoryData.honcho_data?.recall_mode && (
                      <div style={statRowStyle}><span style={statLabelStyle}>Recall Mode</span><span style={statValueStyle}>{memoryData.honcho_data.recall_mode}</span></div>
                    )}
                  </>
                ) : memoryProvider !== 'built-in' ? (
                  <>
                    <div style={cardTitleStyle}>{memoryProvider} Memory</div>
                    <div style={statRowStyle}><span style={statLabelStyle}>Provider</span><span style={statValueStyle}>{memoryProvider}</span></div>
                    <div style={statRowStyle}>
                      <span style={statLabelStyle}>Status</span>
                      <span style={statValueStyle}>{memoryData.connected ? '● Connected' : '○ Unknown'}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={cardTitleStyle}>External Provider</div>
                    <div style={statRowStyle}>
                      <span style={statLabelStyle}>Status</span>
                      <span style={statValueStyle}>Built-in only (MEMORY.md + USER.md)</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          SKILLS TAB
          ══════════════════════════════════════════════════════════════════ */}
      {!tabLoading && activeTab === 'skills' && (
        <div>
          {skillsLoading ? (
            <div style={{ padding: '20px', color: 'var(--fg-muted)', fontStyle: 'italic' }}>Loading skills...</div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ fontSize: '14px', color: 'var(--fg-muted)' }}>{skills.length} skill(s) installed</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button style={{ ...btnGhostStyle, ...btnSmStyle }} onClick={handleCheckSkillUpdates}>
                    🔍 Check Updates
                  </button>
                  <button style={{ ...btnGhostStyle, ...btnSmStyle }} onClick={loadSkillsTab}>
                    ↻ Refresh
                  </button>
                </div>
              </div>

              {skills.length > 0 ? (
                <div style={cardGridStyle}>
                  {skills.map((s, i) => (
                    <div key={i} style={cardStyle}>
                      <div style={cardTitleStyle}>{s.name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--fg-muted)', marginTop: '4px' }}>{s.category || ''}</div>
                      <div style={{ marginTop: '8px', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={badgeStyle}>{s.source}</span>
                        {s.trust && <span style={{ ...badgeStyle, opacity: 0.7 }}>{s.trust}</span>}
                      </div>
                      <div style={{ marginTop: '10px', display: 'flex', gap: '6px' }}>
                        <button style={{ ...btnGhostStyle, ...btnSmStyle }} onClick={() => handleUpdateSkill(s.name)}>
                          🔄 Update
                        </button>
                        <button style={btnDangerStyle} onClick={() => handleUninstallSkill(s.name)}>
                          🗑️ Uninstall
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ ...cardStyle, alignItems: 'center', padding: '40px', color: 'var(--fg-muted)' }}>
                  No skills installed
                </div>
              )}

              {/* Raw Output */}
              <details style={{ marginTop: '16px' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--fg-muted)', fontSize: '12px', padding: '8px 0' }}>
                  Raw Output
                </summary>
                <pre style={{
                  background: 'var(--bg-inset)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '12px',
                  fontSize: '10px',
                  lineHeight: 1.4,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: '300px',
                  overflowY: 'auto',
                  color: 'var(--fg-muted)',
                }}>
                  {skillsOutput}
                </pre>
              </details>
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          CRON TAB
          ══════════════════════════════════════════════════════════════════ */}
      {!tabLoading && activeTab === 'cron' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{
                ...badgeStyle,
                background: cronData?.schedulerRunning ? 'var(--accent-dim)' : 'transparent',
                color: cronData?.schedulerRunning ? 'var(--accent)' : 'var(--fg-muted)',
              }}>
                {cronData?.schedulerRunning ? '● running' : '○ stopped'}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--fg-muted)' }}>Scheduler</span>
            </div>
            <button style={{ ...btnPrimaryStyle, ...btnSmStyle }} onClick={() => setShowCreateCron(true)}>
              + Create Job
            </button>
          </div>

          {cronLoading ? (
            <div style={{ padding: '20px', color: 'var(--fg-muted)', fontStyle: 'italic' }}>Loading cron jobs...</div>
          ) : !cronData?.ok ? (
            <div style={{ ...cardStyle, padding: '16px', color: 'var(--red)' }}>{cronData?.error || 'Failed to load cron'}</div>
          ) : (cronData.jobs || []).length === 0 ? (
            <div style={{ ...cardStyle, alignItems: 'center', padding: '40px', color: 'var(--fg-muted)' }}>No cron jobs</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--fg-muted)', fontWeight: 500, fontSize: '11px' }}>Name</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--fg-muted)', fontWeight: 500, fontSize: '11px' }}>Schedule</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--fg-muted)', fontWeight: 500, fontSize: '11px' }}>Status</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--fg-muted)', fontWeight: 500, fontSize: '11px' }}>Next Run</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--fg-muted)', fontWeight: 500, fontSize: '11px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(cronData.jobs || []).map(j => {
                    const sc = j.status === 'active';
                    return (
                      <tr key={j.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 12px', color: 'var(--fg)' }}>{j.name || j.id}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <code style={{ fontSize: '11px', color: 'var(--fg-muted)' }}>{j.schedule}</code>
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <span style={{
                            ...badgeStyle,
                            background: sc ? 'var(--accent-dim)' : 'transparent',
                            color: sc ? 'var(--accent)' : 'var(--fg-muted)',
                          }}>
                            {j.status}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', fontSize: '11px', color: 'var(--fg-muted)' }}>
                          {j.nextRun ? new Date(j.nextRun).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            {sc ? (
                              <>
                                <button style={{ ...btnGhostStyle, ...btnSmStyle }} onClick={() => cronAction(j.id, 'pause')} title="Pause">⏸</button>
                                <button style={{ ...btnGhostStyle, ...btnSmStyle }} onClick={() => cronAction(j.id, 'run')} title="Run">▶</button>
                              </>
                            ) : (
                              <button style={{ ...btnGhostStyle, ...btnSmStyle }} onClick={() => cronAction(j.id, 'resume')} title="Resume">⏵</button>
                            )}
                            <button style={{ ...btnGhostStyle, ...btnSmStyle }} onClick={() => { setEditCronJob(j); setShowEditCron(true); }} title="Edit">✎</button>
                            <button style={btnDangerStyle} onClick={() => cronRemove(j.id, j.name || j.id)} title="Remove">×</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          MODALS
          ══════════════════════════════════════════════════════════════════ */}

      {/* Confirm Dialog */}
      {confirmDialog && (
        <div style={modalOverlayStyle} onClick={handleConfirmNo}>
          <div style={{ ...modalCardStyle, width: '380px' }}>
            <div style={modalTitleStyle}>{confirmDialog.title}</div>
            <div style={{ fontSize: '13px', color: 'var(--fg-muted)', marginBottom: '16px', whiteSpace: 'pre-wrap' }}>
              {confirmDialog.message}
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button style={btnGhostStyle} onClick={handleConfirmNo}>Cancel</button>
              <button style={btnPrimaryStyle} onClick={handleConfirmYes}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          ...toastBase,
          background: toast.type === 'success' ? 'var(--green)' : toast.type === 'error' ? 'var(--red)' : 'var(--accent)',
          color: '#fff',
        }}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
