import { describe, expect, it } from 'vitest';
import { composeReview } from './compose';
import { professorIdFromPath } from './rmp';
import { termChoices } from './terms';

describe('composeReview', () => {
  it('stitches answers into sentences and skips blanks', () => {
    expect(composeReview({ overall: 'great class.', exams: '', tip: 'do the homework' })).toBe(
      'Overall, great class. To do well, do the homework.',
    );
  });
  it('returns empty text when nothing is answered', () => {
    expect(composeReview({})).toBe('');
  });
});

describe('termChoices', () => {
  it('defaults to the current term, then the next two', () => {
    const t = termChoices(new Date(2026, 10, 17)); // Nov 17 2026
    expect(t.map((x) => x.key)).toEqual(['fall-2026', 'spring-2027', 'summer-2027']);
    expect(t[0]!.endDate).toBe('2026-12-15');
  });
  it('rolls spring in January', () => {
    expect(termChoices(new Date(2027, 0, 10))[0]!.key).toBe('spring-2027');
  });
});

describe('professorIdFromPath', () => {
  it('reads both page types', () => {
    expect(professorIdFromPath('/professor/390706')).toBe(390706);
    expect(professorIdFromPath('/add/professor-rating/390706')).toBe(390706);
    expect(professorIdFromPath('/school/2389')).toBeNull();
  });
});
