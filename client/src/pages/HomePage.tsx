import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { API_BASE, DEFAULT_SHOP_SLUG } from '../config'

export default function HomePage() {
  const navigate = useNavigate()
  const demoPath = `/s/${DEFAULT_SHOP_SLUG}`
  const [resetting, setResetting] = useState(false)

  const handleDemoClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    if (resetting) return
    setResetting(true)
    try {
      await fetch(`${API_BASE}/demo/reset`, { method: 'POST' })
    } catch {
      /* si falla el reset igual entramos al demo */
    } finally {
      setResetting(false)
      navigate(demoPath)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
      <header className="border-b border-slate-800 bg-slate-900/60 px-4 py-4">
        <div className="max-w-3xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <Link
            to="/"
            className="text-slate-100 text-sm font-semibold tracking-tight hover:text-white"
          >
            Turnos online
          </Link>
          <Link
            to="/register"
            className="text-sm text-emerald-400 hover:text-emerald-300 underline-offset-2 hover:underline"
          >
            Crear barbería
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col justify-center px-4 py-12">
        <div className="max-w-xl mx-auto text-center space-y-6">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
            Turnos online para tu barbería
          </h1>
          <p className="text-slate-400 text-base leading-relaxed">
            Registrá tu local en minutos, compartí tu enlace y dejá que los
            clientes reserven solos.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Link
              to="/register"
              className="inline-flex justify-center items-center px-6 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium transition-colors"
            >
              Crear mi barbería
            </Link>
            <Link
              to={demoPath}
              onClick={handleDemoClick}
              aria-disabled={resetting}
              className="inline-flex justify-center items-center px-6 py-3 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-800/80 text-sm font-medium transition-colors disabled:opacity-60"
            >
              {resetting ? 'Preparando demo…' : 'Ver demo de reservas'}
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
