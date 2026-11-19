export type Status = 'waiting' | 'done' | 'skipped';

export interface TrackedProfessor {
  rmpId: number;
  name: string;
  school: string;
  termKey: string; // e.g. "fall-2026"
  status: Status;
  nudgesSent: number;
  /** true once the row exists on the server */
  synced: boolean;
}

export interface Term {
  key: string; // "fall-2026"
  label: string; // "Fall 2026"
  endDate: string; // ISO date "2026-12-15"
}

export interface AppState {
  email: string | null;
  pendingEmail: string | null; // magic link sent, not yet clicked
  professors: TrackedProfessor[];
  terms: Term[];
}

/** Messages content scripts / popup send to the background worker. */
export type Msg =
  | { type: 'getState' }
  | { type: 'track'; prof: { rmpId: number; name: string; school: string }; term: Term; email?: string }
  | { type: 'untrack'; rmpId: number; termKey: string }
  | { type: 'setTermEnd'; termKey: string; endDate: string }
  | { type: 'markDone'; rmpId: number }
  | { type: 'signIn'; email: string }
  | { type: 'signOut' }
  | { type: 'deleteAccount' }
  | { type: 'authCallback'; url: string };
