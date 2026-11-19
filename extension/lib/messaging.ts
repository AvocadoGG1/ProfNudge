import type { AppState, Msg } from './types';

export type Reply = { ok: true; state: AppState } | { ok: false; error: string; state?: AppState };

export function send(msg: Msg): Promise<Reply> {
  return browser.runtime.sendMessage(msg);
}
