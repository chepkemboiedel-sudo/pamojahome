-- Weekly allocation job (DD-16). Supabase Cron calls the app hourly on Mondays (UTC);
-- the app shares out each household's week once its local Monday has begun, and
-- later calls that week change nothing.
--
-- The job holds no secrets. Before it can succeed, add two Vault secrets
-- (Supabase dashboard → Integrations → Vault):
--   app_url      the deployed app's address, e.g. https://pamojahome.vercel.app (no trailing slash)
--   cron_secret  the same value as the app's CRON_SECRET environment variable
--
-- Runs only where pg_cron is enabled and pg_net is available, so plain Postgres
-- (and the schema tests) skip it.
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
    -- cron.schedule replaces a job with the same name, so rerunning this is safe.
    perform cron.schedule('pamoja-weekly-allocation', '0 * * * 1', $job$
      select net.http_post(
        url     := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron/allocate',
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'Authorization', 'Bearer ' ||
                       (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
        timeout_milliseconds := 60000)
    $job$);
  end if;
end $do$;
