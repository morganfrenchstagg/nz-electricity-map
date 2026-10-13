import { useEffect, useState, useMemo, useRef } from 'react'
import { underConstruction } from '../../../frontend/old/utilities/underConstruction'
import { fuelColour } from '../utils/colours'

const STATUS_COLOURS: Record<string, { bg: string; text: string }> = {
  'Commissioning': { bg: '#dcfce7', text: '#15803d' },
  'Pre-Commissioning': { bg: '#d1fae5', text: '#059669' },
  'Under Construction': { bg: '#ffedd5', text: '#c2410c' },
  'Early Works': { bg: '#f3f4f6', text: '#374151' },
  'Committed': { bg: '#dbeafe', text: '#1d4ed8' },
}

const STATUS_ORDER = ['Commissioning', 'Pre-Commissioning', 'Under Construction', 'Early Works', 'Committed']

const ALL_FUELS = [...new Set(underConstruction.map(n => n.fuel))].sort()
const ALL_OPERATORS = [...new Set(underConstruction.map(n => n.operator))].sort()
const ALL_YEARS = [...new Set(
  underConstruction.map(n => n.openBy?.slice(0, 4)).filter((y): y is string => !!y)
)].sort()

type NodeWithExtras = typeof underConstruction[number] & { costMillionDollars?: number; link?: string }

type SortCol = 'name' | 'fuel' | 'operator' | 'status' | 'capacity' | 'generation' | 'cost' | 'openBy'
type SortDir = 'asc' | 'desc'

const base = underConstruction as NodeWithExtras[]

function sortRows(rows: NodeWithExtras[], col: SortCol, dir: SortDir): NodeWithExtras[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    let cmp = 0
    if (col === 'name') cmp = a.name.localeCompare(b.name)
    else if (col === 'fuel') cmp = a.fuel.localeCompare(b.fuel)
    else if (col === 'operator') cmp = a.operator.localeCompare(b.operator)
    else if (col === 'status') cmp = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
    else if (col === 'capacity') cmp = (a.capacityMW ?? a.capacityMWp ?? 0) - (b.capacityMW ?? b.capacityMWp ?? 0)
    else if (col === 'generation') cmp = (a.yearlyGenerationGWh ?? 0) - (b.yearlyGenerationGWh ?? 0)
    else if (col === 'cost') cmp = (a.costMillionDollars ?? 0) - (b.costMillionDollars ?? 0)
    else if (col === 'openBy') {
      if (a.openBy && b.openBy) cmp = a.openBy.localeCompare(b.openBy)
      else if (a.openBy) cmp = -1
      else if (b.openBy) cmp = 1
    }
    return cmp * sign
  })
}

function formatOpenBy(s: string) {
  const [y, m] = s.split('-')
  const month = new Date(`${y}-${m}-01`).toLocaleString('en-NZ', { month: 'short' })
  return `${month} ${y}`
}

interface Props {
  onClose: () => void
}

export default function PipelineModal({ onClose }: Props) {
  const [fuels, setFuels] = useState<Set<string>>(new Set())
  const [years, setYears] = useState<Set<string>>(new Set())
  const [operators, setOperators] = useState<Set<string>>(new Set())
  const [statuses, setStatuses] = useState<Set<string>>(new Set())
  const [sortCol, setSortCol] = useState<SortCol>('openBy')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  function handleSort(col: SortCol) {
    if (col === sortCol) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const filtered = useMemo(() => {
    const rows = base.filter(n =>
      (fuels.size === 0 || fuels.has(n.fuel)) &&
      (years.size === 0 || (n.openBy ? years.has(n.openBy.slice(0, 4)) : false)) &&
      (operators.size === 0 || operators.has(n.operator)) &&
      (statuses.size === 0 || statuses.has(n.status))
    )
    return sortRows(rows, sortCol, sortDir)
  }, [fuels, years, operators, statuses, sortCol, sortDir])

  const hasFilters = fuels.size > 0 || years.size > 0 || operators.size > 0 || statuses.size > 0

  function toggle<T>(set: Set<T>, val: T): Set<T> {
    const next = new Set(set)
    next.has(val) ? next.delete(val) : next.add(val)
    return next
  }

  return (
    <div onClick={onClose} className="modal-backdrop" style={{ padding: 'var(--space-xl) var(--space-2xl)' }}>
      <div onClick={e => e.stopPropagation()} className="modal" style={{ width: '100%', maxWidth: 1200, maxHeight: '90vh' }}>
        {/* Header */}
        <div className="section section--header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div className="title">Generation Pipeline</div>
          </div>
          <button onClick={onClose} className="button-secondary">
            Close
          </button>
        </div>

        {/* Filter bar */}
        <div className="section" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <FilterDropdown label="Fuel" options={ALL_FUELS} active={fuels} onToggle={v => setFuels(toggle(fuels, v))} onClear={() => setFuels(new Set())} colour={fuelColour} />
          <FilterDropdown label="Status" options={STATUS_ORDER} active={statuses} onToggle={v => setStatuses(toggle(statuses, v))} onClear={() => setStatuses(new Set())} statusColours={STATUS_COLOURS} />
          <FilterDropdown label="Year" options={ALL_YEARS} active={years} onToggle={v => setYears(toggle(years, v))} onClear={() => setYears(new Set())} />
          <FilterDropdown label="Operator" options={ALL_OPERATORS} active={operators} onToggle={v => setOperators(toggle(operators, v))} onClear={() => setOperators(new Set())} />
          {hasFilters && (
            <button
              onClick={() => { setFuels(new Set()); setYears(new Set()); setOperators(new Set()); setStatuses(new Set()) }}
              style={{ background: 'none', border: 'none', color: 'var(--color-accent)', fontSize: 'var(--font-size-sm)', cursor: 'pointer', padding: 'var(--space-2xs) var(--space-xs)', fontWeight: 500, whiteSpace: 'nowrap' }}
            >
              Clear all
            </button>
          )}
        </div>

        {/* Table */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-surface-subtle)', borderBottom: '1px solid var(--color-divider)', position: 'sticky', top: 0, zIndex: 1 }}>
                <SortTh col="name" label="Project" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh col="fuel" label="Fuel" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh col="operator" label="Operator" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh col="status" label="Status" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh col="capacity" label="Capacity" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                <SortTh col="generation" label="Annual gen" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                <SortTh col="cost" label="Cost" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                <SortTh col="openBy" label="Open by" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                <th className="eyebrow" style={th()}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="empty-state">No projects match the selected filters</td>
                </tr>
              )}
              {filtered.map((n, i) => {
                const statusColour = STATUS_COLOURS[n.status] ?? { bg: '#f3f4f6', text: '#374151' }
                const capacityStr = n.capacityMW != null
                  ? `${n.capacityMW} MW${n.capacityMWh ? ` / ${n.capacityMWh} MWh` : ''}`
                  : n.capacityMWp != null
                    ? `${n.capacityMWp} MWp`
                    : '—'
                return (
                  <tr key={i} className="data-row">
                    <td style={{ ...td(), fontWeight: 500 }}>
                      {n.name}
                      {n.locationDescription && (
                        <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: 5, fontSize: 'var(--font-size-sm)' }}>{n.locationDescription}</span>
                      )}
                    </td>
                    <td style={td()}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: fuelColour(n.fuel), flexShrink: 0, display: 'inline-block' }} />
                        {n.fuel}
                      </span>
                    </td>
                    <td style={{ ...td(), color: 'var(--color-text-secondary)' }}>{n.operator}</td>
                    <td style={td()}>
                      <span style={{ fontSize: 'var(--font-size-xs)', padding: 'var(--space-2xs) var(--space-md)', borderRadius: 10, background: statusColour.bg, color: statusColour.text, fontWeight: 500, whiteSpace: 'nowrap' }}>
                        {n.status}
                      </span>
                    </td>
                    <td style={{ ...td(), textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{capacityStr}</td>
                    <td style={{ ...td(), textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-secondary)' }}>
                      {n.yearlyGenerationGWh != null ? `${n.yearlyGenerationGWh} GWh` : '—'}
                    </td>
                    <td style={{ ...td(), textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-secondary)' }}>
                      {n.costMillionDollars != null ? `$${n.costMillionDollars}M` : '—'}
                    </td>
                    <td style={{ ...td(), textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {n.openBy ? formatOpenBy(n.openBy) : '—'}
                    </td>
                    <td style={{ ...td(), paddingLeft: 'var(--space-xs)' }}>
                      {n.link ? (
                        <a
                          href={n.link}
                          target="_blank"
                          rel="noreferrer"
                          onClick={e => e.stopPropagation()}
                          style={{ color: 'var(--color-accent)', fontSize: 'var(--font-size-sm)', textDecoration: 'none', opacity: 0.7 }}
                          title="Source"
                        >
                          ↗
                        </a>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function SortTh({ col, label, sortCol, sortDir, onSort, align = 'left' }: {
  col: SortCol; label: string; sortCol: SortCol; sortDir: SortDir
  onSort: (col: SortCol) => void; align?: 'left' | 'right'
}) {
  const active = sortCol === col
  return (
    <th
      onClick={() => onSort(col)}
      className="eyebrow"
      style={{ ...th(), textAlign: align, cursor: 'pointer', userSelect: 'none', color: active ? 'var(--color-text-strong)' : 'var(--color-text-secondary)' }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexDirection: align === 'right' ? 'row-reverse' : 'row' }}>
        {label}
        <span style={{ fontSize: 'var(--font-size-2xs)', opacity: active ? 1 : 0.3 }}>
          {active ? (sortDir === 'asc' ? '▲' : '▼') : '▲'}
        </span>
      </span>
    </th>
  )
}

interface FilterDropdownProps {
  label: string
  options: string[]
  active: Set<string>
  onToggle: (v: string) => void
  onClear: () => void
  colour?: (v: string) => string
  statusColours?: Record<string, { bg: string; text: string }>
}

function FilterDropdown({ label, options, active, onToggle, onClear, colour, statusColours }: FilterDropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const isActive = active.size > 0
  const summary = active.size === 0 ? label
    : active.size === 1 ? [...active][0]
      : `${label}: ${active.size}`

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className={isActive ? 'filter-button is-active' : 'filter-button'}
      >
        {summary}
        {isActive && (
          <span
            onClick={e => { e.stopPropagation(); onClear() }}
            style={{ opacity: 0.5, lineHeight: 1, fontSize: 'var(--font-size-xs)' }}
          >✕</span>
        )}
        <span style={{ opacity: 0.4, fontSize: 'var(--font-size-xs)' }}>▾</span>
      </button>
      {open && (
        <div className="popover" style={{ top: 'calc(100% + 4px)', left: 0, zIndex: 50, minWidth: 180, maxHeight: 260, overflowY: 'auto' }}>
          {options.map(opt => {
            const checked = active.has(opt)
            const sc = statusColours?.[opt]
            const dot = colour ? colour(opt) : undefined
            return (
              <div key={opt} onClick={() => onToggle(opt)} className={checked ? 'menu-item is-selected' : 'menu-item'}>
                {dot && !sc && <span style={{ width: 10, height: 10, borderRadius: '50%', background: dot, flexShrink: 0 }} />}
                {sc && <span style={{ width: 10, height: 10, borderRadius: 3, background: sc.bg, border: `1px solid ${sc.text}`, flexShrink: 0 }} />}
                <span style={{ flex: 1, fontWeight: checked ? 600 : 400, color: checked ? 'var(--color-accent-strong)' : 'var(--color-text)' }}>{opt}</span>
                {checked && <span style={{ color: 'var(--color-accent)', fontSize: 'var(--font-size-xs)' }}>✓</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function th(): React.CSSProperties {
  return { textAlign: 'left', whiteSpace: 'nowrap' }
}

function td(): React.CSSProperties {
  return { verticalAlign: 'middle' }
}
