import type { Generator, Substation } from '../types'
import { useAnnualFigures } from '../hooks/useAnnualFigures'
import { generatorsSummary, gwh, ordinal, pct, substationsSummary } from '../utils/annualStats'

// The station's or substation's year in figures, at the foot of its panel:
// the same facts its built page leads its yearly figures with (see
// build/pages.ts), as text, whatever the chart above shows

interface Fact {
  label: string
  value: string
  // After the value, in lighter text
  detail?: string
}

function YearlyFacts({ heading, facts }: { heading: string; facts: Fact[] }) {
  if (facts.length === 0) return null
  return (
    <section className="section yearly-summary" aria-labelledby="yearly-summary-heading">
      <h2 id="yearly-summary-heading" className="eyebrow">{heading}</h2>
      <dl>
        {facts.map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.value}{f.detail && <span> · {f.detail}</span>}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

// Its latest full year, share of the grid's generation and rank then, best
// year and the year so far. Several stations picked together are summed, without a rank.
export function GeneratorYearly({ generators }: { generators: Generator[] }) {
  const figures = useAnnualFigures()
  if (!figures) return null
  const { latest, rank, best, soFar } = generatorsSummary(figures, generators)
  const facts: Fact[] = []
  if (latest) {
    facts.push({ label: `Generated in ${latest.year}`, value: gwh(latest.gwh) })
    facts.push({ label: 'Share of NZ\'s grid', value: pct(latest.share), detail: rank ? (rank === 1 ? 'the most of any station' : `${ordinal(rank)} most`) : undefined })
  }
  if (best) facts.push({ label: `Best year, ${best.year}`, value: gwh(best.gwh) })
  if (soFar) facts.push({ label: `${soFar.year} so far`, value: gwh(soFar.gwh) })
  return <YearlyFacts heading="Generation by year" facts={facts} />
}

// What was taken from the grid there in the latest full year, and its change on ten years before
export function SubstationYearly({ substations }: { substations: Substation[] }) {
  const figures = useAnnualFigures()
  const summary = figures && substationsSummary(figures, substations)
  if (!summary) return null
  const { latest, change } = summary
  const facts: Fact[] = [{ label: `Demand in ${latest.year}`, value: gwh(latest.gwh) }]
  if (change) {
    const same = Math.abs(change.fraction) < 0.005
    facts.push({ label: `Change on ${change.year}`, value: same ? 'About the same' : `${change.fraction > 0 ? 'Up' : 'Down'} ${pct(Math.abs(change.fraction))}` })
  }
  return <YearlyFacts heading="Demand by year" facts={facts} />
}
