/**
 * Session routes — sidebar sessions, all sessions, dashboard state.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { getSessions, getAllSessions } from '../services/sessions';
import { buildDashboardState } from '../services/dashboard';
import { hermesSidebarSessionsCache, hermesAllSessionsCache } from '../state';

const router = Router();

function sanitizeProfileName(name: any): string | null {
  const s = String(name || '').trim();
  return /^[a-zA-Z0-9_-]+$/.test(s) ? s : null;
}

router.get('/sessions', requireAuth, async (req, res) => {
  const data = await getSessions();
  res.json({ ok: true, sessions: data, cachedAt: hermesSidebarSessionsCache.at });
});

router.get('/all-sessions', requireAuth, async (req, res) => {
  const profile = sanitizeProfileName(req.query.profile) || undefined;
  const data = await getAllSessions(profile);
  res.json({ ok: true, sessions: data, cachedAt: hermesAllSessionsCache.at });
});

router.get('/dashboard-state', requireAuth, async (req, res) => {
  res.json(await buildDashboardState(true));
});

export default router;
