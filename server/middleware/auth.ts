/**
 * Authentication and authorization middleware.
 * Stateless HMAC tokens with embedded user payloads.
 */
import crypto from 'crypto';
import type { Response, NextFunction } from 'express';
import type { HciRequest, HciUser } from '../types';
import { CONTROL_SECRET, AUTH_COOKIE, tokenToUser, cfg } from '../state';

const authModule = require('../../auth');

// ── Crypto helpers ──

export function hmac(value: string): string {
  return crypto.createHmac('sha256', CONTROL_SECRET).update(value).digest('hex');
}

export function deriveCsrfToken(authToken: string): string {
  return hmac('csrf:' + authToken);
}

export function safeTimingEqual(a: string, b: string): boolean {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// ── Cookie parsing ──

export function parseCookies(req: HciRequest): Record<string, string> {
  const raw = req.headers.cookie || '';
  return raw.split(';').reduce((acc: Record<string, string>, pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return acc;
    const key = pair.slice(0, idx).trim();
    const value = decodeURIComponent(pair.slice(idx + 1).trim());
    acc[key] = value;
    return acc;
  }, {});
}

// ── Token management ──

export function createAuthToken(username: string, role: string, permissions?: Record<string, boolean>): string {
  const ts = String(Date.now());
  const payload = Buffer.from(JSON.stringify({ username, role, permissions })).toString('base64url');
  const sig = hmac(ts + '.' + payload);
  const token = ts + '.' + payload + '.' + sig;
  tokenToUser.set(token, { username, role, permissions });
  return token;
}

export function parseAndValidateToken(token: string): HciUser | null {
  const firstDot = token.indexOf('.');
  if (firstDot === -1) return null;
  const lastDot = token.lastIndexOf('.');
  if (lastDot === firstDot) return null; // Old format — no user payload
  const ts = token.substring(0, firstDot);
  const payload = token.substring(firstDot + 1, lastDot);
  const sig = token.substring(lastDot + 1);
  if (Date.now() - Number(ts) > 24 * 60 * 60 * 1000) return null;
  if (hmac(ts + '.' + payload) !== sig) return null;
  try {
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    const user = JSON.parse(json);
    if (!user.username || !user.role) return null;
    const stored = authModule.findUser(user.username);
    if (!stored) return null;
    return { username: stored.username, role: stored.role, permissions: stored.permissions };
  } catch {
    return null;
  }
}

export function verifyAuthToken(token: string): boolean {
  if (!token || typeof token !== 'string') return false;
  const [ts, sig] = token.split('.');
  if (!ts || !sig) return false;
  if (Date.now() - Number(ts) > 24 * 60 * 60 * 1000) return false;
  return safeTimingEqual(sig, hmac(ts));
}

export function verifyCsrfToken(req: HciRequest): boolean {
  const headerToken = req.headers['x-csrf-token'] as string;
  if (!headerToken) return false;
  const cookies = parseCookies(req);
  const authToken = cookies[AUTH_COOKIE];
  if (!authToken) return false;
  const expected = deriveCsrfToken(authToken);
  return safeTimingEqual(headerToken, expected);
}

// ── User resolution ──

export function getCurrentUser(req: HciRequest): HciUser | null {
  const cookies = parseCookies(req);
  const token = cookies[AUTH_COOKIE];
  if (!token) return null;
  // Check cache first
  const cached = tokenToUser.get(token);
  if (cached) {
    req.hciUser = cached as HciUser;
    return cached as HciUser;
  }
  // Validate stateless token and cache on success
  const user = parseAndValidateToken(token);
  if (user) {
    tokenToUser.set(token, user);
    req.hciUser = user;
    return user;
  }
  return null;
}

export function isAuthed(req: HciRequest): boolean {
  return getCurrentUser(req) !== null;
}

// ── Cookie setters ──

export function setAuthCookie(res: Response, token: string): void {
  const maxAge = cfg.session.cookieMaxAge;
  const secure = cfg.session.secure !== null
    ? cfg.session.secure
    : (res as any).req?.secure || (res as any).req?.get?.('X-Forwarded-Proto') === 'https';
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
}

export function clearAuthCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

// ── IP helper ──

export function getClientIp(req: HciRequest): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.socket.remoteAddress
    || 'unknown';
}

// ── Middleware ──

export function requireAuth(req: HciRequest, res: Response, next: NextFunction): void {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: 'authentication required' });
}

export function requireCsrf(req: HciRequest, res: Response, next: NextFunction): void {
  if (verifyCsrfToken(req)) return next();
  res.status(403).json({ error: 'invalid CSRF token' });
}

export function requireRole(role: string) {
  return (req: HciRequest, res: Response, next: NextFunction): void => {
    const user = getCurrentUser(req);
    if (!user) { res.status(401).json({ error: 'authentication required' }); return; }
    if (role === 'admin' && user.role !== 'admin') {
      authModule.audit(user.username, user.role, 'DENIED', `${req.method} ${req.path}`);
      res.status(403).json({ error: 'admin access required' });
      return;
    }
    req.hciUser = user;
    next();
  };
}

export function requirePerm(...perms: string[]) {
  return (req: HciRequest, res: Response, next: NextFunction): void => {
    const user = getCurrentUser(req);
    if (!user) { res.status(401).json({ error: 'authentication required' }); return; }
    if (user.role === 'admin') { req.hciUser = user; return next(); }
    const userPerms = user.permissions || {};
    const hasAll = perms.every(p => (userPerms as any)[p]);
    if (!hasAll) {
      authModule.audit(user.username, user.role, 'DENIED', `${req.method} ${req.path} (need: ${perms.join(',')})`);
      res.status(403).json({ error: `permission required: ${perms.join(', ')}` });
      return;
    }
    req.hciUser = user;
    next();
  };
}

// ── Token cleanup (every 15 minutes) ──

export function startTokenCleanup(): void {
  setInterval(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [k] of tokenToUser) {
      const [t] = k.split('.');
      if (Number(t) < cutoff) tokenToUser.delete(k);
    }
  }, 15 * 60 * 1000).unref();
}
