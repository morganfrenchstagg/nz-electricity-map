import type { DateMode } from '../hooks/useDispatchData'

interface ToggleOption {
  key: string
  label: string
  title?: string
  active: boolean
  onClick: () => void
}

// Segmented button group, e.g. Generation / Offers.
export function ToggleGroup({ options }: { options: ToggleOption[] }) {
  return (
    <div style={{ display: 'flex', borderRadius: 6, border: '1px solid #ddd', overflow: 'hidden', flexShrink: 0 }}>
      {options.map((o, i) => (
        <button
          key={o.key}
          onClick={o.onClick}
          title={o.title}
          aria-pressed={o.active}
          style={{
            padding: '3px 9px', border: 'none', cursor: 'pointer', fontSize: 12, lineHeight: 1,
            background: o.active ? '#1d4ed8' : 'white',
            color: o.active ? 'white' : '#555',
            fontWeight: o.active ? 600 : 400,
            borderRight: i < options.length - 1 ? '1px solid #ddd' : 'none',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export type Period = 'today' | 'recent' | 'last30' | 'lastYear' | 'all'

const PERIODS: { kind: Period; label: string; title?: string }[] = [
  { kind: 'today', label: 'Today' },
  { kind: 'recent', label: '3d', title: 'Last 3 days' },
  { kind: 'last30', label: '30d', title: 'Last 30 days' },
  { kind: 'lastYear', label: '1y', title: 'Last 52 weeks' },
  { kind: 'all', label: 'All', title: 'Every month since October 2020' },
]

// The Today | 3d | 30d | 1y | All toggle shared by NodePanel and GridOverviewPanel.
export function PeriodToggle({ dateMode, onSelect }: { dateMode: DateMode; onSelect: (period: Period) => void }) {
  return (
    <ToggleGroup options={PERIODS.map(p => ({
      key: p.kind,
      label: p.label,
      title: p.title,
      active: dateMode.kind === p.kind,
      onClick: () => onSelect(p.kind),
    }))} />
  )
}
