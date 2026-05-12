/**
 * Profile routes — list, switch, create, delete profiles.
 */
import { Router } from 'express';
import { requireAuth, requireCsrf, requireRole } from '../middleware/auth';
import { shell, execHermes } from '../services/shell';
import { getProfiles, invalidateProfilesCache } from '../services/sessions';
import { HERMES_HOME, GATEWAY_API_KEY } from '../state';
import { discoverGatewayPorts, resolveCorsOrigins } from '../services/gateway-discovery';
import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';

const authModule = require('../../auth');
const router = Router();

function sanitizeProfileName(name: any): string | null {
  const s = String(name || '').trim();
  return /^[a-zA-Z0-9_-]+$/.test(s) ? s : null;
}

router.get('/profiles', requireAuth, async (req, res) => {
  const profiles = await getProfiles();
  res.json({ ok: true, profiles });
});

router.post('/profiles/use', requireRole('admin'), requireCsrf, async (req: any, res) => {
  const name = sanitizeProfileName(req.body?.profile);
  if (!name) return res.status(400).json({ error: 'invalid profile name' });
  try {
    const result = await execHermes(['profile', 'use', name], 10000);
    invalidateProfilesCache();
    res.json({ ok: true, profile: name, output: result.trim() });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/profiles/create', requireRole('admin'), requireCsrf, async (req: any, res) => {
  try {
    const safeName = sanitizeProfileName(req.body?.name);
    if (!safeName) return res.status(400).json({ ok: false, error: 'invalid profile name' });
    const cloneArg = req.body?.cloneArg;
    const cloneSource = sanitizeProfileName(req.body?.cloneSource);
    let cmd = `hermes profile create ${safeName}`;
    if (cloneArg === '--clone') cmd += ' --clone';
    else if (cloneArg === '--clone-from' && cloneSource) cmd += ` --clone-from ${cloneSource}`;
    const output = await shell(`${cmd} 2>&1`);
    authModule.audit(req.hciUser?.username || 'unknown', req.hciUser?.role || 'unknown', 'PROFILE_CREATE', safeName);
    authModule.addNotification('success', `Profile created: ${safeName}`);
    invalidateProfilesCache();
    res.json({ ok: true, output: output.trim() });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

router.delete('/profiles/:name', requireRole('admin'), requireCsrf, async (req: any, res) => {
  const safeName = sanitizeProfileName(req.params.name);
  if (!safeName) return res.status(400).json({ ok: false, error: 'invalid profile name' });
  try {
    const output = await execHermes(['profile', 'delete', safeName, '--force'], 10000);
    authModule.audit(req.hciUser?.username || 'unknown', req.hciUser?.role || 'unknown', 'PROFILE_DELETE', safeName);
    authModule.addNotification('info', `Profile deleted: ${safeName}`);
    invalidateProfilesCache();
    res.json({ ok: true, output: output.trim() });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

export default router;
