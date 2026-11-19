import { send } from '@/lib/messaging';

const title = document.getElementById('title')!;
const body = document.getElementById('body')!;

const r = await send({ type: 'authCallback', url: location.href });
// Drop tokens from the address bar and history.
history.replaceState(null, '', location.pathname);

if (r.ok) {
  const n = r.state.professors.filter((p) => p.status === 'waiting').length;
  title.textContent = "You're signed in";
  body.textContent = `ProfNudge will email ${r.state.email} when your term ends${n ? ` about ${n} professor${n === 1 ? '' : 's'}` : ''}. You can close this tab.`;
} else {
  title.textContent = 'Sign-in failed';
  body.textContent = `${r.error}. Open the ProfNudge popup and request a new link.`;
}
