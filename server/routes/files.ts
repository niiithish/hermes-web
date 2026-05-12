/**
 * File explorer routes — listing, reading, writing files.
 */
import { Router } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { requireAuth, requireCsrf } from '../middleware/auth';
import { ROOTS, log, cfg, IGNORED_DIRS } from '../state';

const router = Router();

function isAllowedPath(requested: string): boolean {
  const resolved = path.resolve(requested);
  return ROOTS.some(r => resolved.startsWith(r.root));
}

function readFileSafe(requested: string): string {
  const HERMES = process.env.HERMES_HOME || cfg.hermesHome || path.join(os.homedir(), '.hermes');
  const resolved = path.resolve(HERMES, requested.replace(/^\/+/, ''));
  if (!fs.existsSync(resolved)) throw new Error('file not found');
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) throw new Error('EISDIR: path is a directory');
  if (stat.size > 2 * 1024 * 1024) throw new Error('file too large (max 2MB)');
  return fs.readFileSync(resolved, 'utf8');
}

function writeFileSafe(filePath: string, content: string): { path: string; bytes: number } {
  const HERMES = process.env.HERMES_HOME || cfg.hermesHome || path.join(os.homedir(), '.hermes');
  const resolved = path.resolve(HERMES, filePath.replace(/^\/+/, ''));
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, content || '', 'utf8');
  return { path: resolved, bytes: Buffer.byteLength(content || '') };
}

function buildExplorerRoot({ key, label, root }: { key: string; label: string; root: string }): any {
  function listDirectory(current: string, depth: number, maxDepth: number, maxEntries: number, baseRoot: string): any[] {
    if (depth > maxDepth) return [];
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return []; }
    entries = entries.filter(e => !e.name.startsWith('.DS_Store') && !IGNORED_DIRS.has(e.name)).sort((a, b) => { if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1; return a.name.localeCompare(b.name); });
    const output: any[] = [];
    for (const entry of entries) {
      if (output.length >= maxEntries) break;
      const abs = path.join(current, entry.name);
      const node: any = { name: entry.name, path: abs, rel: path.relative(baseRoot, abs) || entry.name, type: entry.isDirectory() ? 'dir' : 'file', depth, children: [] };
      if (entry.isDirectory() && depth < maxDepth) node.children = listDirectory(abs, depth + 1, maxDepth, maxEntries, baseRoot);
      output.push(node);
    }
    return output;
  }
  return { key, label, root, children: listDirectory(root, 0, 2, 140, root) };
}

router.get('/explorer', requireAuth, (req, res) => {
  const roots = String(req.query.root || '');
  if (roots) {
    const root = ROOTS.find(r => r.key === roots);
    if (!root) return res.status(404).json({ error: 'unknown root' });
    return res.json(buildExplorerRoot(root));
  }
  return res.json(ROOTS.map(buildExplorerRoot));
});

router.get('/file', requireAuth, (req: any, res) => {
  const requested = String(req.query.path || '');
  if (!requested) return res.status(400).json({ error: 'path required' });
  try {
    const content = readFileSafe(requested);
    const HERMES = process.env.HERMES_HOME || cfg.hermesHome || path.join(os.homedir(), '.hermes');
    return res.json({ ok: true, path: path.resolve(HERMES, requested.replace(/^\/+/, '')), content });
  } catch (error: any) {
    const message = error.message || 'file read failed';
    const status = message.includes('EISDIR') ? 400 : message.includes('not found') ? 404 : 400;
    return res.status(status).json({ error: message, path: requested });
  }
});

router.post('/file', requireCsrf, (req: any, res) => {
  const { path: filePath, content } = req.body || {};
  if (!filePath) return res.status(400).json({ error: 'path required' });
  try {
    const result = writeFileSafe(filePath, content);
    log('file.saved', result.path);
    return res.json({ ok: true, ...result });
  } catch (error: any) { return res.status(400).json({ error: error.message || 'save failed' }); }
});

router.get('/files/list', requireAuth, (req, res) => {
  const dirPath = String(req.query.path || '').replace(/^\/+/, '').replace(/\.\./g, '');
  const baseDir = path.join(os.homedir(), '.hermes');
  const resolved = path.resolve(baseDir, dirPath);
  if (!resolved.startsWith(baseDir)) return res.status(403).json({ error: 'path outside allowed roots' });
  try {
    if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'directory not found' });
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) return res.status(400).json({ error: 'not a directory' });
    const items = fs.readdirSync(resolved).map(name => {
      try { const itemPath = path.join(resolved, name); const itemStat = fs.statSync(itemPath); return { name, type: itemStat.isDirectory() ? 'directory' : 'file', size: itemStat.size, modified: itemStat.mtime.toISOString(), path: path.relative(baseDir, itemPath) }; } catch { return { name, type: 'unknown', path: path.relative(baseDir, path.join(resolved, name)) }; }
    });
    items.sort((a, b) => { if (a.type === 'directory' && b.type !== 'directory') return -1; if (a.type !== 'directory' && b.type === 'directory') return 1; return a.name.localeCompare(b.name); });
    res.json({ ok: true, path: path.relative(baseDir, resolved), items, parent: path.relative(baseDir, path.dirname(resolved)).replace(/\.\./g, '') || '' });
  } catch (error: any) { res.status(500).json({ error: error.message || 'failed to list directory' }); }
});

export default router;
