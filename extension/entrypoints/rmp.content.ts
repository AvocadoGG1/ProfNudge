import { send } from '@/lib/messaging';
import { isAddRatingForm, professorIdFromPath } from '@/lib/rmp';
import { mountReviewPanel } from '@/lib/review-ui';
import { mountTrackButton } from '@/lib/track-ui';

export default defineContentScript({
  matches: ['https://www.ratemyprofessors.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    let busy = false;

    const route = async () => {
      if (busy) return;
      busy = true;
      try {
        const id = professorIdFromPath(location.pathname);
        if (id === null) {
          document.getElementById('profnudge-track')?.remove();
          document.getElementById('profnudge-review')?.remove();
          return;
        }
        if (location.pathname.startsWith('/professor/')) {
          await mountTrackButton(id);
        } else if (isAddRatingForm(document)) {
          const r = await send({ type: 'getState' });
          const prof = r.state?.professors.find((p) => p.rmpId === id && p.status === 'waiting');
          if (prof) await mountReviewPanel(prof);
        }
      } finally {
        busy = false;
      }
    };

    // RMP renders client-side: retry as the DOM fills in, and on SPA navigation.
    const obs = new MutationObserver(() => void route());
    obs.observe(document.body, { childList: true, subtree: true });
    ctx.onInvalidated(() => obs.disconnect());
    ctx.addEventListener(window, 'wxt:locationchange', () => void route());
    void route();
  },
});
