# nz-electricity-map

## Backend

Running locally:

```
cd app
npm run dev

```

The app uses the production API by default. To use another, such as a local copy of [nz-electricity-stats-api](https://github.com/morganfrenchstagg/nz-electricity-stats-api) or a branch's preview deployment, set `VITE_API_BASE` to its `/v1` URL:

```
VITE_API_BASE=http://localhost:8787/v1 npm run dev
```

Or put it in `app/.env.local` (gitignored) to keep it set. A local `wrangler dev` starts with no dispatch data, so a branch's preview deployment, which reads the real data, is often more useful.

### Embedded solar

The generation chart adds an estimate of embedded (rooftop and other undispatched, also called distributed) solar, as a fuel of its own, Embedded Solar (est.), from [nz-solar-stats-api](https://github.com/morganfrenchstagg/nz-solar-stats-api)'s `/solar-production/{date}`. It uses the production deployment by default. To use another, such as a local copy, set `VITE_SOLAR_API_BASE` to its root URL:

```
VITE_SOLAR_API_BASE=http://localhost:8787 npm run dev
```

The aggregate views (90d, 1y, 5y and All) take its daily, weekly, monthly and annual totals from `/solar-energy`, with quarters summed from months. The API is still backfilling them, so a period it has only some days for is charted from those.

The API 404s for a day or period it has no estimate for, so the app first checks how far its estimates reach (`/solar-energy`) and only asks for the past days and totals within that, e.g. none from before July 2015. Today's estimate is asked for without checking, from 2 minutes past midnight, once the API's first run of the day has stored it (see `solarHasDay` in `app/src/api.ts`). Its totals stop at yesterday, so the period so far adds today's `/solar-production` estimate, summed over each 5-minute interval up to now, as the dispatch totals are.

A view's data waits up to 2 seconds for its estimate (`SOLAR_WAIT_MS` in `app/src/hooks/useDistributedSolar.ts`), so the estimate is charted with the rest rather than a moment after it, e.g. when the dispatch data comes from the browser's cache. Meanwhile the last chart stays up. A slower estimate is added when it comes.

The substation panel's estimate, and its dashed line of the substation's demand with the estimate added back, are behind a feature flag for now. Add `substationSolar=true` to the URL's query to show them (see `app/src/featureFlags.ts`). The API estimates from satellite readings up to each day's `observedUntil`, and from the forecast after it, which at a single GXP is too rough to show. So on the 5-minute views the panel's lines stop at the newest reading. Before that, they only skip forecasts of some sun: each day's readings stop around sunset, and the night after is forecast as none. On the aggregate views, the period so far adds today's estimate only up to the newest reading too, and its tooltip says when that was.

### Power flow

The map's Power flow toggle shows an estimate of the flow along each transmission line at the newest interval: each line thicker the more it carries, the HVDC too, with a chevron the way it's flowing. Hovering a line gives its MW, and where it's flowing from and to, with any others running close beside it, and the HVDC's flow where it's one of them.

Nothing publishes the lines' flows, so they're estimated from what each substation puts into the grid or takes out of it (its generation less its load), with a DC power flow (`app/src/utils/lineFlows.ts`). The HVDC's flow comes out of the South Island at Benmore and goes into the North Island at Haywards, and each island's losses are spread over its load. The network is pieced together in the browser from the transmission lines' map data, which doesn't say what connects to what, from where the lines run near the substations and one another (`app/src/utils/gridNetwork.ts`). It leaves out the lines run open to steer the flow, the substations' transformers and the distributors' networks, so it's only a rough guide.

## Data

The map shows data from [EMI](https://www.emi.ea.govt.nz) provided by the Electricity Authority (New Zealand) and from [Transpower New Zealand](https://www.transpower.co.nz), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). It's aggregated and reshaped for the map, and neither licensor endorses this site. The app credits them in the panels' About this site modal and behind the map's ⓘ button (see `app/src/attribution.ts`).
