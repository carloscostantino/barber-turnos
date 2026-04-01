import { useCallback, useEffect, useMemo, useState } from 'react'
import { clearAdminToken, getAdminToken } from '../adminToken'
import { API_BASE } from '../config'
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

type TurnosViewMode = 'dia' | 'lista'

const DAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

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

  const authHeader = useMemo(
    () => ({ Authorization: `Bearer ${token}` }),
    [token],
  )

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

  const patchAttendance = async (
    id: string,
    attended: boolean | null,
  ) => {
    try {
      setAttendanceUpdatingId(id)
      setError(null)
      const res = await fetch(`${API_BASE}/appointments/${id}/attendance`, {
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
              Turnos, configuración del local, horarios, servicios y bloqueos.
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
          {tabBtn('configuracion', 'Configuración')}
          {tabBtn('horarios', 'Horarios')}
          {tabBtn('servicios', 'Servicios')}
          {tabBtn('bloqueos', 'Bloqueos')}
        </div>

        {tab === 'turnos' && (
          <>
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

        {tab === 'configuracion' && (
          <ConfiguracionTab authHeader={authHeader} />
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

function ConfiguracionTab({ authHeader }: { authHeader: Record<string, string> }) {
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
        const res = await fetch(`${API_BASE}/admin/shop-settings`, {
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
  }, [authHeader])

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
      const res = await fetch(`${API_BASE}/admin/shop-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({
          bookingMinLeadHours: minH,
          bookingMaxDaysAhead: maxD,
          shopName: shopName.trim() === '' ? null : shopName.trim(),
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
            onChange={(e) => setShopName(e.target.value)}
            placeholder="Ej: Barbería Central"
          />
        </div>
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
            onChange={(e) => setContactWa(e.target.value)}
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
            onChange={(e) => setContactEmail(e.target.value)}
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

  useEffect(() => {
    if (!msg) return
    const t = window.setTimeout(() => setMsg(null), 4000)
    return () => clearTimeout(t)
  }, [msg])

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
        Horario semanal
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
  is_favorite: boolean
}

function ServiciosTab({ authHeader }: { authHeader: Record<string, string> }) {
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

  const toggleFavorite = async (id: string, isFavorite: boolean) => {
    try {
      setSavingFavoriteId(id)
      setErr(null)
      const res = await fetch(`${API_BASE}/admin/services/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ is_favorite: !isFavorite }),
      })
      if (res.status === 401) {
        reloadToLogin()
        return
      }
      if (!res.ok) throw new Error('No se pudo actualizar el favorito')
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

  const startEdit = (r: ServiceRow) => {
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
      const res = await fetch(`${API_BASE}/admin/services/${id}`, {
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
              <th className="px-4 py-2 w-40">Acciones</th>
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
                      onChange={(e) => setEditName(e.target.value)}
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
                      onChange={(e) => setEditDur(Number(e.target.value))}
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
                      onChange={(e) => setEditPrice(e.target.value)}
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
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [shopTz, setShopTz] = useState('America/Argentina/Buenos_Aires')

  useEffect(() => {
    void fetch(`${API_BASE}/public-settings`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { timezone?: string } | null) => {
        if (d?.timezone) setShopTz(d.timezone)
      })
      .catch(() => {})
  }, [])

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

  const executeDelete = async (id: string) => {
    try {
      setDeletingId(id)
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
