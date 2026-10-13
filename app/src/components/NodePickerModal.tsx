import { useState, useEffect, useRef, useMemo } from 'react'
import type { Generator, Substation, SelectedNode } from '../types'
import { fuelColour, FUEL_CODE_ORDER } from '../utils/colours'
import { isRetired } from '../utils/generators'

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

export default function NodePickerModal({ generators, substations, currentNode, onSelect, onClose }: Props) {
  const [tab, setTab] = useState<Tab>(currentNode?.kind === 'substation' ? 'substation' : 'generation')
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const initialSites = currentNode?.kind === 'generator' ? new Set([currentNode.generator.site])
    : currentNode?.kind === 'generators' ? new Set(currentNode.generators.map(g => g.site))
      : new Set<string>()
  const [selectedSites, setSelectedSites] = useState<Set<string>>(initialSites)
  const [selectedFuels, setSelectedFuels] = useState<Set<string>>(new Set())
  const [fuelDropdownOpen, setFuelDropdownOpen] = useState(false)
  const fuelDropdownRef = useRef<HTMLDivElement>(null)

  const [selectedSchemes, setSelectedSchemes] = useState<Set<string>>(new Set())
  const [schemeDropdownOpen, setSchemeDropdownOpen] = useState(false)
  const schemeDropdownRef = useRef<HTMLDivElement>(null)

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

  const normFuel = (fuel: string) =>
    fuel === 'Battery (Charging)' || fuel === 'Battery (Discharging)' ? 'Battery' : fuel

  const availableFuels = useMemo(() => {
    const fuels = new Set(generators.flatMap(g => g.units.map(u => normFuel(u.fuel))))
    return (FUEL_CODE_ORDER as readonly string[])
      .map(code => {
        // Map fuel codes to the display names used in the generator list
        const codeToName: Record<string, string> = {
          HYD: 'Hydro', WIN: 'Wind', GEO: 'Geothermal', SOL: 'Solar',
          GAS: 'Gas', CLG: 'Coal/Gas', DIE: 'Diesel', BESS: 'Battery', 'BESS-C': 'Battery',
        }
        return codeToName[code] ?? null
      })
      .filter((name): name is string => name !== null && fuels.has(name))
      .filter((name, i, arr) => arr.indexOf(name) === i) // dedupe Battery
  }, [generators])

  const toggleFuel = (fuel: string) => {
    setSelectedFuels(prev => {
      const next = new Set(prev)
      if (next.has(fuel)) next.delete(fuel)
      else next.add(fuel)
      return next
    })
  }

  const toggleSite = (site: string) => {
    setSelectedSites(prev => {
      const next = new Set(prev)
      if (next.has(site)) next.delete(site)
      else next.add(site)
      return next
    })
  }

  const confirmSelection = () => {
    if (selectedSites.size === 0) return
    const selected = generators.filter(g => selectedSites.has(g.site))
    if (selected.length === 1) onSelect({ kind: 'generator', generator: selected[0] })
    else onSelect({ kind: 'generators', generators: selected })
    onClose()
  }

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!fuelDropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (fuelDropdownRef.current && !fuelDropdownRef.current.contains(e.target as Node)) {
        setFuelDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [fuelDropdownOpen])

  useEffect(() => {
    if (!schemeDropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (schemeDropdownRef.current && !schemeDropdownRef.current.contains(e.target as Node)) {
        setSchemeDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [schemeDropdownOpen])

  // Reset search and filters when switching tabs
  const handleTabChange = (t: Tab) => { setTab(t); setQuery(''); setSelectedFuels(new Set()); setSelectedSchemes(new Set()); setFuelDropdownOpen(false); setSchemeDropdownOpen(false) }

  const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  const q = norm(query)
  const filteredGenerators = generators
    .filter(g => norm(g.name).includes(q) || norm(g.operator).includes(q))
    .filter(g => selectedFuels.size === 0 || g.units.some(u => selectedFuels.has(normFuel(u.fuel))))
    .filter(g => selectedSchemes.size === 0 || (g.scheme != null && selectedSchemes.has(g.scheme)))
    .sort((a, b) => a.name.localeCompare(b.name))
  const filteredSubstations = substations
    .filter(s => norm(s.description).includes(q) || s.siteId.toLowerCase().includes(q))
    .sort((a, b) => a.description.localeCompare(b.description))

  const currentKey = currentNode?.kind === 'substation'
    ? `substation:${currentNode.substation.siteId}`
    : null

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
            {/* Scheme dropdown */}
            <div style={{ position: 'relative', alignSelf: 'stretch' }} ref={schemeDropdownRef}>
              <button
                onClick={() => { setSchemeDropdownOpen(o => !o); setFuelDropdownOpen(false) }}
                className={selectedSchemes.size > 0 ? 'filter-button is-active' : 'filter-button'}
                style={{ display: 'flex', height: '100%' }}
              >
                {selectedSchemes.size === 0 ? 'All schemes' : selectedSchemes.size === 1 ? [...selectedSchemes][0] : `${selectedSchemes.size} schemes`}
                {selectedSchemes.size > 0 && (
                  <span onClick={e => { e.stopPropagation(); setSelectedSchemes(new Set()) }} style={{ marginLeft: 2, opacity: 0.6, lineHeight: 1, fontSize: 'var(--font-size-xs)' }}>✕</span>
                )}
                <span style={{ opacity: 0.4, marginLeft: 2, fontSize: 'var(--font-size-xs)' }}>▾</span>
              </button>
              {schemeDropdownOpen && (
                <div className="popover" style={{ top: '100%', right: 0, zIndex: 10, minWidth: 200 }}>
                  {availableSchemes.map(scheme => {
                    const active = selectedSchemes.has(scheme)
                    return (
                      <div key={scheme} onClick={() => toggleScheme(scheme)} className={active ? 'menu-item is-selected' : 'menu-item'}>
                        <span style={{ flex: 1 }}>{scheme}</span>
                        {active && <span style={{ color: 'var(--color-accent)', fontSize: 'var(--font-size-xs)' }}>✓</span>}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Fuel dropdown */}
            <div style={{ position: 'relative', alignSelf: 'stretch' }} ref={fuelDropdownRef}>
              <button
                onClick={() => { setFuelDropdownOpen(o => !o); setSchemeDropdownOpen(false) }}
                className={selectedFuels.size > 0 ? 'filter-button is-active' : 'filter-button'}
                style={{ display: 'flex', height: '100%' }}
              >
                {selectedFuels.size === 0 ? 'All fuels' : selectedFuels.size === 1 ? [...selectedFuels][0] : `${selectedFuels.size} fuels`}
                {selectedFuels.size > 0 && (
                  <span onClick={e => { e.stopPropagation(); setSelectedFuels(new Set()) }} style={{ marginLeft: 2, opacity: 0.6, lineHeight: 1, fontSize: 'var(--font-size-xs)' }}>✕</span>
                )}
                <span style={{ opacity: 0.4, marginLeft: 2, fontSize: 'var(--font-size-xs)' }}>▾</span>
              </button>
              {fuelDropdownOpen && (
                <div className="popover" style={{ top: '100%', right: 0, zIndex: 10, minWidth: 200 }}>
                  {availableFuels.map(fuel => {
                    const active = selectedFuels.has(fuel)
                    return (
                      <div key={fuel} onClick={() => toggleFuel(fuel)} className={active ? 'menu-item is-selected' : 'menu-item'}>
                        <span style={{ width: 12, height: 12, borderRadius: 3, flexShrink: 0, background: fuelColour(fuel) }} />
                        <span style={{ flex: 1 }}>{fuel}</span>
                        {active && <span style={{ color: 'var(--color-accent)', fontSize: 'var(--font-size-xs)' }}>✓</span>}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
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
              const toggleOperator = () => {
                setSelectedSites(prev => {
                  const next = new Set(prev)
                  if (allChecked) operatorGens.forEach(g => next.delete(g.site))
                  else operatorGens.forEach(g => next.add(g.site))
                  return next
                })
              }
              return (
                <div key={operator}>
                  <div
                    onClick={toggleOperator}
                    className="eyebrow"
                    style={{ padding: 'var(--space-md) var(--space-xl) var(--space-xs)', background: 'var(--color-surface-subtle)', borderBottom: '1px solid var(--color-divider-subtle)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                  >
                    <span style={{ width: 14, height: 14, borderRadius: 3, border: allChecked ? 'none' : '1.5px solid var(--color-border-strong)', background: allChecked ? 'var(--color-accent)' : someChecked ? 'var(--color-accent-muted)' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {(allChecked || someChecked) && <span style={{ color: 'var(--color-text-inverse)', fontSize: 'var(--font-size-2xs)', lineHeight: 1 }}>✓</span>}
                    </span>
                    {operator}
                  </div>
                  {byOperator.get(operator)!.map(g => {
                    const fuels = [...new Set(g.units.map(u =>
                      u.fuel === 'Battery (Charging)' || u.fuel === 'Battery (Discharging)' ? 'Battery' : u.fuel
                    ))]
                    const checked = selectedSites.has(g.site)
                    return (
                      <div
                        key={g.site}
                        className={checked ? 'list-item is-selected' : 'list-item'}
                        style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                        onClick={() => toggleSite(g.site)}
                      >
                        <span style={{ width: 16, height: 16, borderRadius: 4, border: checked ? 'none' : '1.5px solid var(--color-border-strong)', background: checked ? 'var(--color-accent)' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {checked && <span style={{ color: 'var(--color-text-inverse)', fontSize: 'var(--font-size-xs)', lineHeight: 1 }}>✓</span>}
                        </span>
                        <span style={{ flex: 1 }}>
                          {g.name}
                          {/* Retired generators aren't on the map, but their history can still be charted */}
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
                  {sortedZones.map(zone => (
                    <div key={zone}>
                      <div className="eyebrow" style={{ position: 'sticky', top: 28, zIndex: 1, padding: 'var(--space-sm) var(--space-xl) var(--space-xs) var(--space-2xl)', background: 'var(--color-surface-subtle)', borderBottom: '1px solid var(--color-divider-subtle)' }}>
                        {GRID_ZONE_NAMES[zone] ?? `Grid Zone ${zone}`} <span style={{ fontWeight: 400, opacity: 0.6 }}>GZ{zone}</span>
                      </div>
                      {byZone.get(zone)!.map(s => (
                        <div
                          key={s.siteId}
                          className={`substation:${s.siteId}` === currentKey ? 'list-item is-selected' : 'list-item'}
                          style={{ paddingLeft: 'var(--space-3xl)' }}
                          onClick={() => { onSelect({ kind: 'substation', substation: s }); onClose() }}
                        >
                          {s.description}
                          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-faint)', marginLeft: 6 }}>{s.siteId}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )
            })
          })()}
        </div>

        {/* Generator selection footer */}
        {tab === 'generation' && (
          <div style={{ padding: 'var(--space-lg) var(--space-xl)', borderTop: '1px solid var(--color-divider)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              {selectedSites.size === 0 ? 'No generators selected' : `${selectedSites.size} generator${selectedSites.size !== 1 ? 's' : ''} selected`}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              {selectedSites.size > 0 && (
                <button
                  onClick={() => setSelectedSites(new Set())}
                  className="button-secondary"
                  style={{ padding: 'var(--space-sm) var(--space-xl)', borderRadius: 'var(--radius-md)', fontWeight: 600, lineHeight: 'normal' }}
                >
                  Clear
                </button>
              )}
              <button
                onClick={confirmSelection}
                disabled={selectedSites.size === 0}
                className="button-primary"
              >
                View
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
