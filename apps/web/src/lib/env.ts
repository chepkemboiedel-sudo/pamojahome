// Reads configuration once, with clear errors when something is missing.

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing environment variable ${name}. See apps/web/.env.example.`);
  return value;
}

export const publicEnv = {
  supabaseUrl: () => required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: () => required('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  /**
   * Base URL for links in emails. Set NEXT_PUBLIC_SITE_URL for a custom domain; on Vercel it
   * otherwise falls back to the production domain Vercel provides (used on the server only).
   */
  siteUrl: () =>
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '') ||
    'http://localhost:3000',
};

/** Server-only secrets. Importing this from a client component is a bug. */
export const serverEnv = {
  serviceRoleKey: () => required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY),
  cronSecret: () => required('CRON_SECRET', process.env.CRON_SECRET),
};
