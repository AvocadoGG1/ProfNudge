import { send } from './messaging';
import { readProfessorPage, trackButtonAnchor } from './rmp';
import { termChoices } from './terms';
import type { AppState, Term } from './types';
import { h, mountShadow } from './ui';

const HOST_ID = 'profnudge-track';

const CSS = `
.wrap { margin: 12px 0; }
.backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 2147483647; padding: 16px; }
.card { width: 100%; max-width: 380px; }
h2 { margin: 0 0 4px; font-size: 18px; }
.actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
`;

/** Inject the Track button on a professor page. Safe to call repeatedly. */
export async function mountTrackButton(rmpId: number) {
  const anchor = trackButtonAnchor(document);
  const info = readProfessorPage(document);
  if (!anchor || !info) return;

  const existing = document.getElementById(HOST_ID);
  if (existing?.dataset.rmpId === String(rmpId)) return;
  existing?.remove();

  const host = h('div', { id: HOST_ID });
  host.dataset.rmpId = String(rmpId);
  anchor.after(host);
  const root = mountShadow(host, CSS);
  const wrap = h('div', { class: 'wrap' });
  root.append(wrap);

  const render = (st: AppState) => {
    const tracked = st.professors.find((p) => p.rmpId === rmpId);
    wrap.replaceChildren(
      tracked
        ? h('button', { class: 'btn btn-tracked', title: 'Manage in the ProfNudge popup' }, `✓ Tracked for ${termLabel(st, tracked.termKey)}`)
        : h('button', { class: 'btn btn-primary', onclick: () => openDialog(root, st, { rmpId, ...info }, render) }, '🔔 Track — remind me to review'),
    );
  };

  const r = await send({ type: 'getState' });
  if (r.state) render(r.state);
}

/** Second step of the Track dialog for a signed-out student: type the emailed code. */
function showCodeStep(
  backdrop: HTMLElement,
  form: HTMLFormElement,
  email: string,
  profName: string,
  done: (st: AppState) => void,
) {
  const code = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '10', placeholder: '123456' });
  const msg = h('div');
  const verify = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Sign in');
  const resend = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Send a new code');
  resend.addEventListener('click', async () => {
    const r = await send({ type: 'signIn', email });
    msg.replaceChildren(h('div', { class: r.ok ? 'ok' : 'err' }, r.ok ? `New code sent to ${email}.` : r.error));
  });

  const step = h(
    'form',
    { class: 'card' },
    h('h2', {}, 'Check your email'),
    h('div', {}, `We sent a sign-in code to ${email}. Type it here to turn on reminders. ${profName} is saved either way.`),
    h('label', {}, 'Sign-in code'),
    code,
    msg,
    h('div', { class: 'actions' }, resend, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => backdrop.remove() }, 'Later'), verify),
  );
  step.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!code.value.trim()) return;
    verify.disabled = true;
    const r = await send({ type: 'verifyCode', code: code.value });
    verify.disabled = false;
    if (r.state) done(r.state);
    if (r.ok) backdrop.remove();
    else msg.replaceChildren(h('div', { class: 'err' }, r.error));
  });
  form.replaceWith(step);
  code.focus();
}

function termLabel(st: AppState, key: string) {
  return st.terms.find((t) => t.key === key)?.label ?? key;
}

function openDialog(
  root: ShadowRoot,
  st: AppState,
  prof: { rmpId: number; name: string; school: string },
  done: (st: AppState) => void,
) {
  const choices = termChoices();
  // Prefer an end date the student already set for that term.
  for (const c of choices) {
    const known = st.terms.find((t) => t.key === c.key);
    if (known) c.endDate = known.endDate;
  }

  const termSel = h('select', {}, ...choices.map((t) => h('option', { value: t.key }, t.label)));
  const endInput = h('input', { type: 'date', value: choices[0]!.endDate });
  termSel.addEventListener('change', () => {
    endInput.value = choices.find((t) => t.key === termSel.value)!.endDate;
  });

  const needsEmail = !st.email;
  const emailInput = h('input', { type: 'email', placeholder: 'you@school.edu', value: st.pendingEmail ?? '' });
  const msg = h('div');
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Track');

  const form = h(
    'form',
    { class: 'card' },
    h('h2', {}, `Remind me to review ${prof.name}`),
    h('div', { class: 'muted' }, 'We email you when the term ends — 3 reminders max. Your review itself never leaves your browser.'),
    h('label', {}, 'Which term are you taking this class?'),
    termSel,
    h('label', {}, 'When does that term end (after finals)?'),
    endInput,
    needsEmail && h('label', {}, 'Email for the reminder'),
    needsEmail && emailInput,
    needsEmail && h('div', { class: 'muted' }, "We'll email you a sign-in code to type in next."),
    msg,
    h('div', { class: 'actions' }, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => backdrop.remove() }, 'Cancel'), submit),
  );

  const backdrop = h('div', { class: 'backdrop' }, form);
  backdrop.addEventListener('click', (e) => e.target === backdrop && backdrop.remove());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const base = choices.find((t) => t.key === termSel.value)!;
    const term: Term = { ...base, endDate: endInput.value || base.endDate };
    const email = needsEmail ? emailInput.value.trim() : undefined;
    if (needsEmail && !email) {
      msg.replaceChildren(h('div', { class: 'err' }, 'Enter an email so we can remind you.'));
      return;
    }
    submit.disabled = true;
    const r = await send({ type: 'track', prof, term, email });
    if (!r.ok) {
      submit.disabled = false;
      msg.replaceChildren(h('div', { class: 'err' }, r.error));
      return;
    }
    done(r.state);
    if (r.state.email) backdrop.remove();
    else showCodeStep(backdrop, form, email!, prof.name, done);
  });

  root.append(backdrop);
  (needsEmail ? emailInput : termSel).focus();
}
