import type { AppState, Msg } from './types';

/** `data` carries query results (searchSchools, loadRoster, searchProfessors). */
export type Reply = { ok: true; state: AppState; data?: unknown } | { ok: false; error: string; state?: AppState };

export function send(msg: Msg): Promise<Reply> {
  return browser.runtime.sendMessage(msg);
}
