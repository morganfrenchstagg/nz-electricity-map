import { useState, useCallback, useEffect, useRef } from 'react'
import Map from './components/Map'
import NodePanel from './components/NodePanel'
import GridOverviewPanel from './components/GridOverviewPanel'
import type { SelectedNode, Generator, Substation } from './types'
import { useDispatchData } from './hooks/useDispatchData'
import type { DateMode } from './hooks/useDispatchData'
import { useDefinitions } from './hooks/useDefinitions'
import { useResizableWidth } from './hooks/useResizableWidth'
import { useIsMobile } from './hooks/useIsMobile'

export default function App() {
  const { generators, substations } = useDefinitions()
  const isMobile = useIsMobile()
  const [selectedNode, setSelectedNode] = useState<SelectedNode>(null)
  const [gridPanelVisible, setGridPanelVisible] = useState(true)
  const leftPanelOpen = selectedNode !== null || gridPanelVisible

  const closeNode = useCallback(() => {
    setSelectedNode(null)
  }, [])

  // Resolve ?node= from URL once definitions have loaded
  const pendingNode = useRef(new URLSearchParams(window.location.search).get('node'))
  const nodeResolved = useRef(false)
  useEffect(() => {
    if (nodeResolved.current || !pendingNode.current) return
    if (generators.length === 0 && substations.length === 0) return
    nodeResolved.current = true
    const raw = pendingNode.current
    if (raw.startsWith('generator:')) {
      const gen = generators.find(g => g.site === raw.slice('generator:'.length))
      if (gen) setSelectedNode({ kind: 'generator', generator: gen })
    } else if (raw.startsWith('generators:')) {
      const sites = raw.slice('generators:'.length).split(',')
      const gens = sites.map(s => generators.find(g => g.site === s)).filter(Boolean) as Generator[]
      if (gens.length === 1) setSelectedNode({ kind: 'generator', generator: gens[0] })
      else if (gens.length > 1) setSelectedNode({ kind: 'generators', generators: gens })
    } else if (raw.startsWith('substation:')) {
      const sub = substations.find(s => s.siteId === raw.slice('substation:'.length))
      if (sub) setSelectedNode({ kind: 'substation', substation: sub })
    }
  }, [generators, substations])

  // Sync selectedNode to URL, preserving other params
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    if (selectedNode === null) p.delete('node')
    else if (selectedNode.kind === 'generator') p.set('node', `generator:${selectedNode.generator.site}`)
    else if (selectedNode.kind === 'generators') p.set('node', `generators:${selectedNode.generators.map(g => g.site).join(',')}`)
    else p.set('node', `substation:${selectedNode.substation.siteId}`)
    window.history.replaceState({}, '', `${window.location.pathname}?${p.toString()}`)
  }, [selectedNode])

  const [dateMode, setDateMode] = useState<DateMode>(() => {
    const p = new URLSearchParams(window.location.search)
    const from = p.get('from'), to = p.get('to'), date = p.get('date'), mode = p.get('mode')
    if (from && to) return { kind: 'range', from, to }
    if (date) return { kind: 'date', date }
    if (mode === 'recent') return { kind: 'recent' }
    return { kind: 'today' }
  })

  // Sync dateMode to URL, preserving other params
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    p.delete('mode'); p.delete('date'); p.delete('from'); p.delete('to')
    if (dateMode.kind === 'today') p.set('mode', 'today')
    else if (dateMode.kind === 'recent') p.set('mode', 'recent')
    else if (dateMode.kind === 'date') p.set('date', dateMode.date)
    else if (dateMode.kind === 'range') { p.set('from', dateMode.from); p.set('to', dateMode.to) }
    window.history.replaceState({}, '', `${window.location.pathname}?${p.toString()}`)
  }, [dateMode])

  const { width: panelWidth, onMouseDown: onResizeHandleMouseDown } = useResizableWidth(Math.round(window.innerWidth * 0.6))

  const [expanded, setExpanded] = useState(() => new URLSearchParams(window.location.search).get('expanded') === 'true')

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    if (expanded) p.set('expanded', 'true')
    else p.delete('expanded')
    window.history.replaceState({}, '', `${window.location.pathname}?${p.toString()}`)
  }, [expanded])

  // Keep the document/tab title in sync with whichever panel is open
  useEffect(() => {
    let suffix: string
    if (selectedNode === null) {
      suffix = gridPanelVisible ? 'Grid Generation' : 'Map'
    } else if (selectedNode.kind === 'generator') {
      suffix = selectedNode.generator.name
    } else if (selectedNode.kind === 'generators') {
      suffix = selectedNode.generators.length <= 2
        ? selectedNode.generators.map(g => g.name).join(', ')
        : `${selectedNode.generators[0].name} +${selectedNode.generators.length - 1} more`
    } else {
      suffix = `${selectedNode.substation.description} Substation`
    }
    document.title = `NZ Electricity Map - ${suffix}`
  }, [selectedNode, gridPanelVisible])

  // Single source of dispatch data for the date-driven panels, so both
  // NodePanel and GridOverviewPanel share one fetch instead of each running
  // their own hook (and firing duplicate requests on date changes).
  const { recentData, loading, error } = useDispatchData(dateMode)

  const handleGeneratorClick = useCallback((generator: Generator) => {
    setSelectedNode({ kind: 'generator', generator }),
    setGridPanelVisible(false)
  }, [])

  const handleSubstationClick = useCallback((substation: Substation) => {
    setSelectedNode({ kind: 'substation', substation }),
    setGridPanelVisible(false)
  }, [])

  const effectivePanelWidth = isMobile ? window.innerWidth : panelWidth

  return (
    <>
      <Map onGeneratorClick={handleGeneratorClick} onSubstationClick={handleSubstationClick} onClear={() => { if (leftPanelOpen) { setSelectedNode(null); setGridPanelVisible(true) } }} selectedNode={selectedNode} leftPanelOpen={leftPanelOpen} panelWidth={effectivePanelWidth} recentData={recentData} isMobile={isMobile} />
      {selectedNode && (
        <NodePanel
          node={selectedNode}
          onClose={closeNode}
          onClear={() => { setSelectedNode(null); setGridPanelVisible(true) }}
          dateMode={dateMode}
          onDateModeChange={setDateMode}
          recentData={recentData}
          loading={loading}
          error={error}
          panelWidth={effectivePanelWidth}
          onResizeHandleMouseDown={onResizeHandleMouseDown}
          expanded={isMobile ? true : expanded}
          onExpandedChange={setExpanded}
          onNodeChange={setSelectedNode}
          isMobile={isMobile}
        />
      )}
      <GridOverviewPanel
        dateMode={dateMode}
        onDateModeChange={setDateMode}
        onClose={() => setGridPanelVisible(false)}
        onNodeSelect={(node) => { setSelectedNode(node); setGridPanelVisible(false) }}
        visible={!selectedNode && gridPanelVisible}
        recentData={recentData}
        loading={loading}
        error={error}
        panelWidth={effectivePanelWidth}
        onResizeHandleMouseDown={onResizeHandleMouseDown}
        expanded={isMobile ? true : expanded}
        onExpandedChange={setExpanded}
        isMobile={isMobile}
      />
      {!selectedNode && !gridPanelVisible && (
        <button
          onClick={() => setGridPanelVisible(true)}
          style={{
            position: 'fixed',
            bottom: isMobile ? 80 : 24,
            left: 24,
            zIndex: 10,
            background: 'white',
            border: '1px solid #ddd',
            borderRadius: 8,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            padding: isMobile ? '10px 18px' : '8px 14px',
            cursor: 'pointer',
            fontSize: isMobile ? 15 : 13,
            color: '#333',
            fontWeight: 500,
          }}
        >
          NZ Grid Generation ↑
        </button>
      )}
    </>
  )
}
