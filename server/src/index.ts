import express from 'express';
import cors from 'cors';
import { env } from './env';
import { pool } from './db';
import { router } from './routes';
import { startReminderScheduler } from './reminders';
import { startTrialScheduler } from './trialJob';
import { startPriceChangeScheduler } from './priceChangeJob';
import { handleMpWebhook } from './mercadopagoWebhook';

const app = express();

if (env.TRUST_PROXY) {
  app.set('trust proxy', 1);
}

app.use(
  cors({
    origin: env.corsAllowedOrigins,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);
app.use(express.json());

/**
 * Webhook de Mercado Pago. MP firma `id + request-id + ts` (no el body), así
 * que no necesitamos raw body — usamos el mismo parser JSON global.
 */
app.post('/api/webhooks/mercadopago', (req, res) => {
  void handleMpWebhook(req, res);
});

app.get('/health', async (_req, res) => {
  const result = await pool.query('select 1 as ok');
  res.json({ ok: true, db: result.rows[0]?.ok === 1 });
});

app.use('/api', router);

app.listen(env.PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`API escuchando en http://0.0.0.0:${env.PORT}`);
  startReminderScheduler();
  startTrialScheduler();
  startPriceChangeScheduler();
});

