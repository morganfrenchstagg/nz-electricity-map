import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { CC_BY_URL, EMI, LINZ, TRANSPOWER } from '../attribution'

const FRONTEND_SOURCE_URL = 'https://github.com/morganfrenchstagg/nz-electricity-map'
const BACKEND_SOURCE_URL = 'https://github.com/morganfrenchstagg/nz-electricity-stats-api'
const LINKEDIN_URL = 'https://www.linkedin.com/in/morganfrenchstagg'

function Link({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent)' }}>{children}</a>
}

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="info-section">
      <h2 className="eyebrow">{heading}</h2>
      {children}
    </section>
  )
}

const ccBy = <Link href={CC_BY_URL}>CC BY 4.0</Link>

// What the site is, where its data comes from, and the licence and disclaimer
// that go with it. Opened from the About this site button in every Panel's header.
export default function InfoModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div onClick={onClose} className="modal-backdrop" style={{ padding: 'var(--space-xl)' }}>
      <div onClick={e => e.stopPropagation()} className="modal" role="dialog" aria-labelledby="info-modal-title" style={{ width: '100%', maxWidth: 600, maxHeight: '85vh' }}>
        <div className="section section--header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div id="info-modal-title" className="title">About NZ Electricity Map</div>
          </div>
          <button onClick={onClose} className="button-secondary">
            Close
          </button>
        </div>

        <div style={{ overflow: 'auto', padding: 'var(--space-xl)' }}>
          <Section heading="About">
            <p>
              NZ Electricity Map aims to present electricity industry data in an accessible way, to help
              better inform the public about how the energy we use is generated.
            </p>
            <p>
              This is an independent project. The source code is available on GitHub
              (<Link href={FRONTEND_SOURCE_URL}>Frontend</Link>, <Link href={BACKEND_SOURCE_URL}>Backend</Link>).
            </p>
            <p>
              Created by <Link href={LINKEDIN_URL}>Morgan French-Stagg</Link>, with help from Jack Gibbons.
            </p>
          </Section>

          <Section heading="Data sources">
            <ul>
              <li>
                Generation, prices and offers: the Electricity Authority's <Link href="https://www.emi.ea.govt.nz">Electricity Market Information (EMI)</Link> real-time
                dispatch API, nodal prices and volumes, and bids and offers data.
              </li>
              <li>Outages: Transpower's <Link href="https://customerportal.transpower.co.nz/pocp/outages">Planned Outage Coordination Process (POCP)</Link>.</li>
              <li>Transmission lines: Transpower's <Link href="https://data-transpower.opendata.arcgis.com/">open data</Link>.</li>
              <li>
                Base map: <Link href="https://openfreemap.org">OpenFreeMap</Link>, © <Link href="https://www.openmaptiles.org/">OpenMapTiles</Link>, data
                from <Link href="https://www.openstreetmap.org/copyright">OpenStreetMap</Link> contributors.
              </li>
              <li>Aerial imagery: <Link href="https://basemaps.linz.govt.nz">LINZ Basemaps</Link>.</li>
              <li>Generation pipeline: compiled for this site from public sources.</li>
            </ul>
          </Section>

          <Section heading="Licensing">
            <ul>
              <li>Electricity market data: © <Link href={EMI.url}>{EMI.name}</Link>, licensed under {ccBy}.</li>
              <li>Transmission lines: © <Link href={TRANSPOWER.url}>{TRANSPOWER.name}</Link>, licensed under {ccBy}.</li>
              <li>
                Aerial imagery: © <Link href={LINZ.url}>{LINZ.name}</Link>, licensed
                under {ccBy}.
              </li>
              <li>
                Map data: © <Link href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</Link>, available under
                the <Link href="https://opendatacommons.org/licenses/odbl/">Open Database License</Link>.
              </li>
            </ul>
          </Section>

          <Section heading="Disclaimer">
            <p>
              This site isn't affiliated with or endorsed by the Electricity Authority, Transpower or any other
              data provider. Data is shown as is and may be delayed, incomplete or wrong, so don't rely on it for
              operational, trading or other decisions.
            </p>
          </Section>
        </div>
      </div>
    </div>
  )
}
