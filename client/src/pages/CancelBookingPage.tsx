import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { API_BASE } from '../config'

export default function CancelBookingPage() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const [status, setStatus] = useState<
    'idle' | 'loading' | 'ok' | 'already' | 'error'
  >('idle')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!token?.trim()) {
      setStatus('error')
      setMessage('Falta el enlace de cancelación. Abrí el link del correo.')
      return
    }

    const run = async () => {
      setStatus('loading')
      setMessage(null)
      try {
        const res = await fetch(`${API_BASE}/appointments/cancel-by-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token.trim() }),
        })
        const data = (await res.json().catch(() => null)) as {
          error?: string
          alreadyCancelled?: boolean
          ok?: boolean
        } | null
        if (res.ok && data?.alreadyCancelled) {
          setStatus('already')
          setMessage('Este turno ya estaba cancelado.')
          return
        }
        if (res.ok && data?.ok) {
          setStatus('ok')
          setMessage('Tu turno quedó cancelado.')
          return
        }
        setStatus('error')
        setMessage(data?.error ?? 'No se pudo cancelar el turno.')
      } catch {
        setStatus('error')
        setMessage('Error de red. Probá de nuevo.')
      }
    }

    void run()
  }, [token])

  return (
    <div className="w-full max-w-lg mx-auto py-12 px-4">
      <h1 className="text-2xl font-semibold text-slate-100 mb-2">
        Cancelar turno
      </h1>
      {status === 'loading' && (
        <p className="text-slate-400 text-sm">Procesando…</p>
      )}
      {message && (
        <p
          className={`text-sm mt-4 rounded border px-3 py-2 ${
            status === 'ok' || status === 'already'
              ? 'text-emerald-300 border-emerald-800 bg-emerald-950/40'
              : 'text-red-300 border-red-800 bg-red-950/40'
          }`}
        >
          {message}
        </p>
      )}
      {status === 'ok' && (
        <p className="text-slate-500 text-sm mt-4">
          Si necesitás otro horario, volvé a reservar desde la página principal.
        </p>
      )}
    </div>
  )
}
