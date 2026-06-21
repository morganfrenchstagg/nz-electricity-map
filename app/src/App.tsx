import { useState, useCallback, useEffect } from 'react'
import Map from './components/Map'
import NodePanel from './components/NodePanel'
import type { SelectedNode, Generator, Substation } from './types'
import type { DateMode } from './hooks/useDispatchData'

export default function App() {
  const [selectedNode, setSelectedNode] = useState<SelectedNode>(null)

  const [dateMode, setDateMode] = useState<DateMode>(() => {
    const p = new URLSearchParams(window.location.search)
    const from = p.get('from'), to = p.get('to'), date = p.get('date')
    if (from && to) return { kind: 'range', from, to }
    if (date) return { kind: 'date', date }
    return { kind: 'recent' }
  })

  useEffect(() => {
    const p = new URLSearchParams()
    if (dateMode.kind === 'date') p.set('date', dateMode.date)
    else if (dateMode.kind === 'range') { p.set('from', dateMode.from); p.set('to', dateMode.to) }
    const qs = p.toString()
    window.history.replaceState({}, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname)
  }, [dateMode])

  const handleGeneratorClick = useCallback((generator: Generator) => {
    setSelectedNode({ kind: 'generator', generator })
  }, [])

  const handleSubstationClick = useCallback((substation: Substation) => {
    setSelectedNode({ kind: 'substation', substation })
  }, [])

  return (
    <>
      <Map onGeneratorClick={handleGeneratorClick} onSubstationClick={handleSubstationClick} selectedNode={selectedNode} />
      {selectedNode && (
        <NodePanel
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
          dateMode={dateMode}
          onDateModeChange={setDateMode}
        />
      )}
    </>
  )
}
