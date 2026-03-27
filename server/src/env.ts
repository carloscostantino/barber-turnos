import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/** Hash bcrypt (60 caracteres, formato $2a$/$2b$/$2y$). */
const bcryptHash = z
  .string()
  .min(1)
  .regex(/^\$2[aby]\$\d{2}\$.{53}$/, 'formato bcrypt inválido');

const EnvSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    PORT: z.coerce.number().int().positive().default(3001),
    CLIENT_ORIGIN: z.string().min(1).default('http://localhost:5173'),
    TIMEZONE: z.string().min(1).default('America/Argentina/Buenos_Aires'),
    /** Secreto para firmar JWT del panel admin (mín. 16 caracteres). */
    JWT_SECRET: z.string().min(16),
    /**
     * Contraseña del panel admin en texto plano (solo desarrollo local).
     * En producción usá `ADMIN_PASSWORD_BCRYPT` y no definas esta variable.
     */
    ADMIN_PASSWORD: z.string().min(8).optional(),
    /**
     * Hash bcrypt de la contraseña del admin (recomendado en producción).
     * Mutuamente excluyente con `ADMIN_PASSWORD`. Generar: `npm run hash-admin-password`.
     */
    ADMIN_PASSWORD_BCRYPT: bcryptHash.optional(),
    /**
     * Número de WhatsApp del negocio (solo dígitos, código país sin +).
     * Si está definido, el frontend puede ofrecer enlace wa.me tras reservar.
     */
    WHATSAPP_NUMBER: z
      .string()
      .regex(/^\d{8,20}$/, 'usá solo dígitos, código país sin + ni espacios')
      .optional(),
    /** Si definís SMTP, usá también SMTP_USER, SMTP_PASS y MAIL_FROM (recordatorios por email). */
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASS: z.string().optional(),
    /** Remitente (ej. "Barbería <info@dominio.com>" o solo el email). */
    MAIL_FROM: z.string().min(1).optional(),
    /** Horas antes del turno para enviar el recordatorio (ventana ±45 min). */
    REMINDER_HOURS_BEFORE: z.coerce.number().positive().default(24),
    /** Cada cuántos minutos se evalúan candidatos a recordatorio. */
    REMINDER_POLL_MINUTES: z.coerce.number().int().positive().max(120).default(15),
  })
  .superRefine((data, ctx) => {
    const hasBcrypt = Boolean(data.ADMIN_PASSWORD_BCRYPT);
    const hasPlain = Boolean(data.ADMIN_PASSWORD);
    if (hasBcrypt === hasPlain) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Definí exactamente una de ADMIN_PASSWORD_BCRYPT (hash bcrypt) o ADMIN_PASSWORD (texto plano, p. ej. desarrollo)',
        path: ['ADMIN_PASSWORD_BCRYPT'],
      });
    }
    const smtpOn = Boolean(data.SMTP_HOST);
    if (smtpOn) {
      if (!data.SMTP_USER || !data.MAIL_FROM) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Con SMTP_HOST definí SMTP_USER, SMTP_PASS y MAIL_FROM',
          path: ['SMTP_HOST'],
        });
      }
      if (data.SMTP_PASS === undefined || data.SMTP_PASS.length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'SMTP_PASS es obligatorio cuando configurás SMTP',
          path: ['SMTP_PASS'],
        });
      }
    }
  });

export const env = EnvSchema.parse(process.env);

export function isSmtpConfigured(): boolean {
  return Boolean(
    env.SMTP_HOST &&
      env.SMTP_USER &&
      env.SMTP_PASS &&
      env.SMTP_PASS.length > 0 &&
      env.MAIL_FROM,
  );
}

