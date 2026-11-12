import { useState, useEffect, useRef, useMemo } from 'react'
import type { Generator, Substation, SelectedNode } from '../types'
import { fuelColour, fuelFamilies, fuelFamily } from '../utils/colours'
import { isRetired } from '../utils/generators'
import { substationsOf } from '../utils/substations'
import FilterDropdown from './FilterDropdown'

interface Props {
  generators: Generator[]
  substations: Substation[]
  currentNode?: NonNullable<SelectedNode>
  onSelect: (node: NonNullable<SelectedNode>) => void
  onClose: () => void
}

type Tab = 'generation' | 'substation'

const GRID_ZONE_NAMES: Record<number, string> = {
  1: 'Northland',
  2: 'Auckland',
  3: 'Hamilton',
  4: 'Edgecumbe',
  5: 'Hawkes Bay',
  6: 'Taranaki',
  7: 'Bunnythorpe',
  8: 'Wellington',
  9: 'Nelson',
  10: 'Christchurch',
  11: 'Canterbury',
  12: 'West Coast',
  13: 'Otago',
  14: 'Southland',
}

// A row's tick box: ticked, part-ticked (some of a group), or not
function CheckBox({ checked, partial = false, size }: { checked: boolean; partial?: boolean; size: 14 | 16 }) {
  return (
    <span style={{ width: size, height: size, borderRadius: size === 16 ? 4 : 3, border: checked ? 'none' : '1.5px solid var(--color-border-strong)', background: checked ? 'var(--color-accent)' : partial ? 'var(--color-accent-muted)' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {(checked || partial) && <span style={{ color: 'var(--color-text-inverse)', fontSize: size === 16 ? 'var(--font-size-xs)' : 'var(--font-size-2xs)', lineHeight: 1 }}>✓</span>}
    </span>
  )
}

// Adds `keys` to `set`, or takes them all out if they're all in it already
function toggleAll(set: Set<string>, keys: string[]): Set<string> {
  const next = new Set(set)
  if (keys.every(k => next.has(k))) keys.forEach(k => next.delete(k))
  else keys.forEach(k => next.add(k))
  return next
}

export default function NodePickerModal({ generators, substations, currentNode, onSelect, onClose }: Props) {
  const [tab, setTab] = useState<Tab>(currentNode?.kind === 'substation' || currentNode?.kind === 'substations' ? 'substation' : 'generation')
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const initialSites = currentNode?.kind === 'generator' ? new Set([currentNode.generator.site])
    : currentNode?.kind === 'generators' ? new Set(currentNode.generators.map(g => g.site))
      : new Set<string>()
  const [selectedSites, setSelectedSites] = useState<Set<string>>(initialSites)
  const initialSubstations = currentNode?.kind === 'substation' || currentNode?.kind === 'substations'
    ? new Set(substationsOf(currentNode).map(s => s.siteId))
    : new Set<string>()
  const [selectedSubstations, setSelectedSubstations] = useState<Set<string>>(initialSubstations)
  const [selectedFuels, setSelectedFuels] = useState<Set<string>>(new Set())
  const [selectedSchemes, setSelectedSchemes] = useState<Set<string>>(new Set())

  const availableSchemes = useMemo(() => {
    const schemes = generators.map(g => g.scheme).filter((s): s is string => !!s)
    return [...new Set(schemes)].sort((a, b) => a.localeCompare(b))
  }, [generators])

  const toggleScheme = (scheme: string) => {
    setSelectedSchemes(prev => {
      const next = new Set(prev)
      if (next.has(scheme)) next.delete(scheme)
      else next.add(scheme)
      return next
    })
  }

  const availableFuels = useMemo(
    () => fuelFamilies(generators.flatMap(g => g.units.map(u => u.fuel))).map(f => f.label),
    [generators],
  )

  const toggleFuel = (fuel: string) => {
    setSelectedFuels(prev => {
      const next = new Set(prev)
      if (next.has(fuel)) next.delete(fuel)
      else next.add(fuel)
      return next
    })
  }

  const toggleSite = (site: string) => setSelectedSites(prev => toggleAll(prev, [site]))
  const toggleSubstation = (siteId: string) => setSelectedSubstations(prev => toggleAll(prev, [siteId]))

  // The open tab's selection, which its footer counts, clears and views
  const picked = tab === 'generation' ? selectedSites : selectedSubstations
  const setPicked = tab === 'generation' ? setSelectedSites : setSelectedSubstations
  const pickedNoun = tab === 'generation' ? 'generator' : 'substation'

  const confirmSelection = () => {
    if (picked.size === 0) return
    if (tab === 'generation') {
      const selected = generators.filter(g => selectedSites.has(g.site))
      if (selected.length === 1) onSelect({ kind: 'generator', generator: selected[0] })
      else onSelect({ kind: 'generators', generators: selected })
    } else {
      const selected = substations.filter(s => selectedSubstations.has(s.siteId))
      if (selected.length === 1) onSelect({ kind: 'substation', substation: selected[0] })
      else onSelect({ kind: 'substations', substations: selected })
    }
    onClose()
  }

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Reset search and filters when switching tabs
  const handleTabChange = (t: Tab) => { setTab(t); setQuery(''); setSelectedFuels(new Set()); setSelectedSchemes(new Set()) }

  const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  const q = norm(query)
  const filteredGenerators = generators
    .filter(g => norm(g.name).includes(q) || norm(g.operator).includes(q))
    .filter(g => selectedFuels.size === 0 || g.units.some(u => selectedFuels.has(fuelFamily(u.fuel))))
    .filter(g => selectedSchemes.size === 0 || (g.scheme != null && selectedSchemes.has(g.scheme)))
    .sort((a, b) => a.name.localeCompare(b.name))
  const filteredSubstations = substations
    .filter(s => norm(s.description).includes(q) || s.siteId.toLowerCase().includes(q))
    .sort((a, b) => a.description.localeCompare(b.description))

  const tabClass = (t: Tab) => (tab === t ? 'tab is-active' : 'tab')

  return (
    <div onClick={onClose} className="modal-backdrop">
      <div onClick={e => e.stopPropagation()} className="modal" style={{ width: 560, maxHeight: '80vh' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--color-divider)', padding: '0 var(--space-md)' }}>
          <button className={tabClass('generation')} onClick={() => handleTabChange('generation')}>Generation</button>
          <button className={tabClass('substation')} onClick={() => handleTabChange('substation')}>Substations</button>
        </div>

        {/* Search + filter dropdowns */}
        {(() => {
          const searchInput = (
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search"
              className="search-input"
              style={{ flex: 1, minWidth: 0 }}
            />
          )
          if (tab !== 'generation') {
            return (
              <div className="section" style={{ display: 'flex' }}>
                {searchInput}
              </div>
            )
          }
          return (
          <div className="section" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {searchInput}
            <FilterDropdown
              label="All schemes"
              countLabel={n => `${n} schemes`}
              options={availableSchemes}
              active={selectedSchemes}
              onToggle={toggleScheme}
              onClear={() => setSelectedSchemes(new Set())}
              align="right"
            />
            <FilterDropdown
              label="All fuels"
              countLabel={n => `${n} fuels`}
              options={availableFuels}
              active={selectedFuels}
              onToggle={toggleFuel}
              onClear={() => setSelectedFuels(new Set())}
              swatch={fuel => ({ background: fuelColour(fuel) })}
              align="right"
            />
          </div>
          )
        })()}

        {/* List */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {tab === 'generation' && (() => {
            if (filteredGenerators.length === 0) return <div className="empty-state">No results</div>
            const byOperator = new Map<string, typeof filteredGenerators>()
            for (const g of filteredGenerators) {
              const group = byOperator.get(g.operator) ?? []
              group.push(g)
              byOperator.set(g.operator, group)
            }
            const sortedOperators = [...byOperator.keys()].sort((a, b) => a.localeCompare(b))
            return sortedOperators.map(operator => {
              const operatorGens = byOperator.get(operator)!
              const allChecked = operatorGens.every(g => selectedSites.has(g.site))
              const someChecked = !allChecked && operatorGens.some(g => selectedSites.has(g.site))
              const toggleOperator = () => setSelectedSites(prev => toggleAll(prev, operatorGens.map(g => g.site)))
              return (
                <div key={operator}>
                  <div
                    onClick={toggleOperator}
                    className="eyebrow"
                    style={{ padding: 'var(--space-md) var(--space-xl) var(--space-xs)', background: 'var(--color-surface-subtle)', borderBottom: '1px solid var(--color-divider-subtle)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                  >
                    <CheckBox checked={allChecked} partial={someChecked} size={14} />
                    {operator}
                  </div>
                  {byOperator.get(operator)!.map(g => {
                    const fuels = [...new Set(g.units.map(u => fuelFamily(u.fuel)))]
                    const checked = selectedSites.has(g.site)
                    return (
                      <div
                        key={g.site}
                        className={checked ? 'list-item is-selected' : 'list-item'}
                        style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                        onClick={() => toggleSite(g.site)}
                      >
                        <CheckBox checked={checked} size={16} />
                        <span style={{ flex: 1 }}>
                          {g.name}
                          {/* Retired generators are only on the map for views back to when they ran, but their history can still be charted */}
                          {isRetired(g) && (
                            <span style={{ marginLeft: 6, fontSize: 'var(--font-size-2xs)', padding: '0 var(--space-sm)', borderRadius: 3, border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', fontWeight: 600, verticalAlign: 'middle' }}>
                              Retired
                            </span>
                          )}
                        </span>
                        <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                          {fuels.map(fuel => (
                            <span key={fuel} style={{ fontSize: 'var(--font-size-2xs)', padding: '1px var(--space-sm)', borderRadius: 3, background: fuelColour(fuel), color: 'var(--color-text-inverse)', fontWeight: 600, opacity: 0.9 }}>
                              {fuel}
                            </span>
                          ))}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )
            })
          })()}
          {tab === 'substation' && (() => {
            if (filteredSubstations.length === 0) return <div className="empty-state">No results</div>
            const islands: { key: 'north' | 'south'; label: string }[] = [
              { key: 'north', label: 'North Island' },
              { key: 'south', label: 'South Island' },
            ]
            return islands.map(({ key, label }) => {
              const islandSubs = filteredSubstations.filter(s => s.island === key)
              if (islandSubs.length === 0) return null
              const byZone = new Map<number, typeof islandSubs>()
              for (const s of islandSubs) {
                const group = byZone.get(s.gridZone) ?? []
                group.push(s)
                byZone.set(s.gridZone, group)
              }
              const sortedZones = [...byZone.keys()].sort((a, b) => a - b)
              return (
                <div key={key}>
                  <div style={{ position: 'sticky', top: 0, zIndex: 2, padding: 'var(--space-md) var(--space-xl) var(--space-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 700, color: 'var(--color-text)', background: 'var(--color-surface-muted)', borderBottom: '1px solid var(--color-divider)', borderTop: '1px solid var(--color-divider)' }}>
                    {label}
                  </div>
                  {sortedZones.map(zone => {
                    const zoneSubs = byZone.get(zone)!
                    const allChecked = zoneSubs.every(s => selectedSubstations.has(s.siteId))
                    const someChecked = !allChecked && zoneSubs.some(s => selectedSubstations.has(s.siteId))
                    return (
                      <div key={zone}>
                        <div
                          onClick={() => setSelectedSubstations(prev => toggleAll(prev, zoneSubs.map(s => s.siteId)))}
                          className="eyebrow"
                          style={{ position: 'sticky', top: 28, zIndex: 1, padding: 'var(--space-sm) var(--space-xl) var(--space-xs) var(--space-2xl)', background: 'var(--color-surface-subtle)', borderBottom: '1px solid var(--color-divider-subtle)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                        >
                          <CheckBox checked={allChecked} partial={someChecked} size={14} />
                          <span>{GRID_ZONE_NAMES[zone] ?? `Grid Zone ${zone}`} <span style={{ fontWeight: 400, opacity: 0.6 }}>GZ{zone}</span></span>
                        </div>
                        {zoneSubs.map(s => {
                          const checked = selectedSubstations.has(s.siteId)
                          return (
                            <div
                              key={s.siteId}
                              className={checked ? 'list-item is-selected' : 'list-item'}
                              style={{ paddingLeft: 'var(--space-3xl)', display: 'flex', alignItems: 'center', gap: 8 }}
                              onClick={() => toggleSubstation(s.siteId)}
                            >
                              <CheckBox checked={checked} size={16} />
                              <span>
                                {s.description}
                                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-faint)', marginLeft: 6 }}>{s.siteId}</span>
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              )
            })
          })()}
        </div>

        {/* Selection footer */}
        <div style={{ padding: 'var(--space-lg) var(--space-xl)', borderTop: '1px solid var(--color-divider)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
            {picked.size === 0 ? `No ${pickedNoun}s selected` : `${picked.size} ${pickedNoun}${picked.size !== 1 ? 's' : ''} selected`}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {picked.size > 0 && (
              <button
                onClick={() => setPicked(new Set())}
                className="button-secondary"
                style={{ padding: 'var(--space-sm) var(--space-xl)', borderRadius: 'var(--radius-md)', fontWeight: 600, lineHeight: 'normal' }}
              >
                Clear
              </button>
            )}
            <button
              onClick={confirmSelection}
              disabled={picked.size === 0}
              className="button-primary"
            >
              View
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
