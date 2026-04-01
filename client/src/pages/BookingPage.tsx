import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE } from '../config'
import { mapsSearchUrlFromAddress, whatsappHrefFromPhone } from '../lib/contact'
import { formatDate, formatTime, toInputDate } from '../lib/format'

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

type PublicSettings = {
  bookingMinLeadHours: number
  bookingMaxDaysAhead: number
  whatsappNumber?: string | null
  contactEmail?: string | null
  contactAddress?: string | null
}

/** Errores del servidor que indican que el slot ya no sirve; conviene refrescar la lista. */
function shouldRefreshSlotsAfterBookingError(
  status: number,
  errorText: string,
): boolean {
  if (status !== 400) return false
  const t = errorText.toLowerCase()
  return [
    'ese horario no está disponible',
    'horario no disponible',
    'horario fuera del horario de atención',
    'local cerrado ese día',
    'anticipación mínima no cumplida',
    'fecha fuera del rango permitido',
  ].some((s) => t.includes(s))
}

const MSG_SLOT_TOMADO_O_BLOQUEO =
  'El horario que elegiste ya no está disponible: alguien puede haberlo reservado o el local lo bloqueó. Actualizamos los horarios; elegí otro.'

function hasLocalPublicInfo(s: PublicSettings) {
  const addr = s.contactAddress?.trim()
  const wa = whatsappHrefFromPhone(s.whatsappNumber ?? null)
  const mail = s.contactEmail?.trim()
  return !!(addr || wa || mail)
}

function BookingContactFooter({ settings }: { settings: PublicSettings }) {
  const addr = settings.contactAddress?.trim()
  const mapUrl = mapsSearchUrlFromAddress(addr ?? null)
  const waHref = whatsappHrefFromPhone(settings.whatsappNumber ?? null)
  const mail = settings.contactEmail?.trim()

  return (
    <footer
      className="mt-auto pt-10 border-t border-slate-800/90"
      aria-label="Contacto del local"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-4">
        Contacto del local
      </p>
      <ul className="space-y-3 text-sm text-slate-400">
        {addr ? (
          <li className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-x-4">
            <div>
              <span className="text-slate-600 text-xs uppercase tracking-wide">
                Dirección
              </span>
              <p className="text-slate-300 whitespace-pre-wrap mt-0.5">{addr}</p>
            </div>
            {mapUrl ? (
              <a
                href={mapUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-600/80 bg-slate-900/80 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 hover:border-slate-500 transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width={18}
                  height={18}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0 opacity-90"
                  aria-hidden
                >
                  <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                Ver ubicación
              </a>
            ) : null}
          </li>
        ) : null}
        {waHref ? (
          <li>
            <span className="text-slate-600 text-xs uppercase tracking-wide block mb-1">
              WhatsApp
            </span>
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-emerald-500/90 hover:text-emerald-400 font-medium"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width={17}
                height={17}
                viewBox="0 0 24 24"
                fill="currentColor"
                className="shrink-0 opacity-90"
                aria-hidden
              >
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              Escribinos por WhatsApp
            </a>
          </li>
        ) : null}
        {mail ? (
          <li>
            <span className="text-slate-600 text-xs uppercase tracking-wide block mb-1">
              Email
            </span>
            <a
              href={`mailto:${encodeURIComponent(mail)}`}
              className="text-emerald-500/90 hover:text-emerald-400 font-medium break-all"
            >
              {mail}
            </a>
          </li>
        ) : null}
      </ul>
    </footer>
  )
}

export default function BookingPage() {
  const [services, setServices] = useState<Service[]>([])
  const [publicSettings, setPublicSettings] = useState<PublicSettings | null>(
    null,
  )

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
  /** True después de una búsqueda de horarios completada (aunque la lista venga vacía). */
  const [slotsFetched, setSlotsFetched] = useState(false)

  const { minDateStr, maxDateStr } = useMemo(() => {
    if (!publicSettings) {
      const t = new Date()
      return {
        minDateStr: toInputDate(t),
        maxDateStr: toInputDate(t),
      }
    }
    const minD = new Date()
    minD.setHours(minD.getHours() + publicSettings.bookingMinLeadHours)
    const maxD = new Date()
    maxD.setDate(maxD.getDate() + publicSettings.bookingMaxDaysAhead)
    return {
      minDateStr: toInputDate(minD),
      maxDateStr: toInputDate(maxD),
    }
  }, [publicSettings])

  /** Evita aplicar resultados de una petición anterior si el usuario cambió servicio/fecha rápido. */
  const slotsRequestIdRef = useRef(0)

  const loadSlots = useCallback(async () => {
    if (!selectedServiceId || !date) return
    const requestId = ++slotsRequestIdRef.current
    try {
      setError(null)
      setLoadingSlots(true)
      setSelectedSlot(null)

      const params = new URLSearchParams({
        serviceId: selectedServiceId,
        date,
      })

      const res = await fetch(`${API_BASE}/availability?${params.toString()}`)
      if (requestId !== slotsRequestIdRef.current) return

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(data?.error ?? 'No se pudo cargar la disponibilidad')
      }

      const data = (await res.json()) as { slots: Slot[] }
      if (requestId !== slotsRequestIdRef.current) return
      setSlots(data.slots)
      setSlotsFetched(true)
    } catch (e) {
      if (requestId !== slotsRequestIdRef.current) return
      const msg = e instanceof Error ? e.message : 'Error cargando disponibilidad'
      setError(msg)
    } finally {
      if (requestId === slotsRequestIdRef.current) {
        setLoadingSlots(false)
      }
    }
  }, [selectedServiceId, date])

  /** Carga inicial y al cambiar servicio, fecha o reglas públicas (min/max). */
  useEffect(() => {
    if (!publicSettings || !selectedServiceId) return
    setSlots([])
    setSlotsFetched(false)
    setSelectedSlot(null)
    void loadSlots()
  }, [publicSettings, selectedServiceId, date, loadSlots])

  useEffect(() => {
    const fetchInitial = async () => {
      try {
        setError(null)
        const [sRes, cfgRes] = await Promise.all([
          fetch(`${API_BASE}/services`),
          fetch(`${API_BASE}/public-settings`),
        ])

        if (!sRes.ok) {
          throw new Error('No se pudo cargar datos iniciales')
        }

        const sData = (await sRes.json()) as Service[]
        setServices(sData)

        if (sData.length > 0) setSelectedServiceId(sData[0].id)

        if (cfgRes.ok) {
          const cfg = (await cfgRes.json()) as PublicSettings
          setPublicSettings(cfg)
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Error cargando datos'
        setError(msg)
      }
    }

    void fetchInitial()
  }, [])

  useEffect(() => {
    if (!publicSettings) return
    setDate((d) => {
      if (d < minDateStr) return minDateStr
      if (d > maxDateStr) return maxDateStr
      return d
    })
  }, [publicSettings, minDateStr, maxDateStr])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedServiceId || !selectedSlot) {
      setError('Elegí servicio y horario.')
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
    const emailTrim = customerEmail.trim()
    if (!emailTrim) {
      setError(
        'El email es obligatorio para enviarte recordatorios y avisos del turno.',
      )
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
      setError('Ingresá un email válido.')
      return
    }

    try {
      setError(null)
      setSuccess(null)
      setLoading(true)

      const body = {
        serviceId: selectedServiceId,
        startsAt: selectedSlot.startsAt,
        customer: {
          name: customerName.trim(),
          phone: phoneDigits,
          email: emailTrim,
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
        setSelectedSlot(null)
        await loadSlots()
        setError(
          'Alguien acaba de reservar ese horario. Actualizamos los horarios disponibles; elegí otro.',
        )
        return
      }

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string | unknown }
          | null
        const err = data?.error
        const errStr =
          typeof err === 'string'
            ? err
            : err != null
              ? JSON.stringify(err)
              : ''
        if (
          typeof err === 'string' &&
          shouldRefreshSlotsAfterBookingError(res.status, err)
        ) {
          setSelectedSlot(null)
          await loadSlots()
          setError(MSG_SLOT_TOMADO_O_BLOQUEO)
          return
        }
        throw new Error(errStr || 'No se pudo crear el turno')
      }

      const created = (await res.json()) as AppointmentCreated
      setSuccess(created)
      setSelectedSlot(null)
      await loadSlots()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error creando turno'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col w-full">
      <div className="flex flex-1 flex-col px-4 w-full">
        <div className="w-full max-w-3xl mx-auto py-10 flex flex-col flex-1 min-h-[calc(100vh-3.5rem)]">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">
            Turnos Barbería
          </h1>
          <p className="text-slate-400 mt-1">
            Reservá tu turno eligiendo servicio, día y horario.
          </p>
          {publicSettings && (
            <p className="text-slate-500 text-xs mt-2">
              Podés reservar con al menos {publicSettings.bookingMinLeadHours}{' '}
              h de anticipación y hasta {publicSettings.bookingMaxDaysAhead}{' '}
              días adelante.
            </p>
          )}
        </header>

        <form
          onSubmit={handleSubmit}
          className="space-y-6 bg-slate-900/60 border border-slate-800 rounded-xl p-6 shadow-lg"
        >
          <section className="grid md:grid-cols-2 gap-4">
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
                min={minDateStr}
                max={maxDateStr}
                className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-medium text-slate-200">
              Horarios disponibles
            </h2>

            <div className="flex flex-wrap gap-2">
              {slots.length === 0 &&
                !slotsFetched &&
                publicSettings &&
                selectedServiceId &&
                !error && (
                  <p className="text-xs text-slate-400">Cargando horarios…</p>
                )}
              {slots.length === 0 && !slotsFetched && !publicSettings && (
                <p className="text-xs text-slate-400">Cargando datos…</p>
              )}
              {slotsFetched && slots.length === 0 && !loadingSlots && (
                <p className="text-xs text-slate-300 bg-slate-800/80 border border-slate-600 rounded px-3 py-2 w-full">
                  No hay turnos disponibles para la fecha seleccionada. Probá
                  otro día o actualizá si cambiaste el horario del local.
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
              <label
                className="text-sm text-slate-300"
                htmlFor="booking-phone"
              >
                Teléfono / WhatsApp
              </label>
              <input
                id="booking-phone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="Ej: 11 5555-5555 o +54 9 11 5555-5555"
              />
              <p className="text-xs text-slate-500">
                Podés usar espacios, guiones o el prefijo +. Tiene que tener al
                menos 6 dígitos (los símbolos no cuentan).
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm text-slate-300" htmlFor="booking-email">
                Email
              </label>
              <input
                id="booking-email"
                type="email"
                autoComplete="email"
                required
                className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="cliente@mail.com"
              />
              <p className="text-xs text-slate-500">
                Lo usamos para recordatorios y avisos sobre tu turno.
              </p>
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
              <div className="space-y-2 text-sm text-emerald-400 bg-emerald-950/40 border border-emerald-700 rounded px-3 py-2">
                <p className="font-medium text-emerald-300">
                  ¡Listo! Tu turno quedó confirmado.
                </p>
                <p>
                  Te esperamos el {formatDate(success.starts_at)} a las{' '}
                  {formatTime(success.starts_at)}.
                </p>
                <p className="text-emerald-400/90 text-xs flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  {(() => {
                    const waHref = whatsappHrefFromPhone(
                      publicSettings?.whatsappNumber ?? null,
                    )
                    const mail = publicSettings?.contactEmail?.trim()
                    const mapUrl = mapsSearchUrlFromAddress(
                      publicSettings?.contactAddress ?? null,
                    )
                    if (!waHref && !mail && !mapUrl) {
                      return <>Si necesitás cambiarlo, contactá al local.</>
                    }
                    return (
                      <>
                        <span>Si necesitás cambiarlo:</span>
                        {mapUrl && (
                          <a
                            href={mapUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-medium text-emerald-300 hover:text-emerald-200 underline-offset-2 hover:underline"
                          >
                            Ver ubicación
                          </a>
                        )}
                        {mapUrl && (waHref || mail) ? (
                          <span className="text-emerald-500/80">·</span>
                        ) : null}
                        {waHref && (
                          <a
                            href={waHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-medium text-emerald-300 hover:text-emerald-200 underline-offset-2 hover:underline"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width={17}
                              height={17}
                              viewBox="0 0 24 24"
                              fill="currentColor"
                              className="shrink-0 opacity-90"
                              aria-hidden
                            >
                              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                            </svg>
                            WhatsApp
                          </a>
                        )}
                        {waHref && mail ? (
                          <span className="text-emerald-500/80">·</span>
                        ) : null}
                        {!waHref && mapUrl && mail ? (
                          <span className="text-emerald-500/80">·</span>
                        ) : null}
                        {mail ? (
                          <a
                            href={`mailto:${encodeURIComponent(mail)}`}
                            className="font-medium text-emerald-300 hover:text-emerald-200 underline-offset-2 hover:underline"
                          >
                            Email
                          </a>
                        ) : null}
                      </>
                    )
                  })()}
                </p>
              </div>
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

        {publicSettings && hasLocalPublicInfo(publicSettings) && (
          <BookingContactFooter settings={publicSettings} />
        )}
        </div>
      </div>
    </div>
  )
}
