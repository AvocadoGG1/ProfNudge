import type { RosterProf, School } from './types';

/**
 * Everything that depends on Rate My Professors' markup lives in this file.
 * When RMP changes its site and autofill breaks, fix it here.
 *
 * Verified against ratemyprofessors.com, November 2026.
 */

export const RMP_ORIGIN = 'https://www.ratemyprofessors.com';

export const professorUrl = (id: number) => `${RMP_ORIGIN}/professor/${id}`;
export const addRatingUrl = (id: number) => `${RMP_ORIGIN}/add/professor-rating/${id}`;

/** /professor/123 or /add/professor-rating/123 -> 123 */
export function professorIdFromPath(path: string): number | null {
  const m = path.match(/^\/(?:professor|add\/professor-rating)\/(\d+)/);
  return m ? Number(m[1]) : null;
}

// ---------- Professor page ----------

export function readProfessorPage(doc: Document): { name: string; school: string } | null {
  const name = doc.querySelector('[class*="NameTitle__Name"]')?.textContent?.trim();
  const school = doc.querySelector('a[href*="/school/"]')?.textContent?.trim();
  if (!name) return null;
  return { name, school: school ?? '' };
}

/** Element the Track button is inserted after. */
export function trackButtonAnchor(doc: Document): Element | null {
  return doc.querySelector('[class*="NameTitle__Wrapper"]');
}

// ---------- Add-rating form ----------

export const GRADES = [
  'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F',
  'Audit/No Grade', 'Drop/Withdrawal', 'Incomplete', 'Not sure yet', 'Rather not say',
] as const;

/** Display label -> checkbox `name` on RMP's form. RMP allows at most 3 tags. */
export const TAGS: Record<string, string> = {
  'Tough Grader': 'Toughgrader',
  'Get Ready To Read': 'Getreadytoread',
  'Participation Matters': 'Participationmatters',
  'Extra Credit': 'EXTRACREDIT',
  'Group Projects': 'Groupprojects',
  'Amazing Lectures': 'Amazinglectures',
  'Clear Grading Criteria': 'Cleargradingcriteria',
  'Gives Good Feedback': 'Givesgoodfeedback',
  Inspirational: 'Inspirational',
  'Lots Of Homework': 'Lotsofhomework',
  Hilarious: 'Hilarious',
  'Beware Of Pop Quizzes': 'Bewareofpopquizzes',
  'So Many Papers': 'Somanypapers',
  Caring: 'Caring',
  Respected: 'Respected',
  'Lecture Heavy': 'Lectureheavy',
  'Test Heavy': 'Testheavy',
  'Graded By Few Things': 'Gradedbyfewthings',
  'Accessible Outside Class': 'Accessibleoutsideclass',
  'Online Savvy': 'OnlineSavvy',
};
export const MAX_TAGS = 3;

export type YesNo = 'Yes' | 'No';

export interface ReviewDraft {
  course?: string;
  online?: boolean;
  quality?: number; // 1-5
  difficulty?: number; // 1-5
  wouldTakeAgain?: YesNo;
  forCredit?: YesNo;
  textbooks?: YesNo;
  attendance?: YesNo;
  grade?: string;
  tags: string[]; // display labels from TAGS
  comment: string;
}

export function isAddRatingForm(doc: Document): boolean {
  return !!doc.querySelector('textarea[name="comment"]');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Set a value the way React expects, so its onChange fires. */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function setChecked(el: HTMLInputElement | null, want: boolean) {
  if (el && el.checked !== want) el.click();
}

/** Open a react-select combobox and return its option elements. */
async function openSelect(doc: Document, inputId: string): Promise<HTMLElement[]> {
  const input = doc.getElementById(inputId) as HTMLInputElement | null;
  if (!input) return [];
  input.focus();
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true }));
  await sleep(250);
  // Options of the open menu belong to the same react-select instance as the focused input.
  const listbox = input.getAttribute('aria-controls');
  const scope = (listbox && doc.getElementById(listbox)) || doc;
  return [...scope.querySelectorAll<HTMLElement>('[id^="react-select"][id*="-option-"]')];
}

function closeSelect(doc: Document, inputId: string) {
  const input = doc.getElementById(inputId);
  input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
  (input as HTMLElement | null)?.blur();
}

async function chooseOption(doc: Document, inputId: string, label: string): Promise<boolean> {
  const opts = await openSelect(doc, inputId);
  const want = label.trim().toLowerCase();
  const opt = opts.find((o) => o.textContent?.trim().toLowerCase() === want);
  if (!opt) {
    closeSelect(doc, inputId);
    return false;
  }
  opt.click();
  await sleep(100);
  return true;
}

/** Course codes RMP already knows for this professor. */
export async function readCourseOptions(doc: Document): Promise<string[]> {
  const opts = await openSelect(doc, 'class');
  const out = opts.map((o) => o.textContent?.trim() ?? '').filter(Boolean);
  closeSelect(doc, 'class');
  return out;
}

/**
 * Fill RMP's form from a draft. Never submits.
 * Returns the names of fields it could not fill, so the UI can tell the student.
 */
export async function fillForm(doc: Document, d: ReviewDraft): Promise<string[]> {
  const missed: string[] = [];
  const byName = (n: string) => doc.querySelector<HTMLInputElement>(`input[name="${n}"]`);
  const radio = (n: string, v: YesNo) => doc.getElementById(`${n}-${v}`) as HTMLInputElement | null;

  if (d.course) {
    if (!(await chooseOption(doc, 'class', d.course))) missed.push(`course "${d.course}"`);
  }
  if (d.online !== undefined) setChecked(byName('online'), d.online);

  for (const [field, val] of [['rating', d.quality], ['difficulty', d.difficulty]] as const) {
    if (val === undefined) continue;
    const el = byName(field);
    if (el) setNativeValue(el, String(val));
    else missed.push(field);
  }

  for (const [field, val] of [
    ['wouldTakeAgain', d.wouldTakeAgain],
    ['forCredit', d.forCredit],
    ['usesTextbooks', d.textbooks],
    ['attendanceMandatory', d.attendance],
  ] as const) {
    if (!val) continue;
    const el = radio(field, val);
    if (el) setChecked(el, true);
    else missed.push(field);
  }

  if (d.grade && !(await chooseOption(doc, 'grade', d.grade))) missed.push('grade');

  for (const label of d.tags.slice(0, MAX_TAGS)) {
    const name = TAGS[label];
    const el = name ? byName(name) : null;
    if (el) setChecked(el, true);
    else missed.push(`tag "${label}"`);
  }

  const ta = doc.querySelector<HTMLTextAreaElement>('textarea[name="comment"]');
  if (ta) setNativeValue(ta, d.comment);
  else missed.push('comment');

  return missed;
}

// ---------- Submission detection ----------

export function findSubmitButton(doc: Document): HTMLButtonElement | null {
  return (
    [...doc.querySelectorAll<HTMLButtonElement>('button')].find((b) => /submit rating/i.test(b.textContent ?? '')) ??
    null
  );
}

/** postMessage type sent by entrypoints/rmp-submit.content.ts when RMP's rating mutation succeeds. */
export const SUBMITTED_MSG = 'profnudge:rating-submitted';

/** Does this GraphQL request body look like RMP's "add a rating" mutation? */
export const isRatingMutation = (body: string) => /\bmutation\b/i.test(body) && /rat(e|ing)/i.test(body);

/**
 * After the student clicks Submit, resolve true once RMP's rating mutation succeeds
 * (reported by the main-world fetch hook) or a thank-you message appears.
 * Leaving the page is NOT success: a failed submit followed by Back must not stop nudges.
 */
export function waitForSubmitSuccess(doc: Document, timeoutMs = 60_000): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (ok: boolean) => {
      clearInterval(timer);
      window.removeEventListener('message', onMessage);
      resolve(ok);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source === window && e.data?.type === SUBMITTED_MSG) finish(true);
    };
    window.addEventListener('message', onMessage);
    const started = Date.now();
    const timer = setInterval(() => {
      if (/thanks for (rating|your rating)|rating (has been )?submitted/i.test(doc.body.innerText)) finish(true);
      else if (Date.now() - started > timeoutMs) finish(false);
    }, 500);
  });
}

// ---------- RMP search ----------

export const RMP_GRAPHQL = `${RMP_ORIGIN}/graphql`;

const SCHOOL_SEARCH = `
  query SearchSchools($query: SchoolSearchQuery!, $first: Int!) {
    newSearch {
      schools(query: $query, first: $first) {
        edges { node { id legacyId name city state } }
      }
    }
  }
`;

const SCHOOL_AUTOCOMPLETE = `
  query AutocompleteSearchQuery($query: String!) {
    autocomplete(query: $query) {
      schools {
        edges { node { id legacyId name city state } }
      }
    }
  }
`;

const SCHOOL_BY_ID = `
  query SchoolById($id: ID!) {
    node(id: $id) {
      ... on School { id legacyId name city state }
    }
  }
`;

const TEACHER_SEARCH = `
  query SearchTeachers($query: TeacherSearchQuery!, $first: Int!, $after: String) {
    newSearch {
      teachers(query: $query, first: $first, after: $after) {
        edges { node { legacyId firstName lastName department numRatings } }
        pageInfo { hasNextPage endCursor }
        resultCount
      }
    }
  }
`;

type Edge<T> = { node: T };
type TeacherNode = Omit<RosterProf, 'rmpId'> & { legacyId: number };
type TeacherPage = {
  edges: Edge<TeacherNode>[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  resultCount: number;
};

type GraphqlErrors = { message: string }[];
type SearchConnections = {
  newSearch?: { schools?: { edges: unknown[] }; teachers?: { edges: unknown[] } };
  autocomplete?: { schools?: { edges: unknown[] } };
};

async function graphql<T>(operationName: string, query: string, variables: object, fetchImpl: typeof fetch): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let status: number | null = null;
  let edgeCount: number | null = null;
  let errors: GraphqlErrors | undefined;
  try {
    console.info('[ProfNudge] RMP', operationName, variables);
    const response = await fetchImpl(RMP_GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Basic dGVzdDp0ZXN0' },
      body: JSON.stringify({ operationName, query, variables }),
      signal: controller.signal,
    });
    status = response.status;
    const payload = await response.json().catch((error: unknown) => {
      if (status === 200) throw error;
      return {};
    }) as { data?: T & SearchConnections; errors?: GraphqlErrors } | null;
    const data = payload?.data;
    errors = payload?.errors;
    const connections = data?.newSearch;
    edgeCount = connections?.schools?.edges?.length ?? connections?.teachers?.edges?.length
      ?? data?.autocomplete?.schools?.edges?.length ?? null;
    if (status !== 200) throw new Error(`Rate My Professors returned HTTP ${status}.`);
    if (errors?.length) throw new Error(`Rate My Professors search failed: ${errors.map((e) => e.message).join('; ')}`);
    if (!data) throw new Error('Rate My Professors returned no search data.');
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Rate My Professors search timed out.');
    throw error;
  } finally {
    clearTimeout(timer);
    console.info('[ProfNudge] RMP', operationName, { variables, status, edgeCount, errors: errors ?? [] });
  }
}

export function parseSchoolLink(text: string): number | null {
  const input = text.trim();
  let digits: string | null = input;
  if (!/^\d+$/.test(input)) {
    const address = /^(?:https?:\/\/|\/)/i.test(input) ? input : `https://${input}`;
    let url: URL;
    try {
      url = new URL(address, RMP_ORIGIN);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(url.protocol) || !/^(?:www\.)?ratemyprofessors\.com$/.test(url.hostname)) {
      return null;
    }
    const pathId = url.pathname.match(/^\/(?:school|search\/professors)\/(\d+)\/?$/)?.[1];
    const queryId = /^\/search\/teachers\/?$/.test(url.pathname) ? url.searchParams.get('sid') : null;
    digits = pathId ?? queryId;
  }
  if (!digits || !/^\d+$/.test(digits)) return null;
  const id = Number(digits);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function schoolById(legacyId: number, fetchImpl = fetch): Promise<School> {
  const id = btoa(`School-${legacyId}`);
  const data = await graphql<{ node: School | null }>('SchoolById', SCHOOL_BY_ID, { id }, fetchImpl).catch(() => null);
  if (data?.node?.id) return data.node;
  return { id, legacyId, name: `School #${legacyId}`, city: '', state: '' };
}

const GENERIC_SCHOOL_WORDS = new Set(['university', 'college', 'state', 'of', 'the', 'at', 'california']);

function cleanSchoolName(name: string): string {
  return name.replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
}

async function searchSchoolNames(text: string, fetchImpl: typeof fetch): Promise<School[]> {
  const data = await graphql<{ newSearch: { schools: { edges: Edge<School>[] } } }>(
    'SearchSchools', SCHOOL_SEARCH, { query: { text }, first: 50 }, fetchImpl,
  );
  return data.newSearch.schools.edges.map(({ node }) => node);
}

async function autocompleteSchools(text: string, fetchImpl: typeof fetch): Promise<School[]> {
  const data = await graphql<{ autocomplete: { schools: { edges: Edge<School>[] } } }>(
    'AutocompleteSearchQuery', SCHOOL_AUTOCOMPLETE, { query: text }, fetchImpl,
  );
  return data.autocomplete.schools.edges.map(({ node }) => node);
}

export async function searchSchools(text: string, fetchImpl = fetch): Promise<School[]> {
  const id = parseSchoolLink(text);
  if (id !== null) return [await schoolById(id, fetchImpl)];

  const name = cleanSchoolName(text);
  if (!name) return [];

  const expandedSystem = name.replace(/(?<!\S)(?:cal state|csu)(?!\S)/gi, 'California State University');
  const expanded = expandedSystem.replace(/(?<!\S)csun(?: northridge)?(?!\S)/gi, 'California State University Northridge');
  const distinctive = expandedSystem.split(' ')
    .filter((word) => word.toLowerCase() !== 'csun' && !GENERIC_SCHOOL_WORDS.has(word.toLowerCase()))
    .join(' ');
  const variants = [...new Set([name, distinctive, expanded].filter(Boolean))];
  const results = await Promise.allSettled([
    ...variants.map((variant) => searchSchoolNames(variant, fetchImpl)),
    autocompleteSchools(name, fetchImpl),
  ]);
  const schools = new Map<string, School>();
  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const school of result.value) {
        if (!schools.has(school.id)) schools.set(school.id, school);
      }
    }
  }
  const first = results[0];
  if (first?.status === 'rejected' && results.every((result) => result.status === 'rejected')) throw first.reason;

  const typedWords = [...new Set(expanded.toLowerCase().split(' '))];
  const ranked = [...schools.values()].map((school) => {
    const schoolName = cleanSchoolName(school.name);
    const schoolWords = new Set(`${schoolName} ${cleanSchoolName(school.city ?? '')}`.toLowerCase().split(' '));
    const score = typedWords.filter((word) => schoolWords.has(word)).length;
    return { school, score, lengthDifference: Math.abs(schoolName.length - expanded.length) };
  });
  ranked.sort((a, b) => b.score - a.score || a.lengthDifference - b.lengthDifference);
  return ranked.slice(0, 10).map(({ school }) => school);
}

async function searchTeacherPage(text: string, schoolID: string, first: number, after: string, fetchImpl: typeof fetch) {
  const data = await graphql<{ newSearch: { teachers: TeacherPage } }>(
    'SearchTeachers', TEACHER_SEARCH, { query: { text, schoolID }, first, after }, fetchImpl,
  );
  const { edges, pageInfo, resultCount } = data.newSearch.teachers;
  const profs = edges.map(({ node: { legacyId, ...prof } }) => ({ rmpId: legacyId, ...prof }));
  return { profs, pageInfo, resultCount };
}

export async function searchTeachers(text: string, schoolId: string, first = 20, fetchImpl = fetch): Promise<RosterProf[]> {
  const { profs } = await searchTeacherPage(text, schoolId, first, '', fetchImpl);
  return profs;
}

export async function fetchRoster(
  schoolId: string,
  onProgress?: (loaded: number, total: number) => void,
  fetchImpl = fetch,
): Promise<{ profs: RosterProf[]; resultCount: number }> {
  const roster = new Map<number, RosterProf>();
  const cursors = new Set<string>();
  let after = '';
  let total = 0;
  for (let page = 0; page < 50; page++) {
    // The Python RMP client's school-wide roster request uses a single space.
    const { profs, pageInfo, resultCount } = await searchTeacherPage(' ', schoolId, 20, after, fetchImpl);
    for (const prof of profs) roster.set(prof.rmpId, prof);
    total = resultCount;
    onProgress?.(roster.size, total);
    const next = pageInfo.endCursor;
    if (!pageInfo.hasNextPage || !next || cursors.has(next)) break;
    cursors.add(next);
    after = next;
  }
  if (roster.size < total) console.warn(`Rate My Professors returned ${roster.size} of ${total} professors.`);
  return { profs: [...roster.values()], resultCount: total };
}
