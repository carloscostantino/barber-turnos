import { timingSafeEqual } from 'crypto';
import bcrypt from 'bcrypt';
import type { Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env, isSystemAdminConfigured } from './env';

const JWT_ISS = 'barber-turnos-system';

export type SystemAdminJwtPayload = {
  role: 'system_admin';
};

export function signSystemAdminToken(): string {
  return jwt.sign({ role: 'system_admin' } satisfies SystemAdminJwtPayload, env.JWT_SECRET, {
    expiresIn: '7d',
    issuer: JWT_ISS,
  });
}

export const requireSystemAdmin: RequestHandler = (
  req: Request,
  res: Response,
  next,
) => {
  if (!isSystemAdminConfigured()) {
    res.status(503).json({ error: 'panel de sistema no configurado' });
    return;
  }
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (!token) {
    res.status(401).json({ error: 'no autorizado' });
    return;
  }
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      issuer: JWT_ISS,
    }) as jwt.JwtPayload;
    if (payload.role !== 'system_admin') {
      res.status(403).json({ error: 'prohibido' });
      return;
    }
    next();
  } catch {
    res.status(401).json({ error: 'sesión inválida o vencida' });
  }
};

export async function verifySystemAdminPassword(candidate: string): Promise<boolean> {
  if (env.SYSTEM_ADMIN_PASSWORD_BCRYPT) {
    return bcrypt.compare(candidate, env.SYSTEM_ADMIN_PASSWORD_BCRYPT);
  }
  const plain = env.SYSTEM_ADMIN_PASSWORD;
  if (!plain) return false;
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(plain, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
