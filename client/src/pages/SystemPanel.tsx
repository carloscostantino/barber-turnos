import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE } from '../config'
import {
  clearSystemAdminToken,
  getSystemAdminToken,
} from '../systemAdminToken'

type ShopStatus = 'active' | 'trial' | 'suspended'

type ShopOverview = {
  id: string
  slug: string
  name: string
  status: ShopStatus
  timezone: string
  created_at: string
  owner_email: string | null
  subscription_status: string | null
  subscription_provider: string | null
  current_period_end: string | null
  total_appointments: number
  appointments_this_month: number
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
