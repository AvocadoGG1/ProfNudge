#!/usr/bin/env bash
# Deploys the ProfNudge backend to a Supabase project you already created.
# Run from the repo root:   bash scripts/deploy-backend.sh <project-ref>
#
# It asks you for: your database password (by `supabase link`), your Resend API key,
# and the From address. Generated secrets go straight to Supabase and are never printed.
# Safe to re-run: existing ACTION_SECRET / CRON_SECRET are kept so old email links keep working.

set -euo pipefail
cd "$(dirname "$0")/.."

SB="npx --yes supabase"
REF="${1:-}"
if [[ -z "$REF" ]]; then
  read -rp "Supabase project ref (the 20 letters in your project URL): " REF
fi
URL="https://${REF}.supabase.co"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

step "Checking Supabase login"
if ! $SB projects list >/dev/null 2>&1; then
  echo "Not logged in. Opening the Supabase login..."
  $SB login
fi

step "Linking project $REF"
$SB link --project-ref "$REF"

step "Applying database migrations"
$SB db push --remote

step "Function secrets"
if $SB secrets list 2>/dev/null | grep -q "ACTION_SECRET"; then
  echo "ACTION_SECRET and CRON_SECRET already set; keeping them."
  NEW_SECRETS=0
else
  NEW_SECRETS=1
fi

read -rsp "Resend API key (input hidden, leave blank to keep the current one): " RESEND_KEY; echo
read -rp  'From address, e.g. ProfNudge <nudge@yourdomain.com> (blank = keep current): ' MAIL_FROM
read -rp  'Confirm page URL, e.g. https://<user>.github.io/ProfNudge/confirm.html (blank = keep current): ' CONFIRM_URL

: > "$TMP/secrets.env"
[[ -n "$RESEND_KEY" ]] && printf 'RESEND_API_KEY=%s\n' "$RESEND_KEY" >> "$TMP/secrets.env"
[[ -n "$MAIL_FROM"  ]] && printf 'MAIL_FROM="%s"\n' "$MAIL_FROM" >> "$TMP/secrets.env"
[[ -n "$CONFIRM_URL" ]] && printf 'CONFIRM_URL=%s\n' "$CONFIRM_URL" >> "$TMP/secrets.env"
if [[ "$NEW_SECRETS" == 1 ]]; then
  ACTION_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  CRON_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  printf 'ACTION_SECRET=%s\nCRON_SECRET=%s\n' "$ACTION_SECRET" "$CRON_SECRET" >> "$TMP/secrets.env"
fi
if [[ -s "$TMP/secrets.env" ]]; then
  $SB secrets set --env-file "$TMP/secrets.env"
else
  echo "Nothing to change."
fi

step "Storing the cron job's URL and secret in Vault"
{
  echo "do \$\$ declare v uuid; begin"
  echo "  select id into v from vault.secrets where name = 'profnudge_project_url';"
  echo "  if v is null then perform vault.create_secret('$URL', 'profnudge_project_url');"
  echo "  else perform vault.update_secret(v, '$URL'); end if;"
  if [[ "$NEW_SECRETS" == 1 ]]; then
    echo "  select id into v from vault.secrets where name = 'profnudge_cron_secret';"
    echo "  if v is null then perform vault.create_secret('$CRON_SECRET', 'profnudge_cron_secret');"
    echo "  else perform vault.update_secret(v, '$CRON_SECRET'); end if;"
  fi
  echo "end \$\$;"
} > "$TMP/vault.sql"
$SB db query --remote -f "$TMP/vault.sql"

step "Deploying Edge Functions"
$SB functions deploy send-nudges nudge-action send-auth-email --no-verify-jwt --use-api

step "Writing extension/.env"
$SB projects api-keys --output-format json > "$TMP/keys.json"
KEY="$(node -e "
  const raw = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
  const keys = Array.isArray(raw) ? raw : (raw.keys ?? raw.data ?? Object.values(raw).find(Array.isArray) ?? []);
  const pick = keys.find(k => k.type === 'publishable') ?? keys.find(k => k.name === 'anon');
  if (!pick) { console.error('Could not find a publishable/anon key'); process.exit(1); }
  console.log(pick.api_key ?? pick.apiKey ?? pick.key);
" "$TMP/keys.json")"
printf 'VITE_SUPABASE_URL=%s\nVITE_SUPABASE_ANON_KEY=%s\n' "$URL" "$KEY" > extension/.env
echo "Wrote extension/.env (the publishable key is meant to ship in the extension)."

step "Done. Three things left in the dashboards:"
cat <<EOF
 1. Resend: verify the domain you send from (Domains page).
 2. Supabase Auth emails: Supabase's built-in mailer only sends a few emails per hour.
    Point it at Resend: Authentication > Emails > SMTP Settings
    (host smtp.resend.com, port 465, user "resend", password = your Resend API key).
 3. Sign-in codes are sent by the send-auth-email function through Resend. Turn it on:
    Authentication > Auth Hooks > Send Email > HTTPS, URL
      $URL/functions/v1/send-auth-email
    then generate a secret and store it:  npx supabase secrets set SEND_EMAIL_HOOK_SECRET=<secret>
EOF
