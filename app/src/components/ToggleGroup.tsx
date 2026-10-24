import type { ReactNode } from 'react'
import type { AggregateMode, AllAggregation, DateMode, FiveYearAggregation } from '../hooks/useDispatchData'

interface ToggleOption {
  key: string
  label: string
  // Label in the compact dropdown, where the neighbouring options aren't there to give it context
  menuLabel?: string
  title?: string
  active: boolean
  onClick: () => void
}

interface ToggleGroupProps {
  options: ToggleOption[]
  // Render as a dropdown, for toolbars too narrow for the buttons
  compact?: boolean
  ariaLabel?: string
  // A last button of the caller's own, e.g. PeriodToggle's calendar. The dropdown leaves it out.
  trail?: ReactNode
}

// Segmented button group, e.g. Generation / Offers.
export function ToggleGroup({ options, compact = false, ariaLabel, trail }: ToggleGroupProps) {
  // A single button stays a button: a one-option dropdown has nothing to choose from
  if (compact && options.length > 1) {
    const active = options.find(o => o.active)
    return (
      <select
        value={active?.key ?? ''}
        onChange={e => options.find(o => o.key === e.target.value)?.onClick()}
        aria-label={ariaLabel}
        className="toggle-select"
      >
        {options.map(o => (
          <option key={o.key} value={o.key} title={o.title}>{o.menuLabel ?? o.label}</option>
        ))}
      </select>
    )
  }

  return (
    <div role="group" aria-label={ariaLabel} className="toggle-group">
      {options.map(o => (
        <button key={o.key} onClick={o.onClick} title={o.title} aria-pressed={o.active}>
          {o.label}
        </button>
      ))}
      {trail}
    </div>
  )
}

export type Period = 'today' | 'recent' | 'last90' | 'lastYear' | '5y' | 'all'

const PERIODS: { kind: Period; label: string; menuLabel?: string; title?: string }[] = [
  { kind: 'today', label: 'Today' },
  { kind: 'recent', label: '3d', menuLabel: '3 days', title: 'Last 3 days' },
  { kind: 'last90', label: '90d', menuLabel: '90 days', title: 'Last 13 weeks' },
  { kind: 'lastYear', label: '1y', menuLabel: '1 year', title: 'Last 52 weeks' },
  { kind: '5y', label: '5y', menuLabel: '5 years', title: 'Last 60 months' },
  { kind: 'all', label: 'All', menuLabel: 'All time', title: 'Everything since 2009' },
]

interface PeriodToggleProps {
  dateMode: DateMode
  onSelect: (period: Period) => void
  compact?: boolean
  // A date or range is picked, or being picked, with the date range picker
  customDates: boolean
  // The compact toolbar hides the calendar button, so its dropdown has an option to show it
  onCustom: () => void
  // DateRangePicker's button, after All
  calendar: ReactNode
  // Leaves out All, for nodes with no data from most of its years
  hideAll?: boolean
}

// The Today | 3d | 90d | 1y | 5y | All toggle shared by the node panels and GridOverviewPanel.
export function PeriodToggle({ dateMode, onSelect, compact = false, customDates, onCustom, calendar, hideAll = false }: PeriodToggleProps) {
  const options: ToggleOption[] = PERIODS.filter(p => !(hideAll && p.kind === 'all')).map(p => ({
    key: p.kind,
    label: p.label,
    menuLabel: p.menuLabel,
    title: p.title,
    active: !customDates && dateMode.kind === p.kind,
    onClick: () => onSelect(p.kind),
  }))
  if (compact) options.push({ key: 'custom', label: 'Custom dates', active: customDates, onClick: onCustom })
  return <ToggleGroup compact={compact} ariaLabel="Period" options={options} trail={calendar} />
}

interface Aggregation<A extends string> {
  kind: A
  label: string
  title: string
}

const WEEKLY: Aggregation<'weekly'> = { kind: 'weekly', label: 'Weekly', title: 'Every Monday-to-Sunday week' }

// Each view's choice of totals, finest first. Each view starts on its default
// (see periodMode).
const DAILY_WEEKLY: Aggregation<'daily' | 'weekly'>[] = [
  { kind: 'daily', label: 'Daily', title: 'Every day' },
  WEEKLY,
]

const FIVE_YEAR_AGGREGATIONS: Aggregation<FiveYearAggregation>[] = [
  WEEKLY,
  { kind: 'monthly', label: 'Monthly', title: 'Every month' },
]

const ALL_AGGREGATIONS: Aggregation<AllAggregation>[] = [
  { kind: 'monthly', label: 'Monthly', title: 'Every month since 2009' },
  { kind: 'quarterly', label: 'Quarterly', title: 'Every complete calendar quarter since 2009' },
  { kind: 'annual', label: 'Yearly', title: 'Every complete year since 2009' },
]

// A view's choice of totals as toggle options
function aggregationOptions<A extends string>(aggregations: Aggregation<A>[], aggregation: A, onSelect: (aggregation: A) => void): ToggleOption[] {
  return aggregations.map(a => ({
    key: a.kind,
    label: a.label,
    title: a.title,
    active: aggregation === a.kind,
    onClick: () => onSelect(a.kind),
  }))
}

function viewAggregationOptions(dateMode: AggregateMode, onSelect: (dateMode: AggregateMode) => void): ToggleOption[] {
  switch (dateMode.kind) {
    case 'last90': return aggregationOptions(DAILY_WEEKLY, dateMode.aggregation, aggregation => onSelect({ kind: 'last90', aggregation }))
    case 'lastYear': return aggregationOptions(DAILY_WEEKLY, dateMode.aggregation, aggregation => onSelect({ kind: 'lastYear', aggregation }))
    case '5y': return aggregationOptions(FIVE_YEAR_AGGREGATIONS, dateMode.aggregation, aggregation => onSelect({ kind: '5y', aggregation }))
    case 'all': return aggregationOptions(ALL_AGGREGATIONS, dateMode.aggregation, aggregation => onSelect({ kind: 'all', aggregation }))
  }
}

interface AggregationToggleProps {
  dateMode: AggregateMode
  onSelect: (dateMode: AggregateMode) => void
  compact?: boolean
}

// The toggle beside PeriodToggle for the totals of the view picked: 90d's and
// 1y's Daily | Weekly, 5y's Weekly | Monthly or All's Monthly | Quarterly | Yearly
export function AggregationToggle({ dateMode, onSelect, compact = false }: AggregationToggleProps) {
  return <ToggleGroup compact={compact} ariaLabel="Totals" options={viewAggregationOptions(dateMode, onSelect)} />
}
