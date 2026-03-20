import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3001),
  CLIENT_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  TIMEZONE: z.string().min(1).default('America/Argentina/Buenos_Aires'),
  /** Secreto para firmar JWT del panel admin (mín. 16 caracteres). */
  JWT_SECRET: z.string().min(16),
  /** Contraseña del panel admin (comparación en tiempo constante cuando coincide el largo). */
  ADMIN_PASSWORD: z.string().min(8),
});

export const env = EnvSchema.parse(process.env);

