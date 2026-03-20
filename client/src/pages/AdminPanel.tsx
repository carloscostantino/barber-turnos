import { useCallback, useEffect, useState } from 'react'
import { clearAdminToken, getAdminToken } from '../adminToken'
import { API_BASE } from '../config'
import { dayRangeIso, formatDate, formatTime, toInputDate } from '../lib/format'
import AdminLogin from './AdminLogin'

type Barber = { id: string; name: string }

type AppointmentRow = {
  id: string
  starts_at: string
  ends_at: string
  status: string
  notes: string | null
  barber_name: string
  service_name: string
  customer_name: string
  customer_phone: string
  customer_email: string | null
}

type AppointmentStatus = 'pending' | 'confirmed' | 'cancelled'

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

export default function AdminPanel() {
  const [token, setToken] = useState<string | null>(() => getAdminToken())
  const [barbers, setBarbers] = useState<Barber[]>([])
  const [filterBarberId, setFilterBarberId] = useState<string | ''>('')
  const [date, setDate] = useState(() => toInputDate(new Date()))
  const [rows, setRows] = useState<AppointmentRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const authHeaders = useCallback(
    () => ({
      Authorization: `Bearer ${token}`,
    }),
    [token],
  )

  const forceRelogin = useCallback(() => {
    clearAdminToken()
    setToken(null)
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/barbers`)
        if (!res.ok) throw new Error('No se pudieron cargar barberos')
        const data = (await res.json()) as Barber[]
        setBarbers(data)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error')
      }
    })()
  }, [])

  const loadAppointments = useCallback(async () => {
    if (!token) return
    try {
      setError(null)
      setLoading(true)
      const { from, to } = dayRangeIso(date)
      const params = new URLSearchParams({ from, to })
      if (filterBarberId) params.set('barberId', filterBarberId)
      const res = await fetch(`${API_BASE}/appointments?${params}`, {
        headers: authHeaders(),
      })
      if (res.status === 401) {
        forceRelogin()
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
      setError(e instanceof Error ? e.message : 'Error cargando turnos')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [authHeaders, date, filterBarberId, forceRelogin, token])

  useEffect(() => {
    void loadAppointments()
  }, [loadAppointments])

  const patchStatus = async (id: string, status: AppointmentStatus) => {
    if (!token) return
    try {
      setUpdatingId(id)
      setError(null)
      const res = await fetch(`${API_BASE}/appointments/${id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({ status }),
      })
      if (res.status === 401) {
        forceRelogin()
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

  if (!token) {
    return <AdminLogin onLoggedIn={() => setToken(getAdminToken())} />
  }

  return (
    <div className="flex justify-center px-4">
      <div className="w-full max-w-6xl py-10">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Panel de turnos
            </h1>
            <p className="text-slate-400 mt-1">
              Vista del día: confirmá, cancelá o revisá reservas. La sesión
              dura 7 días o hasta que cierres la pestaña (token en{' '}
              <code className="text-slate-500">sessionStorage</code>).
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              forceRelogin()
            }}
            className="shrink-0 text-sm px-4 py-2 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 transition-colors"
          >
            Cerrar sesión
          </button>
        </header>

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
          <div className="flex flex-col gap-1 min-w-[180px]">
            <label className="text-sm text-slate-300">Barbero</label>
            <select
              value={filterBarberId}
              onChange={(e) => setFilterBarberId(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value="">Todos</option>
              {barbers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
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
                  <th className="px-4 py-3 font-medium">Barbero</th>
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
                      colSpan={7}
                      className="px-4 py-8 text-center text-slate-500"
                    >
                      No hay turnos para esta fecha{filtroBarberLabel(filterBarberId, barbers)}.
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
                    <td className="px-4 py-3 text-slate-200">
                      {r.barber_name}
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {r.service_name}
                    </td>
                    <td className="px-4 py-3 text-slate-200">
                      {r.customer_name}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      <div>{r.customer_phone}</div>
                      {r.customer_email && (
                        <div className="truncate max-w-[140px]" title={r.customer_email}>
                          {r.customer_email}
                        </div>
                      )}
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
                No hay turnos para esta fecha
                {filtroBarberLabel(filterBarberId, barbers)}.
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
                      {formatDate(r.starts_at)} · {r.barber_name}
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
                <p className="text-xs text-slate-500">
                  {r.customer_phone}
                  {r.customer_email ? ` · ${r.customer_email}` : ''}
                </p>
                {r.notes && (
                  <p className="text-xs text-slate-400 italic">Nota: {r.notes}</p>
                )}
                <ActionButtons
                  status={r.status as AppointmentStatus}
                  busy={updatingId === r.id}
                  onPatch={patchStatus}
                  id={r.id}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function filtroBarberLabel(id: string | '', barbers: Barber[]) {
  if (!id) return ''
  const b = barbers.find((x) => x.id === id)
  return b ? ` · ${b.name}` : ''
}

function ActionButtons({
  id,
  status,
  busy,
  onPatch,
}: {
  id: string
  status: AppointmentStatus
  busy: boolean
  onPatch: (id: string, s: AppointmentStatus) => void
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
            onClick={() => void onPatch(id, 'cancelled')}
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
          onClick={() => void onPatch(id, 'cancelled')}
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
