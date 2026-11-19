import type { Term } from './types';

type Season = 'spring' | 'summer' | 'fall';

/** Typical US term end dates (month is 1-based). Students edit these per term. */
const DEFAULT_END: Record<Season, [month: number, day: number]> = {
  spring: [5, 15],
  summer: [8, 10],
  fall: [12, 15],
};

const ORDER: Season[] = ['spring', 'summer', 'fall'];

function seasonFor(date: Date): Season {
  const m = date.getMonth() + 1;
  if (m <= 5) return 'spring';
  if (m <= 7) return 'summer';
  return 'fall';
}

export function makeTerm(season: Season, year: number): Term {
  const [mm, dd] = DEFAULT_END[season];
  return {
    key: `${season}-${year}`,
    label: `${season.charAt(0).toUpperCase()}${season.slice(1)} ${year}`,
    endDate: `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`,
  };
}

/**
 * Terms offered in the Track dialog: the current term first (the default),
 * then the next two, since students often track while registering ahead.
 */
export function termChoices(now = new Date()): Term[] {
  let season = seasonFor(now);
  let year = now.getFullYear();
  const out: Term[] = [];
  for (let i = 0; i < 3; i++) {
    out.push(makeTerm(season, year));
    const idx = ORDER.indexOf(season);
    if (idx === ORDER.length - 1) {
      season = ORDER[0]!;
      year++;
    } else season = ORDER[idx + 1]!;
  }
  return out;
}
