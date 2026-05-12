/**
 * Shell execution utilities — async wrappers around child_process.
 */
import { execFile } from 'child_process';

// Strip ANSI escape codes (SGR sequences like \x1b[...m) from text
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\r/g;
export function stripAnsi(text: string): string {
  return String(text).replace(ANSI_RE, '');
}

export function parseShellTimeout(value: string | number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value || '8s').trim();
  const match = raw.match(/^(\d+)(ms|s|m)?$/i);
  if (!match) return 8000;
  const amount = Number(match[1]);
  const unit = (match[2] || 'ms').toLowerCase();
  if (unit === 'm') return amount * 60_000;
  if (unit === 's') return amount * 1_000;
  return amount;
}

/**
 * Run a shell command via bash and return its output.
 */
export function shell(cmd: string, timeout: string | number = '8s'): Promise<string> {
  return new Promise((resolve) => {
    execFile('bash', ['-lc', `${cmd} 2>&1`], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024,
      timeout: parseShellTimeout(timeout),
    }, (err, stdout, stderr) => {
      resolve((stdout || stderr || '').trim());
    });
  });
}

/**
 * Safer execution — no bash interpretation, direct args.
 * Optional stdin: pipe data to the process (e.g. 'y' for confirmation prompts).
 */
export function execHermes(args: string[], timeout = 30000, stdin: string | null = null): Promise<string> {
  return new Promise((resolve) => {
    const proc = execFile('hermes', args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024,
      timeout,
    }, (err, stdout, stderr) => {
      // stderr often contains real error messages hermes doesn't write to stdout
      const output = err ? (stdout + '\n' + stderr) : stdout;
      resolve(output);
    });
    if (stdin && proc.stdin) {
      proc.stdin.write(stdin);
      proc.stdin.end();
    }
  });
}
