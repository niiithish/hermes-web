// Shared types for the HCI dashboard

export interface User {
  username: string;
  role: 'admin' | 'viewer' | 'custom';
  permissions?: Record<string, boolean>;
}

export interface Session {
  id: string;
  title?: string;
  parent_session_id?: string;
  started_at: number;
  ended_at?: number;
  message_count: number;
  source?: string;
  model?: string;
  preview?: string;
  last_activity?: number;
}

export interface SystemInfo {
  host: string;
  platform: string;
  cpuCores: number;
  uptime: number;
  load: number[];
  memory: { total: number; used: number; percent: number };
  disk: { total: number; used: number; free: number; percent: number } | null;
}

export interface UsageInsights {
  sessions: number;
  messages: number;
  toolCalls: number;
  userMessages: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  modelBreakdown: { model: string; tokens: number }[];
  period: string;
}

export interface CronJob {
  id: string;
  name: string;
  status: string;
  schedule: string;
  nextRun?: string;
  lastRun?: string;
}

export interface Profile {
  name: string;
  active?: boolean;
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  icon: string;
  pages: string[];
  status: string;
  premium?: boolean;
  price?: number | null;
}

export interface ExplorerNode {
  name: string;
  path: string;
  rel: string;
  type: 'dir' | 'file';
  depth: number;
  children: ExplorerNode[];
}

export interface Notification {
  id: string;
  type: 'error' | 'warning' | 'info' | 'success';
  message: string;
  timestamp: string;
  dismissed: boolean;
}

export interface TokenUsage {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  sessions: number;
  messages: number;
  toolCalls: number;
  period: string;
  modelBreakdown: { model: string; tokens: number }[];
}

export interface DashboardState {
  title: string;
  now: string;
  authed: boolean;
  agent: { state: string; label: string; details: string; frame: number };
  system: SystemInfo;
  sessionCount: number;
  sessions: Session[];
  allSessions: Session[];
  cronJobs: CronJob[];
  profiles: Profile[];
  explorerRoots: { key: string; label: string; root: string; children: ExplorerNode[] }[];
  tokens: TokenUsage;
  usage: {
    generatedAt: string;
    sessionCount: number;
    messageCount: number;
    toolCalls: number;
    totalTokens: number;
    period: string;
    modelBreakdown: { model: string; tokens: number }[];
    recentKinds: Record<string, number>;
  };
  skills: string[];
  models: { label: string; value: string }[];
  configSummary: { defaultModel: string; provider: string; fallbackProvider: string; fallbackModel: string };
  knowledge: string;
  logs: { id: string; ts: string; kind: string; message: string }[];
  loginIdentity: string;
  workingDir: string;
  avatar: { url: string; custom: boolean; hash: string };
  terminal: { ready: boolean; buffer: string; prompt: string; cwd: string; lastError: string | null };
}

export interface WSMessage {
  type: string;
  [key: string]: unknown;
}
