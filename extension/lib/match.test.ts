/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import compact from './fixtures/compact-sections.txt?raw';
import csun from './fixtures/csun-portal.txt?raw';
import table from './fixtures/instructor-table.txt?raw';
import { fullName, matchSchedule, nameQueries } from './match';
import type { RosterProf } from './types';

const prof = (rmpId: number, firstName: string, lastName: string): RosterProf => ({
  rmpId, firstName, lastName, department: '', numRatings: 0,
});

function fillerRoster(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const letters = [Math.floor(i / 676), Math.floor(i / 26) % 26, i % 26]
      .map((letter) => String.fromCharCode(97 + letter)).join('');
    return prof(100 + i, 'Priya', `Venn${letters}`);
  });
}

const browserPaste = [
  '\tInstructor:\u00a0Mansoureh\u00a0Lord',
  '  Instructor:\tChristian Bowles',
  '  Instructor: Christian Bowles',
  '\tInstructor: Richard Covington',
  '  Instructor: James Castro',
].join('\r\n');

describe('matchSchedule', () => {
  it.each(['M', ''])('finds each pasted instructor with messy roster names (Lord given name %j)', (givenName) => {
    const roster = [prof(1, givenName, 'LORD'), prof(2, 'Christian A.', 'Bowles'),
      prof(3, 'Richard J', 'Covington'), prof(4, ' James', 'Castro Jr.')];
    expect(matchSchedule(browserPaste, roster).map(({ candidates, confidence }) => [candidates[0]!.rmpId, confidence]))
      .toEqual([[1, 'possible'], [2, 'confident'], [3, 'confident'], [4, 'confident']]);
  });

  it('keeps a possible row for a different first name and ignores spaces around roster names', () => {
    const roster = [prof(1, 'Mansoureh', 'LORD'), prof(2, 'Christian', 'Bowles'),
      prof(3, 'Rich', 'Covington'), prof(4, ' James', 'Castro ')];
    expect(matchSchedule(browserPaste, roster).map(({ confidence }) => confidence))
      .toEqual(['confident', 'confident', 'possible', 'confident']);
  });

  it('prefers a matching middle initial over a first-token-only match', () => {
    const bowles = prof(1, 'Christian B.', 'Bowles');
    expect(matchSchedule('Instructor: Christian B. Bowles', [prof(2, 'Christian A.', 'Bowles'), bowles]))
      .toMatchObject([{ candidates: [bowles], confidence: 'confident' }]);
  });

  it.each(['James Castro Jr.', 'Castro Sr., James', 'Castro II James', 'Castro, James III'])(
    'ignores generational suffixes in the roster and in %s', (name) => {
      const castro = prof(1, 'James', 'Castro III');
      expect(matchSchedule(`Instructor: ${name}`, [castro])).toMatchObject([
        { candidates: [castro], confidence: 'confident' },
      ]);
    },
  );

  it('finds exactly four confident CSUN instructors despite surname collisions with course and room text', () => {
    const roster = [
      ...fillerRoster(50),
      prof(1, 'Marisol', 'Lindqvist'), prof(2, 'Colin', 'Brambleton'),
      prof(3, 'Rhea', 'Corvington'), prof(4, 'Jonas', 'Castellan'),
      prof(5, 'Maya', 'Hall'), prof(6, 'Thomas', 'Lindqvist'), prof(7, 'Max', 'Oak'),
      prof(8, 'Mia', 'James'), prof(9, 'Mark', 'Christian'), prof(10, 'Eli', 'Lang'),
      prof(11, 'Ava', 'Lab'), prof(12, 'Olivia', 'Live'),
    ];
    expect(matchSchedule(csun, roster).map(({ candidates, confidence, course }) => [candidates.map(fullName), confidence, course])).toEqual([
      [['Marisol Lindqvist'], 'confident', 'COMP310'],
      [['Colin Brambleton'], 'confident', 'COMP322'],
      [['Rhea Corvington'], 'confident', 'COMP333'],
      [['Jonas Castellan'], 'confident', 'MATH262'],
    ]);
  });

  it('reserves all tokens in a confident name before matching other surnames on the same line', () => {
    const castro = prof(1, 'James', 'Castro');
    const chen = prof(2, 'John', 'Chen');
    const roster = [castro, chen, prof(3, 'Mia', 'James'), prof(4, 'Nina', 'J'), prof(5, 'Mark', 'James J')];
    expect(matchSchedule('Instructor: James J. Castro, Chen', roster)).toEqual([
      { candidates: [castro], confidence: 'confident', matchedText: 'James J. Castro', course: undefined },
      { candidates: [chen], confidence: 'possible', matchedText: 'Chen', course: undefined },
    ]);
  });

  it('skips metadata even when its text would match a full name or course code', () => {
    const chen = prof(1, 'John', 'Chen');
    const hall = prof(2, 'Live Oak', 'Hall');
    const schedule = 'CS101\nLocation: Live Oak Hall\nRoom ENG 120 John Chen\nBuilding: Live Oak Hall\n'
      + 'Days John Chen\nTime: John Chen\nDays/Time: John Chen\nJohn Chen';
    expect(matchSchedule(schedule, [chen, hall])).toEqual([
      { candidates: [chen], confidence: 'confident', matchedText: 'John Chen', course: 'CS101' },
    ]);
  });

  it.each(['Instructor:', 'INSTRUCTORS', 'Professor:', 'faculty', 'Teacher:'])(
    'keeps weak matches in %s lines and confident matches anywhere', (label) => {
      const chen = [prof(1, 'John', 'Chen'), prof(2, 'Jane', 'Chen')];
      const castro = prof(3, 'James', 'Castro');
      const schedule = `Chen\nWest Studies\nCS 101 James Castro\n${label} Chen`;
      expect(matchSchedule(schedule, [...chen, castro, prof(4, 'Alex', 'West')])).toEqual([
        { candidates: [castro], confidence: 'confident', matchedText: 'James Castro', course: 'CS101' },
        { candidates: chen, confidence: 'ambiguous', matchedText: 'Chen', course: 'CS101' },
      ]);
    },
  );

  it('restricts weak table matches to the instructor column even when the header starts with Room', () => {
    const chen = [prof(1, 'John', 'Chen'), prof(2, 'Jane', 'Chen')];
    const hall = prof(3, 'Mary', 'Hall');
    const castro = prof(4, 'James', 'Castro');
    const schedule = 'Hall\nRoom\tCourse\tInstructor\tTitle\nRoom 203\tCS101\tChen\tLab\n'
      + 'West\tCS102\tHall\tJames Castro';
    expect(matchSchedule(schedule, [...chen, hall, castro, prof(5, 'Alex', 'West'), prof(6, 'Sam', 'Lab')])).toEqual([
      { candidates: chen, confidence: 'ambiguous', matchedText: 'Chen', course: 'CS101' },
      { candidates: [hall], confidence: 'possible', matchedText: 'Hall', course: 'CS102' },
      { candidates: [castro], confidence: 'confident', matchedText: 'James Castro', course: 'CS102' },
    ]);
  });

  it('matches all-caps table names across accent differences and skips placeholder rows', () => {
    const jose = prof(1, 'José', 'Diaz');
    const mara = prof(2, 'Mara', 'Kim-Patel');
    const roster = [jose, mara, prof(3, 'Sam', 'Staff'), prof(4, 'Tom', 'TBA'), prof(5, 'Ann', 'Announced'),
      prof(6, 'To', 'Be'), prof(7, 'Bo', 'To')];
    expect(matchSchedule(table, roster)).toEqual([
      { candidates: [jose], confidence: 'confident', matchedText: 'DÍAZ, JOSE', course: 'SPAN201' },
      { candidates: [mara], confidence: 'confident', matchedText: 'KIM-PATEL, MARA', course: 'ENG203' },
    ]);
  });

  it('reads compact rows with initials, a multi-word surname, an ambiguous surname, and room numbers', () => {
    const okafor = prof(1, 'John', 'Okafor');
    const deLaCruz = prof(2, 'Ana', 'De La Cruz');
    const kim = [prof(3, 'Nina', 'Kim'), prof(4, 'Carl', 'Kim')];
    expect(matchSchedule(compact, [okafor, deLaCruz, ...kim, prof(5, 'Ana', 'Cruz')])).toEqual([
      { candidates: [okafor], confidence: 'confident', matchedText: 'J. Okafor', course: 'CS101' },
      { candidates: [deLaCruz], confidence: 'confident', matchedText: 'DE LA CRUZ A', course: 'CS201' },
      { candidates: kim, confidence: 'ambiguous', matchedText: 'Kim', course: 'MATH220' },
    ]);
  });

  it.each(['Jose Peña', 'José M. Pena', 'PEÑA, J', 'PEÑA,JOSE', 'J. Peña', 'PENA J'])('matches %s confidently', (name) => {
    const jose = prof(1, 'José', 'Peña');
    expect(matchSchedule(name, [jose, prof(2, 'Carl', 'Pena')])).toEqual([
      { candidates: [jose], confidence: 'confident', matchedText: name, course: undefined },
    ]);
  });

  it('narrows an ambiguous initial to its matching candidates and deduplicates the same group', () => {
    const matching = [prof(1, 'Jane', 'Chen'), prof(2, 'John', 'Chen')];
    const roster = [...matching, prof(3, 'Ella', 'Chen')];
    expect(matchSchedule('CS101 J. Chen\nCS102 Chen, J', roster)).toEqual([
      { candidates: matching, confidence: 'ambiguous', matchedText: 'J. Chen', course: 'CS101' },
    ]);
  });

  it('upgrades a possible match while retaining its first course and appearance order', () => {
    const chen = prof(1, 'John', 'Chen');
    const jones = prof(2, 'Ana', 'Jones');
    expect(matchSchedule('CS101\nChen\nCS102 Ana Jones\nCS103 John Chen', [chen, jones, chen])).toEqual([
      { candidates: [chen], confidence: 'confident', matchedText: 'John Chen', course: 'CS101' },
      { candidates: [jones], confidence: 'confident', matchedText: 'Ana Jones', course: 'CS102' },
    ]);
  });

  it('uses the nearest preceding code, or the next code on the same line when none precedes the match', () => {
    const diaz = prof(1, 'Joe', 'Diaz');
    const jones = prof(2, 'Ana', 'Jones');
    const chen = prof(3, 'John', 'Chen');
    const hall = prof(4, 'Mary', 'Hall');
    const schedule = 'Joe Diaz\nAna Jones CS-101\nClass #: 10001\nJohn Chen BIO220\nMATH 212, STAT301 Mary Hall';
    expect(matchSchedule(schedule, [diaz, jones, chen, hall]).map(({ course }) => course)).toEqual([
      undefined, 'CS101', 'CS101', 'STAT301',
    ]);
  });

  it('keeps matches within lines and retains the original apostrophe and decomposed accent', () => {
    const jose = prof(1, 'José', "O'Neil");
    expect(matchSchedule('Jose\r\nO’Neil', [jose])[0]?.confidence).toBe('possible');
    expect(matchSchedule('Jose\u0301 O’Neil', [jose])).toEqual([
      { candidates: [jose], confidence: 'confident', matchedText: 'Jose\u0301 O’Neil', course: undefined },
    ]);
  });

  it('matches a 300-line paste against 6,000 professors in under 50 ms', () => {
    const roster = fillerRoster(6000);
    const schedule = roster.slice(-300).map((person) => `CS101 - 01  Lec  MWF 9:00-9:50  ENG 120  ${fullName(person)}`).join('\n');
    const start = performance.now();
    const results = matchSchedule(schedule, roster);
    const elapsed = performance.now() - start;
    expect(results).toHaveLength(300);
    expect(results.every(({ confidence }) => confidence === 'confident')).toBe(true);
    expect(elapsed).toBeLessThan(50);
  });
});

describe('nameQueries', () => {
  it.each([
    ['CSUN portal', csun, ['Marisol Lindqvist', 'Colin Brambleton', 'Rhea Corvington', 'Jonas Castellan']],
    ['instructor table', table, ['JOSE DÍAZ', 'MARA KIM-PATEL']],
    ['compact sections', compact, ['J. Okafor', 'DE LA CRUZ']],
    ['browser paste', browserPaste, ['Mansoureh Lord', 'Christian Bowles', 'Richard Covington', 'James Castro']],
  ])('extracts search queries from the %s fixture', (_name, schedule, expected) => {
    expect(nameQueries(schedule)).toEqual(expected);
  });

  it('normalizes titles, comma order, and suffixes, and deduplicates queries case-insensitively', () => {
    const schedule = 'Instructor: Castro Jr., Dr. James\nInstructor: Prof. JAMES CASTRO\n'
      + 'Instructor: James Castro, III\nInstructor: Staff\nInstructor: TBA\nInstructor: To Be Announced\n'
      + 'Location: Live Oak Hall\nOlivia James';
    expect(nameQueries(schedule)).toEqual(['James Castro']);
  });

  it('extracts only instructor cells even when Instructor is the first header', () => {
    const schedule = 'Instructor:\tCourse\tLocation\nProf. Mara Kim-Patel\tENG203\tLive Oak Hall\n'
      + 'TBA\tENG204\tOne Hall';
    expect(nameQueries(schedule)).toEqual(['Mara Kim-Patel']);
  });

  it('keeps empty leading table cells and reads a tab-separated instructor label after the table', () => {
    const schedule = 'Course\tInstructor\n\tAna Diaz\nInstructor:\tMara Kim-Patel';
    const roster = [prof(1, 'Maria', 'Diaz'), prof(2, 'Sara', 'Kim-Patel')];
    expect(nameQueries(schedule)).toEqual(['Ana Diaz', 'Mara Kim-Patel']);
    expect(matchSchedule(schedule, roster).map(({ confidence }) => confidence)).toEqual(['possible', 'possible']);
  });

  it('skips schedule metadata in unlabeled text', () => {
    const schedule = 'Course: CS101\nMonday Wednesday 9:00 AM\nRoom 333\nLive Oak Hall\n'
      + 'CS 101 - 01  Lec  TuTh 9:00-9:50  ENG 120  Ana Diaz\nAlex James Lee';
    expect(nameQueries(schedule)).toEqual(['Ana Diaz', 'Alex James Lee']);
  });

  it('returns at most 20 distinct queries in first appearance order', () => {
    const expected = fillerRoster(22).map(fullName);
    const schedule = expected.flatMap((name) => [`Instructor: ${name}`, `Instructor: ${name.toUpperCase()}`]).join('\n');
    expect(nameQueries(schedule)).toEqual(expected.slice(0, 20));
  });
});
