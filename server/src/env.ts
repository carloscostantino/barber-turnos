import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/** Hash bcrypt (60 caracteres, formato $2a$/$2b$/$2y$). */
const bcryptHash = z
  .string()
  .min(1)
  .regex(/^\$2[aby]\$\d{2}\$.{53}$/, 'formato bcrypt inválido');

function splitCommaList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const EnvSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    PORT: z.coerce.number().int().positive().default(3001),
    /**
     * Detrás de reverse proxy (Caddy, Nginx): `1` o `true` para que Express
     * use X-Forwarded-For y el rate limiting vea la IP del cliente.
     */
    TRUST_PROXY: z.preprocess(
      (v) => v === '1' || v === 'true' || v === true,
      z.boolean().default(false),
    ),
    CLIENT_ORIGIN: z.string().min(1).default('http://localhost:5173'),
    /**
     * Orígenes extra permitidos por CORS (coma-separados, sin espacios raros).
     * Útil con ngrok: el navegador envía Origin `https://xxx.ngrok-free.dev`
     * pero los enlaces del servidor siguen usando `CLIENT_ORIGIN` (localhost).
     */
    CORS_ALLOWED_ORIGINS: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().optional(),
    ),
    TIMEZONE: z.string().min(1).default('America/Argentina/Buenos_Aires'),
    /** Slug del shop usado en rutas legacy sin `/shops/:slug` (migración multi-tenant). */
    DEFAULT_SHOP_SLUG: z.string().min(1).default('default'),
    /**
     * Access token de Mercado Pago (sandbox o prod). Opcional: si no está
     * definido, los endpoints de billing responden 501 pero el resto del sistema
     * sigue funcionando (útil en desarrollo/CI local).
     */
    MP_ACCESS_TOKEN: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().min(1).optional(),
    ),
    /** Secreto para validar la firma HMAC (`x-signature`) de los webhooks de MP. */
    MP_WEBHOOK_SECRET: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().min(1).optional(),
    ),
    /** Monto mensual a cobrar en ARS (entero, sin centavos, p. ej. 4999). */
    MP_SUBSCRIPTION_AMOUNT_ARS: z.coerce.number().positive().default(4999),
    /** Texto que MP muestra al cliente en el flujo de tarjeta. */
    MP_SUBSCRIPTION_REASON: z.string().min(1).default('Suscripción Barber Turnos'),
    /**
     * Override solo para E2E: fuerza el estado que `getPreapprovalStatus`
     * retornaría sin llamar a MP. Valores: authorized | paused | cancelled |
     * pending. Si está vacío o no coincide, se hace la llamada real a MP.
     */
    MP_MOCK_PREAPPROVAL_STATUS: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.enum(['authorized', 'paused', 'cancelled', 'pending']).optional(),
    ),
    /**
     * Base pública del frontend (sin / final) solo para el `back_url` que MP
     * exige al crear el preapproval. Si MP responde "Invalid value for back_url",
     * exponé el Vite con ngrok (`ngrok http 5173`) y poné aquí la URL https,
     * p. ej. `https://xxxx.ngrok-free.app`. Abrí el admin desde esa misma URL.
     * Si no se define, se usa CLIENT_ORIGIN (localhost), que en sandbox a veces falla.
     */
    MP_REDIRECT_BASE_URL: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().url().optional(),
    ),
    /**
     * Días de anticipación con que se programa un cambio de precio de
     * suscripción. El super-admin guarda el nuevo precio y el job aplica el
     * cambio en MP cuando pasa esta ventana. En dev conviene bajar a 0 o 1
     * para probar el flujo sin esperar.
     */
    PRICE_CHANGE_WINDOW_DAYS: z.coerce.number().int().min(0).max(365).default(30),
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
    ADMIN_PASSWORD_BCRYPT: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      bcryptHash.optional(),
    ),
    /**
     * Contraseña del panel de administración del sistema (super-admin, distinto
     * del admin por barbería). Solo para desarrollo local.
     * Cadena vacía se trata como no definida (útil cuando Docker expone la var
     * aunque no esté seteada en el `.env` del host).
     */
    SYSTEM_ADMIN_PASSWORD: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().min(8).optional(),
    ),
    /**
     * Hash bcrypt del super-admin del sistema (recomendado en producción).
     * Mutuamente excluyente con `SYSTEM_ADMIN_PASSWORD`.
     */
    SYSTEM_ADMIN_PASSWORD_BCRYPT: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      bcryptHash.optional(),
    ),
    /** Email del super-admin (solo display, no cambia la autenticación). */
    SYSTEM_ADMIN_EMAIL: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().email().optional(),
    ),
    /**
     * Número de WhatsApp del negocio (solo dígitos, código país sin +).
     * Si está definido, el frontend puede ofrecer enlace wa.me tras reservar.
     */
    WHATSAPP_NUMBER: z
      .string()
      .regex(/^\d{8,20}$/, 'usá solo dígitos, código país sin + ni espacios')
      .optional(),
    /** Si definís SMTP, usá también SMTP_USER, SMTP_PASS y MAIL_FROM (recordatorios por email). */
    SMTP_HOST: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().min(1).optional(),
    ),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().min(1).optional(),
    ),
    SMTP_PASS: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().optional(),
    ),
    /** Remitente (ej. "Barbería <info@dominio.com>" o solo el email). */
    MAIL_FROM: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().min(1).optional(),
    ),
    /** Horas antes del turno para enviar el recordatorio (ventana ±45 min). */
    REMINDER_HOURS_BEFORE: z.coerce.number().positive().default(24),
    /** Cada cuántos minutos se evalúan candidatos a recordatorio. */
    REMINDER_POLL_MINUTES: z.coerce.number().int().positive().max(120).default(15),
    /** Días de prueba al registrar un shop (status='trial'). */
    TRIAL_DURATION_DAYS: z.coerce.number().int().positive().max(365).default(14),
    /** Cuando faltan ≤ este número de días para el fin del trial, se envía un aviso por email al owner. */
    TRIAL_WARNING_DAYS: z.coerce.number().int().nonnegative().max(30).default(3),
    /** Cada cuántas horas corre el job que suspende trials vencidos y envía avisos. */
    TRIAL_JOB_HOURS: z.coerce.number().positive().max(24).default(6),
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
    const hasSysBcrypt = Boolean(data.SYSTEM_ADMIN_PASSWORD_BCRYPT);
    const hasSysPlain = Boolean(data.SYSTEM_ADMIN_PASSWORD);
    if (hasSysBcrypt && hasSysPlain) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Definí solo una de SYSTEM_ADMIN_PASSWORD_BCRYPT o SYSTEM_ADMIN_PASSWORD (no ambas)',
        path: ['SYSTEM_ADMIN_PASSWORD_BCRYPT'],
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

const parsed = EnvSchema.parse(process.env);

/** Incluye siempre `CLIENT_ORIGIN` más los valores de `CORS_ALLOWED_ORIGINS`. */
const corsAllowedOrigins = [
  ...new Set([parsed.CLIENT_ORIGIN, ...splitCommaList(parsed.CORS_ALLOWED_ORIGINS)]),
];

export const env = { ...parsed, corsAllowedOrigins };

export function isSmtpConfigured(): boolean {
  return Boolean(
    env.SMTP_HOST &&
      env.SMTP_USER &&
      env.SMTP_PASS &&
      env.SMTP_PASS.length > 0 &&
      env.MAIL_FROM,
  );
}

/** `true` si hay una contraseña configurada para el panel de sistema. */
export function isSystemAdminConfigured(): boolean {
  return Boolean(env.SYSTEM_ADMIN_PASSWORD || env.SYSTEM_ADMIN_PASSWORD_BCRYPT);
}

/** `true` si Mercado Pago está configurado (access token + webhook secret). */
export function isMpConfigured(): boolean {
  return Boolean(env.MP_ACCESS_TOKEN && env.MP_WEBHOOK_SECRET);
}

