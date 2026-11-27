import { lazy, startTransition, Suspense, useState } from 'react'
import type { CompareCalendarProps, DatePickerProps, DateRangePickerProps } from './DatePickers'
import { rangeLabel } from './dateLabels'
import { CalendarIcon } from './icons'

// DatePickers, with React Aria's calendars and date fields (about a third of it), loads when a
// picker is wanted, not with the page. Until then each picker has a look-alike stand-in.
const loadPickers = () => import('./DatePickers')
const LoadedRangePicker = lazy(() => loadPickers().then((m) => ({ default: m.DateRangePicker })))
const LoadedDatePicker = lazy(() => loadPickers().then((m) => ({ default: m.DatePicker })))
const LoadedCompareCalendar = lazy(() => loadPickers().then((m) => ({ default: m.CompareCalendar })))

// CompareMenu's calendar, only there once a custom start is picked, so it loads then
export function CompareCalendar(props: CompareCalendarProps) {
  return (
    <Suspense
      fallback={
        <div className="status-text" style={{ padding: 'var(--space-md)' }}>
          Loading…
        </div>
      }
    >
      <LoadedCompareCalendar {...props} />
    </Suspense>
  )
}

// PeriodToggle's calendar button is always shown, so it loads on hover, focus or open
export function DateRangePicker(props: DateRangePickerProps) {
  const [wanted, setWanted] = useState(false)
  const [focused, setFocused] = useState(false)
  // A transition, so the stand-in stays (and keeps focus) until the picker is ready
  const want = () => startTransition(() => setWanted(true))

  const standIn = (
    <button
      aria-label={props.value ? rangeLabel(props.value) : 'Custom dates'}
      aria-haspopup="dialog"
      aria-expanded={props.isOpen}
      className={props.isActive ? 'calendar-button is-active' : 'calendar-button'}
      onPointerEnter={want}
      onFocus={() => {
        setFocused(true)
        want()
      }}
      onBlur={() => setFocused(false)}
      onClick={() => {
        want()
        props.onOpenChange(true)
      }}
    >
      <CalendarIcon />
    </button>
  )

  return (
    <Suspense fallback={standIn}>
      {wanted || props.isOpen ? <LoadedRangePicker {...props} autoFocus={focused} /> : standIn}
    </Suspense>
  )
}

// Only in GeneratorPanel's Offers view, so it loads with it
export function DatePicker(props: DatePickerProps) {
  return (
    <Suspense fallback={<DateFieldStandIn value={props.value} />}>
      <LoadedDatePicker {...props} />
    </Suspense>
  )
}

function DateFieldStandIn({ value }: { value: string }) {
  const [y, m, d] = value.split('-')
  return (
    <div className="date-field" aria-busy="true">
      <span className="date-field-input">{value ? `${d}/${m}/${y}` : 'dd/mm/yyyy'}</span>
      <span className="date-field-button">
        <CalendarIcon />
      </span>
    </div>
  )
}
