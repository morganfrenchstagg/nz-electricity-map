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

## Pages for search engines

The build writes a static page for each station, from the API's `/definitions` (see `app/build/pages.ts`): `/generator/<name>`, `/substation/<name>`, `/hvdc` and `/pipeline`, as well as the home page, each with its own title, description, canonical link and structured data, and its facts as plain HTML inside `#root`, which the app replaces when it starts. It reads the definitions from the API repo's `src/data/generators.json` and `substations.json`, which `/definitions` serves as they are, because Cloudflare's bot protection blocks GitHub's runners from the API itself (with `VITE_API_BASE` set, from that API's `/definitions`). The build fails if it can't fetch them. It also writes `sitemap.xml`. `robots.txt`, `llms.txt`, the icons and the link preview image are in `app/public`.

Station, substation and HVDC pages also give their yearly generation, demand or flows, from the API's `/dispatch/aggregates/annual`, which the build fetches from the API's workers.dev address, outside the bot protection (with `VITE_API_BASE` set, from that API). There are also pages about each fuel (`/fuel/hydro`), each operator with more than one station (`/operator/meridian-energy`), each island (`/island/north-island`) and the grid's renewable share (`/renewable-energy`). Those are pages of their own, without the app, so search engines that run it still index their content (see `app/build/topics.ts`). The build fails if it can't fetch the yearly figures, as with the definitions, so a deploy never replaces the pages with ones that lack them.

The app opens a station's panel at its page, and writes a single station's page into the URL in place of `?node=`. A station added to the API has no page until the next deploy, which runs daily as well as on each push to main.

## Data

The map shows data from [EMI](https://www.emi.ea.govt.nz) provided by the Electricity Authority (New Zealand) and from [Transpower New Zealand](https://www.transpower.co.nz), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). It's aggregated and reshaped for the map, and neither licensor endorses this site. The app credits them in the panels' About this site modal and behind the map's ⓘ button (see `app/src/attribution.ts`).
