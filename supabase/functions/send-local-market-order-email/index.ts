import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient, SupabaseClient, User } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { getCorsHeaders, isOriginAllowed } from '../_shared/cors.ts';
import {
  checkRateLimit,
  createRateLimitResponse,
  logSecurityEvent,
  RATE_LIMIT_PRESETS,
} from '../_shared/rate-limit.ts';

const EMAIL_WEBHOOK_SECRET = Deno.env.get('EMAIL_WEBHOOK_SECRET') || '';


function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function computeSignature(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload)
  );
  const bytes = new Uint8Array(signature);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

async function verifyOptionalWebhookSignature(
  req: Request,
  rawBody: string,
  responseCorsHeaders: Record<string, string>
): Promise<Response | null> {
  if (!EMAIL_WEBHOOK_SECRET) return null;

  const signature = req.headers.get('X-Webhook-Signature');
  const timestamp = req.headers.get('X-Webhook-Timestamp');
  if (!signature || !timestamp) return null;

  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs)) {
    return new Response(JSON.stringify({ error: 'INVALID_SIGNATURE' }), {
      status: 401,
      headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const now = Date.now();
  if (Math.abs(now - timestampMs) > 5 * 60 * 1000) {
    return new Response(JSON.stringify({ error: 'SIGNATURE_EXPIRED' }), {
      status: 401,
      headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const payload = `${timestamp}.${rawBody}`;
  const expected = await computeSignature(EMAIL_WEBHOOK_SECRET, payload);

  if (!timingSafeEqual(signature, expected)) {
    return new Response(JSON.stringify({ error: 'INVALID_SIGNATURE' }), {
      status: 401,
      headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return null;
}

const uuidSchema = z.string().uuid('Invalid UUID format');
const emailSchema = z.string().email('Invalid email format').max(255);
const quantitySchema = z.number().int().positive().max(10000);
const priceSchema = z.number().positive().max(999999.99);
const deliveryMethodSchema = z.enum(['pickup', 'shipping']);

const localMarketOrderEmailSchema = z.object({
  orderId: uuidSchema,
  producerEmail: emailSchema,
  producerName: z.string().min(1).max(200),
  customerName: z.string().min(1).max(200),
  customerEmail: emailSchema,
  customerPhone: z.string().max(30).optional(),
  productName: z.string().min(1).max(200),
  quantity: quantitySchema,
  unitPrice: priceSchema,
  totalAmount: priceSchema,
  pickupCode: z.string().min(4).max(32),
  pickupLocation: z.string().max(200).optional(),
  pickupInstructions: z.string().max(500).optional(),
  deliveryMethod: deliveryMethodSchema.optional(),
  deliveryFee: z.number().min(0).max(999999.99).optional(),
  deliveryAddress: z.string().max(500).optional(),
  deliveryInstructions: z.string().max(1000).optional(),
  customerNotes: z.string().max(1000).optional(),
});

type LocalMarketOrderEmailInput = z.infer<typeof localMarketOrderEmailSchema>;

interface ValidatedRequest<T> {
  user: User;
  data: T;
  supabase: SupabaseClient;
  responseCorsHeaders: Record<string, string>;
}

function createValidatedHandler<T>(
  config: { schema: z.ZodSchema<T>; rateLimit: { limit: number; windowMs: number; identifier: string }; functionName: string },
  handler: (validated: ValidatedRequest<T>) => Promise<Response>
): (req: Request) => Promise<Response> {
  const { schema, rateLimit, functionName } = config;

  return async (req: Request): Promise<Response> => {
    const responseCorsHeaders = getCorsHeaders(req);
    const origin = req.headers.get('Origin');

    if (!isOriginAllowed(origin)) {
      logSecurityEvent({
        userId: 'anonymous',
        action: 'invalid_origin',
        endpoint: functionName,
        ip: req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown',
        userAgent: req.headers.get('User-Agent') || 'unknown',
        success: false,
        reason: `Origin not allowed: ${origin ?? 'unknown'}`,
      });
      return new Response(JSON.stringify({ error: 'FORBIDDEN', message: 'Invalid origin' }), {
        status: 403,
        headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: responseCorsHeaders });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
        status: 401,
        headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
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
        headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = userData.user.id;
    const rateLimitResult = await checkRateLimit(userId, rateLimit);
    if (!rateLimitResult.allowed) {
      logSecurityEvent({
        userId,
        action: 'rate_limit_exceeded',
        endpoint: functionName,
        ip: req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown',
        userAgent: req.headers.get('User-Agent') || 'unknown',
        success: false,
        reason: `Exceeded ${rateLimit.limit} requests per window`,
      });
      return createRateLimitResponse(rateLimitResult, rateLimit, responseCorsHeaders);
    }

    let rawBody = '';
    try {
      rawBody = await req.text();
    } catch {
      return new Response(JSON.stringify({ error: 'PARSE_ERROR' }), {
        status: 400,
        headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const signatureError = await verifyOptionalWebhookSignature(req, rawBody, responseCorsHeaders);
    if (signatureError) {
      return signatureError;
    }

    let body: unknown = {};
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return new Response(JSON.stringify({ error: 'PARSE_ERROR' }), {
        status: 400,
        headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
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
        headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
      });
    }

    try {
      return await handler({
        user: userData.user,
        data: validation.data,
        supabase,
        responseCorsHeaders,
      });
    } catch (error) {
      console.error(`[${functionName}] Handler error:`, error);
      return new Response(JSON.stringify({ error: 'INTERNAL_ERROR' }), {
        status: 500,
        headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
      });
    }
  };
}

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const COMPANY_EMAIL = 'leschanvriersbretons@gmail.com';

type LocalMarketOrderEmailRequest = LocalMarketOrderEmailInput;

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
function generateProducerEmailHTML(data: LocalMarketOrderEmailRequest): string {
  const resolvedDeliveryMethod = data.deliveryMethod ?? 'pickup';
  const isShipping = resolvedDeliveryMethod === 'shipping';
  const resolvedDeliveryFee = Number(data.deliveryFee ?? 0);
  const actionNotice = isShipping
    ? 'Contactez le client pour lui communiquer vos instructions de paiement à distance. La commande sera expédiée une fois le paiement reçu.'
    : 'Préparez la commande et attendez le client avec le code ci-dessus.';
  const paymentNotice = isShipping
    ? 'Le paiement s\'effectue à distance avant l\'expédition.'
    : 'Le paiement s\'effectue sur place lors du retrait.';

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #2d5016 0%, #4a7c23 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center; }
          .header h1 { margin: 0 0 10px 0; font-size: 24px; }
          .header p { margin: 0; opacity: 0.9; }
          .content { background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; }
          .pickup-code { background: linear-gradient(135deg, #D4A853 0%, #E8C97A 100%); color: #1a2744; padding: 20px; border-radius: 12px; text-align: center; margin: 20px 0; }
          .pickup-code .label { font-size: 14px; margin-bottom: 5px; opacity: 0.8; }
          .pickup-code .code { font-size: 36px; font-weight: bold; letter-spacing: 8px; }
          .section { margin-bottom: 25px; }
          .section-title { font-size: 16px; font-weight: bold; color: #2d5016; margin-bottom: 10px; border-bottom: 2px solid #2d5016; padding-bottom: 5px; }
          .info-box { background: #f9f9f9; padding: 15px; border-left: 4px solid #2d5016; border-radius: 0 8px 8px 0; }
          .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
          .info-row:last-child { border-bottom: none; }
          .info-label { color: #666; }
          .info-value { font-weight: 600; color: #333; }
          .total-box { background: #2d5016; color: white; padding: 15px 20px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; }
          .total-box .label { font-size: 16px; }
          .total-box .amount { font-size: 24px; font-weight: bold; }
          .notes-box { background: #fff3cd; padding: 15px; border-radius: 8px; border-left: 4px solid #ffc107; }
          .footer { text-align: center; color: #999; font-size: 12px; margin-top: 30px; padding: 20px; border-top: 1px solid #e0e0e0; }
          .action-notice { background: #e8f5e9; padding: 15px; border-radius: 8px; text-align: center; margin-top: 20px; }
          .action-notice strong { color: #2d5016; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Nouvelle commande Marché Local</h1>
            <p>Commande #${data.orderId.slice(0, 8)}</p>
          </div>

          <div class="content">
            <div class="pickup-code">
              <div class="label">CODE DE RETRAIT CLIENT</div>
              <div class="code">${data.pickupCode}</div>
            </div>

            <div class="section">
              <div class="section-title">Détails de la commande</div>
              <div class="info-box">
                <div class="info-row">
                  <span class="info-label">Produit</span>
                  <span class="info-value">${data.productName}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Quantité</span>
                  <span class="info-value">${data.quantity}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Prix unitaire</span>
                  <span class="info-value">${data.unitPrice.toFixed(2)} €</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Mode</span>
                  <span class="info-value">${isShipping ? 'Livraison' : 'Retrait'}</span>
                </div>
                ${isShipping ? `
                <div class="info-row">
                  <span class="info-label">Frais de livraison</span>
                  <span class="info-value">${resolvedDeliveryFee.toFixed(2)} €</span>
                </div>
                ` : ''}
              </div>
              <div class="total-box" style="margin-top: 15px;">
                <span class="label">Total à encaisser</span>
                <span class="amount">${data.totalAmount.toFixed(2)} €</span>
              </div>
            </div>

            <div class="section">
              <div class="section-title">Informations client</div>
              <div class="info-box">
                <div class="info-row">
                  <span class="info-label">Nom</span>
                  <span class="info-value">${data.customerName}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Email</span>
                  <span class="info-value">${data.customerEmail}</span>
                </div>
                ${data.customerPhone ? `
                <div class="info-row">
                  <span class="info-label">Téléphone</span>
                  <span class="info-value">${data.customerPhone}</span>
                </div>
                ` : ''}
              </div>
            </div>

            ${data.customerNotes ? `
            <div class="section">
              <div class="section-title">Message du client</div>
              <div class="notes-box">
                <em>"${data.customerNotes}"</em>
              </div>
            </div>
            ` : ''}

            ${isShipping && data.deliveryAddress ? `
            <div class="section">
              <div class="section-title">Livraison</div>
              <div class="info-box">
                <div class="info-row">
                  <span class="info-label">Adresse</span>
                  <span class="info-value">${data.deliveryAddress}</span>
                </div>
                ${data.deliveryInstructions ? `
                <div class="info-row">
                  <span class="info-label">Instructions</span>
                  <span class="info-value">${data.deliveryInstructions}</span>
                </div>
                ` : ''}
              </div>
            </div>
            ` : ''}

            <div class="action-notice">
              <strong>Action requise:</strong> ${actionNotice}<br>
              ${paymentNotice}
            </div>
          </div>

          <div class="footer">
            <p>Cet email a été généré automatiquement par Les Chanvriers Unis - Marché Local</p>
            <p>Ne répondez pas à cet email. Pour contacter le client, utilisez: ${data.customerEmail}</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

// Générer le HTML de l'email de confirmation pour le client
function generateCustomerEmailHTML(data: LocalMarketOrderEmailRequest): string {
  const resolvedDeliveryMethod = data.deliveryMethod ?? 'pickup';
  const isShipping = resolvedDeliveryMethod === 'shipping';
  const resolvedDeliveryFee = Number(data.deliveryFee ?? 0);
  const codeLabel = isShipping ? 'VOTRE CODE DE COMMANDE' : 'VOTRE CODE DE RETRAIT';
  const codeNote = isShipping
    ? 'Gardez ce code pour le suivi de votre commande'
    : 'Présentez ce code au producteur lors du retrait';
  const paymentNotice = isShipping
    ? 'Le paiement s\'effectue à distance en suivant les instructions du producteur reçues par email. Votre commande sera expédiée une fois le paiement reçu.'
    : 'Le paiement s\'effectue directement auprès du producteur lors du retrait de votre commande.';

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #1a2744 0%, #2d3f66 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center; }
          .header h1 { margin: 0 0 10px 0; font-size: 24px; }
          .header p { margin: 0; opacity: 0.9; }
          .content { background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; }
          .pickup-code { background: linear-gradient(135deg, #D4A853 0%, #E8C97A 100%); color: #1a2744; padding: 25px; border-radius: 12px; text-align: center; margin: 20px 0; }
          .pickup-code .label { font-size: 14px; margin-bottom: 8px; opacity: 0.8; }
          .pickup-code .code { font-size: 42px; font-weight: bold; letter-spacing: 10px; }
          .pickup-code .note { font-size: 12px; margin-top: 10px; opacity: 0.8; }
          .section { margin-bottom: 25px; }
          .section-title { font-size: 16px; font-weight: bold; color: #2d5016; margin-bottom: 10px; border-bottom: 2px solid #2d5016; padding-bottom: 5px; }
          .info-box { background: #f9f9f9; padding: 15px; border-left: 4px solid #2d5016; border-radius: 0 8px 8px 0; }
          .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
          .info-row:last-child { border-bottom: none; }
          .info-label { color: #666; }
          .info-value { font-weight: 600; color: #333; }
          .total-box { background: #2d5016; color: white; padding: 15px 20px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; }
          .total-box .label { font-size: 16px; }
          .total-box .amount { font-size: 24px; font-weight: bold; }
          .payment-notice { background: #fff3cd; padding: 15px; border-radius: 8px; border-left: 4px solid #ffc107; text-align: center; margin: 20px 0; }
          .footer { text-align: center; color: #999; font-size: 12px; margin-top: 30px; padding: 20px; border-top: 1px solid #e0e0e0; }
          .success-icon { font-size: 48px; margin-bottom: 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="success-icon">✓</div>
            <h1>Commande confirmée !</h1>
            <p>Merci pour votre commande chez ${data.producerName}</p>
          </div>

          <div class="content">
            <div class="pickup-code">
              <div class="label">${codeLabel}</div>
              <div class="code">${data.pickupCode}</div>
              <div class="note">${codeNote}</div>
            </div>

            <div class="section">
              <div class="section-title">Récapitulatif de votre commande</div>
              <div class="info-box">
                <div class="info-row">
                  <span class="info-label">Produit</span>
                  <span class="info-value">${data.productName}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Quantité</span>
                  <span class="info-value">${data.quantity}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Prix unitaire</span>
                  <span class="info-value">${data.unitPrice.toFixed(2)} €</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Mode</span>
                  <span class="info-value">${isShipping ? 'Livraison' : 'Retrait'}</span>
                </div>
                ${isShipping ? `
                <div class="info-row">
                  <span class="info-label">Frais de livraison</span>
                  <span class="info-value">${resolvedDeliveryFee.toFixed(2)} €</span>
                </div>
                ` : ''}
              </div>
              <div class="total-box" style="margin-top: 15px;">
                <span class="label">${isShipping ? 'Total à régler' : 'Total à payer sur place'}</span>
                <span class="amount">${data.totalAmount.toFixed(2)} €</span>
              </div>
            </div>

            <div class="section">
              <div class="section-title">${isShipping ? 'Livraison' : 'Lieu de retrait'}</div>
              <div class="info-box">
                <div class="info-row">
                  <span class="info-label">Producteur</span>
                  <span class="info-value">${data.producerName}</span>
                </div>
                ${!isShipping && data.pickupLocation ? `
                <div class="info-row">
                  <span class="info-label">Adresse</span>
                  <span class="info-value">${data.pickupLocation}</span>
                </div>
                ` : ''}
                ${!isShipping && data.pickupInstructions ? `
                <div class="info-row">
                  <span class="info-label">Instructions</span>
                  <span class="info-value">${data.pickupInstructions}</span>
                </div>
                ` : ''}
                ${isShipping && data.deliveryAddress ? `
                <div class="info-row">
                  <span class="info-label">Adresse</span>
                  <span class="info-value">${data.deliveryAddress}</span>
                </div>
                ` : ''}
                ${isShipping && data.deliveryInstructions ? `
                <div class="info-row">
                  <span class="info-label">Instructions</span>
                  <span class="info-value">${data.deliveryInstructions}</span>
                </div>
                ` : ''}
              </div>
            </div>

            <div class="payment-notice">
              <strong>💰 Paiement</strong><br>
              ${paymentNotice}
            </div>
          </div>

          <div class="footer">
            <p>Merci d'utiliser le Marché Local des Chanvriers Unis !</p>
            <p>Pour toute question, contactez le producteur: ${data.producerEmail}</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

const handler = createValidatedHandler<LocalMarketOrderEmailInput>(
  {
    schema: localMarketOrderEmailSchema,
    rateLimit: RATE_LIMIT_PRESETS.ORDERS,
    functionName: 'send-local-market-order-email',
  },
  async ({ user, data, supabase, responseCorsHeaders }) => {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    const role = profile?.role ?? 'user';
    if (role !== 'producer' && role !== 'admin') {
      return new Response(JSON.stringify({ error: 'FORBIDDEN', message: 'Producer or admin role required' }), {
        status: 403,
        headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const producerEmailHTML = generateProducerEmailHTML(data as LocalMarketOrderEmailRequest);
    const customerEmailHTML = generateCustomerEmailHTML(data as LocalMarketOrderEmailRequest);

    const producerEmailSent = await sendEmail(
      data.producerEmail,
      `Nouvelle commande Marché Local #${data.orderId.slice(0, 8)}`,
      producerEmailHTML,
      [COMPANY_EMAIL]
    );

    const customerEmailSent = await sendEmail(
      data.customerEmail,
      `Confirmation de votre commande #${data.orderId.slice(0, 8)}`,
      customerEmailHTML
    );

    return new Response(
      JSON.stringify({
        success: true,
        producerEmailSent,
        customerEmailSent,
      }),
      { status: 200, headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' } }
    );
  }
);

serve(handler);
