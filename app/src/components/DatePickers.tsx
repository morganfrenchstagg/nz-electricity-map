import { useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import {
  Button, Calendar, CalendarCell, CalendarGrid, CalendarStateContext, DateInput, DateSegment, Dialog, Group,
  I18nProvider, Popover, RangeCalendar, RangeCalendarStateContext,
  DatePicker as AriaDatePicker, DateRangePicker as AriaDateRangePicker,
} from 'react-aria-components'
import { parseDate } from '@internationalized/date'
import type { CalendarDate } from '@internationalized/date'

// The pickers are built on React Aria's, the unstyled base of React Spectrum's.
// Dates come and go as ISO "YYYY-MM-DD" strings, like DateMode's.

// en-NZ whatever the browser's language: dd/mm/yyyy, weeks starting on Monday
const LOCALE = 'en-NZ'

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Date(Date.UTC(2000, i, 1)).toLocaleDateString(LOCALE, { timeZone: 'UTC', month: 'short' }))

interface CommonProps {
  min: string
  max: string
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  isInvalid?: boolean
  ariaLabel: string
}

interface DateRangePickerProps extends CommonProps {
  // A single day is a range that starts and ends on it
  value: { start: string; end: string } | null
  // Null while a date is part typed or cleared
  onChange: (range: { start: string; end: string } | null) => void
  // The most days a range may span, counting both ends
  maxDays: number
}

// Typed start and end dates, with a calendar to pick the range from
export function DateRangePicker({ value, onChange, min, max, maxDays, isOpen, onOpenChange, isInvalid, ariaLabel }: DateRangePickerProps) {
  const range = useMemo(
    () => value && { start: parseDate(value.start), end: parseDate(value.end) },
    [value?.start, value?.end],
  )
  const [minValue, maxValue] = useBounds(min, max)

  return (
    <I18nProvider locale={LOCALE}>
      <AriaDateRangePicker
        value={range}
        onChange={r => onChange(r && { start: r.start.toString(), end: r.end.toString() })}
        minValue={minValue}
        maxValue={maxValue}
        // Once the first day is picked, rule out days that would make the range too long
        isDateUnavailable={(date, anchor) => anchor != null && Math.abs(date.compare(anchor)) >= maxDays}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        isInvalid={isInvalid}
        validationBehavior="aria"
        shouldForceLeadingZeros
        aria-label={ariaLabel}
      >
        <Group className="date-field">
          <DateInput slot="start" className="date-field-input">{s => <DateSegment segment={s} className="date-segment" />}</DateInput>
          <span aria-hidden="true" className="date-field-dash">–</span>
          <DateInput slot="end" className="date-field-input">{s => <DateSegment segment={s} className="date-segment" />}</DateInput>
          <CalendarButton />
        </Group>
        <CalendarPopover>
          <RangeCalendar className="calendar calendar--range">
            <CalendarHeader />
            <CalendarDays />
          </RangeCalendar>
        </CalendarPopover>
      </AriaDateRangePicker>
    </I18nProvider>
  )
}

interface DatePickerProps extends CommonProps {
  value: string
  // Null while the date is part typed or cleared
  onChange: (date: string | null) => void
}

// A typed date, with a calendar to pick it from
export function DatePicker({ value, onChange, min, max, isOpen, onOpenChange, isInvalid, ariaLabel }: DatePickerProps) {
  const date = useMemo(() => value ? parseDate(value) : null, [value])
  const [minValue, maxValue] = useBounds(min, max)

  return (
    <I18nProvider locale={LOCALE}>
      <AriaDatePicker
        value={date}
        onChange={d => onChange(d && d.toString())}
        minValue={minValue}
        maxValue={maxValue}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        isInvalid={isInvalid}
        validationBehavior="aria"
        shouldForceLeadingZeros
        aria-label={ariaLabel}
      >
        <Group className="date-field">
          <DateInput className="date-field-input">{s => <DateSegment segment={s} className="date-segment" />}</DateInput>
          <CalendarButton />
        </Group>
        <CalendarPopover>
          <Calendar className="calendar">
            <CalendarHeader />
            <CalendarDays />
          </Calendar>
        </CalendarPopover>
      </AriaDatePicker>
    </I18nProvider>
  )
}

function useBounds(min: string, max: string): [CalendarDate, CalendarDate] {
  return useMemo(() => [parseDate(min), parseDate(max)], [min, max])
}

function CalendarButton() {
  return (
    <Button className="date-field-button">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="2" y="3" width="12" height="11" rx="1.5" />
        <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
      </svg>
    </Button>
  )
}

function CalendarPopover({ children }: { children: ReactNode }) {
  return (
    <Popover placement="bottom start" offset={4} className="calendar-popover">
      <Dialog className="calendar-dialog">{children}</Dialog>
    </Popover>
  )
}

// Month and year dropdowns between the arrows: the data goes back years, which
// is a lot of clicking a month at a time
function CalendarHeader() {
  const singleState = useContext(CalendarStateContext)
  const rangeState = useContext(RangeCalendarStateContext)
  const state = singleState ?? rangeState
  if (!state) return null
  const { focusedDate, minValue, maxValue } = state
  const years: number[] = []
  for (let y = maxValue?.year ?? focusedDate.year; y >= (minValue?.year ?? focusedDate.year); y--) years.push(y)
  // Months outside the bounds in the first and last years
  const monthOutOfBounds = (month: number) =>
    (minValue != null && focusedDate.year === minValue.year && month < minValue.month)
    || (maxValue != null && focusedDate.year === maxValue.year && month > maxValue.month)

  return (
    <header className="calendar-header">
      <Button slot="previous" className="calendar-nav">‹</Button>
      <select
        aria-label="Month"
        value={focusedDate.month}
        onChange={e => state.setFocusedDate(focusedDate.set({ month: Number(e.target.value) }))}
        className="toggle-select"
      >
        {MONTHS.map((name, i) => (
          <option key={name} value={i + 1} disabled={monthOutOfBounds(i + 1)}>{name}</option>
        ))}
      </select>
      <select
        aria-label="Year"
        value={focusedDate.year}
        onChange={e => state.setFocusedDate(focusedDate.set({ year: Number(e.target.value) }))}
        className="toggle-select"
      >
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
      <Button slot="next" className="calendar-nav">›</Button>
    </header>
  )
}

function CalendarDays() {
  return (
    <CalendarGrid className="calendar-grid" weekdayStyle="narrow">
      {date => <CalendarCell date={date} className="calendar-cell" />}
    </CalendarGrid>
  )
}
