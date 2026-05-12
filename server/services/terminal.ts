/**
 * Terminal PTY session management.
 */
import os from 'os';
import { terminalSession, PROJECT_ROOT, CONTROL_HOME, HCI_IDENTITY } from '../state';

let pty: any;
try {
  pty = require('node-pty');
} catch {
  console.warn('[HCI] node-pty not available — terminal disabled');
}

let broadcastFn: ((msg: any) => void) | null = null;

export function setTerminalBroadcast(fn: (msg: any) => void): void {
  broadcastFn = fn;
}

export function trimTerminalBuffer(text: string, limit = 50000): string {
  const raw = String(text || '');
  return raw.length > limit ? raw.slice(raw.length - limit) : raw;
}

export function appendTerminalOutput(chunk: any): void {
  let raw = String(chunk || '');
  if (!raw) return;
  // Strip cursor position report (CPR) responses
  raw = raw.replace(/\x1b\[[0-9;]*R/g, '');
  if (!raw) return;
  terminalSession.buffer = trimTerminalBuffer(terminalSession.buffer + raw);
  if (broadcastFn) {
    broadcastFn({
      type: 'terminal-output',
      chunk: raw,
      buffer: terminalSession.buffer,
      ready: terminalSession.ready,
      cwd: terminalSession.cwd,
      prompt: terminalSession.prompt,
    });
  }
}

export function ensureTerminalSession(): typeof terminalSession {
  if (terminalSession.proc && terminalSession.ready) return terminalSession;
  if (terminalSession._spawnFailed) return terminalSession;
  if (!pty) {
    terminalSession._spawnFailed = true;
    terminalSession.lastError = 'PTY unavailable: node-pty not installed';
    return terminalSession;
  }

  const REAL_HOME = os.homedir();
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    HOME: REAL_HOME,
    USER: REAL_HOME.split('/').pop() || 'root',
    LOGNAME: REAL_HOME.split('/').pop() || 'root',
    SHELL: '/bin/bash',
    TERM: 'xterm-256color',
    HERMES_HOME: CONTROL_HOME,
    HISTFILE: '/dev/null',
    PROMPT_COMMAND: '',
    PS1: terminalSession.prompt,
    PATH: process.env.PATH || '',
  };

  let proc: any;
  try {
    proc = pty.spawn('bash', ['--noprofile', '--norc', '-i'], {
      cwd: PROJECT_ROOT,
      env,
      cols: terminalSession.cols,
      rows: terminalSession.rows,
      name: 'xterm-256color',
    });
  } catch (e: any) {
    console.error('[HCI] PTY spawn failed — terminal disabled:', e.message);
    terminalSession._spawnFailed = true;
    terminalSession.lastError = 'PTY unavailable: ' + e.message;
    terminalSession.buffer = '';
    return terminalSession;
  }

  terminalSession.proc = proc;
  terminalSession.startedAt = Date.now();
  terminalSession.ready = true;
  terminalSession.lastError = null;
  terminalSession.buffer = '';

  proc.onData((data: string) => appendTerminalOutput(data));
  proc.onExit(({ exitCode, signal }: { exitCode: number; signal: string }) => {
    terminalSession.ready = false;
    terminalSession.lastError = `terminal exited ${signal || exitCode}`;
    appendTerminalOutput(`\r\n[terminal exited ${signal || exitCode}]\r\n`);
    terminalSession.proc = null;
  });

  setTimeout(() => {
    if (terminalSession.proc) {
      terminalSession.proc.write('\x13'); // Ctrl+S — stop output
      terminalSession.proc.write(`export PS1='${terminalSession.prompt.replaceAll("'", "'\\''")}' && cd ${PROJECT_ROOT}\r`);
      terminalSession.proc.write('\x11'); // Ctrl+Q — resume output
    }
  }, 100);

  return terminalSession;
}

export function sendTerminalInput(command: string): { ok: boolean; queued: boolean } {
  let text = String(command || '').replace(/\n+$/g, '');
  text = text.replace(/\x1b\[[0-9;]*R/g, '').replace(/;[0-9]+R/g, '');
  if (!text.trim()) return { ok: true, queued: false };
  const session = ensureTerminalSession();
  if (!session.proc) throw new Error('terminal not ready');
  session.proc.write(`${text}\r`);
  return { ok: true, queued: true };
}
