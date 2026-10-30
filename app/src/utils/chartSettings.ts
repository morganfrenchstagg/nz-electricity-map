// How a chart shows its data, as picked from ChartSettingsMenu's gear. Each
// setting is a choice of options, the first its default, and is kept in a
// link under its param while it isn't the default (see useUrlState). To add
// one, add it here, list it in the ChartSettingsMenu of each panel whose chart
// follows it, and have those charts read it from ChartSettings.

interface ChartSettingOption {
  value: string
  label: string
}

interface ChartSettingDefinition {
  // The setting's heading in the menu, or its checkbox's label
  label: string
  param: string
  // The first is the default
  options: readonly ChartSettingOption[]
  // A setting of two options shown as a checkbox, ticked for the second,
  // rather than as a toggle of both
  checkbox?: true
}

export const CHART_SETTINGS = {
  // Each series stacked on the ones below it, a line of its own from zero, or
  // its share of their total, stacked up to 100%
  chartType: {
    label: 'Chart type',
    param: 'chart',
    options: [
      { value: 'stacked', label: 'Stacked' },
      { value: 'line', label: 'Line' },
      { value: 'proportion', label: 'Proportion' },
    ],
  },
  // Embedded solar charted as a series of its own beside grid-scale solar, or
  // the two as one Solar series
  solar: {
    label: 'Combine distributed and grid-scale solar',
    param: 'solar',
    checkbox: true,
    options: [
      { value: 'separate', label: 'Separate' },
      { value: 'combined', label: 'Combined' },
    ],
  },
} as const satisfies Record<string, ChartSettingDefinition>

export type ChartSettingKey = keyof typeof CHART_SETTINGS

export type ChartSettings = { [K in ChartSettingKey]: (typeof CHART_SETTINGS)[K]['options'][number]['value'] }

const KEYS = Object.keys(CHART_SETTINGS) as ChartSettingKey[]

export const CHART_SETTING_PARAMS = KEYS.map(key => CHART_SETTINGS[key].param)

export const DEFAULT_CHART_SETTINGS = Object.fromEntries(
  KEYS.map(key => [key, CHART_SETTINGS[key].options[0].value]),
) as ChartSettings

// The settings in a link's params. One it leaves out, or gives a value that
// isn't one of the setting's options, is its default.
export function readChartSettings(params: URLSearchParams): ChartSettings {
  return Object.fromEntries(KEYS.map(key => {
    const { param, options } = CHART_SETTINGS[key]
    const value = params.get(param)
    return [key, (options.find(o => o.value === value) ?? options[0]).value]
  })) as ChartSettings
}

// Sets the param of each setting that isn't its default
export function writeChartSettings(settings: ChartSettings, params: URLSearchParams) {
  for (const key of KEYS) {
    if (settings[key] !== DEFAULT_CHART_SETTINGS[key]) params.set(CHART_SETTINGS[key].param, settings[key])
  }
}
