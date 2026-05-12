/**
 * Gateway API port discovery and health probing.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { shell } from './shell';
import { gatewayPorts, setGatewayPorts, HERMES_HOME, GATEWAY_API_KEY, IS_ROOT } from '../state';
import type { GatewayPorts } from '../types';

/**
 * Scan hermes config.yaml files for gateway API ports.
 */
export function discoverGatewayPorts(): GatewayPorts {
  const ports: GatewayPorts = {};
  const baseHermesHome = path.join(os.homedir(), '.hermes');

  try {
    const defaultConf = fs.readFileSync(path.join(baseHermesHome, 'config.yaml'), 'utf8');
    const defaultCfg: any = yaml.load(defaultConf);
    const ds = defaultCfg?.platforms?.api_server || defaultCfg?.api_server;
    if (ds?.enabled && ds?.extra?.port) {
      ports['default'] = ds.extra.port;
    }
  } catch (_) { /* no default config */ }

  const profilesDir = path.join(baseHermesHome, 'profiles');
  try {
    for (const name of fs.readdirSync(profilesDir)) {
      try {
        const confPath = path.join(profilesDir, name, 'config.yaml');
        const raw = fs.readFileSync(confPath, 'utf8');
        const cfg: any = yaml.load(raw);
        const apiSrv = cfg?.platforms?.api_server || cfg?.api_server;
        if (apiSrv?.enabled && apiSrv?.extra?.port) {
          ports[name] = apiSrv.extra.port;
        }
      } catch (_) { /* skip broken config */ }
    }
  } catch (_) { /* no profiles dir */ }

  return ports;
}

/**
 * Initialize gateway ports and start watching for config changes.
 */
export function initGatewayDiscovery(): void {
  setGatewayPorts(discoverGatewayPorts());
  console.log('[Gateway] Discovered ports:', gatewayPorts);

  try {
    fs.watch(path.join(HERMES_HOME, 'profiles'), { recursive: true }, (event, filename) => {
      if (filename?.endsWith('config.yaml')) {
        setGatewayPorts(discoverGatewayPorts());
        console.log('[Gateway] Ports refreshed:', gatewayPorts);
      }
    });
  } catch (_) { /* fs.watch not supported */ }
}

export function getGatewayBase(profile: string): string | null {
  const port = gatewayPorts[profile] || gatewayPorts['default'];
  if (!port) return null;
  return `http://127.0.0.1:${port}`;
}

/**
 * Probe gateway health endpoint directly (works without systemd).
 */
export async function probeGatewayHealth(profile: string): Promise<{ ok: boolean; managedBy: string; port?: number }> {
  const base = getGatewayBase(profile);
  if (base) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${base}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        const data: any = await res.json().catch(() => ({}));
        return { ok: data.status === 'ok' || res.status === 200, managedBy: 'api', port: gatewayPorts[profile] || gatewayPorts['default'] };
      }
    } catch {}
  }
  // Fallback: check systemctl
  try {
    const userFlag = IS_ROOT ? '' : '--user ';
    const svc = `hermes-gateway${profile !== 'default' ? `-${profile}` : ''}`;
    const check = await shell(`systemctl ${userFlag} is-active ${svc} 2>/dev/null || echo inactive`);
    if (check.trim() === 'active') return { ok: true, managedBy: 'systemd' };
  } catch {}
  return { ok: false, managedBy: base ? 'api' : 'unknown' };
}

/**
 * Read default model from profile config.yaml.
 */
export function getDefaultModel(profile: string): string {
  const baseHermesHome = path.join(os.homedir(), '.hermes');
  try {
    const configPath = profile === 'default'
      ? path.join(baseHermesHome, 'config.yaml')
      : path.join(baseHermesHome, 'profiles', profile, 'config.yaml');
    if (fs.existsSync(configPath)) {
      const cfg: any = yaml.load(fs.readFileSync(configPath, 'utf8'));
      return cfg?.model?.default || cfg?.model || 'moonshotai/kimi-k2.6';
    }
  } catch (_) { /* fallback */ }
  return 'moonshotai/kimi-k2.6';
}

/**
 * Resolve CORS origins for gateway config injection.
 */
export function resolveCorsOrigins(req?: any): string {
  const { cfg: config } = require('../state');
  if (config.corsOrigins) return config.corsOrigins;
  if (process.env.HCI_CORS_ORIGINS) return process.env.HCI_CORS_ORIGINS;
  const origin = req?.headers?.origin || req?.get?.('origin') || '';
  if (origin) return origin;
  return 'http://localhost:3000,http://localhost:5173,http://localhost:10272,http://127.0.0.1:3000,http://127.0.0.1:5173,http://127.0.0.1:10272';
}
