/**
 * Auth routes — login, logout, setup, user management, audit, notifications.
 */
import { Router } from 'express';
import { requireAuth, requireCsrf, requireRole, requirePerm, getCurrentUser, createAuthToken, parseCookies, deriveCsrfToken, setAuthCookie, clearAuthCookie, getClientIp, isAuthed } from '../middleware/auth';
import { loginRateLimiter } from '../middleware/rate-limit';
import { AUTH_COOKIE, HCI_IDENTITY, tokenToUser } from '../state';
import type { HciRequest } from '../types';

const authModule = require('../../auth');

const router = Router();

// Check auth session status
router.get('/session', (req: any, res) => {
  const authed = isAuthed(req);
  const response: any = { authenticated: authed, passwordRequired: true, identity: HCI_IDENTITY };
  if (authed) {
    const cookies = parseCookies(req);
    response.csrfToken = deriveCsrfToken(cookies[AUTH_COOKIE]);
  }
  res.json(response);
});

// Current user info
router.get('/auth/me', (req: any, res) => {
  const user = getCurrentUser(req);
  if (!user) return res.status(401).json({ ok: false });
  const cookies = parseCookies(req);
  const csrfToken = deriveCsrfToken(cookies[AUTH_COOKIE]);
  res.json({ ok: true, user: { username: user.username, role: user.role, permissions: user.permissions }, csrfToken });
});

// Auth status (first-run check)
router.get('/auth/status', (req, res) => {
  try {
    const users = authModule.listUsers();
    res.json({ ok: true, first_run: users.length === 0, user_count: users.length });
  } catch (e) {
    res.json({ ok: true, first_run: true, user_count: 0 });
  }
});

// First-run setup
router.post('/auth/setup', loginRateLimiter, (req: any, res) => {
  if (!authModule.isFirstRun()) {
    return res.status(400).json({ ok: false, error: 'Setup already completed' });
  }
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, error: 'Username and password required' });
  if (!authModule.sanitizeUsername(username)) return res.status(400).json({ ok: false, error: 'Invalid username (2-32 chars, alphanumeric/_.- only)' });
  if (password.length < 8) return res.status(400).json({ ok: false, error: 'Password must be at least 8 characters' });

  const result = authModule.createUser(username, password, 'admin');
  if (!result.ok) return res.status(400).json(result);

  const authToken = createAuthToken(username, 'admin', authModule.PRESET_PERMISSIONS.admin);
  setAuthCookie(res, authToken);
  authModule.audit(username, 'admin', 'SETUP', 'first-run admin created');
  authModule.addNotification('success', `Admin account created: ${username}`);
  const csrfToken = deriveCsrfToken(authToken);
  res.json({ ok: true, user: { username, role: 'admin' }, csrfToken });
});

// Login
router.post('/auth/login', loginRateLimiter, (req: any, res) => {
  const ip = getClientIp(req);
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, error: 'Username and password required' });
  if (!authModule.sanitizeUsername(username)) return res.status(400).json({ ok: false, error: 'Invalid username' });
  if (authModule.isFirstRun()) return res.status(400).json({ ok: false, error: 'first_run', message: 'No users exist. Please create an admin account.' });

  const user = authModule.verifyUserPassword(username, password);
  if (!user) {
    authModule.audit(username, 'unknown', 'LOGIN_FAILED', `bad credentials from ${ip}`);
    return res.status(401).json({ ok: false, error: 'Invalid username or password' });
  }

  const authToken = createAuthToken(user.username, user.role, user.permissions);
  setAuthCookie(res, authToken);
  authModule.audit(user.username, user.role, 'LOGIN', `success from ${ip}`);
  const csrfToken = deriveCsrfToken(authToken);
  res.json({ ok: true, user: { username: user.username, role: user.role, permissions: user.permissions }, csrfToken });
});

// Logout
router.post('/auth/logout', requireAuth, requireCsrf, (req: any, res) => {
  const user = getCurrentUser(req);
  const cookies = parseCookies(req);
  const token = cookies[AUTH_COOKIE];
  if (token) tokenToUser.delete(token);
  clearAuthCookie(res);
  if (user) authModule.audit(user.username, user.role, 'LOGOUT', '');
  res.json({ ok: true });
});

// Change password
router.post('/auth/change-password', requireAuth, requireCsrf, (req: any, res) => {
  const user = getCurrentUser(req);
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) return res.status(400).json({ ok: false, error: 'Current and new password required' });
  const result = authModule.changePassword(user!.username, current_password, new_password);
  if (!result.ok) return res.status(400).json(result);
  res.json({ ok: true });
});

// Auth providers
router.get('/auth/providers', requireRole('admin'), async (req: any, res) => {
  const { shell } = require('../services/shell');
  try {
    const raw = await shell('hermes auth list 2>&1');
    const lines = raw.split('\n').filter(Boolean);
    const providers: any[] = [];
    for (const line of lines) {
      const match = line.match(/(✓|✗|●|○)\s*(\w+)\s*(set|not set)/i);
      if (match) providers.push({ name: match[2], set: match[3] === 'set' });
    }
    if (providers.length === 0) {
      const knownProviders = ['openrouter', 'anthropic', 'nous', 'openai', 'google', 'openai-codex', 'firecrawl', 'tavily'];
      for (const p of knownProviders) {
        if (raw.toLowerCase().includes(p)) providers.push({ name: p, set: raw.includes(p) && !raw.includes(`${p}\nnot set`) });
      }
    }
    res.json({ ok: true, providers });
  } catch (e) {
    res.json({ ok: true, providers: [] });
  }
});

// ── User Management ──

router.get('/users', requireRole('admin'), (req, res) => {
  res.json({ ok: true, users: authModule.listUsers() });
});

router.post('/users', requireRole('admin'), requireCsrf, (req: any, res) => {
  const { username, password, role, permissions } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, error: 'Username and password required' });
  if (!authModule.sanitizeUsername(username)) return res.status(400).json({ ok: false, error: 'Invalid username (2-32 chars, alphanumeric/_.- only)' });
  if (password.length < 8) return res.status(400).json({ ok: false, error: 'Password must be at least 8 characters' });
  const userRole = ['admin', 'viewer', 'custom'].includes(role) ? role : 'viewer';
  const result = authModule.createUser(username, password, userRole, userRole === 'custom' ? permissions : null);
  if (!result.ok) return res.status(400).json(result);
  authModule.addNotification('success', `User created: ${username} (${userRole})`);
  res.json({ ok: true });
});

router.put('/users/:username', requireRole('admin'), requireCsrf, (req: any, res) => {
  const { role, permissions } = req.body || {};
  const userRole = ['admin', 'viewer', 'custom'].includes(role) ? role : 'viewer';
  const result = authModule.updateUserPermissions(req.params.username, userRole, userRole === 'custom' ? permissions : null);
  if (!result.ok) return res.status(400).json(result);
  res.json({ ok: true });
});

router.get('/permissions', requireAuth, (req, res) => {
  res.json({ ok: true, permissions: authModule.PERMISSIONS, presets: authModule.PRESET_PERMISSIONS });
});

router.delete('/users/:username', requireRole('admin'), requireCsrf, (req: any, res) => {
  const currentUser = getCurrentUser(req);
  const result = authModule.deleteUser(req.params.username, currentUser!.username);
  if (!result.ok) return res.status(400).json(result);
  authModule.addNotification('info', `User deleted: ${req.params.username}`);
  res.json({ ok: true });
});

router.post('/users/:username/reset-password', requireRole('admin'), requireCsrf, (req: any, res) => {
  const currentUser = getCurrentUser(req);
  const { new_password } = req.body || {};
  if (!new_password) return res.status(400).json({ ok: false, error: 'New password required' });
  const result = authModule.resetUserPassword(req.params.username, new_password, currentUser!.username);
  if (!result.ok) return res.status(400).json(result);
  authModule.addNotification('info', `Password reset for ${req.params.username}`);
  res.json({ ok: true });
});

// ── Audit & Notifications ──

router.get('/audit', requireRole('admin'), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string || '100', 10), 500);
  res.json({ ok: true, entries: authModule.getAuditLog(limit) });
});

router.get('/notifications', requireAuth, (req, res) => {
  res.json({ ok: true, notifications: authModule.loadNotifications() });
});

router.post('/notifications/:id/dismiss', requireAuth, requireCsrf, (req: any, res) => {
  const id = req.params.id || req.body?.id;
  if (id) authModule.dismissNotification(id);
  res.json({ ok: true });
});

router.post('/notifications/dismiss', requireAuth, requireCsrf, (req: any, res) => {
  const id = req.body?.id;
  if (id) authModule.dismissNotification(id);
  res.json({ ok: true });
});

router.post('/notifications/clear', requireAuth, requireCsrf, (req, res) => {
  authModule.clearNotifications();
  res.json({ ok: true });
});

export default router;
