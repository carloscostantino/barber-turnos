import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE } from '../config'
import { setSystemAdminToken } from '../systemAdminToken'

export default function SystemLogin() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/system/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = (await res.json().catch(() => null)) as {
        token?: string
        error?: string
      } | null
      if (!res.ok) {
        throw new Error(data?.error ?? 'No se pudo iniciar sesión')
      }
      if (!data?.token) throw new Error('Respuesta inválida del servidor')
      setSystemAdminToken(data.token)
      setPassword('')
      navigate('/system', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex justify-center px-4">
      <div className="w-full max-w-md py-16">
        <h1 className="text-2xl font-semibold tracking-tight mb-2">
          Panel del sistema
        </h1>
        <p className="text-slate-400 text-sm mb-6">
          Acceso exclusivo del super-admin para ver y gestionar todas las barberías.
        </p>
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="space-y-4 bg-slate-900/60 border border-slate-800 rounded-xl p-6"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="system-password" className="text-sm text-slate-300">
              Contraseña
            </label>
            <input
              id="system-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500"
              placeholder="••••••••"
            />
          </div>
          {error && (
            <p className="text-sm text-red-400 bg-red-950/50 border border-red-800 rounded px-3 py-2">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-2.5 rounded bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-400 text-sm font-medium transition-colors"
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
