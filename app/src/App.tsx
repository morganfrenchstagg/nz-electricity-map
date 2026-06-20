import { useState, useCallback } from 'react'
import Map from './components/Map'
import NodePanel from './components/NodePanel'
import type { SelectedNode, Generator, Substation } from './types'

export default function App() {
  const [selectedNode, setSelectedNode] = useState<SelectedNode>(null)

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
        <NodePanel node={selectedNode} onClose={() => setSelectedNode(null)} />
      )}
    </>
  )
}
