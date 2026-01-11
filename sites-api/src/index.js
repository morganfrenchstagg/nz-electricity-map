/**
 * NZ Electricity Map - Offers API
 * Serves offer data from D1 database
 */

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);

		// CORS headers
		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
		};

		// Handle CORS preflight
		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		try {
			// GET /v1/offers/date?date=2025-12-30
			// Example: /v1/offers/date?date=2025-12-30
			// If date not provided, returns latest available day
			if (url.pathname === '/v1/offers/date') {
				let date = url.searchParams.get('date');

				if (date) {
					const result = await env.OFFERS_DB.prepare(
						'SELECT EXISTS(SELECT 1 FROM offers WHERE TradingDate = ?)'
					).bind(date).first();

					if (!result.exists) {
						const latestDateResult = await env.OFFERS_DB.prepare(
							'SELECT MAX(TradingDate) as latest FROM offers'
						).first();
						date = latestDateResult.latest;
					}
				} else {
					const latestDateResult = await env.OFFERS_DB.prepare(
						'SELECT MAX(TradingDate) as latest FROM offers'
					).first();
					date = latestDateResult.latest;
				}

				const results = await env.OFFERS_DB.prepare(
					'SELECT TradingPeriod, Site, Unit, Tranche, Megawatts, DollarsPerMegawattHour FROM offers WHERE TradingDate = ? ORDER BY TradingPeriod, Site, Unit, Tranche'
				).bind(date).all();

				// Transform to grouped format: { timestamp: [{ site, unit, tranches: [...] }] }
				const grouped = {};

				for (const row of results.results) {
					// Convert trading period (1-48) to timestamp
					// Period 1 = 00:00-00:30, Period 2 = 00:30-01:00, etc.
					const periodStart = (row.TradingPeriod - 1) * 30;
					const hours = Math.floor(periodStart / 60);
					const minutes = periodStart % 60;
					const timestamp = `${date}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;

					// Initialize timestamp group if needed
					if (!grouped[timestamp]) {
						grouped[timestamp] = [];
					}

					// Find or create site/unit entry
					let siteEntry = grouped[timestamp].find(s => s.site === row.Site && s.unit === row.Unit);
					if (!siteEntry) {
						siteEntry = {
							site: row.Site,
							unit: row.Unit,
							tranches: []
						};
						grouped[timestamp].push(siteEntry);
					}

					// Add tranche
					siteEntry.tranches.push({
						tranche: row.Tranche,
						megawatts: row.Megawatts,
						price: row.DollarsPerMegawattHour
					});
				}

				return Response.json(grouped, { headers: corsHeaders });
			}

			// Default response
			return Response.json({
				message: 'NZ Electricity Map - Offers API',
				endpoints: [
					'GET /v1/offers/date?date=YYYY-MM-DD (optional)',
				]
			}, { headers: corsHeaders });

		} catch (error) {
			return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
		}
	},
};
