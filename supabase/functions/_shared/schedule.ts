/** Nudges go out at term end, +7 days and +21 days. Keep in sync with extension/lib/terms.ts. */
export const NUDGE_OFFSETS = [0, 7, 21];

/** Is the next nudge for this professor due on `today` (YYYY-MM-DD)? */
export function isDue(endDate: string, nudgesSent: number, today: string): boolean {
  if (nudgesSent >= NUDGE_OFFSETS.length) return false;
  const due = new Date(`${endDate}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + NUDGE_OFFSETS[nudgesSent]);
  return due.toISOString().slice(0, 10) <= today;
}
