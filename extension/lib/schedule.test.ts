import { describe, expect, it } from 'vitest';
// The server's nudge schedule has no Deno APIs, so it is tested here alongside the extension.
import { isDue, MAX_NUDGES } from '../../supabase/functions/_shared/schedule.ts';
import { isRatingMutation } from './rmp';

describe('isDue', () => {
  const end = '2026-12-15';

  it('sends the first nudge on the end date, not before', () => {
    expect(isDue(end, 0, null, '2026-12-14')).toBe(false);
    expect(isDue(end, 0, null, '2026-12-15')).toBe(true);
  });

  it('follows the offsets when the cron runs every day', () => {
    expect(isDue(end, 1, '2026-12-15T16:00:00+00:00', '2026-12-21')).toBe(false);
    expect(isDue(end, 1, '2026-12-15T16:00:00+00:00', '2026-12-22')).toBe(true);
    expect(isDue(end, 2, '2026-12-22T16:00:00+00:00', '2027-01-05')).toBe(true);
  });

  it('spaces out catch-up nudges for a professor tracked late', () => {
    // Tracked 25 days after term end: every offset has passed, but nudges stay a week apart.
    expect(isDue(end, 0, null, '2027-01-09')).toBe(true);
    expect(isDue(end, 1, '2027-01-09T16:00:00+00:00', '2027-01-10')).toBe(false);
    expect(isDue(end, 1, '2027-01-09T16:00:00+00:00', '2027-01-16')).toBe(true);
  });

  it('stops after the last nudge', () => {
    expect(isDue(end, MAX_NUDGES, '2026-01-01T00:00:00Z', '2027-06-01')).toBe(false);
  });
});

describe('isRatingMutation', () => {
  it('matches a rating mutation and ignores queries', () => {
    expect(isRatingMutation('{"query":"mutation RateTeacherMutation($input: ...)"}')).toBe(true);
    expect(isRatingMutation('{"query":"query TeacherRatingsPageQuery($id: ID!)"}')).toBe(false);
  });
});
