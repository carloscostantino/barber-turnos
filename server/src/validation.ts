import { z } from 'zod';

export const UUID = z.string().uuid();

/** Mensaje legible para respuestas 400 (evita enviar solo `flatten()` opaco al cliente). */
export function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => `${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`)
    .join('; ');
}

const optionalTrimmedEmail = z.preprocess(
  (v) => {
    if (v === null || v === undefined) return undefined;
    const t = String(v).trim();
    return t === '' ? undefined : t;
  },
  z.string().email().optional(),
);

/** Email obligatorio para recordatorios y notificaciones al reservar. */
const requiredBookingEmail = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim() : ''),
  z.string().min(1, 'email obligatorio').email('email inválido'),
);

export const CreateAppointmentBody = z.object({
  serviceId: UUID,
  // Acepta `Z` y offsets (`+00:00`), p. ej. si el cliente serializa distinto.
  startsAt: z.string().datetime({ offset: true }),
  customer: z.object({
    name: z.string().min(2),
    phone: z
      .string()
      .max(30)
      .transform((s) => s.replace(/[^\d+]/g, ''))
      .pipe(z.string().min(6).max(20)),
    email: requiredBookingEmail,
  }),
  notes: z.preprocess(
    (v) =>
      v === null || v === undefined || v === ''
        ? undefined
        : String(v),
    z.string().max(500).optional(),
  ),
});

export const AvailabilityQuery = z.object({
  serviceId: UUID,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const ListAppointmentsQuery = z.object({
  barberId: UUID.optional(),
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
});

export const UpdateAppointmentStatusBody = z
  .object({
    status: z.enum(['pending', 'confirmed', 'cancelled']),
    cancellationNote: z.preprocess(
      (v) =>
        v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
          ? undefined
          : String(v),
      z.string().max(1500).optional(),
    ),
  })
  .superRefine((data, ctx) => {
    if (data.cancellationNote != null && data.status !== 'cancelled') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'cancellationNote solo aplica al cancelar',
        path: ['cancellationNote'],
      });
    }
  });

export const AdminLoginBody = z.object({
  password: z.string().min(1),
});

const timeHHMM = z.string().regex(/^\d{2}:\d{2}$/);

const shopContactWhatsapp = z.preprocess(
  (v) => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    const t = String(v).trim();
    return t === '' ? null : t;
  },
  z
    .union([
      z.null(),
      z
        .string()
        .transform((s) => s.replace(/[^\d+]/g, ''))
        .pipe(z.string().min(8).max(20)),
    ])
    .optional(),
);

const shopContactEmail = z.preprocess(
  (v) => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    const t = String(v).trim();
    return t === '' ? null : t;
  },
  z.union([z.null(), z.string().email()]).optional(),
);

const shopContactAddress = z.preprocess(
  (v) => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    const t = String(v).trim();
    return t === '' ? null : t;
  },
  z.union([z.null(), z.string().max(500)]).optional(),
);

export const ShopSettingsBody = z.object({
  bookingMinLeadHours: z.coerce.number().int().min(0).max(168),
  bookingMaxDaysAhead: z.coerce.number().int().min(1).max(365),
  contactWhatsapp: shopContactWhatsapp,
  contactEmail: shopContactEmail,
  contactAddress: shopContactAddress,
});

export const BusinessHoursDayBody = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  isClosed: z.boolean(),
  openTime: timeHHMM.nullable(),
  closeTime: timeHHMM.nullable(),
});

export const BusinessHoursPutBody = z.array(BusinessHoursDayBody).length(7);

export const ServiceCreateBody = z.object({
  name: z.string().min(1).max(200),
  duration_minutes: z.coerce.number().int().min(5).max(480),
  price_cents: z.coerce.number().int().min(0),
});

export const ServiceUpdateBody = z.object({
  name: z.string().min(1).max(200).optional(),
  duration_minutes: z.coerce.number().int().min(5).max(480).optional(),
  price_cents: z.coerce.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

const blockedRangeNote = z.preprocess(
  (v) =>
    v === null || v === undefined || v === '' ? undefined : String(v),
  z.string().max(500).optional(),
);

/** Rango explícito (`startsAt`/`endsAt`) o día calendario completo en `TIMEZONE` del servidor (`blockedDate`). */
export const BlockedRangeCreateBody = z.union([
  z.object({
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    note: blockedRangeNote,
  }),
  z.object({
    blockedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: blockedRangeNote,
  }),
]);

