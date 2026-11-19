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

/**
 * After the student clicks Submit, RMP either leaves the add-rating page or
 * shows a thank-you message. Resolves true if that happens within `timeoutMs`.
 */
export function waitForSubmitSuccess(doc: Document, startPath: string, timeoutMs = 60_000): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const left = location.pathname !== startPath && !location.pathname.startsWith('/add/');
      const thanks = /thanks for (rating|your rating)|rating (has been )?submitted/i.test(doc.body.innerText);
      if (left || thanks) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 500);
  });
}
