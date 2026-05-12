/**
 * Terminal routes — PTY session management.
 */
import { Router } from 'express';
import { requireAuth, requireCsrf, requirePerm } from '../middleware/auth';
import { terminalRateLimiter } from '../middleware/rate-limit';
import { ensureTerminalSession, sendTerminalInput, appendTerminalOutput } from '../services/terminal';
import { terminalSession, PROJECT_ROOT, HCI_IDENTITY, log } from '../state';

const router = Router();

router.post('/terminal/ensure', requireAuth, (req, res) => {
  try {
    const session = ensureTerminalSession();
    res.json({ ok: true, ready: session.ready, cwd: session.cwd });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

router.post('/terminal/exec', terminalRateLimiter, requireAuth, requireCsrf, requirePerm('terminal.exec'), async (req: any, res) => {
  const command = String(req.body?.command || '').trim();
  if (!command) return res.status(400).json({ error: 'command required' });
  if (command.length > 4096) return res.status(400).json({ error: 'command too long (max 4096 chars)' });
  log('terminal.input', command.slice(0, 120));
  try {
    const result = sendTerminalInput(command);
    return res.json({ ...result, command, cwd: PROJECT_ROOT, identity: HCI_IDENTITY, ready: terminalSession.ready, buffer: terminalSession.buffer, timestamp: new Date().toISOString() });
  } catch (error: any) { return res.status(500).json({ error: error.message || 'terminal write failed' }); }
});

export default router;
