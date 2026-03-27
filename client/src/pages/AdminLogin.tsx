import { useState } from 'react'
import { API_BASE } from '../config'
import { setAdminToken } from '../adminToken'

type Props = {
  onLoggedIn: () => void
}

export default function AdminLogin({ onLoggedIn }: Props) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/admin/login`, {
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
      setAdminToken(data.token)
      setPassword('')
      onLoggedIn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex justify-center px-4">
      <div className="w-full max-w-md py-16">
        <h1 className="text-2xl font-semibold tracking-tight mb-1">
          Panel admin
        </h1>
        <p className="text-slate-400 text-sm mb-8">
          Ingresá la contraseña configurada en el servidor.
        </p>
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="space-y-4 bg-slate-900/60 border border-slate-800 rounded-xl p-6"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="admin-password" className="text-sm text-slate-300">
              Contraseña
            </label>
            <input
              id="admin-password"
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
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
