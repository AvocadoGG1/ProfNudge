// Supabase Auth "Send Email" hook: Supabase hands us each sign-in email and we send it
// through Resend with our own template, which shows the one-time code.
//
// Why: students sign in by typing a code, because school mail filters open links to scan
// them and would use up a magic link. Supabase only lets you edit its own templates once
// custom SMTP is set up; this hook avoids that and reuses RESEND_API_KEY / MAIL_FROM.
//
// Configured in Authentication > Auth Hooks (Send Email, HTTPS) with SEND_EMAIL_HOOK_SECRET.

import { Webhook } from 'npm:standardwebhooks@1.0.0';

interface HookPayload {
  user: { email: string };
  email_data: { token: string; email_action_type: string };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function render(code: string) {
  const subject = `Your ProfNudge code: ${code}`;
  const html = `
<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;color:#111">
  <h2 style="margin:0 0 8px">Your ProfNudge sign-in code</h2>
  <p>Type this code into ProfNudge to finish signing in:</p>
  <p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:16px 0">${esc(code)}</p>
  <p style="color:#666;font-size:13px">It expires soon and works once. If you didn't ask for it, you can ignore this email.</p>
  <p style="color:#999;font-size:12px">ProfNudge is not affiliated with Rate My Professors.</p>
</div>`;
  const text = `Your ProfNudge sign-in code: ${code}\n\nType it into ProfNudge to finish signing in. If you didn't ask for it, ignore this email.`;
  return { subject, html, text };
}

const fail = (status: number, message: string) =>
  Response.json({ error: { http_code: status, message } }, { status });

Deno.serve(async (req) => {
  const secret = Deno.env.get('SEND_EMAIL_HOOK_SECRET');
  if (!secret) return fail(500, 'SEND_EMAIL_HOOK_SECRET is not set');

  const body = await req.text();
  let payload: HookPayload;
  try {
    payload = new Webhook(secret.replace(/^v1,whsec_/, '')).verify(
      body,
      Object.fromEntries(req.headers),
    ) as HookPayload;
  } catch {
    return fail(401, 'Invalid hook signature');
  }

  const { subject, html, text } = render(payload.email_data.token);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: Deno.env.get('MAIL_FROM'), to: payload.user.email, subject, html, text }),
  });
  if (!res.ok) {
    const detail = `Resend returned ${res.status}: ${await res.text()}`;
    console.error(detail);
    return fail(502, detail);
  }

  return Response.json({});
});
