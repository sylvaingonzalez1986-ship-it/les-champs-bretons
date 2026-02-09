import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { getCorsHeaders, isOriginAllowed } from '../_shared/cors.ts';
import {
  checkRateLimit,
  createRateLimitResponse,
  logSecurityEvent,
  RATE_LIMIT_PRESETS,
} from '../_shared/rate-limit.ts';

const categoryInsertSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional().nullable(),
  color: z.string().trim().max(20).optional().nullable(),
  sort_order: z.number().int().optional(),
  active: z.boolean().optional(),
});

const categoryUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  color: z.string().trim().max(20).optional().nullable(),
  sort_order: z.number().int().optional(),
  active: z.boolean().optional(),
});

const resourceInsertSchema = z.object({
  category_id: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  logo_url: z.string().trim().url().optional().nullable(),
  website_url: z.string().trim().url().optional().nullable(),
  email: z.string().trim().email().optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  region: z.string().trim().max(120).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(50)).optional().nullable(),
  featured: z.boolean().optional(),
  active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

const resourceUpdateSchema = z.object({
  id: z.string().min(1),
  category_id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  logo_url: z.string().trim().url().optional().nullable(),
  website_url: z.string().trim().url().optional().nullable(),
  email: z.string().trim().email().optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  region: z.string().trim().max(120).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(50)).optional().nullable(),
  featured: z.boolean().optional(),
  active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

function jsonResponse(payload: unknown, status = 200, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function enforceRateLimit(req: Request, userId: string): Promise<Response | null> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  const userAgent = req.headers.get('user-agent') || 'unknown';
  const rateLimitResult = await checkRateLimit(userId, RATE_LIMIT_PRESETS.GENERAL);

  if (!rateLimitResult.allowed) {
    logSecurityEvent({
      userId,
      action: 'rate_limit_exceeded',
      endpoint: 'pro-resources-admin',
      ip,
      userAgent,
      success: false,
      reason: `Exceeded ${RATE_LIMIT_PRESETS.GENERAL.limit} requests per window`,
    });
    return createRateLimitResponse(rateLimitResult, RATE_LIMIT_PRESETS.GENERAL, getCorsHeaders(req));
  }

  return null;
}

async function getUserFromRequest(req: Request) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const authHeader = req.headers.get('Authorization');
  const responseCorsHeaders = getCorsHeaders(req);

  if (!authHeader) {
    return { error: jsonResponse({ error: 'UNAUTHORIZED' }, 401, responseCorsHeaders) };
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { error: jsonResponse({ error: 'UNAUTHORIZED' }, 401, responseCorsHeaders) };
  }

  return { user: data.user };
}

async function ensureAdmin(userId: string): Promise<boolean> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!serviceKey) {
    return false;
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);
  const { data: profile, error } = await serviceClient
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();

  if (error) {
    return false;
  }

  return profile?.role === 'admin';
}

serve(async (req) => {
  const responseCorsHeaders = getCorsHeaders(req);
  const origin = req.headers.get('origin');

  if (!isOriginAllowed(origin)) {
    return new Response(JSON.stringify({ error: 'CORS_NOT_ALLOWED' }), {
      status: 403,
      headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: responseCorsHeaders });
  }

  const { user, error } = await getUserFromRequest(req);
  if (error) {
    return error;
  }

  const rateLimitResponse = await enforceRateLimit(req, user.id);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const isAdmin = await ensureAdmin(user.id);
  if (!isAdmin) {
    return jsonResponse({ error: 'FORBIDDEN' }, 403, responseCorsHeaders);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!serviceKey) {
    return jsonResponse({ error: 'CONFIG_ERROR' }, 500, responseCorsHeaders);
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);

  if (req.method === 'GET') {
    const { data: categories, error: categoriesError } = await serviceClient
      .from('pro_resource_categories')
      .select('*')
      .order('sort_order', { ascending: true });

    if (categoriesError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    const { data: resources, error: resourcesError } = await serviceClient
      .from('pro_resources')
      .select('*')
      .order('featured', { ascending: false })
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (resourcesError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse({ categories: categories ?? [], resources: resources ?? [] }, 200, responseCorsHeaders);
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'INVALID_JSON' }, 400, responseCorsHeaders);
  }

  const payload = body as Record<string, unknown>;
  const type = payload.type;

  if (req.method === 'POST') {
    if (type === 'category') {
      const parsed = categoryInsertSchema.safeParse(payload.data);
      if (!parsed.success) {
        return jsonResponse({ error: 'VALIDATION_ERROR' }, 400, responseCorsHeaders);
      }

      const { data, error: insertError } = await serviceClient
        .from('pro_resource_categories')
        .insert({
          name: parsed.data.name,
          slug: parsed.data.slug,
          description: parsed.data.description ?? null,
          color: parsed.data.color ?? null,
          sort_order: parsed.data.sort_order ?? 0,
          active: parsed.data.active ?? true,
        })
        .select('*')
        .single();

      if (insertError) {
        return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
      }

      return jsonResponse(data, 200, responseCorsHeaders);
    }

    if (type === 'resource') {
      const parsed = resourceInsertSchema.safeParse(payload.data);
      if (!parsed.success) {
        return jsonResponse({ error: 'VALIDATION_ERROR' }, 400, responseCorsHeaders);
      }

      const { data, error: insertError } = await serviceClient
        .from('pro_resources')
        .insert({
          category_id: parsed.data.category_id,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          logo_url: parsed.data.logo_url ?? null,
          website_url: parsed.data.website_url ?? null,
          email: parsed.data.email ?? null,
          phone: parsed.data.phone ?? null,
          city: parsed.data.city ?? null,
          region: parsed.data.region ?? null,
          tags: parsed.data.tags ?? [],
          featured: parsed.data.featured ?? false,
          active: parsed.data.active ?? true,
          sort_order: parsed.data.sort_order ?? 0,
        })
        .select('*')
        .single();

      if (insertError) {
        return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
      }

      return jsonResponse(data, 200, responseCorsHeaders);
    }

    return jsonResponse({ error: 'VALIDATION_ERROR' }, 400, responseCorsHeaders);
  }

  if (req.method === 'PATCH') {
    if (type === 'category') {
      const parsed = categoryUpdateSchema.safeParse(payload);
      if (!parsed.success) {
        return jsonResponse({ error: 'VALIDATION_ERROR' }, 400, responseCorsHeaders);
      }

      const { id, ...updates } = parsed.data;
      const { data, error: updateError } = await serviceClient
        .from('pro_resource_categories')
        .update({
          ...(updates.name !== undefined ? { name: updates.name } : {}),
          ...(updates.description !== undefined ? { description: updates.description } : {}),
          ...(updates.color !== undefined ? { color: updates.color } : {}),
          ...(updates.sort_order !== undefined ? { sort_order: updates.sort_order } : {}),
          ...(updates.active !== undefined ? { active: updates.active } : {}),
        })
        .eq('id', id)
        .select('*')
        .single();

      if (updateError) {
        return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
      }

      return jsonResponse(data, 200, responseCorsHeaders);
    }

    if (type === 'resource') {
      const parsed = resourceUpdateSchema.safeParse(payload);
      if (!parsed.success) {
        return jsonResponse({ error: 'VALIDATION_ERROR' }, 400, responseCorsHeaders);
      }

      const { id, ...updates } = parsed.data;
      const { data, error: updateError } = await serviceClient
        .from('pro_resources')
        .update({
          ...(updates.category_id !== undefined ? { category_id: updates.category_id } : {}),
          ...(updates.name !== undefined ? { name: updates.name } : {}),
          ...(updates.description !== undefined ? { description: updates.description } : {}),
          ...(updates.logo_url !== undefined ? { logo_url: updates.logo_url } : {}),
          ...(updates.website_url !== undefined ? { website_url: updates.website_url } : {}),
          ...(updates.email !== undefined ? { email: updates.email } : {}),
          ...(updates.phone !== undefined ? { phone: updates.phone } : {}),
          ...(updates.city !== undefined ? { city: updates.city } : {}),
          ...(updates.region !== undefined ? { region: updates.region } : {}),
          ...(updates.tags !== undefined ? { tags: updates.tags ?? [] } : {}),
          ...(updates.featured !== undefined ? { featured: updates.featured } : {}),
          ...(updates.active !== undefined ? { active: updates.active } : {}),
          ...(updates.sort_order !== undefined ? { sort_order: updates.sort_order } : {}),
        })
        .eq('id', id)
        .select('*')
        .single();

      if (updateError) {
        return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
      }

      return jsonResponse(data, 200, responseCorsHeaders);
    }

    return jsonResponse({ error: 'VALIDATION_ERROR' }, 400, responseCorsHeaders);
  }

  if (req.method === 'DELETE') {
    if (type === 'category' && typeof payload.id === 'string') {
      const { error: deleteError } = await serviceClient
        .from('pro_resource_categories')
        .delete()
        .eq('id', payload.id);

      if (deleteError) {
        return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
      }

      return jsonResponse({ success: true }, 200, responseCorsHeaders);
    }

    if (type === 'resource' && typeof payload.id === 'string') {
      const { error: deleteError } = await serviceClient
        .from('pro_resources')
        .delete()
        .eq('id', payload.id);

      if (deleteError) {
        return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
      }

      return jsonResponse({ success: true }, 200, responseCorsHeaders);
    }

    return jsonResponse({ error: 'VALIDATION_ERROR' }, 400, responseCorsHeaders);
  }

  return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405, responseCorsHeaders);
});
