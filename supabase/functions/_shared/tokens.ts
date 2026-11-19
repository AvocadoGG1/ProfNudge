// Signed one-click links for the email (Already reviewed / Skip / Unsubscribe).
// Token = base64url(HMAC-SHA256(ACTION_SECRET, "<action>:<target>")).

export type Action = 'done' | 'skip' | 'unsub';

const enc = new TextEncoder();

async function key() {
  const secret = Deno.env.get('ACTION_SECRET');
  if (!secret || secret.length < 32) throw new Error('ACTION_SECRET must be set (32+ chars)');
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

export async function sign(action: Action, target: string): Promise<string> {
  return b64url(await crypto.subtle.sign('HMAC', await key(), enc.encode(`${action}:${target}`)));
}

export async function verify(action: Action, target: string, token: string): Promise<boolean> {
  try {
    return await crypto.subtle.verify('HMAC', await key(), fromB64url(token), enc.encode(`${action}:${target}`));
  } catch {
    return false;
  }
}

export async function actionUrl(action: Action, target: string): Promise<string> {
  const base = `${Deno.env.get('SUPABASE_URL')}/functions/v1/nudge-action`;
  const q = new URLSearchParams({ a: action, t: target, k: await sign(action, target) });
  return `${base}?${q}`;
}
