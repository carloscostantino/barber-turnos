import { es } from 'date-fns/locale'
import { useCallback, useMemo } from 'react'
import { DayPicker, getDefaultClassNames } from 'react-day-picker'
import {
  parseYmdLocal,
  toYmdLocal,
} from '../lib/bookingEligibleDates'
import 'react-day-picker/style.css'

type Props = {
  /** YYYY-MM-DD */
  date: string
  onChangeDate: (ymd: string) => void
  eligibleDates: readonly string[]
  minDateStr: string
  maxDateStr: string
  id?: string
}

export function BookingDateCalendar({
  date,
  onChangeDate,
  eligibleDates,
  minDateStr,
  maxDateStr,
  id,
}: Props) {
  const defaultClassNames = getDefaultClassNames()
  const eligibleSet = useMemo(() => new Set(eligibleDates), [eligibleDates])

  const isDisabled = useCallback(
    (d: Date) => !eligibleSet.has(toYmdLocal(d)),
    [eligibleSet],
  )

  const fromDate = useMemo(() => parseYmdLocal(minDateStr), [minDateStr])
  const toDate = useMemo(() => parseYmdLocal(maxDateStr), [maxDateStr])

  const selected = date ? parseYmdLocal(date) : undefined
  const defaultMonth = selected ?? fromDate

  const hintId = id ? `${id}-hint` : undefined

  if (eligibleDates.length === 0) {
    return (
      <div
        id={id}
        className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-4 text-sm text-slate-400"
        role="status"
      >
        No hay fechas disponibles en este rango.
      </div>
    )
  }

  return (
    <div
      id={id}
      className="booking-date-calendar space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3"
      role="group"
      aria-label="Calendario para elegir el día del turno"
      aria-describedby={hintId}
    >
      <DayPicker
        key={date || 'none'}
        mode="single"
        locale={es}
        weekStartsOn={1}
        /** Botones a los lados del mes; sin esto en v9 el layout puede ocultar mal la flecha. */
        navLayout="around"
        defaultMonth={defaultMonth}
        selected={selected}
        onSelect={(d) => {
          if (d && eligibleSet.has(toYmdLocal(d))) {
            onChangeDate(toYmdLocal(d))
          }
        }}
        disabled={isDisabled}
        fromDate={fromDate}
        toDate={toDate}
        classNames={{
          root: `${defaultClassNames.root} booking-day-picker p-0`,
          months: `${defaultClassNames.months} flex flex-col gap-4`,
          month: `${defaultClassNames.month} space-y-2`,
          month_caption:
            'rdp-month_caption flex h-9 items-center justify-center relative px-9 pb-1',
          caption_label:
            'rdp-caption_label text-sm font-medium text-slate-200 capitalize',
          nav: `${defaultClassNames.nav} flex items-center gap-1`,
          chevron: `${defaultClassNames.chevron} size-4 fill-slate-200`,
          button_previous:
            'rdp-button_previous absolute left-1 top-0 inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-600 bg-slate-800/90 text-slate-200 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:opacity-30',
          button_next:
            'rdp-button_next absolute right-1 top-0 inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-600 bg-slate-800/90 text-slate-200 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:opacity-30',
          weekdays: 'flex',
          weekday:
            'w-9 text-center text-[0.7rem] font-medium uppercase tracking-wide text-slate-500',
          week: 'mt-1 flex w-full',
          day: 'relative flex h-9 w-9 items-center justify-center p-0 text-sm',
          day_button:
            'inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-200 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-500',
          selected:
            '[&_button]:bg-emerald-600 [&_button]:text-white [&_button]:hover:bg-emerald-600',
          today: '[&_button]:text-emerald-400 [&_button]:font-semibold',
          disabled: 'opacity-35 [&_button]:cursor-not-allowed [&_button]:text-slate-500',
          outside: 'text-slate-600 opacity-40',
        }}
      />
      <p className="text-xs text-slate-500" id={hintId}>
        Los días atenuados están cerrados o bloqueados.
      </p>
    </div>
  )
}
