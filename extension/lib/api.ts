import { createClient, type SupportedStorage } from '@supabase/supabase-js';
import type { Term, TrackedProfessor } from './types';

/** Supabase session lives in extension storage (service workers have no localStorage). */
const extensionStorage: SupportedStorage = {
  async getItem(key) {
    const r = await browser.storage.local.get(key);
    return (r[key] as string | undefined) ?? null;
  },
  async setItem(key, value) {
    await browser.storage.local.set({ [key]: value });
  },
  async removeItem(key) {
    await browser.storage.local.remove(key);
  },
};

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
  auth: {
    storage: extensionStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    flowType: 'implicit',
  },
});

export async function currentUser() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

export async function sendMagicLink(email: string) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: browser.runtime.getURL('/auth.html') },
  });
  if (error) throw error;
}

/** auth.html receives `#access_token=...&refresh_token=...` from the magic link. */
export async function completeSignIn(url: string) {
  const hash = new URL(url).hash.slice(1);
  const p = new URLSearchParams(hash);
  const access_token = p.get('access_token');
  const refresh_token = p.get('refresh_token');
  if (!access_token || !refresh_token) throw new Error(p.get('error_description') ?? 'Sign-in link is missing tokens');
  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) throw error;
}

export async function upsertTerm(userId: string, t: Term) {
  const { error } = await supabase
    .from('terms')
    .upsert({ user_id: userId, term_key: t.key, label: t.label, end_date: t.endDate });
  if (error) throw error;
}

export async function upsertProfessor(userId: string, p: TrackedProfessor) {
  const { error } = await supabase.from('tracked_professors').upsert(
    {
      user_id: userId,
      rmp_id: p.rmpId,
      name: p.name,
      school: p.school,
      term_key: p.termKey,
      status: p.status,
    },
    { onConflict: 'user_id,rmp_id,term_key' },
  );
  if (error) throw error;
}

export async function deleteProfessor(userId: string, rmpId: number, termKey: string) {
  const { error } = await supabase
    .from('tracked_professors')
    .delete()
    .match({ user_id: userId, rmp_id: rmpId, term_key: termKey });
  if (error) throw error;
}

export async function markDoneRemote(userId: string, rmpId: number) {
  const { error } = await supabase
    .from('tracked_professors')
    .update({ status: 'done' })
    .match({ user_id: userId, rmp_id: rmpId, status: 'waiting' });
  if (error) throw error;
}

export async function fetchRemote(): Promise<{ terms: Term[]; professors: TrackedProfessor[] }> {
  const [t, p] = await Promise.all([
    supabase.from('terms').select('term_key,label,end_date'),
    supabase.from('tracked_professors').select('rmp_id,name,school,term_key,status,nudges_sent'),
  ]);
  if (t.error) throw t.error;
  if (p.error) throw p.error;
  return {
    terms: t.data.map((r) => ({ key: r.term_key, label: r.label, endDate: r.end_date })),
    professors: p.data.map((r) => ({
      rmpId: r.rmp_id,
      name: r.name,
      school: r.school,
      termKey: r.term_key,
      status: r.status,
      nudgesSent: r.nudges_sent,
      synced: true,
    })),
  };
}

export async function deleteAccount() {
  const { error } = await supabase.rpc('delete_my_account');
  if (error) throw error;
  await supabase.auth.signOut({ scope: 'local' });
}
