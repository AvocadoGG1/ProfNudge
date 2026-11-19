// One-click links from the nudge email: ?a=done|skip&t=<tracked_professor id> or ?a=unsub&t=<user id>, signed with k.
// GET shows a confirm button (so link scanners in mail clients don't trigger actions); POST applies it.
// POST with List-Unsubscribe=One-Click applies unsubscribe directly (RFC 8058).

import { adminClient } from '../_shared/db.ts';
import { type Action, verify } from '../_shared/tokens.ts';

const LABEL: Record<Action, [button: string, done: string]> = {
  done: ['Mark as reviewed', 'Marked as reviewed. Thanks for helping future students!'],
  skip: ['Skip this professor', "Skipped. We won't remind you about this professor again."],
  unsub: ['Unsubscribe from all reminders', "You're unsubscribed. No more ProfNudge emails."],
};

const page = (body: string, status = 200) =>
  new Response(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>ProfNudge</title>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;padding:16px">
<main style="max-width:420px;text-align:center">${body}</main></body>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const a = url.searchParams.get('a') as Action | null;
  const t = url.searchParams.get('t') ?? '';
  const k = url.searchParams.get('k') ?? '';

  if (!a || !(a in LABEL) || !(await verify(a, t, k))) return page('<h1>Link expired or invalid</h1>', 400);

  if (req.method === 'GET') {
    return page(`<h1>ProfNudge</h1>
<form method="post" action="${url.pathname}${url.search}">
<button style="font:inherit;font-weight:600;background:#3b5bdb;color:#fff;border:0;border-radius:999px;padding:10px 20px;cursor:pointer">${LABEL[a][0]}</button>
</form>`);
  }
  if (req.method !== 'POST') return page('Method not allowed', 405);

  const db = adminClient();
  const { error } =
    a === 'unsub'
      ? await db.from('user_settings').upsert({ user_id: t, unsubscribed: true })
      : await db
          .from('tracked_professors')
          .update({ status: a === 'done' ? 'done' : 'skipped' })
          .eq('id', t)
          .eq('status', 'waiting');

  if (error) return page('<h1>Something went wrong</h1><p>Please try again later.</p>', 500);
  return page(`<h1>Done</h1><p>${LABEL[a][1]}</p>`);
});
