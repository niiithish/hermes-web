/**
 * Cron routes — hermes cron management (per-profile).
 */
import { Router } from 'express';
import { requireAuth, requireCsrf, requirePerm } from '../middleware/auth';
import { shell, execHermes } from '../services/shell';

const authModule = require('../../auth');
const router = Router();

function sanitizeProfileName(name: any): string | null {
  const s = String(name || '').trim();
  return /^[a-zA-Z0-9_-]+$/.test(s) ? s : null;
}

function parseCronList(raw: string): any[] {
  const jobs: any[] = [];
  const blocks = raw.split(/\n\s*(?=[a-f0-9]{12}\s)/);
  for (const block of blocks) {
    const idMatch = block.match(/^([a-f0-9]{12})\s+\[(\w+)\]/);
    if (!idMatch) continue;
    const nameMatch = block.match(/Name:\s+(.+)/);
    const scheduleMatch = block.match(/Schedule:\s+(.+)/);
    const repeatMatch = block.match(/Repeat:\s+(.+)/);
    const nextMatch = block.match(/Next run:\s+(.+)/);
    const deliverMatch = block.match(/Deliver:\s+(.+)/);
    jobs.push({ id: idMatch[1], status: idMatch[2], name: nameMatch?.[1]?.trim() || '', schedule: scheduleMatch?.[1]?.trim() || '', repeat: repeatMatch?.[1]?.trim() || '', nextRun: nextMatch?.[1]?.trim() || '', deliver: deliverMatch?.[1]?.trim() || 'local' });
  }
  return jobs;
}

// List jobs
router.get('/hermes-cron/:profile', requireAuth, async (req: any, res) => {
  try {
    const profile = sanitizeProfileName(req.params.profile);
    if (!profile) return res.status(400).json({ ok: false, error: 'invalid profile name' });
    const [listRaw, statusRaw] = await Promise.all([
      shell(`hermes -p ${profile} cron list --all 2>&1`, '10s'),
      shell(`hermes -p ${profile} cron status 2>&1`, '10s'),
    ]);
    const jobs = parseCronList(listRaw);
    const schedulerRunning = statusRaw.includes('running') || statusRaw.includes('active');
    res.json({ ok: true, jobs, schedulerRunning, profile });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

// Create job
router.post('/hermes-cron/:profile/create', requireCsrf, async (req: any, res) => {
  try {
    const profile = sanitizeProfileName(req.params.profile);
    if (!profile) return res.status(400).json({ ok: false, error: 'invalid profile name' });
    const { schedule, prompt, name, deliver, repeat } = req.body || {};
    if (!schedule) return res.status(400).json({ ok: false, error: 'schedule required' });
    if (prompt && (typeof prompt !== 'string' || prompt.length > 10000)) return res.status(400).json({ ok: false, error: 'invalid prompt (max 10000 chars)' });
    if (name && (typeof name !== 'string' || name.length > 128 || !/^[\w\s.\-:]+$/.test(name))) return res.status(400).json({ ok: false, error: 'invalid name' });
    const args = ['-p', profile, 'cron', 'create'];
    if (name) args.push('--name', name);
    if (deliver) args.push('--deliver', deliver);
    if (repeat && repeat !== 'forever') args.push('--repeat', String(repeat));
    args.push(schedule);
    if (prompt) args.push(prompt);
    const output = await execHermes(args, 15000);
    const idMatch = output.match(/Created job:\s+([a-f0-9]+)/);
    authModule.addNotification('success', `Cron job created: ${name || idMatch?.[1] || schedule}`);
    res.json({ ok: true, output, jobId: idMatch?.[1] });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

// Pause/Resume/Run/Remove job
router.post('/hermes-cron/:profile/:jobId/:action', requireCsrf, async (req: any, res) => {
  try {
    const profile = sanitizeProfileName(req.params.profile);
    const jobId = req.params.jobId;
    const action = req.params.action;
    if (!profile) return res.status(400).json({ ok: false, error: 'invalid profile name' });
    if (!/^[a-f0-9]+$/.test(jobId)) return res.status(400).json({ ok: false, error: 'invalid job id' });
    if (!['pause', 'resume', 'run', 'remove'].includes(action)) return res.status(400).json({ ok: false, error: 'invalid action' });
    const output = await execHermes(['-p', profile, 'cron', action, jobId], 10000);
    authModule.addNotification('info', `Cron ${action}: ${jobId.slice(0, 8)}…`);
    res.json({ ok: true, output });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

// Edit job
router.put('/hermes-cron/:profile/:jobId', requireCsrf, async (req: any, res) => {
  try {
    const profile = sanitizeProfileName(req.params.profile);
    const jobId = req.params.jobId;
    if (!profile) return res.status(400).json({ ok: false, error: 'invalid profile name' });
    if (!/^[a-f0-9]+$/.test(jobId)) return res.status(400).json({ ok: false, error: 'invalid job id' });
    const { schedule, prompt, name, deliver, repeat } = req.body || {};
    const args = ['-p', profile, 'cron', 'edit', jobId];
    if (schedule) args.push('--schedule', schedule);
    if (prompt !== undefined) args.push('--prompt', prompt);
    if (name !== undefined) args.push('--name', name);
    if (deliver !== undefined) args.push('--deliver', deliver);
    if (repeat !== undefined) args.push('--repeat', String(repeat));
    const output = await execHermes(args, 10000);
    res.json({ ok: true, output });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

export default router;
