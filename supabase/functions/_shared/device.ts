import { SupabaseClient, User } from 'https://esm.sh/@supabase/supabase-js@2';

const REQUIRE_DEVICE_BINDING = Deno.env.get('REQUIRE_DEVICE_BINDING') === 'true';

function normalizeDeviceId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 128) return null;
  return trimmed;
}

export async function verifyDeviceBinding(
  req: Request,
  user: User,
  supabase: SupabaseClient,
  corsHeaders: Record<string, string>
): Promise<Response | null> {
  if (!REQUIRE_DEVICE_BINDING) return null;

  const deviceIdHeader = req.headers.get('X-Device-Id');
  const deviceId = deviceIdHeader ? normalizeDeviceId(deviceIdHeader) : null;
  if (!deviceId) {
    return new Response(JSON.stringify({ error: 'DEVICE_ID_REQUIRED' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('device_id')
    .eq('id', user.id)
    .single();

  if (error) {
    return new Response(JSON.stringify({ error: 'DEVICE_BINDING_UNAVAILABLE' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!profile?.device_id) {
    return new Response(JSON.stringify({ error: 'DEVICE_NOT_BOUND' }), {
      status: 409,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (profile.device_id !== deviceId) {
    return new Response(JSON.stringify({ error: 'DEVICE_MISMATCH' }), {
      status: 409,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return null;
}