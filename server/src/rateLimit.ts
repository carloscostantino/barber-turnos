import rateLimit from 'express-rate-limit';

/** Anti fuerza bruta en login del panel. */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'demasiados intentos de inicio de sesión, probá más tarde' },
});

/** Anti spam en creación de turnos públicos. */
export const bookingRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'demasiadas reservas desde esta conexión, probá más tarde' },
});

/** Límite para cancelación por token (misma IP). */
export const cancelByTokenRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'demasiados intentos, probá más tarde' },
});

/** Anti spam del reset del shop demo. */
export const demoResetRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'demasiados reinicios, probá más tarde' },
});
