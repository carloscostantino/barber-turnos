import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE, DEFAULT_SHOP_SLUG } from '../config'
import { normalizeShopSlug } from '../lib/shopSlug'

export default function RegisterShopPage() {
  const [shopName, setShopName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugManual, setSlugManual] = useState(false)
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [doneSlug, setDoneSlug] = useState<string | null>(null)
  const [doneCheckoutUrl, setDoneCheckoutUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!slugManual) {
      setSlug(normalizeShopSlug(shopName))
    }
  }, [shopName, slugManual])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/shops/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: normalizeShopSlug(slug),
          shopName: shopName.trim(),
          ownerEmail: ownerEmail.trim(),
          ownerPassword,
        }),
      })
      const data = (await res.json().catch(() => null)) as {
        slug?: string
        error?: string
        checkoutUrl?: string
      } | null
      if (!res.ok) {
        throw new Error(data?.error ?? 'No se pudo registrar')
      }
      if (data?.slug) setDoneSlug(data.slug)
      setDoneCheckoutUrl(
        typeof data?.checkoutUrl === 'string' && data.checkoutUrl.startsWith('http')
          ? data.checkoutUrl
          : null,
      )
      setOwnerPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    } finally {
      setLoading(false)
    }
  }

  if (doneSlug) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-50">
        <header className="border-b border-slate-800 bg-slate-900/60">
          <div className="max-w-md mx-auto px-4 py-3 flex flex-wrap justify-between gap-2 text-sm">
            <Link to="/" className="text-slate-300 hover:text-white">
              Inicio
            </Link>
            <Link
              to={`/s/${DEFAULT_SHOP_SLUG}`}
              className="text-slate-400 hover:text-emerald-400"
            >
              Ver demo
            </Link>
          </div>
        </header>
        <div className="max-w-md mx-auto px-4 py-16 text-center space-y-4">
        <h1 className="text-2xl font-semibold">¡Listo!</h1>
        <p className="text-slate-400 text-sm">
          Tu local quedó creado. Podés reservar en{' '}
          <Link className="text-emerald-400 underline" to={`/s/${doneSlug}`}>
            /s/{doneSlug}
          </Link>{' '}
          e iniciar sesión en el panel con la contraseña que elegiste (el email solo
          aplica si hay más de un usuario en el local).
        </p>
        <p className="text-slate-500 text-xs max-w-md mx-auto">
          Al abrir el panel te ofrecemos un recorrido opcional por nombre y contacto,
          horarios y servicios. Podés omitirlo en cualquier momento.
        </p>
        <div className="text-left max-w-md mx-auto space-y-2 text-xs text-slate-500 border border-slate-800 rounded-lg px-4 py-3 bg-slate-900/40">
          <p className="font-medium text-slate-400 text-sm">Accesos directos al panel</p>
          <ul className="space-y-1 list-disc list-inside">
            <li>
              <Link
                className="text-violet-400 hover:underline"
                to={`/s/${doneSlug}/admin?tab=configuracion`}
              >
                Configuración
              </Link>
            </li>
            <li>
              <Link
                className="text-violet-400 hover:underline"
                to={`/s/${doneSlug}/admin?tab=horarios`}
              >
                Horarios
              </Link>
            </li>
            <li>
              <Link
                className="text-violet-400 hover:underline"
                to={`/s/${doneSlug}/admin?tab=servicios`}
              >
                Servicios
              </Link>
            </li>
          </ul>
        </div>
        {doneCheckoutUrl && (
          <div className="rounded-lg border border-violet-800/80 bg-violet-950/40 px-4 py-3 text-left">
            <p className="text-sm text-violet-200 mb-2">
              Activá el plan mensual con tarjeta (Stripe). Podés completar el pago
              ahora o más tarde; el local ya quedó creado en modo prueba.
            </p>
            <a
              href={doneCheckoutUrl}
              className="inline-block w-full text-center py-2.5 rounded bg-violet-600 hover:bg-violet-500 text-sm font-medium"
            >
              Ir al pago seguro
            </a>
          </div>
        )}
        <Link
          to={`/s/${doneSlug}/admin?onboarding=1`}
          className="inline-block mt-4 px-4 py-2 rounded bg-emerald-600 text-sm font-medium"
        >
          Ir al panel (recorrido opcional)
        </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <header className="border-b border-slate-800 bg-slate-900/60">
        <div className="max-w-md mx-auto px-4 py-3 flex flex-wrap justify-between gap-2 text-sm">
          <Link to="/" className="text-slate-300 hover:text-white">
            Inicio
          </Link>
          <Link
            to={`/s/${DEFAULT_SHOP_SLUG}`}
            className="text-slate-400 hover:text-emerald-400"
          >
            Ver demo
          </Link>
        </div>
      </header>
      <div className="max-w-md mx-auto px-4 py-12">
      <h1 className="text-2xl font-semibold mb-2">Alta de barbería</h1>
      <p className="text-slate-400 text-sm mb-6">
        Completá el nombre del local; el identificador de la URL se completa solo
        y podés ajustarlo después si querés. Después del alta podrás revisar en el
        panel contacto, horarios y servicios (recorrido guiado opcional).
      </p>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <div>
          <label htmlFor="register-shop-name" className="text-sm text-slate-300">
            Nombre del local
          </label>
          <input
            id="register-shop-name"
            className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
            value={shopName}
            onChange={(e) => setShopName(e.target.value)}
            required
            minLength={2}
            autoComplete="organization"
          />
        </div>
        <div>
          <label htmlFor="register-shop-slug" className="text-sm text-slate-300">
            Identificador (URL)
          </label>
          <input
            id="register-shop-slug"
            className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
            value={slug}
            onChange={(e) => {
              setSlugManual(true)
              setSlug(normalizeShopSlug(e.target.value))
            }}
            placeholder="se-genera-del-nombre"
            required
            minLength={2}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </div>
        <div>
          <label htmlFor="register-owner-email" className="text-sm text-slate-300">
            Tu email (dueño) <span className="text-red-400">*</span>
          </label>
          <input
            id="register-owner-email"
            type="email"
            className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            required
            aria-describedby="register-owner-email-help"
          />
          <p
            id="register-owner-email-help"
            className="mt-1 text-xs text-slate-500"
          >
            Lo usamos para avisos importantes (fin del período de prueba,
            cambios de precio, problemas con la suscripción). No lo compartimos.
          </p>
        </div>
        <div>
          <label htmlFor="register-owner-password" className="text-sm text-slate-300">
            Contraseña
          </label>
          <input
            id="register-owner-password"
            type="password"
            className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
            value={ownerPassword}
            onChange={(e) => setOwnerPassword(e.target.value)}
            required
            minLength={8}
          />
        </div>
        {error && (
          <p className="text-sm text-red-400 border border-red-800 rounded px-3 py-2">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50"
        >
          {loading ? 'Creando…' : 'Crear mi barbería'}
        </button>
      </form>
    </div>
    </div>
  )
}
