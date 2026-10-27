# Scraping Brightspace (D2L) into `data/coursework.json`

There are two ways to get real coursework in:

1. **Live refresh (macOS).** With `D2L_BASE_URL` set and a signed-in Brightspace tab open in
   Chrome or Opera, the **REFRESH FROM D2L** button runs `lib/server/courseworkRefresh.ts`. It uses
   AppleScript to run a same-origin script inside that tab, so it reuses your existing session and
   never sees your password. It needs an existing `data/coursework.json` (seed it first or build one
   by hand with the manual flow below) because it preserves syllabus-derived items across refreshes.
   In Chrome, enable *View → Developer → Allow JavaScript from Apple Events*.
2. **Manual, assisted scrape** (any OS), described below. Most schools put D2L behind SSO with MFA,
   so there is no unattended path, by design.

## Finding your tenant

- Your tenant is usually `https://<school>.desire2learn.com` or `https://<school>.brightspace.com`.
  The reliable way in is often the D2L tile on your school's portal. Once signed in, put the host
  in `D2L_BASE_URL`.
- Check the API versions your tenant reports at `<D2L_BASE_URL>/d2l/api/versions/` and set
  `D2L_LE_VERSION` / `D2L_LP_VERSION` if they differ from the defaults (1.96 / 1.62).
- The roster is derived from `/d2l/api/lp/<lp>/enrollments/myenrollments/?pageSize=200`, filtered to
  active, accessible course offerings whose code ends with the current term suffix (for example
  `_FALL_26`). Set `D2L_TERM_SUFFIX` if your school codes terms differently.

## Getting data out of the page

Two obvious transports fail from a page on the D2L origin:

- **POST to a localhost receiver**: Chrome's private-network access rules block it, and the request
  hangs rather than erroring.
- **Multiple file downloads**: Chrome blocks a site's second and later automatic downloads. The
  first one lands, the rest vanish silently.

What works is **the clipboard**: `navigator.clipboard.writeText(...)` in the page, then
`pbpaste > bundle.json` (macOS) or your OS equivalent. It needs document focus, so click the page
body once first. Binary files go through as base64 inside a JSON envelope.

## Steps

1. Open the tenant and confirm you are signed in (`/d2l/home` shows your courses).
2. In the page console, fetch these per course and assemble one object:

   ```
   /d2l/api/le/<le>/<orgUnitId>/dropbox/folders/
   /d2l/api/le/<le>/<orgUnitId>/quizzes/
   /d2l/api/le/<le>/<orgUnitId>/discussions/forums/        → then /forums/<id>/topics/
   /d2l/api/le/<le>/<orgUnitId>/grades/
   /d2l/api/le/<le>/<orgUnitId>/content/toc
   /d2l/api/le/<le>/<orgUnitId>/news/
   ```

   A same-origin `fetch` already carries the session; no extra credentials are needed.

3. Grab the syllabus and schedule documents. **They are not always in the content TOC as topics.**
   Some instructors attach the syllabus to a *module description*, so walk
   `toc.Modules[].Description.Text` for `/content/enforced/...` paths as well as `Topics[].Url`.
4. Decode the bundle. For .docx:
   `unzip -p x.docx word/document.xml | perl -pe 's/<w:p[ >]/\n\n<w:p /g; s/<[^>]+>//g'`.
5. Write `data/coursework.json` against the schema in `lib/coursework.ts` (see
   `data/example/coursework.sample.json`). Keep the per-item `sources` map: visible instructions,
   descriptions, attachment names, gradebook linkage, points, attempt limits and time limits. The
   prep policy reads them. They are source snapshots, not permission to start or submit anything.

## Rules the data has to keep

- **Never invent a due date.** No date means `due: null`, `confidence: "low"`, and a `note` naming
  where the real date lives. The UI shows that honestly.
- **Check D2L dates against the active enrollment window, not just the year.** Instructors often copy
  a course shell forward without rolling the due dates, so a dropbox can still carry last year's
  date. The refresh rejects out-of-window values; a current live date overrides an older
  syllabus/inferred date with the same item id.
- Some courses publish no `DueDate` at all; `Availability.EndDate` is then the real close.
- Item ids must stay stable across scrapes (`<short>-a<dropboxId>`, `-q<quizId>`, `-d<topicId>`,
  `-g<gradeId>`, `-s<n>` for syllabus items). `coursework-state.json` keys off them, and changing an
  id silently forgets that you marked something done.
- Work that lives in an external publisher platform (MindTap, MyLab and similar) usually shows up only
  as gradebook rows. Keep it undated and say so in `gaps[]` instead of guessing. Do not buy or start
  trial access just to read dates.
- Anything you could not cover goes in `gaps[]`, in plain language.
