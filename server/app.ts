/**
 * Express app setup — middleware, static files, security headers.
 */
import express from 'express';
import helmet from 'helmet';
import path from 'path';

export function createApp(): express.Express {
  const app = express();

  // Security headers via helmet — active in production, skipped in development.
  if (process.env.NODE_ENV !== 'development') {
    app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
          scriptSrcAttr: ["'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "blob:", "https://portal.nousresearch.com"],
          connectSrc: ["'self'", "ws:", "wss:"],
          upgradeInsecureRequests: null,
        },
      },
      hsts: false,
    }));
  }

  app.use(express.json({ limit: '1mb' }));

  // Vite-built assets — cache aggressively
  app.use(express.static(path.join(__dirname, '..', 'dist'), {
    maxAge: '365d',
    immutable: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    },
  }));

  // API responses never cached
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

  // Vendor static routes
  app.use('/vendor/xterm', express.static(path.join(__dirname, '..', 'node_modules/@xterm/xterm'), { maxAge: '30d' }));
  app.use('/vendor/xterm-addon-fit', express.static(path.join(__dirname, '..', 'node_modules/@xterm/addon-fit'), { maxAge: '30d' }));

  return app;
}

export default createApp;
