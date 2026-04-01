import jwt from 'jsonwebtoken';
import { env } from './env';

/** JWT de un solo uso conceptual: cancelar turno desde enlace sin login. */
export function signCustomerCancelToken(appointmentId: string): string {
  return jwt.sign(
    { appt: appointmentId, typ: 'customer_cancel' },
    env.JWT_SECRET,
    { expiresIn: '90d' },
  );
}

export function verifyCustomerCancelToken(token: string): string | null {
  try {
    const p = jwt.verify(token, env.JWT_SECRET) as {
      appt?: string;
      typ?: string;
    };
    if (p.typ !== 'customer_cancel' || typeof p.appt !== 'string' || !p.appt) {
      return null;
    }
    return p.appt;
  } catch {
    return null;
  }
}
