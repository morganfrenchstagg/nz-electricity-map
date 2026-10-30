import { describe, expect, it } from 'vitest'
import { DEFAULT_CHART_SETTINGS, readChartSettings, writeChartSettings } from './chartSettings'

describe('readChartSettings', () => {
  it('reads a setting from its param', () => {
    expect(readChartSettings(new URLSearchParams('chart=line'))).toEqual({ chartType: 'line' })
    expect(readChartSettings(new URLSearchParams('chart=proportion'))).toEqual({ chartType: 'proportion' })
  })

  it('defaults a setting the link leaves out', () => {
    expect(readChartSettings(new URLSearchParams('mode=today'))).toEqual(DEFAULT_CHART_SETTINGS)
  })

  it('defaults a setting given a value that is not one of its options', () => {
    expect(readChartSettings(new URLSearchParams('chart=pie'))).toEqual(DEFAULT_CHART_SETTINGS)
  })
})

describe('writeChartSettings', () => {
  it('writes a setting that is not its default', () => {
    const params = new URLSearchParams()
    writeChartSettings({ chartType: 'line' }, params)
    expect(params.toString()).toBe('chart=line')
  })

  it('leaves out a setting that is its default', () => {
    const params = new URLSearchParams()
    writeChartSettings(DEFAULT_CHART_SETTINGS, params)
    expect(params.toString()).toBe('')
  })

  it('reads back what it writes', () => {
    const params = new URLSearchParams()
    writeChartSettings({ chartType: 'line' }, params)
    expect(readChartSettings(params)).toEqual({ chartType: 'line' })
  })
})
