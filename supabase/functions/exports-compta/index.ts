import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { getCorsHeaders, isOriginAllowed } from "../_shared/cors.ts";
import {
  checkRateLimit,
  createRateLimitResponse,
  logSecurityEvent,
  RATE_LIMIT_PRESETS,
} from "../_shared/rate-limit.ts";

interface ProduitVente {
  nom: string;
  categorie: string;
  quantite: number;
  prix_unitaire_ht: number;
  taux_tva: number;
}

interface Vente {
  id: string;
  date: string;
  client_nom: string;
  client_email: string | null;
  total_ht: number;
  total_tva: number;
  total_ttc: number;
  produits: ProduitVente[];
}

interface RequestBody {
  depuis?: string | null;
  format?: string;
}

const requestSchema = z.object({
  depuis: z.string().datetime().optional().nullable(),
  format: z.literal("json").optional(),
});

function calculateTotals(lignes: any[]): { ht: number; tva: number; ttc: number } {
  let totalHt = 0;
  let totalTva = 0;

  for (const ligne of lignes) {
    const prixUnitaireHt = ligne.prix_unitaire_ht ?? ligne.prix_unitaire ?? 0;
    const quantite = ligne.quantite ?? 1;
    const tauxTva = ligne.taux_tva ?? 20;

    const ligneHt = prixUnitaireHt * quantite;
    const ligneTva = ligneHt * (tauxTva / 100);

    totalHt += ligneHt;
    totalTva += ligneTva;
  }

  return {
    ht: Math.round(totalHt * 100) / 100,
    tva: Math.round(totalTva * 100) / 100,
    ttc: Math.round((totalHt + totalTva) * 100) / 100,
  };
}

serve(async (req) => {
  const responseCorsHeaders = getCorsHeaders(req);
  const origin = req.headers.get("origin");

  if (!isOriginAllowed(origin)) {
    return new Response(JSON.stringify({ error: "CORS_NOT_ALLOWED" }), {
      status: 403,
      headers: { ...responseCorsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: responseCorsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...responseCorsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // 1. Vérification du Bearer Token
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", message: "Missing or invalid Authorization header" }),
        { status: 401, headers: { ...responseCorsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const apiKey = Deno.env.get("COMPTA_API_KEY");

    if (!apiKey) {
      console.error("COMPTA_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Server Error", message: "API configuration error" }),
        { status: 500, headers: { ...responseCorsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (token !== apiKey) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", message: "Invalid API key" }),
        { status: 401, headers: { ...responseCorsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
    const userAgent = req.headers.get("user-agent") || "unknown";
    const rateLimitResult = await checkRateLimit(ip, RATE_LIMIT_PRESETS.GENERAL);

    if (!rateLimitResult.allowed) {
      logSecurityEvent({
        userId: ip,
        action: "rate_limit_exceeded",
        endpoint: "exports-compta",
        ip,
        userAgent,
        success: false,
        reason: `Exceeded ${RATE_LIMIT_PRESETS.GENERAL.limit} requests per window`,
      });
      return createRateLimitResponse(rateLimitResult, RATE_LIMIT_PRESETS.GENERAL, responseCorsHeaders);
    }

    // 2. Parse du body
    let body: RequestBody = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "VALIDATION_ERROR", details: parsed.error.errors }),
        { status: 400, headers: { ...responseCorsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { depuis, format = "json" } = parsed.data;

    if (format !== "json") {
      return new Response(
        JSON.stringify({ error: "Bad Request", message: "Only JSON format is supported" }),
        { status: 400, headers: { ...responseCorsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Connexion à Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 4. Construction de la requête
    let query = supabase
      .from("commandes")
      .select(`
        id,
        created_at,
        statut,
        total_ht,
        total_tva,
        total_ttc,
        client:clients (
          id,
          nom,
          prenom,
          email
        ),
        lignes_commande (
          id,
          quantite,
          prix_unitaire,
          prix_unitaire_ht,
          taux_tva,
          produit:produits (
            id,
            nom,
            categorie
          )
        )
      `)
      .in("statut", ["terminee", "payee", "TERMINEE", "PAYEE", "Terminée", "Payée"]);

    // Filtre par date si fourni
    if (depuis) {
      query = query.gte("created_at", depuis);
    }

    query = query.order("created_at", { ascending: true });

    const { data: commandes, error } = await query;

    if (error) {
      console.error("Database error:", error);
      return new Response(
        JSON.stringify({ error: "Database Error", message: error.message }),
        { status: 500, headers: { ...responseCorsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Mapping vers le format de réponse
    const ventes: Vente[] = (commandes || []).map((commande: any) => {
      const client = commande.client || {};
      const lignes = commande.lignes_commande || [];

      const produits: ProduitVente[] = lignes.map((ligne: any) => {
        const produit = ligne.produit || {};
        const tauxTva = ligne.taux_tva ?? 20;
        const prixUnitaireHt = ligne.prix_unitaire_ht ?? 
          (ligne.prix_unitaire ? ligne.prix_unitaire / (1 + tauxTva / 100) : 0);

        return {
          nom: produit.nom || "Produit inconnu",
          categorie: produit.categorie || "Autre",
          quantite: ligne.quantite ?? 1,
          prix_unitaire_ht: Math.round(prixUnitaireHt * 100) / 100,
          taux_tva: tauxTva,
        };
      });

      let totalHt = commande.total_ht;
      let totalTva = commande.total_tva;
      let totalTtc = commande.total_ttc;

      if (totalHt == null || totalTva == null || totalTtc == null) {
        const calculated = calculateTotals(produits);
        totalHt = totalHt ?? calculated.ht;
        totalTva = totalTva ?? calculated.tva;
        totalTtc = totalTtc ?? calculated.ttc;
      }

      const clientNom = [client.prenom, client.nom].filter(Boolean).join(" ") || "Client inconnu";

      return {
        id: `CMD-${commande.id}`,
        date: commande.created_at,
        client_nom: clientNom,
        client_email: client.email || null,
        total_ht: Math.round(totalHt * 100) / 100,
        total_tva: Math.round(totalTva * 100) / 100,
        total_ttc: Math.round(totalTtc * 100) / 100,
        produits,
      };
    });

    try {
      await supabase.from("audit_log_entries").insert({
        user_id: null,
        action: "export_compta",
        table_name: "commandes",
        record_id: null,
        old_data: null,
        new_data: {
          count: ventes.length,
          depuis: depuis ?? null,
          format,
        },
        ip_address: ip,
        user_agent: userAgent,
      });
    } catch {
      // Ignore audit logging failures to avoid blocking export
    }

    return new Response(
      JSON.stringify({ ventes }),
      {
        status: 200,
        headers: {
          ...responseCorsHeaders,
          "Content-Type": "application/json",
          "X-Total-Count": ventes.length.toString(),
        },
      }
    );

  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "Server Error", message: "An unexpected error occurred" }),
      { status: 500, headers: { ...responseCorsHeaders, "Content-Type": "application/json" } }
    );
  }
});
