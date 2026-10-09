import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Cliente con service_role. SOLO servidor, y solo despues de verificar que
 * quien llama es un comprador activo (ver lib/auth/guards.ts).
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
