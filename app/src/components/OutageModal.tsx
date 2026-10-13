import type { OutageRecord } from '../api'
import { formatMW } from '../utils/format'
import { outageMs } from '../utils/time'

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

// `ms` is an outage timestamp in the "local time as UTC" convention (see outageMs
// in utils/time.ts), so it must be read back out with timeZone: 'UTC' to get the
// raw values the API sent — 'Pacific/Auckland' would shift them again.
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
  const now = Date.now()
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
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-accent)', fontWeight: 600, textDecoration: 'none' }}
              >
                View in POCP ↗
              </a>
            )}
            <button
              onClick={onClose}
              aria-label="Close"
              style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 'var(--font-size-lg)', color: 'var(--color-text-secondary)', padding: 'var(--space-xs)', lineHeight: 1 }}
            >
              ✕
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
                  <th className="eyebrow" style={thStyle}>Unit</th>
                  <th className="eyebrow" style={thStyle}>Outage</th>
                  <th className="eyebrow" style={thStyle}>Capacity remaining</th>
                  <th className="eyebrow" style={thStyle}>Start</th>
                  <th className="eyebrow" style={thStyle}>End</th>
                  <th className="eyebrow" style={thStyle}>Status</th>
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
