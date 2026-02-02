import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient, SupabaseClient, User } from 'https://esm.sh/@supabase/supabase-js@2.38.0';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

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
      return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = userData.user.id;
    const rateLimitResult = checkRateLimit(userId, rateLimit);
    if (!rateLimitResult.allowed) {
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

// Generate status update email HTML
function generateStatusUpdateEmailHTML(
  orderNumber: string,
  newStatus: string,
  producerName: string,
  customerName: string,
  address: string,
  hours: string,
  instructions: string | null
): string {
  const statusLabel = STATUS_LABELS[newStatus] || newStatus;
  const statusDescription = STATUS_DESCRIPTIONS[newStatus] || '';

  const statusColor = {
    en_attente: '#f59e0b',
    confirmee: '#3b82f6',
    prete: '#8b5cf6',
    recuperee: '#22c55e',
    annulee: '#ef4444',
  }[newStatus] || '#6b7280';

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #2d5016; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
          .status-badge { display: inline-block; padding: 8px 16px; border-radius: 20px; font-weight: bold; color: white; }
          .section { margin-bottom: 20px; }
          .section-title { font-size: 18px; font-weight: bold; margin-bottom: 10px; color: #2d5016; }
          .info-box { background-color: #f9f9f9; padding: 15px; border-left: 4px solid #2d5016; margin: 10px 0; }
          .footer { text-align: center; color: #999; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Mise à jour de votre commande</h1>
            <p>Commande #${orderNumber}</p>
          </div>

          <div class="section">
            <p>Bonjour ${customerName},</p>
            <p>Le statut de votre commande chez <strong>${producerName}</strong> a été mis à jour.</p>
          </div>

          <div class="section" style="text-align: center;">
            <div class="status-badge" style="background-color: ${statusColor};">
              ${statusLabel}
            </div>
            <p style="margin-top: 15px;">${statusDescription}</p>
          </div>

          ${newStatus === 'prete' || newStatus === 'confirmee' ? `
          <div class="section">
            <div class="section-title">Informations de retrait</div>
            <div class="info-box">
              <p><strong>Producteur:</strong> ${producerName}</p>
              <p><strong>Adresse:</strong> ${address}</p>
              <p><strong>Horaires:</strong> ${hours}</p>
              ${instructions ? `<p><strong>Instructions:</strong> ${instructions}</p>` : ''}
            </div>
          </div>
          ` : ''}

          ${newStatus === 'annulee' ? `
          <div class="section">
            <div class="info-box" style="border-left-color: #ef4444;">
              <p>Si vous avez des questions concernant cette annulation, n'hésitez pas à contacter directement le producteur.</p>
            </div>
          </div>
          ` : ''}

          <div class="footer">
            <p>Merci d'utiliser le Marché Local des Chanvriers Unis!</p>
            <p>Cet email a été généré automatiquement.</p>
          </div>
        </div>
      </body>
    </html>
  `;
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
      return new Response(JSON.stringify({ error: 'Failed to send email' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Notification sent successfully' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
);

serve(handler);
