import { send } from '@/lib/messaging';
import { isAddRatingForm, professorIdFromPath } from '@/lib/rmp';
import { mountReviewPanel } from '@/lib/review-ui';
import { mountTrackButton } from '@/lib/track-ui';

export default defineContentScript({
  matches: ['https://www.ratemyprofessors.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    let busy = false;
    // Add-rating path already looked up. getState syncs with the server, so ask once per page.
    let checkedPath: string | null = null;

    const route = async () => {
      if (busy) return;
      busy = true;
      try {
        const id = professorIdFromPath(location.pathname);
        if (id === null) {
          document.getElementById('profnudge-track')?.remove();
          document.getElementById('profnudge-review')?.remove();
          checkedPath = null;
          return;
        }
        if (location.pathname.startsWith('/professor/')) {
          await mountTrackButton(id);
        } else if (checkedPath !== location.pathname && isAddRatingForm(document)) {
          checkedPath = location.pathname;
          const r = await send({ type: 'getState' });
          const prof = r.state?.professors.find((p) => p.rmpId === id && p.status === 'waiting');
          if (prof) await mountReviewPanel(prof);
        }
      } finally {
        busy = false;
      }
    };

    // RMP renders client-side: retry as the DOM fills in, and on SPA navigation.
    // Debounced, since React re-renders (e.g. every keystroke in the form) fire many mutations.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void route(), 250);
    };
    ctx.onInvalidated(() => clearTimeout(timer));
    const obs = new MutationObserver(schedule);
    obs.observe(document.body, { childList: true, subtree: true });
    ctx.onInvalidated(() => obs.disconnect());
    ctx.addEventListener(window, 'wxt:locationchange', () => void route());
    void route();
  },
});
