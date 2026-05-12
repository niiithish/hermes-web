/**
 * HCI Backend — Entry Point
 *
 * Modular TypeScript entry point replacing server.js.
 * All routes are loaded from server/routes/*.
 */
require('dotenv').config();

import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { createApp } from './app';
import { PORT, cfg, PROJECT_ROOT } from './state';
import { startTokenCleanup } from './middleware/auth';
import { initGatewayDiscovery } from './services/gateway-discovery';
import { setTerminalBroadcast } from './services/terminal';
import { createWebSocketServer, killAllBridges, broadcastToClients } from './websocket/index';

// Route modules
import authRoutes from './routes/auth';
import systemRoutes from './routes/system';
import sessionRoutes from './routes/sessions';
import kanbanRoutes from './routes/kanban';
import profileRoutes from './routes/profiles';
import chatRoutes from './routes/chat';
import gatewayRoutes from './routes/gateway';
import usageRoutes from './routes/usage';
import hciUpdateRoutes from './routes/hci-update';
import filesRoutes from './routes/files';
import terminalRoutes from './routes/terminal';
import configRoutes from './routes/config';
import skillsRoutes from './routes/skills';
import cronRoutes from './routes/cron';
import layoutRoutes from './routes/layout';
import miscRoutes from './routes/misc';

// ── Create Express app ──
const app = createApp();

// ── Mount modular routes ──
app.use('/api', authRoutes);
app.use('/api', systemRoutes);
app.use('/api', sessionRoutes);
app.use('/api', kanbanRoutes);
app.use('/api', profileRoutes);
app.use('/api', chatRoutes);
app.use('/api', gatewayRoutes);
app.use('/api', usageRoutes);
app.use('/api', hciUpdateRoutes);
app.use('/api', filesRoutes);
app.use('/api', terminalRoutes);
app.use('/api', configRoutes);
app.use('/api', skillsRoutes);
app.use('/api', cronRoutes);
app.use('/api', layoutRoutes);
app.use('/api', miscRoutes);

// ── SPA fallback ──
app.get('{*path}', (req, res) => {
  const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Not found. Run `npm run build` to generate the frontend.' });
  }
});

// ── Create HTTP/HTTPS server ──
let server: http.Server | https.Server;

if (cfg.ssl.certFile && cfg.ssl.keyFile) {
  try {
    const cert = fs.readFileSync(cfg.ssl.certFile);
    const key = fs.readFileSync(cfg.ssl.keyFile);
    server = https.createServer({ cert, key }, app);
    console.log('[HCI] HTTPS enabled');
  } catch (e: any) {
    console.warn('[HCI] SSL cert/key failed, falling back to HTTP:', e.message);
    server = http.createServer(app);
  }
} else {
  server = http.createServer(app);
}

// ── Initialize services ──
initGatewayDiscovery();
startTokenCleanup();

// ── Create WebSocket server ──
const wss = createWebSocketServer(server);

// ── Wire terminal broadcast to WebSocket ──
setTerminalBroadcast(broadcastToClients);

// ── Start server ──
server.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║   Hermes Control Interface (TypeScript)  ║`);
  console.log(`  ║   http://localhost:${PORT}                 ║`);
  console.log(`  ╚══════════════════════════════════════════╝\n`);
});

// ── Graceful shutdown ──
function shutdown(signal: string): void {
  console.log(`\n[HCI] ${signal} received, shutting down...`);
  // Kill TUI bridges
  killAllBridges();
  // Kill terminal PTY
  const { terminalSession } = require('./state');
  if (terminalSession.proc) try { terminalSession.proc.kill(); } catch {}
  // Close WebSocket connections
  for (const client of wss.clients) {
    try { client.close(1001, 'server shutting down'); } catch {}
  }
  server.close(() => {
    console.log('[HCI] Server closed');
    process.exit(0);
  });
  setTimeout(() => { console.error('[HCI] Forced shutdown'); process.exit(1); }, 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app, server };
