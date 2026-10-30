import { Button, Checkbox, Dialog, DialogTrigger, Popover } from 'react-aria-components'
import { CHART_SETTINGS } from '../utils/chartSettings'
import type { ChartSettingKey, ChartSettings } from '../utils/chartSettings'
import { ToggleGroup } from './ToggleGroup'

interface Props {
  settings: ChartSettings
  onChange: (settings: ChartSettings) => void
  // The settings the panel's chart follows, in the order they're listed
  offered: ChartSettingKey[]
}

// A gear button, for the end of a panel's toolbar, that opens a popover of
// choices for how the panel's chart shows its data (see chartSettings). Picking
// one leaves the popover open, so the chart can be seen changing behind it.
export default function ChartSettingsMenu({ settings, onChange, offered }: Props) {
  return (
    <DialogTrigger>
      <Button aria-label="Chart settings" className="icon-button">
        <GearIcon />
      </Button>
      <Popover placement="bottom end" offset={4} className="popover">
        <Dialog aria-label="Chart settings" className="chart-settings">
          {offered.map(key => {
            const setting = CHART_SETTINGS[key]
            const { label, options } = setting
            if ('checkbox' in setting) {
              return (
                <Checkbox
                  key={key}
                  className="checkbox"
                  isSelected={settings[key] === options[1].value}
                  onChange={ticked => onChange({ ...settings, [key]: options[ticked ? 1 : 0].value })}
                >
                  <span className="checkbox-box" aria-hidden="true">✓</span>
                  {label}
                </Checkbox>
              )
            }
            return (
              <div key={key} className="chart-setting">
                <span className="eyebrow">{label}</span>
                <ToggleGroup
                  ariaLabel={label}
                  options={options.map(o => ({
                    key: o.value,
                    label: o.label,
                    active: settings[key] === o.value,
                    onClick: () => onChange({ ...settings, [key]: o.value }),
                  }))}
                />
              </div>
            )
          })}
        </Dialog>
      </Popover>
    </DialogTrigger>
  )
}

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
      <path d="M6.51 3.12L6.72 1.12L9.28 1.12L9.49 3.12A5.1 5.1 0 0 1 10.39 3.5L11.96 2.23L13.77 4.04L12.5 5.61A5.1 5.1 0 0 1 12.88 6.51L14.88 6.72L14.88 9.28L12.88 9.49A5.1 5.1 0 0 1 12.5 10.39L13.77 11.96L11.96 13.77L10.39 12.5A5.1 5.1 0 0 1 9.49 12.88L9.28 14.88L6.72 14.88L6.51 12.88A5.1 5.1 0 0 1 5.61 12.5L4.04 13.77L2.23 11.96L3.5 10.39A5.1 5.1 0 0 1 3.12 9.49L1.12 9.28L1.12 6.72L3.12 6.51A5.1 5.1 0 0 1 3.5 5.61L2.23 4.04L4.04 2.23L5.61 3.5A5.1 5.1 0 0 1 6.51 3.12Z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  )
}
