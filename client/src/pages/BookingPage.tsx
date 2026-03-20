import { useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../config'
import { formatDate, formatTime, toInputDate } from '../lib/format'

type Barber = {
  id: string
  name: string
}

type Service = {
  id: string
  name: string
  duration_minutes: number
  price_cents: number
}

type Slot = {
  startsAt: string
  endsAt: string
}

type AppointmentCreated = {
  id: string
  starts_at: string
  ends_at: string
  status: string
}

export default function BookingPage() {
  const [barbers, setBarbers] = useState<Barber[]>([])
  const [services, setServices] = useState<Service[]>([])

  const [selectedBarberId, setSelectedBarberId] = useState<string | ''>('')
  const [selectedServiceId, setSelectedServiceId] = useState<string | ''>('')
  const [date, setDate] = useState(() => toInputDate(new Date()))

  const [slots, setSlots] = useState<Slot[]>([])
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)

  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [notes, setNotes] = useState('')

  const [loading, setLoading] = useState(false)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<AppointmentCreated | null>(null)

  const canSearchSlots = useMemo(
    () => !!selectedBarberId && !!selectedServiceId && !!date,
    [selectedBarberId, selectedServiceId, date],
  )

  useEffect(() => {
    const fetchInitial = async () => {
      try {
        setError(null)
        const [bRes, sRes] = await Promise.all([
          fetch(`${API_BASE}/barbers`),
          fetch(`${API_BASE}/services`),
        ])

        if (!bRes.ok || !sRes.ok) {
          throw new Error('No se pudo cargar datos iniciales')
        }

        const [bData, sData] = (await Promise.all([
          bRes.json(),
          sRes.json(),
        ])) as [Barber[], Service[]]

        setBarbers(bData)
        setServices(sData)

        if (bData.length > 0) setSelectedBarberId(bData[0].id)
        if (sData.length > 0) setSelectedServiceId(sData[0].id)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Error cargando datos'
        setError(msg)
      }
    }

    void fetchInitial()
  }, [])

  const handleLoadSlots = async () => {
    if (!canSearchSlots) return
    try {
      setError(null)
      setLoadingSlots(true)
      setSelectedSlot(null)

      const params = new URLSearchParams({
        barberId: selectedBarberId,
        serviceId: selectedServiceId,
        date,
      })

      const res = await fetch(`${API_BASE}/availability?${params.toString()}`)
      if (!res.ok) throw new Error('No se pudo cargar la disponibilidad')

      const data = (await res.json()) as { slots: Slot[] }
      setSlots(data.slots)
      if (data.slots.length === 0) {
        setError('No hay horarios disponibles para ese día.')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error cargando disponibilidad'
      setError(msg)
    } finally {
      setLoadingSlots(false)
    }
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedBarberId || !selectedServiceId || !selectedSlot) {
      setError('Elegí barbero, servicio y horario.')
      return
    }
    if (!customerName.trim() || !customerPhone.trim()) {
      setError('Nombre y teléfono del cliente son obligatorios.')
      return
    }
    const phoneDigits = customerPhone.replace(/[^\d+]/g, '')
    if (phoneDigits.length < 6) {
      setError('El teléfono debe tener al menos 6 dígitos (sin contar espacios ni guiones).')
      return
    }
    if (customerName.trim().length < 2) {
      setError('El nombre debe tener al menos 2 caracteres.')
      return
    }

    try {
      setError(null)
      setSuccess(null)
      setLoading(true)

      const body = {
        barberId: selectedBarberId,
        serviceId: selectedServiceId,
        startsAt: selectedSlot.startsAt,
        customer: {
          name: customerName.trim(),
          phone: customerPhone,
          email: customerEmail.trim() || undefined,
        },
        notes: notes.trim() || undefined,
      }

      const res = await fetch(`${API_BASE}/appointments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (res.status === 409) {
        setError('Ese horario se ocupó recién. Elegí otro.')
        setSelectedSlot(null)
        await handleLoadSlots()
        return
      }

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string | unknown }
          | null
        const err = data?.error
        const msg =
          typeof err === 'string'
            ? err
            : err != null
              ? JSON.stringify(err)
              : 'No se pudo crear el turno'
        throw new Error(msg)
      }

      const created = (await res.json()) as AppointmentCreated
      setSuccess(created)
      setSelectedSlot(null)
      await handleLoadSlots()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error creando turno'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex justify-center px-4">
      <div className="w-full max-w-3xl py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">
            Turnos Barbería
          </h1>
          <p className="text-slate-400 mt-1">
            Reservá tu turno eligiendo barbero, servicio, día y horario.
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="space-y-6 bg-slate-900/60 border border-slate-800 rounded-xl p-6 shadow-lg"
        >
          <section className="grid md:grid-cols-3 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm text-slate-300">Barbero</label>
              <select
                className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                value={selectedBarberId}
                onChange={(e) => setSelectedBarberId(e.target.value)}
              >
                {barbers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm text-slate-300">Servicio</label>
              <select
                className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                value={selectedServiceId}
                onChange={(e) => setSelectedServiceId(e.target.value)}
              >
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} (
                    {Math.round(s.duration_minutes)} min)
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm text-slate-300">Fecha</label>
              <input
                type="date"
                className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-slate-200">
                Horarios disponibles
              </h2>
              <button
                type="button"
                onClick={handleLoadSlots}
                disabled={!canSearchSlots || loadingSlots}
                className="text-xs px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-400 transition-colors"
              >
                {loadingSlots ? 'Cargando...' : 'Actualizar horarios'}
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {slots.length === 0 && !loadingSlots && (
                <p className="text-xs text-slate-400">
                  No hay horarios cargados todavía. Elegí fecha y presioná
                  &quot;Actualizar horarios&quot;.
                </p>
              )}
              {slots.map((slot) => {
                const isSelected =
                  selectedSlot?.startsAt === slot.startsAt &&
                  selectedSlot?.endsAt === slot.endsAt
                return (
                  <button
                    key={slot.startsAt}
                    type="button"
                    onClick={() => setSelectedSlot(slot)}
                    className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                      isSelected
                        ? 'bg-emerald-600 border-emerald-400 text-white'
                        : 'bg-slate-900 border-slate-700 text-slate-200 hover:border-emerald-400'
                    }`}
                  >
                    {formatTime(slot.startsAt)}
                  </button>
                )
              })}
            </div>

            {selectedSlot && (
              <p className="text-xs text-emerald-400">
                Turno seleccionado:{' '}
                <span className="font-medium">
                  {formatDate(selectedSlot.startsAt)}{' '}
                  {formatTime(selectedSlot.startsAt)} –{' '}
                  {formatTime(selectedSlot.endsAt)}
                </span>
              </p>
            )}
          </section>

          <section className="grid md:grid-cols-3 gap-4">
            <div className="flex flex-col gap-1 md:col-span-2">
              <label className="text-sm text-slate-300">
                Nombre del cliente
              </label>
              <input
                className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Ej: Juan Pérez"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm text-slate-300">
                Teléfono (WhatsApp)
              </label>
              <input
                className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="Ej: 11 5555-5555"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm text-slate-300">Email (opcional)</label>
              <input
                className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="cliente@mail.com"
              />
            </div>

            <div className="flex flex-col gap-1 md:col-span-2">
              <label className="text-sm text-slate-300">Notas (opcional)</label>
              <textarea
                className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500 min-h-[60px]"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej: prefiere máquina, etc."
              />
            </div>
          </section>

          <section className="space-y-2">
            {error && (
              <p className="text-sm text-red-400 bg-red-950/50 border border-red-800 rounded px-3 py-2">
                {error}
              </p>
            )}
            {success && (
              <p className="text-sm text-emerald-400 bg-emerald-950/40 border border-emerald-700 rounded px-3 py-2">
                Turno creado correctamente para{' '}
                {formatDate(success.starts_at)}{' '}
                {formatTime(success.starts_at)} (estado:{' '}
                <span className="font-semibold uppercase">
                  {success.status}
                </span>
                ).
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full md:w-auto inline-flex justify-center items-center gap-2 px-5 py-2.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-400 text-sm font-medium transition-colors"
            >
              {loading ? 'Guardando...' : 'Confirmar turno'}
            </button>
          </section>
        </form>
      </div>
    </div>
  )
}
