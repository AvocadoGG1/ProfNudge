import { createClient } from 'npm:@supabase/supabase-js@2';

/** Admin client. Newer projects expose secret keys as JSON in SUPABASE_SECRET_KEYS; older ones as SUPABASE_SERVICE_ROLE_KEY. */
export function adminClient() {
  let key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) {
    const raw = Deno.env.get('SUPABASE_SECRET_KEYS');
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, string>;
      key = parsed.default ?? Object.values(parsed)[0];
    }
  }
  if (!key) throw new Error('No service key available to the function');
  return createClient(Deno.env.get('SUPABASE_URL')!, key);
}
