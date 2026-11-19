// Applies the signed one-click actions from the nudge email:
//   ?a=done|skip&t=<tracked_professor id>  or  ?a=unsub&t=<user id>, signed with k.
//
// Supabase serves Edge Function HTML as text/plain on its default domain, so this function
// renders no pages. The email links to a static confirm page (docs/confirm.html, CONFIRM_URL)
// that shows a button and POSTs here; the button keeps mail-client link scanners from
// triggering actions with a GET.
//   GET  -> redirect to the confirm page (for older emails that linked here directly)
//   POST -> apply the action, reply with JSON. Mail clients' RFC 8058 one-click unsubscribe
//           (body "List-Unsubscribe=One-Click") lands here too.

import { adminClient } from '../_shared/db.ts';
import { type Action, verify } from '../_shared/tokens.ts';

const MESSAGES: Record<Action, string> = {
  done: 'Marked as reviewed. Thanks for helping future students!',
  skip: "Skipped. We won't remind you about this professor again.",
  unsub: "You're unsubscribed. No more ProfNudge emails.",
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

const isAction = (a: string | null): a is Action => a !== null && Object.hasOwn(MESSAGES, a);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const a = url.searchParams.get('a');
  const t = url.searchParams.get('t') ?? '';
  const k = url.searchParams.get('k') ?? '';

  if (req.method === 'GET') {
    const page = Deno.env.get('CONFIRM_URL');
    if (!page) return new Response('Open this link from the ProfNudge email.', { status: 404 });
    const q = new URLSearchParams({ a: a ?? '', t, k, api: Deno.env.get('SUPABASE_URL')! });
    return Response.redirect(`${page}?${q}`, 302);
  }
  if (req.method !== 'POST') return json({ ok: false, message: 'Method not allowed' }, 405);

  if (!isAction(a) || !(await verify(a, t, k))) {
    return json({ ok: false, message: 'This link is expired or invalid.' }, 400);
  }

  const db = adminClient();
  const { error } =
    a === 'unsub'
      ? await db.from('user_settings').upsert({ user_id: t, unsubscribed: true })
      : await db
          .from('tracked_professors')
          .update({ status: a === 'done' ? 'done' : 'skipped' })
          .eq('id', t)
          .eq('status', 'waiting');

  if (error) return json({ ok: false, message: 'Something went wrong. Please try again later.' }, 500);
  return json({ ok: true, message: MESSAGES[a] });
});
