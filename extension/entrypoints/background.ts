import * as api from '@/lib/api';
import type { Reply } from '@/lib/messaging';
import { schoolById, searchSchools, searchTeachers } from '@/lib/rmp';
import { getRoster } from '@/lib/roster';
import { courseKey, STATE_KEY, type AppState, type Msg, type RosterProgress, type Term, type TrackedProfessor } from '@/lib/types';

const KEY = STATE_KEY;
type Removed = { rmpId: number; termKey: string };
/** `removed`: professors untracked locally whose server rows still need deleting. */
type Local = Omit<AppState, 'email'> & { removed?: Removed[] };

async function loadLocal(): Promise<Local> {
  const r = await browser.storage.local.get(KEY);
  return { pendingEmail: null, professors: [], terms: [], school: null, courses: {}, ...(r[KEY] as Partial<Local>) };
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
  for (const r of s.removed ?? []) await api.deleteProfessor(user.id, r.rmpId, r.termKey);
  for (const t of s.terms) await api.upsertTerm(user.id, t);
  for (const p of s.professors.filter((p) => !p.synced)) await api.upsertProfessor(user.id, p);
  const remote = await api.fetchRemote();
  await saveLocal({ ...s, pendingEmail: null, removed: [], terms: remote.terms, professors: remote.professors });
}

type Query = Extract<Msg, { type: 'searchSchools' | 'schoolById' | 'loadRoster' | 'searchProfessors' }>;

function reportRosterProgress(loaded: number, total: number) {
  const progress: RosterProgress = { type: 'rosterProgress', loaded, total };
  void browser.runtime.sendMessage(progress).catch(() => {});
}

async function handleQuery(msg: Query): Promise<Reply> {
  let result: Promise<unknown>;
  if (msg.type === 'searchSchools') {
    result = searchSchools(msg.text).then((schools) => {
      console.info('[ProfNudge] school search returned', schools.length);
      return schools;
    });
  } else if (msg.type === 'schoolById') {
    result = schoolById(msg.legacyId);
  } else {
    const { school } = await loadLocal();
    if (!school) throw new Error('Pick your school first.');
    result = msg.type === 'loadRoster'
      ? getRoster(school, {
        force: msg.force,
        onProgress: reportRosterProgress,
        onFetched: (profs, resultCount) => console.info('[ProfNudge] roster', school.name, profs.length, 'of', resultCount),
      })
      : searchTeachers(msg.text, school.id);
  }
  const data = await result.catch((error) => {
    console.warn('[ProfNudge] RMP request failed:', error);
    throw new Error("Couldn't reach Rate My Professors. You can still open a professor's page and click Track.");
  });
  return { ok: true, state: await state(), data };
}

async function handle(msg: Exclude<Msg, Query>): Promise<Reply> {
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
        await api.sendCode(msg.email);
        await saveLocal({ ...s, pendingEmail: msg.email });
      }
      break;
    }

    case 'trackMany':
      upsertTermLocal(s, msg.term);
      for (const { rmpId, name, school, course } of msg.profs) {
        const key = courseKey(rmpId, msg.term.key);
        if (course && !s.courses[key]) s.courses[key] = course;
        if (s.professors.some((p) => p.rmpId === rmpId && p.termKey === msg.term.key)) continue;
        s.professors.push({ rmpId, name, school, termKey: msg.term.key, status: 'waiting', nudgesSent: 0, synced: false });
      }
      await saveLocal(s);
      if (user) await sync();
      break;

    case 'setSchool':
      s.school = msg.school;
      await saveLocal(s);
      break;

    case 'untrack':
      // Remember the removal so the next sync deletes the server row too. Otherwise an untrack made
      // while signed out (or offline) is undone when sync pulls the server's copy.
      s.professors = s.professors.filter((p) => !(p.rmpId === msg.rmpId && p.termKey === msg.termKey));
      delete s.courses[courseKey(msg.rmpId, msg.termKey)];
      s.removed = [...(s.removed ?? []), { rmpId: msg.rmpId, termKey: msg.termKey }];
      await saveLocal(s);
      if (user) await sync();
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
      await api.sendCode(msg.email);
      await saveLocal({ ...s, pendingEmail: msg.email });
      break;

    case 'verifyCode':
      if (!s.pendingEmail) throw new Error('Enter your email first.');
      await api.verifyCode(s.pendingEmail, msg.code);
      await sync();
      break;

    case 'cancelSignIn':
      await saveLocal({ ...s, pendingEmail: null });
      break;

    case 'signOut':
      await api.supabase.auth.signOut({ scope: 'local' });
      break;

    case 'deleteAccount':
      await api.deleteAccount();
      await saveLocal({ pendingEmail: null, professors: [], terms: [], removed: [], school: null, courses: {} });
      break;
  }
  return { ok: true, state: await state() };
}

export default defineBackground(() => {
  // State changes and sync both write a full snapshot. Keep them from overwriting one another.
  let pending = Promise.resolve();
  browser.runtime.onMessage.addListener((msg: Msg | RosterProgress, _sender, sendResponse) => {
    if (msg.type === 'rosterProgress') return;
    let reply: Promise<Reply>;
    if (msg.type === 'searchSchools' || msg.type === 'schoolById' || msg.type === 'loadRoster' || msg.type === 'searchProfessors') {
      reply = handleQuery(msg);
    } else {
      reply = pending.then(() => handle(msg));
      pending = reply.then(() => {}, () => {});
    }
    reply
      .catch(async (e): Promise<Reply> => ({ ok: false, error: e?.message ?? String(e), state: await state().catch(() => undefined) }))
      .then(sendResponse);
    return true; // async response
  });
});
