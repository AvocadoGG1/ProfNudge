import { send, type Reply } from '@/lib/messaging';
import { addRatingUrl, professorUrl } from '@/lib/rmp';
import type { AppState, Msg } from '@/lib/types';
import { h } from '@/lib/ui';

const app = document.getElementById('app')!;
let error = '';

async function act(msg: Msg) {
  const r: Reply = await send(msg);
  error = r.ok ? '' : r.error;
  if (r.state) render(r.state);
}

function render(st: AppState) {
  const header = h('header', {}, h('h1', {}, '🔔 ProfNudge'), h('span', { class: 'muted' }, st.email ?? 'Not signed in'));

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
    : [h('div', { class: 'empty' }, 'Nothing tracked yet. Open a professor on Rate My Professors and click Track.')];

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

  app.replaceChildren(header, ...(account ? [account] : []), ...(error ? [h('div', { class: 'err' }, error)] : []), ...body, ...(footer ? [footer] : []));
}

function signInSection(st: AppState) {
  const email = h('input', { type: 'email', placeholder: 'you@school.edu', value: st.pendingEmail ?? '', required: true });
  const form = h('form', {}, email, h('button', { class: 'primary', type: 'submit' }, st.pendingEmail ? 'Resend link' : 'Sign in'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    act({ type: 'signIn', email: email.value.trim() });
  });
  return h(
    'section',
    {},
    h(
      'div',
      { class: 'muted' },
      st.pendingEmail
        ? `Sign-in link sent to ${st.pendingEmail}. Click it to turn on email reminders.`
        : 'Sign in with your email to get reminders when your term ends.',
    ),
    form,
  );
}

act({ type: 'getState' });
