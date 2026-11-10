import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient as createPlainClient } from '@supabase/supabase-js';
import { publicEnv, serverEnv } from '@/lib/env';

/** Client acting as the signed-in user. Row-level security limits it to their household. */
export async function createClient() {
  const store = await cookies();
  return createServerClient(publicEnv.supabaseUrl(), publicEnv.supabaseAnonKey(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. The middleware refreshes the session.
        }
      },
    },
  });
}

/**
 * Service-role client for scheduled jobs only (allocation, DD-16). It bypasses
 * row-level security, so never use it to answer a user's request.
 */
export function createServiceClient() {
  return createPlainClient(publicEnv.supabaseUrl(), serverEnv.serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
