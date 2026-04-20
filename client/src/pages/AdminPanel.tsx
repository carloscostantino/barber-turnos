import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom'
import {
  clearAdminSession,
  getAdminTokenForSlug,
} from '../adminToken'
import { DEFAULT_SHOP_SLUG, shopAdminPath, shopPublicPath } from '../config'
import { whatsappHrefFromPhone } from '../lib/contact'
import { formatBlockedRangeDisplay } from '../lib/blockedRangeDisplay'
import {
  dayRangeIso,
  formatDate,
  formatPesosArFromCents,
  formatTime,
  listFutureTurnosRangeIso,
  toInputDate,
} from '../lib/format'
import AdminLogin from './AdminLogin'
import { isOnboardingDone, setOnboardingDone } from '../lib/onboardingStorage'

/** Limpia sesión y recarga la app: evita estado React colgado si el JWT ya no sirve (401). */
function reloadToLogin() {
  clearAdminSession()
  window.location.reload()
}

function normalizeStoredToken(raw: string | null): string | null {
  if (!raw) return null
  const parts = raw.split('.')
  if (parts.length !== 3 || parts.some((p) => !p)) {
    clearAdminSession()
    return null
  }
  return raw
}

type AppointmentRow = {
  id: string
  starts_at: string
  ends_at: string
  status: string
  attended: boolean | null
  notes: string | null
  service_name: string
  customer_name: string
  customer_phone: string
  customer_email: string | null
}

type AppointmentStatus = 'confirmed' | 'cancelled'

type AdminTab =
  | 'turnos'
  | 'configuracion'
  | 'horarios'
  | 'servicios'
  | 'bloqueos'

const ADMIN_TAB_IDS: AdminTab[] = [
  'turnos',
  'configuracion',
  'horarios',
  'servicios',
  'bloqueos',
]

function tabFromQueryParam(raw: string | null): AdminTab {
  if (raw && ADMIN_TAB_IDS.includes(raw as AdminTab)) return raw as AdminTab
  return 'turnos'
}

type TurnosViewMode = 'dia' | 'lista'

const DAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

/** Confirmación en pantalla (sin `window.confirm`). */
function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Continuar',
  cancelLabel = 'Cancelar',
  confirmDanger,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** Estilo rojo para acciones destructivas. */
  confirmDanger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/55 backdrop-blur-[1px]"
        aria-label="Cerrar"
        onClick={onCancel}
      />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-slate-600/80 bg-slate-900 p-5 shadow-2xl shadow-black/40">
        <h3
          id="confirm-dialog-title"
          className="text-base font-semibold text-slate-100"
        >
          {title}
        </h3>
        <p className="mt-2 text-sm text-slate-400 leading-relaxed">{message}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-sm px-3 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`text-sm px-3 py-2 rounded-lg font-medium ${
              confirmDanger
                ? 'bg-red-600 hover:bg-red-500 text-white'
                : 'bg-violet-600 hover:bg-violet-500 text-white'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function statusLabel(s: string) {
  if (s === 'confirmed') return 'Confirmado'
  if (s === 'cancelled') return 'Cancelado'
  return s
}

function statusClass(s: string) {
  if (s === 'confirmed')
    return 'bg-emerald-950/50 text-emerald-200 border-emerald-700'
  return 'bg-slate-800 text-slate-400 border-slate-600'
}

function attendanceLabel(v: boolean | null | undefined): string {
  if (v === true) return 'Sí'
  if (v === false) return 'No'
  return 'Sin marcar'
}

function appointmentSearchHaystack(r: AppointmentRow): string {
  return [
    r.service_name,
    r.customer_name,
    r.customer_phone,
    r.customer_email ?? '',
    r.notes ?? '',
    statusLabel(r.status),
    attendanceLabel(r.attended),
    formatDate(r.starts_at),
    formatTime(r.starts_at),
  ]
    .join(' ')
    .toLowerCase()
}

function ContactLinks({
  phone,
  email,
}: {
  phone: string
  email: string | null
}) {
  const wa = whatsappHrefFromPhone(phone)
  return (
    <>
      <div>
        {wa ? (
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-300 hover:text-emerald-400 underline-offset-2 hover:underline"
          >
            {phone}
          </a>
        ) : (
          phone
        )}
      </div>
      {email && (
        <div className="truncate max-w-[200px]" title={email}>
          <a
            href={`mailto:${encodeURIComponent(email)}`}
            className="text-slate-300 hover:text-emerald-400 underline-offset-2 hover:underline"
          >
            {email}
          </a>
        </div>
      )}
    </>
  )
}

export default function AdminPanel() {
  const { shopSlug: shopSlugParam } = useParams()
  const shopSlug = shopSlugParam ?? DEFAULT_SHOP_SLUG

  const [token, setToken] = useState<string | null>(() =>
    normalizeStoredToken(getAdminTokenForSlug(shopSlug)),
  )

  /**
   * Si el slug cambia (navegación entre locales) el token previo, aunque
   * válido, pertenece a otra shop: lo descartamos aquí para obligar a hacer
   * login contra la shop correcta. El servidor ya rechaza el cross-shop con
   * 403, pero esto evita el 403 en la primera request y muestra el login
   * directamente.
   */
  useEffect(() => {
    const fresh = normalizeStoredToken(getAdminTokenForSlug(shopSlug))
    setToken(fresh)
  }, [shopSlug])

  const onSessionInvalid = useCallback(() => {
    clearAdminSession()
    setToken(null)
  }, [])

  const onLoggedIn = useCallback(() => {
    setToken(normalizeStoredToken(getAdminTokenForSlug(shopSlug)))
  }, [shopSlug])

  if (!token) {
    return <AdminLogin shopSlug={shopSlug} onLoggedIn={onLoggedIn} />
  }

  return (
    <AdminAuthenticatedPanel
      token={token}
      onSessionInvalid={onSessionInvalid}
      shopSlug={shopSlug}
    />
  )
}

function AdminAuthenticatedPanel({
  token,
  onSessionInvalid,
  shopSlug,
}: {
  token: string
  onSessionInvalid: () => void
  shopSlug: string
}) {
  const [turnosViewMode, setTurnosViewMode] = useState<TurnosViewMode>('lista')
  const [date, setDate] = useState(() => toInputDate(new Date()))
  const [rows, setRows] = useState<AppointmentRow[]>([])
  const [turnosSearch, setTurnosSearch] = useState('')
  const [turnosFilterStatus, setTurnosFilterStatus] = useState<
    'all' | AppointmentStatus
  >('all')
  const [turnosFilterService, setTurnosFilterService] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<AppointmentRow | null>(
    null,
  )
  const [cancelNote, setCancelNote] = useState('')
  const [attendanceUpdatingId, setAttendanceUpdatingId] = useState<
    string | null
  >(null)
  const [shopName, setShopName] = useState<string | null>(null)
  type BillingInfo = {
    configured: boolean
    provider: 'none' | 'stripe' | 'mercadopago'
    status: string
    currentPeriodEnd: string | null
    hasInitPoint: boolean
    initPoint: string | null
  }
  type TrialStatus = {
    status: 'active' | 'trial' | 'suspended'
    trialEndsAt: string | null
    daysLeft: number | null
    restricted?: boolean
    billing?: BillingInfo
  }
  const [trialStatus, setTrialStatus] = useState<TrialStatus | null>(null)
  const [billingError, setBillingError] = useState<string | null>(null)
  const [billingLoading, setBillingLoading] = useState(false)
  const [billingToast, setBillingToast] = useState<string | null>(null)
  const [trialReloadNonce, setTrialReloadNonce] = useState(0)

  const authHeader = useMemo(
    () => ({ Authorization: `Bearer ${token}` }),
    [token],
  )

  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()

  /** Nombre del local para el encabezado ("Hola, {nombre}"); cae a "Panel admin" si no hay. */
  useEffect(() => {
    let cancelled = false
    setShopName(null)
    fetch(shopPublicPath(shopSlug, 'public-settings'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { shopName?: string | null } | null) => {
        if (cancelled) return
        const raw = d?.shopName?.trim()
        setShopName(raw && raw.length > 0 ? raw : null)
      })
      .catch(() => {
        /* cae al fallback */
      })
    return () => {
      cancelled = true
    }
  }, [shopSlug])

  /** Estado del trial para el banner "tu prueba termina en N días". */
  useEffect(() => {
    let cancelled = false
    setTrialStatus(null)
    fetch(shopAdminPath(shopSlug, 'trial-status'), { headers: authHeader })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: TrialStatus | null) => {
        if (cancelled || !d) return
        setTrialStatus(d)
      })
      .catch(() => {
        /* silencioso: banner no es crítico */
      })
    return () => {
      cancelled = true
    }
  }, [shopSlug, authHeader, trialReloadNonce])

  /**
   * Al volver desde Mercado Pago con ?billing=success, refrescar el estado y
   * mostrar un toast; al completar la suscripción el webhook ya habrá
   * actualizado shops.status.
   */
  useEffect(() => {
    const billingFlag = searchParams.get('billing')
    if (billingFlag === 'success') {
      setBillingToast('Suscripción activada. Gracias por sumarte.')
      setTrialReloadNonce((n) => n + 1)
      const next = new URLSearchParams(searchParams)
      next.delete('billing')
      navigate(
        { pathname: location.pathname, search: next.toString() },
        { replace: true },
      )
    }
  }, [searchParams, navigate, location.pathname])

  const startBillingSubscribe = useCallback(async () => {
    setBillingError(null)
    setBillingLoading(true)
    try {
      const res = await fetch(shopAdminPath(shopSlug, 'billing/subscribe'), {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
      })
      const data = (await res.json().catch(() => null)) as {
        initPoint?: string
        error?: string
      } | null
      if (!res.ok || !data?.initPoint) {
        throw new Error(data?.error ?? 'No se pudo iniciar la suscripción')
      }
      window.location.href = data.initPoint
    } catch (e) {
      setBillingError(e instanceof Error ? e.message : 'Error en facturación')
      setBillingLoading(false)
    }
  }, [shopSlug, authHeader])

  const [tab, setTab] = useState<AdminTab>(() =>
    tabFromQueryParam(searchParams.get('tab')),
  )
  const [showOnboarding, setShowOnboarding] = useState(
    () =>
      searchParams.get('onboarding') === '1' &&
      !isOnboardingDone(shopSlug),
  )

  const finishOnboarding = useCallback(() => {
    setOnboardingDone(shopSlug)
    setShowOnboarding(false)
    const next = new URLSearchParams(searchParams)
    next.delete('onboarding')
    const qs = next.toString()
    navigate(
      { pathname: location.pathname, search: qs ? `?${qs}` : '' },
      { replace: true },
    )
  }, [shopSlug, searchParams, navigate, location.pathname])

  const loadAppointments = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setError(null)
        setLoading(true)
        const { from, to } =
          turnosViewMode === 'dia'
            ? dayRangeIso(date)
            : listFutureTurnosRangeIso()
        const params = new URLSearchParams({ from, to })
        let res: Response
        try {
          res = await fetch(shopAdminPath(shopSlug, `appointments?${params}`), {
            headers: authHeader,
            signal,
          })
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return
          throw e
        }
        if (res.status === 401) {
          reloadToLogin()
          return
        }
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as {
            error?: string
          } | null
          throw new Error(data?.error ?? 'No se pudieron cargar los turnos')
        }
        setRows((await res.json()) as AppointmentRow[])
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'Error cargando turnos')
        setRows([])
      } finally {
        setLoading(false)
      }
    },
    [token, date, turnosViewMode],
  )

  const filteredRows = useMemo(() => {
    const q = turnosSearch.trim().toLowerCase()
    return rows.filter((r) => {
      if (turnosFilterStatus !== 'all' && r.status !== turnosFilterStatus) {
        return false
      }
      if (turnosFilterService && r.service_name !== turnosFilterService) {
        return false
      }
      if (!q) return true
      return appointmentSearchHaystack(r).includes(q)
    })
  }, [rows, turnosSearch, turnosFilterStatus, turnosFilterService])

  const serviceNamesInRows = useMemo(() => {
    const s = new Set(rows.map((r) => r.service_name))
    return [...s].sort((a, b) => a.localeCompare(b, 'es'))
  }, [rows])

  useEffect(() => {
    if (tab !== 'turnos') return
    const ac = new AbortController()
    void loadAppointments(ac.signal)
    return () => ac.abort()
  }, [loadAppointments, tab])

  const patchStatus = async (id: string, status: AppointmentStatus) => {
    try {
      setUpdatingId(id)
      setError(null)
      const res = await fetch(shopAdminPath(shopSlug, `appointments/${id}/status`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
        },
        body: JSON.stringify({ status }),
      })
      if (res.status === 401) {
        reloadToLogin()
        return
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(data?.error ?? 'No se pudo actualizar')
      }
      await loadAppointments()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al actualizar')
    } finally {
      setUpdatingId(null)
    }
  }

  const patchAttendance = async (
    id: string,
    attended: boolean | null,
  ) => {
    try {
      setAttendanceUpdatingId(id)
      setError(null)
      const res = await fetch(shopAdminPath(shopSlug, `appointments/${id}/attendance`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
        },
        body: JSON.stringify({ attended }),
      })
      if (res.status === 401) {
        reloadToLogin()
        return
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(data?.error ?? 'No se pudo guardar')
      }
      await loadAppointments()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setAttendanceUpdatingId(null)
    }
  }

  const openCancelModal = (id: string) => {
    const row = rows.find((r) => r.id === id)
    if (row) {
      setCancelNote('')
      setCancelTarget(row)
    }
  }

  const submitCancel = async () => {
    if (!cancelTarget) return
    const id = cancelTarget.id
    try {
      setUpdatingId(id)
      setError(null)
      const note = cancelNote.trim()
      const res = await fetch(shopAdminPath(shopSlug, `appointments/${id}/status`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
        },
        body: JSON.stringify({
          status: 'cancelled' satisfies AppointmentStatus,
          cancellationNote: note || undefined,
        }),
      })
      if (res.status === 401) {
        reloadToLogin()
        return
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(data?.error ?? 'No se pudo cancelar')
      }
      setCancelTarget(null)
      setCancelNote('')
      await loadAppointments()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cancelar')
    } finally {
      setUpdatingId(null)
    }
  }

  const tabBtn = (id: AdminTab, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setTab(id)}
      className={`text-sm px-3 py-2 rounded border transition-colors ${
        tab === id
          ? 'bg-violet-600 border-violet-500 text-white'
          : 'border-slate-600 text-slate-300 hover:bg-slate-800'
      }`}
    >
      {label}
    </button>
  )

  return (
    <>
      {showOnboarding && (
        <AdminOnboardingOverlay
          authHeader={authHeader}
          onFinish={finishOnboarding}
          shopSlug={shopSlug}
        />
      )}
      <div className="flex justify-center px-4">
      <div className="w-full max-w-6xl py-10">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              {shopName ? `Hola, ${shopName}` : 'Panel admin'}
            </h1>
            <p className="text-slate-400 mt-1">
              Panel de administración · turnos, configuración del local,
              horarios, servicios y bloqueos.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              onSessionInvalid()
            }}
            className="shrink-0 text-sm px-4 py-2 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 transition-colors"
          >
            Cerrar sesión
          </button>
        </header>

        {billingToast && (
          <div
            role="status"
            className="mb-4 rounded-lg border border-emerald-700 bg-emerald-950/40 text-emerald-200 px-4 py-3 text-sm flex items-center justify-between"
          >
            <span>{billingToast}</span>
            <button
              type="button"
              onClick={() => setBillingToast(null)}
              className="text-xs text-emerald-300/70 hover:text-emerald-200"
            >
              Cerrar
            </button>
          </div>
        )}

        {trialStatus?.status === 'trial' && trialStatus.daysLeft != null && (
          <div
            role="status"
            className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
              trialStatus.daysLeft <= 3
                ? 'border-amber-700 bg-amber-950/40 text-amber-200'
                : 'border-slate-700 bg-slate-900/60 text-slate-200'
            }`}
          >
            <div className="font-semibold">
              {trialStatus.daysLeft === 0
                ? 'Tu período de prueba termina hoy'
                : trialStatus.daysLeft === 1
                  ? 'Tu período de prueba termina mañana'
                  : `Tu período de prueba termina en ${trialStatus.daysLeft} días`}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              Cuando se venza, el local quedará suspendido y las reservas
              públicas se pausarán hasta activar una suscripción.
            </div>
            {trialStatus.billing?.configured && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void startBillingSubscribe()}
                  disabled={billingLoading}
                  className="text-sm px-3 py-1.5 rounded bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-400 text-white transition-colors"
                >
                  {billingLoading ? 'Redirigiendo…' : 'Activar suscripción'}
                </button>
                {billingError && (
                  <span className="text-xs text-red-300">{billingError}</span>
                )}
              </div>
            )}
          </div>
        )}

        {trialStatus?.status === 'suspended' && (
          <div
            role="alert"
            className="mb-6 rounded-lg border border-red-700 bg-red-950/40 text-red-200 px-4 py-4 text-sm"
          >
            <div className="font-semibold">Este local está suspendido</div>
            <div className="text-xs text-red-300/80 mt-0.5">
              Las reservas públicas están pausadas. Activá una suscripción para
              reanudar el servicio.
            </div>
            {trialStatus.billing?.configured ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void startBillingSubscribe()}
                  disabled={billingLoading}
                  className="text-sm px-3 py-1.5 rounded bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-400 text-white transition-colors"
                >
                  {billingLoading ? 'Redirigiendo…' : 'Activar suscripción'}
                </button>
                {billingError && (
                  <span className="text-xs text-red-300">{billingError}</span>
                )}
              </div>
            ) : (
              <div className="mt-2 text-xs text-red-300/80">
                Contactá a soporte para reactivar el local.
              </div>
            )}
          </div>
        )}

        {!trialStatus?.restricted && (
          <div className="flex flex-wrap gap-2 mb-6">
            {tabBtn('turnos', 'Turnos')}
            {tabBtn('configuracion', 'Configuración')}
            {tabBtn('horarios', 'Horarios')}
            {tabBtn('servicios', 'Servicios')}
            {tabBtn('bloqueos', 'Bloqueos')}
          </div>
        )}

        {trialStatus?.restricted && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center text-slate-200">
            <h2 className="text-xl font-semibold mb-2">
              Acceso limitado a facturación
            </h2>
            <p className="text-sm text-slate-400 max-w-prose mx-auto">
              Mientras el local esté suspendido solo podés administrar la
              suscripción. Una vez confirmado el cobro se reactivan todas las
              opciones del panel.
            </p>
          </div>
        )}

        {!trialStatus?.restricted && tab === 'turnos' && (
          <>
            <DashboardPanel authHeader={authHeader} shopSlug={shopSlug} />
            <div className="flex flex-wrap gap-2 items-center mb-4">
              <span className="text-sm text-slate-500">Vista</span>
              <button
                type="button"
                onClick={() => setTurnosViewMode('lista')}
                className={`text-sm px-3 py-1.5 rounded border transition-colors ${
                  turnosViewMode === 'lista'
                    ? 'bg-violet-600 border-violet-500 text-white'
                    : 'border-slate-600 text-slate-300 hover:bg-slate-800'
                }`}
              >
                Próximos turnos
              </button>
              <button
                type="button"
                onClick={() => setTurnosViewMode('dia')}
                className={`text-sm px-3 py-1.5 rounded border transition-colors ${
                  turnosViewMode === 'dia'
                    ? 'bg-violet-600 border-violet-500 text-white'
                    : 'border-slate-600 text-slate-300 hover:bg-slate-800'
                }`}
              >
                Día
              </button>
            </div>

            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-4 mb-4 items-start sm:items-end">
              {turnosViewMode === 'dia' ? (
                <div className="flex flex-col gap-1">
                  <label className="text-sm text-slate-300">Fecha</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => void loadAppointments()}
                disabled={loading}
                className="text-sm px-4 py-2 rounded bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-400 transition-colors"
              >
                {loading ? 'Cargando...' : 'Actualizar'}
              </button>
            </div>

            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-4 mb-6 items-end">
              <div className="flex flex-col gap-1 flex-1 min-w-[200px] max-w-md">
                <label className="text-sm text-slate-300" htmlFor="turnos-buscar">
                  Buscar
                </label>
                <input
                  id="turnos-buscar"
                  type="search"
                  value={turnosSearch}
                  onChange={(e) => setTurnosSearch(e.target.value)}
                  placeholder="Nombre, teléfono, email, servicio…"
                  className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500"
                  autoComplete="off"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-slate-300" htmlFor="turnos-estado">
                  Estado
                </label>
                <select
                  id="turnos-estado"
                  value={turnosFilterStatus}
                  onChange={(e) =>
                    setTurnosFilterStatus(
                      e.target.value as 'all' | AppointmentStatus,
                    )
                  }
                  className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500"
                >
                  <option value="all">Todos</option>
                  <option value="confirmed">Confirmado</option>
                  <option value="cancelled">Cancelado</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-slate-300" htmlFor="turnos-servicio">
                  Servicio
                </label>
                <select
                  id="turnos-servicio"
                  value={turnosFilterService}
                  onChange={(e) => setTurnosFilterService(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500 min-w-[10rem]"
                >
                  <option value="">Todos</option>
                  {serviceNamesInRows.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-400 bg-red-950/50 border border-red-800 rounded px-3 py-2 mb-4">
                {error}
              </p>
            )}

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-900 border-b border-slate-800 text-slate-400">
                    <tr>
                      <th className="px-4 py-3 font-medium">Horario</th>
                      <th className="px-4 py-3 font-medium">Servicio</th>
                      <th className="px-4 py-3 font-medium">Cliente</th>
                      <th className="px-4 py-3 font-medium">Contacto</th>
                      <th className="px-4 py-3 font-medium">Estado</th>
                      <th className="px-4 py-3 font-medium">Asistió</th>
                      <th className="px-4 py-3 font-medium">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && !loading && (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-4 py-8 text-center text-slate-500"
                        >
                          {turnosViewMode === 'dia'
                            ? 'No hay turnos para esta fecha.'
                            : 'No hay próximos turnos.'}
                        </td>
                      </tr>
                    )}
                    {rows.length > 0 &&
                      filteredRows.length === 0 &&
                      !loading && (
                        <tr>
                          <td
                            colSpan={7}
                            className="px-4 py-8 text-center text-slate-500"
                          >
                            Ningún turno coincide con la búsqueda o los filtros.
                          </td>
                        </tr>
                      )}
                    {filteredRows.map((r) => (
                      <tr
                        key={r.id}
                        className="border-t border-slate-800/80 hover:bg-slate-900/80"
                      >
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="text-slate-200">
                            {formatTime(r.starts_at)} – {formatTime(r.ends_at)}
                          </span>
                          <div className="text-xs text-slate-500">
                            {formatDate(r.starts_at)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-300">
                          {r.service_name}
                        </td>
                        <td className="px-4 py-3 text-slate-200">
                          {r.customer_name}
                        </td>
                        <td className="px-4 py-3 text-slate-400 text-xs">
                          <ContactLinks
                            phone={r.customer_phone}
                            email={r.customer_email}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block text-xs px-2 py-0.5 rounded border ${statusClass(r.status)}`}
                          >
                            {statusLabel(r.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-400 max-w-[9rem]">
                          {r.status !== 'confirmed' ? (
                            <span className="text-slate-600">—</span>
                          ) : new Date(r.starts_at).getTime() > Date.now() ? (
                            <span
                              className="text-slate-600"
                              title="Podés marcar asistencia cuando el turno ya haya pasado"
                            >
                              —
                            </span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              <button
                                type="button"
                                disabled={attendanceUpdatingId === r.id}
                                onClick={() => void patchAttendance(r.id, true)}
                                className={`text-xs px-1.5 py-0.5 rounded border ${
                                  r.attended === true
                                    ? 'border-amber-500 text-amber-200'
                                    : 'border-slate-600 text-slate-400 hover:bg-slate-800'
                                } disabled:opacity-50`}
                              >
                                Sí
                              </button>
                              <button
                                type="button"
                                disabled={attendanceUpdatingId === r.id}
                                onClick={() => void patchAttendance(r.id, false)}
                                className={`text-xs px-1.5 py-0.5 rounded border ${
                                  r.attended === false
                                    ? 'border-amber-500 text-amber-200'
                                    : 'border-slate-600 text-slate-400 hover:bg-slate-800'
                                } disabled:opacity-50`}
                              >
                                No
                              </button>
                              <button
                                type="button"
                                disabled={
                                  attendanceUpdatingId === r.id ||
                                  r.attended === null
                                }
                                onClick={() => void patchAttendance(r.id, null)}
                                className="text-xs px-1.5 py-0.5 rounded border border-slate-700 text-slate-500 hover:bg-slate-800 disabled:opacity-40"
                                title="Quitar marca"
                              >
                                ∅
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <ActionButtons
                            status={r.status as AppointmentStatus}
                            busy={updatingId === r.id}
                            onPatch={patchStatus}
                            onRequestCancel={openCancelModal}
                            id={r.id}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden divide-y divide-slate-800">
                {rows.length === 0 && !loading && (
                  <p className="p-6 text-center text-slate-500 text-sm">
                    {turnosViewMode === 'dia'
                      ? 'No hay turnos para esta fecha.'
                      : 'No hay próximos turnos.'}
                  </p>
                )}
                {rows.length > 0 && filteredRows.length === 0 && !loading && (
                  <p className="p-6 text-center text-slate-500 text-sm">
                    Ningún turno coincide con la búsqueda o los filtros.
                  </p>
                )}
                {filteredRows.map((r) => (
                  <div key={r.id} className="p-4 space-y-2">
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <p className="font-medium text-slate-100">
                          {formatTime(r.starts_at)} – {formatTime(r.ends_at)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatDate(r.starts_at)}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 text-xs px-2 py-0.5 rounded border ${statusClass(r.status)}`}
                      >
                        {statusLabel(r.status)}
                      </span>
                    </div>
                    <p className="text-sm text-slate-300">
                      {r.service_name} · {r.customer_name}
                    </p>
                    <div className="text-xs text-slate-500 space-y-1">
                      <ContactLinks
                        phone={r.customer_phone}
                        email={r.customer_email}
                      />
                    </div>
                    {r.notes && (
                      <p className="text-xs text-slate-400 italic">
                        Nota: {r.notes}
                      </p>
                    )}
                    {r.status === 'confirmed' &&
                      new Date(r.starts_at).getTime() <= Date.now() && (
                        <div className="flex flex-wrap gap-2 items-center text-xs">
                          <span className="text-slate-500">Asistió:</span>
                          <button
                            type="button"
                            disabled={attendanceUpdatingId === r.id}
                            onClick={() => void patchAttendance(r.id, true)}
                            className={`px-2 py-0.5 rounded border ${
                              r.attended === true
                                ? 'border-amber-500 text-amber-200'
                                : 'border-slate-600 text-slate-400'
                            }`}
                          >
                            Sí
                          </button>
                          <button
                            type="button"
                            disabled={attendanceUpdatingId === r.id}
                            onClick={() => void patchAttendance(r.id, false)}
                            className={`px-2 py-0.5 rounded border ${
                              r.attended === false
                                ? 'border-amber-500 text-amber-200'
                                : 'border-slate-600 text-slate-400'
                            }`}
                          >
                            No
                          </button>
                        </div>
                      )}
                    <ActionButtons
                      status={r.status as AppointmentStatus}
                      busy={updatingId === r.id}
                      onPatch={patchStatus}
                      onRequestCancel={openCancelModal}
                      id={r.id}
                    />
                  </div>
                ))}
              </div>
            </div>

            {cancelTarget && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
                role="dialog"
                aria-modal="true"
                aria-labelledby="cancel-modal-title"
              >
                <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl text-left">
                  <h3
                    id="cancel-modal-title"
                    className="text-lg font-medium text-slate-100"
                  >
                    Cancelar turno
                  </h3>
                  <p className="text-sm text-slate-400">
                    {formatDate(cancelTarget.starts_at)}{' '}
                    {formatTime(cancelTarget.starts_at)} —{' '}
                    {cancelTarget.service_name} · {cancelTarget.customer_name}
                  </p>
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor="cancel-note"
                      className="text-sm text-slate-300"
                    >
                      Comentario para el cliente (opcional)
                    </label>
                    <textarea
                      id="cancel-note"
                      rows={3}
                      className="bg-slate-950 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-violet-500 resize-y min-h-[72px]"
                      value={cancelNote}
                      onChange={(e) => setCancelNote(e.target.value)}
                      placeholder="Ej: el local cierra ese día, te ofrecemos otro horario…"
                    />
                  </div>
                  <p className="text-xs text-slate-500">
                    Si el cliente tiene email cargado y el servidor tiene correo
                    configurado, recibirá un aviso de cancelación con este texto.
                  </p>
                  <div className="flex flex-wrap justify-end gap-2 pt-2">
                    <button
                      type="button"
                      disabled={updatingId === cancelTarget.id}
                      onClick={() => {
                        setCancelTarget(null)
                        setCancelNote('')
                      }}
                      className="text-sm px-4 py-2 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 transition-colors"
                    >
                      Volver
                    </button>
                    <button
                      type="button"
                      disabled={updatingId === cancelTarget.id}
                      onClick={() => void submitCancel()}
                      className="text-sm px-4 py-2 rounded bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white transition-colors"
                    >
                      {updatingId === cancelTarget.id
                        ? 'Cancelando…'
                        : 'Confirmar cancelación'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {!trialStatus?.restricted && tab === 'configuracion' && (
          <ConfiguracionTab authHeader={authHeader} shopSlug={shopSlug} />
        )}
        {!trialStatus?.restricted && tab === 'horarios' && (
          <HorariosTab authHeader={authHeader} shopSlug={shopSlug} />
        )}
        {!trialStatus?.restricted && tab === 'servicios' && (
          <ServiciosTab authHeader={authHeader} shopSlug={shopSlug} />
        )}
        {!trialStatus?.restricted && tab === 'bloqueos' && (
          <BloqueosTab authHeader={authHeader} shopSlug={shopSlug} />
        )}
      </div>
    </div>
    </>
  )
}

function AdminOnboardingOverlay({
  authHeader,
  shopSlug,
  onFinish,
}: {
  authHeader: Record<string, string>
  shopSlug: string
  onFinish: () => void
}) {
  const [step, setStep] = useState(0)
  const [dirtySteps, setDirtySteps] = useState<Record<number, boolean>>({})
  const [pendingNav, setPendingNav] = useState<
    | null
    | { kind: 'step'; target: number }
    | { kind: 'skip' }
  >(null)

  const markDirty = (s: number) => {
    setDirtySteps((prev) => ({ ...prev, [s]: true }))
  }
  const clearDirty = (s: number) => {
    setDirtySteps((prev) => ({ ...prev, [s]: false }))
  }

  const tryChangeStep = (next: number) => {
    if (next === step) return
    if (dirtySteps[step]) {
      setPendingNav({ kind: 'step', target: next })
      return
    }
    setStep(next)
  }

  const confirmPendingNav = () => {
    if (!pendingNav) return
    clearDirty(step)
    if (pendingNav.kind === 'skip') {
      onFinish()
    } else {
      setStep(pendingNav.target)
    }
    setPendingNav(null)
  }

  const cancelPendingNav = () => setPendingNav(null)

  const finishOrSkip = () => {
    if (step < 3 && dirtySteps[step]) {
      setPendingNav({ kind: 'skip' })
      return
    }
    onFinish()
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-950 overflow-hidden">
      <ConfirmDialog
        open={pendingNav != null}
        title={
          pendingNav?.kind === 'skip'
            ? 'Salir del recorrido'
            : 'Cambios sin guardar'
        }
        message={
          pendingNav?.kind === 'skip'
            ? 'Tenés cambios sin guardar en este paso. Si salís ahora, esos datos no se guardan en el servidor.'
            : 'Tenés cambios sin guardar en este paso. Si continuás, podés perder esos cambios (podés volver y pulsar Guardar).'
        }
        confirmLabel={pendingNav?.kind === 'skip' ? 'Salir sin guardar' : 'Continuar sin guardar'}
        cancelLabel="Volver"
        confirmDanger={pendingNav?.kind === 'skip'}
        onConfirm={confirmPendingNav}
        onCancel={cancelPendingNav}
      />
      <div className="border-b border-slate-800 bg-slate-900/95 px-4 py-4 shrink-0">
        <div className="max-w-3xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-violet-400 font-medium uppercase tracking-wide">
              Configuración inicial
            </p>
            <h2 className="text-lg font-semibold text-slate-100">
              {step === 0 && 'Paso 1 de 3 · Nombre y contacto'}
              {step === 1 && 'Paso 2 de 3 · Horarios'}
              {step === 2 && 'Paso 3 de 3 · Servicios'}
              {step === 3 && 'Listo'}
            </h2>
          </div>
          <button
            type="button"
            onClick={finishOrSkip}
            className="text-sm px-3 py-1.5 rounded border border-slate-600 text-slate-400 hover:bg-slate-800"
          >
            Omitir y entrar al panel
          </button>
        </div>
        <div className="max-w-3xl mx-auto mt-3 flex gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded ${
                step > i ? 'bg-violet-500' : step === i ? 'bg-violet-500/70' : 'bg-slate-800'
              }`}
            />
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-6 min-h-0">
        <div className="max-w-3xl mx-auto">
          {step === 0 && (
            <ConfiguracionTab
              authHeader={authHeader}
              shopSlug={shopSlug}
              onDirtyChange={() => markDirty(0)}
              onSaved={() => clearDirty(0)}
            />
          )}
          {step === 1 && (
            <HorariosTab
              authHeader={authHeader}
              shopSlug={shopSlug}
              onDirtyChange={() => markDirty(1)}
              onSaved={() => clearDirty(1)}
            />
          )}
          {step === 2 && (
            <ServiciosTab
              authHeader={authHeader}
              shopSlug={shopSlug}
              onDirtyChange={() => markDirty(2)}
              onSaved={() => clearDirty(2)}
            />
          )}
          {step === 3 && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center space-y-4">
              <h3 className="text-xl font-medium text-slate-100">
                ¡Gracias por completar el recorrido!
              </h3>
              <p className="text-slate-400 text-sm max-w-md mx-auto">
                Desde la pestaña{' '}
                <span className="text-slate-200 font-medium">Bloqueos</span> podés marcar
                días u horas en los que no querés ofrecer turnos.
              </p>
              <p className="text-slate-500 text-sm">
                Página pública de reservas:{' '}
                <Link
                  to={`/s/${shopSlug}`}
                  className="text-emerald-400 underline underline-offset-2"
                >
                  /s/{shopSlug}
                </Link>
              </p>
            </div>
          )}
        </div>
      </div>
      <div className="border-t border-slate-800 bg-slate-900/95 px-4 py-4 shrink-0">
        <div className="max-w-3xl mx-auto flex flex-wrap justify-between gap-3 items-center">
          <button
            type="button"
            disabled={step === 0}
            onClick={() => tryChangeStep(Math.max(0, step - 1))}
            className="text-sm px-4 py-2 rounded border border-slate-600 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Atrás
          </button>
          <div className="flex gap-2">
            {step < 3 ? (
              <button
                type="button"
                onClick={() => tryChangeStep(step === 2 ? 3 : step + 1)}
                className="text-sm px-4 py-2 rounded bg-violet-600 hover:bg-violet-500 text-white"
              >
                {step === 2 ? 'Finalizar y ver resumen' : 'Siguiente'}
              </button>
            ) : (
              <button
                type="button"
                onClick={onFinish}
                className="text-sm px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                Ir al panel
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ConfiguracionTab({
  authHeader,
  shopSlug,
  onDirtyChange,
  onSaved,
}: {
  authHeader: Record<string, string>
  shopSlug: string
  onDirtyChange?: () => void
  onSaved?: () => void
}) {
  const touchDirty = () => onDirtyChange?.()
  const [shopName, setShopName] = useState('')
  const [minH, setMinH] = useState(2)
  const [maxD, setMaxD] = useState(15)
  const [contactWa, setContactWa] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactAddress, setContactAddress] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true)
        const res = await fetch(shopAdminPath(shopSlug, 'shop-settings'), {
          headers: authHeader,
        })
        if (res.status === 401) {
          reloadToLogin()
          return
        }
        if (!res.ok) throw new Error('No se pudo cargar la configuración')
        const d = (await res.json()) as {
          bookingMinLeadHours: number
          bookingMaxDaysAhead: number
          shopName: string | null
          contactWhatsapp: string | null
          contactEmail: string | null
          contactAddress: string | null
        }
        setShopName(d.shopName ?? '')
        setMinH(d.bookingMinLeadHours)
        setMaxD(d.bookingMaxDaysAhead)
        setContactWa(d.contactWhatsapp ?? '')
        setContactEmail(d.contactEmail ?? '')
        setContactAddress(d.contactAddress ?? '')
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Error')
      } finally {
        setLoading(false)
      }
    })()
  }, [authHeader, shopSlug])

  useEffect(() => {
    if (!msg) return
    const t = window.setTimeout(() => setMsg(null), 4000)
    return () => clearTimeout(t)
  }, [msg])

  const save = async () => {
    try {
      setSaving(true)
      setErr(null)
      setMsg(null)
      const res = await fetch(shopAdminPath(shopSlug, 'shop-settings'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({
          bookingMinLeadHours: minH,
          bookingMaxDaysAhead: maxD,
          shopName: shopName.trim() === '' ? null : shopName.trim(),
          contactWhatsapp: contactWa.trim() === '' ? null : contactWa,
          contactEmail: contactEmail.trim() === '' ? null : contactEmail,
          addressStreet: null,
          addressNumber: null,
          addressFloor: null,
          addressCity: null,
          addressRegion: null,
          addressPostalCode: null,
          contactAddress: contactAddress.trim() === '' ? null : contactAddress,
        }),
      })
      if (res.status === 401) {
        reloadToLogin()
        return
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(data?.error ?? 'No se pudo guardar')
      }
      setMsg('Guardado.')
      onSaved?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="text-slate-400 text-sm">Cargando…</p>
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
        <h2 className="text-lg font-medium text-slate-100">
          Nombre y contacto del local
        </h2>
        <p className="text-xs text-slate-500">
          Datos públicos: se muestran en la reserva, el pie de página y el menú
          (nombre del local).
        </p>
        <div className="flex flex-col gap-1">
          <label className="text-sm text-slate-300">Nombre del local</label>
          <input
            type="text"
            maxLength={120}
            autoComplete="organization"
            className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
            value={shopName}
            onChange={(e) => {
              setShopName(e.target.value)
              touchDirty()
            }}
            placeholder="Ej: Barbería Central"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm text-slate-300">Dirección</label>
          <textarea
            className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm min-h-[72px] resize-y"
            value={contactAddress}
            onChange={(e) => {
              setContactAddress(e.target.value)
              touchDirty()
            }}
            placeholder="Ej: Av. Corrientes 1234, CABA"
            maxLength={500}
            rows={3}
          />
          <p className="text-xs text-slate-500">
            Aparece en la reserva pública con enlace al mapa.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm text-slate-300">WhatsApp</label>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
            value={contactWa}
            onChange={(e) => {
              setContactWa(e.target.value)
              touchDirty()
            }}
            placeholder="54911…"
          />
          <p className="text-xs text-slate-500">
            Código de país sin espacios (ej. 54911…).
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm text-slate-300">
            Email de contacto (opcional)
          </label>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
            value={contactEmail}
            onChange={(e) => {
              setContactEmail(e.target.value)
              touchDirty()
            }}
            placeholder="local@ejemplo.com"
          />
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
        <h2 className="text-lg font-medium text-slate-100">
          Reglas de reserva
        </h2>
        <p className="text-xs text-slate-500">
          Anticipación mínima (horas) y máximo de días hacia adelante para
          reservar desde la web.
        </p>
        <div className="flex flex-col gap-1">
          <label className="text-sm text-slate-300">Anticipación mínima (h)</label>
          <input
            type="number"
            min={0}
            max={168}
            className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
            value={minH}
            onChange={(e) => {
              setMinH(Number(e.target.value))
              touchDirty()
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm text-slate-300">Máx. días adelante</label>
          <input
            type="number"
            min={1}
            max={365}
            className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
            value={maxD}
            onChange={(e) => {
              setMaxD(Number(e.target.value))
              touchDirty()
            }}
          />
        </div>
      </div>

      {err && (
        <p className="text-sm text-red-400 border border-red-800 rounded px-2 py-1">
          {err}
        </p>
      )}
      {msg && (
        <p className="text-sm text-emerald-400 border border-emerald-800 rounded px-2 py-1">
          {msg}
        </p>
      )}
      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="text-sm px-4 py-2 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-50"
      >
        {saving ? 'Guardando…' : 'Guardar'}
      </button>
    </div>
  )
}

type BhRow = {
  day_of_week: number
  is_closed: boolean
  open_time: string | null
  close_time: string | null
  open_time_afternoon: string | null
  close_time_afternoon: string | null
}

function hasSiesta(r: BhRow) {
  return !!(r.open_time_afternoon && r.close_time_afternoon)
}

/** Un solo tramo: inicio mañana → fin del día (fin de tarde si había dos turnos). */
function mergeSplitToContinuous(r: BhRow): Partial<BhRow> {
  const start = r.open_time ?? '09:00'
  const end =
    hasSiesta(r) && r.close_time_afternoon
      ? r.close_time_afternoon
      : r.close_time ?? '19:00'
  return {
    open_time: start,
    close_time: end,
    open_time_afternoon: null,
    close_time_afternoon: null,
  }
}

/** Pasa de horario continuo a dos turnos (valores por defecto razonables). */
function enableSiestaForRow(r: BhRow): BhRow {
  if (hasSiesta(r)) return r
  const fullEnd = r.close_time ?? '19:00'
  const afternoonOpen = '15:00'
  // Usa el cierre original como fin de tarde solo si es posterior al inicio
  // de tarde sugerido; si no, cae a un default razonable para evitar un
  // rango invertido (p.ej. cierre previo a las 15:00).
  const afternoonClose = fullEnd > afternoonOpen ? fullEnd : '19:00'
  return {
    ...r,
    open_time: r.open_time ?? '09:00',
    close_time: '13:00',
    open_time_afternoon: afternoonOpen,
    close_time_afternoon: afternoonClose,
  }
}

function HorariosTab({
  authHeader,
  shopSlug,
  onDirtyChange,
  onSaved,
}: {
  authHeader: Record<string, string>
  shopSlug: string
  onDirtyChange?: () => void
  onSaved?: () => void
}) {
  const [rows, setRows] = useState<BhRow[]>([])
  const [editedDays, setEditedDays] = useState<Set<number>>(() => new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const touchDirty = () => onDirtyChange?.()

  const load = useCallback(async () => {
    const res = await fetch(shopAdminPath(shopSlug, 'business-hours'), {
      headers: authHeader,
    })
    if (res.status === 401) {
      reloadToLogin()
      return
    }
    if (!res.ok) throw new Error('No se pudieron cargar los horarios')
    const data = (await res.json()) as BhRow[]
    const normalized = data
      .sort((a, b) => a.day_of_week - b.day_of_week)
      .map((r) => ({
        ...r,
        open_time_afternoon: r.open_time_afternoon ?? null,
        close_time_afternoon: r.close_time_afternoon ?? null,
      }))
    setRows(normalized)
    setEditedDays(new Set())
  }, [authHeader, shopSlug])

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true)
        await load()
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Error')
      } finally {
        setLoading(false)
      }
    })()
  }, [load])

  useEffect(() => {
    if (!msg) return
    const t = window.setTimeout(() => setMsg(null), 4000)
    return () => clearTimeout(t)
  }, [msg])

  const markEdited = (dow: number) => {
    setEditedDays((prev) => {
      if (prev.has(dow)) return prev
      const next = new Set(prev)
      next.add(dow)
      return next
    })
  }

  const updateRow = (dow: number, patch: Partial<BhRow>) => {
    setRows((prev) =>
      prev.map((r) => (r.day_of_week === dow ? { ...r, ...patch } : r)),
    )
    markEdited(dow)
    touchDirty()
  }

  const toggleDaySiesta = (dow: number, on: boolean) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.day_of_week !== dow || r.is_closed) return r
        if (!on) {
          return { ...r, ...mergeSplitToContinuous(r) }
        }
        return enableSiestaForRow(r)
      }),
    )
    markEdited(dow)
    touchDirty()
  }

  const bulkApplyTwoShiftsMonFri = () => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.is_closed || r.day_of_week > 4) return r
        if (hasSiesta(r)) return r
        return enableSiestaForRow(r)
      }),
    )
    touchDirty()
  }

  /** Lun–vie: pasa todos los días abiertos a un solo tramo (quita corte al mediodía). */
  const bulkContinuousMonFri = () => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.is_closed || r.day_of_week > 4) return r
        if (!hasSiesta(r)) return r
        return { ...r, ...mergeSplitToContinuous(r) }
      }),
    )
    touchDirty()
  }

  /** Copia los horarios del día `dow` al resto de la semana.
   * Si un día está cerrado lo mantiene cerrado, pero actualiza sus horarios
   * para que, al reabrirlo, herede el mismo horario. */
  const applyDayToAll = (dow: number) => {
    const src = rows.find((r) => r.day_of_week === dow)
    if (!src) return
    setRows((prev) =>
      prev.map((r) => {
        if (r.day_of_week === dow) return r
        return {
          ...r,
          open_time: src.open_time,
          close_time: src.close_time,
          open_time_afternoon: src.open_time_afternoon,
          close_time_afternoon: src.close_time_afternoon,
        }
      }),
    )
    touchDirty()
  }

  const save = async () => {
    try {
      setSaving(true)
      setErr(null)
      setMsg(null)
      const body = rows.map((r) => {
        const split = hasSiesta(r)
          ? {
              openTimeAfternoon: r.open_time_afternoon,
              closeTimeAfternoon: r.close_time_afternoon,
            }
          : {
              openTimeAfternoon: null as string | null,
              closeTimeAfternoon: null as string | null,
            }
        return {
          dayOfWeek: r.day_of_week,
          isClosed: r.is_closed,
          openTime: r.open_time,
          closeTime: r.close_time,
          openTimeAfternoon: split.openTimeAfternoon,
          closeTimeAfternoon: split.closeTimeAfternoon,
        }
      })
      const res = await fetch(shopAdminPath(shopSlug, 'business-hours'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify(body),
      })
      if (res.status === 401) {
        reloadToLogin()
        return
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(data?.error ?? 'No se pudo guardar')
      }
      setMsg('Horarios guardados.')
      onSaved?.()
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="text-slate-400 text-sm">Cargando…</p>
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <h2 className="text-lg font-medium text-slate-100">Horario semanal</h2>
        <div className="flex flex-wrap gap-2 text-xs">
          <button
            type="button"
            className="rounded border border-slate-600 px-2 py-1.5 text-slate-400 hover:border-violet-500/50 hover:text-slate-200"
            onClick={bulkApplyTwoShiftsMonFri}
          >
            Dos turnos en lun–vie
          </button>
          <button
            type="button"
            className="rounded border border-slate-600 px-2 py-1.5 text-slate-400 hover:border-violet-500/50 hover:text-slate-200"
            onClick={bulkContinuousMonFri}
          >
            Un turno en lun–vie
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Marcá <span className="text-slate-400">Dos turnos</span> solo en los días
        que cerrás al mediodía; el resto puede ser un horario continuo (ej. sábado
        de corrido). Los atajos de lun–vie aplican solo a esos días; sábado y domingo
        se siguen editando por fila.
      </p>

      <div className="space-y-0 divide-y divide-slate-800/90">
        {rows.map((r) => (
          <div key={r.day_of_week} className="py-3 first:pt-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              <span className="w-9 shrink-0 text-slate-400">
                {DAY_LABELS[r.day_of_week] ?? r.day_of_week}
              </span>
              <label className="flex shrink-0 items-center gap-1.5 text-slate-500">
                <input
                  type="checkbox"
                  className="rounded border-slate-600"
                  checked={r.is_closed}
                  onChange={(e) => {
                    const closed = e.target.checked
                    updateRow(r.day_of_week, {
                      is_closed: closed,
                      open_time: r.open_time ?? '09:00',
                      close_time: r.close_time ?? '19:00',
                    })
                  }}
                />
                Cerrado
              </label>
              {!r.is_closed && (
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
                  <input
                    type="checkbox"
                    className="rounded border-slate-600"
                    checked={hasSiesta(r)}
                    onChange={(e) =>
                      toggleDaySiesta(r.day_of_week, e.target.checked)
                    }
                  />
                  Dos turnos
                </label>
              )}
              {!r.is_closed && !hasSiesta(r) && (
                <>
                  <input
                    type="time"
                    className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm tabular-nums"
                    value={r.open_time ?? '09:00'}
                    onChange={(e) =>
                      updateRow(r.day_of_week, { open_time: e.target.value })
                    }
                  />
                  <span className="text-slate-600">–</span>
                  <input
                    type="time"
                    className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm tabular-nums"
                    value={r.close_time ?? '19:00'}
                    onChange={(e) =>
                      updateRow(r.day_of_week, { close_time: e.target.value })
                    }
                  />
                </>
              )}
              {!r.is_closed && hasSiesta(r) && (
                <>
                  <span className="text-[11px] uppercase tracking-wide text-slate-600">
                    Mañ.
                  </span>
                  <input
                    type="time"
                    className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm tabular-nums"
                    value={r.open_time ?? '09:00'}
                    onChange={(e) =>
                      updateRow(r.day_of_week, { open_time: e.target.value })
                    }
                  />
                  <span className="text-slate-600">–</span>
                  <input
                    type="time"
                    className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm tabular-nums"
                    value={r.close_time ?? '13:00'}
                    onChange={(e) =>
                      updateRow(r.day_of_week, { close_time: e.target.value })
                    }
                  />
                  <span className="ml-1 text-[11px] uppercase tracking-wide text-slate-600">
                    Tarde
                  </span>
                  <input
                    type="time"
                    className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm tabular-nums"
                    value={r.open_time_afternoon ?? '17:00'}
                    onChange={(e) =>
                      updateRow(r.day_of_week, {
                        open_time_afternoon: e.target.value,
                      })
                    }
                  />
                  <span className="text-slate-600">–</span>
                  <input
                    type="time"
                    className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm tabular-nums"
                    value={r.close_time_afternoon ?? '21:00'}
                    onChange={(e) =>
                      updateRow(r.day_of_week, {
                        close_time_afternoon: e.target.value,
                      })
                    }
                  />
                </>
              )}
            </div>
            {!r.is_closed && editedDays.has(r.day_of_week) && (
              <div className="mt-2 flex flex-wrap gap-2 pl-12 text-xs sm:pl-11">
                <button
                  type="button"
                  className="rounded border border-slate-600 px-2 py-1 text-slate-400 hover:border-violet-500/50 hover:text-slate-200"
                  onClick={() => applyDayToAll(r.day_of_week)}
                >
                  Aplicar a todos los días
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {err && <p className="text-sm text-red-400">{err}</p>}
      {msg && <p className="text-sm text-emerald-400">{msg}</p>}
      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="text-sm rounded bg-violet-600 px-4 py-2 hover:bg-violet-500 disabled:opacity-50"
      >
        {saving ? 'Guardando…' : 'Guardar horarios'}
      </button>
    </div>
  )
}

type ServiceRow = {
  id: string
  name: string
  duration_minutes: number
  price_cents: number
  active: boolean
  is_favorite: boolean
}

function ServiciosTab({
  authHeader,
  shopSlug,
  onDirtyChange,
  onSaved,
}: {
  authHeader: Record<string, string>
  shopSlug: string
  onDirtyChange?: () => void
  onSaved?: () => void
}) {
  const touchDirty = () => onDirtyChange?.()
  const [rows, setRows] = useState<ServiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [dur, setDur] = useState(30)
  const [price, setPrice] = useState('1500')
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDur, setEditDur] = useState(30)
  const [editPrice, setEditPrice] = useState('')
  const [savingEditId, setSavingEditId] = useState<string | null>(null)
  const [savingFavoriteId, setSavingFavoriteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(shopAdminPath(shopSlug, 'services'), {
      headers: authHeader,
    })
    if (res.status === 401) {
      reloadToLogin()
      return
    }
    if (!res.ok) throw new Error('No se pudieron cargar los servicios')
    setRows((await res.json()) as ServiceRow[])
  }, [authHeader, shopSlug])

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true)
        await load()
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Error')
      } finally {
        setLoading(false)
      }
    })()
  }, [load])

  const toggleActive = async (id: string, active: boolean) => {
    try {
      touchDirty()
      setErr(null)
      const res = await fetch(shopAdminPath(shopSlug, `services/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ active: !active }),
      })
      if (res.status === 401) {
        reloadToLogin()
        return
      }
      if (!res.ok) throw new Error('No se pudo actualizar')
      onSaved?.()
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error')
    }
  }

  const executeDeleteService = async (id: string) => {
    try {
      touchDirty()
      setDeletingId(id)
      setErr(null)
      const res = await fetch(shopAdminPath(shopSlug, `services/${id}`), {
        method: 'DELETE',
        headers: authHeader,
      })
      if (res.status === 401) {
        reloadToLogin()
        return
      }
      if (res.status === 409) {
        const data = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        setErr(
          data?.error ??
            'No se puede eliminar: hay turnos con este servicio. Desactivalo en su lugar.',
        )
        setDeleteConfirmId(null)
        return
      }
      if (!res.ok) throw new Error('No se pudo eliminar')
      setDeleteConfirmId(null)
      onSaved?.()
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error')
      setDeleteConfirmId(null)
    } finally {
      setDeletingId(null)
    }
  }

  const toggleFavorite = async (id: string, isFavorite: boolean) => {
    try {
      touchDirty()
      setSavingFavoriteId(id)
      setErr(null)
      const res = await fetch(shopAdminPath(shopSlug, `services/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ is_favorite: !isFavorite }),
      })
      if (res.status === 401) {
        reloadToLogin()
        return
      }
      if (!res.ok) throw new Error('No se pudo actualizar el favorito')
      onSaved?.()
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error')
    } finally {
      setSavingFavoriteId(null)
    }
  }

  const add = async () => {
    const pesos = Number.parseFloat(price.replace(',', '.'))
    if (!name.trim() || Number.isNaN(pesos) || pesos < 0) {
      setErr('Nombre y precio válidos son obligatorios.')
      return
    }
    try {
      setSaving(true)
      setErr(null)
      const price_cents = Math.round(pesos * 100)
      const res = await fetch(shopAdminPath(shopSlug, 'services'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({
          name: name.trim(),
          duration_minutes: dur,
          price_cents,
        }),
      })
      if (res.status === 401) {
        reloadToLogin()
        return
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(data?.error ?? 'No se pudo crear')
      }
      setName('')
      onSaved?.()
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (r: ServiceRow) => {
    touchDirty()
    setEditingId(r.id)
    setEditName(r.name)
    setEditDur(r.duration_minutes)
    setEditPrice((r.price_cents / 100).toFixed(2))
  }

  const cancelEdit = () => {
    setEditingId(null)
  }

  const saveEdit = async (id: string) => {
    const pesos = Number.parseFloat(editPrice.replace(',', '.'))
    if (!editName.trim() || Number.isNaN(pesos) || pesos < 0) {
      setErr('Nombre y precio válidos son obligatorios.')
      return
    }
    try {
      setSavingEditId(id)
      setErr(null)
      const price_cents = Math.round(pesos * 100)
      const res = await fetch(shopAdminPath(shopSlug, `services/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({
          name: editName.trim(),
          duration_minutes: editDur,
          price_cents,
        }),
      })
      if (res.status === 401) {
        reloadToLogin()
        return
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(data?.error ?? 'No se pudo guardar')
      }
      setEditingId(null)
      onSaved?.()
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error')
    } finally {
      setSavingEditId(null)
    }
  }

  if (loading) {
    return <p className="text-slate-400 text-sm">Cargando…</p>
  }

  return (
    <>
      <ConfirmDialog
        open={deleteConfirmId != null}
        title="Eliminar servicio"
        message="Se va a borrar de forma permanente. Si hay turnos históricos con este servicio, no se puede eliminar: en ese caso desactivalo."
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        confirmDanger
        onConfirm={() => {
          if (deleteConfirmId) void executeDeleteService(deleteConfirmId)
        }}
        onCancel={() => setDeleteConfirmId(null)}
      />
      <div className="space-y-6">
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-3">
        <h2 className="text-lg font-medium text-slate-100">Nuevo servicio</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label
              htmlFor="new-service-name"
              className="text-sm text-slate-300"
            >
              Nombre
            </label>
            <input
              id="new-service-name"
              placeholder="Ej: Corte + barba"
              className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                touchDirty()
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="new-service-duration"
              className="text-sm text-slate-300"
            >
              Duración (minutos)
            </label>
            <input
              id="new-service-duration"
              type="number"
              min={5}
              className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
              value={dur}
              onChange={(e) => {
                setDur(Number(e.target.value))
                touchDirty()
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="new-service-price"
              className="text-sm text-slate-300"
            >
              Precio (pesos)
            </label>
            <input
              id="new-service-price"
              placeholder="1500"
              className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
              value={price}
              onChange={(e) => {
                setPrice(e.target.value)
                touchDirty()
              }}
            />
          </div>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => void add()}
          className="text-sm px-4 py-2 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-50"
        >
          {saving ? 'Creando…' : 'Agregar'}
        </button>
      </div>

      {err && (
        <p className="text-sm text-red-400 border border-red-800 rounded px-2 py-1">
          {err}
        </p>
      )}

      <div className="rounded-xl border border-slate-800 overflow-hidden">
        <p className="px-4 py-2 text-xs text-slate-500 border-b border-slate-800 bg-slate-900/80">
          El favorito se preselecciona en la página pública de reservas (solo puede haber uno).
        </p>
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-900 border-b border-slate-800 text-slate-400">
            <tr>
              <th className="px-4 py-2">Nombre</th>
              <th className="px-4 py-2">Duración</th>
              <th className="px-4 py-2">Precio</th>
              <th className="px-4 py-2">Favorito</th>
              <th className="px-4 py-2">Activo</th>
              <th className="px-4 py-2 w-44">Acciones</th>
              <th className="px-4 py-2 w-24">Eliminar</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-800">
                <td className="px-4 py-2 text-slate-200 align-top">
                  {editingId === r.id ? (
                    <input
                      type="text"
                      className="w-full min-w-[10rem] bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm"
                      value={editName}
                      onChange={(e) => {
                        setEditName(e.target.value)
                        touchDirty()
                      }}
                      aria-label={`Nombre (${r.name})`}
                    />
                  ) : (
                    r.name
                  )}
                </td>
                <td className="px-4 py-2 text-slate-400 align-top">
                  {editingId === r.id ? (
                    <input
                      type="number"
                      min={5}
                      className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm"
                      value={editDur}
                      onChange={(e) => {
                        setEditDur(Number(e.target.value))
                        touchDirty()
                      }}
                      aria-label="Duración en minutos"
                    />
                  ) : (
                    `${r.duration_minutes} min`
                  )}
                </td>
                <td className="px-4 py-2 text-slate-400 align-top">
                  {editingId === r.id ? (
                    <input
                      type="text"
                      inputMode="decimal"
                      className="w-28 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm"
                      value={editPrice}
                      onChange={(e) => {
                        setEditPrice(e.target.value)
                        touchDirty()
                      }}
                      aria-label="Precio en pesos"
                    />
                  ) : (
                    `$${formatPesosArFromCents(r.price_cents)}`
                  )}
                </td>
                <td className="px-4 py-2 align-top">
                  <button
                    type="button"
                    disabled={
                      editingId === r.id || savingFavoriteId === r.id
                    }
                    onClick={() => void toggleFavorite(r.id, r.is_favorite)}
                    title={
                      r.is_favorite
                        ? 'Quitar como predeterminado en reservas'
                        : 'Mostrar por defecto al reservar'
                    }
                    className={`text-xs px-2 py-1 rounded border disabled:opacity-40 ${
                      r.is_favorite
                        ? 'border-amber-500 text-amber-200'
                        : 'border-slate-600 text-slate-500'
                    }`}
                  >
                    {savingFavoriteId === r.id
                      ? '…'
                      : r.is_favorite
                        ? 'Sí'
                        : 'No'}
                  </button>
                </td>
                <td className="px-4 py-2 align-top">
                    <button
                      type="button"
                      disabled={editingId === r.id}
                      onClick={() => void toggleActive(r.id, r.active)}
                      className={`text-xs px-2 py-1 rounded border disabled:opacity-40 ${
                        r.active
                          ? 'border-emerald-600 text-emerald-300'
                          : 'border-slate-600 text-slate-500'
                      }`}
                    >
                      {r.active ? 'Sí' : 'No'}
                    </button>
                  </td>
                <td className="px-4 py-2 align-top">
                  {editingId === r.id ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={savingEditId === r.id}
                        onClick={() => void saveEdit(r.id)}
                        className="text-xs px-2 py-1 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-50"
                      >
                        {savingEditId === r.id ? 'Guardando…' : 'Guardar'}
                      </button>
                      <button
                        type="button"
                        disabled={savingEditId === r.id}
                        onClick={cancelEdit}
                        className="text-xs px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEdit(r)}
                      className="text-xs px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-800"
                    >
                      Editar
                    </button>
                  )}
                </td>
                <td className="px-4 py-2 align-top">
                  <button
                    type="button"
                    disabled={
                      editingId === r.id ||
                      deletingId === r.id ||
                      savingFavoriteId === r.id
                    }
                    onClick={() => setDeleteConfirmId(r.id)}
                    className="text-xs px-2 py-1 rounded border border-red-900/80 text-red-300 hover:bg-red-950/50 disabled:opacity-40"
                  >
                    {deletingId === r.id ? '…' : 'Eliminar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    </>
  )
}

type BlockedRow = {
  id: string
  starts_at: string
  ends_at: string
  note: string | null
}

function BloqueosTab({
  authHeader,
  shopSlug,
}: {
  authHeader: Record<string, string>
  shopSlug: string
}) {
  const [rows, setRows] = useState<BlockedRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [fullDayDate, setFullDayDate] = useState(() => toInputDate(new Date()))
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [shopTz, setShopTz] = useState('America/Argentina/Buenos_Aires')

  useEffect(() => {
    void fetch(shopPublicPath(shopSlug, 'public-settings'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { timezone?: string } | null) => {
        if (d?.timezone) setShopTz(d.timezone)
      })
      .catch(() => {})
  }, [shopSlug])

  const blockedRowLabels = (r: BlockedRow) => {
    try {
      return formatBlockedRangeDisplay(r.starts_at, r.ends_at, shopTz)
    } catch {
      return {
        startLabel: `${formatDate(r.starts_at)} ${formatTime(r.starts_at)}`,
        endLabel: `${formatDate(r.ends_at)} ${formatTime(r.ends_at)}`,
      }
    }
  }

  const load = useCallback(async () => {
    const res = await fetch(shopAdminPath(shopSlug, 'blocked-ranges'), {
      headers: authHeader,
    })
    if (res.status === 401) {
      reloadToLogin()
      return
    }
    if (!res.ok) throw new Error('No se pudieron cargar los bloqueos')
    setRows((await res.json()) as BlockedRow[])
  }, [authHeader])

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true)
        await load()
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Error')
      } finally {
        setLoading(false)
      }
    })()
  }, [load])

  const executeDelete = async (id: string) => {
    try {
      setDeletingId(id)
      setErr(null)
      const res = await fetch(shopAdminPath(shopSlug, `blocked-ranges/${id}`), {
        method: 'DELETE',
        headers: authHeader,
      })
      if (res.status === 401) {
        reloadToLogin()
        return
      }
      if (!res.ok) throw new Error('No se pudo eliminar')
      setPendingDeleteId(null)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error')
    } finally {
      setDeletingId(null)
    }
  }

  const add = async () => {
    if (!start || !end) {
      setErr('Indicá inicio y fin.')
      return
    }
    const s = new Date(start)
    const e = new Date(end)
    if (!(e > s)) {
      setErr('El fin debe ser posterior al inicio.')
      return
    }
    try {
      setSaving(true)
      setErr(null)
      const res = await fetch(shopAdminPath(shopSlug, 'blocked-ranges'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({
          startsAt: s.toISOString(),
          endsAt: e.toISOString(),
          note: note.trim() || undefined,
        }),
      })
      if (res.status === 401) {
        reloadToLogin()
        return
      }
      if (res.status === 409) {
        const data = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(
          data?.error ?? 'Hay turnos en ese rango; no se puede bloquear.',
        )
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(data?.error ?? 'No se pudo crear')
      }
      setStart('')
      setEnd('')
      setNote('')
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  const addFullDay = async () => {
    if (!fullDayDate) {
      setErr('Elegí una fecha.')
      return
    }
    try {
      setSaving(true)
      setErr(null)
      const res = await fetch(shopAdminPath(shopSlug, 'blocked-ranges'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({
          blockedDate: fullDayDate,
          note: note.trim() || undefined,
        }),
      })
      if (res.status === 401) {
        reloadToLogin()
        return
      }
      if (res.status === 409) {
        const data = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(
          data?.error ?? 'Hay turnos en ese rango; no se puede bloquear.',
        )
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(data?.error ?? 'No se pudo crear')
      }
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="text-slate-400 text-sm">Cargando…</p>
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-3">
        <h2 className="text-lg font-medium text-slate-100">Nuevo bloqueo</h2>
        <p className="text-xs text-slate-500">
          No se puede crear si ya hay turnos activos en ese intervalo.
        </p>
        <div className="rounded-lg border border-slate-700/80 bg-slate-950/40 p-4 space-y-3">
          <h3 className="text-sm font-medium text-slate-200">Día completo</h3>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400" htmlFor="block-full-day">
                Fecha
              </label>
              <input
                id="block-full-day"
                type="date"
                className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
                value={fullDayDate}
                onChange={(e) => setFullDayDate(e.target.value)}
              />
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={() => void addFullDay()}
              className="text-sm px-4 py-2 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Bloquear día completo'}
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-500 pt-1">
          O definí un rango con hora concreta:
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Inicio</label>
            <input
              type="datetime-local"
              className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Fin</label>
            <input
              type="datetime-local"
              className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
        </div>
        <input
          placeholder="Nota (opcional)"
          className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button
          type="button"
          disabled={saving}
          onClick={() => void add()}
          className="text-sm px-4 py-2 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Agregar bloqueo'}
        </button>
      </div>

      {err && (
        <p className="text-sm text-red-400 border border-red-800 rounded px-2 py-1">
          {err}
        </p>
      )}

      <div className="rounded-xl border border-slate-800 overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-900 border-b border-slate-800 text-slate-400">
            <tr>
              <th className="px-4 py-2">Inicio</th>
              <th className="px-4 py-2">Fin</th>
              <th className="px-4 py-2">Nota</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const { startLabel, endLabel } = blockedRowLabels(r)
              return (
              <tr key={r.id} className="border-t border-slate-800">
                <td className="px-4 py-2 text-slate-300 whitespace-nowrap">
                  {startLabel}
                </td>
                <td className="px-4 py-2 text-slate-300 whitespace-nowrap">
                  {endLabel}
                </td>
                <td className="px-4 py-2 text-slate-500 text-xs max-w-[200px] truncate">
                  {r.note ?? '—'}
                </td>
                <td className="px-4 py-2">
                  {pendingDeleteId === r.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-slate-400">¿Eliminar?</span>
                      <button
                        type="button"
                        disabled={deletingId === r.id}
                        onClick={() => void executeDelete(r.id)}
                        className="text-xs px-2 py-1 rounded bg-red-900/60 text-red-200 border border-red-700 hover:bg-red-900 disabled:opacity-50"
                      >
                        {deletingId === r.id ? '…' : 'Sí'}
                      </button>
                      <button
                        type="button"
                        disabled={deletingId === r.id}
                        onClick={() => setPendingDeleteId(null)}
                        className="text-xs px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPendingDeleteId(r.id)}
                      className="text-xs text-red-400 hover:underline"
                    >
                      Eliminar
                    </button>
                  )}
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ActionButtons({
  id,
  status,
  busy,
  onPatch,
  onRequestCancel,
}: {
  id: string
  status: AppointmentStatus
  busy: boolean
  onPatch: (id: string, s: AppointmentStatus) => void
  onRequestCancel: (id: string) => void
}) {
  const btn =
    'text-xs px-2 py-1 rounded border transition-colors disabled:opacity-50'
  return (
    <div className="flex flex-wrap gap-1">
      {status === 'confirmed' && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onRequestCancel(id)}
          className={`${btn} border-red-800 bg-red-950/30 text-red-300 hover:bg-red-950/50`}
        >
          Cancelar
        </button>
      )}
      {status === 'cancelled' && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void onPatch(id, 'confirmed')}
          className={`${btn} border-emerald-700 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/50`}
        >
          Marcar confirmado
        </button>
      )}
    </div>
  )
}

type DashboardResponse = {
  timezone: string
  generatedAt: string
  today: { appointments: number; revenueCents: number }
  week: { appointments: number; revenueCents: number }
  month: { appointments: number; revenueCents: number }
  attendance: { past: number; attended: number; ratePct: number | null }
  repeatCustomers: Array<{
    customerId: string
    name: string
    phone: string | null
    email: string | null
    totalAppointments: number
    lastAppointmentAt: string
  }>
}

/**
 * Tarjetas con métricas del negocio (turnos confirmados hoy/semana/mes + ingresos estimados,
 * asistencia de los últimos 60 días y top de clientes recurrentes). Se monta encima de la
 * lista de turnos en la tab "Turnos".
 */
function DashboardPanel({
  authHeader,
  shopSlug,
}: {
  authHeader: Record<string, string>
  shopSlug: string
}) {
  const [data, setData] = useState<DashboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(shopAdminPath(shopSlug, 'dashboard'), {
        headers: authHeader,
      })
      if (res.status === 401) {
        reloadToLogin()
        return
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(body?.error ?? 'No se pudo cargar el resumen')
      }
      setData((await res.json()) as DashboardResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setLoading(false)
    }
  }, [authHeader, shopSlug])

  useEffect(() => {
    void load()
  }, [load])

  const Card = ({
    title,
    appointments,
    revenueCents,
  }: {
    title: string
    appointments: number
    revenueCents: number
  }) => (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">
        {title}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-slate-100 tabular-nums">
          {appointments}
        </span>
        <span className="text-xs text-slate-500">
          turno{appointments === 1 ? '' : 's'}
        </span>
      </div>
      <div className="mt-0.5 text-sm text-emerald-300 tabular-nums">
        {formatPesosArFromCents(revenueCents)}
      </div>
    </div>
  )

  return (
    <section
      aria-label="Resumen del local"
      className="mb-6 rounded-xl border border-slate-800 bg-slate-900/20 p-4"
    >
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-sm font-semibold text-slate-200">Resumen</h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50"
        >
          {loading ? 'Actualizando…' : 'Refrescar'}
        </button>
        {error && (
          <span className="text-xs text-red-400 ml-auto">{error}</span>
        )}
      </div>

      {data ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card
              title="Hoy"
              appointments={data.today.appointments}
              revenueCents={data.today.revenueCents}
            />
            <Card
              title="Esta semana"
              appointments={data.week.appointments}
              revenueCents={data.week.revenueCents}
            />
            <Card
              title="Este mes"
              appointments={data.month.appointments}
              revenueCents={data.month.revenueCents}
            />
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Asistencia (últimos 60 días)
              </div>
              {data.attendance.past === 0 ? (
                <p className="mt-2 text-sm text-slate-400">
                  Todavía no hay turnos pasados.
                </p>
              ) : (
                <>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-2xl font-semibold text-slate-100 tabular-nums">
                      {data.attendance.ratePct}%
                    </span>
                    <span className="text-xs text-slate-500">
                      {data.attendance.attended} / {data.attendance.past}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Turnos confirmados marcados como "asistió" sobre el total
                    de turnos pasados.
                  </p>
                </>
              )}
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Clientes recurrentes (últimos 60 días)
              </div>
              {data.repeatCustomers.length === 0 ? (
                <p className="mt-2 text-sm text-slate-400">
                  Sin clientes con 2 o más turnos en los últimos 60 días.
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-slate-800">
                  {data.repeatCustomers.map((c) => (
                    <li
                      key={c.customerId}
                      className="py-2 flex items-center justify-between gap-3 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-slate-100">{c.name}</div>
                        {(c.phone || c.email) && (
                          <div className="truncate text-xs text-slate-500">
                            {c.phone ?? c.email}
                          </div>
                        )}
                      </div>
                      <span className="shrink-0 rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-300">
                        {c.totalAppointments} turnos
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      ) : (
        !error && (
          <p className="text-sm text-slate-500">Cargando métricas…</p>
        )
      )}
    </section>
  )
}
