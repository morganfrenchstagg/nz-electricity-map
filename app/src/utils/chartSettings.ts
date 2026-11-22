// Picked from ChartSettingsMenu's gear. Each setting's first option is its default, and it's kept
// in the URL under its param only when not the default (see useUrlState). To add one, add it here,
// list it in the ChartSettingsMenu of each panel it applies to, and read it from ChartSettings.

interface ChartSettingOption {
  value: string
  label: string
}

interface ChartSettingDefinition {
  // Menu heading, or the checkbox's label
  label: string
  param: string
  // The first is the default
  options: readonly ChartSettingOption[]
  // Two options shown as a checkbox, ticked for the second, instead of a toggle
  checkbox?: true
}

export const CHART_SETTINGS = {
  // Stacked, a line each from zero, or each series' share stacked to 100%
  chartType: {
    label: 'Chart type',
    param: 'chart',
    options: [
      { value: 'stacked', label: 'Stacked' },
      { value: 'line', label: 'Line' },
      { value: 'proportion', label: 'Proportion' },
    ],
  },
  // Embedded solar beside grid-scale solar, or both as one Solar series
  solar: {
    label: 'Combine distributed and grid-scale solar',
    param: 'solar',
    checkbox: true,
    options: [
      { value: 'separate', label: 'Separate' },
      { value: 'combined', label: 'Combined' },
    ],
  },
  // Gas, coal and diesel apart, or as one Fossil fuels series
  fossil: {
    label: 'Combine fossil fuels',
    param: 'fossil',
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

// A missing or unknown value falls back to the default
export function readChartSettings(params: URLSearchParams): ChartSettings {
  return Object.fromEntries(KEYS.map(key => {
    const { param, options } = CHART_SETTINGS[key]
    const value = params.get(param)
    return [key, (options.find(o => o.value === value) ?? options[0]).value]
  })) as ChartSettings
}

export function writeChartSettings(settings: ChartSettings, params: URLSearchParams) {
  for (const key of KEYS) {
    if (settings[key] !== DEFAULT_CHART_SETTINGS[key]) params.set(CHART_SETTINGS[key].param, settings[key])
  }
}
