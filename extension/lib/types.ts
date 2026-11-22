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

/** An RMP school, as returned by RMP's school search. */
export interface School {
  id: string; // RMP GraphQL node id (base64, e.g. "U2Nob29sLTE1Nw==")
  legacyId: number; // numeric id in RMP URLs (/school/157)
  name: string;
  city: string;
  state: string;
}

/** One professor from a school's RMP list (the "roster"). */
export interface RosterProf {
  rmpId: number; // legacyId, same id as TrackedProfessor.rmpId
  firstName: string;
  lastName: string;
  department: string;
  numRatings: number;
}

/** chrome.storage.local key for the background's state (read directly by the review overlay). */
export const STATE_KEY = 'profnudge:state';

/** Key for AppState.courses. */
export const courseKey = (rmpId: number, termKey: string) => `${rmpId}|${termKey}`;

export interface AppState {
  email: string | null;
  pendingEmail: string | null; // sign-in code sent, not yet entered
  professors: TrackedProfessor[];
  terms: Term[];
  /** School picked for paste-in. Browser only, never synced. */
  school: School | null;
  /**
   * Course code per tracked professor, from a pasted schedule, keyed by courseKey().
   * Browser only, never synced: kept outside `professors` because sync() replaces that list
   * with the server's copy.
   */
  courses: Record<string, string>;
}

export interface TrackManyItem {
  rmpId: number;
  name: string;
  school: string;
  course?: string;
}

/** Messages content scripts / popup send to the background worker. */
export type Msg =
  | { type: 'getState' }
  | { type: 'track'; prof: { rmpId: number; name: string; school: string }; term: Term; email?: string }
  | { type: 'trackMany'; profs: TrackManyItem[]; term: Term }
  | { type: 'untrack'; rmpId: number; termKey: string }
  | { type: 'setTermEnd'; termKey: string; endDate: string }
  | { type: 'markDone'; rmpId: number }
  | { type: 'signIn'; email: string }
  | { type: 'signOut' }
  | { type: 'deleteAccount' }
  | { type: 'verifyCode'; code: string }
  | { type: 'cancelSignIn' }
  // Paste-in. Results come back in Reply.data.
  | { type: 'setSchool'; school: School } // data: none
  | { type: 'searchSchools'; text: string } // data: School[]
  | { type: 'schoolById'; legacyId: number } // school from a pasted RMP link, e.g. /school/163; data: School
  | { type: 'loadRoster'; force?: boolean } // roster of state.school; data: RosterProf[]
  | { type: 'searchProfessors'; text: string }; // name search within state.school; data: RosterProf[]

/** Broadcast by the background (browser.runtime.sendMessage) while loadRoster pages through RMP. */
export interface RosterProgress {
  type: 'rosterProgress';
  loaded: number;
  total: number;
}
