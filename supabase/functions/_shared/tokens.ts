// Signed one-click links for the email (Already reviewed / Skip / Unsubscribe).
// Token = base64url(HMAC-SHA256(ACTION_SECRET, "<action>:<target>")), truncated to 128 bits
// so the links stay short enough to read in a plain-text email.

export type Action = 'done' | 'skip' | 'unsub';

const enc = new TextEncoder();
/** 16 bytes of HMAC = 22 base64url characters. */
const SHORT_LEN = 22;

async function key() {
  const secret = Deno.env.get('ACTION_SECRET');
  if (!secret || secret.length < 32) throw new Error('ACTION_SECRET must be set (32+ chars)');
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function fullSig(action: Action, target: string) {
  return b64url(await crypto.subtle.sign('HMAC', await key(), enc.encode(`${action}:${target}`)));
}

/** Constant-time string comparison. */
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sign(action: Action, target: string): Promise<string> {
  return (await fullSig(action, target)).slice(0, SHORT_LEN);
}

/** Accepts the short token, and the full-length one that earlier emails carried. */
export async function verify(action: Action, target: string, token: string): Promise<boolean> {
  try {
    const full = await fullSig(action, target);
    return same(token, full.slice(0, SHORT_LEN)) || same(token, full);
  } catch {
    return false;
  }
}

export async function actionUrl(action: Action, target: string): Promise<string> {
  const base = `${Deno.env.get('SUPABASE_URL')}/functions/v1/nudge-action`;
  const q = new URLSearchParams({ a: action, t: target, k: await sign(action, target) });
  return `${base}?${q}`;
}

/**
 * Link for the email body. Supabase serves Edge Function HTML as text/plain on its default
 * domain, so the confirm page is a static page (docs/confirm.html, hosted on GitHub Pages)
 * set as CONFIRM_URL. It shows the button and POSTs back to nudge-action. The page knows
 * this project's API URL (DEFAULT_API in confirm.html), so the link doesn't carry it.
 */
export async function confirmUrl(action: Action, target: string): Promise<string> {
  const page = Deno.env.get('CONFIRM_URL');
  if (!page) return actionUrl(action, target);
  const q = new URLSearchParams({ a: action, t: target, k: await sign(action, target) });
  return `${page}?${q}`;
}
