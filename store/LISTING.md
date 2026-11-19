# Chrome Web Store listing

Copy these into the Chrome Web Store Developer Dashboard. Upload `extension/.output/profnudge-<version>-chrome.zip` (build it with `npm run zip` in `extension/`).

## Store listing tab

**Name:** ProfNudge

**Summary** (132 characters max):

> Finish the class, leave the review. Reminds you to rate your professors on Rate My Professors when the term ends.

**Category:** Education

**Language:** English

**Description:**

> You meant to review your professor. Then the term ended, and you forgot. ProfNudge fixes that.
>
> HOW IT WORKS
> 1. Track: while you pick classes, click "Track" on any professor's Rate My Professors page and choose the term.
> 2. Get nudged: when the term ends, you get one email listing every professor you haven't reviewed yet. At most 3 reminders per class, then it stops.
> 3. Review in a minute: open the rating page and the ProfNudge panel walks you through it. Tap scores and tags, finish a few sentence starters, and ProfNudge fills in the Rate My Professors form. You check it and click Submit yourself.
>
> When you submit, ProfNudge marks that professor as reviewed and stops reminding you. You can also mark one as reviewed or skip it from the email.
>
> PRIVATE BY DESIGN
> • Your review text, scores, tags and grade never leave your browser. ProfNudge only fills in the form on the page.
> • The server only knows your email, which professors you track, and your term end dates.
> • Delete your account and all data from the popup at any time.
>
> OPEN SOURCE
> ProfNudge is free and open source (MIT): https://github.com/AvocadoGG1/ProfNudge
>
> ProfNudge is not affiliated with, endorsed by, or sponsored by Rate My Professors.

**Icon:** `extension/public/icon-128.png`

**Screenshots** (1280×800): `store/screenshots/*.png`

**Small promo tile** (440×280): optional, not made yet.

**Official URL / Homepage:** https://github.com/AvocadoGG1/ProfNudge

**Support URL:** https://github.com/AvocadoGG1/ProfNudge/issues

## Privacy practices tab

**Single purpose:**

> Remind students to review professors they took on Rate My Professors when their term ends, and help them fill in the review form.

**Permission justifications:**

- **storage:** Saves the professors you track, your term end dates and your sign-in session in the browser, so tracking works before you sign in and while offline.
- **Host permission `https://www.ratemyprofessors.com/*`:** Adds the Track button to professor pages, shows the review panel on the add-rating page, fills in the rating form when you click "Fill the form", and notices when your rating was submitted so reminders stop.
- **Host permission `https://<project>.supabase.co/*`:** ProfNudge's own backend. Syncs your tracked professors and term end dates so the reminder email can be sent, and handles email sign-in.

**Remote code:** No, I am not using remote code. (All JavaScript ships in the package; the backend is called with plain API requests.)

**Data usage** — check these and nothing else:

- **Personally identifiable information:** email address (sign-in and reminders).
- **Website content:** the names and IDs of professors you choose to track, read from Rate My Professors pages.

Certify all three: not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used for creditworthiness or lending.

**Privacy policy URL:** https://github.com/AvocadoGG1/ProfNudge/blob/main/PRIVACY.md

## Distribution tab

- **Visibility:** Public (or Unlisted for a soft launch with friends first).
- **Regions:** United States to start; Rate My Professors also covers Canada and the UK.

## Before submitting

- [x] Sending domain verified in Resend (`mail.andrewleopold.com`), `MAIL_FROM` uses it, click tracking off, `EMAIL_HTML=true`. Email links go to https://andrewleopold.com/ProfNudge/confirm.
- [ ] A friend signs in with a non-Gmail address and gets the code.
- [ ] `npm run zip` from a clean build, and the zip loads with "Load unpacked" after extracting.
