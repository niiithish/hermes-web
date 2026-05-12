/**
 * Session routes — sidebar sessions, all sessions, dashboard state.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { getSessions, getAllSessions, getStateDbPath } from '../services/sessions';
import { buildDashboardState } from '../services/dashboard';
import { hermesSidebarSessionsCache, hermesAllSessionsCache } from '../state';
import fs from 'fs';
import path from 'path';
import os from 'os';

const Database = require('../../lib/database');
const router = Router();

function sanitizeSessionId(id: any): string | null {
  const s = String(id || '').trim();
  if (!/^[a-zA-Z0-9_.@-]+$/.test(s)) return null;
  return s;
}

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

// GET /sessions/:id/messages — load messages for a session
router.get('/sessions/:id/messages', requireAuth, async (req: any, res) => {
  try {
    const sessionId = sanitizeSessionId(req.params.id);
    if (!sessionId) return res.status(400).json({ ok: false, error: 'invalid session id' });

    const profile = sanitizeProfileName(req.query.profile);
    const stateDbPath = getStateDbPath(profile || undefined);

    if (!fs.existsSync(stateDbPath)) {
      return res.json({ ok: false, error: `state.db not found for profile: ${profile || 'default'}` });
    }

    const db = new Database(stateDbPath, { readonly: true });
    try {
      // Get session metadata
      const session = db.prepare(`
        SELECT id, source, model, title, started_at, ended_at,
               message_count, tool_call_count, input_tokens, output_tokens,
               estimated_cost_usd
        FROM sessions WHERE id = ?
      `).get(sessionId);

      if (!session) {
        return res.json({ ok: false, error: 'Session not found' });
      }

      // Get messages
      const messages = db.prepare(`
        SELECT id, role, content, tool_calls, tool_name, timestamp,
               reasoning, finish_reason
        FROM messages
        WHERE session_id = ?
        ORDER BY timestamp ASC
      `).all(sessionId);

      // Parse tool_calls JSON strings
      const parsed = messages.map((m: any) => ({
        ...m,
        tool_calls: m.tool_calls ? JSON.parse(m.tool_calls) : null,
      }));

      res.json({ ok: true, session, messages: parsed });
    } finally {
      db.close();
    }
  } catch (e: any) {
    res.json({ ok: false, error: e.message });
  }
});

export default router;
