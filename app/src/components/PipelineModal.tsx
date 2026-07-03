import { useEffect, useState, useMemo, useRef } from 'react'
import { underConstruction } from '../../../frontend/utilities/underConstruction'
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
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px 24px' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'white', borderRadius: 10, boxShadow: '0 8px 40px rgba(0,0,0,0.25)', width: '100%', maxWidth: 1200, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Generation Pipeline</div>
          </div>
          <button
            onClick={onClose}
            style={{ background: '#e7e7e7', border: 'none', borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 13, color: '#555', flexShrink: 0 }}
          >
            Close
          </button>
        </div>

        {/* Filter bar */}
        <div style={{ padding: '10px 20px', borderBottom: '1px solid #eee', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <FilterDropdown label="Fuel" options={ALL_FUELS} active={fuels} onToggle={v => setFuels(toggle(fuels, v))} onClear={() => setFuels(new Set())} colour={fuelColour} />
          <FilterDropdown label="Status" options={STATUS_ORDER} active={statuses} onToggle={v => setStatuses(toggle(statuses, v))} onClear={() => setStatuses(new Set())} statusColours={STATUS_COLOURS} />
          <FilterDropdown label="Year" options={ALL_YEARS} active={years} onToggle={v => setYears(toggle(years, v))} onClear={() => setYears(new Set())} />
          <FilterDropdown label="Operator" options={ALL_OPERATORS} active={operators} onToggle={v => setOperators(toggle(operators, v))} onClear={() => setOperators(new Set())} />
          {hasFilters && (
            <button
              onClick={() => { setFuels(new Set()); setYears(new Set()); setOperators(new Set()); setStatuses(new Set()) }}
              style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: 12, cursor: 'pointer', padding: '2px 4px', fontWeight: 500, whiteSpace: 'nowrap' }}
            >
              Clear all
            </button>
          )}
        </div>

        {/* Table */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9f9f9', borderBottom: '1px solid #e5e5e5', position: 'sticky', top: 0, zIndex: 1 }}>
                <SortTh col="name" label="Project" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh col="fuel" label="Fuel" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh col="operator" label="Operator" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh col="status" label="Status" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh col="capacity" label="Capacity" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                <SortTh col="generation" label="Annual gen" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                <SortTh col="cost" label="Cost" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                <SortTh col="openBy" label="Open by" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                <th style={th()}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ padding: 32, textAlign: 'center', color: '#999' }}>No projects match the selected filters</td>
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
                  <tr
                    key={i}
                    style={{ borderBottom: '1px solid #f0f0f0' }}
                    onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.background = '#fafafa'}
                    onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.background = ''}
                  >
                    <td style={{ ...td(), fontWeight: 500 }}>
                      {n.name}
                      {n.locationDescription && (
                        <span style={{ fontWeight: 400, color: '#888', marginLeft: 5, fontSize: 12 }}>{n.locationDescription}</span>
                      )}
                    </td>
                    <td style={td()}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: fuelColour(n.fuel), flexShrink: 0, display: 'inline-block' }} />
                        {n.fuel}
                      </span>
                    </td>
                    <td style={{ ...td(), color: '#555' }}>{n.operator}</td>
                    <td style={td()}>
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: statusColour.bg, color: statusColour.text, fontWeight: 500, whiteSpace: 'nowrap' }}>
                        {n.status}
                      </span>
                    </td>
                    <td style={{ ...td(), textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{capacityStr}</td>
                    <td style={{ ...td(), textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#555' }}>
                      {n.yearlyGenerationGWh != null ? `${n.yearlyGenerationGWh} GWh` : '—'}
                    </td>
                    <td style={{ ...td(), textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#555' }}>
                      {n.costMillionDollars != null ? `$${n.costMillionDollars}M` : '—'}
                    </td>
                    <td style={{ ...td(), textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {n.openBy ? formatOpenBy(n.openBy) : '—'}
                    </td>
                    <td style={{ ...td(), paddingLeft: 4 }}>
                      {n.link ? (
                        <a
                          href={n.link}
                          target="_blank"
                          rel="noreferrer"
                          onClick={e => e.stopPropagation()}
                          style={{ color: '#3b82f6', fontSize: 12, textDecoration: 'none', opacity: 0.7 }}
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
      style={{ ...th(), textAlign: align, cursor: 'pointer', userSelect: 'none', color: active ? '#111' : '#666' }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexDirection: align === 'right' ? 'row-reverse' : 'row' }}>
        {label}
        <span style={{ fontSize: 10, opacity: active ? 1 : 0.3 }}>
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
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '5px 10px', borderRadius: 6,
          border: `1px solid ${isActive ? '#93c5fd' : '#ddd'}`,
          background: isActive ? '#eff6ff' : 'white',
          color: isActive ? '#1d4ed8' : '#444',
          fontSize: 13, fontWeight: isActive ? 600 : 400,
          cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        {summary}
        {isActive && (
          <span
            onClick={e => { e.stopPropagation(); onClear() }}
            style={{ opacity: 0.5, lineHeight: 1, fontSize: 11 }}
          >✕</span>
        )}
        <span style={{ opacity: 0.4, fontSize: 11 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50,
          background: 'white', border: '1px solid #ddd', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)', padding: '6px 0',
          minWidth: 180, maxHeight: 260, overflowY: 'auto',
        }}>
          {options.map(opt => {
            const checked = active.has(opt)
            const sc = statusColours?.[opt]
            const dot = colour ? colour(opt) : undefined
            return (
              <div
                key={opt}
                onClick={() => onToggle(opt)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 14px', cursor: 'pointer', fontSize: 13,
                  background: checked ? '#eff6ff' : 'transparent',
                }}
                onMouseEnter={e => { if (!checked) (e.currentTarget as HTMLDivElement).style.background = '#f5f5f5' }}
                onMouseLeave={e => { if (!checked) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
              >
                {dot && !sc && <span style={{ width: 10, height: 10, borderRadius: '50%', background: dot, flexShrink: 0 }} />}
                {sc && <span style={{ width: 10, height: 10, borderRadius: 3, background: sc.bg, border: `1px solid ${sc.text}`, flexShrink: 0 }} />}
                <span style={{ flex: 1, fontWeight: checked ? 600 : 400, color: checked ? '#1d4ed8' : '#333' }}>{opt}</span>
                {checked && <span style={{ color: '#3b82f6', fontSize: 11 }}>✓</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function th(): React.CSSProperties {
  return { padding: '8px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }
}

function td(): React.CSSProperties {
  return { padding: '9px 14px', verticalAlign: 'middle' }
}
