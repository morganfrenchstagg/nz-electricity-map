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

### Checks

CI runs these on every PR, and again before deploying `main`:

```
cd app
npm run lint
npm run format:check   # `npm run format` fixes it
npm test
npm run build          # type-checks too
```

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

The build writes a static page for each station, from the API's `/definitions` (see `app/build/pages.ts`): `/generator/<name>`, each generator's history at `/generator/<name>/historic`, `/substation/<name>`, `/hvdc` and `/pipeline`, as well as the home page, each with its own title, description, canonical link and structured data, and its facts as plain HTML inside `#root`, which the app replaces when it starts. It reads the definitions from the API repo's `src/data/generators.json` and `substations.json`, which `/definitions` serves as they are, because Cloudflare's bot protection blocks GitHub's runners from the API itself (with `VITE_API_BASE` set, from that API's `/definitions`). The build fails if it can't fetch them. It also writes `sitemap.xml`. `robots.txt`, `llms.txt`, the icons and the link preview image are in `app/public`.

Each page is also written as Markdown, for AI agents (see `app/build/markdown.ts`), at its path with `.md` on the end (`/index.md` for the home page), and linked from its head. Every page's Markdown also links the MCP server's and the API's docs (`AGENT_DATA` in `app/build/html.ts`, which the home page has in its HTML too), and a station's pages' say that its generation is there every 5 minutes and day by day, with the MCP tools' and API routes' calls that get it (`stationData` in `app/build/pages.ts`). A live station's page's Markdown has its generation so far today too, which the middleware fills in as it serves it, at the page's address or its `.md`, from the MCP server's `get_day_profile`, kept for a minute (see `app/edge/today.ts`). Until then, or if the API can't be reached, it says where to get it. A request for the page itself whose `Accept` header prefers `text/markdown` gets the Markdown, with `Vary: Accept` and an estimate of its tokens in `X-Markdown-Tokens`, from a Pages Functions middleware (`functions/_middleware.ts`, which runs `app/edge/markdown.ts`). Browsers get the HTML. `frontend/_routes.json` runs the middleware for the pages' paths only, so their assets don't count towards Functions' requests. Add a new kind of page's path there. To try it locally, build and then run `npx wrangler pages dev frontend` from the repository's root, and `curl -H 'Accept: text/markdown'` a page.

The API serves the MCP server at `https://api.electricitymap.frenchsta.gg/mcp`, but its [server card](https://github.com/modelcontextprotocol/ext-server-card), which tells agents where it is, is on this site, at `/.well-known/mcp/server-card.json` (in `app/public`, with its headers in `frontend/_headers`). It repeats what the server says about itself, so update it when the API changes the server's name, version, address or capabilities (its `createMcpServer`). It has the spec's fields (`name`, `version`, `remotes`, …) and also `serverInfo`, `transport` and `capabilities`, from the spec's earlier draft, which scanners such as isitagentready.com still check for.

The site's [API catalog](https://www.rfc-editor.org/rfc/rfc9727), at `/.well-known/api-catalog`, lists the API, with its OpenAPI document (`/openapi.json`), docs (`/docs`), health check (`/ping`) and attribution (`/v1/attribution`), and the MCP server, with its server card, so agents can find them. It's in `app/public` too, as JSON in a file without an extension, so `frontend/_headers` sets its `Content-Type` (`application/linkset+json`) and the `Link` header the RFC asks for. The home page's `Link` header points at the catalog too, and at the OpenAPI document, the docs and `llms.txt`. Update both when the API moves any of those routes.

Station, substation and HVDC pages also give their yearly generation, demand or flows, from the API's `/dispatch/aggregates/annual`, and a station's history its generation every month, from `/dispatch/aggregates/{year}/monthly` a year at a time, which the build fetches from the API's workers.dev address, outside the bot protection (with `VITE_API_BASE` set, from that API). There's also an Analysis section (`/analysis`), with pages about each fuel (`/analysis/fuel/hydro`), each operator with more than one station (`/analysis/operator/meridian-energy`), each island (`/analysis/island/north-island`) and the grid's renewable share (`/analysis/renewable-energy`). The grid panel links to it. Those are pages of their own, without the app, so search engines that run it still index their content (see `app/build/topics.ts`). The build fails if it can't fetch the yearly or monthly figures, as with the definitions, so a deploy never replaces the pages with ones that lack them.

The app opens a station's panel at its page, and writes a single station's page into the URL in place of `?node=`. A generator's history opens its panel at All, with its records under the chart (see `app/src/utils/generationRecords.ts`), and a generator shown at All is at its history's path. Opened at a generator's page or its history's, the map starts zoomed in on the station; picking a station on the map or in the panel keeps the zoom. A station added to the API has no page until the next deploy, which runs daily as well as on each push to main.

## Data

The map shows data from [EMI](https://www.emi.ea.govt.nz) provided by the Electricity Authority (New Zealand) and from [Transpower New Zealand](https://www.transpower.co.nz), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). It's aggregated and reshaped for the map, and neither licensor endorses this site. The app credits them in the panels' About this site modal and behind the map's ⓘ button (see `app/src/attribution.ts`).
