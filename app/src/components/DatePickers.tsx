import { useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button, Calendar, CalendarCell, CalendarGrid, CalendarStateContext, DateField, DateInput, DateSegment, Dialog,
  DialogTrigger, Group, I18nProvider, Label, Popover, RangeCalendar, RangeCalendarStateContext,
  DatePicker as AriaDatePicker,
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
}

type Range = { start: string; end: string }

interface DateRangePickerProps extends CommonProps {
  // A single day is a range that starts and ends on it
  value: Range | null
  onChange: (range: Range) => void
  // The most days a range may span, counting both ends
  maxDays: number
  // Why value can't be charted, if it can't
  error: string | null
  // Shown pressed, as a picked range is in place of the period buttons
  isActive: boolean
}

// The From and To fields' dates, either of which can be part typed or cleared
interface Draft {
  start: CalendarDate | null
  end: CalendarDate | null
}

function toDraft(value: Range | null): Draft {
  return value ? { start: parseDate(value.start), end: parseDate(value.end) } : { start: null, end: null }
}

// e.g. "21 Oct 2026 – 24 Oct 2026", read in UTC so it isn't the day before west of UTC
function rangeLabel({ start, end }: Range) {
  const format = (iso: string) => new Date(`${iso}T00:00:00Z`)
    .toLocaleDateString(LOCALE, { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })
  return start === end ? format(start) : `${format(start)} – ${format(end)}`
}

// A calendar button, for the end of PeriodToggle, that opens typed From and To
// dates over a calendar to pick the range from
export function DateRangePicker({ value, onChange, min, max, maxDays, error, isActive, isOpen, onOpenChange }: DateRangePickerProps) {
  const [minValue, maxValue] = useBounds(min, max)
  const [draft, setDraft] = useState(() => toDraft(value))
  // The calendar's month, which follows the dates as they're typed
  const [focusedDate, setFocusedDate] = useState(() => draft.start ?? maxValue)

  // Follow value when it changes from outside, e.g. a period button clearing
  // it. Done while rendering, like useDateRangePicker's syncing from dateMode.
  const valueKey = value ? `${value.start}/${value.end}` : ''
  const [syncedKey, setSyncedKey] = useState(valueKey)
  if (valueKey !== syncedKey) {
    const next = toDraft(value)
    setSyncedKey(valueKey)
    setDraft(next)
    setFocusedDate(next.start ?? maxValue)
  }

  // Charts the dates once From is whole, as a single day while To is empty.
  // The fields already show the new value, so it isn't synced back into them,
  // which would fill an emptied To with From's date.
  const commit = (start: CalendarDate | null, end: CalendarDate | null) => {
    setDraft({ start, end })
    if (!start) return
    const range = { start: start.toString(), end: (end ?? start).toString() }
    setSyncedKey(`${range.start}/${range.end}`)
    onChange(range)
  }

  // The range, or just its start while To is empty or before it
  const calendarRange = draft.start && {
    start: draft.start,
    end: draft.end && draft.end.compare(draft.start) >= 0 ? draft.end : draft.start,
  }

  return (
    <I18nProvider locale={LOCALE}>
      <DialogTrigger isOpen={isOpen} onOpenChange={onOpenChange}>
        <Button aria-label={value ? rangeLabel(value) : 'Custom dates'} className={isActive ? 'calendar-button is-active' : 'calendar-button'}>
          <CalendarIcon />
        </Button>
        <CalendarPopover>
          <div className="date-range-fields">
            <DateRangeField
              label="From"
              value={draft.start}
              onChange={d => { commit(d, draft.end); if (d) setFocusedDate(d) }}
              minValue={minValue}
              maxValue={maxValue}
              isInvalid={error != null}
            />
            <DateRangeField
              label="To"
              value={draft.end}
              onChange={d => { commit(draft.start, d); if (d) setFocusedDate(d) }}
              minValue={minValue}
              maxValue={maxValue}
              isInvalid={error != null}
            />
            {error && <span className="status-text is-error">{error}</span>}
          </div>
          <RangeCalendar
            value={calendarRange}
            onChange={r => { commit(r.start, r.end); onOpenChange(false) }}
            minValue={minValue}
            maxValue={maxValue}
            // Once the first day is picked, rule out days that would make the range too long
            isDateUnavailable={(date, anchor) => anchor != null && Math.abs(date.compare(anchor)) >= maxDays}
            focusedValue={focusedDate}
            onFocusChange={setFocusedDate}
            className="calendar calendar--range"
          >
            <CalendarHeader />
            <CalendarDays />
          </RangeCalendar>
        </CalendarPopover>
      </DialogTrigger>
    </I18nProvider>
  )
}

interface DateRangeFieldProps {
  label: string
  value: CalendarDate | null
  // Null while the date is part typed or cleared
  onChange: (date: CalendarDate | null) => void
  minValue: CalendarDate
  maxValue: CalendarDate
  isInvalid: boolean
}

// DateRangePicker's From or To date
function DateRangeField({ label, ...props }: DateRangeFieldProps) {
  return (
    <DateField {...props} validationBehavior="aria" shouldForceLeadingZeros className="date-range-field">
      <Label className="eyebrow">{label}</Label>
      <DateInput className="date-field date-field-input">{s => <DateSegment segment={s} className="date-segment" />}</DateInput>
    </DateField>
  )
}

interface DatePickerProps extends CommonProps {
  isInvalid?: boolean
  ariaLabel: string
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

function CalendarIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
    </svg>
  )
}

// DatePicker's, inside its field
function CalendarButton() {
  return (
    <Button className="date-field-button">
      <CalendarIcon />
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
