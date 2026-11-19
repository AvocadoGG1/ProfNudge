/** Nudges go out at term end, +7 days and +21 days. */
export const NUDGE_OFFSETS = [0, 7, 21];
export const MAX_NUDGES = NUDGE_OFFSETS.length;

/** Never email about the same professor twice within this many days, even when catching up. */
export const MIN_GAP_DAYS = 7;

const addDays = (isoDate: string, days: number) => {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Is the next nudge for this professor due on `today` (YYYY-MM-DD)?
 * It is due once end date + its offset has passed AND at least MIN_GAP_DAYS have
 * passed since the last nudge, so a professor tracked late (or a missed cron run)
 * doesn't get several nudges on back-to-back days.
 */
export function isDue(endDate: string, nudgesSent: number, lastNudgedAt: string | null, today: string): boolean {
  if (nudgesSent >= MAX_NUDGES) return false;
  if (addDays(endDate, NUDGE_OFFSETS[nudgesSent]!) > today) return false;
  return !lastNudgedAt || addDays(lastNudgedAt, MIN_GAP_DAYS) <= today;
}
