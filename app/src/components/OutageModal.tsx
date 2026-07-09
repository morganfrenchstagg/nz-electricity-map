import type { OutageRecord } from '../hooks/useOutages'
import { formatMW } from '../utils/format'

interface Props {
  outages: { code: string; label: string; record: OutageRecord; capacityRemaining: number | null }[]
  outageBlockPrefixes: string[]
  onClose: () => void
}

function parseOutageDate(iso: string): Date {
  return new Date(iso.replace(/([+-]\d{2}:\d{2}|Z)$/, '') + 'Z')
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

// `date` is built from outage timestamps via the "local time as UTC" convention
// (see outageMs in NodePanel.tsx), so it must be read back out with timeZone: 'UTC'
// to get the raw values the API sent — 'Pacific/Auckland' would shift them again.
function formatDateTime(date: Date): string {
  return date.toLocaleString('en-NZ', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  fontSize: 11,
  fontWeight: 600,
  color: '#888',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  borderBottom: '1px solid #eee',
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  background: 'white',
}

const tdStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: 13,
  borderBottom: '1px solid #f0f0f0',
  whiteSpace: 'nowrap',
}

export default function OutageModal({ outages, outageBlockPrefixes, onClose }: Props) {
  const now = Date.now()
  const sorted = outages
    .slice()
    .sort((a, b) => parseOutageDate(a.record.timeStart).getTime() - parseOutageDate(b.record.timeStart).getTime())

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'white', borderRadius: 10, boxShadow: '0 8px 40px rgba(0,0,0,0.2)', width: 'fit-content', maxWidth: '92vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>Outages</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {outageBlockPrefixes.length > 0 && (
              <a
                href={pocpUrl(outageBlockPrefixes)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12, color: '#3b82f6', fontWeight: 600, textDecoration: 'none' }}
              >
                View in POCP ↗
              </a>
            )}
            <button
              onClick={onClose}
              aria-label="Close"
              style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: '#666', padding: 4, lineHeight: 1 }}
            >
              ✕
            </button>
          </div>
        </div>
        {sorted.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#999', fontSize: 13 }}>No outages</div>
        ) : (
          <div style={{ overflow: 'auto', flex: 1 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Unit</th>
                  <th style={thStyle}>Outage</th>
                  <th style={thStyle}>Capacity remaining</th>
                  <th style={thStyle}>Start</th>
                  <th style={thStyle}>End</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(({ code, label, record, capacityRemaining }, i) => {
                  const start = parseOutageDate(record.timeStart)
                  const end = parseOutageDate(record.timeEnd)
                  const isCurrent = start.getTime() <= now && now <= end.getTime()
                  return (
                    <tr key={`${code}-${record.outageBlock}-${i}`}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{label}</td>
                      <td style={{ ...tdStyle, color: '#b91c1c', fontWeight: 600 }}>{formatMW(record.mwattLost)}</td>
                      <td style={tdStyle}>{capacityRemaining !== null ? formatMW(capacityRemaining) : '—'}</td>
                      <td style={{ ...tdStyle, color: '#666' }}>{formatDateTime(start)}</td>
                      <td style={{ ...tdStyle, color: '#666' }}>{formatDateTime(end)}</td>
                      <td style={tdStyle}>
                        {isCurrent && (
                          <span style={{
                            background: '#fee2e2',
                            color: '#b91c1c',
                            borderRadius: 4,
                            padding: '1px 6px',
                            fontSize: 11,
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
