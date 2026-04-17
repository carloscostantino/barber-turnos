import express from 'express';
import cors from 'cors';
import { env } from './env';
import { pool } from './db';
import { router } from './routes';
import { startReminderScheduler } from './reminders';
import { handleStripeWebhook } from './stripeWebhook';

const app = express();

app.use(
  cors({
    origin: env.CLIENT_ORIGIN,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);
/** Stripe requiere el body sin parsear JSON para verificar la firma. */
app.post(
  '/api/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    void handleStripeWebhook(req, res);
  },
);
app.use(express.json());

app.get('/health', async (_req, res) => {
  const result = await pool.query('select 1 as ok');
  res.json({ ok: true, db: result.rows[0]?.ok === 1 });
});

app.use('/api', router);

app.listen(env.PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`API escuchando en http://0.0.0.0:${env.PORT}`);
  startReminderScheduler();
});

