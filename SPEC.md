# ProfNudge — v1 spec

## Problem

Students finish a class and never leave a Rate My Professors (RMP) review. Two causes:

1. **Forgetting** — the term ends, the moment passes.
2. **Effort** — finding the page, filling the form and writing text is too much.

Existing open-source RMP extensions are all *read-side* (show ratings while you register). Nothing nudges students to *write* a review. ProfNudge is the write-side.

## Product shape

- Open-source **Chrome extension** (WXT + TypeScript), any school.
- **Funnels into RMP.** RMP has no public API and forbids automated submission; ProfNudge fills RMP's form in the student's own browser but **the student always clicks Submit**.
- One **hosted backend** (Supabase + Resend) run by the maintainer. Server URL is baked into the build.

## Flow

### 1. Track
- A **Track** button is injected on every RMP professor page (`/professor/{id}`).
- First click: in-page dialog asks for email (if not signed in) and term + term end date (prefilled with a default).
- Email sign-in uses a **Supabase magic link**. The link lands on the extension's `auth.html` page, which stores the session.
- Professors tracked before sign-in completes are kept locally and synced on sign-in.

### 2. Nudge
- A daily Supabase cron job calls the `send-nudges` Edge Function.
- For each tracked professor still `waiting`, nudges are due at **term end, +7 days, +21 days** (max 3).
- **One email per user per run**, listing every professor due, each with a *Review now* link to RMP's add-rating page plus *Already reviewed* / *Skip* links. Global *Unsubscribe* in the footer.

### 3. Review
- On RMP's add-rating page (`/add/professor-rating/{id}`), if the professor is tracked, ProfNudge opens an overlay:
  - taps: quality 1–5, difficulty 1–5, would take again, grade, attendance, textbooks, for credit, up to 3 tags
  - sentence-starter prompts that are stitched into review text (editable, 350-char limit as on RMP)
- **Fill RMP form** autofills every field. The student reviews and clicks RMP's own *Submit Rating*.

### 4. Stop
A professor's nudges stop when any of:
- the extension detects the RMP submission succeeded → `done`
- the student clicks *Already reviewed* (`done`) or *Skip* (`skipped`) in an email
- the student unsubscribes (all nudges stop)
- 3 nudges have been sent

### 5. Popup
Management only: tracked professors grouped by term with status, untrack, edit term end date, sign-in state, *Review now* per row. No review writing in the popup.

## Data and privacy

The server stores **only reminder data**:

| Table | Fields |
|---|---|
| `terms` | user, term key (e.g. `fall-2026`), end date |
| `tracked_professors` | user, RMP id, professor display name + school (public info, needed for the email), term key, status, nudges sent |
| `user_settings` | user, unsubscribed flag |

Plus the email address in Supabase Auth. **Review text, scores, tags and grades never leave the browser.**

## Out of v1

Firefox build, AI drafting, school-portal integrations, analytics.

## Accepted risks

- **Autofill breaks when RMP changes its form.** All RMP selectors live in `extension/lib/rmp.ts` so fixes are one-file. Field `name` attributes (verified Nov 2026): `rating`, `difficulty`, `wouldTakeAgain`, `forCredit`, `usesTextbooks`, `attendanceMandatory`, `grade`, `class`, `comment`, tag checkboxes (`Toughgrader`, …).
- **Track-only discovery** misses professors the student never looked up on RMP.
