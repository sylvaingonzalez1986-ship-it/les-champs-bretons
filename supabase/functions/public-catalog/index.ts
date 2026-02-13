import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { getCorsHeaders, isOriginAllowed } from '../_shared/cors.ts';
import { publicCatalogSchema } from '../_shared/validation.ts';
import { checkRateLimit, createRateLimitResponse, RATE_LIMIT_PRESETS } from '../_shared/rate-limit.ts';

function jsonResponse(payload: unknown, status = 200, corsHeaders: Record<string, string>): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { ...corsHeaders, 'Content-Type': 'application/json' },
	});
}

function getClientIp(req: Request): string {
	return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
		|| req.headers.get('x-real-ip')
		|| 'public';
}

function buildInputFromQuery(url: URL): Record<string, unknown> {
	const action = url.searchParams.get('action') || '';
	const limit = url.searchParams.get('limit') ?? undefined;
	const offset = url.searchParams.get('offset') ?? undefined;
	const producerId = url.searchParams.get('producerId') ?? undefined;

	if (action === 'productsByProducer') {
		return { action, producerId, limit, offset };
	}

	return { action, limit, offset };
}

function createServiceClient() {
	const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
	const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
	return createClient(supabaseUrl, serviceKey);
}

serve(async (req) => {
	const responseCorsHeaders = getCorsHeaders(req);
	const origin = req.headers.get('origin');

	if (!isOriginAllowed(origin)) {
		return jsonResponse({ error: 'CORS_NOT_ALLOWED' }, 403, responseCorsHeaders);
	}

	if (req.method === 'OPTIONS') {
		return new Response('ok', { headers: responseCorsHeaders });
	}

	if (req.method !== 'GET') {
		return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405, responseCorsHeaders);
	}

	const rateLimitKey = getClientIp(req);
	const rateLimitResult = await checkRateLimit(rateLimitKey, RATE_LIMIT_PRESETS.GENERAL);
	if (!rateLimitResult.allowed) {
		return createRateLimitResponse(rateLimitResult, RATE_LIMIT_PRESETS.GENERAL, responseCorsHeaders);
	}

	const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
	const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
	if (!supabaseUrl || !serviceKey) {
		return jsonResponse({ error: 'CONFIG_ERROR' }, 500, responseCorsHeaders);
	}

	const url = new URL(req.url);
	const input = buildInputFromQuery(url);
	const parsed = publicCatalogSchema.safeParse(input);
	if (!parsed.success) {
		return jsonResponse({ error: 'VALIDATION_ERROR' }, 400, responseCorsHeaders);
	}

	const serviceClient = createServiceClient();

	if (parsed.data.action === 'producers') {
		const { limit, offset } = parsed.data;
		const rangeStart = offset;
		const rangeEnd = offset + limit - 1;

		const { data, error } = await serviceClient
			.from('producers_catalog')
			.select('id,name,city,region,department,image,vente_directe_ferme,adresse_retrait,horaires_retrait,instructions_retrait,shipping_enabled,shipping_fee,shipping_note,soil_type,climate_type,culture_outdoor,culture_greenhouse,culture_indoor,profile_id,products')
			.order('name', { ascending: true })
			.range(rangeStart, rangeEnd);

		if (error) {
			return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
		}

		const rows = Array.isArray(data) ? data : [];

		const producers = rows
			.map((row) => {
				const products = Array.isArray(row.products) ? row.products : [];
				const directProducts = products.filter((product) =>
					product?.status === 'published'
					&& product?.visible_for_clients === true
					&& product?.disponible_vente_directe === true
				);

				return {
					id: row.id,
					name: row.name,
					city: row.city,
					region: row.region,
					department: row.department,
					image: row.image,
					vente_directe_ferme: row.vente_directe_ferme,
					adresse_retrait: row.adresse_retrait,
					horaires_retrait: row.horaires_retrait,
					instructions_retrait: row.instructions_retrait,
					shipping_enabled: row.shipping_enabled,
					shipping_fee: row.shipping_fee,
					shipping_note: row.shipping_note,
					soil_type: row.soil_type,
					climate_type: row.climate_type,
					culture_outdoor: row.culture_outdoor,
					culture_greenhouse: row.culture_greenhouse,
					culture_indoor: row.culture_indoor,
					profile_id: row.profile_id,
					products: directProducts.map((product) => ({
						id: product.id,
						name: product.name,
						price_public: product.price_public,
						price_pro: product.price_pro ?? null,
						image: product.image,
						description: product.description,
						disponible_vente_directe: product.disponible_vente_directe,
						stock: product.stock ?? null,
						price_tiers: product.price_tiers ?? null,
					})),
				};
			})
			.filter((producer) => producer.vente_directe_ferme && producer.products.length > 0);

		return jsonResponse({
			producers,
			hasMore: rows.length === limit,
		}, 200, responseCorsHeaders);
	}

	if (parsed.data.action === 'productsByProducer') {
		const { producerId, limit, offset } = parsed.data;
		const rangeStart = offset;
		const rangeEnd = offset + limit - 1;

		const { data: producer, error: producerError } = await serviceClient
			.from('producers')
			.select('id,name,city,region,department,image,description,adresse_retrait,horaires_retrait,instructions_retrait,shipping_enabled,shipping_fee,shipping_note')
			.eq('id', producerId)
			.single();

		if (producerError || !producer) {
			return jsonResponse({ error: 'PRODUCER_NOT_FOUND' }, 404, responseCorsHeaders);
		}

		const { data: products, error: productsError } = await serviceClient
			.from('products')
			.select('id,name,price_public,price_pro,image,description,disponible_vente_directe,stock,price_tiers')
			.eq('producer_id', producerId)
			.eq('disponible_vente_directe', true)
			.eq('status', 'published')
			.eq('visible_for_clients', true)
			.order('name', { ascending: true })
			.range(rangeStart, rangeEnd);

		if (productsError) {
			return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
		}

		const list = Array.isArray(products) ? products : [];

		return jsonResponse({
			producer,
			products: list,
			hasMore: list.length === limit,
		}, 200, responseCorsHeaders);
	}

	return jsonResponse({ error: 'INVALID_ACTION' }, 400, responseCorsHeaders);
});
