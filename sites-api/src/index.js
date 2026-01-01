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
			// GET /v1/offers/unit/:unitCode
			// Example: /v1/offers/unit/TST0
			if (url.pathname.startsWith('/v1/offers/unit/')) {
				const unitCode = url.pathname.split('/').pop();

				const results = await env.OFFERS_DB.prepare(
					'SELECT * FROM offers WHERE Unit = ? ORDER BY TradingDate, TradingPeriod, Tranche LIMIT 100'
				).bind(unitCode).all();

				return Response.json(results.results, { headers: corsHeaders });
			}

			// GET /v1/offers/trading-period?date=2025-12-30&period=1
			if (url.pathname === '/v1/offers/trading-period') {
				const date = url.searchParams.get('date');
				const period = url.searchParams.get('period');

				if (!date || !period) {
					return Response.json({ error: 'Missing date or period parameter' }, { status: 400, headers: corsHeaders });
				}

				const results = await env.OFFERS_DB.prepare(
					'SELECT * FROM offers WHERE TradingDate = ? AND TradingPeriod = ? ORDER BY PointOfConnection, Unit, Tranche'
				).bind(date, parseInt(period)).all();

				return Response.json(results.results, { headers: corsHeaders });
			}

			// GET /v1/offers/poc/:poc
			// Example: /v1/offers/poc/TEST001
			if (url.pathname.startsWith('/v1/offers/poc/')) {
				const poc = url.pathname.split('/').pop();

				const results = await env.OFFERS_DB.prepare(
					'SELECT * FROM offers WHERE PointOfConnection = ? ORDER BY TradingDate, TradingPeriod, Tranche LIMIT 100'
				).bind(poc).all();

				return Response.json(results.results, { headers: corsHeaders });
			}

			// GET /v1/offers/stats - Database stats
			if (url.pathname === '/v1/offers/stats') {
				const count = await env.OFFERS_DB.prepare('SELECT COUNT(*) as count FROM offers').first();
				const latestDate = await env.OFFERS_DB.prepare('SELECT MAX(TradingDate) as latest FROM offers').first();

				return Response.json({
					totalOffers: count.count,
					latestTradingDate: latestDate.latest
				}, { headers: corsHeaders });
			}

			// Default response
			return Response.json({
				message: 'NZ Electricity Map - Offers API',
				endpoints: [
					'GET /v1/offers/unit/:unitCode',
					'GET /v1/offers/trading-period?date=YYYY-MM-DD&period=N',
					'GET /v1/offers/poc/:pointOfConnection',
					'GET /v1/offers/stats'
				]
			}, { headers: corsHeaders });

		} catch (error) {
			return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
		}
	},
};
