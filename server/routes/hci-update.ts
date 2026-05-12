/**
 * HCI update routes — git pull, check-update, commit diff, rollback, restart.
 */
import { Router } from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { requireCsrf, requireRole } from '../middleware/auth';
import { shell, stripAnsi } from '../services/shell';
import { PORT, PROJECT_ROOT } from '../state';

const authModule = require('../../auth');
const router = Router();

// HCI Update — git pull + npm install + build + auto-restart
router.post('/hci/update', requireRole('admin'), requireCsrf, (req: any, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'progress', line: 'Starting HCI update...' })}\n\n`);
  const HCI_DIR = PROJECT_ROOT;
  const steps = [
    { name: 'git reset', cmd: `cd ${HCI_DIR} && git checkout -- . 2>&1 || true` },
    { name: 'git pull', cmd: `cd ${HCI_DIR} && git pull --ff-only 2>&1` },
    { name: 'npm install', cmd: `cd ${HCI_DIR} && npm install 2>&1` },
    { name: 'build', cmd: `cd ${HCI_DIR} && npm run build 2>&1` },
  ];
  (async () => {
    for (const step of steps) {
      res.write(`data: ${JSON.stringify({ type: 'progress', line: `▸ ${step.name}...` })}\n\n`);
      try {
        const out = await shell(step.cmd, '120s');
        const text = out.trim() || '(no output)';
        text.split('\n').filter((l: string) => l.trim()).forEach((line: string) => { res.write(`data: ${JSON.stringify({ type: 'progress', line: '  ' + line.trim() })}\n\n`); });
        if (out.includes('error') || out.includes('ERROR') || out.includes('fatal')) { res.write(`data: ${JSON.stringify({ type: 'error', message: `${step.name} failed` })}\n\n`); return res.end(); }
      } catch (e: any) { res.write(`data: ${JSON.stringify({ type: 'error', message: `${step.name} failed: ${e.message}` })}\n\n`); return res.end(); }
    }
    res.write(`data: ${JSON.stringify({ type: 'progress', line: '▸ Update complete. Restarting in 3s...' })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done', message: 'Update complete, restarting...' })}\n\n`);
    res.end();
    const restartScript = `sleep 3 && fuser -k ${PORT}/tcp 2>/dev/null; sleep 1 && cd ${PROJECT_ROOT} && nohup bun run server/index.ts &>/tmp/hci-staging.log &`;
    spawn('sh', ['-c', restartScript], { detached: true, stdio: 'ignore' }).unref();
  })();
});

// HCI Check Updates
router.get('/hci/check-update', requireRole('admin'), async (req, res) => {
  try {
    const HCI_DIR = PROJECT_ROOT;
    const run = (cmd: string, timeout: string) => shell(`bash -c "cd '${HCI_DIR}' && ${cmd}"`, timeout);
    const branch = (await run('git branch --show-current', '5s')).trim();
    await run('git fetch origin ' + branch, '30s');
    const localHash = (await run('git rev-parse --short HEAD', '5s')).trim();
    const localMsg = (await run('git log -1 --pretty=format:"%s"', '5s')).trim();
    const localDate = (await run('git log -1 --format="%ci"', '5s')).trim();
    const remoteHash = (await run(`git rev-parse --short origin/${branch}`, '5s')).trim();
    const behindStr = (await run(`git rev-list HEAD..origin/${branch} --count`, '5s')).trim();
    const behind = parseInt(behindStr, 10) || 0;
    let commits: any[] = [];
    if (behind > 0) {
      const logRaw = await run(`git log --oneline --format="%H|%h|%s|%an|%ci" HEAD..origin/${branch}`, '10s');
      commits = logRaw.trim().split('\n').filter(Boolean).map(line => { const [hash, shortHash, msg, author, date] = line.split('|'); return { hash, shortHash, msg, author, date }; });
    }
    let pkgVersion = '';
    try { pkgVersion = JSON.parse(fs.readFileSync(path.join(HCI_DIR, 'package.json'), 'utf8')).version; } catch {}
    res.json({ ok: true, branch, local: { hash: localHash, msg: localMsg, date: localDate, version: pkgVersion }, remote: { hash: remoteHash }, behind, commits });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

// HCI Commit Diff
router.get('/hci/commit/:hash/diff', requireRole('admin'), async (req: any, res) => {
  try {
    const HCI_DIR = PROJECT_ROOT;
    const hash = req.params.hash.replace(/[^a-f0-9]/g, '');
    const run = (cmd: string, timeout: string) => shell(`bash -c "cd '${HCI_DIR}' && ${cmd}"`, timeout);
    const metaRaw = await run(`git log -1 --format="%H|%h|%s|%an|%ci|%b" ${hash}`, '5s');
    const [fullHash, shortHash, msg, author, date, body] = metaRaw.trim().split('|');
    const stat = await run(`git diff --stat ${hash}~1..${hash} 2>&1`, '10s');
    const numstat = await run(`git diff --numstat ${hash}~1..${hash} 2>&1`, '10s');
    const files = numstat.trim().split('\n').filter(Boolean).map(line => { const parts = line.split('\t'); return { added: parseInt(parts[0], 10) || 0, removed: parseInt(parts[1], 10) || 0, file: parts[2] }; });
    const shortstat = (await run(`git diff --shortstat ${hash}~1..${hash}`, '5s')).trim();
    res.json({ ok: true, commit: { hash: fullHash, shortHash, msg, author, date, body: body || '' }, files, shortstat, statText: stat.trim() });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

// HCI Update to specific commit
router.post('/hci/update/commit/:hash', requireRole('admin'), requireCsrf, (req: any, res) => {
  const HCI_DIR = PROJECT_ROOT;
  const hash = req.params.hash.replace(/[^a-f0-9]/g, '');
  const run = (cmd: string, timeout: string) => shell(`bash -c "cd '${HCI_DIR}' && ${cmd}"`, timeout);
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'progress', line: `Checking out commit ${hash}...` })}\n\n`);
  const steps = [
    { name: 'fetch', cmd: 'git fetch origin', timeout: '30s' },
    { name: 'checkout', cmd: `git checkout ${hash} 2>&1`, timeout: '15s' },
    { name: 'npm install', cmd: 'npm install 2>&1', timeout: '120s' },
    { name: 'build', cmd: 'npm run build 2>&1', timeout: '120s' },
  ];
  (async () => {
    for (const step of steps) {
      res.write(`data: ${JSON.stringify({ type: 'progress', line: `▸ ${step.name}...` })}\n\n`);
      try {
        const out = await run(step.cmd, step.timeout);
        out.trim().split('\n').filter((l: string) => l.trim()).forEach((line: string) => { res.write(`data: ${JSON.stringify({ type: 'progress', line: '  ' + line.trim() })}\n\n`); });
      } catch (e: any) { res.write(`data: ${JSON.stringify({ type: 'error', message: `${step.name} failed: ${e.message}` })}\n\n`); return res.end(); }
    }
    const currentHash = (await run('git rev-parse --short HEAD', '5s')).trim();
    const currentMsg = (await run('git log -1 --pretty=format:"%s"', '5s')).trim();
    res.write(`data: ${JSON.stringify({ type: 'done', message: 'Update complete', hash: currentHash, msg: currentMsg })}\n\n`);
    res.end();
    const restartScript = `sleep 3 && fuser -k ${PORT}/tcp 2>/dev/null; sleep 1 && cd ${PROJECT_ROOT} && nohup bun run server/index.ts &>/tmp/hci-staging.log &`;
    spawn('sh', ['-c', restartScript], { detached: true, stdio: 'ignore' }).unref();
  })();
});

// HCI Rollback
router.post('/hci/rollback', requireRole('admin'), requireCsrf, (req: any, res) => {
  const HCI_DIR = PROJECT_ROOT;
  const numSteps = req.body?.steps || 1;
  const run = (cmd: string, timeout: string) => shell(`bash -c "cd '${HCI_DIR}' && ${cmd}"`, timeout);
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'progress', line: `Rolling back ${numSteps} commit(s)...` })}\n\n`);
  const rollbackSteps = [
    { name: 'checkout', cmd: `git checkout HEAD~${numSteps} 2>&1`, timeout: '15s' },
    { name: 'npm install', cmd: 'npm install 2>&1', timeout: '120s' },
    { name: 'build', cmd: 'npm run build 2>&1', timeout: '120s' },
  ];
  (async () => {
    for (const step of rollbackSteps) {
      res.write(`data: ${JSON.stringify({ type: 'progress', line: `▸ ${step.name}...` })}\n\n`);
      try { const out = await run(step.cmd, step.timeout); out.trim().split('\n').filter((l: string) => l.trim()).forEach((line: string) => { res.write(`data: ${JSON.stringify({ type: 'progress', line: '  ' + line.trim() })}\n\n`); }); }
      catch (e: any) { res.write(`data: ${JSON.stringify({ type: 'error', message: `${step.name} failed: ${e.message}` })}\n\n`); return res.end(); }
    }
    const currentHash = (await run('git rev-parse --short HEAD', '5s')).trim();
    res.write(`data: ${JSON.stringify({ type: 'done', message: 'Rollback complete', hash: currentHash })}\n\n`);
    res.end();
    const restartScript = `sleep 3 && fuser -k ${PORT}/tcp 2>/dev/null; sleep 1 && cd ${PROJECT_ROOT} && nohup bun run server/index.ts &>/tmp/hci-staging.log &`;
    spawn('sh', ['-c', restartScript], { detached: true, stdio: 'ignore' }).unref();
  })();
});

// HCI Restart
router.post('/hci-restart', requireRole('admin'), requireCsrf, (req: any, res) => {
  authModule.audit(req.hciUser?.username || 'unknown', req.hciUser?.role || 'unknown', 'HCI_RESTART', 'initiated');
  res.json({ ok: true, message: 'HCI restarting in 2 seconds...' });
  const script = `sleep 2 && fuser -k ${PORT}/tcp 2>/dev/null; sleep 1 && cd ${PROJECT_ROOT} && nohup bun run server/index.ts &>/tmp/hci-staging.log &`;
  spawn('sh', ['-c', script], { detached: true, stdio: 'ignore' }).unref();
});

// Hermes Update
router.post('/update', requireRole('admin'), requireCsrf, (req: any, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'progress', line: 'Starting Hermes update...' })}\n\n`);
  authModule.audit(req.hciUser?.username || 'unknown', req.hciUser?.role || 'unknown', 'HERMES_UPDATE', 'started');
  const hermesHome = path.join(os.homedir(), '.hermes');
  const promptPath = path.join(hermesHome, '.update_prompt.json');
  const responsePath = path.join(hermesHome, '.update_response');
  const answerInterval = setInterval(() => { try { if (fs.existsSync(promptPath)) fs.writeFileSync(responsePath, 'Y'); } catch {} }, 500);
  const proc = spawn('script', ['-qfc', 'hermes update --gateway', '/dev/null'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HERMES_HOME: hermesHome, TERM: 'dumb' } });
  let fullOutput = '';
  proc.stdout.on('data', (chunk: Buffer) => { const text = stripAnsi(chunk.toString()); fullOutput += text; text.split('\n').filter((l: string) => l.trim()).forEach((line: string) => { res.write(`data: ${JSON.stringify({ type: 'progress', line: line.trim() })}\n\n`); }); });
  proc.stderr.on('data', (chunk: Buffer) => { const text = stripAnsi(chunk.toString()); fullOutput += text; if (text.trim()) res.write(`data: ${JSON.stringify({ type: 'progress', line: text.trim() })}\n\n`); });
  proc.on('close', () => { clearInterval(answerInterval); try { fs.unlinkSync(promptPath); } catch {} try { fs.unlinkSync(responsePath); } catch {} res.write(`data: ${JSON.stringify({ type: 'done', output: fullOutput.trim() })}\n\n`); res.end(); });
});

export default router;
