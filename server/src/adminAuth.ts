import { timingSafeEqual } from 'crypto';
import bcrypt from 'bcrypt';
import type { Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from './env';

const JWT_ISS = 'barber-turnos-admin';

export function signAdminToken(): string {
  return jwt.sign({ role: 'admin' }, env.JWT_SECRET, {
    expiresIn: '7d',
    issuer: JWT_ISS,
  });
}

export const requireAdmin: RequestHandler = (req: Request, res: Response, next) => {
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
    if (payload.role !== 'admin') {
      res.status(403).json({ error: 'prohibido' });
      return;
    }
    next();
  } catch {
    res.status(401).json({ error: 'sesión inválida o vencida' });
  }
};

export async function verifyAdminPassword(candidate: string): Promise<boolean> {
  if (env.ADMIN_PASSWORD_BCRYPT) {
    return bcrypt.compare(candidate, env.ADMIN_PASSWORD_BCRYPT);
  }
  const plain = env.ADMIN_PASSWORD!;
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(plain, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
