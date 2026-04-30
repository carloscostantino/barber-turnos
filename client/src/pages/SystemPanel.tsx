import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE } from '../config'
import {
  clearSystemAdminToken,
  getSystemAdminToken,
} from '../systemAdminToken'
import ConfirmDialog from '../components/ConfirmDialog'
import { formatArsWhole } from '../lib/format'

type ShopStatus = 'active' | 'trial' | 'suspended'

type ShopOverview = {
  id: string
  slug: string
  name: string
  status: ShopStatus
  timezone: string
  created_at: string
  trial_ends_at: string | null
  owner_email: string | null
  subscription_status: string | null
  subscription_provider: string | null
  current_period_end: string | null
  total_appointments: number
  appointments_this_month: number
}

const trialBadge = (trialEndsAt: string | null): string | null => {
  if (!trialEndsAt) return null
  const ms = new Date(trialEndsAt).getTime() - Date.now()
  if (Number.isNaN(ms)) return null
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000))
  if (days < 0) return `vencido hace ${Math.abs(days)} d`
  if (days === 0) return 'vence hoy'
  if (days === 1) return '1 día'
  return `${days} días`
}

const STATUS_OPTIONS: Array<{ value: ShopStatus; label: string }> = [
  { value: 'active', label: 'Activa' },
  { value: 'trial', label: 'Prueba' },
  { value: 'suspended', label: 'Suspendida' },
]

const statusBadgeClass = (s: ShopStatus): string => {
  switch (s) {
    case 'active':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-700/60'
    case 'trial':
      return 'bg-amber-500/15 text-amber-300 border-amber-700/60'
    case 'suspended':
      return 'bg-red-500/15 text-red-300 border-red-700/60'
  }
}

const formatDate = (iso: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('es-AR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

/** Texto legible para PRICE_CHANGE_WINDOW_DAYS (evita “0 días de anticipación”). */
function describePriceChangeWindowDays(days: number | undefined): string {
  if (days === undefined || Number.isNaN(days)) {
    return 'La ventana de anticipación la define el servidor (variable PRICE_CHANGE_WINDOW_DAYS).'
  }
  if (days === 0) {
    return 'Ventana actual: 0 días — la fecha efectiva se calcula al programar el cambio (comportamiento típico en pruebas locales). El job horario aplica el nuevo precio en Mercado Pago cuando esa fecha ya venció.'
  }
  if (days === 1) {
    return 'Ventana actual: 1 día de anticipación desde el momento en que programás el cambio.'
  }
  return `Ventana actual: ${days} días de anticipación desde el momento en que programás el cambio.`
}

type PlatformSettings = {
  current: {
    subscriptionPriceArs: number
    subscriptionReason: string
    updatedAt: string
  }
  pending: { priceArs: number; effectiveAt: string } | null
  windowDays: number
}

type PlatformSettingsCardProps = {
  authHeader: Record<string, string>
  handleUnauthorized: () => void
}

type PendingConfirm =
  | { kind: 'schedule'; priceArs: number; effectiveAt: Date }
  | { kind: 'cancel'; pendingPriceArs: number }

function PlatformSettingsCard({
  authHeader,
  handleUnauthorized,
}: PlatformSettingsCardProps) {
  const [settings, setSettings] = useState<PlatformSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [newPrice, setNewPrice] = useState('')
  const [busy, setBusy] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(
    null,
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/system/platform-settings`, {
        headers: authHeader,
      })
      if (res.status === 401 || res.status === 403) {
        handleUnauthorized()
        return
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(data?.error ?? 'No se pudo cargar la configuración')
      }
      const data = (await res.json()) as PlatformSettings
      setSettings(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setLoading(false)
    }
  }, [authHeader, handleUnauthorized])

  useEffect(() => {
    void load()
  }, [load])

  const requestSchedule = () => {
    if (!settings) return
    const parsed = Number(newPrice)
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
      setError('Ingresá un precio válido (entero, en ARS).')
      return
    }
    if (parsed === settings.current.subscriptionPriceArs) {
      setError('El precio nuevo coincide con el vigente.')
      return
    }
    setError(null)
    setNotice(null)
    const effective = new Date()
    effective.setDate(effective.getDate() + settings.windowDays)
    setPendingConfirm({ kind: 'schedule', priceArs: parsed, effectiveAt: effective })
  }

  const requestCancel = () => {
    if (!settings?.pending) return
    setError(null)
    setNotice(null)
    setPendingConfirm({
      kind: 'cancel',
      pendingPriceArs: settings.pending.priceArs,
    })
  }

  const confirmSchedule = async (priceArs: number) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`${API_BASE}/system/platform-settings/price`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ subscriptionPriceArs: priceArs }),
      })
      if (res.status === 401 || res.status === 403) {
        handleUnauthorized()
        return
      }
      const data = (await res.json().catch(() => null)) as
        | (PlatformSettings & { error?: string })
        | { error?: string }
        | null
      if (!res.ok) {
        throw new Error(data?.error ?? 'No se pudo programar el cambio')
      }
      setSettings(data as PlatformSettings)
      setNewPrice('')
      setNotice('Cambio programado. Se está notificando a los dueños.')
      setPendingConfirm(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
      setPendingConfirm(null)
    } finally {
      setBusy(false)
    }
  }

  const confirmCancel = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(
        `${API_BASE}/system/platform-settings/pending`,
        { method: 'DELETE', headers: authHeader },
      )
      if (res.status === 401 || res.status === 403) {
        handleUnauthorized()
        return
      }
      const data = (await res.json().catch(() => null)) as
        | (PlatformSettings & { error?: string })
        | null
      if (!res.ok) {
        throw new Error(data?.error ?? 'No se pudo cancelar el cambio')
      }
      setSettings(data)
      setNotice('Cambio cancelado. Se está notificando a los dueños.')
      setPendingConfirm(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
      setPendingConfirm(null)
    } finally {
      setBusy(false)
    }
  }

  const pending = settings?.pending
  const hasPending = Boolean(pending)

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-100">
            Configuración de plataforma
          </h2>
          <p className="text-xs text-slate-500 leading-relaxed">
            Precio mensual de la suscripción en Mercado Pago. Al programar un
            cambio, se envía un email a todos los dueños con el precio nuevo y la
            fecha efectiva. {describePriceChangeWindowDays(settings?.windowDays)}
            {settings?.windowDays !== undefined && (
              <>
                {' '}
                Valor en servidor:{' '}
                <code className="text-slate-400">
                  PRICE_CHANGE_WINDOW_DAYS={settings.windowDays}
                </code>
                .
              </>
            )}
          </p>
        </div>
      </header>

      {loading && (
        <p className="text-sm text-slate-400">Cargando configuración…</p>
      )}

      {!loading && settings && (
        <div className="grid gap-4 md:grid-cols-[auto_1fr]">
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">
              Precio vigente
            </div>
            <div className="text-2xl font-semibold text-slate-100 tabular-nums">
              {formatArsWhole(settings.current.subscriptionPriceArs)}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Actualizado {formatDate(settings.current.updatedAt)}
            </div>
          </div>

          <div className="space-y-3">
            {hasPending && pending ? (
              <div className="rounded-lg border border-amber-800/70 bg-amber-950/30 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-amber-200 font-medium">
                    Cambio programado: pasa a {formatArsWhole(pending.priceArs)} el{' '}
                    {formatDate(pending.effectiveAt)}
                  </div>
                  <p className="text-xs text-amber-400/80 mt-0.5">
                    Todos los dueños ya fueron notificados por email.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={requestCancel}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-md text-xs font-medium text-amber-200 border border-amber-700/70 hover:bg-amber-900/30 disabled:opacity-50"
                >
                  {busy ? 'Cancelando…' : 'Cancelar cambio'}
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                No hay cambios programados.
              </p>
            )}

            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="new-price"
                  className="text-xs text-slate-400"
                >
                  Precio nuevo (ARS)
                </label>
                <input
                  id="new-price"
                  type="number"
                  min={1}
                  step={1}
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  disabled={hasPending || busy}
                  placeholder="5999"
                  className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm min-w-[10rem] disabled:opacity-50"
                />
              </div>
              <button
                type="button"
                onClick={requestSchedule}
                disabled={hasPending || busy || newPrice.trim() === ''}
                className="px-4 py-2 rounded-md text-sm font-medium bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                title={
                  hasPending
                    ? 'Cancelá el cambio pendiente antes de programar uno nuevo'
                    : undefined
                }
              >
                {busy ? 'Programando…' : 'Programar'}
              </button>
            </div>
            {hasPending && (
              <p className="text-xs text-slate-500">
                Cancelá el cambio pendiente para programar uno nuevo.
              </p>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-400 bg-red-950/50 border border-red-800 rounded px-3 py-2">
          {error}
        </p>
      )}
      {notice && (
        <p className="text-sm text-emerald-300 bg-emerald-950/40 border border-emerald-800 rounded px-3 py-2">
          {notice}
        </p>
      )}

      <ConfirmDialog
        open={pendingConfirm?.kind === 'schedule'}
        title="Programar cambio de precio"
        message={
          pendingConfirm?.kind === 'schedule'
            ? `El precio mensual pasará a ${formatArsWhole(pendingConfirm.priceArs)} a partir del ${pendingConfirm.effectiveAt.toLocaleDateString(
                'es-AR',
                { year: 'numeric', month: 'long', day: 'numeric' },
              )}.\n\nSe enviará un email a todos los dueños con el aviso.`
            : ''
        }
        confirmLabel={busy ? 'Programando…' : 'Programar'}
        cancelLabel="Volver"
        busy={busy}
        onConfirm={() => {
          if (pendingConfirm?.kind === 'schedule') {
            void confirmSchedule(pendingConfirm.priceArs)
          }
        }}
        onCancel={() => {
          if (!busy) setPendingConfirm(null)
        }}
      />

      <ConfirmDialog
        open={pendingConfirm?.kind === 'cancel'}
        title="Cancelar cambio programado"
        message={
          pendingConfirm?.kind === 'cancel'
            ? `Se cancelará el cambio programado a ${formatArsWhole(pendingConfirm.pendingPriceArs)}.\n\nSe enviará un email a todos los dueños avisando que el precio no cambia.`
            : ''
        }
        confirmLabel={busy ? 'Cancelando…' : 'Cancelar cambio'}
        cancelLabel="Volver"
        confirmDanger
        busy={busy}
        onConfirm={() => {
          if (pendingConfirm?.kind === 'cancel') void confirmCancel()
        }}
        onCancel={() => {
          if (!busy) setPendingConfirm(null)
        }}
      />
    </section>
  )
}

export default function SystemPanel() {
  const navigate = useNavigate()
  const [shops, setShops] = useState<ShopOverview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const authHeader = useMemo<Record<string, string>>(() => {
    const t = getSystemAdminToken()
    const headers: Record<string, string> = {}
    if (t) headers.Authorization = `Bearer ${t}`
    return headers
  }, [])

  const handleUnauthorized = useCallback(() => {
    clearSystemAdminToken()
    navigate('/system/login', { replace: true })
  }, [navigate])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/system/shops`, {
        headers: authHeader,
      })
      if (res.status === 401 || res.status === 403) {
        handleUnauthorized()
        return
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(data?.error ?? 'No se pudieron cargar las barberías')
      }
      const data = (await res.json()) as ShopOverview[]
      setShops(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setLoading(false)
    }
  }, [authHeader, handleUnauthorized])

  useEffect(() => {
    void load()
  }, [load])

  const updateStatus = async (shop: ShopOverview, nextStatus: ShopStatus) => {
    if (shop.status === nextStatus) return
    const prevStatus = shop.status
    setUpdatingId(shop.id)
    setError(null)
    setShops((prev) =>
      prev.map((s) => (s.id === shop.id ? { ...s, status: nextStatus } : s)),
    )
    try {
      const res = await fetch(`${API_BASE}/system/shops/${shop.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ status: nextStatus }),
      })
      if (res.status === 401 || res.status === 403) {
        handleUnauthorized()
        return
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(data?.error ?? 'No se pudo actualizar el estado')
      }
    } catch (e) {
      setShops((prev) =>
        prev.map((s) =>
          s.id === shop.id ? { ...s, status: prevStatus } : s,
        ),
      )
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setUpdatingId(null)
    }
  }

  const logout = () => {
    clearSystemAdminToken()
    navigate('/system/login', { replace: true })
  }

  const visibleShops = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return shops
    return shops.filter(
      (s) =>
        s.slug.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        (s.owner_email ?? '').toLowerCase().includes(q),
    )
  }, [shops, filter])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <nav className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 flex flex-wrap items-center gap-2 py-3">
          <span className="text-slate-200 text-sm font-semibold mr-2">
            Panel del sistema
          </span>
          <span className="text-slate-500 text-xs hidden sm:inline">
            super-admin
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="px-3 py-1.5 rounded-md text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800/60 disabled:opacity-50"
            >
              {loading ? 'Cargando…' : 'Refrescar'}
            </button>
            <button
              type="button"
              onClick={logout}
              className="px-3 py-1.5 rounded-md text-sm font-medium text-slate-400 hover:text-red-300 hover:bg-slate-800/60"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <PlatformSettingsCard
          authHeader={authHeader}
          handleUnauthorized={handleUnauthorized}
        />

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="filter" className="text-xs text-slate-400">
              Buscar (nombre, slug o email)
            </label>
            <input
              id="filter"
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="barberia, barberia-norte, dueño@…"
              className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm min-w-[16rem]"
            />
          </div>
          <p className="text-xs text-slate-500 ml-auto">
            {visibleShops.length} de {shops.length} barberías
          </p>
        </div>

        {error && (
          <p className="text-sm text-red-400 bg-red-950/50 border border-red-800 rounded px-3 py-2">
            {error}
          </p>
        )}

        <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/80 text-slate-300 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Barbería</th>
                <th className="text-left px-4 py-3 font-medium">Estado</th>
                <th className="text-left px-4 py-3 font-medium">Dueño</th>
                <th className="text-left px-4 py-3 font-medium">Suscripción</th>
                <th className="text-right px-4 py-3 font-medium">Turnos (mes / total)</th>
                <th className="text-left px-4 py-3 font-medium">Alta</th>
                <th className="text-right px-4 py-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {!loading && visibleShops.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-6 text-center text-slate-500"
                  >
                    {shops.length === 0
                      ? 'No hay barberías registradas todavía.'
                      : 'Ninguna barbería coincide con el filtro.'}
                  </td>
                </tr>
              )}
              {visibleShops.map((shop) => (
                <tr key={shop.id} className="hover:bg-slate-900/40">
                  <td className="px-4 py-3 align-top">
                    <div className="font-medium text-slate-100">{shop.name}</div>
                    <div className="text-xs text-slate-500 font-mono">
                      /{shop.slug}
                    </div>
                    <div className="text-xs text-slate-600">{shop.timezone}</div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="flex flex-col gap-1.5">
                      <span
                        className={`inline-flex items-center justify-center text-xs px-2 py-0.5 rounded-full border w-fit ${statusBadgeClass(shop.status)}`}
                      >
                        {STATUS_OPTIONS.find((o) => o.value === shop.status)?.label ?? shop.status}
                      </span>
                      {shop.status === 'trial' && trialBadge(shop.trial_ends_at) && (
                        <span className="text-[11px] text-amber-400">
                          Prueba: {trialBadge(shop.trial_ends_at)}
                        </span>
                      )}
                      <select
                        value={shop.status}
                        disabled={updatingId === shop.id}
                        onChange={(e) =>
                          void updateStatus(
                            shop,
                            e.target.value as ShopStatus,
                          )
                        }
                        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs disabled:opacity-50"
                      >
                        {STATUS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top text-slate-300">
                    {shop.owner_email ?? (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-slate-300">
                    {shop.subscription_status ? (
                      <>
                        <div className="capitalize">
                          {shop.subscription_status}
                        </div>
                        {shop.subscription_provider && (
                          <div className="text-xs text-slate-500 capitalize">
                            {shop.subscription_provider}
                          </div>
                        )}
                        {shop.current_period_end && (
                          <div className="text-xs text-slate-500">
                            Hasta {formatDate(shop.current_period_end)}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-slate-600">Sin plan</span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-right tabular-nums">
                    <span className="text-slate-100">
                      {shop.appointments_this_month}
                    </span>
                    <span className="text-slate-500"> / {shop.total_appointments}</span>
                  </td>
                  <td className="px-4 py-3 align-top text-slate-300">
                    {formatDate(shop.created_at)}
                  </td>
                  <td className="px-4 py-3 align-top text-right">
                    <a
                      href={`/s/${shop.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-violet-300 hover:text-violet-200 text-xs font-medium"
                    >
                      Abrir reserva ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
