-- Daily nudge job. Runs at 16:00 UTC (8–9am US Pacific, 11am–noon US Eastern).
-- The project URL and CRON_SECRET are read from Supabase Vault at run time, so no
-- secret is stored in this migration. scripts/deploy-backend.sh writes both vault entries:
--   profnudge_project_url  e.g. https://abcd.supabase.co
--   profnudge_cron_secret  same value as the send-nudges CRON_SECRET function secret

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'profnudge-send-nudges',
  '0 16 * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'profnudge_project_url')
               || '/functions/v1/send-nudges',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'profnudge_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
