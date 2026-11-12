// What DatePickers and the stand-ins LazyDatePickers shows until it loads have
// in common, kept apart so the stand-ins don't bring DatePickers with them

// en-NZ whatever the browser's language: dd/mm/yyyy, weeks starting on Monday
export const LOCALE = 'en-NZ'

export type Range = { start: string; end: string }

// e.g. "21 Oct 2026 – 24 Oct 2026", read in UTC so it isn't the day before west of UTC
export function rangeLabel({ start, end }: Range) {
  const format = (iso: string) => new Date(`${iso}T00:00:00Z`)
    .toLocaleDateString(LOCALE, { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })
  return start === end ? format(start) : `${format(start)} – ${format(end)}`
}

export function CalendarIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
    </svg>
  )
}
