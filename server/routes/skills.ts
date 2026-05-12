/**
 * Skills routes — browse, search, inspect, install, uninstall, update.
 */
import { Router } from 'express';
import { requireAuth, requireCsrf, requireRole } from '../middleware/auth';
import { execHermes, stripAnsi } from '../services/shell';

const router = Router();

function sanitizeProfileName(name: any): string | null {
  const s = String(name || '').trim();
  return /^[a-zA-Z0-9_-]+$/.test(s) ? s : null;
}

router.get('/skills/browse/:page', requireAuth, async (req: any, res) => {
  try {
    const page = Math.max(1, parseInt(req.params.page) || 1);
    const raw = await execHermes(['skills', 'browse', '--page', String(page)], 15000);
    res.json({ ok: true, output: stripAnsi(raw), page });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

router.get('/skills/search/:query', requireAuth, async (req: any, res) => {
  try {
    const query = decodeURIComponent(req.params.query);
    const raw = await execHermes(['skills', 'search', query], 15000);
    const output = stripAnsi(raw);
    const lines = output.split('\n');
    const results: any[] = [];
    for (const line of lines) {
      const cells = line.split('│').map((c: string) => c.trim()).filter(Boolean);
      if (cells.length >= 4 && !cells[0].match(/^[━┏┗┓┛┠┨┯┷┼─]+$/) && cells[0] !== 'Name') {
        results.push({ name: cells[0], description: cells[1] || '', source: cells[2] || '', trust: cells[3] || '', identifier: cells[4] || cells[0] });
      }
    }
    const seen = new Set<string>();
    const unique = results.filter(r => { if (seen.has(r.name)) return false; seen.add(r.name); return true; });
    res.json({ ok: true, output, results: unique });
  } catch (e: any) { res.json({ ok: false, error: e.message, results: [] }); }
});

router.get('/skills/inspect/:name', requireAuth, async (req: any, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const raw = await execHermes(['skills', 'inspect', name], 15000);
    res.json({ ok: true, output: stripAnsi(raw) });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

router.get('/skills/list/:profile', requireAuth, async (req: any, res) => {
  try {
    const profile = sanitizeProfileName(req.params.profile);
    if (!profile) return res.status(400).json({ ok: false, error: 'invalid profile name' });
    const profArg = profile === 'default' ? [] : ['-p', profile];
    const raw = await execHermes([...profArg, 'skills', 'list'], 15000);
    res.json({ ok: true, output: stripAnsi(raw) });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

router.post('/skills/install', requireRole('admin'), requireCsrf, async (req: any, res) => {
  try {
    const { skill, profile } = req.body || {};
    if (!skill) return res.status(400).json({ ok: false, error: 'skill name required' });
    if (!/^[\w.\-]+$/.test(skill)) return res.status(400).json({ ok: false, error: 'invalid skill name' });
    const profArg = profile ? ['-p', sanitizeProfileName(profile) as string] : [];
    const output = await execHermes([...profArg, 'skills', 'install', skill, '--yes'], 30000);
    const success = !output.includes('error') && !output.includes('Error');
    res.json({ ok: success, output });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

router.post('/skills/uninstall', requireRole('admin'), requireCsrf, async (req: any, res) => {
  try {
    const { skill, profile } = req.body || {};
    if (!skill) return res.status(400).json({ ok: false, error: 'skill name required' });
    if (!/^[\w.\-]+$/.test(skill)) return res.status(400).json({ ok: false, error: 'invalid skill name' });
    const profArg = profile ? ['-p', sanitizeProfileName(profile) as string] : [];
    const output = await execHermes([...profArg, 'skills', 'uninstall', skill], 15000, 'y\n');
    res.json({ ok: true, output });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

router.post('/skills/update', requireRole('admin'), requireCsrf, async (req: any, res) => {
  try {
    const { skill, profile } = req.body || {};
    if (skill && !/^[\w.\-]+$/.test(skill)) return res.status(400).json({ ok: false, error: 'invalid skill name' });
    const profArg = profile ? ['-p', sanitizeProfileName(profile) as string] : [];
    const args = [...profArg, 'skills', 'update', ...(skill ? [skill] : [])];
    const output = await execHermes(args, 30000);
    res.json({ ok: true, output });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

router.post('/skills/check', requireAuth, requireCsrf, async (req: any, res) => {
  try {
    const { profile } = req.body || {};
    const profArg = profile ? ['-p', sanitizeProfileName(profile) as string] : [];
    const output = await execHermes([...profArg, 'skills', 'check'], 30000);
    const lines = output.split('\n');
    const updates: any[] = [];
    for (const line of lines) {
      const cells = line.split(/[┃┡━╇┓┛┠┨┯┷┼─]+/).map((c: string) => c.trim()).filter(Boolean);
      if (cells.length >= 3 && cells[0] !== 'Name' && !cells[0].match(/^[━┏┗┓┛]+$/)) updates.push({ name: cells[0], source: cells[1], status: cells[2] });
    }
    const hasUpdates = updates.some(u => /update|outdated|newer/i.test(u.status));
    res.json({ ok: true, output, updates, hasUpdates });
  } catch (e: any) { res.json({ ok: false, error: e.message, updates: [] }); }
});

export default router;
