import { useCallback, useEffect, useState } from 'react'
import type { Generator, GeneratorNode, SelectedNode, Substation } from '../types'
import { periodMode } from './useDispatchData'
import type { DateMode } from './useDispatchData'
import { FIRST_DAY } from './useAggregates'
import { CHART_SETTING_PARAMS, readChartSettings, writeChartSettings } from '../utils/chartSettings'
import type { ChartSettings } from '../utils/chartSettings'
import { generatorSlug, isHistoricPath, nodeParamOfPath, stationPath, substationSlug } from '../utils/stationPaths'

export type ViewMode = 'generation' | 'offers'

// Everything a link carries, in the order it's written:
//   /generator/huntly, /substation/otahuhu or /hvdc
//                   the open panel, when it's a single station (see stationPaths),
//                   or /generator/huntly/historic, a generator at All, or
//   ?node=          several stations: generators:HLY,TCC or substations:OTA,PEN, or
//                   any node while the pipeline is open. A single station's
//                   ?node=generator:HLY, substation:OTA or hvdc, from older links,
//                   opens its page.
//   ?mode=          today | recent | last90 | lastYear | 5y | all (today by
//                   default, recent, the last 3 days, on a station's page, and
//                   all on a generator's history's, which leaves it out), with
//   ?aggregation=   a view's totals when they aren't its default: weekly for
//                   90d, daily for 1y, weekly for 5y, or monthly or quarterly
//                   for All, or instead
//   ?date=          a single day, or
//   ?from=&to=      a custom range
//   ?view=offers    the generator panel's Offers view, with
//   ?tp=            its trading period
//   ?fuels=         the grid overview's fuels, when not all of them
//   ?chart=line     the charts' lines in place of stacks, and any other chart
//                   setting that isn't its default under its own param (see chartSettings)
//   ?expanded=true  the panel is expanded
//   /pipeline       the pipeline modal is open, in place of the station's path
// Any other params the link had (e.g. utm_source, or a flag in featureFlags.ts)
// are kept, after these.
const PARAMS = ['node', 'mode', 'aggregation', 'date', 'from', 'to', 'view', 'tp', 'fuels', ...CHART_SETTING_PARAMS, 'expanded']

const PERIOD_MODES = ['today', 'recent', 'last90', 'lastYear', '5y', 'all'] as const

interface UrlState {
  node: string | null
  // The open station's page, when it has one
  nodePath: string | null
  dateMode: DateMode
  viewMode: ViewMode
  tradingPeriod: number
  activeFuels: Set<string> | null
  chartSettings: ChartSettings
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
  // A station's page opens at its last 3 days, a generator's history at All, and
  // the rest of the site at today
  const pathNode = nodeParamOfPath(window.location.pathname)
  const period = PERIOD_MODES.find(m => m === mode)
    ?? (isHistoricPath(window.location.pathname) ? 'all' : pathNode ? 'recent' : 'today')
  const viewMode = p.get('view') === 'offers' ? 'offers' : 'generation'
  const tp = parseInt(p.get('tp') ?? '', 10)
  const fuels = p.get('fuels')
  return {
    node: pathNode ?? p.get('node'),
    nodePath: pathNode ? window.location.pathname : null,
    dateMode: from && to ? { kind: 'range', from, to }
      : date ? { kind: 'date', date }
        : periodMode(period, p.get('aggregation')),
    viewMode,
    tradingPeriod: viewMode === 'offers' && !isNaN(tp) ? tp : 1,
    activeFuels: fuels ? new Set(fuels.split(',').filter(Boolean)) : null,
    chartSettings: readChartSettings(p),
    expanded: p.get('expanded') === 'true',
    pipelineOpen: window.location.pathname === '/pipeline',
  }
}

function writeUrl(state: UrlState) {
  const p = new URLSearchParams()
  if (state.node && (state.pipelineOpen || !state.nodePath)) p.set('node', state.node)
  const { dateMode } = state
  // A generator's history is All, so its path says so
  const historicPath = !state.pipelineOpen && state.nodePath !== null && isHistoricPath(state.nodePath)
  if (dateMode.kind === 'date') p.set('date', dateMode.date)
  else if (dateMode.kind === 'range') { p.set('from', dateMode.from); p.set('to', dateMode.to) }
  else {
    if (!(historicPath && dateMode.kind === 'all')) p.set('mode', dateMode.kind)
    const defaultMode = periodMode(dateMode.kind)
    if ('aggregation' in dateMode && 'aggregation' in defaultMode && dateMode.aggregation !== defaultMode.aggregation) {
      p.set('aggregation', dateMode.aggregation)
    }
  }
  if (state.viewMode === 'offers') { p.set('view', 'offers'); p.set('tp', String(state.tradingPeriod)) }
  if (state.activeFuels) p.set('fuels', [...state.activeFuels].join(','))
  writeChartSettings(state.chartSettings, p)
  if (state.expanded) p.set('expanded', 'true')
  for (const [key, value] of new URLSearchParams(window.location.search)) {
    if (!PARAMS.includes(key)) p.append(key, value)
  }

  // Opening the pipeline is a new history entry, so Back closes it
  const onPipeline = window.location.pathname === '/pipeline'
  const path = state.pipelineOpen ? '/pipeline' : state.nodePath ?? '/'
  const url = `${path}?${p.toString()}`
  if (state.pipelineOpen && !onPipeline) window.history.pushState({}, '', url)
  else window.history.replaceState({}, '', url)
}

function nodeParam(node: NonNullable<SelectedNode>): string {
  if (node.kind === 'generator') return `generator:${node.generator.site}`
  if (node.kind === 'generators') return `generators:${node.generators.map(g => g.site).join(',')}`
  if (node.kind === 'hvdc') return 'hvdc'
  if (node.kind === 'substations') return `substations:${node.substations.map(s => s.siteId).join(',')}`
  return `substation:${node.substation.siteId}`
}

// A single station is matched by its site code, or by its page's slug (see stationPaths)
function resolveNode(param: string, generators: Generator[], substations: Substation[]): SelectedNode {
  if (param === 'hvdc') return { kind: 'hvdc' }
  if (param.startsWith('generator:')) {
    const key = param.slice('generator:'.length)
    const gen = generators.find(g => g.site === key)
      ?? generators.find(g => generatorSlug(g, generators) === key)
      ?? generators.find(g => g.site.toLowerCase() === key)
    return gen ? { kind: 'generator', generator: gen } : null
  }
  if (param.startsWith('generators:')) {
    const sites = param.slice('generators:'.length).split(',')
    const gens = sites.map(s => generators.find(g => g.site === s)).filter(Boolean) as Generator[]
    if (gens.length === 1) return { kind: 'generator', generator: gens[0] }
    return gens.length > 1 ? { kind: 'generators', generators: gens } : null
  }
  if (param.startsWith('substation:')) {
    const key = param.slice('substation:'.length)
    const sub = substations.find(s => s.siteId === key)
      ?? substations.find(s => substationSlug(s, substations) === key)
      ?? substations.find(s => s.siteId.toLowerCase() === key)
    return sub ? { kind: 'substation', substation: sub } : null
  }
  if (param.startsWith('substations:')) {
    const siteIds = param.slice('substations:'.length).split(',')
    const subs = siteIds.map(id => substations.find(s => s.siteId === id)).filter(Boolean) as Substation[]
    if (subs.length === 1) return { kind: 'substation', substation: subs[0] }
    return subs.length > 1 ? { kind: 'substations', substations: subs } : null
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
  // ...and the path it came from stays too
  const [linkedPath, setLinkedPath] = useState(initial.nodePath)
  const [selectedNode, setSelectedNode] = useState<SelectedNode>(null)
  const [dateMode, setDateMode] = useState(initial.dateMode)
  const [viewMode, setViewModeState] = useState(initial.viewMode)
  const [tradingPeriod, setTradingPeriod] = useState(initial.tradingPeriod)
  const [activeFuels, setActiveFuels] = useState(initial.activeFuels)
  const [chartSettings, setChartSettings] = useState(initial.chartSettings)
  const [expanded, setExpanded] = useState(initial.expanded)
  const [pipelineOpen, setPipelineOpen] = useState(initial.pipelineOpen)
  // The generator the URL opened at, once it's found, which the map zooms in on
  // (see Map). Picking another node does away with it, but closing the panel
  // doesn't, as on mobile that's the way to the map.
  const [openedGenerator, setOpenedGenerator] = useState<GeneratorNode | null>(null)

  // Offers opens at the first trading period, unless a link gave one
  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode)
    if (mode === 'generation') setTradingPeriod(1)
  }, [])

  // The Offers view belongs to the generator panel, so goes when it does
  const selectNode = useCallback((node: SelectedNode) => {
    setLinkedNode(null)
    setLinkedPath(null)
    setSelectedNode(node)
    if (node !== null) setOpenedGenerator(null)
    if (node === null || node.kind === 'substation' || node.kind === 'substations' || node.kind === 'hvdc') setViewMode('generation')
  }, [setViewMode])

  useEffect(() => {
    if (linkedNode === null || (generators.length === 0 && substations.length === 0)) return
    const node = resolveNode(linkedNode, generators, substations)
    selectNode(node)
    if (node?.kind === 'generator') setOpenedGenerator(node)
  }, [linkedNode, generators, substations, selectNode])

  // Back from /pipeline closes the pipeline modal
  useEffect(() => {
    const onPopState = () => setPipelineOpen(window.location.pathname === '/pipeline')
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const node = linkedNode ?? (selectedNode && nodeParam(selectedNode))
  const nodePath = linkedNode !== null ? linkedPath : selectedNode && stationPath(selectedNode, generators, substations, dateMode.kind === 'all')
  useEffect(() => {
    writeUrl({ node, nodePath, dateMode, viewMode, tradingPeriod, activeFuels, chartSettings, expanded, pipelineOpen })
  }, [node, nodePath, dateMode, viewMode, tradingPeriod, activeFuels, chartSettings, expanded, pipelineOpen])

  return {
    selectedNode, selectNode, openedGenerator,
    dateMode, setDateMode,
    viewMode, setViewMode,
    tradingPeriod, setTradingPeriod,
    activeFuels, setActiveFuels,
    chartSettings, setChartSettings,
    expanded, setExpanded,
    pipelineOpen, setPipelineOpen,
  }
}
