import { send, type Reply } from '@/lib/messaging';
import { createPastePanel } from '@/lib/paste-ui';
import { addRatingUrl, professorUrl } from '@/lib/rmp';
import type { AppState, Msg } from '@/lib/types';
import { h } from '@/lib/ui';

const app = document.getElementById('app')!;
const top = h('div');
const bottom = h('div');
const paste = createPastePanel((msg) => act(msg, false));
app.append(top, paste.element, bottom);
let error = '';

// Optional "Support ProfNudge" link (Buy Me a Coffee, Ko-fi, GitHub Sponsors...). Hidden when unset.
const supportUrl: string | undefined = import.meta.env.VITE_SUPPORT_URL;

async function act(msg: Msg, showError = true) {
  const r: Reply = await send(msg);
  if (showError) error = r.ok ? '' : r.error;
  if (r.state) render(r.state);
  return r;
}

/** "v0.1.0 · dev · built Nov 21, 11:48 AM": tells you which build is loaded. */
function versionLabel() {
  const built = new Date(__BUILD_TIME__).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `v${browser.runtime.getManifest().version} · ${import.meta.env.DEV ? 'dev' : 'release'} · built ${built}`;
}

function render(st: AppState) {
  const header = h(
    'header',
    {},
    h('div', {}, h('h1', {}, '🔔 ProfNudge'), h('div', { class: 'muted version', title: `Built ${new Date(__BUILD_TIME__).toLocaleString()}` }, versionLabel())),
    h('span', { class: 'muted' }, st.email ?? 'Not signed in'),
  );

  const account = st.email ? null : signInSection(st);

  const terms = [...st.terms].sort((a, b) => b.endDate.localeCompare(a.endDate));
  const sections = terms
    .map((t) => {
      const profs = st.professors.filter((p) => p.termKey === t.key);
      if (!profs.length) return null;
      const end = h('input', { type: 'date', value: t.endDate, title: 'Term end date' });
      end.addEventListener('change', () => end.value && act({ type: 'setTermEnd', termKey: t.key, endDate: end.value }));
      return h(
        'section',
        {},
        h('div', { class: 'term-head' }, h('strong', {}, t.label), h('span', { class: 'muted' }, 'ends ', end)),
        ...profs.map((p) =>
          h(
            'div',
            { class: 'prof' },
            h(
              'div',
              { class: 'name' },
              h('div', {}, h('a', { href: professorUrl(p.rmpId), target: '_blank', style: 'color:inherit' }, p.name)),
              h('div', { class: 'muted' }, p.school),
            ),
            p.status === 'waiting'
              ? h('a', { class: 'btn primary', href: addRatingUrl(p.rmpId), target: '_blank' }, 'Review now')
              : h('span', { class: `badge ${p.status}` }, p.status === 'done' ? '✓ Reviewed' : 'Skipped'),
            h(
              'button',
              { class: 'icon', title: 'Untrack', onclick: () => act({ type: 'untrack', rmpId: p.rmpId, termKey: p.termKey }) },
              '✕',
            ),
          ),
        ),
      );
    })
    .filter(Boolean) as HTMLElement[];

  const body = sections.length
    ? sections
    : [h('div', { class: 'empty' }, 'No professors tracked yet.')];

  const footer = st.email
    ? h(
        'footer',
        {},
        h('button', { onclick: () => act({ type: 'signOut' }) }, 'Sign out'),
        h(
          'button',
          {
            onclick: () =>
              confirm('Delete your ProfNudge account and all tracked professors? This cannot be undone.') &&
              act({ type: 'deleteAccount' }),
          },
          'Delete my account',
        ),
      )
    : null;

  top.replaceChildren(header, ...(account ? [account] : []), ...(error ? [h('div', { class: 'err' }, error)] : []));
  paste.update(st);
  const support = supportUrl
    ? h(
        'div',
        { class: 'support' },
        'ProfNudge is free. ',
        h('a', { href: supportUrl, target: '_blank', rel: 'noopener' }, 'Support ProfNudge ♥'),
      )
    : null;
  bottom.replaceChildren(...body, ...(footer ? [footer] : []), ...(support ? [support] : []));
}

function signInSection(st: AppState) {
  if (st.pendingEmail) {
    const pending = st.pendingEmail;
    const code = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '10', placeholder: 'Code', required: true });
    const form = h('form', {}, code, h('button', { class: 'primary', type: 'submit' }, 'Sign in'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      act({ type: 'verifyCode', code: code.value });
    });
    queueMicrotask(() => {
      if (document.activeElement === document.body) code.focus();
    });
    return h(
      'section',
      {},
      h('div', { class: 'muted' }, `Enter the code we emailed to ${pending}.`),
      form,
      h(
        'div',
        { class: 'muted' },
        h('button', { class: 'link', type: 'button', onclick: () => act({ type: 'signIn', email: pending }) }, 'Send a new code'),
        ' · ',
        h('button', { class: 'link', type: 'button', onclick: () => act({ type: 'cancelSignIn' }) }, 'Use a different email'),
      ),
    );
  }
  const email = h('input', { type: 'email', placeholder: 'you@school.edu', required: true });
  const form = h('form', {}, email, h('button', { class: 'primary', type: 'submit' }, 'Email me a code'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    act({ type: 'signIn', email: email.value.trim() });
  });
  return h('section', {}, h('div', { class: 'muted' }, 'Sign in with your email to get reminders when your term ends.'), form);
}

act({ type: 'getState' });
