/**
 * Centralized mutable state for the HCI backend.
 * All shared singleton state lives here instead of scattered module-level `let` variables.
 */
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type {
  HciEvent, TerminalSession, SpriteState, LogStream,
  TimedCache, SessionData, QuickAction, GatewayPorts, HciConfig,
} from './types';

const { getConfig } = require('../lib/hci-config');

// ── Load HCI config ──
export const cfg: HciConfig = getConfig();

// ── Derived constants ──
export const PORT = cfg.port;
export const CONTROL_PASSWORD = cfg.password;
export const CONTROL_SECRET = cfg.secret || crypto.randomBytes(32).toString('hex');
export const AUTH_COOKIE = cfg.session.cookieName;
export const PROJECT_ROOT = path.resolve(__dirname, '..');
export const PROJECTS_ROOT = cfg.projectsRoot;
export const CONTROL_HOME = cfg.hermesHome;
export const CONTROL_STATE_DIR = path.join(CONTROL_HOME, 'control-interface');
export const AVATAR_OVERRIDE_PATH = path.join(CONTROL_STATE_DIR, 'avatar.dataurl');
export const STATE_DB_PATH = path.join(CONTROL_HOME, 'state.db');
export const ROOTS = cfg.roots;
export const HERMES_HOME = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');

// ── Identity ──
export const HCI_USER = os.userInfo().username;
export const HCI_HOST = os.hostname();
export const HCI_IDENTITY = `${HCI_USER}@${HCI_HOST}`;
export const IS_ROOT = process.getuid?.() === 0;
export const SYSTEMD_USER_FLAG = IS_ROOT ? '' : '--user';

// ── XDG_RUNTIME_DIR auto-detect ──
if (!IS_ROOT && !process.env.XDG_RUNTIME_DIR) {
  const uid = process.getuid?.();
  if (uid !== undefined) {
    const runtimeDir = `/run/user/${uid}`;
    const fs = require('fs');
    if (fs.existsSync(runtimeDir)) {
      process.env.XDG_RUNTIME_DIR = runtimeDir;
    }
  }
}

// ── In-memory event log ──
export const events: HciEvent[] = [];

// ── Session caches ──
export let hermesSidebarSessionsCache: TimedCache<SessionData[]> = { at: 0, data: [] };
export let hermesAllSessionsCache: TimedCache<SessionData[]> & { key?: string } = { at: 0, data: [] };

export function updateSidebarCache(cache: TimedCache<SessionData[]>): void {
  hermesSidebarSessionsCache = cache;
}

export function updateAllSessionsCache(cache: TimedCache<SessionData[]> & { key?: string }): void {
  hermesAllSessionsCache = cache;
}

// ── Cron jobs (in-memory) ──
export const cronJobs: any[] = [];

// ── Quick actions ──
export const quickActions: QuickAction[] = [
  { cmd: 'hermes status', desc: 'Show Hermes health and session status' },
  { cmd: 'hermes skills', desc: 'Inspect installed skills' },
  { cmd: 'hermes cron list', desc: 'List cron jobs' },
  { cmd: 'hermes model', desc: 'Inspect the active model' },
  { cmd: 'hermes config', desc: 'Show Hermes config' },
];

// ── Layout ──
export const layoutStorePath = path.join(CONTROL_HOME, 'control-interface-layout.json');

// ── Sprite ──
export const spriteState: SpriteState = {
  state: 'idle',
  label: 'ready',
  details: 'standing by',
  since: Date.now(),
  frame: 0,
};

// ── Terminal ──
export const terminalSession: TerminalSession = {
  proc: null,
  startedAt: null,
  buffer: '',
  prompt: `${HCI_IDENTITY}:${PROJECT_ROOT}# `,
  cwd: PROJECT_ROOT,
  ready: false,
  lastError: null,
  cols: 120,
  rows: 32,
};

// ── Avatar ──
export const AVATAR_IMAGE_PATH = path.join(CONTROL_STATE_DIR, 'default-avatar.jpg');
export const DEFAULT_AVATAR_FALLBACK = AVATAR_IMAGE_PATH;
export let avatarDataUrlCache: string | null = null;
export function setAvatarCache(value: string | null): void {
  avatarDataUrlCache = value;
}

// ── Log stream ──
export const logStream: LogStream = { proc: null, type: null, level: null, clients: new Set() };

// ── Auth token cache ──
export const tokenToUser = new Map<string, { username: string; role: string; permissions?: Record<string, boolean> }>();

// ── Gateway ports ──
export let gatewayPorts: GatewayPorts = {};
export function setGatewayPorts(ports: GatewayPorts): void {
  gatewayPorts = ports;
}

// ── Gateway API key ──
export const GATEWAY_API_KEY: string = cfg.gatewayApiKey || loadGatewayApiKey();

function loadGatewayApiKey(): string {
  try {
    const yamlLib = require('js-yaml');
    const fs = require('fs');
    const configPath = path.join(os.homedir(), '.hermes', 'config.yaml');
    if (fs.existsSync(configPath)) {
      const config = yamlLib.load(fs.readFileSync(configPath, 'utf8'));
      return config?.platforms?.api_server?.extra?.key || '';
    }
  } catch {}
  return '';
}

// ── Ignored directories for explorer ──
export const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'cache', 'document_cache', 'audio_cache',
  'checkpoints', 'logs', 'tmp', '.next', '.turbo', '.cache',
]);

// ── Health alert cooldown ──
export const healthAlertCooldown: Record<string, number> = {};

// ── Logging ──
export function log(kind: string, message: string, extra: Record<string, any> = {}): void {
  events.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    ts: new Date().toISOString(),
    kind,
    message,
    ...extra,
  });
  if (events.length > 100) events.splice(0, events.length - 100);
}
