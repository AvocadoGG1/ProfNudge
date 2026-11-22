# ProfNudge

**Finish the class. Leave the review.**

ProfNudge is an open-source browser extension that reminds you to rate your professors when the term ends, and turns the review into a one-minute job. It works with Rate My Professors at any school.

> ProfNudge is not affiliated with, endorsed by, or sponsored by Rate My Professors.

## How it works

1. **Track** — paste your class schedule into *Add professors* in the ProfNudge popup, or click *Track* on a professor's Rate My Professors page.
2. **Get nudged** — when your term ends you get one email listing everyone you haven't reviewed yet (three emails max, then it stops).
3. **Review in a minute** — *Review now* opens the rating page. Tap scores and tags, answer a few sentence starters, hit *Fill form*. You check it and click Submit yourself.

## Privacy

The server only knows your email and which professors to remind you about. **Your review text, scores and grade never leave your browser.** See [PRIVACY.md](PRIVACY.md).

## Repo layout

```
extension/   WXT + TypeScript browser extension
supabase/    Postgres schema + Edge Functions (send-nudges, nudge-action)
SPEC.md      v1 design decisions
```

## Development

### Backend (Supabase + Resend)

1. Create a Supabase project and a Resend account.
2. From the repo root, run the deploy script. It logs in, links the project, applies migrations
   (schema + daily cron job), sets function secrets, stores the cron secret in Vault,
   deploys both Edge Functions and writes `extension/.env`:
   ```bash
   bash scripts/deploy-backend.sh <project-ref>
   ```
3. Finish the three dashboard steps the script prints: verify your Resend domain, point
   Supabase Auth's SMTP at Resend, and turn on the **Send Email** auth hook so sign-in codes go
   out through [`send-auth-email`](supabase/functions/send-auth-email/index.ts) (students type a
   code; school mail scanners would use up a magic link).
4. Host the email confirm page. Supabase serves Edge Function HTML as plain text, so the
   *Already reviewed / Skip / Unsubscribe* links open [`docs/confirm.html`](docs/confirm.html)
   instead. Enable GitHub Pages (branch `main`, folder `/docs`) and enter
   `https://<user>.github.io/<repo>/confirm.html` when the deploy script asks for the confirm page URL.

### Extension

```bash
cd extension
cp .env.example .env   # fill in Supabase URL + anon key
npm install
npm run dev            # opens Chrome with the extension loaded
npm run build          # production build in .output/chrome-mv3
npm run zip            # zip for the Chrome Web Store
```

## When RMP changes its form

All Rate My Professors selectors live in [`extension/lib/rmp.ts`](extension/lib/rmp.ts). If autofill stops working, that is the only file that should need changes.

## License

MIT
