import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient, SupabaseClient, User } from 'https://esm.sh/@supabase/supabase-js@2.38.0';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';

// Allowed origins for CSRF protection
const ALLOWED_ORIGINS = [
  'https://leschanvriersbretons.fr',
  'https://www.leschanvriersbretons.fr',
  'http://localhost:8081', // Expo dev
  'http://localhost:19006', // Expo web
];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

// HTML escaping to prevent XSS in email templates
function escapeHtml(text: string | null | undefined): string {
  if (!text) return '';
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
  };
  return text.replace(/[&<>"'/]/g, (char) => map[char]);
}

// Validate request origin for CSRF protection
function validateOrigin(req: Request): boolean {
  const origin = req.headers.get('Origin');
  // Allow requests without Origin header (mobile apps, server-to-server)
  if (!origin) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

// Structured security event logging for SIEM integration
function logSecurityEvent(
  eventType: string,
  userId: string | null,
  details: Record<string, unknown>
): void {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    eventType,
    userId,
    service: 'notify-order-status',
    ...details,
  }));
}

const RATE_LIMIT_PRESETS = {
  ORDERS: {
    limit: 10,
    windowMs: 60 * 1000,
    identifier: 'orders',
  },
} as const;

interface RateLimitConfig {
  limit: number;
  windowMs: number;
  identifier: string;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSeconds?: number;
}

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const key = `${config.identifier}:${userId}`;
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + config.windowMs });
    return { allowed: true, remaining: config.limit - 1, resetAt: now + config.windowMs };
  }

  if (entry.count >= config.limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
      retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
    };
  }

  entry.count += 1;
  return { allowed: true, remaining: config.limit - entry.count, resetAt: entry.resetAt };
}

function createRateLimitResponse(
  result: RateLimitResult,
  config: RateLimitConfig
): Response {
  return new Response(
    JSON.stringify({
      error: 'RATE_LIMIT_EXCEEDED',
      message: `Rate limit exceeded. Maximum ${config.limit} requests per ${Math.ceil(config.windowMs / 1000)} seconds.`,
      retryAfter: result.retryAfterSeconds,
      resetAt: new Date(result.resetAt).toISOString(),
    }),
    {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}

const uuidSchema = z.string().uuid('Invalid UUID format');

const notifyOrderStatusSchema = z.object({
  commandeId: uuidSchema,
  newStatus: z.enum(['en_attente', 'confirmee', 'prete', 'recuperee', 'annulee']),
  userId: uuidSchema,
  producerId: uuidSchema,
});

type NotifyOrderStatusInput = z.infer<typeof notifyOrderStatusSchema>;

interface ValidatedRequest<T> {
  user: User;
  data: T;
  supabase: SupabaseClient;
}

function createValidatedHandler<T>(
  config: { schema: z.ZodSchema<T>; rateLimit: RateLimitConfig; functionName: string },
  handler: (validated: ValidatedRequest<T>) => Promise<Response>
): (req: Request) => Promise<Response> {
  const { schema, rateLimit, functionName } = config;

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    // CSRF Protection: Validate origin
    if (!validateOrigin(req)) {
      logSecurityEvent('INVALID_ORIGIN', null, {
        origin: req.headers.get('Origin'),
        userAgent: req.headers.get('User-Agent'),
      });
      return new Response(JSON.stringify({ error: 'FORBIDDEN', message: 'Invalid origin' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      logSecurityEvent('AUTH_FAILURE', null, {
        error: userError?.message,
        userAgent: req.headers.get('User-Agent'),
      });
      return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = userData.user.id;
    const rateLimitResult = checkRateLimit(userId, rateLimit);
    if (!rateLimitResult.allowed) {
      logSecurityEvent('RATE_LIMIT_EXCEEDED', userId, {
        identifier: rateLimit.identifier,
        resetAt: new Date(rateLimitResult.resetAt).toISOString(),
      });
      return createRateLimitResponse(rateLimitResult, rateLimit);
    }

    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'PARSE_ERROR' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const validation = schema.safeParse(body);
    if (!validation.success) {
      return new Response(JSON.stringify({
        error: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: validation.error.errors.map(err => ({
          path: err.path.join('.'),
          message: err.message,
        })),
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    try {
      return await handler({
        user: userData.user,
        data: validation.data,
        supabase,
      });
    } catch (error) {
      console.error(`[${functionName}] Handler error:`, error);
      return new Response(JSON.stringify({ error: 'INTERNAL_ERROR' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  };
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

type NotifyStatusRequestInput = NotifyOrderStatusInput;

// Status labels in French
const STATUS_LABELS: Record<string, string> = {
  en_attente: 'En attente',
  confirmee: 'Confirmée',
  prete: 'Prête pour le retrait',
  recuperee: 'Récupérée',
  annulee: 'Annulée',
};

// Status descriptions for email
const STATUS_DESCRIPTIONS: Record<string, string> = {
  confirmee: 'Votre commande a été confirmée par le producteur. Elle sera bientôt prête pour le retrait.',
  prete: 'Votre commande est prête! Vous pouvez venir la récupérer aux horaires indiqués.',
  recuperee: 'Merci pour votre achat! Votre commande a été récupérée avec succès.',
  annulee: 'Votre commande a été annulée. Si vous avez des questions, contactez le producteur.',
};

// Send email via Resend
async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured');
    return false;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'noreply@leschanvriersbretons.fr',
        to,
        subject,
        html,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Resend API error:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Email sending error:', error);
    return false;
  }
}

async function getUserRole(userId: string): Promise<string> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();

  return profile?.role ?? 'user';
}

// Generate status update email HTML with XSS protection
function generateStatusUpdateEmailHTML(
  orderId: string,
  status: string,
  producerName: string,
  customerName: string,
  address: string | null,
  schedule: string | null,
  instructions: string | null
): string {
  const statusLabel = STATUS_LABELS[status] || status;
  const statusDesc = STATUS_DESCRIPTIONS[status] || '';

  // Get status-specific styling
  const getStatusColor = (s: string): string => {
    switch (s) {
      case 'confirmee': return '#2d6a4f';
      case 'prete': return '#1976d2';
      case 'recuperee': return '#388e3c';
      case 'annulee': return '#d32f2f';
      default: return '#666666';
    }
  };

  const statusColor = getStatusColor(status);

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mise à jour de commande</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; background-color: #f5f5f5;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow: hidden;">
      <!-- Header -->
      <div style="background-color: #2d6a4f; padding: 24px; text-align: center;">
        <h1 style="margin: 0; color: #ffffff; font-size: 24px;">Les Chanvriers Bretons</h1>
      </div>
      
      <!-- Content -->
      <div style="padding: 32px;">
        <p style="margin: 0 0 16px; font-size: 16px;">Bonjour <strong>${escapeHtml(customerName)}</strong>,</p>
        
        <div style="background-color: #f8f9fa; border-left: 4px solid ${statusColor}; padding: 16px; margin: 24px 0; border-radius: 0 4px 4px 0;">
          <h2 style="margin: 0 0 8px; font-size: 18px; color: #333;">Commande #${escapeHtml(orderId)}</h2>
          <p style="margin: 0; font-size: 16px;">
            <strong>Statut :</strong> 
            <span style="color: ${statusColor}; font-weight: bold;">${escapeHtml(statusLabel)}</span>
          </p>
        </div>
        
        <p style="margin: 16px 0; font-size: 15px; color: #555;">${escapeHtml(statusDesc)}</p>
        
        ${address || schedule || instructions ? `
        <div style="background-color: #e8f5e9; padding: 20px; border-radius: 6px; margin: 24px 0;">
          <h3 style="margin: 0 0 16px; font-size: 16px; color: #2d6a4f;">📍 Informations de retrait</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; vertical-align: top; width: 100px; color: #666;">Producteur</td>
              <td style="padding: 8px 0; font-weight: 500;">${escapeHtml(producerName)}</td>
            </tr>
            ${address ? `
            <tr>
              <td style="padding: 8px 0; vertical-align: top; color: #666;">Adresse</td>
              <td style="padding: 8px 0;">${escapeHtml(address)}</td>
            </tr>` : ''}
            ${schedule ? `
            <tr>
              <td style="padding: 8px 0; vertical-align: top; color: #666;">Horaires</td>
              <td style="padding: 8px 0;">${escapeHtml(schedule)}</td>
            </tr>` : ''}
            ${instructions ? `
            <tr>
              <td style="padding: 8px 0; vertical-align: top; color: #666;">Instructions</td>
              <td style="padding: 8px 0;">${escapeHtml(instructions)}</td>
            </tr>` : ''}
          </table>
        </div>` : ''}
        
        <p style="margin: 32px 0 0; font-size: 14px; color: #888;">
          Merci de votre confiance,<br>
          <strong style="color: #2d6a4f;">L'équipe Les Chanvriers Bretons</strong>
        </p>
      </div>
      
      <!-- Footer -->
      <div style="background-color: #f8f9fa; padding: 16px; text-align: center; border-top: 1px solid #eee;">
        <p style="margin: 0; font-size: 12px; color: #999;">
          Cet email a été envoyé automatiquement. Pour toute question, contactez directement le producteur.
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// Audit logging for compliance (SOC 2, GDPR)
async function logAuditEvent(
  supabaseClient: SupabaseClient,
  eventType: string,
  userId: string,
  resourceType: string,
  resourceId: string,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    await supabaseClient
      .from('audit_logs')
      .insert({
        event_type: eventType,
        user_id: userId,
        resource_type: resourceType,
        resource_id: resourceId,
        metadata,
        created_at: new Date().toISOString(),
      });
  } catch (error) {
    // Don't fail the request if audit logging fails, but log the error
    console.error('Audit logging failed:', error);
  }
}

const handler = createValidatedHandler<NotifyOrderStatusInput>(
  {
    schema: notifyOrderStatusSchema,
    rateLimit: RATE_LIMIT_PRESETS.ORDERS,
    functionName: 'notify-order-status',
  },
  async ({ user, data }) => {
    const { commandeId, newStatus, userId, producerId } = data as NotifyStatusRequestInput;

    const role = await getUserRole(user.id);
    if (role !== 'producer' && role !== 'admin') {
      logSecurityEvent('AUTHORIZATION_FAILURE', user.id, {
        requiredRole: 'producer or admin',
        actualRole: role,
        action: 'notify-order-status',
      });
      return new Response(JSON.stringify({ error: 'FORBIDDEN', message: 'Producer or admin role required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch order data
    const { data: orderData, error: orderError } = await supabase
      .from('commandes_vente_directe')
      .select('*')
      .eq('id', commandeId)
      .single();

    if (orderError || !orderData) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (orderData.user_id !== userId || orderData.producer_id !== producerId) {
      return new Response(JSON.stringify({ error: 'FORBIDDEN', message: 'Order mismatch' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch producer info
    const { data: producerData, error: producerError } = await supabase
      .from('producers')
      .select('id, name, profile_id')
      .eq('id', producerId)
      .single();

    if (producerError || !producerData) {
      return new Response(JSON.stringify({ error: 'Producer not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (role === 'producer' && producerData.profile_id !== user.id) {
      return new Response(JSON.stringify({ error: 'FORBIDDEN', message: 'Producer mismatch' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch customer info
    const { data: customerData, error: customerError } = await supabase
      .from('profiles')
      .select('id, email, first_name, last_name')
      .eq('id', userId)
      .single();

    if (customerError || !customerData) {
      return new Response(JSON.stringify({ error: 'Customer not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const customerName = `${customerData.first_name || ''} ${customerData.last_name || ''}`.trim() || 'Client';
    const customerEmail = customerData.email || '';

    // Generate email HTML
    const emailHTML = generateStatusUpdateEmailHTML(
      orderData.id.slice(0, 8),
      newStatus,
      producerData.name,
      customerName,
      orderData.adresse_retrait,
      orderData.horaires_retrait,
      orderData.instructions_retrait
    );

    // Send email
    const emailSent = await sendEmail(
      customerEmail,
      `Mise à jour de votre commande #${orderData.id.slice(0, 8)}`,
      emailHTML
    );

    if (!emailSent) {
      logSecurityEvent('EMAIL_SEND_FAILURE', user.id, {
        commandeId,
        customerEmail: customerEmail.replace(/(.{2}).*(@.*)/, '$1***$2'), // Mask email
      });
      return new Response(JSON.stringify({ error: 'Failed to send email' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Audit logging for compliance (SOC 2, GDPR)
    await logAuditEvent(
      supabase,
      'ORDER_STATUS_NOTIFICATION_SENT',
      user.id,
      'commandes_vente_directe',
      commandeId,
      {
        newStatus,
        previousStatus: orderData.statut,
        producerId,
        customerId: userId,
        notifiedAt: new Date().toISOString(),
      }
    );

    logSecurityEvent('ORDER_NOTIFICATION_SUCCESS', user.id, {
      commandeId,
      newStatus,
      producerId,
    });

    return new Response(
      JSON.stringify({ success: true, message: 'Notification sent successfully' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
);

serve(handler);
