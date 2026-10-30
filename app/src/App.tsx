import { useState, useCallback, useEffect } from 'react'
import Map from './components/Map'
import GeneratorPanel from './components/GeneratorPanel'
import SubstationPanel from './components/SubstationPanel'
import GridOverviewPanel from './components/GridOverviewPanel'
import type { Generator, Substation } from './types'
import { useDispatchData } from './hooks/useDispatchData'
import { useDefinitions } from './hooks/useDefinitions'
import { useResizableWidth } from './hooks/useResizableWidth'
import { useIsMobile } from './hooks/useIsMobile'
import { useUrlState } from './hooks/useUrlState'
import { viewBesideNz } from './utils/mapView'

export default function App() {
  const { generators, substations } = useDefinitions()
  const isMobile = useIsMobile()
  const {
    selectedNode, selectNode,
    dateMode, setDateMode,
    viewMode, setViewMode,
    tradingPeriod, setTradingPeriod,
    activeFuels, setActiveFuels,
    chartSettings, setChartSettings,
    expanded, setExpanded,
    pipelineOpen, setPipelineOpen,
  } = useUrlState(generators, substations)
  const [gridPanelVisible, setGridPanelVisible] = useState(true)
  const leftPanelOpen = selectedNode !== null || gridPanelVisible

  const closeNode = useCallback(() => {
    selectNode(null)
  }, [selectNode])

  // On desktop the panel starts as wide as it can with all of NZ in view on the map beside it.
  // On mobile, where the panel covers the map, or a viewport too small for both, it starts
  // at 60% and the map at its default view.
  const [initialView] = useState(() => isMobile ? null : viewBesideNz(window.innerWidth, window.innerHeight))
  const { width: panelWidth, onMouseDown: onResizeHandleMouseDown } = useResizableWidth(initialView?.panelWidth ?? Math.round(window.innerWidth * 0.6))

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

  // Single source of dispatch data for the date-driven panels, so the node
  // panels and GridOverviewPanel share one fetch instead of each running
  // their own hook (and firing duplicate requests on date changes).
  const { recentData, loading, error } = useDispatchData(dateMode)

  const handleGeneratorClick = useCallback((generator: Generator) => {
    selectNode({ kind: 'generator', generator }),
    setGridPanelVisible(false)
  }, [selectNode])

  const handleSubstationClick = useCallback((substation: Substation) => {
    selectNode({ kind: 'substation', substation }),
    setGridPanelVisible(false)
  }, [selectNode])

  const effectivePanelWidth = isMobile ? window.innerWidth : panelWidth

  const nodePanelProps = {
    onClose: closeNode,
    onClear: () => { selectNode(null); setGridPanelVisible(true) },
    dateMode,
    onDateModeChange: setDateMode,
    recentData,
    loading,
    error,
    panelWidth: effectivePanelWidth,
    onResizeHandleMouseDown,
    expanded: isMobile ? true : expanded,
    onExpandedChange: setExpanded,
    onNodeChange: selectNode,
    isMobile,
  }

  return (
    <>
      <Map onGeneratorClick={handleGeneratorClick} onSubstationClick={handleSubstationClick} onClear={() => { if (leftPanelOpen) { selectNode(null); setGridPanelVisible(true) } }} selectedNode={selectedNode} leftPanelOpen={leftPanelOpen} panelWidth={effectivePanelWidth} initialView={initialView} recentData={recentData} dateMode={dateMode} isMobile={isMobile} />
      {selectedNode && (selectedNode.kind === 'substation'
        ? <SubstationPanel node={selectedNode} {...nodePanelProps} />
        : <GeneratorPanel
          node={selectedNode}
          {...nodePanelProps}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          tradingPeriod={tradingPeriod}
          onTradingPeriodChange={setTradingPeriod}
        />)}
      <GridOverviewPanel
        dateMode={dateMode}
        onDateModeChange={setDateMode}
        onClose={() => setGridPanelVisible(false)}
        onNodeSelect={(node) => { selectNode(node); setGridPanelVisible(false) }}
        visible={!selectedNode && gridPanelVisible}
        recentData={recentData}
        loading={loading}
        error={error}
        panelWidth={effectivePanelWidth}
        onResizeHandleMouseDown={onResizeHandleMouseDown}
        expanded={isMobile ? true : expanded}
        onExpandedChange={setExpanded}
        isMobile={isMobile}
        activeFuels={activeFuels}
        onActiveFuelsChange={setActiveFuels}
        chartSettings={chartSettings}
        onChartSettingsChange={setChartSettings}
        pipelineOpen={pipelineOpen}
        onPipelineOpenChange={setPipelineOpen}
      />
      {!selectedNode && !gridPanelVisible && (
        <button
          onClick={() => setGridPanelVisible(true)}
          style={{
            position: 'fixed',
            bottom: isMobile ? 80 : 24,
            left: 24,
            zIndex: 10,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-floating)',
            padding: isMobile ? 'var(--space-lg) var(--space-xl)' : 'var(--space-md) var(--space-xl)',
            cursor: 'pointer',
            fontSize: isMobile ? 'var(--font-size-lg)' : 'var(--font-size-base)',
            color: 'var(--color-text)',
            fontWeight: 500,
          }}
        >
          NZ Grid Generation ↑
        </button>
      )}
    </>
  )
}
