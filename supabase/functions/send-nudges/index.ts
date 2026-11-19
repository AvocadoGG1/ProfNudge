// Daily job: email each student once, listing every tracked professor whose next nudge is due.
// Invoked by pg_cron (see supabase/migrations/*_cron.sql) with `Authorization: Bearer <CRON_SECRET>`.

import { adminClient } from '../_shared/db.ts';
import { isDue, MAX_NUDGES } from '../_shared/schedule.ts';
import { actionUrl, confirmUrl } from '../_shared/tokens.ts';

const RMP = 'https://www.ratemyprofessors.com';

interface Row {
  id: string;
  user_id: string;
  rmp_id: number;
  name: string;
  school: string;
  nudges_sent: number;
  last_nudged_at: string | null;
  terms: { label: string; end_date: string };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function renderEmail(userId: string, rows: Row[]) {
  const links = await Promise.all(
    rows.map(async (r) => {
      const [done, skip] = await Promise.all([confirmUrl('done', r.id), confirmUrl('skip', r.id)]);
      return { r, done, skip };
    }),
  );
  const items = links.map(({ r, done, skip }) => `
<tr><td style="padding:12px 0;border-bottom:1px solid #eee">
  <strong>${esc(r.name)}</strong><br><span style="color:#666;font-size:13px">${esc(r.school)} · ${esc(r.terms.label)}</span><br>
  <a href="${RMP}/add/professor-rating/${r.rmp_id}" style="display:inline-block;margin-top:8px;background:#3b5bdb;color:#fff;padding:8px 16px;border-radius:999px;text-decoration:none;font-weight:600">Review now</a>
  &nbsp;<a href="${done}" style="color:#666;font-size:13px">Already reviewed</a>
  &nbsp;·&nbsp;<a href="${skip}" style="color:#666;font-size:13px">Skip</a>
</td></tr>`);
  const unsub = await confirmUrl('unsub', userId);
  // RFC 8058 one-click POST from the mail client goes straight to the function.
  const oneClickUnsub = await actionUrl('unsub', userId);
  const n = rows.length;
  const subject =
    n === 1 ? `How was ${rows[0].name}? Leave a 1-minute review` : `${n} professors are waiting for your review`;
  const html = `
<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;color:#111">
  <h2 style="margin:0 0 8px">Your term is over 🎓</h2>
  <p>Future students pick classes based on reviews like yours. ProfNudge fills in the form for you — it takes about a minute.</p>
  <table style="width:100%;border-collapse:collapse">${items.join('')}</table>
  <p style="color:#999;font-size:12px;margin-top:24px">
    You get at most 3 reminders per class. ProfNudge never sees your review.
    <a href="${unsub}" style="color:#999">Unsubscribe</a><br>
    ProfNudge is not affiliated with Rate My Professors.
  </p>
</div>`;
  // Plain text (see SEND_HTML): no hyperlinked words, so keep each link on its own line
  // under a short label, and keep the links short.
  const terms = [...new Set(rows.map((r) => r.terms.label))].join(' and ');
  const rule = '─'.repeat(28);
  const text = [
    `${terms} is over 🎓`,
    '',
    n === 1
      ? 'How was your professor? Your review helps the next students pick their classes, and ProfNudge fills in the form for you. It takes about a minute.'
      : `How were your ${n} professors? Your reviews help the next students pick their classes, and ProfNudge fills in the form for you. About a minute each.`,
    '',
    ...links.flatMap(({ r, done, skip }) => [
      rule,
      `👩‍🏫 ${r.name}`,
      ...(r.school ? [`   ${r.school}`] : []),
      '',
      '   ✏️ Leave a review:',
      `   ${RMP}/add/professor-rating/${r.rmp_id}`,
      '',
      '   ✅ Already reviewed:',
      `   ${done}`,
      '',
      '   ⏭️ Skip this professor:',
      `   ${skip}`,
      '',
    ]),
    rule,
    '',
    'At most 3 reminders per class. ProfNudge never sees your review.',
    `Stop all reminders: ${unsub}`,
    '',
    'ProfNudge · not affiliated with Rate My Professors',
  ].join('\n');
  return { subject, html, text, oneClickUnsub };
}

/**
 * Resend rewrites links in HTML email through its click-tracking host (resend-clicks.com),
 * which some network filters block (e.g. ISP "security shield" routers). Plain-text email
 * links are left alone. Send HTML only once you use your own domain with click tracking
 * turned off in Resend, and set the EMAIL_HTML=true function secret.
 */
const SEND_HTML = Deno.env.get('EMAIL_HTML') === 'true';

Deno.serve(async (req) => {
  if (req.headers.get('Authorization') !== `Bearer ${Deno.env.get('CRON_SECRET')}`) {
    return new Response('forbidden', { status: 403 });
  }

  const db = adminClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await db
    .from('tracked_professors')
    .select('id,user_id,rmp_id,name,school,nudges_sent,last_nudged_at,terms!inner(label,end_date)')
    .eq('status', 'waiting')
    .lt('nudges_sent', MAX_NUDGES)
    .lte('terms.end_date', today);
  if (error) return new Response(error.message, { status: 500 });

  const due = (data as unknown as Row[]).filter((r) => isDue(r.terms.end_date, r.nudges_sent, r.last_nudged_at, today));
  const byUser = Map.groupBy(due, (r) => r.user_id);

  // If this lookup fails we must not fall back to emailing everyone, unsubscribed users included.
  const { data: unsubbed, error: unsubErr } = await db.from('user_settings').select('user_id').eq('unsubscribed', true);
  if (unsubErr) return new Response(unsubErr.message, { status: 500 });
  const skipUsers = new Set((unsubbed ?? []).map((u) => u.user_id));

  let sent = 0;
  const failures: string[] = [];
  for (const [userId, rows] of byUser) {
    if (skipUsers.has(userId)) continue;
    const { data: u } = await db.auth.admin.getUserById(userId);
    const to = u?.user?.email;
    if (!to) continue;

    const { subject, html, text, oneClickUnsub } = await renderEmail(userId, rows);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: Deno.env.get('MAIL_FROM'),
        to,
        subject,
        text,
        ...(SEND_HTML ? { html } : {}),
        headers: { 'List-Unsubscribe': `<${oneClickUnsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      }),
    });
    if (!res.ok) {
      failures.push(`${userId}: ${res.status}`);
      continue;
    }
    sent++;
    const now = new Date().toISOString();
    const updates = await Promise.all(
      rows.map((r) =>
        db.from('tracked_professors').update({ nudges_sent: r.nudges_sent + 1, last_nudged_at: now }).eq('id', r.id),
      ),
    );
    // The email went out but the bookkeeping didn't: surface it, since tomorrow's run would repeat this nudge.
    updates.forEach((u, i) => u.error && failures.push(`update ${rows[i]!.id}: ${u.error.message}`));
  }

  return Response.json({ today, due: due.length, emailsSent: sent, failures });
});
