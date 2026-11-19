import { isRatingMutation, SUBMITTED_MSG } from '@/lib/rmp';

/**
 * Runs in the page's own JavaScript world so it can see RMP's GraphQL requests.
 * When the add-rating mutation comes back without errors, it tells the content script
 * (lib/review-ui.ts) via postMessage. No request or response data leaves the page.
 */
export default defineContentScript({
  matches: ['https://www.ratemyprofessors.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const original = window.fetch;
    window.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
      const res = await original.apply(this, args);
      const body = args[1]?.body;
      if (typeof body === 'string' && isRatingMutation(body)) {
        res
          .clone()
          .json()
          .then((j: { data?: unknown; errors?: unknown[] }) => {
            if (j?.data && !j.errors?.length) window.postMessage({ type: SUBMITTED_MSG }, location.origin);
          })
          .catch(() => {});
      }
      return res;
    };
  },
});
