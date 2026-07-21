import path from 'path';
import express from 'express';
import cookieParser from 'cookie-parser';
import cookieSession from 'cookie-session';
import { config } from './config';
import { ensureSchema } from './db';
import { creditsRouter } from './routes/credits';
import { lookupRouter } from './routes/lookup';
import { adminRouter } from './routes/admin';
import { shopifyWebhookRouter } from './routes/shopifyWebhook';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  app.use(async (_req, _res, next) => {
    try {
      await ensureSchema();
      next();
    } catch (err) {
      next(err);
    }
  });

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(
    cookieSession({
      name: 'vrm_admin',
      keys: [config.sessionSecret],
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: config.isProd,
      sameSite: 'lax',
    })
  );

  const publicDir = path.join(process.cwd(), 'public');
  app.use(express.static(publicDir));

  app.get('/api/config', (_req, res) => {
    res.json({ buyCreditsUrl: config.buyCreditsUrl });
  });

  app.use('/api/webhooks/shopify', shopifyWebhookRouter);
  app.use('/api/credits', creditsRouter);
  app.use('/api/lookup', lookupRouter);
  app.use('/api/admin', adminRouter);

  app.get('/', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.get('/admin', (_req, res) => {
    res.sendFile(path.join(publicDir, 'admin.html'));
  });

  app.use(
    (
      err: Error & { status?: number; statusCode?: number; type?: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      const status = err.status || err.statusCode || 500;
      if (err.type === 'entity.parse.failed' || status === 400) {
        res.status(400).json({ error: 'Invalid request body' });
        return;
      }
      console.error(err);
      res.status(status >= 400 && status < 600 ? status : 500).json({
        error: status === 401 ? 'Unauthorized' : 'Internal server error',
      });
    }
  );

  return app;
}
