/**
 * Rate limiting middleware.
 */
import type { Response, NextFunction } from 'express';
import type { HciRequest } from '../types';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

function createRateLimiter(windowMs: number, maxRequests: number, message: string) {
  const store = new Map<string, RateLimitEntry>();

  // Clean up old entries every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now > entry.resetAt) store.delete(key);
    }
  }, 5 * 60 * 1000).unref();

  return (req: HciRequest, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = store.get(ip);

    if (!entry || now > entry.resetAt) {
      store.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count++;
    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      res.status(429).json({ error: message, retryAfter });
      return;
    }

    next();
  };
}

// 5 login attempts per 15 minutes
export const loginRateLimiter = createRateLimiter(
  15 * 60 * 1000,
  5,
  'Too many login attempts — try again in 15 minutes'
);

// 30 terminal commands per minute
export const terminalRateLimiter = createRateLimiter(
  60 * 1000,
  30,
  'Terminal rate limit exceeded — wait a moment'
);
