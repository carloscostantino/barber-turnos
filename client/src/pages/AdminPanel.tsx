import { useCallback, useEffect, useMemo, useState } from 'react'
import { clearAdminToken, getAdminToken } from '../adminToken'
import { API_BASE } from '../config'
import { whatsappHrefFromPhone } from '../lib/contact'
import { dayRangeIso, formatDate, formatTime, toInputDate } from '../lib/format'
import AdminLogin from './AdminLogin'

/** Limpia sesión y recarga la app: evita estado React colgado si el JWT ya no sirve (401). */
function reloadToLogin() {
  clearAdminToken()
  window.location.reload()
}

function normalizeStoredToken(raw: string | null): string | null {
  if (!raw) return null
  const parts = raw.split('.')
  if (parts.length !== 3 || parts.some((p) => !p)) {
    clearAdminToken()
    return null
  }
  return raw
}

type AppointmentRow = {
  id: string
  starts_at: string
  ends_at: string
  status: string
  notes: string | null
  service_name: string
  customer_name: string
  customer_phone: string
  customer_email: string | null
}

type AppointmentStatus = 'pending' | 'confirmed' | 'cancelled'

type AdminTab = 'turnos' | 'reglas' | 'horarios' | 'servicios' | 'bloqueos'

const DAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

function statusLabel(s: string) {
  if (s === 'pending') return 'Pendiente'
  if (s === 'confirmed') return 'Confirmado'
  if (s === 'cancelled') return 'Cancelado'
  return s
}

function statusClass(s: string) {
  if (s === 'pending')
    return 'bg-amber-950/60 text-amber-200 border-amber-700'
  if (s === 'confirmed')
    return 'bg-emerald-950/50 text-emerald-200 border-emerald-700'
  return 'bg-slate-800 text-slate-400 border-slate-600'
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
  const [token, setToken] = useState<string | null>(() =>
    normalizeStoredToken(getAdminToken()),
  )

  const onSessionInvalid = useCallback(() => {
    clearAdminToken()
    setToken(null)
  }, [])

  const onLoggedIn = useCallback(() => {
    setToken(normalizeStoredToken(getAdminToken()))
  }, [])

  if (!token) {
    return <AdminLogin onLoggedIn={onLoggedIn} />
  }

  return (
    <AdminAuthenticatedPanel
      token={token}
      onSessionInvalid={onSessionInvalid}
    />
  )
}

function AdminAuthenticatedPanel({
  token,
  onSessionInvalid,
}: {
  token: string
  onSessionInvalid: () => void
}) {
  const [tab, setTab] = useState<AdminTab>('turnos')
  const [date, setDate] = useState(() => toInputDate(new Date()))
  const [rows, setRows] = useState<AppointmentRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<AppointmentRow | null>(
    null,
  )
  const [cancelNote, setCancelNote] = useState('')

  const authHeader = useMemo(
    () => ({ Authorization: `Bearer ${token}` }),
    [token],
  )

  const loadAppointments = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setError(null)
        setLoading(true)
        const { from, to } = dayRangeIso(date)
        const params = new URLSearchParams({ from, to })
        let res: Response
        try {
          res = await fetch(`${API_BASE}/appointments?${params}`, {
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
    [token, date],
  )

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
      const res = await fetch(`${API_BASE}/appointments/${id}/status`, {
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
      const res = await fetch(`${API_BASE}/appointments/${id}/status`, {
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
    <div className="flex justify-center px-4">
      <div className="w-full max-w-6xl py-10">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Panel de administración
            </h1>
            <p className="text-slate-400 mt-1">
              Turnos, reglas de reserva, horarios, servicios y bloqueos. La
              sesión dura 7 días (token en{' '}
              <code className="text-slate-500">sessionStorage</code>).
            </p>
            <p className="text-slate-500 text-xs mt-2">
              Si cambiaste <code className="text-slate-600">JWT_SECRET</code> en
              el servidor, volvé a iniciar sesión.
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

        <div className="flex flex-wrap gap-2 mb-6">
          {tabBtn('turnos', 'Turnos')}
          {tabBtn('reglas', 'Reglas')}
          {tabBtn('horarios', 'Horarios')}
          {tabBtn('servicios', 'Servicios')}
          {tabBtn('bloqueos', 'Bloqueos')}
        </div>

        {tab === 'turnos' && (
          <>
            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-4 mb-6 items-start sm:items-end">
              <div className="flex flex-col gap-1">
                <label className="text-sm text-slate-300">Fecha</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
              <button
                type="button"
                onClick={() => void loadAppointments()}
                disabled={loading}
                className="text-sm px-4 py-2 rounded bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-400 transition-colors"
              >
                {loading ? 'Cargando...' : 'Actualizar'}
              </button>
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
                      <th className="px-4 py-3 font-medium">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && !loading && (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-4 py-8 text-center text-slate-500"
                        >
                          No hay turnos para esta fecha.
                        </td>
                      </tr>
                    )}
                    {rows.map((r) => (
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
                    No hay turnos para esta fecha.
                  </p>
                )}
                {rows.map((r) => (
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

        {tab === 'reglas' && (
          <ReglasTab authHeader={authHeader} />
        )}
        {tab === 'horarios' && (
          <HorariosTab authHeader={authHeader} />
        )}
        {tab === 'servicios' && (
          <ServiciosTab authHeader={authHeader} />
        )}
        {tab === 'bloqueos' && (
          <BloqueosTab authHeader={authHeader} />
        )}
      </div>
    </div>
  )
}

function ReglasTab({ authHeader }: { authHeader: Record<string, string> }) {
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
        const res = await fetch(`${API_BASE}/admin/shop-settings`, {
          headers: authHeader,
        })
        if (res.status === 401) {
          reloadToLogin()
          return
        }
        if (!res.ok) throw new Error('No se pudieron cargar las reglas')
        const d = (await res.json()) as {
          bookingMinLeadHours: number
          bookingMaxDaysAhead: number
          contactWhatsapp: string | null
          contactEmail: string | null
          contactAddress: string | null
        }
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
  }, [authHeader])

  const save = async () => {
    try {
      setSaving(true)
      setErr(null)
      setMsg(null)
      const res = await fetch(`${API_BASE}/admin/shop-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({
          bookingMinLeadHours: minH,
          bookingMaxDaysAhead: maxD,
          contactWhatsapp: contactWa.trim() === '' ? null : contactWa,
          contactEmail: contactEmail.trim() === '' ? null : contactEmail,
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
    <div className="max-w-md space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-6">
      <h2 className="text-lg font-medium text-slate-100">Reglas de reserva</h2>
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
          onChange={(e) => setMinH(Number(e.target.value))}
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
          onChange={(e) => setMaxD(Number(e.target.value))}
        />
      </div>

      <div className="border-t border-slate-800 pt-4 mt-2 space-y-3">
        <h3 className="text-base font-medium text-slate-200">
          Contacto del local
        </h3>
        <p className="text-xs text-slate-500">
          Se muestran en la página de reserva y en la confirmación. WhatsApp:
          código de país sin espacios (ej. 54911…).
        </p>
        <div className="flex flex-col gap-1">
          <label className="text-sm text-slate-300">
            Dirección del local (opcional)
          </label>
          <textarea
            className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm min-h-[72px] resize-y"
            value={contactAddress}
            onChange={(e) => setContactAddress(e.target.value)}
            placeholder="Ej: Av. Corrientes 1234, CABA"
            maxLength={500}
            rows={3}
          />
          <p className="text-xs text-slate-500">
            Aparece en la reserva pública con un enlace para abrir el mapa.
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
            onChange={(e) => setContactWa(e.target.value)}
            placeholder="54911…"
          />
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
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder="local@ejemplo.com"
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
}

function HorariosTab({ authHeader }: { authHeader: Record<string, string> }) {
  const [rows, setRows] = useState<BhRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`${API_BASE}/admin/business-hours`, {
      headers: authHeader,
    })
    if (res.status === 401) {
      reloadToLogin()
      return
    }
    if (!res.ok) throw new Error('No se pudieron cargar los horarios')
    const data = (await res.json()) as BhRow[]
    setRows(data.sort((a, b) => a.day_of_week - b.day_of_week))
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

  const updateRow = (dow: number, patch: Partial<BhRow>) => {
    setRows((prev) =>
      prev.map((r) => (r.day_of_week === dow ? { ...r, ...patch } : r)),
    )
  }

  const save = async () => {
    try {
      setSaving(true)
      setErr(null)
      setMsg(null)
      const body = rows.map((r) => ({
        dayOfWeek: r.day_of_week,
        isClosed: r.is_closed,
        openTime: r.is_closed ? null : r.open_time,
        closeTime: r.is_closed ? null : r.close_time,
      }))
      const res = await fetch(`${API_BASE}/admin/business-hours`, {
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
      <h2 className="text-lg font-medium text-slate-100">
        Horario semanal (0 = lun … 6 = dom)
      </h2>
      <div className="space-y-3">
        {rows.map((r) => (
          <div
            key={r.day_of_week}
            className="flex flex-wrap items-center gap-3 border-b border-slate-800/80 pb-3"
          >
            <span className="w-10 text-sm text-slate-300">
              {DAY_LABELS[r.day_of_week] ?? r.day_of_week}
            </span>
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input
                type="checkbox"
                checked={r.is_closed}
                onChange={(e) =>
                  updateRow(r.day_of_week, { is_closed: e.target.checked })
                }
              />
              Cerrado
            </label>
            {!r.is_closed && (
              <>
                <input
                  type="time"
                  className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm"
                  value={r.open_time ?? '09:00'}
                  onChange={(e) =>
                    updateRow(r.day_of_week, { open_time: e.target.value })
                  }
                />
                <span className="text-slate-500">–</span>
                <input
                  type="time"
                  className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm"
                  value={r.close_time ?? '19:00'}
                  onChange={(e) =>
                    updateRow(r.day_of_week, { close_time: e.target.value })
                  }
                />
              </>
            )}
          </div>
        ))}
      </div>
      {err && (
        <p className="text-sm text-red-400">{err}</p>
      )}
      {msg && (
        <p className="text-sm text-emerald-400">{msg}</p>
      )}
      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="text-sm px-4 py-2 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-50"
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
}

function ServiciosTab({ authHeader }: { authHeader: Record<string, string> }) {
  const [rows, setRows] = useState<ServiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [dur, setDur] = useState(30)
  const [price, setPrice] = useState('1500')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`${API_BASE}/admin/services`, {
      headers: authHeader,
    })
    if (res.status === 401) {
      reloadToLogin()
      return
    }
    if (!res.ok) throw new Error('No se pudieron cargar los servicios')
    setRows((await res.json()) as ServiceRow[])
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

  const toggleActive = async (id: string, active: boolean) => {
    try {
      setErr(null)
      const res = await fetch(`${API_BASE}/admin/services/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ active: !active }),
      })
      if (res.status === 401) {
        reloadToLogin()
        return
      }
      if (!res.ok) throw new Error('No se pudo actualizar')
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error')
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
      const res = await fetch(`${API_BASE}/admin/services`, {
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
              onChange={(e) => setName(e.target.value)}
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
              onChange={(e) => setDur(Number(e.target.value))}
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
              onChange={(e) => setPrice(e.target.value)}
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
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-900 border-b border-slate-800 text-slate-400">
            <tr>
              <th className="px-4 py-2">Nombre</th>
              <th className="px-4 py-2">Duración</th>
              <th className="px-4 py-2">Precio</th>
              <th className="px-4 py-2">Activo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-800">
                <td className="px-4 py-2 text-slate-200">{r.name}</td>
                <td className="px-4 py-2 text-slate-400">
                  {r.duration_minutes} min
                </td>
                <td className="px-4 py-2 text-slate-400">
                  ${(r.price_cents / 100).toFixed(2)}
                </td>
                <td className="px-4 py-2">
                  <button
                    type="button"
                    onClick={() => void toggleActive(r.id, r.active)}
                    className={`text-xs px-2 py-1 rounded border ${
                      r.active
                        ? 'border-emerald-600 text-emerald-300'
                        : 'border-slate-600 text-slate-500'
                    }`}
                  >
                    {r.active ? 'Sí' : 'No'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

type BlockedRow = {
  id: string
  starts_at: string
  ends_at: string
  note: string | null
}

function BloqueosTab({ authHeader }: { authHeader: Record<string, string> }) {
  const [rows, setRows] = useState<BlockedRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [fullDayDate, setFullDayDate] = useState(() => toInputDate(new Date()))

  const load = useCallback(async () => {
    const res = await fetch(`${API_BASE}/admin/blocked-ranges`, {
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

  const remove = async (id: string) => {
    if (!window.confirm('¿Eliminar este bloqueo?')) return
    try {
      setErr(null)
      const res = await fetch(`${API_BASE}/admin/blocked-ranges/${id}`, {
        method: 'DELETE',
        headers: authHeader,
      })
      if (res.status === 401) {
        reloadToLogin()
        return
      }
      if (!res.ok) throw new Error('No se pudo eliminar')
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error')
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
      const res = await fetch(`${API_BASE}/admin/blocked-ranges`, {
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
      const res = await fetch(`${API_BASE}/admin/blocked-ranges`, {
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
          <p className="text-xs text-slate-500">
            Bloquea desde la medianoche hasta el día siguiente según la zona
            horaria del servidor (configurada en <code className="text-slate-500">TIMEZONE</code>).
          </p>
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
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-800">
                <td className="px-4 py-2 text-slate-300 whitespace-nowrap">
                  {formatDate(r.starts_at)} {formatTime(r.starts_at)}
                </td>
                <td className="px-4 py-2 text-slate-300 whitespace-nowrap">
                  {formatDate(r.ends_at)} {formatTime(r.ends_at)}
                </td>
                <td className="px-4 py-2 text-slate-500 text-xs max-w-[200px] truncate">
                  {r.note ?? '—'}
                </td>
                <td className="px-4 py-2">
                  <button
                    type="button"
                    onClick={() => void remove(r.id)}
                    className="text-xs text-red-400 hover:underline"
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
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
      {status === 'pending' && (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onPatch(id, 'confirmed')}
            className={`${btn} border-emerald-700 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/50`}
          >
            Confirmar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onRequestCancel(id)}
            className={`${btn} border-red-800 bg-red-950/30 text-red-300 hover:bg-red-950/50`}
          >
            Cancelar
          </button>
        </>
      )}
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
          onClick={() => void onPatch(id, 'pending')}
          className={`${btn} border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700`}
        >
          Marcar pendiente
        </button>
      )}
    </div>
  )
}
