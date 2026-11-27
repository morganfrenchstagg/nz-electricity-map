import { Button, Checkbox, Dialog, DialogTrigger, Popover } from 'react-aria-components'
import { CHART_SETTINGS } from '../utils/chartSettings'
import type { ChartSettingKey, ChartSettings } from '../utils/chartSettings'
import { ToggleGroup } from './ToggleGroup'
import { Check, Gear } from './icons'

interface Props {
  settings: ChartSettings
  onChange: (settings: ChartSettings) => void
  // The settings this panel's chart follows, in listed order
  offered: ChartSettingKey[]
}

// A gear at the end of a panel's toolbar (see chartSettings). Picking leaves the popover open, so
// the chart can be seen changing behind it.
export default function ChartSettingsMenu({ settings, onChange, offered }: Props) {
  return (
    <DialogTrigger>
      <Button aria-label="Chart settings" className="icon-button">
        <Gear />
      </Button>
      <Popover placement="bottom end" offset={4} className="popover">
        <Dialog aria-label="Chart settings" className="chart-settings">
          {offered.map((key) => {
            const setting = CHART_SETTINGS[key]
            const { label, options } = setting
            if ('checkbox' in setting) {
              return (
                <Checkbox
                  key={key}
                  className="checkbox"
                  isSelected={settings[key] === options[1].value}
                  onChange={(ticked) => onChange({ ...settings, [key]: options[ticked ? 1 : 0].value })}
                >
                  <span className="checkbox-box" aria-hidden="true">
                    <Check size={12} />
                  </span>
                  {label}
                </Checkbox>
              )
            }
            return (
              <div key={key} className="chart-setting">
                <span className="heading-sm">{label}</span>
                <ToggleGroup
                  ariaLabel={label}
                  options={options.map((o) => ({
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
