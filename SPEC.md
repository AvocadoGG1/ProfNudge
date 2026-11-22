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
- Email sign-in uses a **one-time code** (Supabase email OTP) typed into the Track dialog or popup. Not a magic link: school mail filters open links to scan them, which uses up a magic link before the student clicks it.
- Professors tracked before sign-in completes are kept locally and synced on sign-in.

#### Track (paste-in)
- In the popup, open **Add professors** and choose a Rate My Professors school. If you already track a professor, the school search starts with that professor's school name.
- Paste a class schedule and click **Find professors**. The extension loads the school's roster directly from RMP in the student's browser, shows loading progress, and caches the roster locally for 30 days. **Refresh list** fetches a fresh roster on demand.
- Matches that include a first name or initial and last name are preselected. Last-name-only matches need confirmation, and shared last names let the student choose a candidate. The student can also search for someone else at the same school.
- Choose one term and confirm the selection. Professors already tracked for that term are disabled. The professors use the same reminders and review overlay as page-based tracking. When a match includes a course code, it prefills the course field on that browser at review time.
- If RMP search fails, the popup keeps the paste and points the student to **Track** on the professor's RMP page.

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
The popup supports paste-in tracking, sign-in, and management of tracked professors grouped by term. Each row shows status and supports untracking, and the term end date can be edited. **Review now** opens the review page on RMP.

## Data and privacy

The server stores **only reminder data**. The extension also keeps some data local to the browser.

| Storage | Fields |
|---|---|
| `terms` | user, term key (e.g. `fall-2026`), end date |
| `tracked_professors` | user, RMP id, professor display name + school (public info, needed for the email), term key, status, nudges sent |
| `user_settings` | user, unsubscribed flag |
| Browser only | chosen paste-in school, cached RMP roster and course codes |

The email address is stored in Supabase Auth. **Pasted schedule text, review text, scores, tags and grades stay in the browser.**

## Out of v1

Firefox build, AI drafting, school-portal integrations, analytics.

## Accepted risks

- **Autofill breaks when RMP changes its form.** All RMP selectors live in `extension/lib/rmp.ts` so fixes are one-file. Field `name` attributes (verified Nov 2026): `rating`, `difficulty`, `wouldTakeAgain`, `forCredit`, `usesTextbooks`, `attendanceMandatory`, `grade`, `class`, `comment`, tag checkboxes (`Toughgrader`, …).
- **Paste-in tracking depends on RMP's undocumented GraphQL search.** All code that calls it lives in `extension/lib/rmp.ts`.
