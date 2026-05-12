/**
 * Kanban board routes — tasks, boards, stats (all require auth now).
 */
import { Router } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { requireAuth, requireCsrf } from '../middleware/auth';
import { execHermes } from '../services/shell';
import { stripAnsi } from '../services/shell';

const Database = require('../../lib/database');
const router = Router();

const KANBAN_HOME = path.join(os.homedir(), '.hermes', 'kanban');
const DEFAULT_KANBAN_DB = path.join(os.homedir(), '.hermes', 'kanban.db');
const PRIORITY_LABELS: Record<number, string> = { 0: 'none', 1: 'low', 2: 'medium', 3: 'high', 4: 'critical' };

function kanbanDbPath(slug: string): string {
  if (!slug || slug === 'default') return DEFAULT_KANBAN_DB;
  return path.join(KANBAN_HOME, 'boards', slug, 'kanban.db');
}

function openKanbanDb(slug: string, readonly = true): any {
  const dbPath = kanbanDbPath(slug || 'default');
  if (!fs.existsSync(dbPath)) return null;
  return new Database(dbPath, { readonly });
}

function priorityLabel(pri: any): string {
  if (pri === null || pri === undefined || pri === 0) return 'none';
  return PRIORITY_LABELS[pri] || String(pri);
}

// GET /kanban/board
router.get('/kanban/board', requireAuth, async (req: any, res) => {
  const board = (req.query.board as string) || 'default';
  try {
    const db = openKanbanDb(board);
    if (!db) return res.json({ ok: false, error: 'kanban database not found for board: ' + board });
    execHermes(['kanban', '--board', board, 'list'], 10000).catch(() => {});
    const rows = db.prepare("SELECT * FROM tasks WHERE status != 'archived' ORDER BY priority DESC, created_at ASC").all();
    const tasks = rows.map((r: any) => ({ ...r, priority_label: priorityLabel(r.priority), skills: r.skills ? JSON.parse(r.skills) : [] }));
    let boards: any[] = [];
    try { const o = await execHermes(['kanban', 'boards', 'list', '--json'], 10000); boards = JSON.parse(o); } catch {}
    db.close();
    const statusColumns = [
      { id: 'triage', label: 'Triage' }, { id: 'todo', label: 'Todo' },
      { id: 'ready', label: 'Ready' }, { id: 'running', label: 'Running' },
      { id: 'blocked', label: 'Blocked' }, { id: 'done', label: 'Done' },
    ];
    const columns = statusColumns.map(col => ({ id: col.id, label: col.label, tasks: [] as any[] }));
    const otherTasks: any[] = [];
    for (const t of tasks) {
      const col = columns.find(c => c.id === t.status);
      if (col) col.tasks.push(t); else otherTasks.push(t);
    }
    if (otherTasks.length > 0) columns.push({ id: 'other', label: 'Other', tasks: otherTasks });
    const activeBoard = boards?.find((b: any) => b.is_current) || null;
    res.json({ ok: true, columns, boards, activeBoard });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

// GET /kanban/tasks/:id
router.get('/kanban/tasks/:id', requireAuth, async (req: any, res) => {
  const board = (req.query.board as string) || 'default';
  try {
    const output = await execHermes(['kanban', '--board', board, 'show', req.params.id, '--json'], 15000);
    let data: any;
    try { data = JSON.parse(output); } catch { return res.json({ ok: false, error: 'Failed to parse task detail', raw: output }); }
    res.json({ ok: true, task: data.task, parents: data.parents || [], children: data.children || [], comments: data.comments || [], events: data.events || [], runs: data.runs || [], latest_summary: data.latest_summary || null });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

// POST /kanban/tasks
router.post('/kanban/tasks', requireAuth, requireCsrf, async (req: any, res) => {
  const { title, body, priority, assignee, board } = req.body || {};
  if (!title || typeof title !== 'string') return res.status(400).json({ ok: false, error: 'title required' });
  const args = ['kanban', '--board', board || 'default', 'create', title, '--json'];
  if (body) args.push('--body', String(body));
  if (priority !== undefined && priority !== null && priority !== 'none') {
    const priMap: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
    const pVal = priMap[String(priority)] ?? Number(priority);
    if (!isNaN(pVal)) args.push('--priority', String(pVal));
  }
  if (assignee) args.push('--assignee', String(assignee));
  try {
    const output = await execHermes(args, 15000);
    try { return res.json({ ok: true, task: JSON.parse(output) }); } catch { return res.json({ ok: false, error: stripAnsi(output).trim() || 'Unknown error' }); }
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// PATCH /kanban/tasks/:id
router.patch('/kanban/tasks/:id', requireAuth, requireCsrf, (req: any, res) => {
  const board = (req.query.board as string) || 'default';
  const db = openKanbanDb(board, false);
  if (!db) return res.status(404).json({ ok: false, error: 'kanban database not found for board: ' + board });
  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) { db.close(); return res.status(404).json({ ok: false, error: 'task not found' }); }
    const { title, body, status, priority, assignee } = req.body || {};
    const updates: string[] = []; const values: any[] = []; const now = Math.floor(Date.now() / 1000);
    if (title !== undefined) { updates.push('title = ?'); values.push(String(title)); }
    if (body !== undefined) { updates.push('body = ?'); values.push(body === null ? null : String(body)); }
    if (status !== undefined) {
      updates.push('status = ?'); values.push(String(status));
      if (status === 'running' && !task.started_at) { updates.push('started_at = ?'); values.push(now); }
      if (status === 'done' && !task.completed_at) { updates.push('completed_at = ?'); values.push(now); }
    }
    if (priority !== undefined) {
      const priMap: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
      const pVal = priMap[String(priority)] ?? Number(priority);
      updates.push('priority = ?'); values.push(isNaN(pVal) ? 0 : pVal);
    }
    if (assignee !== undefined) { updates.push('assignee = ?'); values.push(assignee === null || assignee === '' ? null : String(assignee)); }
    if (updates.length === 0) { db.close(); return res.json({ ok: true, task }); }
    values.push(req.params.id);
    db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    if (status !== undefined && status !== task.status) {
      db.prepare('INSERT INTO task_events (task_id, kind, payload, created_at) VALUES (?, ?, ?, ?)').run(req.params.id, 'status', JSON.stringify({ status }), now);
    }
    const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    db.close();
    res.json({ ok: true, task: updated, priority_label: priorityLabel(updated.priority) });
  } catch (e: any) { try { db.close(); } catch {} res.json({ ok: false, error: e.message }); }
});

// POST /kanban/tasks/:id/comments
router.post('/kanban/tasks/:id/comments', requireAuth, requireCsrf, async (req: any, res) => {
  const board = (req.query.board as string) || 'default';
  const { body } = req.body || {};
  if (!body) return res.status(400).json({ ok: false, error: 'comment body required' });
  try {
    const output = await execHermes(['kanban', '--board', board, 'comment', req.params.id, String(body)], 15000);
    if (output.includes('Comment added')) return res.json({ ok: true });
    res.json({ ok: false, error: stripAnsi(output).trim() || 'Failed to add comment' });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

// DELETE /kanban/tasks/:id
router.delete('/kanban/tasks/:id', requireAuth, requireCsrf, async (req: any, res) => {
  const board = (req.query.board as string) || 'default';
  try {
    const output = await execHermes(['kanban', '--board', board, 'archive', req.params.id], 15000);
    if (output.includes('Archived')) return res.json({ ok: true });
    res.json({ ok: false, error: stripAnsi(output).trim() || 'Failed to archive task' });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

// GET /kanban/boards
router.get('/kanban/boards', requireAuth, async (req, res) => {
  try {
    const output = await execHermes(['kanban', 'boards', 'list', '--json'], 10000);
    try { return res.json({ ok: true, boards: JSON.parse(output) }); } catch { return res.json({ ok: false, error: 'Failed to parse boards list', raw: output }); }
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

// POST /kanban/boards
router.post('/kanban/boards', requireAuth, requireCsrf, async (req: any, res) => {
  const { slug } = req.body || {};
  if (!slug) return res.status(400).json({ ok: false, error: 'slug required' });
  try {
    const output = await execHermes(['kanban', 'boards', 'create', slug], 10000);
    const cleaned = stripAnsi(output).trim();
    if (cleaned.includes('created') || cleaned.includes('already exists')) return res.json({ ok: true, slug, output: cleaned });
    res.json({ ok: false, error: cleaned || 'Failed to create board' });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST /kanban/boards/:slug/switch
router.post('/kanban/boards/:slug/switch', requireAuth, requireCsrf, async (req: any, res) => {
  try {
    const output = await execHermes(['kanban', 'boards', 'switch', req.params.slug], 10000);
    if (output.includes('Active board is now')) return res.json({ ok: true, activeBoard: req.params.slug });
    res.json({ ok: false, error: stripAnsi(output).trim() || 'Failed to switch board' });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

// GET /kanban/stats
router.get('/kanban/stats', requireAuth, async (req: any, res) => {
  const board = (req.query.board as string) || 'default';
  try {
    const output = await execHermes(['kanban', '--board', board, 'stats', '--json'], 10000);
    try { return res.json({ ok: true, stats: JSON.parse(output) }); } catch { return res.json({ ok: false, error: 'Failed to parse stats', raw: output }); }
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

export default router;
