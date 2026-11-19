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

/**
 * Sign-in is a one-time code typed into the extension, not a magic link: school mail
 * filters (e.g. Microsoft Safe Links) open links to scan them, which uses up a magic link
 * before the student clicks it. A scanner can't type a code.
 * The Supabase "Magic Link" and "Confirm signup" email templates must show {{ .Token }}.
 */
export async function sendCode(email: string) {
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw error;
}

export async function verifyCode(email: string, code: string) {
  const { error } = await supabase.auth.verifyOtp({ email, token: code.replace(/\s/g, ''), type: 'email' });
  if (error) throw new Error(/expired|invalid/i.test(error.message) ? 'That code is wrong or expired. Check it, or send a new one.' : error.message);
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
