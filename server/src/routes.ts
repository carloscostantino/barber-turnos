import bcrypt from 'bcrypt';
import { DateTime } from 'luxon';
import { Router } from 'express';
import { requireAdmin, signAdminToken, verifyAdminPassword } from './adminAuth';
import { signCustomerCancelToken, verifyCustomerCancelToken } from './customerToken';
import {
  countActiveAppointmentsOverlappingRange,
  deleteBlockedRange,
  getAppointmentForEmail,
  getService,
  getSingleActiveBarberId,
  insertBlockedRange,
  deleteServiceIfUnused,
  insertService,
  listAppointments,
  listBarbersPublic,
  listBlockedRanges,
  listServices,
  updateAppointmentAttendance,
  updateService,
} from './api';
import { pool } from './db';
import { env, isMpConfigured, isSmtpConfigured } from './env';
import {
  createMailer,
  formatAppointmentDateTimeLabel,
  sendAppointmentCancelledEmail,
  sendBookingConfirmationEmail,
} from './mailer';
import {
  assertBookingAllowed,
  blockedRangeForShopCalendarDay,
  computeAvailableSlots,
  getShopSettings,
  listBusinessHours,
  listFullyBlockedCalendarDatesInRange,
  replaceBusinessHours,
  updateShopSettings,
} from './scheduling';
import {
  bookingRateLimiter,
  cancelByTokenRateLimiter,
  demoResetRateLimiter,
  loginRateLimiter,
  systemAdminLoginLimiter,
} from './rateLimit';
import { resetDemoShop } from './demoReset';
import {
  AdminLoginBody,
  AvailabilityQuery,
  BlockedRangeCreateBody,
  BusinessHoursPutBody,
  CancelAppointmentByTokenBody,
  CreateAppointmentBody,
  formatZodError,
  ListAppointmentsQuery,
  PlatformPriceChangeBody,
  ServiceCreateBody,
  ServiceUpdateBody,
  ShopSettingsBody,
  ShopStatusUpdateBody,
  SystemAdminLoginBody,
  UpdateAppointmentAttendanceBody,
  UpdateAppointmentStatusBody,
  UUID,
  RegisterShopBody,
} from './validation';
import {
  displayTitleFromSlug,
  getPublicShopBySlug,
  getShopById,
  getShopBySlug,
  listShopsOverview,
  updateShopStatus,
} from './shops';
import {
  requireSystemAdmin,
  signSystemAdminToken,
  verifySystemAdminPassword,
} from './systemAdminAuth';
import { registerShopAndOwner } from './shopOnboarding';
import { getDashboardData } from './dashboard';
import { composeAddressLine } from './addressFormat';
import {
  cancelPreapprovalForShop,
  createOrGetPreapprovalForShop,
  formatMpCaughtError,
  getSubscriptionForShop,
} from './mercadopagoBilling';
import {
  cancelPendingPriceChange,
  getPlatformSettings,
  NoChangeError,
  PendingChangeExistsError,
  schedulePriceChange,
} from './platformSettings';
import {
  sendPriceChangeCancelledEmailToAllOwners,
  sendPriceChangeEmailToAllOwners,
} from './priceChangeNotifier';
import { runPriceChangeJob } from './priceChangeJob';

/** Express 5 puede tipar `req.params` como `string | string[]`. */
function paramStr(value: string | string[] | undefined): string {
  if (value == null) return '';
  return typeof value === 'string' ? value : value[0] ?? '';
}

export const router = Router();

async function sendPublicSettings(slug: string, res: import('express').Response) {
  const shop = await getPublicShopBySlug(slug);
  if (!shop) {
    return res.status(404).json({ error: 'local no encontrado' });
  }
  const barberId = await getSingleActiveBarberId(shop.id);
  const settings = await getShopSettings(shop.id);
  const whatsappFromDb = settings.contactWhatsapp?.trim();
  const bhRows = await listBusinessHours(shop.id);
  const businessHours = bhRows.map((h) => ({
    dayOfWeek: h.day_of_week,
    isClosed: h.is_closed,
  }));
  const zone = shop.timezone;
  const today = DateTime.now().setZone(zone).startOf('day');
  const lastBookable = today.plus({ days: settings.bookingMaxDaysAhead });
  const fullyBlockedDates = await listFullyBlockedCalendarDatesInRange(
    shop.id,
    today.toISODate()!,
    lastBookable.toISODate()!,
    zone,
  );
  const nameFromSettings = settings.shopName?.trim();
  const fallbackName = shop.name?.trim();
  const fromSlug = displayTitleFromSlug(shop.slug);
  const hasStructuredAddress = [
    settings.addressStreet,
    settings.addressNumber,
    settings.addressFloor,
    settings.addressCity,
    settings.addressRegion,
    settings.addressPostalCode,
  ].some((v) => typeof v === 'string' && v.trim() !== '');
  const contactAddressNotes = hasStructuredAddress
    ? settings.contactAddress?.trim() || null
    : null;
  res.json({
    shopSlug: shop.slug,
    shopName: nameFromSettings || fallbackName || fromSlug || null,
    whatsappNumber: whatsappFromDb || env.WHATSAPP_NUMBER || null,
    contactEmail: settings.contactEmail,
    contactAddress: composeAddressLine(settings) ?? null,
    contactAddressNotes,
    barberId,
    timezone: zone,
    bookingMinLeadHours: settings.bookingMinLeadHours,
    bookingMaxDaysAhead: settings.bookingMaxDaysAhead,
    businessHours,
    fullyBlockedDates,
  });
}

router.get('/barbers', async (_req, res) => {
  const shop = await getPublicShopBySlug(env.DEFAULT_SHOP_SLUG);
  if (!shop) return res.status(404).json({ error: 'local no encontrado' });
  const barbers = await listBarbersPublic(shop.id);
  res.json(barbers);
});

router.get('/shops/:shopSlug/barbers', async (req, res) => {
  const shop = await getPublicShopBySlug(paramStr(req.params.shopSlug));
  if (!shop) return res.status(404).json({ error: 'local no encontrado' });
  const barbers = await listBarbersPublic(shop.id);
  res.json(barbers);
});

router.get('/services', async (_req, res) => {
  const shop = await getPublicShopBySlug(env.DEFAULT_SHOP_SLUG);
  if (!shop) return res.status(404).json({ error: 'local no encontrado' });
  const services = await listServices(shop.id, true);
  res.json(services);
});

router.get('/shops/:shopSlug/services', async (req, res) => {
  const shop = await getPublicShopBySlug(paramStr(req.params.shopSlug));
  if (!shop) return res.status(404).json({ error: 'local no encontrado' });
  const services = await listServices(shop.id, true);
  res.json(services);
});

router.get('/public-settings', async (_req, res) => {
  await sendPublicSettings(env.DEFAULT_SHOP_SLUG, res);
});

router.get('/shops/:shopSlug/public-settings', async (req, res) => {
  await sendPublicSettings(paramStr(req.params.shopSlug), res);
});

router.post('/shops/:shopSlug/admin/login', loginRateLimiter, async (req, res) => {
  const parsed = AdminLoginBody.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: formatZodError(parsed.error) });

  const slug = paramStr(req.params.shopSlug);
  const shop = await getShopBySlug(slug);
  if (!shop) return res.status(404).json({ error: 'local no encontrado' });

  let ok = false;
  const emailTrim = parsed.data.ownerEmail?.trim();
  if (emailTrim) {
    const r = await pool.query<{ password_hash: string }>(
      `select password_hash from shop_users where shop_id = $1 and lower(email) = lower($2)`,
      [shop.id, emailTrim],
    );
    const row = r.rows[0];
    if (row) {
      ok = await bcrypt.compare(parsed.data.password, row.password_hash);
    }
  } else {
    const owners = await pool.query<{ password_hash: string }>(
      `select password_hash from shop_users where shop_id = $1 and role = 'owner' order by created_at asc`,
      [shop.id],
    );
    if (owners.rows.length === 1) {
      ok = await bcrypt.compare(parsed.data.password, owners.rows[0]!.password_hash);
    } else if (owners.rows.length === 0) {
      ok = await verifyAdminPassword(parsed.data.password);
    } else {
      return res.status(400).json({
        error:
          'este local tiene más de un usuario: indicá el email con el que te registraste',
      });
    }
  }

  if (!ok) {
    return res.status(401).json({ error: 'credenciales incorrectas' });
  }

  const restricted = shop.status === 'suspended';
  const token = signAdminToken(shop.id, { restricted });
  res.json({
    token,
    expiresInSec: 7 * 24 * 60 * 60,
    restricted,
    shopStatus: shop.status,
  });
});

router.get('/shops/:shopSlug/admin/appointments', requireAdmin, async (req, res) => {
  const parsed = ListAppointmentsQuery.safeParse(req.query);
  if (!parsed.success)
    return res.status(400).json({ error: formatZodError(parsed.error) });

  const rows = await listAppointments({
    shopId: req.shopId!,
    barberId: parsed.data.barberId,
    from: new Date(parsed.data.from),
    to: new Date(parsed.data.to),
  });
  res.json(rows);
});

router.patch('/shops/:shopSlug/admin/appointments/:id/status', requireAdmin, async (req, res) => {
  const idParsed = UUID.safeParse(paramStr(req.params.id));
  if (!idParsed.success) return res.status(400).json({ error: 'id inválido' });

  const bodyParsed = UpdateAppointmentStatusBody.safeParse(req.body);
  if (!bodyParsed.success)
    return res.status(400).json({ error: formatZodError(bodyParsed.error) });

  const cancellationNote = bodyParsed.data.cancellationNote;

  const prev = await pool.query<{ status: string }>(
    `select status from appointments where id = $1 and shop_id = $2`,
    [idParsed.data, req.shopId!],
  );
  if (!prev.rows[0]) return res.status(404).json({ error: 'turno no encontrado' });

  const result = await pool.query(
    `update appointments set status = $2 where id = $1 and shop_id = $3 returning id, status`,
    [idParsed.data, bodyParsed.data.status, req.shopId!],
  );
  const row = result.rows[0];
  if (!row) return res.status(404).json({ error: 'turno no encontrado' });

  if (
    bodyParsed.data.status === 'cancelled' &&
    prev.rows[0].status !== 'cancelled'
  ) {
    const appt = await getAppointmentForEmail(idParsed.data);
    if (appt?.email && appt.email.trim()) {
      const transporter = createMailer();
      if (transporter) {
        try {
          await sendAppointmentCancelledEmail(transporter, {
            to: appt.email.trim(),
            customerName: appt.customer_name,
            serviceName: appt.service_name,
            startsAtLabel: formatAppointmentDateTimeLabel(new Date(appt.starts_at)),
            cancellationNote: cancellationNote?.trim() || undefined,
          });
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error(
            '[cancel email]',
            e instanceof Error ? e.message : e,
          );
        }
      }
    }
  }

  res.json(row);
});

router.patch('/shops/:shopSlug/admin/appointments/:id/attendance', requireAdmin, async (req, res) => {
  const idParsed = UUID.safeParse(paramStr(req.params.id));
  if (!idParsed.success) return res.status(400).json({ error: 'id inválido' });

  const bodyParsed = UpdateAppointmentAttendanceBody.safeParse(req.body);
  if (!bodyParsed.success)
    return res.status(400).json({ error: formatZodError(bodyParsed.error) });

  const row = await updateAppointmentAttendance(
    req.shopId!,
    idParsed.data,
    bodyParsed.data.attended,
  );
  if (!row) return res.status(404).json({ error: 'turno no encontrado' });
  res.json(row);
});

router.get('/availability', async (req, res) => {
  const parsed = AvailabilityQuery.safeParse(req.query);
  if (!parsed.success)
    return res.status(400).json({ error: formatZodError(parsed.error) });

  const shop = await getPublicShopBySlug(env.DEFAULT_SHOP_SLUG);
  if (!shop) return res.status(404).json({ error: 'local no encontrado' });

  const barberId = await getSingleActiveBarberId(shop.id);
  if (!barberId) {
    return res.status(503).json({ error: 'no hay barbero activo configurado' });
  }

  const result = await computeAvailableSlots({
    shopId: shop.id,
    timezone: shop.timezone,
    dateStr: parsed.data.date,
    barberId,
    serviceId: parsed.data.serviceId,
  });

  if ('error' in result) {
    return res.status(404).json({ error: result.error });
  }

  res.json({
    timezone: result.timezone,
    service: result.service,
    slots: result.slots,
  });
});

router.get('/shops/:shopSlug/availability', async (req, res) => {
  const parsed = AvailabilityQuery.safeParse(req.query);
  if (!parsed.success)
    return res.status(400).json({ error: formatZodError(parsed.error) });

  const shop = await getPublicShopBySlug(paramStr(req.params.shopSlug));
  if (!shop) return res.status(404).json({ error: 'local no encontrado' });

  const barberId = await getSingleActiveBarberId(shop.id);
  if (!barberId) {
    return res.status(503).json({ error: 'no hay barbero activo configurado' });
  }

  const result = await computeAvailableSlots({
    shopId: shop.id,
    timezone: shop.timezone,
    dateStr: parsed.data.date,
    barberId,
    serviceId: parsed.data.serviceId,
  });

  if ('error' in result) {
    return res.status(404).json({ error: result.error });
  }

  res.json({
    timezone: result.timezone,
    service: result.service,
    slots: result.slots,
  });
});

async function postAppointment(
  req: import('express').Request,
  res: import('express').Response,
  shopSlug: string,
) {
  const parsed = CreateAppointmentBody.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: formatZodError(parsed.error) });

  const shop = await getPublicShopBySlug(shopSlug);
  if (!shop) {
    return res.status(404).json({ error: 'local no encontrado' });
  }

  const barberId = await getSingleActiveBarberId(shop.id);
  if (!barberId) {
    return res.status(503).json({ error: 'no hay barbero activo configurado' });
  }

  const service = await getService(shop.id, parsed.data.serviceId);
  if (!service) return res.status(404).json({ error: 'servicio no encontrado' });

  const startsAt = new Date(parsed.data.startsAt);
  if (Number.isNaN(startsAt.getTime()))
    return res.status(400).json({ error: 'startsAt inválido' });

  const allowed = await assertBookingAllowed({
    shopId: shop.id,
    timezone: shop.timezone,
    startsAt,
    barberId,
    serviceId: parsed.data.serviceId,
  });
  if (!allowed.ok) return res.status(400).json({ error: allowed.error });

  const endsAt = new Date(
    startsAt.getTime() + service.duration_minutes * 60 * 1000,
  );

  const client = await pool.connect();
  try {
    await client.query('begin');

    const customerResult = await client.query(
      `
        insert into customers (shop_id, name, phone, email)
        values ($1, $2, $3, $4)
        on conflict (shop_id, phone)
        do update set name = excluded.name, email = coalesce(excluded.email, customers.email)
        returning id
      `,
      [
        shop.id,
        parsed.data.customer.name,
        parsed.data.customer.phone,
        parsed.data.customer.email ?? null,
      ],
    );

    const customerId = customerResult.rows[0]?.id as string | undefined;
    if (!customerId) throw new Error('no se pudo crear/leer customer');

    const overlap = await client.query(
      `
        select 1
        from appointments
        where shop_id = $1
          and barber_id = $2
          and status <> 'cancelled'
          and starts_at < $3
          and ends_at > $4
        limit 1
      `,
      [shop.id, barberId, endsAt, startsAt],
    );
    if (overlap.rowCount && overlap.rowCount > 0) {
      await client.query('rollback');
      return res.status(409).json({ error: 'ese horario ya está ocupado' });
    }

    const appointmentResult = await client.query(
      `
        insert into appointments (
          shop_id, barber_id, service_id, customer_id, starts_at, ends_at, status, notes
        )
        values ($1, $2, $3, $4, $5, $6, 'confirmed', $7)
        returning id, barber_id, service_id, customer_id, starts_at, ends_at, status, notes, created_at
      `,
      [
        shop.id,
        barberId,
        parsed.data.serviceId,
        customerId,
        startsAt,
        endsAt,
        parsed.data.notes ?? null,
      ],
    );

    await client.query('commit');
    const created = appointmentResult.rows[0] as {
      id: string;
      barber_id: string;
      service_id: string;
      customer_id: string;
      starts_at: Date;
      ends_at: Date;
      status: string;
      notes: string | null;
      created_at: Date;
    };

    if (isSmtpConfigured() && parsed.data.customer.email?.trim()) {
      const transporter = createMailer();
      if (transporter) {
        try {
          const cancelToken = signCustomerCancelToken(created.id);
          const cancelUrl = `${env.CLIENT_ORIGIN}/s/${shop.slug}/cancelar?token=${encodeURIComponent(cancelToken)}`;
          await sendBookingConfirmationEmail(transporter, {
            to: parsed.data.customer.email.trim(),
            customerName: parsed.data.customer.name,
            serviceName: service.name,
            startsAtLabel: formatAppointmentDateTimeLabel(startsAt),
            cancelUrl,
          });
        } catch (emailErr) {
          // eslint-disable-next-line no-console
          console.error(
            '[booking confirm email]',
            emailErr instanceof Error ? emailErr.message : emailErr,
          );
        }
      }
    }

    res.status(201).json(created);
  } catch (e) {
    await client.query('rollback');
    const msg = e instanceof Error ? e.message : 'error';
    res.status(500).json({ error: msg });
  } finally {
    client.release();
  }
}

router.post('/appointments', bookingRateLimiter, (req, res) => {
  void postAppointment(req, res, env.DEFAULT_SHOP_SLUG);
});

router.post('/shops/:shopSlug/appointments', bookingRateLimiter, (req, res) => {
  void postAppointment(req, res, paramStr(req.params.shopSlug));
});

router.post(
  '/appointments/cancel-by-token',
  cancelByTokenRateLimiter,
  async (req, res) => {
    const parsed = CancelAppointmentByTokenBody.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: formatZodError(parsed.error) });

    const apptId = verifyCustomerCancelToken(parsed.data.token);
    if (!apptId)
      return res.status(400).json({ error: 'enlace inválido o vencido' });

    const prev = await pool.query<{ status: string; starts_at: Date }>(
      `select status, starts_at from appointments where id = $1`,
      [apptId],
    );
    if (!prev.rows[0])
      return res.status(404).json({ error: 'turno no encontrado' });
    if (prev.rows[0].status === 'cancelled') {
      return res.json({ ok: true, alreadyCancelled: true });
    }
    if (prev.rows[0].status !== 'confirmed') {
      return res.status(400).json({ error: 'no se puede cancelar este turno' });
    }
    if (new Date(prev.rows[0].starts_at).getTime() <= Date.now()) {
      return res
        .status(400)
        .json({ error: 'el turno ya comenzó o pasó; contactá al local' });
    }

    await pool.query(
      `update appointments set status = 'cancelled' where id = $1`,
      [apptId],
    );
    res.json({ ok: true });
  },
);

router.get('/shops/:shopSlug/admin/shop-settings', requireAdmin, async (req, res) => {
  const s = await getShopSettings(req.shopId!);
  res.json(s);
});

/**
 * Métricas para la tab "Turnos" del panel admin (turnos hoy/semana/mes,
 * ingresos, asistencia, clientes recurrentes).
 */
router.get('/shops/:shopSlug/admin/dashboard', requireAdmin, async (req, res) => {
  const data = await getDashboardData(req.shopId!);
  res.json(data);
});

/**
 * Estado de la suscripción/prueba del local, para mostrar el banner en el
 * panel admin. Respuesta:
 *   - `status`: 'active' | 'trial' | 'suspended'
 *   - `trialEndsAt`: ISO | null (fecha en que vence la prueba, si aplica)
 *   - `daysLeft`: entero ≥ 0 o null (días enteros que faltan; 0 = expira hoy)
 *   - `billing.subscriptionPriceArs` / `subscriptionReason`: precio mensual y
 *     texto que verá el cliente en MP (desde `platform_settings`).
 */
router.get('/shops/:shopSlug/admin/trial-status', requireAdmin, async (req, res) => {
  const shop = await getShopBySlug(paramStr(req.params.shopSlug));
  if (!shop) return res.status(404).json({ error: 'local no encontrado' });
  let daysLeft: number | null = null;
  if (shop.trialEndsAt) {
    const ms = new Date(shop.trialEndsAt).getTime() - Date.now();
    daysLeft = Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
  }
  const sub = await getSubscriptionForShop(shop.id);
  const platform = await getPlatformSettings();
  res.json({
    status: shop.status,
    trialEndsAt: shop.trialEndsAt ?? null,
    daysLeft,
    restricted: Boolean(req.adminRestricted),
    billing: {
      configured: isMpConfigured(),
      provider: sub?.provider ?? 'none',
      status: sub?.status ?? 'none',
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      hasInitPoint: Boolean(sub?.initPoint),
      initPoint: sub?.initPoint ?? null,
      subscriptionPriceArs: platform.current.subscriptionPriceArs,
      subscriptionReason: platform.current.subscriptionReason,
    },
  });
});

router.post(
  '/shops/:shopSlug/admin/billing/subscribe',
  requireAdmin,
  async (req, res) => {
    if (!isMpConfigured()) {
      return res.status(501).json({ error: 'Mercado Pago no configurado' });
    }
    try {
      const out = await createOrGetPreapprovalForShop(req.shopId!);
      if (!out) {
        return res.status(500).json({ error: 'no se pudo crear preapproval' });
      }
      res.json({ initPoint: out.initPoint, preapprovalId: out.preapprovalId });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[billing/subscribe] Mercado Pago:', e);
      const msg = formatMpCaughtError(e);
      res.status(502).json({ error: msg });
    }
  },
);

router.post(
  '/shops/:shopSlug/admin/billing/cancel',
  requireAdmin,
  async (req, res) => {
    const ok = await cancelPreapprovalForShop(req.shopId!);
    if (!ok) {
      return res
        .status(404)
        .json({ error: 'sin suscripción activa para cancelar' });
    }
    res.json({ ok: true });
  },
);

router.get(
  '/shops/:shopSlug/admin/billing/status',
  requireAdmin,
  async (req, res) => {
    const sub = await getSubscriptionForShop(req.shopId!);
    res.json({
      configured: isMpConfigured(),
      provider: sub?.provider ?? 'none',
      status: sub?.status ?? 'none',
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      hasInitPoint: Boolean(sub?.initPoint),
      initPoint: sub?.initPoint ?? null,
      externalSubscriptionId: sub?.externalSubscriptionId ?? null,
    });
  },
);

router.put('/shops/:shopSlug/admin/shop-settings', requireAdmin, async (req, res) => {
  const parsed = ShopSettingsBody.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: formatZodError(parsed.error) });
  const s = await updateShopSettings(req.shopId!, {
    bookingMinLeadHours: parsed.data.bookingMinLeadHours,
    bookingMaxDaysAhead: parsed.data.bookingMaxDaysAhead,
    shopName: parsed.data.shopName,
    contactWhatsapp: parsed.data.contactWhatsapp,
    contactEmail: parsed.data.contactEmail,
    contactAddress: parsed.data.contactAddress,
    addressStreet: parsed.data.addressStreet,
    addressNumber: parsed.data.addressNumber,
    addressFloor: parsed.data.addressFloor,
    addressCity: parsed.data.addressCity,
    addressRegion: parsed.data.addressRegion,
    addressPostalCode: parsed.data.addressPostalCode,
  });
  res.json(s);
});

router.get('/shops/:shopSlug/admin/business-hours', requireAdmin, async (req, res) => {
  const rows = await listBusinessHours(req.shopId!);
  res.json(rows);
});

router.put('/shops/:shopSlug/admin/business-hours', requireAdmin, async (req, res) => {
  const parsed = BusinessHoursPutBody.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: formatZodError(parsed.error) });

  const daySet = new Set(parsed.data.map((d) => d.dayOfWeek));
  if (daySet.size !== 7) {
    return res.status(400).json({
      error: 'enviá los 7 días de la semana (0–6) sin repetir',
    });
  }

  for (const row of parsed.data) {
    if (row.isClosed) continue;
    const oa = row.openTimeAfternoon ?? null;
    const ca = row.closeTimeAfternoon ?? null;
    const hasAfternoon = oa != null && ca != null;
    if ((oa == null) !== (ca == null)) {
      return res.status(400).json({
        error: `día ${row.dayOfWeek}: indicá apertura y cierre de la tarde, o ninguno`,
      });
    }
    if (!row.openTime || !row.closeTime) {
      return res.status(400).json({
        error: `día ${row.dayOfWeek}: si abre, indicá hora de apertura y cierre`,
      });
    }
    if (row.openTime >= row.closeTime) {
      return res.status(400).json({
        error: `día ${row.dayOfWeek}: la apertura debe ser antes del cierre (primer tramo)`,
      });
    }
    if (hasAfternoon) {
      if (oa! >= ca!) {
        return res.status(400).json({
          error: `día ${row.dayOfWeek}: la apertura de la tarde debe ser antes del cierre`,
        });
      }
      if (row.closeTime >= oa!) {
        return res.status(400).json({
          error: `día ${row.dayOfWeek}: debe haber un hueco entre el fin del primer tramo y el inicio de la tarde`,
        });
      }
    }
  }

  await replaceBusinessHours(
    req.shopId!,
    parsed.data.map((r) => ({
      dayOfWeek: r.dayOfWeek,
      isClosed: r.isClosed,
      openTime: r.openTime,
      closeTime: r.closeTime,
      openTimeAfternoon: r.openTimeAfternoon ?? null,
      closeTimeAfternoon: r.closeTimeAfternoon ?? null,
    })),
  );
  res.json({ ok: true });
});

router.get('/shops/:shopSlug/admin/services', requireAdmin, async (req, res) => {
  const rows = await listServices(req.shopId!, false);
  res.json(rows);
});

router.post('/shops/:shopSlug/admin/services', requireAdmin, async (req, res) => {
  const parsed = ServiceCreateBody.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: formatZodError(parsed.error) });
  const row = await insertService(req.shopId!, parsed.data);
  res.status(201).json(row);
});

router.patch('/shops/:shopSlug/admin/services/:id', requireAdmin, async (req, res) => {
  const idParsed = UUID.safeParse(paramStr(req.params.id));
  if (!idParsed.success) return res.status(400).json({ error: 'id inválido' });
  const parsed = ServiceUpdateBody.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: formatZodError(parsed.error) });
  if (Object.keys(parsed.data).length === 0) {
    return res.status(400).json({ error: 'sin cambios' });
  }
  const row = await updateService(req.shopId!, idParsed.data, parsed.data);
  if (!row) return res.status(404).json({ error: 'servicio no encontrado' });
  res.json(row);
});

router.delete('/shops/:shopSlug/admin/services/:id', requireAdmin, async (req, res) => {
  const idParsed = UUID.safeParse(paramStr(req.params.id));
  if (!idParsed.success) return res.status(400).json({ error: 'id inválido' });
  const result = await deleteServiceIfUnused(req.shopId!, idParsed.data);
  if (result === 'not_found') return res.status(404).json({ error: 'servicio no encontrado' });
  if (result === 'has_appointments') {
    return res.status(409).json({
      error:
        'no se puede eliminar: hay turnos asociados a este servicio. Podés desactivarlo en su lugar.',
    });
  }
  res.json({ ok: true });
});

router.get('/shops/:shopSlug/admin/blocked-ranges', requireAdmin, async (req, res) => {
  const rows = await listBlockedRanges(req.shopId!);
  res.json(rows);
});

router.post('/shops/:shopSlug/admin/blocked-ranges', requireAdmin, async (req, res) => {
  const parsed = BlockedRangeCreateBody.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: formatZodError(parsed.error) });

  const shopCtx = await getShopById(req.shopId!);
  const timezone = shopCtx?.timezone ?? env.TIMEZONE;

  let startsAt: Date;
  let endsAt: Date;
  let note: string | undefined;

  if ('blockedDate' in parsed.data) {
    try {
      const r = blockedRangeForShopCalendarDay(parsed.data.blockedDate, timezone);
      startsAt = r.startsAt;
      endsAt = r.endsAt;
      note = parsed.data.note;
    } catch {
      return res.status(400).json({ error: 'fecha inválida' });
    }
  } else {
    startsAt = new Date(parsed.data.startsAt);
    endsAt = new Date(parsed.data.endsAt);
    note = parsed.data.note;
    if (!(endsAt > startsAt)) {
      return res.status(400).json({ error: 'endsAt debe ser posterior a startsAt' });
    }
  }

  const barberId = await getSingleActiveBarberId(req.shopId!);
  const n = await countActiveAppointmentsOverlappingRange(
    req.shopId!,
    startsAt,
    endsAt,
    barberId ?? undefined,
  );
  if (n > 0) {
    return res.status(409).json({
      error:
        'hay turnos activos en ese rango; cancelalos o reubicá antes de bloquear',
    });
  }

  const row = await insertBlockedRange(req.shopId!, {
    startsAt,
    endsAt,
    note,
  });
  res.status(201).json(row);
});

router.delete('/shops/:shopSlug/admin/blocked-ranges/:id', requireAdmin, async (req, res) => {
  const idParsed = UUID.safeParse(paramStr(req.params.id));
  if (!idParsed.success) return res.status(400).json({ error: 'id inválido' });
  const ok = await deleteBlockedRange(req.shopId!, idParsed.data);
  if (!ok) return res.status(404).json({ error: 'bloqueo no encontrado' });
  res.status(204).send();
});

router.post('/demo/reset', demoResetRateLimiter, async (_req, res) => {
  try {
    await resetDemoShop();
    res.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error al reiniciar el demo';
    res.status(500).json({ error: msg });
  }
});

router.post('/system/login', systemAdminLoginLimiter, async (req, res) => {
  const parsed = SystemAdminLoginBody.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: formatZodError(parsed.error) });
  const ok = await verifySystemAdminPassword(parsed.data.password);
  if (!ok) {
    return res.status(401).json({ error: 'credenciales incorrectas' });
  }
  const token = signSystemAdminToken();
  res.json({
    token,
    expiresInSec: 7 * 24 * 60 * 60,
    email: env.SYSTEM_ADMIN_EMAIL ?? null,
  });
});

router.get('/system/shops', requireSystemAdmin, async (_req, res) => {
  const rows = await listShopsOverview();
  res.json(rows);
});

router.patch('/system/shops/:id/status', requireSystemAdmin, async (req, res) => {
  const idParsed = UUID.safeParse(paramStr(req.params.id));
  if (!idParsed.success) return res.status(400).json({ error: 'id inválido' });
  const bodyParsed = ShopStatusUpdateBody.safeParse(req.body);
  if (!bodyParsed.success)
    return res.status(400).json({ error: formatZodError(bodyParsed.error) });
  const row = await updateShopStatus(idParsed.data, bodyParsed.data.status);
  if (!row) return res.status(404).json({ error: 'local no encontrado' });
  res.json(row);
});

/**
 * Configuración global de la plataforma (precio mensual, texto del plan en MP
 * y cambio pendiente programado). Solo el super-admin la consulta y modifica.
 */
router.get('/system/platform-settings', requireSystemAdmin, async (_req, res) => {
  const settings = await getPlatformSettings();
  res.json({ ...settings, windowDays: env.PRICE_CHANGE_WINDOW_DAYS });
});

/**
 * Programa un cambio de precio con `env.PRICE_CHANGE_WINDOW_DAYS` días de
 * anticipación. Si ya había un cambio pendiente responde 409 y la UI obliga a
 * cancelarlo antes. El email a los owners se dispara en background.
 */
router.put(
  '/system/platform-settings/price',
  requireSystemAdmin,
  async (req, res) => {
    const parsed = PlatformPriceChangeBody.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: formatZodError(parsed.error) });
    try {
      const { settings, oldPriceArs } = await schedulePriceChange({
        newPriceArs: parsed.data.subscriptionPriceArs,
      });
      if (settings.pending) {
        void sendPriceChangeEmailToAllOwners({
          oldPriceArs,
          newPriceArs: settings.pending.priceArs,
          effectiveAt: new Date(settings.pending.effectiveAt),
        });
      }
      res.json({
        ...settings,
        windowDays: env.PRICE_CHANGE_WINDOW_DAYS,
      });
    } catch (err) {
      if (err instanceof PendingChangeExistsError) {
        return res.status(409).json({
          error: 'ya hay un cambio de precio pendiente; cancelalo primero',
          pending: err.pending,
        });
      }
      if (err instanceof NoChangeError) {
        return res
          .status(400)
          .json({ error: 'el precio nuevo coincide con el vigente' });
      }
      const msg = err instanceof Error ? err.message : 'error';
      // eslint-disable-next-line no-console
      console.error('[platform-settings] schedule error:', err);
      res.status(500).json({ error: msg });
    }
  },
);

/**
 * Cancela el cambio de precio pendiente (si lo hay). Si había pendiente, se
 * avisa por email a los owners para cerrar el loop.
 */
router.delete(
  '/system/platform-settings/pending',
  requireSystemAdmin,
  async (_req, res) => {
    const { settings, cancelled } = await cancelPendingPriceChange();
    if (cancelled) {
      void sendPriceChangeCancelledEmailToAllOwners({
        currentPriceArs: settings.current.subscriptionPriceArs,
        cancelledPriceArs: cancelled.priceArs,
        cancelledEffectiveAt: new Date(cancelled.effectiveAt),
      });
    }
    res.json({ ...settings, windowDays: env.PRICE_CHANGE_WINDOW_DAYS });
  },
);

/**
 * Dev-only: ejecuta el `priceChangeJob` al instante para validar el flujo sin
 * esperar el tick del scheduler. Disponible sólo en entornos no productivos o
 * con `MP_MOCK_PREAPPROVAL_STATUS` definido (modo E2E).
 */
router.post(
  '/system/platform-settings/run-job',
  requireSystemAdmin,
  async (_req, res) => {
    const isDev = process.env.NODE_ENV !== 'production';
    const isMock = Boolean(env.MP_MOCK_PREAPPROVAL_STATUS);
    if (!isDev && !isMock) {
      return res.status(404).json({ error: 'no disponible' });
    }
    await runPriceChangeJob();
    res.json({ ok: true });
  },
);

/**
 * Test-only: permite a los E2E cambiar `MP_MOCK_PREAPPROVAL_STATUS` en caliente
 * para ejercitar el webhook con distintos estados sin reiniciar el proceso.
 *
 * Solo se habilita si el server arrancó con algún valor inicial en
 * `MP_MOCK_PREAPPROVAL_STATUS` (marca de "modo E2E") y requiere el JWT de
 * super-admin. Si no está habilitado responde 404 para no filtrar información.
 */
router.post('/system/e2e/mp-mock', requireSystemAdmin, (req, res) => {
  if (!env.MP_MOCK_PREAPPROVAL_STATUS) {
    return res.status(404).json({ error: 'no disponible' });
  }
  const { status } = (req.body ?? {}) as { status?: string };
  const allowed = ['authorized', 'paused', 'cancelled', 'pending'];
  if (!status || !allowed.includes(status)) {
    return res
      .status(400)
      .json({ error: 'status inválido', allowed });
  }
  process.env.MP_MOCK_PREAPPROVAL_STATUS = status;
  res.json({ ok: true, status });
});

router.post('/shops/register', async (req, res) => {
  const parsed = RegisterShopBody.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: formatZodError(parsed.error) });
  try {
    const out = await registerShopAndOwner({
      slug: parsed.data.slug,
      shopName: parsed.data.shopName,
      ownerEmail: parsed.data.ownerEmail,
      ownerPassword: parsed.data.ownerPassword,
      timezone: parsed.data.timezone,
    });
    res.status(201).json({
      shopId: out.shopId,
      slug: out.slug,
    });
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err.code === '23505') {
      return res.status(409).json({ error: 'ese identificador de local ya está en uso' });
    }
    const msg = e instanceof Error ? e.message : 'error al registrar';
    res.status(500).json({ error: msg });
  }
});

