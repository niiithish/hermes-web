/**
 * Gateway management routes — health, start, stop, setup.
 */
import { Router } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { requireAuth, requireCsrf, requireRole } from '../middleware/auth';
import { shell } from '../services/shell';
import { probeGatewayHealth, getGatewayBase, discoverGatewayPorts, resolveCorsOrigins } from '../services/gateway-discovery';
import { gatewayPorts, setGatewayPorts, GATEWAY_API_KEY, HERMES_HOME, IS_ROOT, log } from '../state';

const authModule = require('../../auth');
const router = Router();

function sanitizeProfileName(name: any): string | null {
  const s = String(name || '').trim();
  return /^[a-zA-Z0-9_-]+$/.test(s) ? s : null;
}

// Gateway status
router.get('/gateway/status/:profile', requireAuth, async (req: any, res) => {
  try {
    const profile = sanitizeProfileName(req.params.profile) || 'default';
    const health = await probeGatewayHealth(profile);
    const port = gatewayPorts[profile] || gatewayPorts['default'];
    res.json({ ok: true, profile, running: health.ok, managedBy: health.managedBy, port, apiKey: !!GATEWAY_API_KEY });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

// Gateway start
router.post('/gateway/start/:profile', requireRole('admin'), requireCsrf, async (req: any, res) => {
  try {
    const profile = sanitizeProfileName(req.params.profile) || 'default';
    const SYSTEMD_USER_FLAG = IS_ROOT ? '' : '--user ';
    const svc = `hermes-gateway${profile !== 'default' ? `-${profile}` : ''}`;
    const output = await shell(`systemctl ${SYSTEMD_USER_FLAG}start ${svc} 2>&1`, '10s');
    setGatewayPorts(discoverGatewayPorts());
    authModule.audit(req.hciUser?.username || 'unknown', req.hciUser?.role || 'unknown', 'GATEWAY_START', profile);
    res.json({ ok: true, output: output.trim() });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

// Gateway stop
router.post('/gateway/stop/:profile', requireRole('admin'), requireCsrf, async (req: any, res) => {
  try {
    const profile = sanitizeProfileName(req.params.profile) || 'default';
    const SYSTEMD_USER_FLAG = IS_ROOT ? '' : '--user ';
    const svc = `hermes-gateway${profile !== 'default' ? `-${profile}` : ''}`;
    const output = await shell(`systemctl ${SYSTEMD_USER_FLAG}stop ${svc} 2>&1`, '10s');
    authModule.audit(req.hciUser?.username || 'unknown', req.hciUser?.role || 'unknown', 'GATEWAY_STOP', profile);
    res.json({ ok: true, output: output.trim() });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

// Gateway restart
router.post('/gateway/restart/:profile', requireRole('admin'), requireCsrf, async (req: any, res) => {
  try {
    const profile = sanitizeProfileName(req.params.profile) || 'default';
    const SYSTEMD_USER_FLAG = IS_ROOT ? '' : '--user ';
    const svc = `hermes-gateway${profile !== 'default' ? `-${profile}` : ''}`;
    const output = await shell(`systemctl ${SYSTEMD_USER_FLAG}restart ${svc} 2>&1`, '10s');
    setGatewayPorts(discoverGatewayPorts());
    authModule.audit(req.hciUser?.username || 'unknown', req.hciUser?.role || 'unknown', 'GATEWAY_RESTART', profile);
    res.json({ ok: true, output: output.trim() });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

// Gateway logs
router.get('/gateway/logs/:profile', requireAuth, async (req: any, res) => {
  try {
    const profile = sanitizeProfileName(req.params.profile) || 'default';
    const lines = parseInt(req.query.lines || '100');
    const SYSTEMD_USER_FLAG = IS_ROOT ? '' : '--user ';
    const svc = `hermes-gateway${profile !== 'default' ? `-${profile}` : ''}`;
    const output = await shell(`journalctl ${SYSTEMD_USER_FLAG}-u ${svc} --no-pager -n ${lines} 2>&1`, '10s');
    res.json({ ok: true, output: output.trim() });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

export default router;
