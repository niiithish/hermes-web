/**
 * Shared TypeScript types for the HCI backend.
 */
import type { Request, Response, NextFunction } from 'express';

// ── Auth ──

export interface HciUser {
  username: string;
  role: 'admin' | 'viewer' | 'custom';
  permissions?: Record<string, boolean>;
}

export interface HciRequest extends Request {
  hciUser?: HciUser;
}

export type HciMiddleware = (req: HciRequest, res: Response, next: NextFunction) => void;

// ── Config ──

export interface HciConfig {
  password: string | null;
  secret: string | null;
  port: number;
  hermesHome: string;
  projectsRoot: string;
  roots: ExplorerRoot[];
  corsOrigins: string | null;
  ssl: { certFile: string | null; keyFile: string | null };
  gatewayApiKey: string | null;
  rateLimit: { windowMs: number; maxRequests: number };
  session: {
    cookieName: string;
    cookieMaxAge: number;
    secure: boolean | null;
  };
  _yaml: Record<string, any>;
  _yamlPath: string;
}

export interface ExplorerRoot {
  key: string;
  label: string;
  root: string;
}

// ── Sessions ──

export interface SessionData {
  id: string;
  title: string;
  preview: string;
  lastActive: string;
  messageCount?: number;
  parentSessionId?: string | null;
  source?: string | null;
  startedAt?: number;
  endedAt?: number | null;
}

// ── Gateway ──

export interface GatewayPorts {
  [profile: string]: number;
}

// ── Profiles ──

export interface Profile {
  name: string;
  model: string;
  gateway: string;
  alias: string | null;
  active: boolean;
}

// ── System ──

export interface SystemInfo {
  host: string;
  platform: string;
  cpuCores: number;
  uptime: number;
  load: number[];
  memory: { total: number; used: number; percent: number };
  disk: { total: number; used: number; free: number; percent: number } | null;
}

// ── Insights ──

export interface InsightsData {
  sessions: number;
  messages: number;
  toolCalls: number;
  userMessages: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  modelBreakdown: { model: string; sessions: number; tokens: number }[];
  period: string;
  raw?: string;
}

// ── Terminal ──

export interface TerminalSession {
  proc: any | null;
  startedAt: number | null;
  buffer: string;
  prompt: string;
  cwd: string;
  ready: boolean;
  lastError: string | null;
  cols: number;
  rows: number;
  _spawnFailed?: boolean;
}

// ── Sprite ──

export interface SpriteState {
  state: string;
  label: string;
  details: string;
  since: number;
  frame: number;
}

// ── Cron ──

export interface CronJob {
  id: string;
  name: string;
  status: string;
  schedule: string;
  repeat: string | null;
  nextRun: string | null;
  lastRun: string | null;
  deliver: string;
  source?: string;
}

// ── Events ──

export interface HciEvent {
  id: string;
  ts: string;
  kind: string;
  message: string;
  [key: string]: any;
}

// ── Log Stream ──

export interface LogStream {
  proc: any | null;
  type: string | null;
  level: string | null;
  clients: Set<any>;
}

// ── Cache ──

export interface TimedCache<T> {
  at: number;
  data: T;
  key?: string;
}

// ── Quick Actions ──

export interface QuickAction {
  cmd: string;
  desc: string;
}
