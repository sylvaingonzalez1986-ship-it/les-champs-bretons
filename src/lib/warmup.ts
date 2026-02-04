import { SUPABASE_URL, SUPABASE_ANON_KEY, getValidSession } from './supabase-auth';

async function warmPublicCatalog(): Promise<void> {
  await fetch(
    `${SUPABASE_URL}/functions/v1/public-catalog?action=producers&limit=1&offset=0`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    }
  );
}

async function warmCreateDirectSaleOrders(): Promise<void> {
  const session = await getValidSession();
  const token = session?.access_token;
  if (!token) return;

  await fetch(`${SUPABASE_URL}/functions/v1/create-direct-sale-orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-warmup': '1',
    },
    body: JSON.stringify({}),
  });
}

export async function warmEdgeFunctions(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;

  try {
    await Promise.allSettled([warmPublicCatalog(), warmCreateDirectSaleOrders()]);
  } catch {
    // Ignore warmup failures
  }
}
