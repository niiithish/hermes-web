/**
 * Layout, avatar, agent state routes.
 */
import { Router } from 'express';
import fs from 'fs';
import express from 'express';
import { requireAuth, requireCsrf } from '../middleware/auth';
import { readAvatarOverride, writeAvatarOverride, clearAvatarOverride, getAvatarDataUrl } from '../services/avatar';
import { buildSpriteState } from '../services/dashboard';
import { layoutStorePath, spriteState, log, DEFAULT_AVATAR_FALLBACK } from '../state';

const router = Router();

function readLayoutStore(): any {
  try { return JSON.parse(fs.readFileSync(layoutStorePath, 'utf8')); } catch { return { panels: [] }; }
}

function writeLayoutStore(data: any): any {
  fs.writeFileSync(layoutStorePath, JSON.stringify(data, null, 2));
  return data;
}

router.get('/layout', requireAuth, (req, res) => {
  res.json({ ok: true, layout: readLayoutStore() });
});

router.post('/layout', requireCsrf, (req: any, res) => {
  try {
    const panels = Array.isArray(req.body?.panels) ? req.body.panels : [];
    const normalized = panels.filter((item: any) => item && item.id).map((item: any) => ({ id: String(item.id), x: Number(item.x || 0), y: Number(item.y || 0), w: Number(item.w || 0), h: Number(item.h || 0) }));
    const saved = writeLayoutStore({ panels: normalized });
    log('layout.saved', `${normalized.length} panels`);
    return res.json({ ok: true, layout: saved });
  } catch (error: any) { return res.status(400).json({ error: error.message || 'layout save failed' }); }
});

router.get('/avatar', requireAuth, (req, res) => {
  res.json({ ok: true, url: '/api/avatar/image', custom: !!readAvatarOverride() });
});

router.post('/agent/state', requireCsrf, (req: any, res) => {
  const target = String(req.body?.state || '').toLowerCase();
  const valid = ['idle', 'thinking', 'coding', 'executing', 'error'];
  if (!valid.includes(target)) return res.status(400).json({ error: `valid states: ${valid.join(', ')}` });
  const states = ['idle', 'thinking', 'coding', 'executing'];
  const idx = states.indexOf(target);
  if (idx >= 0) { spriteState.since = Date.now() - idx * 5000 - 2500; spriteState.state = target; }
  log('agent.state.set', target);
  return res.json({ ok: true, state: target });
});

router.post('/avatar', requireCsrf, express.json({ limit: '10mb' }), (req: any, res) => {
  const dataUrl = String(req.body?.dataUrl || '').trim();
  if (!dataUrl) return res.status(400).json({ error: 'no data' });
  if (!dataUrl.startsWith('data:image/') || !dataUrl.includes(';base64,')) return res.status(400).json({ error: 'invalid image data' });
  const b64Part = dataUrl.split(';base64,')[1];
  if (!b64Part || b64Part.length < 10) return res.status(400).json({ error: 'invalid image data' });
  const decodedSize = Math.ceil(b64Part.length * 0.75);
  if (decodedSize > 5 * 1024 * 1024) return res.status(400).json({ error: 'image too large (max 5MB)' });
  writeAvatarOverride(dataUrl);
  log('avatar.uploaded', `len ${dataUrl.length}`);
  return res.json({ ok: true, url: '/api/avatar/image', custom: true });
});

router.delete('/avatar', requireCsrf, (req, res) => {
  clearAvatarOverride();
  log('avatar.reset', 'avatar reverted to default photo');
  return res.json({ ok: true, src: getAvatarDataUrl(), custom: false });
});

router.get('/avatar/image', requireAuth, (req, res) => {
  const override = readAvatarOverride();
  if (override) {
    const match = override.match(/^data:(image\/\w+);base64,(.+)$/);
    if (match) { res.set('Content-Type', match[1]); res.set('Cache-Control', 'private, max-age=3600'); return res.send(Buffer.from(match[2], 'base64')); }
  }
  try { const buf = fs.readFileSync(DEFAULT_AVATAR_FALLBACK); res.set('Content-Type', 'image/jpeg'); res.set('Cache-Control', 'private, max-age=3600'); return res.send(buf); }
  catch { return res.status(404).send('no avatar'); }
});

export default router;
