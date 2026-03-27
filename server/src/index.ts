import express from 'express';
import cors from 'cors';
import { env } from './env';
import { pool } from './db';
import { router } from './routes';
import { startReminderScheduler } from './reminders';

const app = express();

app.use(
  cors({
    origin: env.CLIENT_ORIGIN,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);
app.use(express.json());

app.get('/health', async (_req, res) => {
  const result = await pool.query('select 1 as ok');
  res.json({ ok: true, db: result.rows[0]?.ok === 1 });
});

app.use('/api', router);

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API escuchando en http://localhost:${env.PORT}`);
  startReminderScheduler();
});

