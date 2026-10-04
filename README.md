# ProgressPoint

A working tutoring workspace with a reusable question bank, assignments, independent practice, shared SQLite storage, and separate tutor, student, and read-only parent views. The domain is deliberately a placeholder.

## Run locally

Requires Node.js 24+ and pnpm 11.19.0.

```sh
npm install --global pnpm@11.19.0
pnpm install --frozen-lockfile
pnpm start
```

Open **http://localhost:3000**. On first launch, the private tutor link is written to **.data/tutor-access.txt**. Open that link to manage your workspace. Do not share the tutor link with students or parents.

On this Windows workspace, pnpm is also available at:
`C:\Users\natha\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd`.

No API key or external database is required for the core app. The first run adds **27 original starter math questions** and no student profiles or fabricated performance records.

## What works

- Reusable questions with multiple topic/course tags, difficulty (easy, medium, hard, harder), and answer format.
- Create/edit/archive questions; atomic JSON import (up to 500 at a time) and JSON export.
- First-name-only student profiles. Separate cryptographically random student and parent links, stored as hashes. Replace links independently to revoke the old link and its sessions.
- Assign by topic/course tags, difficulty, format, and problem count (or all matching), with a tailored preview for each student. Optional manual question selection remains available.
- Filter by seen/unseen history and each student’s per-question accuracy, with a minimum graded-attempt count. Assignments retain the original question snapshot when a question is later edited or archived.
- Search and practice by topic, course, difficulty, format, or prompt text.
- Repeats on/off; with repeats off, even a previously displayed but unanswered question is considered seen.
- Step-by-step practice is separate from difficulty. Guided attempts are labeled in analytics.
- MathLive answer field: live exponents, roots, fractions, common symbols, and an on-screen keyboard. All library assets and fonts are served from your server.
- Math response grading against the answer key: numeric equivalents and supported symbolic expressions. Computation runs in a separate worker with a time and memory limit. Unknown/unsupported expressions stay pending for tutor review.
- Optional exact/listed-form matching for skills where the form matters (e.g. factoring). Accepted alternate answers can be authored explicitly.
- Writing responses graded by an LLM against the supplied rubric when configured. Failures, missing keys, and budget exhaustion preserve the submission for tutor review. Tutors can override grades in Analytics → Recent practice.
- Automatic fresh question generation after unseen matching questions are exhausted, when enabled and configured. Generated questions are validated, tagged, saved for reuse, and marked unreviewed.
- Overall, student, assignment, and tag analytics; 14/30/90-day time series; first unguided attempt filter; sample sizes and pending grades.
- Workspace settings, About/privacy information, and copyright footer on every page.
- Per-student export and deletion; consistent database backup script.
- Container, health check, restart policy, persistent volume, and HTTPS proxy configuration.

## Building assignments

Open **Assignments → Create assignment**, choose students, then select tags and a problem count or **Assign all matching problems**. Within a group, any selected tag matches; across groups, all groups must match. For example: Factoring or Quadratics, plus Algebra I, plus easy or medium. Each student receives their own matching set, with unseen questions prioritized, then lower accuracy. Ties are shuffled.

To revisit weak questions, enter **65** in **Student accuracy below (%)**. This selects questions with accuracy strictly below 65% for that student, using all graded attempts, including repeats and guided practice. The badges show both percentage and counts. Exactly 65%, pending grades, and questions with no graded attempts do not match. Increase the minimum attempt count when you want more evidence before selecting a question.

Use **Explore questions & student history** to inspect seen/unseen labels and scores for a selected learner. “Seen” includes a displayed question even when no answer was submitted. Switch to manual mode to choose particular questions or select all matches in the visible filtered list; manual mode gives every selected student the same explicit set.

Preview before assigning. Shortages are shown per student and block creation until you adjust the filters or count. A set can contain up to 100 problems. Previews last 15 minutes; changes to selected questions or their student history require a fresh preview. Creating a set preserves exactly the questions in its preview.

Worksheet ingestion is currently assisted: provide worksheets and answer keys in the chat for extraction and review, then import the resulting question JSON through the question bank. There is no automatic PDF/Word uploader in the website yet. Missing keys, ambiguous notation, and diagram-dependent questions need review before import.

## LLM setup

Copy `.env.example` to `.env` and set the key for your chosen provider on the server:

- OpenAI: `OPENAI_API_KEY`
- Gemini: `GEMINI_API_KEY`
- Another compatible provider: `COMPATIBLE_API_KEY` and an HTTPS `COMPATIBLE_BASE_URL` ending at its API base, typically `/v1`.

Restart the server after changing environment variables. In **Settings**, select the provider and its supported model ID, then save. Enable automatic question generation if desired; writing grading has its own switch. No model is assumed because availability varies by account/provider. Compatible providers must support the Chat Completions JSON-schema format.

The daily limit counts outbound generation and grading attempts across the workspace, including failed requests, by UTC date. It is a request cap, not a dollar/token budget; also configure spending limits at the provider.

Question generation sends selected curriculum filters, up to three reference questions, and tutor instructions. It does **not** send profile names, IDs, links, submitted answers, or performance history. Writing grading necessarily sends the submitted writing and its question/rubric, but not the profile or analytics. Students are prompted to omit personal details.

OpenAI uses the Responses API with structured JSON output and `store: false`. Gemini uses `generateContent` with a JSON schema. The app validates returned data and keeps keys out of browser responses.

## Data and grading details

- SQLite is stored in `.data/tutoring.sqlite` (or `DATA_DIR`).
- Browser sessions use HttpOnly, SameSite cookies; HTTPS deployments also use Secure cookies. Access tokens arrive through URL fragments, are exchanged for sessions, and are removed from the displayed URL.
- Students and parents are scoped on the server, regardless of URL parameters.
- Profiles collect only a first name or nickname. Learning records store submitted responses, question versions/tags, correctness, UTC dates, guided status, and estimated active time.
- Active time pauses when the tab is hidden, is capped at 60 minutes per answer, and is an estimate supplied by the browser.
- Accuracy is correct / graded attempts; pending responses are excluded. First-attempt filtering uses the first submitted attempt per learner/question across their history; if it was guided, the question is excluded from the unguided-first view.
- A mathematically equivalent answer is not necessarily the requested form. Use listed-form matching and alternatives for form-sensitive questions. General symbolic equivalence is not guaranteed; unresolved comparisons are sent to tutor review.
- Writing grades are binary (meets rubric / needs practice), with feedback. There is no automatic grade retry after a failed call; tutors can grade pending responses.
- No student email, birthday, school, contact form, advertisements, analytics trackers, or request logs are configured. Your hosting provider may keep infrastructure logs.
- Live-record deletion cascades through assignments, attempts, sessions, views, and feedback. Separately manage any exports and backups you retain.
- This is one tutor workspace per deployment. Anyone holding the tutor link can manage that workspace. Full multi-tutor accounts, encrypted-login providers, worksheet/PDF ingestion, and AI tutoring insights are future work.

## Verification

```sh
pnpm test
pnpm exec playwright install chromium
pnpm test:browser
```

To use an installed Edge browser instead, set `BROWSER_CHANNEL=msedge` before `pnpm test:browser`. Browser tests run against a separate in-memory database and save screenshots under ignored `test-results/`; they do not create students in the real database.

Integration tests cover access isolation, parent restrictions, link revocation, immutable assignments, duplicate submissions, no-repeat practice, atomic imports, symbolic math, mocked LLM grading/generation, analytics, deletion, cross-origin rejection, per-student assignment filters, exact accuracy boundaries, shortages, and stale previews. Browser tests also cover the assignment builder on desktop and mobile. Live provider calls require your API key and have not been tested.

## Backup and access recovery

```sh
pnpm backup
# Optional different output directory:
node --env-file-if-exists=.env scripts/backup.mjs /your/private/backup/folder

# Replace a lost tutor link and revoke all tutor sessions:
node --env-file-if-exists=.env scripts/reset-tutor.mjs
```

Backups use SQLite’s online backup API and can be taken while the server is running. Copy backups to private storage outside the host. See [DEPLOYMENT.md](DEPLOYMENT.md) for restore instructions and always-on hosting.

## API and library references

- [OpenAI structured output documentation](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Gemini content generation reference](https://ai.google.dev/api/generate-content)
- [MathLive integration](https://mathlive.io/mathlive/guides/integration/)
- [Compute Engine canonical forms](https://mathlive.io/compute-engine/guides/canonical-form/)
- [Node.js SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
