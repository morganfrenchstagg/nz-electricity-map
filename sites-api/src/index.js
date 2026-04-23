/**
 * NZ Electricity Map - Offers API
 * Serves offer data from S3
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
			// If date not provided (or not found), returns latest available day
			if (url.pathname === '/v1/offers/date') {
				const s3Base = env.S3_BUCKET_URL;

				const metaResp = await fetch(`${s3Base}/offers/metadata.json`);
				if (!metaResp.ok) {
					return Response.json({ error: 'Offers metadata unavailable' }, { status: 503, headers: corsHeaders });
				}
				const metadata = await metaResp.json();

				const sortedDates = Object.keys(metadata).sort();
				if (sortedDates.length === 0) {
					return Response.json({ error: 'No offer data available' }, { status: 404, headers: corsHeaders });
				}
				const latestDate = sortedDates[sortedDates.length - 1];

				const requestedDate = url.searchParams.get('date');
				const targetDate = (requestedDate && metadata[requestedDate]) ? requestedDate : latestDate;

				const dataResp = await fetch(`${s3Base}/offers/${targetDate}.json`);
				if (!dataResp.ok) {
					return Response.json({ error: 'Offer data not found' }, { status: 404, headers: corsHeaders });
				}
				const data = await dataResp.json();

				return Response.json(data, { headers: corsHeaders });
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
