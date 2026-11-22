import { afterEach, describe, expect, it, vi } from 'vitest';
import { findScheduleMatches } from './paste-ui';
import { fetchRoster, parseSchoolLink, RMP_GRAPHQL, schoolById, searchSchools, searchTeachers } from './rmp';
import { getRoster, isFresh } from './roster';
import type { RosterProf } from './types';

const school = { id: 'U2Nob29sLTE1Nw==', legacyId: 157, name: 'Test State', city: 'Test City', state: 'CA' };
const northridge = {
  id: 'U2Nob29sLTE2Mw==', legacyId: 163, name: 'California State University, Northridge', city: 'Northridge', state: 'CA',
};
const teacher = { legacyId: 1, firstName: 'Ada', lastName: 'Lovelace', department: 'Math', numRatings: 12 };

function schoolResults(nodes: (typeof school)[], source = 'newSearch') {
  return Response.json({ data: { [source]: { schools: { edges: nodes.map((node) => ({ node })) } } } });
}

function page(ids: number[], resultCount: number, endCursor: string | null) {
  return Response.json({
    data: {
      newSearch: {
        teachers: {
          edges: ids.map((legacyId) => ({ node: { ...teacher, legacyId } })),
          pageInfo: { hasNextPage: endCursor !== null, endCursor },
          resultCount,
        },
      },
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('RMP search', () => {
  it.each([
    ' 163 ',
    'https://www.ratemyprofessors.com/school/163',
    'ratemyprofessors.com/school/163/',
    'www.ratemyprofessors.com/search/professors/163?q=*&did=11',
    'https://ratemyprofessors.com/search/teachers?sid=163',
    '/school/163',
  ])('reads the school ID from %s', (input) => {
    expect(parseSchoolLink(input)).toBe(163);
  });

  it.each([
    'California State University, Northridge',
    '0',
    '9007199254740993',
    'https://example.com/school/163',
    'https://ratemyprofessors.com.example.com/school/163',
    'https://www.ratemyprofessors.com/professor/163',
    'https://www.ratemyprofessors.com/school/163junk',
    'https://www.ratemyprofessors.com/search/teachers?sid=1e3',
  ])('rejects %s as a school ID', (input) => {
    expect(parseSchoolLink(input)).toBeNull();
  });

  it('looks up the school node by its encoded ID', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { node: northridge } }));

    expect(await schoolById(163, fetchImpl)).toEqual(northridge);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({
      query: expect.stringMatching(/node\(id: \$id\) \{\s*\.\.\. on School \{ id legacyId name city state \}/),
      variables: { id: 'U2Nob29sLTE2Mw==' },
    });
  });

  it.each([
    { data: { node: null } },
    { errors: [{ message: 'School query unavailable' }] },
  ])('returns a usable school when the node lookup returns %j', async (payload) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));

    expect(await schoolById(163, fetchImpl)).toEqual({
      id: 'U2Nob29sLTE2Mw==', legacyId: 163, name: 'School #163', city: '', state: '',
    });
  });

  it('strips punctuation and collapses spaces in school name searches', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(schoolResults([northridge]))
      .mockResolvedValueOnce(schoolResults([northridge]))
      .mockResolvedValueOnce(schoolResults([northridge], 'autocomplete'));

    expect(await searchSchools('  California State University,   Northridge  ', fetchImpl)).toEqual([northridge]);
    expect(fetchImpl.mock.calls.map(([, request]) => JSON.parse(String(request?.body)).variables)).toEqual([
      { query: { text: 'California State University Northridge' }, first: 50 },
      { query: { text: 'Northridge' }, first: 50 },
      { query: 'California State University Northridge' },
    ]);
  });

  it.each([
    ['California State University Northridge', ['California State University Northridge', 'Northridge']],
    ['csun northridge', ['csun northridge', 'northridge', 'California State University Northridge']],
    ['Cal State Northridge', ['Cal State Northridge', 'Northridge', 'California State University Northridge']],
    ['CSU Northridge', ['CSU Northridge', 'Northridge', 'California State University Northridge']],
    ['csun', ['csun', 'California State University Northridge']],
    ['northridge', ['northridge']],
  ])('ranks CSUN first in the merged results for %s', async (input, variants) => {
    const campuses = [
      'Fullerton', 'Long Beach', 'Los Angeles', 'Dominguez Hills', 'Bakersfield', 'Chico',
      'East Bay', 'Fresno', 'Monterey Bay', 'Sacramento', 'San Bernardino', 'San Marcos',
      'Stanislaus', 'Channel Islands', 'San Luis Obispo',
    ].map((city, index) => ({
      ...school, id: `campus-${index}`, legacyId: 200 + index, name: `California State University, ${city}`, city,
    }));
    const otherSchools = [school, { ...school, id: 'another', legacyId: 158, name: 'Another College' }];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_, request) => {
      const { operationName, variables } = JSON.parse(String(request?.body));
      if (operationName === 'AutocompleteSearchQuery') {
        return schoolResults([...campuses, campuses[0]!, ...otherSchools], 'autocomplete');
      }
      const text = variables.query.text.toLowerCase();
      const findsNorthridge = text === 'northridge' || (input === 'csun' && text === 'california state university northridge');
      return schoolResults(findsNorthridge ? [northridge, ...otherSchools] : otherSchools);
    });

    const results = await searchSchools(input, fetchImpl);
    expect(results).toHaveLength(10);
    expect(results[0]).toEqual(northridge);
    expect(new Set(results.map(({ id }) => id)).size).toBe(10);
    expect(fetchImpl.mock.calls.map(([, request]) => JSON.parse(String(request?.body)).variables)).toEqual([
      ...variants.map((text) => ({ query: { text }, first: 50 })),
      { query: input },
    ]);
  });

  it('starts all variants while the full-name request is pending', async () => {
    let finishFullSearch!: (response: Response) => void;
    const fullSearch = new Promise<Response>((resolve) => { finishFullSearch = resolve; });
    const fetchImpl = vi.fn<typeof fetch>()
      .mockReturnValueOnce(fullSearch)
      .mockResolvedValueOnce(schoolResults([northridge]))
      .mockResolvedValueOnce(schoolResults([northridge], 'autocomplete'));

    const pending = searchSchools(northridge.name, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    finishFullSearch(schoolResults([school, northridge]));
    expect(await pending).toEqual([northridge, school]);
  });

  it('counts whole words from the city and breaks ties by name length', async () => {
    const cityMatch = { ...northridge, name: 'California State University' };
    const partial = { ...school, name: 'California State University, Northridgeville' };
    const longer = { ...school, id: 'longer', name: 'California State University Northridge Example Campus' };
    const punctuationMatch = { ...northridge, id: 'exact', name: 'CALIFORNIA STATE UNIVERSITY—NORTHRIDGE' };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(schoolResults([partial, longer, punctuationMatch]))
      .mockResolvedValueOnce(schoolResults([]))
      .mockResolvedValueOnce(schoolResults([cityMatch], 'autocomplete'));

    expect(await searchSchools(northridge.name, fetchImpl)).toEqual([punctuationMatch, cityMatch, longer, partial]);
  });

  it('keeps successful results if autocomplete fails', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(schoolResults([northridge]))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));

    expect(await searchSchools('Northridge', fetchImpl)).toEqual([northridge]);
  });

  it('avoids an empty or repeated variant when there are no distinctive words', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(schoolResults([]))
      .mockResolvedValueOnce(schoolResults([], 'autocomplete'));

    expect(await searchSchools('University of California', fetchImpl)).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each(['ratemyprofessors.com/school/163', '163'])('routes %s to the school node lookup', async (input) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { node: northridge } }));

    expect(await searchSchools(input, fetchImpl)).toEqual([northridge]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)).variables).toEqual({ id: northridge.id });
  });

  it('sends both school query shapes, logs their counts, and returns ten school nodes', async () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({ ...school, id: `school-${i}`, legacyId: i }));
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(schoolResults(nodes))
      .mockResolvedValueOnce(schoolResults([nodes[0]!], 'autocomplete'));
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    expect(await searchSchools('Test', fetchImpl)).toEqual(nodes.slice(0, 10));
    const [url, request] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(RMP_GRAPHQL);
    expect(request?.method).toBe('POST');
    expect(request?.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Basic dGVzdDp0ZXN0' });
    expect(JSON.parse(String(request?.body))).toMatchObject({
      operationName: 'SearchSchools',
      query: expect.stringContaining('schools(query: $query, first: $first)'),
      variables: { query: { text: 'Test' }, first: 50 },
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toMatchObject({
      operationName: 'AutocompleteSearchQuery',
      query: expect.stringMatching(/\$query: String![\s\S]*autocomplete\(query: \$query\)[\s\S]*schools\s*\{\s*edges/),
      variables: { query: 'Test' },
    });
    expect(info).toHaveBeenCalledWith('[ProfNudge] RMP', 'SearchSchools', {
      variables: { query: { text: 'Test' }, first: 50 }, status: 200, edgeCount: 12, errors: [],
    });
    expect(info).toHaveBeenCalledWith('[ProfNudge] RMP', 'AutocompleteSearchQuery', {
      variables: { query: 'Test' }, status: 200, edgeCount: 1, errors: [],
    });
  });

  it('uses a scoped one-page teacher search and maps the legacy ID', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(page([1], 3, 'next'));

    expect(await searchTeachers('Ada', school.id, undefined, fetchImpl)).toEqual([
      { rmpId: 1, firstName: 'Ada', lastName: 'Lovelace', department: 'Math', numRatings: 12 },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({
      query: expect.stringContaining('teachers(query: $query, first: $first, after: $after)'),
      variables: { query: { text: 'Ada', schoolID: school.id }, first: 20, after: '' },
    });
  });

  it('fetches three roster pages by cursor and reports progress after each page', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(page([1, 2], 4, 'cursor1'))
      .mockResolvedValueOnce(page([2, 3], 4, 'cursor2'))
      .mockResolvedValueOnce(page([4], 4, null));
    const onProgress = vi.fn();

    const { profs, resultCount } = await fetchRoster(school.id, onProgress, fetchImpl);

    expect(profs.map((p) => p.rmpId)).toEqual([1, 2, 3, 4]);
    expect(resultCount).toBe(4);
    expect(fetchImpl.mock.calls.map(([, request]) => JSON.parse(String(request?.body)).variables)).toEqual(
      ['', 'cursor1', 'cursor2'].map((after) => ({ query: { text: ' ', schoolID: school.id }, first: 20, after })),
    );
    expect(onProgress.mock.calls).toEqual([[2, 4], [3, 4], [4, 4]]);
  });

  it('returns a partial roster when paging ends early', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(page([1], 3, null));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { profs, resultCount } = await fetchRoster(school.id, undefined, fetchImpl);
    expect(profs.map((p) => p.rmpId)).toEqual([1]);
    expect(resultCount).toBe(3);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('1 of 3'));
  });

  it('stops after 50 pages even if RMP reports more', async () => {
    let call = 0;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      call++;
      return page([call], 100, `cursor${call}`);
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect((await fetchRoster(school.id, undefined, fetchImpl)).profs).toHaveLength(50);
    expect(fetchImpl).toHaveBeenCalledTimes(50);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('50 of 100'));
  });

  it('throws a clear error when GraphQL reports an error', async () => {
    const errors = [{ message: 'Page size too large' }];
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      errors,
    }));
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    await expect(fetchRoster(school.id, undefined, fetchImpl)).rejects.toThrow('Page size too large');
    expect(info).toHaveBeenLastCalledWith('[ProfNudge] RMP', 'SearchTeachers', {
      variables: { query: { text: ' ', schoolID: school.id }, first: 20, after: '' }, status: 200, edgeCount: null, errors,
    });
  });

  it('throws a clear error for a non-200 response', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));

    await expect(searchSchools('Test State', fetchImpl)).rejects.toThrow('HTTP 503');
  });

  it('aborts a request after 15 seconds', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((_, request) => new Promise((_, reject) => {
      request?.signal?.addEventListener('abort', () => reject(request.signal?.reason), { once: true });
    }));
    const result = expect(searchSchools('Test State', fetchImpl)).rejects.toThrow('timed out');

    await vi.advanceTimersByTimeAsync(15_000);
    await result;
  });
});

describe('schedule name search', () => {
  const instructors: RosterProf[] = [
    { rmpId: 1, firstName: 'Marisol', lastName: 'Lindqvist', department: 'Computing', numRatings: 12 },
    { rmpId: 2, firstName: 'Colin', lastName: 'Brambleton', department: 'Computing', numRatings: 12 },
    { rmpId: 3, firstName: 'Rhea', lastName: 'de la Crúz', department: 'Computing', numRatings: 12 },
    { rmpId: 4, firstName: 'Jonas', lastName: 'Castellan', department: 'Math', numRatings: 12 },
  ];
  const schedule = [
    'Instructor: Marisol Lindqvist',
    'Instructor: Colin Brambleton',
    'Instructor: Rhea de la Cruz',
    'Instructor: Jonas Castellan',
  ].join('\n');

  it('searches only for the missing instructor when a large roster already matches three', async () => {
    const roster = [...instructors.slice(0, 3), ...Array.from({ length: 47 }, (_, i) => ({
      rmpId: 100 + i, firstName: 'Ada', lastName: 'Lovelace', department: 'Math', numRatings: 12,
    }))];
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: [instructors[3]] });
    vi.stubGlobal('browser', { runtime: { sendMessage } });

    const { matches, searched } = await findScheduleMatches(schedule, roster, vi.fn());

    expect(sendMessage.mock.calls).toEqual([[{ type: 'searchProfessors', text: 'Jonas Castellan' }]]);
    expect(matches.flatMap(({ candidates }) => candidates)).toEqual(instructors);
    expect(searched).toBe(51);
  });

  it('makes no name requests when the loaded roster already matches all four instructors', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: [] });
    vi.stubGlobal('browser', { runtime: { sendMessage } });
    const onNameSearch = vi.fn();

    const { matches } = await findScheduleMatches(schedule, instructors, onNameSearch);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(onNameSearch).not.toHaveBeenCalled();
    expect(matches.flatMap(({ candidates }) => candidates)).toEqual(instructors);
  });

  it('looks up ambiguous surnames and skips possible matches', async () => {
    const roster = [...instructors, { ...instructors[1]!, rmpId: 5, firstName: 'Chris' }];
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: [] });
    vi.stubGlobal('browser', { runtime: { sendMessage } });

    const { matches } = await findScheduleMatches('Instructor: Lindqvist\nInstructor: Brambleton', roster, vi.fn());

    expect(sendMessage.mock.calls).toEqual([[{ type: 'searchProfessors', text: 'Brambleton' }]]);
    expect(matches.map(({ confidence }) => confidence)).toEqual(['possible', 'ambiguous']);
  });
});

describe('roster cache', () => {
  function mockStorage(cached?: { fetchedAt: number; profs: unknown[] }) {
    const key = `profnudge:roster:${school.id}`;
    const local = {
      get: vi.fn().mockResolvedValue(cached ? { [key]: cached } : {}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    vi.stubGlobal('browser', { storage: { local } });
    return { key, local };
  }

  it('does not cache an empty roster and retries on the next load', async () => {
    const { local } = mockStorage({ fetchedAt: Date.now(), profs: [] });
    const fetchImpl = vi.fn().mockResolvedValueOnce(page([], 0, null)).mockResolvedValueOnce(page([1], 1, null));
    vi.stubGlobal('fetch', fetchImpl);

    expect(await getRoster(school)).toEqual([]);
    expect(local.set).not.toHaveBeenCalled();
    expect(await getRoster(school)).toMatchObject([{ rmpId: 1 }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('discards the old cache on refresh and stores a nonempty partial roster', async () => {
    const { key, local } = mockStorage({ fetchedAt: Date.now(), profs: [{ rmpId: 2 }] });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(page([1], 3, null)));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await getRoster(school, { force: true })).toMatchObject([{ rmpId: 1 }]);
    expect(local.remove).toHaveBeenCalledWith(key);
    expect(local.set).toHaveBeenCalledWith({
      [key]: { fetchedAt: expect.any(Number), profs: [expect.objectContaining({ rmpId: 1 })] },
    });
  });

  it('uses a fresh nonempty cache', async () => {
    const profs = [{ rmpId: 1 }];
    const { local } = mockStorage({ fetchedAt: Date.now(), profs });
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);

    expect(await getRoster(school)).toEqual(profs);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(local.set).not.toHaveBeenCalled();
  });

  it('expires a roster once it is older than 30 days', () => {
    const fetchedAt = 1_000;
    const expiresAt = fetchedAt + 30 * 24 * 60 * 60 * 1000;

    expect(isFresh(fetchedAt, expiresAt)).toBe(true);
    expect(isFresh(fetchedAt, expiresAt + 1)).toBe(false);
  });
});
