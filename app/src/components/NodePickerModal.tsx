import { useState, useEffect, useRef } from 'react'
import type { Generator, Substation, SelectedNode } from '../types'
import { fuelColour } from '../utils/colours'

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

  // Reset search when switching tabs
  const handleTabChange = (t: Tab) => { setTab(t); setQuery('') }

  const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  const q = norm(query)
  const filteredGenerators = generators
    .filter(g => norm(g.name).includes(q) || norm(g.operator).includes(q))
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
        style={{ background: 'white', borderRadius: 10, boxShadow: '0 8px 40px rgba(0,0,0,0.2)', width: 420, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        {/* Search */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid #eee' }}>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search"
            style={{ width: '100%', fontSize: 13, border: '1px solid #ddd', borderRadius: 6, padding: '6px 10px', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #eee', padding: '0 8px' }}>
          <button style={tabStyle('generation')} onClick={() => handleTabChange('generation')}>Generation</button>
          <button style={tabStyle('substation')} onClick={() => handleTabChange('substation')}>Substations</button>
        </div>

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
