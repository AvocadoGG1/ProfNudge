import * as api from '@/lib/api';
import type { Reply } from '@/lib/messaging';
import type { AppState, Msg, Term, TrackedProfessor } from '@/lib/types';

const KEY = 'profnudge:state';
type Local = Omit<AppState, 'email'>;

async function loadLocal(): Promise<Local> {
  const r = await browser.storage.local.get(KEY);
  return (r[KEY] as Local | undefined) ?? { pendingEmail: null, professors: [], terms: [] };
}
const saveLocal = (s: Local) => browser.storage.local.set({ [KEY]: s });

async function state(): Promise<AppState> {
  const local = await loadLocal();
  const user = await api.currentUser();
  return { ...local, email: user?.email ?? null };
}

function upsertTermLocal(s: Local, t: Term) {
  const i = s.terms.findIndex((x) => x.key === t.key);
  if (i >= 0) s.terms[i] = t;
  else s.terms.push(t);
}

/** Push everything tracked before sign-in, then take the server's view (it knows email Done/Skip clicks). */
async function sync(): Promise<void> {
  const user = await api.currentUser();
  if (!user) return;
  const s = await loadLocal();
  for (const t of s.terms) await api.upsertTerm(user.id, t);
  for (const p of s.professors.filter((p) => !p.synced)) await api.upsertProfessor(user.id, p);
  const remote = await api.fetchRemote();
  await saveLocal({ ...s, pendingEmail: null, terms: remote.terms, professors: remote.professors });
}

async function handle(msg: Msg): Promise<AppState> {
  const s = await loadLocal();
  const user = await api.currentUser();

  switch (msg.type) {
    case 'getState':
      if (user) await sync().catch(console.warn); // offline is fine; show local state
      break;

    case 'track': {
      upsertTermLocal(s, msg.term);
      const exists = s.professors.some((p) => p.rmpId === msg.prof.rmpId && p.termKey === msg.term.key);
      if (!exists) {
        const p: TrackedProfessor = { ...msg.prof, termKey: msg.term.key, status: 'waiting', nudgesSent: 0, synced: false };
        s.professors.push(p);
      }
      await saveLocal(s);
      if (user) await sync();
      else if (msg.email) {
        await api.sendMagicLink(msg.email);
        await saveLocal({ ...s, pendingEmail: msg.email });
      }
      break;
    }

    case 'untrack':
      s.professors = s.professors.filter((p) => !(p.rmpId === msg.rmpId && p.termKey === msg.termKey));
      await saveLocal(s);
      if (user) await api.deleteProfessor(user.id, msg.rmpId, msg.termKey);
      break;

    case 'setTermEnd': {
      const t = s.terms.find((x) => x.key === msg.termKey);
      if (!t) throw new Error('Unknown term');
      t.endDate = msg.endDate;
      await saveLocal(s);
      if (user) await api.upsertTerm(user.id, t);
      break;
    }

    case 'markDone':
      for (const p of s.professors) if (p.rmpId === msg.rmpId && p.status === 'waiting') p.status = 'done';
      await saveLocal(s);
      if (user) await api.markDoneRemote(user.id, msg.rmpId);
      break;

    case 'signIn':
      await api.sendMagicLink(msg.email);
      await saveLocal({ ...s, pendingEmail: msg.email });
      break;

    case 'authCallback':
      await api.completeSignIn(msg.url);
      await sync();
      break;

    case 'signOut':
      await api.supabase.auth.signOut({ scope: 'local' });
      break;

    case 'deleteAccount':
      await api.deleteAccount();
      await saveLocal({ pendingEmail: null, professors: [], terms: [] });
      break;
  }
  return state();
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
    handle(msg)
      .then((st): Reply => ({ ok: true, state: st }))
      .catch(async (e): Promise<Reply> => ({ ok: false, error: e?.message ?? String(e), state: await state() }))
      .then(sendResponse);
    return true; // async response
  });
});
