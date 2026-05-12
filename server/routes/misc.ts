/**
 * Misc routes — models, memory, dump, backup, doctor, plugins, auth providers.
 */
import { Router } from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import yaml from 'js-yaml';
import { requireAuth, requireCsrf, requireRole, requirePerm } from '../middleware/auth';
import { shell, execHermes, stripAnsi } from '../services/shell';
import { HERMES_HOME, log } from '../state';

const authModule = require('../../auth');
const router = Router();

function sanitizeProfileName(name: any): string | null {
  const s = String(name || '').trim();
  return /^[a-zA-Z0-9_-]+$/.test(s) ? s : null;
}

// Models
router.get('/models', requireAuth, async (req, res) => {
  try {
    const configPath = path.join(os.homedir(), '.hermes', 'config.yaml');
    const configContent = await fs.promises.readFile(configPath, 'utf-8');
    const config: any = yaml.load(configContent) || {};
    const modelConfig = config.model || {};
    const defaultModel = modelConfig.default || 'unknown';
    const provider = modelConfig.provider || 'unknown';
    res.json({ ok: true, default: defaultModel, provider, groups: [{ provider, models: [defaultModel] }] });
  } catch (e: any) { res.json({ ok: false, error: e.message, groups: [], default: 'auto' }); }
});

// Memory data
router.get('/memory/:profile', requireAuth, async (req: any, res) => {
  try {
    const profile = sanitizeProfileName(req.params.profile);
    if (!profile) return res.status(400).json({ ok: false, error: 'invalid profile name' });
    const home = profile === 'default' ? `${process.env.HOME}/.hermes` : `${process.env.HOME}/.hermes/profiles/${profile}`;
    const memoriesDir = profile === 'default' ? `${process.env.HOME}/.hermes/memories` : `${home}/memories`;
    const [memoryContent, userContent, soulContent, honchoConfig] = await Promise.all([
      shell(`cat "${memoriesDir}/MEMORY.md" 2>/dev/null || echo ""`),
      shell(`cat "${memoriesDir}/USER.md" 2>/dev/null || echo ""`),
      shell(`cat "${home}/SOUL.md" 2>/dev/null || echo ""`),
      shell(`cat "${home}/honcho.json" 2>/dev/null || echo ""`),
    ]);
    let honcho_data: any = { connected: false };
    try {
      const honchoStatus = await shell(`hermes honcho --target-profile ${profile} status 2>&1`);
      const lines = honchoStatus.split('\n');
      honcho_data.connected = honchoStatus.includes('Connection... OK');
      honcho_data.enabled = honchoStatus.includes('Enabled:        True');
      const getVal = (key: string) => { const line = lines.find(l => l.trim().startsWith(key + ':')); return line ? line.split(':').slice(1).join(':').trim() : ''; };
      honcho_data.profile = getVal('Profile'); honcho_data.host = getVal('Host');
      honcho_data.workspace = getVal('Workspace'); honcho_data.ai_peer = getVal('AI peer');
      honcho_data.user_peer = getVal('User peer'); honcho_data.session_key = getVal('Session key');
      honcho_data.recall_mode = getVal('Recall mode'); honcho_data.write_freq = getVal('Write freq');
      honcho_data.config_path = getVal('Config path');
      const reprStart = lines.findIndex(l => l.includes('AI peer representation:'));
      if (reprStart > -1) honcho_data.representation = lines.slice(reprStart + 1, reprStart + 6).map(l => l.trim()).filter(Boolean).join(' ').substring(0, 200);
    } catch { honcho_data = { connected: false }; }
    res.json({ ok: true, memory_chars: memoryContent.length, memory_max: 2200, user_chars: userContent.length, user_max: 1375, soul_chars: soulContent.length, memory_content: memoryContent.substring(0, 200), user_content: userContent.substring(0, 200), soul_content: soulContent, honcho_connected: honcho_data.connected, honcho_data });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

// Doctor
router.post('/doctor', requireRole('admin'), requireCsrf, (req: any, res) => {
  const fix = req.body.fix ? '--fix' : '';
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'progress', line: fix ? 'Running diagnostics with auto-fix...' : 'Running diagnostics...' })}\n\n`);
  const proc = spawn('script', ['-qfc', `hermes doctor ${fix}`, '/dev/null'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HERMES_HOME: path.join(os.homedir(), '.hermes'), TERM: 'dumb' } });
  let fullOutput = '';
  proc.stdout.on('data', (chunk: Buffer) => { const text = stripAnsi(chunk.toString()); fullOutput += text; text.split('\n').filter((l: string) => l.trim()).forEach((line: string) => { res.write(`data: ${JSON.stringify({ type: 'progress', line: line.trim() })}\n\n`); }); });
  proc.stderr.on('data', (chunk: Buffer) => { const text = stripAnsi(chunk.toString()); fullOutput += text; if (text.trim()) res.write(`data: ${JSON.stringify({ type: 'progress', line: text.trim() })}\n\n`); });
  proc.on('close', () => { res.write(`data: ${JSON.stringify({ type: 'done', output: fullOutput.trim() })}\n\n`); res.end(); });
});

// Backup create
router.post('/backup/create', requireRole('admin'), requireCsrf, (req: any, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'progress', line: 'Starting backup...' })}\n\n`);
  const outPath = `/tmp/hermes-backup-${Date.now()}.zip`;
  const proc = spawn('script', ['-qfc', `hermes backup -o ${outPath}`, '/dev/null'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HERMES_HOME: path.join(os.homedir(), '.hermes'), TERM: 'dumb' } });
  let fullOutput = '';
  proc.stdout.on('data', (chunk: Buffer) => { const text = stripAnsi(chunk.toString()); fullOutput += text; text.split('\n').filter((l: string) => l.trim()).forEach((line: string) => { res.write(`data: ${JSON.stringify({ type: 'progress', line: line.trim() })}\n\n`); }); });
  proc.stderr.on('data', (chunk: Buffer) => { const text = stripAnsi(chunk.toString()); fullOutput += text; if (text.trim()) res.write(`data: ${JSON.stringify({ type: 'progress', line: text.trim() })}\n\n`); });
  proc.on('close', () => {
    if (!fs.existsSync(outPath)) { res.write(`data: ${JSON.stringify({ type: 'error', message: 'Backup file not created', output: fullOutput.trim() })}\n\n`); return res.end(); }
    const filename = 'hermes-backup-' + new Date().toISOString().slice(0, 10) + '.zip';
    authModule.audit(req.hciUser?.username || 'unknown', req.hciUser?.role || 'unknown', 'BACKUP_CREATE', outPath);
    res.write(`data: ${JSON.stringify({ type: 'done', path: outPath, filename, output: fullOutput.trim() })}\n\n`);
    res.end();
  });
});

// Backup import
router.post('/backup/import', requireRole('admin'), requireCsrf, (req: any, res) => {
  const multer = require('multer');
  const upload = multer({ dest: '/tmp/', limits: { fileSize: 5 * 1024 * 1024 * 1024 } });
  upload.single('backup')(req, res, (multerErr: any) => {
    if (multerErr || !req.file) return res.json({ ok: false, error: multerErr?.message || 'No file uploaded' });
    const zipPath = req.file.path;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ type: 'progress', line: `File uploaded: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(1)} MB)` })}\n\n`);
    const proc = spawn('script', ['-qfc', `hermes import ${zipPath} --force`, '/dev/null'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HERMES_HOME: path.join(os.homedir(), '.hermes'), TERM: 'dumb' } });
    let fullOutput = '';
    proc.stdout.on('data', (chunk: Buffer) => { const text = stripAnsi(chunk.toString()); fullOutput += text; text.split('\n').filter((l: string) => l.trim()).forEach((line: string) => { res.write(`data: ${JSON.stringify({ type: 'progress', line: line.trim() })}\n\n`); }); });
    proc.stderr.on('data', (chunk: Buffer) => { const text = stripAnsi(chunk.toString()); fullOutput += text; if (text.trim()) res.write(`data: ${JSON.stringify({ type: 'progress', line: text.trim() })}\n\n`); });
    proc.on('close', () => { try { fs.unlinkSync(zipPath); } catch {} authModule.audit(req.hciUser?.username || 'unknown', req.hciUser?.role || 'unknown', 'BACKUP_IMPORT', req.file.originalname); res.write(`data: ${JSON.stringify({ type: 'done', output: fullOutput.trim() })}\n\n`); res.end(); });
  });
});

// Backup download
router.get('/backup/download', requireRole('admin'), (req: any, res) => {
  const rawPath = req.query.path;
  if (!rawPath || !rawPath.endsWith('.zip')) return res.status(400).json({ error: 'Invalid path' });
  const filePath = path.resolve(rawPath);
  if (!filePath.startsWith('/tmp/')) return res.status(400).json({ error: 'Invalid path' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.download(filePath);
});

// Dump
router.get('/dump', requireRole('admin'), async (req, res) => {
  try { const output = await shell('hermes dump --show-keys 2>&1', '60s'); res.json({ ok: true, output }); }
  catch (e: any) { res.json({ ok: false, output: e.message }); }
});

// Auth providers
router.get('/auth/providers', requireRole('admin'), async (req, res) => {
  try {
    const raw = await shell('hermes auth list 2>&1');
    const lines = raw.split('\n').filter(Boolean);
    const providers: any[] = [];
    for (const line of lines) {
      const match = line.match(/(✓|✗|●|○)\s*(\w+)\s*(set|not set)/i);
      if (match) providers.push({ name: match[2], set: match[3] === 'set' });
    }
    if (providers.length === 0) {
      const knownProviders = ['openrouter', 'anthropic', 'nous', 'openai', 'google'];
      for (const p of knownProviders) { if (raw.toLowerCase().includes(p)) providers.push({ name: p, set: true }); }
    }
    res.json({ ok: true, providers });
  } catch { res.json({ ok: true, providers: [] }); }
});

// Skills list (simple)
router.get('/skills', requireAuth, async (req, res) => {
  try {
    const raw = await shell('hermes skills list 2>&1');
    const lines = raw.split('\n');
    const skills: any[] = [];
    for (const line of lines) {
      if (!line.trim().startsWith('│')) continue;
      const cells = line.split('│').map(c => c.trim()).filter((c, i) => i > 0);
      if (cells.length >= 2 && cells[0]) skills.push({ name: cells[0] || '', category: cells[1] || 'uncategorized', source: cells[2] || '', trust: cells[3] || '', enabled: true });
    }
    res.json({ ok: true, skills });
  } catch { res.json({ ok: true, skills: [] }); }
});

// Plugins
function findPluginManifests() {
  const skillsDir = path.join(os.homedir(), '.hermes', 'skills');
  const manifests: any[] = [];
  if (!fs.existsSync(skillsDir)) return manifests;
  try {
    for (const cat of fs.readdirSync(skillsDir)) {
      const catDir = path.join(skillsDir, cat);
      if (!fs.statSync(catDir).isDirectory()) continue;
      try {
        for (const skill of fs.readdirSync(catDir)) {
          const manifestPath = path.join(catDir, skill, 'ui', 'manifest.json');
          if (fs.existsSync(manifestPath)) {
            try {
              const plugin = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
              plugin.path = path.join(catDir, skill);
              plugin.uiPath = path.join(catDir, skill, 'ui');
              plugin.status = plugin.premium ? 'locked' : 'active';
              manifests.push(plugin);
            } catch {}
          }
        }
      } catch {}
    }
  } catch {}
  return manifests;
}

router.get('/plugins', requireRole('admin'), (req, res) => {
  const plugins = findPluginManifests().map(p => ({ id: p.id, name: p.name, version: p.version, description: p.description, icon: p.icon || '📦', pages: p.pages || [], status: p.status, premium: p.premium || false, price: p.price || null }));
  res.json({ ok: true, plugins });
});

export default router;
