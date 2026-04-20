import { useEffect, useState } from 'react'
import { DEFAULT_SHOP_SLUG, shopAdminPath, shopPublicPath } from '../config'
import { setAdminSession } from '../adminToken'

type Props = {
  shopSlug: string
  onLoggedIn: () => void
}

export default function AdminLogin({ shopSlug, onLoggedIn }: Props) {
  const [ownerEmail, setOwnerEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [shopName, setShopName] = useState<string | null>(null)

  const isDemo = shopSlug === DEFAULT_SHOP_SLUG

  useEffect(() => {
    setOwnerEmail('')
    setPassword('')
    setError(null)
  }, [shopSlug])

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
        /* cae al fallback "Panel admin" */
      })
    return () => {
      cancelled = true
    }
  }, [shopSlug])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const em = ownerEmail.trim()
      const body: { password: string; ownerEmail?: string } =
        isDemo || !em ? { password } : { password, ownerEmail: em }

      const res = await fetch(shopAdminPath(shopSlug, 'login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => null)) as {
        token?: string
        error?: string
      } | null
      if (!res.ok) {
        throw new Error(data?.error ?? 'No se pudo iniciar sesión')
      }
      if (!data?.token) throw new Error('Respuesta inválida del servidor')
      setAdminSession({ token: data.token, shopSlug })
      setPassword('')
      onLoggedIn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    } finally {
      setLoading(false)
    }
  }

  const canSubmit = Boolean(password)

  return (
    <div className="flex justify-center px-4">
      <div className="w-full max-w-md py-16">
        <h1 className="text-2xl font-semibold tracking-tight mb-6">
          {shopName ? `Hola, ${shopName}` : 'Panel admin'}
        </h1>
        <div className="mb-6 space-y-2 text-slate-400 text-sm">
          {isDemo ? (
            <>
              <p>Ingresá la contraseña</p>
              <p>Contraseña de prueba: admin12345</p>
            </>
          ) : (
            <>
              <p>
                Ingresá la contraseña que definiste al crear el local. Si en el futuro
                hay más de un usuario en este local, también te pediremos el email.
              </p>
              <p className="text-slate-500 text-xs">
                El email es opcional mientras seas el único dueño. Si lo dejás vacío y
                falla el acceso, probá la contraseña global solo en entornos de
                administración del servidor.
              </p>
            </>
          )}
        </div>
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="space-y-4 bg-slate-900/60 border border-slate-800 rounded-xl p-6"
        >
          {!isDemo && (
            <div className="flex flex-col gap-1">
              <label htmlFor="admin-owner-email" className="text-sm text-slate-300">
                Email (opcional)
              </label>
              <input
                id="admin-owner-email"
                type="email"
                autoComplete="username"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500"
                placeholder="Solo si el local tiene más de un usuario"
              />
            </div>
          )}
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
            disabled={loading || !canSubmit}
            className="w-full py-2.5 rounded bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-400 text-sm font-medium transition-colors"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
