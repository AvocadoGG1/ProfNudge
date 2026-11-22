import { composeReview, MAX_COMMENT, PROMPTS } from './compose';
import { send } from './messaging';
import {
  fillForm,
  findSubmitButton,
  GRADES,
  MAX_TAGS,
  readCourseOptions,
  type ReviewDraft,
  TAGS,
  waitForSubmitSuccess,
  type YesNo,
} from './rmp';
import { courseKey, STATE_KEY, type AppState, type TrackedProfessor } from './types';
import { chips, h, mountShadow } from './ui';

const HOST_ID = 'profnudge-review';

const CSS = `
.panel { position: fixed; top: 80px; right: 16px; width: 380px; max-width: calc(100vw - 32px); max-height: calc(100vh - 100px);
  overflow: auto; z-index: 2147483646; }
.head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
h2 { margin: 0; font-size: 17px; }
.x { background: none; border: 0; font-size: 20px; color: #666; }
.prompt { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.prompt span { font-size: 13px; color: #333; white-space: nowrap; }
.counter { text-align: right; }
.footer { position: sticky; bottom: -20px; background: #fff; padding: 12px 0 0; margin-top: 12px; }
.fab { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; }
`;

const YN: readonly YesNo[] = ['Yes', 'No'];
const SCALE = ['1', '2', '3', '4', '5'] as const;

/** Show the review panel on RMP's add-rating page for a tracked professor. */
export async function mountReviewPanel(prof: TrackedProfessor) {
  if (document.getElementById(HOST_ID)?.dataset.rmpId === String(prof.rmpId)) return;
  document.getElementById(HOST_ID)?.remove();

  const host = h('div', { id: HOST_ID });
  host.dataset.rmpId = String(prof.rmpId);
  document.body.append(host);
  const root = mountShadow(host, CSS);

  // The content script already selected a waiting term. Read its local course without syncing again.
  const [courses, stored] = await Promise.all([
    readCourseOptions(document),
    browser.storage.local.get(STATE_KEY).catch(console.warn),
  ]);
  const local = stored?.[STATE_KEY] as Pick<AppState, 'courses'> | undefined;

  // Draft state
  const quality = new Set<string>();
  const difficulty = new Set<string>();
  const again = new Set<YesNo>();
  const credit = new Set<YesNo>();
  const books = new Set<YesNo>();
  const attend = new Set<YesNo>();
  const tags = new Set<string>();
  const answers: Record<string, string> = {};
  let commentEdited = false;

  const courseInput = h('input', { type: 'text', list: 'pn-courses', placeholder: courses[0] ?? 'e.g. COMP 110' });
  courseInput.value = local?.courses?.[courseKey(prof.rmpId, prof.termKey)] ?? '';
  const courseList = h('datalist', { id: 'pn-courses' }, ...courses.map((c) => h('option', { value: c })));
  const online = h('input', { type: 'checkbox' });
  const grade = h('select', {}, h('option', { value: '' }, '—'), ...GRADES.map((g) => h('option', { value: g }, g)));

  const comment = h('textarea', { rows: '5', maxlength: String(MAX_COMMENT) });
  const counter = h('div', { class: 'muted counter' });
  const updateCounter = () => (counter.textContent = `${comment.value.length}/${MAX_COMMENT}`);
  comment.addEventListener('input', () => {
    commentEdited = true;
    updateCounter();
  });
  const recompose = () => {
    if (commentEdited) return;
    comment.value = composeReview(answers).slice(0, MAX_COMMENT);
    updateCounter();
  };
  updateCounter();

  const promptRows = PROMPTS.map((p) => {
    const inp = h('input', { type: 'text', placeholder: p.placeholder });
    inp.addEventListener('input', () => {
      answers[p.id] = inp.value;
      recompose();
    });
    return h('div', { class: 'prompt' }, h('span', {}, p.starter), inp);
  });

  const status = h('div');
  const fillBtn = h('button', { class: 'btn btn-primary', type: 'button' }, 'Fill the RMP form ↓');
  const noop = () => {};

  const panel = h(
    'div',
    { class: 'card panel' },
    h(
      'div',
      { class: 'head' },
      h('h2', {}, `Review ${prof.name}`),
      h('button', { class: 'x', title: 'Minimize', onclick: () => minimize() }, '–'),
    ),
    h('div', { class: 'muted' }, 'About a minute. Nothing here is sent to ProfNudge — it only fills the form on this page.'),
    h('label', {}, 'Course'),
    courseInput,
    courseList,
    h('label', { style: 'font-weight:400' }, online, ' Online course'),
    h('label', {}, 'Quality (1 awful – 5 awesome)'),
    chips(SCALE, quality, 1, noop),
    h('label', {}, 'Difficulty (1 easy – 5 very hard)'),
    chips(SCALE, difficulty, 1, noop),
    h('label', {}, 'Would you take them again?'),
    chips(YN, again, 1, noop),
    h('label', {}, 'Grade'),
    grade,
    h('label', {}, 'Taken for credit?'),
    chips(YN, credit, 1, noop),
    h('label', {}, 'Textbook used?'),
    chips(YN, books, 1, noop),
    h('label', {}, 'Attendance mandatory?'),
    chips(YN, attend, 1, noop),
    h('label', {}, `Tags (up to ${MAX_TAGS})`),
    chips(Object.keys(TAGS), tags, MAX_TAGS, noop),
    h('label', {}, 'Finish these sentences (skip any)'),
    ...promptRows,
    h('label', {}, 'Your review (edit freely)'),
    comment,
    counter,
    h('div', { class: 'footer' }, fillBtn, status),
  );

  const fab = h('button', { class: 'btn btn-primary fab', onclick: () => restore() }, `✏️ Review ${prof.name}`);
  const minimize = () => panel.replaceWith(fab);
  const restore = () => fab.replaceWith(panel);

  const one = <T>(s: Set<T>) => [...s][0];

  fillBtn.addEventListener('click', async () => {
    const draft: ReviewDraft = {
      course: courseInput.value.trim() || undefined,
      online: online.checked,
      quality: quality.size ? Number(one(quality)) : undefined,
      difficulty: difficulty.size ? Number(one(difficulty)) : undefined,
      wouldTakeAgain: one(again),
      forCredit: one(credit),
      textbooks: one(books),
      attendance: one(attend),
      grade: grade.value || undefined,
      tags: [...tags],
      comment: comment.value,
    };
    fillBtn.disabled = true;
    const missed = await fillForm(document, draft);
    fillBtn.disabled = false;
    status.replaceChildren(
      missed.length
        ? h('div', { class: 'err' }, `Filled most fields. Please set these by hand: ${missed.join(', ')}.`)
        : h('div', { class: 'ok' }, 'Form filled. Check it, then click Submit Rating on the page.'),
    );
    minimize();
  });

  // Mark done when the student's own Submit succeeds.
  watchSubmit();

  root.append(panel);
}

/**
 * One document-level listener for the tab's lifetime. RMP is a single-page app, so the student
 * can move on to another professor's form without a reload: read the professor from the panel
 * mounted at click time instead of capturing the first one.
 */
let watching = false;
function watchSubmit() {
  if (watching) return;
  watching = true;
  document.addEventListener(
    'click',
    async (e) => {
      const btn = findSubmitButton(document);
      if (!btn || !(e.target instanceof Node) || !btn.contains(e.target)) return;
      const rmpId = Number(document.getElementById(HOST_ID)?.dataset.rmpId);
      if (!rmpId) return;
      if (await waitForSubmitSuccess(document)) {
        await send({ type: 'markDone', rmpId });
      }
    },
    true,
  );
}
