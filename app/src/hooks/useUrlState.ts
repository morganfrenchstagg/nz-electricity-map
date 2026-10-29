import { useCallback, useEffect, useState } from 'react'
import type { Generator, SelectedNode, Substation } from '../types'
import { periodMode } from './useDispatchData'
import type { DateMode } from './useDispatchData'
import { FIRST_DAY } from './useAggregates'

export type ViewMode = 'generation' | 'offers'

// Everything a link carries, in the order it's written:
//   ?node=          the open node panel: generator:HLY, generators:HLY,TCC, substation:OTA or hvdc
//   ?mode=          today | recent | last90 | lastYear | 5y | all, with
//   ?aggregation=   a view's totals when they aren't its default: weekly for
//                   90d, daily for 1y, weekly for 5y, or monthly or quarterly
//                   for All, or instead
//   ?date=          a single day, or
//   ?from=&to=      a custom range
//   ?view=offers    the generator panel's Offers view, with
//   ?tp=            its trading period
//   ?fuels=         the grid overview's fuels, when not all of them
//   ?expanded=true  the panel is expanded
//   /pipeline       the pipeline modal is open
// Any other params the link had (e.g. utm_source, or a flag in featureFlags.ts)
// are kept, after these.
const PARAMS = ['node', 'mode', 'aggregation', 'date', 'from', 'to', 'view', 'tp', 'fuels', 'expanded']

const PERIOD_MODES = ['today', 'recent', 'last90', 'lastYear', '5y', 'all'] as const

interface UrlState {
  node: string | null
  dateMode: DateMode
  viewMode: ViewMode
  tradingPeriod: number
  activeFuels: Set<string> | null
  expanded: boolean
  pipelineOpen: boolean
}

function readUrl(): UrlState {
  const p = new URLSearchParams(window.location.search)
  // A day before the data starts is dropped, so the link opens its period instead
  const day = (key: string) => { const d = p.get(key); return d && d >= FIRST_DAY ? d : null }
  const from = day('from'), to = day('to'), date = day('date')
  // The 30d view was dropped for 90d, which its old links open instead
  const mode = p.get('mode') === 'last30' ? 'last90' : p.get('mode')
  const period = PERIOD_MODES.find(m => m === mode) ?? 'today'
  const viewMode = p.get('view') === 'offers' ? 'offers' : 'generation'
  const tp = parseInt(p.get('tp') ?? '', 10)
  const fuels = p.get('fuels')
  return {
    node: p.get('node'),
    dateMode: from && to ? { kind: 'range', from, to }
      : date ? { kind: 'date', date }
        : periodMode(period, p.get('aggregation')),
    viewMode,
    tradingPeriod: viewMode === 'offers' && !isNaN(tp) ? tp : 1,
    activeFuels: fuels ? new Set(fuels.split(',').filter(Boolean)) : null,
    expanded: p.get('expanded') === 'true',
    pipelineOpen: window.location.pathname === '/pipeline',
  }
}

function writeUrl(state: UrlState) {
  const p = new URLSearchParams()
  if (state.node) p.set('node', state.node)
  const { dateMode } = state
  if (dateMode.kind === 'date') p.set('date', dateMode.date)
  else if (dateMode.kind === 'range') { p.set('from', dateMode.from); p.set('to', dateMode.to) }
  else {
    p.set('mode', dateMode.kind)
    const defaultMode = periodMode(dateMode.kind)
    if ('aggregation' in dateMode && 'aggregation' in defaultMode && dateMode.aggregation !== defaultMode.aggregation) {
      p.set('aggregation', dateMode.aggregation)
    }
  }
  if (state.viewMode === 'offers') { p.set('view', 'offers'); p.set('tp', String(state.tradingPeriod)) }
  if (state.activeFuels) p.set('fuels', [...state.activeFuels].join(','))
  if (state.expanded) p.set('expanded', 'true')
  for (const [key, value] of new URLSearchParams(window.location.search)) {
    if (!PARAMS.includes(key)) p.append(key, value)
  }

  // Opening the pipeline is a new history entry, so Back closes it
  const onPipeline = window.location.pathname === '/pipeline'
  const path = state.pipelineOpen ? '/pipeline' : onPipeline ? '/' : window.location.pathname
  const url = `${path}?${p.toString()}`
  if (state.pipelineOpen && !onPipeline) window.history.pushState({}, '', url)
  else window.history.replaceState({}, '', url)
}

function nodeParam(node: NonNullable<SelectedNode>): string {
  if (node.kind === 'generator') return `generator:${node.generator.site}`
  if (node.kind === 'generators') return `generators:${node.generators.map(g => g.site).join(',')}`
  if (node.kind === 'hvdc') return 'hvdc'
  return `substation:${node.substation.siteId}`
}

function resolveNode(param: string, generators: Generator[], substations: Substation[]): SelectedNode {
  if (param === 'hvdc') return { kind: 'hvdc' }
  if (param.startsWith('generator:')) {
    const gen = generators.find(g => g.site === param.slice('generator:'.length))
    return gen ? { kind: 'generator', generator: gen } : null
  }
  if (param.startsWith('generators:')) {
    const sites = param.slice('generators:'.length).split(',')
    const gens = sites.map(s => generators.find(g => g.site === s)).filter(Boolean) as Generator[]
    if (gens.length === 1) return { kind: 'generator', generator: gens[0] }
    return gens.length > 1 ? { kind: 'generators', generators: gens } : null
  }
  if (param.startsWith('substation:')) {
    const sub = substations.find(s => s.siteId === param.slice('substation:'.length))
    return sub ? { kind: 'substation', substation: sub } : null
  }
  return null
}

// The state kept in the URL, read from it once on load and written back whole
// whenever any of it changes, so the URL never depends on which part changed
// first. The URL's ?node= is resolved against the definitions once they load.
export function useUrlState(generators: Generator[], substations: Substation[]) {
  const [initial] = useState(readUrl)
  // ?node= stays in the URL as it was until it's resolved
  const [linkedNode, setLinkedNode] = useState(initial.node)
  const [selectedNode, setSelectedNode] = useState<SelectedNode>(null)
  const [dateMode, setDateMode] = useState(initial.dateMode)
  const [viewMode, setViewModeState] = useState(initial.viewMode)
  const [tradingPeriod, setTradingPeriod] = useState(initial.tradingPeriod)
  const [activeFuels, setActiveFuels] = useState(initial.activeFuels)
  const [expanded, setExpanded] = useState(initial.expanded)
  const [pipelineOpen, setPipelineOpen] = useState(initial.pipelineOpen)

  // Offers opens at the first trading period, unless a link gave one
  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode)
    if (mode === 'generation') setTradingPeriod(1)
  }, [])

  // The Offers view belongs to the generator panel, so goes when it does. And
  // substations have no All view (see SubstationPanel), so opening one on All
  // moves to 5y.
  const selectNode = useCallback((node: SelectedNode) => {
    setLinkedNode(null)
    setSelectedNode(node)
    if (node === null || node.kind === 'substation' || node.kind === 'hvdc') setViewMode('generation')
    if (node?.kind === 'substation') setDateMode(m => m.kind === 'all' ? periodMode('5y') : m)
  }, [setViewMode])

  useEffect(() => {
    if (linkedNode === null || (generators.length === 0 && substations.length === 0)) return
    selectNode(resolveNode(linkedNode, generators, substations))
  }, [linkedNode, generators, substations, selectNode])

  // Back from /pipeline closes the pipeline modal
  useEffect(() => {
    const onPopState = () => setPipelineOpen(window.location.pathname === '/pipeline')
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const node = linkedNode ?? (selectedNode && nodeParam(selectedNode))
  useEffect(() => {
    writeUrl({ node, dateMode, viewMode, tradingPeriod, activeFuels, expanded, pipelineOpen })
  }, [node, dateMode, viewMode, tradingPeriod, activeFuels, expanded, pipelineOpen])

  return {
    selectedNode, selectNode,
    dateMode, setDateMode,
    viewMode, setViewMode,
    tradingPeriod, setTradingPeriod,
    activeFuels, setActiveFuels,
    expanded, setExpanded,
    pipelineOpen, setPipelineOpen,
  }
}
