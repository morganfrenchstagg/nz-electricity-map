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

### Distributed solar

The generation chart adds an estimate of distributed (rooftop and other undispatched) solar, as a fuel of its own, from [nz-solar-stats-api](https://github.com/morganfrenchstagg/nz-solar-stats-api)'s `/solar-production/{date}`. It uses the production deployment by default. To use another, such as a local copy, set `VITE_SOLAR_API_BASE` to its root URL:

```
VITE_SOLAR_API_BASE=http://localhost:8787 npm run dev
```

Its weather only reaches back about three months, so it shows on the Today and 3d views and on picked days in the last 92, but not on earlier days or the aggregate views.

## Data

The map shows data from [EMI](https://www.emi.ea.govt.nz) provided by the Electricity Authority (New Zealand) and from [Transpower New Zealand](https://www.transpower.co.nz), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). It's aggregated and reshaped for the map, and neither licensor endorses this site. The app credits them in the panels' About this site modal and behind the map's ⓘ button (see `app/src/attribution.ts`).
