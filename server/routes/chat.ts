/**
 * Chat routes — gateway proxy SSE + CLI fallback.
 */
import { Router } from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { requireAuth, requireCsrf } from '../middleware/auth';
import { requirePerm } from '../middleware/auth';
import { shell, stripAnsi } from '../services/shell';
import { getGatewayBase, getDefaultModel } from '../services/gateway-discovery';
import { getStateDbPath } from '../services/sessions';
import { gatewayPorts, GATEWAY_API_KEY, HERMES_HOME } from '../state';

const Database = require('../../lib/database');
const router = Router();

function sanitizeProfileName(name: any): string | null {
  const s = String(name || '').trim();
  return /^[a-zA-Z0-9_-]+$/.test(s) ? s : null;
}

// POST /gateway/responses — start a new agent run via Gateway API
router.post('/gateway/responses', requireAuth, requirePerm('chat.use'), async (req: any, res) => {
  const { message, profile, session_id, model, stream = true } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message required' });

  try {
    const gatewayBase = getGatewayBase(profile || 'default');
    if (!gatewayBase) return res.status(503).json({ error: 'Gateway API not available for profile: ' + (profile || 'default') });
    const gatewayBody = { model: model || getDefaultModel(profile || 'default'), input: message, stream };
    const gwHeaders: Record<string, string> = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GATEWAY_API_KEY}` };
    if (session_id) gwHeaders['X-Hermes-Session-Id'] = session_id;

    const gatewayRes = await fetch(`${gatewayBase}/v1/responses`, { method: 'POST', headers: gwHeaders, body: JSON.stringify(gatewayBody) });
    if (!gatewayRes.ok) { const errText = await gatewayRes.text(); return res.status(gatewayRes.status).json({ error: `Gateway error: ${errText}` }); }

    const hermesSessionId = gatewayRes.headers.get('x-hermes-session-id') || '';
    if (!stream) { const data: any = await gatewayRes.json(); if (hermesSessionId) data._hermes_session_id = hermesSessionId; return res.json(data); }

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no', ...(hermesSessionId ? { 'X-Hermes-Session-Id': hermesSessionId } : {}) });
    if (hermesSessionId) res.write(`event: hci.session\ndata: ${JSON.stringify({ type: 'hci.session', session_id: hermesSessionId })}\n\n`);

    const webReader = (gatewayRes.body as any).getReader();
    const decoder = new TextDecoder();
    let aborted = false;
    req.on('close', () => { aborted = true; webReader.cancel().catch(() => {}); });
    (async () => {
      try { while (!aborted) { const { done, value } = await webReader.read(); if (done) break; res.write(decoder.decode(value, { stream: true })); } } catch {} finally { res.end(); }
    })();
  } catch (e: any) {
    if (!res.headersSent) return res.status(502).json({ error: `Gateway unavailable: ${e.message}` });
    res.end();
  }
});

// POST /chat/send — CLI fallback with SSE streaming
router.post('/chat/send', requireAuth, requirePerm('chat.use'), async (req: any, res) => {
  const { message, profile, sessionId, model } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message required' });

  const prof = sanitizeProfileName(profile) || 'default';
  const escapedMsg = "'" + message.replace(/'/g, "'\\''") + "'";
  const profileFlag = prof !== 'default' ? `-p ${prof}` : '';
  const modelFlag = model ? `-m ${model}` : '';
  const resumeFlag = sessionId ? `--resume ${sessionId}` : '--continue ""';
  const fullCmd = `hermes chat -Q -q ${escapedMsg} ${profileFlag} ${modelFlag} ${resumeFlag}`;

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });

  const startTime = Date.now();
  let fullResponse = '';
  let thinkBuffer = '';

  try {
    const proc = spawn('bash', ['-lc', fullCmd], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HERMES_HOME: path.join(os.homedir(), '.hermes'), PYTHONUNBUFFERED: '1' },
    });

    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      fullResponse += text;
      const stripped = text
        .replace(/╭[═─╮][\s\S]*?╰[═─╯][^\n]*\n?/g, '')
        .replace(/^Session:\s+\d+.*$/gm, '').replace(/^Resume this session with:.*$/gm, '')
        .replace(/^Duration:.*$/gm, '').replace(/^Messages:.*$/gm, '').replace(/^Query:.*$/gm, '')
        .replace(/^-{10,}$/gm, '').replace(/^Initializing agent.*$/gm, '')
        .replace(/^↻\s+Resumed\s+session.*$/gm, '').replace(/^session_id:\s*\S+.*$/gm, '')
        .replace(/^\d+\s+user messages?,\s*\d+\s+total messages?\)\s*$/gm, '')
        .replace(/^pong\b.*$/gmi, '').replace(/^ping\b.*$/gmi, '')
        .replace(/^(✅|⚠️|🔁|⏳)\s*.*$/gmu, '').replace(/^\s*\[\d+:\d+:\d+\]\s*.*$/gm, '')
        .replace(/^\s*$/gm, '');
      if (!stripped.trim()) return;

      thinkBuffer += stripped;
      let output = '', reasoningAccum = '', i = 0;
      while (i < thinkBuffer.length) {
        const openIdx = thinkBuffer.indexOf('<think>', i);
        if (openIdx === -1) { output += thinkBuffer.slice(i); break; }
        output += thinkBuffer.slice(i, openIdx);
        const closeIdx = thinkBuffer.indexOf('</think>', openIdx);
        if (closeIdx === -1) { thinkBuffer = thinkBuffer.slice(openIdx); if (output.trim()) res.write(`data: ${JSON.stringify({ type: 'token', content: output })}\n\n`); return; }
        const thinkContent = thinkBuffer.slice(openIdx + '<think>'.length, closeIdx);
        if (thinkContent.trim()) reasoningAccum += thinkContent;
        i = closeIdx + '</think>'.length;
      }
      if (reasoningAccum.trim()) res.write(`data: ${JSON.stringify({ type: 'reasoning', content: reasoningAccum })}\n\n`);
      if (output.trim()) res.write(`data: ${JSON.stringify({ type: 'token', content: output })}\n\n`);
      thinkBuffer = '';
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (!text) return;
      const isNoise = /pong/i.test(text) || /ping/i.test(text) || /messages?\).*total/i.test(text) || /^✅/mu.test(text) || /^⚠️/mu.test(text) || /resumed/i.test(text) || /initializing/i.test(text) || /session_id/i.test(text);
      if (isNoise) return;
      res.write(`data: ${JSON.stringify({ type: 'error', content: text })}\n\n`);
    });

    proc.on('close', () => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      if (thinkBuffer.trim()) {
        const flushed = thinkBuffer.replace(/^<think>/i, '').trim();
        if (flushed) res.write(`data: ${JSON.stringify({ type: 'token', content: flushed })}\n\n`);
      }
      const sidMatch = fullResponse.match(/session_id:\s*([0-9]{8}_[0-9]{6}_[a-f0-9]+)/i) || fullResponse.match(/Session:\s+([0-9]{8}_[0-9]{6}_[a-f0-9]+)/i);
      const newSessionId = sidMatch ? sidMatch[1] : sessionId || '';
      res.write(`data: ${JSON.stringify({ type: 'done', sessionId: newSessionId, elapsed: parseFloat(elapsed) })}\n\n`);
      res.end();
    });
  } catch (e: any) {
    res.write(`data: ${JSON.stringify({ type: 'error', content: e.message })}\n\n`);
    res.end();
  }
});

// POST /chat/fork — create a forked session from a point in history
router.post('/chat/fork', requireAuth, requireCsrf, requirePerm('chat.use'), (req: any, res) => {
  const { sessionId, messageIndex, profile } = req.body || {};
  if (!sessionId || typeof sessionId !== 'string') return res.status(400).json({ error: 'sessionId required' });
  if (messageIndex == null || typeof messageIndex !== 'number' || messageIndex < 0) return res.status(400).json({ error: 'messageIndex must be a non-negative number' });

  const prof = sanitizeProfileName(profile) || 'default';
  const stateDbPath = getStateDbPath(prof);
  if (!fs.existsSync(stateDbPath)) return res.status(404).json({ error: 'session store not found for profile: ' + prof });

  let db: any;
  try {
    db = new Database(stateDbPath, { readonly: false });
    const sourceSession = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!sourceSession) return res.status(404).json({ error: 'source session not found' });
    const messages = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC').all(sessionId);
    if (messageIndex >= messages.length) return res.status(400).json({ error: 'messageIndex out of range for this session' });
    const messagesToFork = messages.slice(0, messageIndex + 1);

    const now = new Date();
    const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 14).replace(/^(\d{8})(\d{6})$/, '$1_$2_');
    const rand = crypto.randomBytes(4).toString('hex');
    const newSessionId = ts + rand;

    db.prepare(`INSERT INTO sessions (id, source, user_id, model, model_config, system_prompt, parent_session_id, started_at, ended_at, end_reason, message_count, tool_call_count, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, billing_provider, billing_base_url, billing_mode, estimated_cost_usd, actual_cost_usd, cost_status, cost_source, pricing_version, title, api_call_count) VALUES (@id, @source, @user_id, @model, @model_config, @system_prompt, @parent_session_id, @started_at, @ended_at, @end_reason, @message_count, @tool_call_count, @input_tokens, @output_tokens, @cache_read_tokens, @cache_write_tokens, @reasoning_tokens, @billing_provider, @billing_base_url, @billing_mode, @estimated_cost_usd, @actual_cost_usd, @cost_status, @cost_source, @pricing_version, @title, @api_call_count)`).run({
      id: newSessionId, source: sourceSession.source, user_id: sourceSession.user_id, model: sourceSession.model, model_config: sourceSession.model_config, system_prompt: sourceSession.system_prompt, parent_session_id: sessionId, started_at: Date.now() / 1000, ended_at: null, end_reason: null, message_count: messagesToFork.length, tool_call_count: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0, billing_provider: sourceSession.billing_provider, billing_base_url: sourceSession.billing_base_url, billing_mode: sourceSession.billing_mode, estimated_cost_usd: null, actual_cost_usd: null, cost_status: null, cost_source: null, pricing_version: sourceSession.pricing_version, title: sourceSession.title ? (sourceSession.title + ' (fork)') : null, api_call_count: 0,
    });

    const insertMsg = db.prepare('INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls, tool_name, timestamp, token_count, finish_reason, reasoning, reasoning_details, codex_reasoning_items, reasoning_content, codex_message_items) VALUES (@session_id, @role, @content, @tool_call_id, @tool_calls, @tool_name, @timestamp, @token_count, @finish_reason, @reasoning, @reasoning_details, @codex_reasoning_items, @reasoning_content, @codex_message_items)');
    for (const msg of messagesToFork) {
      insertMsg.run({ session_id: newSessionId, role: msg.role, content: msg.content, tool_call_id: msg.tool_call_id, tool_calls: msg.tool_calls, tool_name: msg.tool_name, timestamp: msg.timestamp, token_count: msg.token_count, finish_reason: msg.finish_reason, reasoning: msg.reasoning, reasoning_details: msg.reasoning_details, codex_reasoning_items: msg.codex_reasoning_items, reasoning_content: msg.reasoning_content, codex_message_items: msg.codex_message_items });
    }
    db.close();
    res.json({ ok: true, sessionId: newSessionId, messageCount: messagesToFork.length, parentSessionId: sessionId });
  } catch (e: any) {
    try { db?.close(); } catch {}
    res.status(500).json({ error: e.message });
  }
});

// GET /gateway/ports
router.get('/gateway/ports', requireAuth, (req, res) => {
  res.json({ ports: gatewayPorts, profiles: Object.keys(gatewayPorts) });
});

export default router;
