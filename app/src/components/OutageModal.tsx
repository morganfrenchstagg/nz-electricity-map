import type { OutageRecord } from '../api'
import { formatMW } from '../utils/format'
import { nzNowMs, outageMs } from '../utils/time'
import { ExternalLink } from './icons'

interface Props {
  outages: { code: string; label: string; record: OutageRecord; capacityRemaining: number | null }[]
  outageBlockPrefixes: string[]
  onClose: () => void
}

function pocpUrl(prefixes: string[]): string {
  const filter = { dateOption: 'relative', nextUnit: 'weeks', nextCount: 4, q: prefixes.join(',') }
  const params = new URLSearchParams({
    displayedFilters: '{}',
    filter: JSON.stringify(filter),
    order: 'ASC',
    page: '1',
    perPage: '10',
    sort: 'timeStart',
  })
  return `https://customerportal.transpower.co.nz/pocp/outages?${params.toString()}`
}

// `ms` is in the "local time as UTC" convention (see outageMs), so format with timeZone 'UTC' to
// get the API's values back; 'Pacific/Auckland' would shift them again.
function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('en-NZ', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  borderBottom: '1px solid var(--color-divider)',
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  background: 'var(--color-surface)',
}

const tdStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--color-divider-subtle)',
  whiteSpace: 'nowrap',
}

export default function OutageModal({ outages, outageBlockPrefixes, onClose }: Props) {
  const now = nzNowMs()
  const sorted = outages
    .slice()
    .sort((a, b) => outageMs(a.record.timeStart) - outageMs(b.record.timeStart))

  return (
    <div onClick={onClose} className="modal-backdrop">
      <div onClick={e => e.stopPropagation()} className="modal" style={{ width: 'fit-content', maxWidth: '92vw', maxHeight: '80vh' }}>
        <div className="section section--header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span className="title">Outages</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {outageBlockPrefixes.length > 0 && (
              <a
                href={pocpUrl(outageBlockPrefixes)}
                target="_blank"
                rel="noopener noreferrer"
                className="link"
                style={{ fontSize: 'var(--font-size-sm)', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-xs)' }}
              >
                View in POCP <ExternalLink size={12} />
              </a>
            )}
            <button onClick={onClose} className="button-secondary">
              Close
            </button>
          </div>
        </div>
        {sorted.length === 0 ? (
          <div className="empty-state">No outages</div>
        ) : (
          <div style={{ overflow: 'auto', flex: 1 }}>
            <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th className="heading-sm" style={thStyle}>Unit</th>
                  <th className="heading-sm" style={thStyle}>Outage</th>
                  <th className="heading-sm" style={thStyle}>Capacity remaining</th>
                  <th className="heading-sm" style={thStyle}>Start</th>
                  <th className="heading-sm" style={thStyle}>End</th>
                  <th className="heading-sm" style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(({ code, label, record, capacityRemaining }, i) => {
                  const start = outageMs(record.timeStart)
                  const end = outageMs(record.timeEnd)
                  const isCurrent = start <= now && now <= end
                  return (
                    <tr key={`${code}-${record.outageBlock}-${i}`}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{label}</td>
                      <td style={{ ...tdStyle, color: 'var(--color-danger)', fontWeight: 600 }}>{formatMW(record.mwattLost)}</td>
                      <td style={tdStyle}>{capacityRemaining !== null ? formatMW(capacityRemaining) : '—'}</td>
                      <td style={{ ...tdStyle, color: 'var(--color-text-secondary)' }}>{formatDateTime(start)}</td>
                      <td style={{ ...tdStyle, color: 'var(--color-text-secondary)' }}>{formatDateTime(end)}</td>
                      <td style={tdStyle}>
                        {isCurrent && (
                          <span style={{
                            background: 'var(--color-danger-subtle)',
                            color: 'var(--color-danger)',
                            borderRadius: 4,
                            padding: '1px var(--space-sm)',
                            fontSize: 'var(--font-size-xs)',
                            fontWeight: 600,
                          }}>
                            Ongoing
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
