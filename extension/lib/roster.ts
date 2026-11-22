import { fetchRoster } from './rmp';
import type { RosterProf, School } from './types';

const TTL = 30 * 24 * 60 * 60 * 1000;

type CachedRoster = { fetchedAt: number; profs: RosterProf[] };

export function isFresh(fetchedAt: number, now: number): boolean {
  return now - fetchedAt <= TTL;
}

export async function getRoster(
  school: School,
  { force, onProgress, onFetched }: {
    force?: boolean;
    onProgress?: (loaded: number, total: number) => void;
    onFetched?: (profs: RosterProf[], resultCount: number) => void;
  } = {},
): Promise<RosterProf[]> {
  const key = `profnudge:roster:${school.id}`;
  if (force) {
    await browser.storage.local.remove(key);
  } else {
    const stored = await browser.storage.local.get(key);
    const cached = stored[key] as CachedRoster | undefined;
    if (cached?.profs.length && isFresh(cached.fetchedAt, Date.now())) return cached.profs;
  }
  const { profs, resultCount } = await fetchRoster(school.id, onProgress);
  onFetched?.(profs, resultCount);
  if (profs.length) {
    await browser.storage.local.set({ [key]: { fetchedAt: Date.now(), profs } });
  }
  return profs;
}
