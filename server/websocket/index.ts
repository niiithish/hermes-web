/**
 * WebSocket server — dashboard snapshots, terminal I/O, log streaming, chat.
 */
import { WebSocketServer, WebSocket } from 'ws';
import { spawn } from 'child_process';
import os from 'os';
import type { Server } from 'http';
import type { IncomingMessage } from 'http';
import { buildDashboardState } from '../services/dashboard';
import { ensureTerminalSession, appendTerminalOutput } from '../services/terminal';
import { getGatewayBase, getDefaultModel } from '../services/gateway-discovery';
import { terminalSession, logStream, GATEWAY_API_KEY, log } from '../state';
import { parseAndValidateToken } from '../middleware/auth';

const { getBridge, killAllBridges } = require('../../lib/tui-gateway-bridge');

// Extend WebSocket type for custom properties
interface HciSocket extends WebSocket {
  authed: boolean;
  clientId: string;
  activeChatReader: any;
  tuiBridge: any;
  tuiSessionId: string;
}

/**
 * Check if request has a valid auth cookie.
 */
function isAuthed(req: IncomingMessage): boolean {
  const cookieHeader = req.headers.cookie || '';
  const cookies: Record<string, string> = {};
  cookieHeader.split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) cookies[k.trim()] = v.join('=');
  });
  // Check for any auth cookie
  for (const [key, val] of Object.entries(cookies)) {
    if (key.startsWith('hci_') && val) {
      const user = parseAndValidateToken(val);
      if (user) return true;
    }
  }
  return false;
}

/**
 * System metrics snapshot.
 */
function getSystem() {
  const memTotal = os.totalmem();
  const memUsed = memTotal - os.freemem();
  let disk: any = null;
  try {
    const st = (fs as any).statfsSync('/');
    const total = st.blocks * st.bsize;
    const free = st.bavail * st.bsize;
    const used = total - free;
    disk = { total, used, free, percent: total ? Math.round((used / total) * 100) : 0 };
  } catch { disk = null; }
  return {
    host: os.hostname(),
    platform: `${os.platform()} ${os.release()}`,
    cpuCores: os.cpus().length,
    uptime: process.uptime(),
    load: os.loadavg(),
    memory: { total: memTotal, used: memUsed, percent: Math.round((memUsed / memTotal) * 100) },
    disk,
  };
}

let fs: typeof import('fs');
try { fs = require('fs'); } catch {}

let wssInstance: WebSocketServer | null = null;

/**
 * Broadcast to all authenticated clients.
 */
export function broadcastToClients(message: any): void {
  if (!wssInstance) return;
  const payload = JSON.stringify(message);
  for (const client of wssInstance.clients) {
    const sock = client as HciSocket;
    if (sock.readyState === WebSocket.OPEN && sock.authed) sock.send(payload);
  }
}

/**
 * Full dashboard state broadcast.
 */
async function broadcast(): Promise<void> {
  if (!wssInstance) return;
  const state = await buildDashboardState(true);
  const payload = JSON.stringify({ type: 'snapshot', payload: state });
  for (const client of wssInstance.clients) {
    const sock = client as HciSocket;
    if (sock.readyState === WebSocket.OPEN && sock.authed) sock.send(payload);
  }
}

/**
 * Start log streaming from hermes CLI.
 */
function startLogStream(logType: string, level: string, socket: HciSocket): void {
  stopLogStream();
  const args = ['logs', logType || 'agent', '-f', '-n', '200'];
  if (level) args.push('--level', level);
  logStream.proc = spawn('hermes', args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1' } });
  logStream.type = logType || 'agent';
  logStream.level = level || 'all';
  logStream.clients.add(socket);
  let buffer = '';
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (buffer && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'log-stream', logType: logStream.type, data: buffer }));
      buffer = '';
    }
    flushTimer = null;
  };
  logStream.proc.stdout?.on('data', (chunk: Buffer) => { buffer += chunk.toString(); if (!flushTimer) flushTimer = setTimeout(flush, 200); });
  logStream.proc.stderr?.on('data', (chunk: Buffer) => { buffer += chunk.toString(); if (!flushTimer) flushTimer = setTimeout(flush, 200); });
  logStream.proc.on('close', () => { if (flushTimer) clearTimeout(flushTimer); flush(); logStream.proc = null; });
  socket.send(JSON.stringify({ type: 'log-stream-start', logType: logStream.type, level: logStream.level }));
}

function stopLogStream(): void {
  if (logStream.proc) {
    try { logStream.proc.kill('SIGTERM'); } catch {}
    logStream.proc = null;
  }
  logStream.clients.clear();
}

/**
 * Transform Gateway SSE events to WebSocket chat events.
 */
function transformGatewayEvent(evt: any): any {
  const t = evt.type;
  if (t === 'response.output_text.delta') return { type: 'text.delta', delta: evt.delta || '' };
  if (t === 'response.output_item.added') {
    const item = evt.item || {};
    if (item.type === 'function_call' || item.type === 'tool_call') return { type: 'tool.start', call_id: item.call_id || item.id || ('tc_' + Date.now()), name: item.name, arguments: item.arguments || item.args };
  }
  if (t === 'hermes.tool.progress') return { type: 'tool.progress', name: evt.name, preview: evt.preview };
  if (t === 'response.output_item.done') {
    const item = evt.item || {};
    if (item.type === 'function_call' || item.type === 'tool_call') return { type: 'tool.done', call_id: item.call_id || item.id, result: item.result || item.output || '' };
  }
  if (t === 'response.completed') return { type: 'response.completed', response_id: evt.response?.id };
  if (t === 'hci.session') return { type: 'session', session_id: evt.session_id };
  if (t === 'response.reasoning.delta' || t === 'response.thinking.delta') return { type: 'thinking.delta', delta: evt.delta || evt.text || '' };
  if (t === 'status.update') return { type: 'status', status: evt.status, kind: evt.kind };
  return null;
}

/**
 * Handle WebSocket chat start — proxy Gateway API.
 */
async function handleWsChatStart(socket: HciSocket, msg: any): Promise<void> {
  const { message, profile, session_id, model } = msg;
  if (!message || typeof message !== 'string') { socket.send(JSON.stringify({ type: 'chat.error', error: 'message required' })); return; }

  const gatewayBase = getGatewayBase(profile || 'default');
  if (!gatewayBase) { socket.send(JSON.stringify({ type: 'chat.error', error: 'Gateway API not available for profile: ' + (profile || 'default') })); return; }

  const gatewayBody = { model: model || getDefaultModel(profile || 'default'), input: message, stream: true };
  const gwHeaders: Record<string, string> = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GATEWAY_API_KEY}` };
  if (session_id) gwHeaders['X-Hermes-Session-Id'] = session_id;

  try {
    const gatewayRes = await fetch(`${gatewayBase}/v1/responses`, { method: 'POST', headers: gwHeaders, body: JSON.stringify(gatewayBody) });
    if (!gatewayRes.ok) { const errText = await gatewayRes.text(); socket.send(JSON.stringify({ type: 'chat.error', error: `Gateway ${gatewayRes.status}: ${errText}` })); return; }

    const hermesSessionId = gatewayRes.headers.get('x-hermes-session-id') || '';
    if (hermesSessionId) socket.send(JSON.stringify({ type: 'chat.session', session_id: hermesSessionId }));

    const reader = (gatewayRes.body as any).getReader();
    socket.activeChatReader = reader;
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (socket.readyState !== WebSocket.OPEN) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          const lines = part.split('\n');
          let dataLine = '';
          for (const line of lines) { if (line.startsWith('data: ')) dataLine = line.slice(6); }
          if (!dataLine) continue;
          try {
            const evt = JSON.parse(dataLine);
            const wsEvent = transformGatewayEvent(evt);
            if (wsEvent) socket.send(JSON.stringify({ type: 'chat.event', event: wsEvent }));
          } catch {}
        }
      }
    } catch (pipeErr: any) {
      console.error('[WS Chat] pipe error:', pipeErr.message);
    } finally {
      socket.activeChatReader = null;
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'chat.done' }));
    }
  } catch (e: any) {
    console.error('[WS Chat] error:', e.message);
    socket.send(JSON.stringify({ type: 'chat.error', error: e.message }));
    socket.activeChatReader = null;
  }
}

/**
 * Create and configure the WebSocket server.
 */
export function createWebSocketServer(server: Server): WebSocketServer {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient: (info: any, done: any) => {
      const origin = info.req.headers.origin || '';
      const host = info.req.headers.host || '';
      if (!origin) return done(true);
      const expected = [`http://${host}`, `https://${host}`];
      if (expected.includes(origin)) { done(true); }
      else { log('websocket.rejected', `origin: ${origin}`); done(false, 403, 'Forbidden'); }
    },
  });

  wssInstance = wss;

  wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    const socket = ws as HciSocket;
    socket.authed = isAuthed(req);
    socket.clientId = 'c' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    socket.activeChatReader = null;

    if (!socket.authed) {
      socket.send(JSON.stringify({ type: 'auth-required', message: 'authentication required' }));
      return;
    }

    const state = await buildDashboardState(true);
    socket.send(JSON.stringify({ type: 'snapshot', payload: state }));

    if (terminalSession.buffer) {
      socket.send(JSON.stringify({
        type: 'terminal-transcript',
        buffer: terminalSession.buffer,
        ready: terminalSession.ready,
        cwd: terminalSession.cwd,
        prompt: terminalSession.prompt,
        cols: terminalSession.cols,
        rows: terminalSession.rows,
      }));
    }

    socket.on('message', async (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'ping') socket.send(JSON.stringify({ type: 'pong', ts: Date.now() }));

        if (msg.type === 'terminal-input' && socket.authed) {
          let data = String(msg.data || '');
          if (data.length > 4096) return;
          data = data.replace(/\x1b\[[0-9;]*R/g, '').replace(/;[0-9]+R/g, '');
          if (!data) return;
          const session = ensureTerminalSession();
          if (session.proc) session.proc.write(data);
        }

        if (msg.type === 'terminal-resize' && socket.authed) {
          const cols = Number(msg.cols || 120);
          const rows = Number(msg.rows || 32);
          terminalSession.cols = cols;
          terminalSession.rows = rows;
          if (terminalSession.proc && (terminalSession.proc as any).resize) (terminalSession.proc as any).resize(cols, rows);
        }

        if (msg.type === 'log-start' && socket.authed) startLogStream(msg.logType || 'agent', msg.level || '', socket);
        if (msg.type === 'log-stop' && socket.authed) stopLogStream();

        // Chat via WebSocket (TUI Gateway bridge)
        if (msg.type === 'chat.start' && socket.authed) {
          const bridge = getBridge(msg.profile || 'default');
          if (!bridge.proc) {
            let startErr: any = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
              try { await bridge.start(); startErr = null; break; }
              catch (e: any) { startErr = e; if (attempt < 3) await new Promise(r => setTimeout(r, 500)); }
            }
            if (startErr) { socket.send(JSON.stringify({ type: 'chat.error', error: 'TUI gateway unavailable after 3 retries.' })); return; }
          }
          bridge.addClient(socket);
          socket.tuiBridge = bridge;
          try { const result = await bridge.chatStart(msg); socket.tuiSessionId = result.session_id; }
          catch (err: any) { socket.send(JSON.stringify({ type: 'chat.error', error: err.message })); }
        }

        if (msg.type === 'chat.stop' && socket.authed && socket.tuiBridge) socket.tuiBridge.chatStop(socket.tuiSessionId);
        if (msg.type === 'clarify.respond' && socket.authed && socket.tuiBridge) {
          try { await socket.tuiBridge.respondClarify(msg.request_id, msg.text, msg.choice); }
          catch (err: any) { socket.send(JSON.stringify({ type: 'chat.error', error: err.message })); }
        }
        if (msg.type === 'approval.respond' && socket.authed && socket.tuiBridge) {
          try { await socket.tuiBridge.respondApproval(msg.approve, msg.command); }
          catch (err: any) { socket.send(JSON.stringify({ type: 'chat.error', error: err.message })); }
        }
        if (msg.type === 'sudo.respond' && socket.authed && socket.tuiBridge) {
          try { await socket.tuiBridge.respondSudo(msg.request_id, msg.password); }
          catch (err: any) { socket.send(JSON.stringify({ type: 'chat.error', error: err.message })); }
        }
        if (msg.type === 'secret.respond' && socket.authed && socket.tuiBridge) {
          try { await socket.tuiBridge.respondSecret(msg.request_id, msg.value); }
          catch (err: any) { socket.send(JSON.stringify({ type: 'chat.error', error: err.message })); }
        }
      } catch {}
    });

    socket.on('close', () => {
      if (socket.tuiBridge) { socket.tuiBridge.removeClient(socket); socket.tuiBridge = null; }
      if (socket.activeChatReader) { socket.activeChatReader.cancel().catch(() => {}); socket.activeChatReader = null; }
    });
  });

  // System metrics broadcast every 5s
  setInterval(() => { broadcastToClients({ type: 'system-metrics', payload: getSystem() }); }, 5000);

  console.log('[WS] WebSocket server created at /ws');
  return wss;
}

export { killAllBridges };
export default createWebSocketServer;
