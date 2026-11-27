// Shared by DatePickers and LazyDatePickers' stand-ins, kept apart so the stand-ins don't load DatePickers

// en-NZ whatever the browser's language: dd/mm/yyyy, weeks starting on Monday
export const LOCALE = 'en-NZ'

export type Range = { start: string; end: string }

// e.g. "21 Oct 2026 – 24 Oct 2026", read in UTC so it isn't the day before west of UTC
export function rangeLabel({ start, end }: Range) {
  const format = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(LOCALE, {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  return start === end ? format(start) : `${format(start)} – ${format(end)}`
}
