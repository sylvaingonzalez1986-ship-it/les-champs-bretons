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

const orderEmailRequestSchema = z.object({
  commandeId: uuidSchema,
  producerId: uuidSchema,
  userId: uuidSchema,
});

type OrderEmailRequestInput = z.infer<typeof orderEmailRequestSchema>;

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
const COMPANY_EMAIL = 'leschanvriersbretons@gmail.com';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface OrderData {
  id: string;
  user_id: string;
  producer_id: string;
  total: number;
  statut: string;
  adresse_retrait: string;
  horaires_retrait: string;
  instructions_retrait: string | null;
  created_at: string;
}

interface OrderLineData {
  id: string;
  commande_id: string;
  product_id: string;
  quantite: number;
  prix_unitaire: number;
  sous_total: number;
}

interface ProductData {
  id: string;
  name: string;
  price_public: number;
}

interface ProducerData {
  id: string;
  name: string;
  email: string | null;
  profile_id?: string | null;

}

async function getUserRole(userId: string): Promise<string> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();

  return profile?.role ?? 'user';
}

interface UserProfileData {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
}

// Fonction pour envoyer un email via Resend
async function sendEmail(
  to: string,
  subject: string,
  html: string,
  cc?: string[]
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
        cc: cc || [],
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

// Générer le HTML de l'email pour le producteur
function generateProducerEmailHTML(
  orderData: OrderData,
  orderLines: (OrderLineData & { product_name: string })[],
  customerName: string,
  customerEmail: string
): string {
  const itemsHTML = orderLines
    .map(
      (line) => `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #e0e0e0;">${line.product_name}</td>
      <td style="padding: 8px; border-bottom: 1px solid #e0e0e0; text-align: center;">${line.quantite}</td>
      <td style="padding: 8px; border-bottom: 1px solid #e0e0e0; text-align: right;">${line.prix_unitaire.toFixed(2)} €</td>
      <td style="padding: 8px; border-bottom: 1px solid #e0e0e0; text-align: right;">${line.sous_total.toFixed(2)} €</td>
    </tr>
  `
    )
    .join('');

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #2d5016; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
          .section { margin-bottom: 20px; }
          .section-title { font-size: 18px; font-weight: bold; margin-bottom: 10px; color: #2d5016; }
          table { width: 100%; border-collapse: collapse; margin: 10px 0; }
          th { background-color: #f5f5f5; padding: 10px; text-align: left; font-weight: bold; border-bottom: 2px solid #2d5016; }
          .total-row { background-color: #f5f5f5; font-weight: bold; }
          .info-box { background-color: #f9f9f9; padding: 15px; border-left: 4px solid #2d5016; margin: 10px 0; }
          .footer { text-align: center; color: #999; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Nouvelle commande - Vente directe</h1>
            <p>Commande #${orderData.id}</p>
          </div>

          <div class="section">
            <div class="section-title">Informations client</div>
            <div class="info-box">
              <p><strong>Nom:</strong> ${customerName}</p>
              <p><strong>Email:</strong> ${customerEmail}</p>
              <p><strong>Date de commande:</strong> ${new Date(orderData.created_at).toLocaleDateString('fr-FR')}</p>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Détail de la commande</div>
            <table>
              <thead>
                <tr>
                  <th>Produit</th>
                  <th style="text-align: center;">Quantité</th>
                  <th style="text-align: right;">Prix unitaire</th>
                  <th style="text-align: right;">Sous-total</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHTML}
                <tr class="total-row">
                  <td colspan="3" style="padding: 10px; text-align: right;">TOTAL:</td>
                  <td style="padding: 10px; text-align: right;">${orderData.total.toFixed(2)} €</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="section">
            <div class="section-title">Lieu et modalités de retrait</div>
            <div class="info-box">
              <p><strong>Adresse:</strong> ${orderData.adresse_retrait}</p>
              <p><strong>Horaires:</strong> ${orderData.horaires_retrait}</p>
              ${orderData.instructions_retrait ? `<p><strong>Instructions spéciales:</strong> ${orderData.instructions_retrait}</p>` : ''}
            </div>
          </div>

          <div class="section">
            <div class="section-title">Prochain étape</div>
            <p>Veuillez confirmer cette commande et préparer les produits pour le retrait par le client.</p>
            <p>Statut: <strong>${orderData.statut === 'en_attente' ? 'En attente' : orderData.statut}</strong></p>
          </div>

          <div class="footer">
            <p>Cet email a été généré automatiquement. Veuillez ne pas répondre à cet email.</p>
            <p>Les Chanvriers Unis - Marché Local</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

// Générer le HTML de l'email de confirmation pour le client
function generateCustomerEmailHTML(
  orderData: OrderData,
  producerName: string,
  orderLines: (OrderLineData & { product_name: string })[],
  customerName: string
): string {
  const itemsHTML = orderLines
    .map(
      (line) => `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #e0e0e0;">${line.product_name}</td>
      <td style="padding: 8px; border-bottom: 1px solid #e0e0e0; text-align: center;">${line.quantite}</td>
      <td style="padding: 8px; border-bottom: 1px solid #e0e0e0; text-align: right;">${line.prix_unitaire.toFixed(2)} €</td>
      <td style="padding: 8px; border-bottom: 1px solid #e0e0e0; text-align: right;">${line.sous_total.toFixed(2)} €</td>
    </tr>
  `
    )
    .join('');

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #2d5016; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
          .section { margin-bottom: 20px; }
          .section-title { font-size: 18px; font-weight: bold; margin-bottom: 10px; color: #2d5016; }
          table { width: 100%; border-collapse: collapse; margin: 10px 0; }
          th { background-color: #f5f5f5; padding: 10px; text-align: left; font-weight: bold; border-bottom: 2px solid #2d5016; }
          .total-row { background-color: #f5f5f5; font-weight: bold; }
          .info-box { background-color: #f9f9f9; padding: 15px; border-left: 4px solid #2d5016; margin: 10px 0; }
          .footer { text-align: center; color: #999; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Confirmation de votre commande</h1>
            <p>Commande #${orderData.id}</p>
          </div>

          <div class="section">
            <p>Bonjour ${customerName},</p>
            <p>Merci pour votre commande! Vous trouverez ci-dessous les détails de votre achat chez <strong>${producerName}</strong>.</p>
          </div>

          <div class="section">
            <div class="section-title">Détail de votre commande</div>
            <table>
              <thead>
                <tr>
                  <th>Produit</th>
                  <th style="text-align: center;">Quantité</th>
                  <th style="text-align: right;">Prix unitaire</th>
                  <th style="text-align: right;">Sous-total</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHTML}
                <tr class="total-row">
                  <td colspan="3" style="padding: 10px; text-align: right;">TOTAL:</td>
                  <td style="padding: 10px; text-align: right;">${orderData.total.toFixed(2)} €</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="section">
            <div class="section-title">Lieu et horaires de retrait</div>
            <div class="info-box">
              <p><strong>Chez ${producerName}</strong></p>
              <p><strong>Adresse:</strong> ${orderData.adresse_retrait}</p>
              <p><strong>Horaires:</strong> ${orderData.horaires_retrait}</p>
              ${orderData.instructions_retrait ? `<p><strong>Instructions:</strong> ${orderData.instructions_retrait}</p>` : ''}
            </div>
          </div>

          <div class="section">
            <div class="section-title">Statut de la commande</div>
            <div class="info-box">
              <p>Statut: <strong>En attente de confirmation par le producteur</strong></p>
              <p>Vous recevrez une notification une fois que le producteur aura confirmé votre commande.</p>
            </div>
          </div>

          <div class="footer">
            <p>Merci d'avoir utilisé le Marché Local des Chanvriers Unis!</p>
            <p>Pour toute question, veuillez contacter le producteur ou le service client.</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

const handler = createValidatedHandler<OrderEmailRequestInput>(
  {
    schema: orderEmailRequestSchema,
    rateLimit: RATE_LIMIT_PRESETS.ORDERS,
    functionName: 'send-order-email',
  },
  async ({ user, data }) => {
    const { commandeId, producerId, userId } = data;

    const role = await getUserRole(user.id);
    const isAdmin = role === 'admin';
    const isProducerRole = role === 'producer';

    if (!isAdmin && !isProducerRole && userId !== user.id) {
      return new Response(
        JSON.stringify({ error: 'FORBIDDEN', message: 'User mismatch' }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Récupérer les données de la commande
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

    // Récupérer les lignes de commande avec infos produit
    const { data: orderLines, error: linesError } = await supabase
      .from('lignes_commande_vente_directe')
      .select('*')
      .eq('commande_id', commandeId);

    if (linesError) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch order lines' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Récupérer les infos produits
    const enrichedOrderLines = await Promise.all(
      (orderLines || []).map(async (line: OrderLineData) => {
        const { data: product } = await supabase
          .from('products')
          .select('id, name, price_public')
          .eq('id', line.product_id)
          .single();

        return {
          ...line,
          product_name: product?.name || 'Unknown Product',
        };
      })
    );

    // Récupérer les infos du producteur
    const { data: producerData, error: producerError } = await supabase
      .from('producers')
      .select('id, name, email, profile_id')
      .eq('id', producerId)
      .single();

    if (producerError || !producerData) {
      return new Response(JSON.stringify({ error: 'Producer not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const isProducer = producerData.profile_id && producerData.profile_id === user.id;
    const isCustomer = orderData.user_id === user.id;

    if (!isAdmin && !isCustomer && !isProducer) {
      return new Response(JSON.stringify({ error: 'FORBIDDEN', message: 'Not allowed to trigger this email' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Récupérer les infos du client (user profile)
    const { data: userProfile, error: userError } = await supabase
      .from('profiles')
      .select('id, email, first_name, last_name')
      .eq('id', userId)
      .single();

    if (userError || !userProfile) {
      return new Response(
        JSON.stringify({ error: 'User profile not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const customerName = `${userProfile.first_name || ''} ${userProfile.last_name || ''}`.trim() || 'Client';
    const customerEmail = userProfile.email || '';
    const producerEmail = producerData.email || '';

    // Générer les emails
    const producerEmailHTML = generateProducerEmailHTML(
      orderData as OrderData,
      enrichedOrderLines,
      customerName,
      customerEmail
    );

    const customerEmailHTML = generateCustomerEmailHTML(
      orderData as OrderData,
      producerData.name,
      enrichedOrderLines,
      customerName
    );

    // Envoyer l'email au producteur avec CC au company email
    const producerEmailSent = await sendEmail(
      producerEmail,
      `Nouvelle commande vente directe #${commandeId.slice(0, 8)}`,
      producerEmailHTML,
      [COMPANY_EMAIL]
    );

    // Envoyer l'email de confirmation au client
    const customerEmailSent = await sendEmail(
      customerEmail,
      `Confirmation de votre commande #${commandeId.slice(0, 8)}`,
      customerEmailHTML
    );

    return new Response(
      JSON.stringify({
        success: true,
        producerEmailSent,
        customerEmailSent,
        message: 'Emails sent successfully',
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
);

serve(handler);
