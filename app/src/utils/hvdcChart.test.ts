import { describe, expect, it } from 'vitest'
import type Highcharts from 'highcharts'
import type { HvdcData } from '../types'
import { hvdcChartOptions } from './hvdcChart'
import { nzLocalMs } from './time'

const series = ['northFlow', 'southFlow', 'northLimit', 'southLimit']

// Flowing north, then easing off to flow south
const hvdc: HvdcData = {
  series,
  data: [
    ['2026-10-28T20:00:00', 600, 0, 1200, -650],
    ['2026-10-28T20:30:00', 300, 0, 1100, -660],
    ['2026-10-28T21:00:00', 0, 300, 1100, -660],
  ],
}

const ms = (time: string) => nzLocalMs(time)
const seriesNamed = (options: Highcharts.Options, name: string) =>
  options.series!.find((s) => s.name === name) as Highcharts.SeriesAreaOptions | Highcharts.SeriesLineOptions
const values = (s: Highcharts.SeriesAreaOptions | Highcharts.SeriesLineOptions) =>
  s.data!.map((point) => (Array.isArray(point) ? point[1] : (point as Highcharts.PointOptionsObject).y))

describe('hvdcChartOptions', () => {
  it('charts the transfer north above zero, and south below it', () => {
    const transfer = seriesNamed(hvdcChartOptions(hvdc)!, 'Transfer')
    expect(transfer.data).toEqual([
      [ms('2026-10-28T20:00:00'), 600],
      [ms('2026-10-28T20:30:00'), 300],
      [ms('2026-10-28T21:00:00'), -300],
    ])
  })

  it('charts the north limit above zero and the south limit below it, as steps', () => {
    const options = hvdcChartOptions(hvdc)!
    expect(values(seriesNamed(options, 'North limit'))).toEqual([1200, 1100, 1100])
    expect(values(seriesNamed(options, 'South limit'))).toEqual([-650, -660, -660])
    expect(seriesNamed(options, 'South limit').step).toBe('left')
  })

  it('labels each limit at its end', () => {
    const labels = (name: string) => (seriesNamed(hvdcChartOptions(hvdc)!, name).data as Highcharts.PointOptionsObject[])
      .map((point) => (point.dataLabels as Highcharts.DataLabelsOptions).enabled && (point.dataLabels as Highcharts.DataLabelsOptions).format)
    expect(labels('North limit')).toEqual([false, false, 'North limit: 1,100 MW'])
    expect(labels('South limit')).toEqual([false, false, 'South limit: 660 MW'])
  })

  it('breaks the line where em6 has a gap of hours', () => {
    const gappy = { series, data: [...hvdc.data, ['2026-10-29T03:00:00', 500, 0, 1200, -650]] }
    const transfer = seriesNamed(hvdcChartOptions(gappy)!, 'Transfer')
    expect(transfer.data).toContainEqual([ms('2026-10-28T21:00:00') + 1, null])
  })

  it('has no chart without flows', () => {
    expect(hvdcChartOptions({ series, data: [] })).toBeNull()
    expect(hvdcChartOptions({ series, data: [['2026-10-28T20:00:00', null, null, 1200, -650]] })).toBeNull()
  })
})
