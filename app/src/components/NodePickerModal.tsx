import { useState, useEffect, useRef, useMemo } from 'react'
import type { Generator, Substation, SelectedNode } from '../types'
import { fuelColour, FUEL_CODE_ORDER } from '../utils/colours'

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

  const itemStyle = (key: string): React.CSSProperties => ({
    padding: '7px 16px',
    cursor: 'pointer',
    fontSize: 13,
    background: currentKey && key === currentKey ? '#f0f4ff' : 'transparent',
    fontWeight: currentKey && key === currentKey ? 600 : 400,
    borderLeft: currentKey && key === currentKey ? '3px solid #3b82f6' : '3px solid transparent',
  })

  const tabStyle = (t: Tab): React.CSSProperties => ({
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: tab === t ? 600 : 400,
    color: tab === t ? '#111' : '#666',
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    borderBottom: tab === t ? '2px solid #3b82f6' : '2px solid transparent',
    marginBottom: -1,
  })

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'white', borderRadius: 10, boxShadow: '0 8px 40px rgba(0,0,0,0.2)', width: 560, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #eee', padding: '0 8px' }}>
          <button style={tabStyle('generation')} onClick={() => handleTabChange('generation')}>Generation</button>
          <button style={tabStyle('substation')} onClick={() => handleTabChange('substation')}>Substations</button>
        </div>

        {/* Search + filter dropdowns */}
        {(() => {
          const searchInput = (
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search"
              style={{ flex: 1, minWidth: 0, fontSize: 13, border: '1px solid #ddd', borderRadius: 6, padding: '6px 10px', outline: 'none' }}
            />
          )
          if (tab !== 'generation') {
            return (
              <div style={{ padding: '8px 16px', borderBottom: '1px solid #eee', display: 'flex' }}>
                {searchInput}
              </div>
            )
          }
          return (
          <div style={{ padding: '8px 16px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: 8 }}>
            {searchInput}
            {/* Scheme dropdown */}
            <div style={{ position: 'relative', alignSelf: 'stretch' }} ref={schemeDropdownRef}>
              <button
                onClick={() => { setSchemeDropdownOpen(o => !o); setFuelDropdownOpen(false) }}
                style={{ fontSize: 13, padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', background: selectedSchemes.size > 0 ? '#f0f4ff' : 'white', color: selectedSchemes.size > 0 ? '#3b82f6' : '#555', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontWeight: selectedSchemes.size > 0 ? 600 : 400, whiteSpace: 'nowrap', height: '100%', boxSizing: 'border-box' }}
              >
                {selectedSchemes.size === 0 ? 'All schemes' : selectedSchemes.size === 1 ? [...selectedSchemes][0] : `${selectedSchemes.size} schemes`}
                {selectedSchemes.size > 0 && (
                  <span onClick={e => { e.stopPropagation(); setSelectedSchemes(new Set()) }} style={{ marginLeft: 2, opacity: 0.6, lineHeight: 1 }}>✕</span>
                )}
                <span style={{ opacity: 0.4, marginLeft: 2 }}>▾</span>
              </button>
              {schemeDropdownOpen && (
                <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 10, background: 'white', border: '1px solid #ddd', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', padding: '6px 0', minWidth: 200 }}>
                  {availableSchemes.map(scheme => {
                    const active = selectedSchemes.has(scheme)
                    return (
                      <div
                        key={scheme}
                        onClick={() => toggleScheme(scheme)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 13, background: active ? '#f0f4ff' : 'transparent' }}
                        onMouseEnter={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = '#f5f5f5' }}
                        onMouseLeave={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
                      >
                        <span style={{ flex: 1 }}>{scheme}</span>
                        {active && <span style={{ color: '#3b82f6', fontSize: 11 }}>✓</span>}
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
                style={{ fontSize: 13, padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', background: selectedFuels.size > 0 ? '#f0f4ff' : 'white', color: selectedFuels.size > 0 ? '#3b82f6' : '#555', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontWeight: selectedFuels.size > 0 ? 600 : 400, whiteSpace: 'nowrap', height: '100%', boxSizing: 'border-box' }}
              >
                {selectedFuels.size === 0 ? 'All fuels' : selectedFuels.size === 1 ? [...selectedFuels][0] : `${selectedFuels.size} fuels`}
                {selectedFuels.size > 0 && (
                  <span onClick={e => { e.stopPropagation(); setSelectedFuels(new Set()) }} style={{ marginLeft: 2, opacity: 0.6, lineHeight: 1 }}>✕</span>
                )}
                <span style={{ opacity: 0.4, marginLeft: 2 }}>▾</span>
              </button>
              {fuelDropdownOpen && (
                <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 10, background: 'white', border: '1px solid #ddd', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', padding: '6px 0', minWidth: 200 }}>
                  {availableFuels.map(fuel => {
                    const active = selectedFuels.has(fuel)
                    return (
                      <div
                        key={fuel}
                        onClick={() => toggleFuel(fuel)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 13, background: active ? '#f0f4ff' : 'transparent' }}
                        onMouseEnter={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = '#f5f5f5' }}
                        onMouseLeave={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
                      >
                        <span style={{ width: 12, height: 12, borderRadius: 3, flexShrink: 0, background: fuelColour(fuel) }} />
                        <span style={{ flex: 1 }}>{fuel}</span>
                        {active && <span style={{ color: '#3b82f6', fontSize: 11 }}>✓</span>}
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
            if (filteredGenerators.length === 0) return <div style={{ padding: 24, textAlign: 'center', color: '#999', fontSize: 13 }}>No results</div>
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
                    style={{ padding: '8px 16px 4px', fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', background: '#fafafa', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                  >
                    <span style={{ width: 14, height: 14, borderRadius: 3, border: allChecked ? 'none' : '1.5px solid #ccc', background: allChecked ? '#3b82f6' : someChecked ? '#93c5fd' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {(allChecked || someChecked) && <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>}
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
                        style={{ padding: '7px 16px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, background: checked ? '#f0f4ff' : 'transparent', borderLeft: checked ? '3px solid #3b82f6' : '3px solid transparent' }}
                        onClick={() => toggleSite(g.site)}
                        onMouseEnter={e => { if (!checked) (e.currentTarget as HTMLDivElement).style.background = '#f5f5f5' }}
                        onMouseLeave={e => { if (!checked) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
                      >
                        <span style={{ width: 16, height: 16, borderRadius: 4, border: checked ? 'none' : '1.5px solid #ccc', background: checked ? '#3b82f6' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {checked && <span style={{ color: '#fff', fontSize: 11, lineHeight: 1 }}>✓</span>}
                        </span>
                        <span style={{ flex: 1, fontWeight: checked ? 600 : 400 }}>{g.name}</span>
                        <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                          {fuels.map(fuel => (
                            <span key={fuel} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: fuelColour(fuel), color: '#fff', fontWeight: 600, opacity: 0.9 }}>
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
            if (filteredSubstations.length === 0) return <div style={{ padding: 24, textAlign: 'center', color: '#999', fontSize: 13 }}>No results</div>
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
                  <div style={{ position: 'sticky', top: 0, zIndex: 2, padding: '8px 16px 4px', fontSize: 12, fontWeight: 700, color: '#444', background: '#f0f0f0', borderBottom: '1px solid #e0e0e0', borderTop: '1px solid #e0e0e0' }}>
                    {label}
                  </div>
                  {sortedZones.map(zone => (
                    <div key={zone}>
                      <div style={{ position: 'sticky', top: 28, zIndex: 1, padding: '6px 16px 3px 24px', fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', background: '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
                        {GRID_ZONE_NAMES[zone] ?? `Grid Zone ${zone}`} <span style={{ fontWeight: 400, opacity: 0.6 }}>GZ{zone}</span>
                      </div>
                      {byZone.get(zone)!.map(s => (
                        <div
                          key={s.siteId}
                          style={{ ...itemStyle(`substation:${s.siteId}`), paddingLeft: 32 }}
                          onClick={() => { onSelect({ kind: 'substation', substation: s }); onClose() }}
                          onMouseEnter={e => { if (`substation:${s.siteId}` !== currentKey) (e.currentTarget as HTMLDivElement).style.background = '#f5f5f5' }}
                          onMouseLeave={e => { if (`substation:${s.siteId}` !== currentKey) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
                        >
                          {s.description}
                          <span style={{ fontSize: 11, color: '#999', marginLeft: 6 }}>{s.siteId}</span>
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
          <div style={{ padding: '10px 16px', borderTop: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 12, color: '#666' }}>
              {selectedSites.size === 0 ? 'No generators selected' : `${selectedSites.size} generator${selectedSites.size !== 1 ? 's' : ''} selected`}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              {selectedSites.size > 0 && (
                <button
                  onClick={() => setSelectedSites(new Set())}
                  style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#e7e7e7', color: '#666', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  Clear
                </button>
              )}
              <button
                onClick={confirmSelection}
                disabled={selectedSites.size === 0}
                style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: selectedSites.size > 0 ? '#3b82f6' : '#e5e7eb', color: selectedSites.size > 0 ? '#fff' : '#9ca3af', fontSize: 13, fontWeight: 600, cursor: selectedSites.size > 0 ? 'pointer' : 'default' }}
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
