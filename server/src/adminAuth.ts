import { timingSafeEqual } from 'crypto';
import bcrypt from 'bcrypt';
import type { Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from './env';
import { getShopBySlug } from './shops';

const JWT_ISS = 'barber-turnos-admin';

export type AdminJwtPayload = {
  role: 'admin';
  shopId: string;
};

export function signAdminToken(shopId: string): string {
  return jwt.sign({ role: 'admin', shopId } satisfies AdminJwtPayload, env.JWT_SECRET, {
    expiresIn: '7d',
    issuer: JWT_ISS,
  });
}

/**
 * Middleware del panel admin. Siempre se monta bajo rutas con `:shopSlug`
 * (`/api/shops/:shopSlug/admin/...`) y **valida que el `shopId` del JWT
 * coincida con el de la shop identificada por el slug**. Sin esta validación
 * un admin podía presentar un JWT emitido para la shop A y operar sobre la
 * shop B cambiando simplemente el slug de la URL.
 */
export const requireAdmin: RequestHandler = async (req: Request, res: Response, next) => {
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (!token) {
    res.status(401).json({ error: 'no autorizado' });
    return;
  }

  const slug =
    typeof req.params.shopSlug === 'string' ? req.params.shopSlug.trim() : '';
  if (!slug) {
    // Guardrail: todas las rutas admin tienen que colgar bajo :shopSlug.
    res.status(400).json({ error: 'slug del local requerido' });
    return;
  }

  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET, {
      issuer: JWT_ISS,
    }) as jwt.JwtPayload;
  } catch {
    res.status(401).json({ error: 'sesión inválida o vencida' });
    return;
  }

  if (payload.role !== 'admin' || typeof payload.shopId !== 'string' || !payload.shopId) {
    res.status(403).json({ error: 'prohibido' });
    return;
  }

  try {
    const shop = await getShopBySlug(slug);
    if (!shop) {
      res.status(404).json({ error: 'local no encontrado' });
      return;
    }
    if (shop.id !== payload.shopId) {
      res
        .status(403)
        .json({ error: 'este token no corresponde a este local' });
      return;
    }
    (req as Request & { shopId: string }).shopId = shop.id;
    next();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'error resolviendo local';
    res.status(500).json({ error: msg });
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
