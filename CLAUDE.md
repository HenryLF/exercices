# Exercices: roadmap for implementing agents

This file is the whole plan. Read it top to bottom once, then work one milestone at a time
(section 9). The original brief is kept verbatim in Appendix A; everything else in this file is
the design derived from it and from the sibling project `../pools`, which this app is cloned from.

**How to use this file (agent prompt template):**

> Read `CLAUDE.md`. Implement milestone E<n> completely, following sections 4 to 8 as the spec.
> Definition of done is in section 3. When finished, update the status table in section 9,
> the Layout in section 4 if files moved, run `npm run check`, and report what you verified and
> what you did not.

Milestones run in order E0 → E7. Do not start E<n+1> before E<n> is ticked. Never reverse a
decision marked **(decided)** without asking the owner; open questions are listed in section 10
with the default to apply.

---

## 1. Goal

A small web app where **students** (*élèves*) solve auto-corrected **exercises** (*exercices*)
from their phone, and **admins** (teachers) create exercises, manage students by **group**
(*classe*), and read per-student results. One or a few admins, a few hundred students.

- **Students** sign in by scanning a personal QR code, then confirm their name and the
  6-digit code printed with the QR code. They stay signed in for a long time (section 5.2). They see the exercises assigned to
  their group and solve them question by question: each question has an input and its own
  submit button; a wrong answer turns the row red, a right one turns it green; the exercise is
  done when every question is green, then the app takes them to the next exercise.
- **Admins** sign in with username and password. They see results **per student**, create
  groups, create students one by one or by CSV import, print or download QR codes (one PNG per
  student, zipped per group), create **custom** exercises block by block, **generate** billing
  exercises (*calculs commerciaux*) with random but coherent numbers, and assign exercises to
  whole groups. Admins themselves are managed by a CLI script, as in pools.
- Every try and every tooltip opening is recorded per student and per question.

The first exercise family is the **billing exercise** from `sample/CalculComerciaux.pdf`
(pages 1-2: two filled examples; page 3: the definitions and worked examples that become the
tooltips). Other generated families will come later, so the exercise engine is modular
(section 6).

Deployed on Vercel, data in MongoDB Atlas, UI server-rendered **in French**. Code, comments,
commit messages, logs and this file are in English.

### Vocabulary

| Code / DB | UI (French) | Pools equivalent |
|---|---|---|
| `student`, role `student` | élève | pooler / enquêteur |
| `group` | classe | (none) |
| `exercise` | exercice | pool / sondage |
| `attempt` (one student × one exercise) | tentative | submission / réponse |
| `try` (one answer to one question) | essai | (none) |
| `tooltip` | indice | (none) |
| `block` | bloc | question |

The brief calls the second role "comitees"/"candidates"; the CSV and the rest of the brief make
clear they are pupils, so the role is `student` **(decided)**.

---

## 2. Start from `../pools` (decided)

`/home/henry/JS_TS/zubbat.site/pools` is a finished Express 5 + EJS + Mongoose app with the
same two-role, QR-login shape. **Copy it, don't rewrite it.** Read its `AGENTS.md`, `README.md`
and `docs/PLAN.md` before E0: they explain the stack, conventions, testing harness and Vercel
gotchas, and all of that applies here unchanged unless this file says otherwise.

What to copy verbatim (rename `pools` → `exercices`, `pooler` → `student`, `pool` → `exercise`,
`Sondages` → `Exercices`, `enquêteur` → `élève`):

- Tooling: `package.json` scripts, `tsconfig.json`, `eslint.config.mjs`, `.prettierrc`,
  `.prettierignore`, `.gitignore`, `vercel.json`, `docker-compose.yml`, `.env.example`,
  `vitest.config.ts`, `tests/global-setup.ts`, `tests/setup.ts`.
- `api/index.ts`, `src/dev-server.ts`, `src/create-app.ts`, `src/config.ts`, `src/db.ts`.
- `src/auth/*` (session, login-session, middleware, admin-login; `pooler-login` becomes
  `student-login` and changes per section 5), `src/models/admin.ts`, `scripts/admin.ts`.
- `src/lib/{names,dates,numbers,flash,http-error,validation}.ts`, `src/lib/csv.ts` (adapted).
- `views/partials/*`, `views/{welcome,error,login-admin,login-pooler→login-student}.ejs`,
  `public/{app.css,print.js,favicon.svg}`.
- `tests/helpers.ts` (adapted), `tests/http/auth.test.ts` (adapted).

What is dropped: `session.qrOnce` and the "QR shown once" rule, `qrTokenHash`, the pool
question editor (`src/lib/questions.ts`, `public/question-editor.js`, `views/admin/pool-*`),
submissions. What is new: groups, exercises, blocks, attempts, generators, CSV import, QR zip.

Do not add: React, Next.js, a client framework or bundler, another ORM, JWT auth, `csurf`,
native modules (`sharp`, `canvas`, `argon2`, `bcrypt`) that break Vercel builds.

---

## 3. Stack, commands, definition of done

Stack = pools' stack (Node 22, TypeScript strict + `noUncheckedIndexedAccess`, ESM with `.js`
import suffixes, tsx, Express 5, EJS, Mongoose 9, express-session + connect-mongo, zod 4,
bcryptjs, qrcode, helmet, express-rate-limit, Pico CSS v2 classless from jsDelivr, Vitest +
supertest + mongodb-memory-server, ESLint 9 + Prettier) **plus**:

| Package | Why |
|---|---|
| `markdown-it` | renders markdown blocks server-side; `html: false, linkify: false` so no raw HTML gets through |
| `csv-parse` | parses the student import CSV (`csv-parse/sync`, files are small) |
| `multer` (v2, memory storage) | receives the CSV upload on one route only |
| `fflate` | pure-JS zip of the QR PNGs |
| `seedrandom` | seeded PRNG so generated exercises are reproducible from their seed |

```bash
npm install
docker compose up -d                  # MongoDB 8 on localhost:27017
cp .env.example .env                  # set SESSION_SECRET and QR_SECRET (openssl rand -base64 48)
npm run admin -- set <username>       # create an admin or reset its password
npm run dev                           # http://localhost:3000
npm run check                         # tsc + eslint + vitest run: must pass
npm test
```

Environment: `MONGODB_URI`, `SESSION_SECRET` (≥ 32 chars), `QR_SECRET` (≥ 32 chars, signs QR
tokens; rotating it invalidates every printed QR code), `BASE_URL` (origin written into QR
codes, no trailing slash), `PORT`.

**Definition of done for every milestone:** `npm run check` clean; new behaviour has tests
(unit for pure functions, supertest for routes: happy path, anonymous, wrong role); no dead
code; no secrets in the repo; the Layout below matches the disk; the status table in section 9
is updated; French UI text follows pools' typography rules (non-breaking space before `: ; ! ?`,
typographic apostrophe, no gendered participles, `fmtNumber` for numbers).

---

## 4. Target layout

```
api/index.ts                     Vercel entry: export default createApp()
src/dev-server.ts                dotenv + listen(PORT)
src/create-app.ts                middleware order, routers, error handler (from pools)
src/config.ts                    zod env: MONGODB_URI, SESSION_SECRET, QR_SECRET, BASE_URL, PORT
src/db.ts                        cached mongoose connection (from pools)
src/models/admin.ts              unchanged from pools
src/models/group.ts              Group
src/models/student.ts            Student
src/models/exercise.ts           Exercise + Block subschemas, plainBlocks()
src/models/attempt.ts            Attempt
src/auth/session.ts              express-session; SessionData { role, userId, authVersion, renewedAt, flash }
src/auth/login-session.ts        startSession / endSession (from pools)
src/auth/middleware.ts           loadUser (authVersion check + daily renewal), requireRole, originCheck
src/auth/student-login.ts        token parsing, identity match, DB lockout
src/auth/admin-login.ts          from pools
src/lib/qr.ts                    qrSignature, loginUrl, parseLoginToken, qrSvg, qrPng
src/lib/blocks.ts                Block types, keys, student view (answers stripped), editor parsing, edit rules
src/lib/answers.ts               parseNumber, checkAnswer
src/lib/markdown.ts              renderMarkdown (markdown-it, html off)
src/lib/import-students.ts       CSV → rows → { created, skipped, errors } (pure parsing + a DB step)
src/lib/zip.ts                   safeFileName, uniqueFileNames, zipFiles, attachment header
src/lib/csv.ts                   results export rows (pure)
src/lib/purge.ts                 purgeStudents: students, attempts, student sessions (+ classes)
src/lib/results.ts               summarizeAttempt (one attempt), standing (all attempts of a student)
src/lib/content.ts               blocksFor(exercise, seed): stored blocks, or the generator's for a seed
src/lib/generators/index.ts      Generator interface + registry { billing }
src/lib/generators/billing.ts    catalogue, generateBilling(seed, params) → ExerciseInput
src/lib/{names,dates,numbers,flash,http-error,validation}.ts   from pools
src/routes/public.ts             /, /healthz, /login/:token, /admin/login, /logout
src/routes/student.ts            /exercises, /exercises/next, /exercises/:id, question + tooltip POSTs
src/routes/admin-students.ts     /admin (dashboard), /admin/students/*, QR page/PNG/regenerate, deactivate, delete
src/routes/admin-import.ts       /admin/students/import: upload, then a question for same-name rows, confirm, cancel
src/routes/admin-groups.ts       /admin/groups/*, exercise assignment + order, qr.zip, printable sheet
src/routes/admin-exercises.ts    /admin/exercises/*: custom editor, generate (templates), status, preview, results, CSV
src/routes/load.ts               loadStudent / loadGroup / loadExercise (404 on bad ids)
views/partials/                  head (nav + flash), foot, form-error, status, progress, exercise-body
                                 (shared by student page and admin preview), group-filter, student-fields
views/{welcome,error,login-admin,login-student}.ejs
views/student/                   exercises.ejs, exercise.ejs
views/admin/                     index (per-student results), students, student, student-qr, import,
                                 groups, group, group-qr-sheet, exercises, exercise-edit, block-row,
                                 generate, generate-billing, exercise-results, preview
public/                          app.css, print.js, block-editor.js, autosubmit.js, exercise.js,
                                 favicon.svg
scripts/admin.ts                 from pools
scripts/migrate.ts               npm run migrate: idempotent data migrations
scripts/purge.ts                 npm run purge: end-of-year purge of students (dry run without --yes)
tests/unit/                      answers-blocks, billing, qr-import-zip
tests/http/                      auth, student, admin-students-groups, admin-exercises
README.md                        for people: setup, onboarding a class, deploying
docs/GENERATORS.md               how to add a generated exercise family (rules, steps, tests)
sample/                          the owner's reference files (PDF, screenshots); removed from the
                                 working tree on 2026-09-29, tests no longer read it
```

---

## 5. Accounts, groups and authentication

### 5.1 Data model

```ts
Admin    { username (unique, lowercase), passwordHash, authVersion }           // as pools
Group    { name (unique, trimmed, ≤ 100), createdAt }                           // one class
Student  { name, nameKey, groupIds: ObjectId[] (several classes, or none),
           qrVersion: number (default 1), authVersion: number (default 1),
           failedAttempts, lockedUntil, lastLoginAt, lastSeenAt, active }
session  { role: 'admin' | 'student', userId, authVersion, renewedAt: number (ms), flash? }
```

Indexes: `Student { nameKey: 1 }`, `Student { groupIds: 1 }`, `Group { name: 1 } unique`.
A student belongs to any number of groups, possibly none **(decided 2026-09-29; was one group)**.
Changing a student's groups keeps their attempts. `npm run migrate` (`scripts/migrate.ts`,
idempotent) converts old `groupId` documents; the dev database has been migrated.

### 5.2 Rules (decided)

- **QR codes are multiple-use and re-printable.** No token is stored and no token is shown
  once. The login token is derived: `sig = base64url(HMAC-SHA256(QR_SECRET, `${studentId}:${qrVersion}`))`
  and the login URL is `${BASE_URL}/login/${studentId}.${sig}`. Lookup: split on the dot,
  check `^[0-9a-f]{24}\.[A-Za-z0-9_-]{43}$`, load the active student, recompute the signature
  with the stored `qrVersion`, compare with `timingSafeEqual`. The same QR works on any number
  of devices, any number of times, until regenerated.
- **Regenerating** a QR code = `qrVersion += 1` and `authVersion += 1` (old QR dead, every
  session dropped). Also reactivates a deactivated student. **Deactivating** = `active: false`,
  `authVersion += 1`; attempts are kept; the QR gives 404 while inactive.
- **Identity at login** = QR token + name + login code **(decided 2026-09-29; was the date of
  birth, which is no longer stored)**. Name matched as in pools (`normalizeName` → `nameKey`).
  The code is 6 digits derived like the token, `HMAC-SHA256(QR_SECRET, `code:${id}:${qrVersion}`)`
  → first 4 bytes mod 10⁶ (`loginCode` in `qr.ts`): never stored, printed on the QR page and
  sheet, put in the zip's file names, changed by regeneration. DB lockout: 5 failures → 15 min.
  Per-IP rate limit 20 / 15 min on both login POSTs. Both copied from pools.
- **Sessions**: students 30 days, admins 12 hours, both `rolling: true`. Cookie name
  `exercices.sid`, httpOnly, SameSite=Lax, Secure in production. `startSession` regenerates the
  id at login and sets `renewedAt = Date.now()`.
- **Daily revalidation (the brief's "token renewed if older than a day").** In `loadUser`, once
  the session resolved to a valid student: if `Date.now() - session.renewedAt > 24 h`, call
  `req.session.regenerate` keeping `role/userId/authVersion`, reset `cookie.maxAge` to the
  student lifetime, set `renewedAt = now`, save, and set `student.lastSeenAt = now`. The
  student therefore never expires while they use the app at least once a month, and a stale
  session id is replaced every day. `authVersion` mismatch still destroys the session
  immediately (regeneration, deactivation). Concurrent first requests of a day may both
  regenerate; the browser keeps the last cookie and both new sessions are valid, so nothing
  is lost. Test: a session with `renewedAt` 25 h old gets a new session id and a fresh cookie
  on the next request; one 1 h old does not.
- **Admins**: no UI, `npm run admin -- set|list|remove`, exactly as pools.
- **Never log** tokens, login codes, passwords.

### 5.3 Login routes

| Method, path | Who | Does |
|---|---|---|
| GET `/` | any | admin → `/admin`, student → `/exercises`, anonymous → welcome page ("scannez votre QR code") |
| GET `/login/:token` | public | 404 page "QR code invalide" if the token doesn't verify; else name + code form |
| POST `/login/:token` | public | identity check → session → redirect `/exercises/next` |
| GET/POST `/admin/login`, POST `/logout`, GET `/healthz` | | as pools |

---

## 6. Exercises, blocks, answers, attempts

### 6.1 Data model

```ts
Exercise { name (unique, trimmed, ≤ 150), kind: 'custom' | 'billing',
           status: 'draft' | 'open' | 'closed', position: number, allowRetry: boolean,
           groupIds: ObjectId[], blocks: Block[],
           generated?: { kind: 'billing', params: BillingParams },   // template: no blocks stored
           createdAt, updatedAt }

type Block =
  | { key: string; type: 'markdown'; body: string }
  | { key: string; type: 'given'; label: string; hint?: string; amount: number; unit?: string }
  | { key: string; type: 'question'; label: string; hint?: string; tooltip?: string;
      answer: { type: 'number'; value: number; decimals: number; tolerance: number; unit?: string }
             | { type: 'enum'; options: string[]; value: string } }

Attempt  { exerciseId, studentId, seed: string | null, status: 'in_progress' | 'completed',
           questions: { [blockKey]: { solved: boolean; tooltipShown: boolean; tooltipShownAt?: Date;
                                      tries: { try: number; tooltip: boolean; value: string | number;
                                               correct: boolean; at: Date }[] } },
           startedAt, completedAt }
```

Indexes: `Exercise { name: 1 } unique`, `Exercise { groupIds: 1 }`,
`Attempt { exerciseId: 1, studentId: 1, seed: 1 } unique`, `{ exerciseId, studentId, startedAt: -1 }`, `Attempt { studentId: 1 }`.

A `given` block is a table row without input (a value the student is told, such as the
gross purchase price); it exists so a billing table can show given amounts between questions.
The brief names only markdown and question blocks; `given` is the one addition **(decided)**.

Block keys are `b_` + 8 hex characters, assigned by the server when a block is first saved
(same mechanism as pools' `q_` keys). Attempts are keyed by them, so relabelling never breaks
data. `hint` is a short string shown next to the label (the billing table's *Taux* column, e.g.
`2 %`); `tooltip` is markdown shown on demand (section 7 says what goes in it).

### 6.2 Rules (decided)

- **Answers are exact values**: a number or one option of an enum. No ranges, no free text.
  Number input accepts `12,34`, `12.34`, `1 021,24` (spaces or U+00A0 as thousands separators)
  and strips a trailing `€` or `%`. The value is rounded to `decimals` (default 2) and correct
  when `|round(input) − value| ≤ tolerance` (default `0`; the billing generator uses `0.01` to
  absorb cent rounding, see section 7). Enum: exact match of one option.
- **The expected answer never reaches the browser.** Views get `studentView(blocks)`, where a
  question block carries only `{ key, type, label, hint, hasTooltip, answer: { type, options?, unit? } }`.
  A test asserts the exercise page HTML never contains an expected value.
- **Attempts**: a custom exercise has one attempt per student (`seed: null`). A generated
  exercise is **endless** **(decided 2026-09-28)**: each attempt draws a new seed, the numbers
  are regenerated from it on every request (`blocksFor`), and once an attempt is completed the
  student can start another one (`POST /exercises/:id/retry`, "Recommencer avec d’autres
  nombres") if the exercise's `allowRetry` is on (a checkbox on the generator form and on the
  exercise page, editable at any time; ticked by default on the form). The current attempt is the latest one. Every seed keeps its own tries and hints.
  The first attempt is created on the first GET of the exercise page (`startedAt`). A try is recorded only when the input parses: blank or unparsable input
  re-renders with status 400 and a message, and is **not** a try.
- **Recording**: `POST /exercises/:id/questions/:key` with `value`. If the question is already
  solved, redirect without recording. Else append
  `{ try: tries.length + 1, tooltip: tooltipShown, value, correct, at }`; if correct, mark
  `solved`. When every question block is solved, set `status: 'completed'`, `completedAt`, and
  redirect to `/exercises/:id?done=1`; otherwise redirect to `/exercises/:id#<key>`. The page
  renders each question row green (solved), red (last try wrong) or neutral (no try yet), with
  the count of tries and the last submitted value in the input.
- **Tooltip**: `POST /exercises/:id/questions/:key/tooltip` sets `tooltipShown = true` (once,
  with `tooltipShownAt`) and redirects back to `#<key>`; the page renders that tooltip open
  (markdown). Once opened, it stays open for that student. Every later try on that question
  carries `tooltip: true`. This is the brief's `{ tooltip: boolean, try: number }[]` record,
  with `value`, `correct` and `at` added because the admin views need them. No JavaScript is
  needed: both actions are plain forms with post-redirect-get, like the rest of the app.
- **Statuses**: `draft` invisible to students; `open` accepts tries; `closed` is shown
  read-only (forms disabled, colours kept). Admin can move between any two.
- **Access**: a student sees an exercise iff `student.groupId ∈ exercise.groupIds` and status
  is not draft. Students without a group see an empty list with a message.
- **Order and "next"**: `/exercises` lists the student's exercises by `position`, then name,
  each with its attempt status (à faire / en cours x/y / terminé). `/exercises/next` redirects
  to the first open exercise the student has never completed, else to `/exercises`. The
  `?done=1` page shows "Exercice terminé" and a button to `/exercises/next`.
- **Editing an exercise that has attempts**: markdown blocks are free; question blocks can be
  relabelled, their hint/tooltip changed, and their expected value corrected (past tries are not
  re-graded); a question block cannot be removed nor change its answer type; `given` and markdown
  blocks are free; blocks can be added and reordered. Same shape as pools' `validateEdit`.
- **Rendering**: markdown through `renderMarkdown` (markdown-it, `html: false`), inserted with
  `<%- %>`; everything else escaped with `<%= %>`. Consecutive `given` and `question` blocks render as rows
  of one `<table>` (Élément | Taux | Montant | état), a markdown block ends the table: that is what
  makes a billing exercise look like the PDF's table with no special block type.
- **Uniqueness**: `name` is unique across exercises; the editor and the generator refuse
  duplicates with a French message.

### 6.3 Generators (modular design)

Step-by-step guide with a tested worked example: [docs/GENERATORS.md](docs/GENERATORS.md).

```ts
interface Generator<P> {
  kind: string;                                  // 'billing'
  label: string;                                 // 'Calculs commerciaux'
  paramsSchema: z.ZodType<P>;                    // admin form → params
  generate(seed: string, params: P): ExerciseInput; // pure, deterministic
}
```

`ExerciseInput = { name, kind, blocks: Block[] (without keys), generated: { kind, seed, params } }`.
The registry in `generators/index.ts` maps kind → generator; the admin "Générer" page lists the
registry, so adding a family later is one new file plus one registry line. Generation is pure and
seeded (`rng.ts`): the same seed and params always give the same exercise, which is what the
tests use. Generated blocks get position-based keys (`withStableKeys`: `b_00000001`...), so
every seed has the same keys and results line up question by question. A generated exercise's
params can change until the first attempt; after that only its name can.

---

## 7. Billing exercise (*Calculs commerciaux*)

Source: `sample/CalculComerciaux.pdf` (pages rendered as `sample/CalculComerciaux_page-N.png`),
`sample/Billing.png` is a crop of page 2. Page 1 = guitar, TVA normal 20 %; page 2 = piano book,
TVA réduit 5,5 %; page 3 = one definition + one worked example per line, page 4 = blank notes.

### 7.1 Shape of a generated exercise

Blocks, in order:

1. `markdown`: `**Activité** : <activity>. **Taux de TVA** : <tva label>.` then
   `1. Calculer les éléments du prix du produit en complétant le tableau suivant.` then
   `**Produit :** <product>`.
2. One block per line of the table, in this order, with `hint` = the *Taux* column:

| Line | Given or question | hint | Expected value |
|---|---|---|---|
| Prix d'achat brut | `given` block | | `brut` |
| Remise | question | `r %` | `remise = round2(brut × r/100)` |
| Prix d'achat net | question | | `net = brut − remise` |
| Frais de livraison | question | `f %` | `frais = round2(net × f/100)` |
| **Coût d'achat HT** | question | | `coutHT = net + frais` |
| TVA déductible | question | `t %` | `tvaDed = round2(coutHT × t/100)` |
| Coût d'achat TTC | question | | `coutTTC = coutHT + tvaDed` |
| **Prix de vente HT** | `given` block | | `pvHT` |
| TVA collectée | question | `t %` | `tvaCol = round2(pvHT × t/100)` |
| **Prix de vente TTC** | question | | `pvTTC = pvHT + tvaCol` |
| Coefficient multiplicateur TTC | question (2 decimals) | | `round2(pvTTC / coutHT)` |
| Marge commerciale | question | | `marge = pvHT − coutHT` |
| Taux de marge | question (2 decimals, unit `%`) | | `round2(marge / coutHT × 100)` |
| Taux de marque | question (2 decimals, unit `%`) | | `round2(marge / pvHT × 100)` |

Given lines are `given` blocks (6.1), so the whole table is one run of `given` and `question`
blocks rendered as rows of a single `<table>`, exactly in the PDF's order.

Formulas are taken from page 3 (coefficient = PV TTC ÷ coût d'achat HT; marge = PV HT − coût
d'achat HT; taux de marge over coût d'achat HT; taux de marque over PV HT). Frais de livraison
is a percentage of the **net** purchase price (open question 10.2). Every amount question has
`decimals: 2, tolerance: 0.01, unit: '€'`; rates and the coefficient have `decimals: 2,
tolerance: 0.01`. Intermediate values are rounded to the cent at each line, as on a real
invoice, so a student who rounds line by line and one who carries full precision both land
within the tolerance.

Part 2 of the PDF ("Justifier les calculs effectués", free text) is not automatable with
enum/number answers and is left out of the app **(decided)**; the markdown intro may mention
that the justification is done on paper.

### 7.2 Tooltips

One tooltip per question, taken from page 3: a one-sentence definition, then the worked example.
Write them as markdown constants in `billing.ts`, e.g. for *Remise*:

```
**Remise** : réduction commerciale accordée sur le prix initial d'un produit (quantité importante, type de client, etc.).

*Exemple* : prix initial 200 €, remise 20 € → prix final = 200 − 20 = **180 €**.
```

Cover all twelve: Remise, Prix d'achat net, Frais de livraison, Coût d'achat HT, TVA déductible,
Coût d'achat TTC, TVA collectée, Prix de vente TTC, Coefficient multiplicateur TTC, Marge
commerciale, Taux de marge, Taux de marque. Use the PDF's own numbers in the examples, never
the exercise's numbers. (`sample/ToolTip.png` is only the page background with no text; page 3
is the reference.)

### 7.3 Catalogue and randomisation

`billing.ts` holds a catalogue of products, each with an activity, a TVA regime and a price
band. French TVA regimes: **normal 20 %**, **intermédiaire 10 %**, **réduit 5,5 %**,
**particulier 2,1 %**. Start with about 20 entries such as:

| Activité | Produit | TVA |
|---|---|---|
| magasin de musique, commercialisant des instruments de musique | Guitare électrique Fender Jimi Hendrix Strat MN 3 | normal |
| magasin de musique, commercialisant des instruments de musique | Livre - Technique et répertoire pianistique | réduit |
| librairie | Roman - édition brochée | réduit |
| épicerie fine | Café en grains 1 kg | réduit |
| restaurant | Plat du jour à emporter | intermédiaire |
| hôtel | Nuitée chambre double | intermédiaire |
| pharmacie | Médicament remboursable | particulier |
| kiosque à journaux | Abonnement presse quotidienne | particulier |
| magasin de sport | Vélo de route aluminium | normal |
| boutique de mode | Veste en cuir | normal |
| magasin d'informatique | Ordinateur portable 15" | normal |

Randomised per generated exercise from the seed: the product (thus activity and TVA), `brut`
(2 decimals within the product's band), `r ∈ {1, 2, 3, 4, 5, 10}`, `f ∈ {1, 2, 3, 5}`, and
`pvHT = round2(coutHT × k)` with `k` uniform in `[1.15, 2.20]`, so the selling price is always
coherent with the purchase cost and the margin positive. Admin params (`BillingParams`):
`lines`: for each of the 12 computed lines, `ask` (question), `give` (shown as a `given` row with
its value and rate) or `hide` (left out); default all `ask`. The gross purchase price and the
selling price excl. VAT are always given. `unsolvableLines` refuses a setting where an asked line
can't be derived from the visible values and rates (a hidden discount, delivery or VAT line also
hides its rate); at least one line must be asked. Settings lock at the first attempt, like any
params. The product is always drawn from the whole catalogue and the VAT rate is always that
product's own rate; the admin chooses neither **(decided 2026-09-29)**. Creating one gives a
single exercise named `Calculs commerciaux` (unique, ` – 2` on collision), renamable. A generator
family with settings would set `paramsView` to its form partial; billing's is `null`.

Unit tests: the two PDF examples reproduced exactly from fixed inputs (guitar: 1 021,24, 4 %,
2 %, 20 %, PV HT 1 250,00; book: 40,41, 2 %, 1 %, 5,5 %, PV HT 45,50) with the expected values
computed by hand in the test; determinism (same seed → same output); every generated exercise
has 12 questions, positive margin, the right TVA for its product; the checker accepts
`"1 250,00"` and `"1250"` for 1250.

---

## 8. Admin side

### 8.1 Results first

`/admin` is the results dashboard, **per student**: one row per active student (name, group,
exercises done / assigned, in progress, tries total, tooltips opened, last seen), filterable by
group, sorted by group then name. Clicking a student opens `/admin/students/:id`: identity
and QR actions at the top, then one row per exercise assigned to their group with status,
progress x/y, started/completed dates, and a per-question detail (label, tries with value,
correct, tooltip flag, time). `/admin/exercises/:id/results` is the same data pivoted per
exercise (one row per student), with `export.csv`.

CSV export per exercise (`src/lib/csv.ts`, UTF-8 with BOM, French headers, as pools): `Élève`,
`Classe`, `Statut`, `Commencé le`, `Terminé le`, then per question `<label> – essais`,
`<label> – indice` (oui/non), `<label> – résolu` (oui/non).

### 8.2 Students and groups

- `/admin/groups`: list with counts; create; `/admin/groups/:id`: rename, students, and **every
  exercise with an "Affecté" checkbox and its order** (`POST /admin/groups/:id/exercises`).
  Assignment lives here, not on the exercise page **(decided 2026-09-28)**; ticking a draft opens
  it. The order is shared by all classes of the exercise. Also buttons **Télécharger les QR codes (zip)** and
  **Planche à imprimer**.
- `/admin/students`: list filterable by group; create one (name, group) → redirects to the
  QR page; **Importer un CSV**.
- `/admin/students/:id`: edit name / group, **QR code** (always available), regenerate,
  deactivate. `/admin/students/:id/qr` shows the QR (SVG) + login URL + name, printable;
  `/admin/students/:id/qr.png` serves the PNG.
- **CSV import** (`/admin/students/import`, GET form + POST multipart): one file ≤ 2 MB, the
  target group chosen in the form. Format = the school software's export (`EXPORT_CSV` in
  `tests/helpers.ts`): header row, comma delimiter (also accept `;`, detected on the header
  line), UTF-8 with or without BOM. Only the `Élèves` column is used (found by header name after
  `normalizeName`); every other column (`Né(e) le`, `Classe de rattachement`, `Sexe`, options…)
  is ignored and never stored. The class column is empty in real exports, which is why the group
  is chosen in the form. Rows are deduplicated on `nameKey` inside the file (exports repeat the
  same pupil) and matched by name against the database (see the import notes in section 9).
  The result page lists created, skipped (with reason) and rejected lines (line number +
  message). Nothing is written when the header lacks the name column.
- **QR zip** (`/admin/groups/:id/qr.zip`): one PNG per active student of the group,
  `QRCode.toBuffer(loginUrl, { type: 'png', width: 512, margin: 2 })`, zipped with `fflate`,
  file name `<Student name>.png` (NFC, characters `/\:*?"<>|` removed, spaces collapsed,
  ` (2)` suffix on collision), zip named `<group>-qr.zip`, `Content-Disposition: attachment`.
  The name is in the file name only; drawing it inside the image would need a native raster
  library (open question 10.3). The printable sheet (`/admin/groups/:id/qr`) puts QR + name on
  paper, six cards per A4 page, via `print.js` and `@media print` CSS.

### 8.3 Exercises

- `/admin/exercises`: list (name, kind, status, groups, attempts started / completed, position).
- **Custom exercise** (`/admin/exercises/new`, `/admin/exercises/:id`): editor with a block
  list. Each row is `blocks[i][key|type|body|label|hint|tooltip|answerType|value|decimals|tolerance|unit|options]`,
  `options` one per line; `public/block-editor.js` adds/removes/moves rows and shows the fields
  of the chosen type (clone of pools' `question-editor.js`). Server parses with zod
  (`parseBlocksForm`), applies the edit rules of 6.2, refuses duplicate names.
- **Generate** (`/admin/exercises/generate`, then `/admin/exercises/generate/:kind`): the kind
  list comes from the registry; the billing form has the params of 7.3; POST creates one endless
  draft exercises and redirects to the list with a flash. A generated exercise opens in the
  same editor afterwards (blocks are ordinary blocks).
- `POST /admin/exercises/:id/status`, `GET /admin/exercises/:id/preview` (student view with
  expected answers displayed and forms disabled, nothing recorded; a generated exercise shows a
  new random draw on each load). Results and CSV have one row per attempt, with a *Tirage* (seed)
  column.

### 8.4 Route table (summary)

| Method, path | Who |
|---|---|
| GET `/exercises`, GET `/exercises/next`, GET `/exercises/:id` | student |
| POST `/exercises/:id/questions/:key`, POST `/exercises/:id/questions/:key/tooltip` | student |
| GET `/admin` | admin |
| GET/POST `/admin/groups`, GET/POST `/admin/groups/:id`, GET `/admin/groups/:id/qr`, GET `/admin/groups/:id/qr.zip` | admin |
| GET/POST `/admin/students`, GET/POST `/admin/students/import`, GET/POST `/admin/students/:id` | admin |
| GET `/admin/students/:id/qr`, GET `/admin/students/:id/qr.png`, POST `/admin/students/:id/qr`, POST `/admin/students/:id/deactivate` | admin |
| GET `/admin/exercises`, GET `/admin/exercises/new`, POST `/admin/exercises`, GET/POST `/admin/exercises/:id` | admin |
| GET `/admin/exercises/generate`, GET/POST `/admin/exercises/generate/:kind` | admin |
| POST `/admin/exercises/:id/status`, GET `/admin/exercises/:id/{preview,results,export.csv}` | admin |
| POST `/admin/groups/:id/exercises` (assignment and order) | admin |
| POST `/exercises/:id/retry` (generated only, after completion) | student |

Every mutating route: zod → on error re-render with status 400, `values` and `errors`; on
success flash + redirect. Ids go through `load.ts` (404 on bad ids). Whole prefixes guarded
with `router.use('/admin/…', requireRole('admin'))` and `router.use('/exercises', requireRole('student'))`.

---

## 9. Milestones

Each milestone ends with a clean `npm run check` and a ticked row here. Update the **Status**
column and add a one-line *Notes from implementation* under the milestone when something
deviated from the plan.

| # | Milestone | Outcome | Status |
|---|---|---|---|
| E0 | Scaffold from pools | App boots, healthz, layout, harness, admin CLI, nothing pools-specific left | Done |
| E1 | Accounts and auth | Group + Student models, HMAC QR login, daily renewal, lockout, admin login | Done |
| E2 | Exercise engine (pure) | Block types, answer checker, markdown, generator interface, billing generator with tooltips | Done |
| E3 | Student side | Exercise list, exercise page, per-question submit, tooltip, completion, next | Done |
| E4 | Admin: students and groups | Groups, students, CSV import, QR page / PNG / zip / print sheet, regenerate, deactivate | Done |
| E5 | Admin: exercises | Custom block editor, endless billing templates, status, preview; assignment on the class page | Done |
| E6 | Admin: results | Per-student dashboard, student detail, per-exercise results, CSV export | Done |
| E7 | Hardening and deploy | CSP check, error pages, README, production on Vercel + Atlas, smoke test | Code done; production pending |

### Notes from implementation (2026-09-28)

- All milestones were implemented in one pass. `npm run check` is green (128 tests after the 2026-09-29 changes). The app
  was run locally against an in-memory MongoDB and checked in headless Chromium at phone and
  desktop width: login by QR URL, wrong and right tries, tooltip, completion, dashboard,
  per-exercise results and the block editor.
- **Not done yet**: `git` has no commit (the repository is initialised, nothing committed);
  production (Atlas, Vercel project, env vars including `QR_SECRET`, domain, real admins) needs
  the owner's accounts. Follow README "Deploying to Vercel".
- `package.json` pins `overrides.mongodb` to the version mongoose ships with. Without it,
  connect-mongo pulls a newer driver and `MongoClient` types no longer match in `createApp`.
- The `given` block type (6.1) was added as planned; the billing table's two given lines use it.
- The billing generator aims for a round purchase cost (coût d'achat HT) and works back to the
  gross price, as the PDF examples do; all money math is in integer cents. `computeBilling`
  reproduces both PDF examples exactly (unit test).
- A correct answer redirects to the next unsolved question's anchor; a wrong one to the same
  question. Opening `/login/<token>` while already signed in as that student skips the form.
- Sessions live in the client's default database (connect-mongo), not the mongoose `dbName`;
  in tests that is `test`. The renewal test reads them there.
- **Change of 2026-09-28** (owner's request): generated exercises became endless templates
  (seed per attempt, retry after completion), assignment and order moved to the class page, and
  the favicon became an "E". Cause of the owner's bug report: an exercise assigned to a class was
  still a draft, so its students saw nothing; assigning from the class page now opens drafts.
  The dev database had an old unique index `exerciseId_1_studentId_1` on attempts, dropped by
  hand; a production database created after this change never has it.
- **Exercise list (2026-09-29)**: `/admin/exercises` is also an assignment grid (one checkbox per
  exercise × class, `a=<exerciseId>:<groupId>`, saved by `POST /admin/exercises/assign`; only the
  exercises in the submitted `shown` list change; ticking a draft opens it) with a delete link
  per exercise. The order stays on the class page.
- **Change of 2026-09-29 (evening)**: students, classes and exercises can be deleted, each
  behind a confirmation page (`views/admin/confirm-delete.ejs`) listing the consequences:
  deleting a student or an exercise deletes its attempts; deleting a class only removes it from
  its students and exercises. Students have `groupIds` (0..n classes). The CSV import is two
  steps when a row's name (via `nameKey`) matches existing students: the rows wait in
  `session.importDraft` and the admin chooses, per row, an existing student (added to the class,
  same QR code and results) or a new one; the oldest student with that name is suggested, and a
  row whose name is already in the class is skipped; nothing is written before the answer. Radio names are
  `choice[L<line>]`: numeric keys would make qs build a compacted array.
- **Data minimisation (2026-09-29, night)**, for GDPR (pupils are minors): the date of birth is
  gone from the model, forms, import and login; students sign in with QR + name + a 6-digit
  code derived from the QR (5.2). `npm run migrate` unsets `dob` on old documents (not yet run
  on the dev database). `npm run purge` deletes every student, attempt and student session at
  the end of the year (`--with-groups` also deletes classes); dry run without `--yes`. The
  import tests use an inline fixture (`EXPORT_CSV`) since `sample/` was removed.
- **Change of 2026-09-29**: `allowRetry` per exercise. The product and VAT-rate options were
  removed from the code, and `generated.params.productId` / `tvaRegime` were unset in the dev
  database. No attempt depended on them (the one exercise fixing a rate had no attempts).
- On phones (≤ 640 px) the exercise table switches to a stacked layout: label and rate on one
  line, the answer field and Valider button full width underneath. Since 2026-09-29 the student
  pages are tuned for phones: a sticky progress bar (`<progress>` + solved/total), solved
  questions collapse to one line showing the answer, "Indice" is a pill button, fields are 16 px
  (no iOS zoom) with `enterkeyhint="done"`, the header drops the student's name, and
  `public/exercise.js` focuses the question in the URL hash and blocks double submits.
- The admin checkbox for `allowRetry` is labelled "Infini" (owner's wording).
- The preview of a generated exercise takes `?seed=` (validated by `SEED_RE`, otherwise a random
  draw with a message) and has a form to type one. Every seed shown on the results page and the
  student page links to `/admin/exercises/:id/preview?seed=<seed>` (`views/partials/seed-link.ejs`).

### E0: Scaffold from pools

- **Read first**: `../pools/AGENTS.md` (all), `../pools/README.md`, section 2 of this file.
- **Tasks**
  1. Copy the files listed in section 2 into this repo; rename everything (`pools`→`exercices`,
     session cookie `exercices.sid`, brand "Exercices"). Remove pool/pooler/submission code.
  2. `src/config.ts`: add `QR_SECRET`. `.env.example` accordingly. `vitest.config.ts` env too.
  3. `createApp` with `publicRouter` only (`/`, `/healthz`, `/admin/login`, `/logout`);
     welcome page text for students ("scannez votre QR code"). Keep helmet CSP, originCheck,
     sessions, error handler exactly as pools.
  4. `scripts/admin.ts` unchanged. `docker-compose.yml`, `vercel.json` unchanged.
  5. Tests: healthz 200, `/` renders welcome, admin login ok / bad password / rate limit.
  6. `git init`, first commit. Do not add an AGENTS.md: this file is the guide; put
     `# See CLAUDE.md` in README.md for now.
- **Acceptance**: `npm run check` green; `npm run dev` serves the welcome page against local
  Mongo; no file mentions pools, poolers or sondages (grep it).
- **Do not**: add students, groups or exercises yet; change the stack.

### E1: Accounts and auth

- **Read first**: section 5; `../pools/src/auth/*`; express-session `regenerate`.
- **Tasks**
  1. Models `group`, `student` (5.1) with indexes and the `nameKey` pre-validate hook.
  2. `src/lib/qr.ts`: `qrSignature(id, version)`, `loginUrl(student)`, `parseLoginToken(token)`
     → `{ id, sig } | null`, `qrSvg`, `qrPng`.
  3. `src/auth/student-login.ts`: `findStudentByToken` (verify with `timingSafeEqual`),
     `attemptStudentLogin` with the DB lockout (port of pools).
  4. `src/auth/session.ts`: `renewedAt` in `SessionData`; `login-session.ts` sets it.
  5. `src/auth/middleware.ts`: `loadUser` with the daily renewal of 5.2 and `lastSeenAt`.
  6. Routes `/login/:token` GET/POST → `/exercises/next` (which can be a stub redirecting to
     `/exercises` until E3; add a placeholder `/exercises` page "Aucun exercice pour le moment"
     guarded by `requireRole('student')`).
  7. `tests/helpers.ts`: `createGroup`, `createStudent` (returns its login URL), `loginAsStudent`.
  8. Tests: unit (signature stable, token parsing rejects malformed, lockout); http (invalid
     token 404; wrong DoB 400 and counter; 5 failures → locked; success → cookie 30 days and
     redirect; qrVersion bump → old URL 404 and old session dropped; deactivate → 404 + dropped;
     renewal after 25 h regenerates the session id, not after 1 h; admin cannot open
     `/exercises`, student cannot open `/admin`).
- **Acceptance**: a student created in the test DB logs in through their derived URL on two
  agents at once; both stay logged in; regenerating logs both out and the old URL is dead.
- **Do not**: store any token; show a "once only" QR page; build admin pages.

### E2: Exercise engine (pure)

- **Read first**: sections 6 and 7; `../pools/src/lib/questions.ts` (parsing and edit-rule
  style); page 3 of the PDF for the tooltip texts.
- **Tasks**
  1. `src/lib/blocks.ts`: `Block` types, `newBlockKey`, `studentView(blocks)`, `parseBlocksForm`
     (editor payload → blocks, keys kept only if pre-existing), `validateEdit(existing, next, hasAttempts)`.
  2. `src/lib/answers.ts`: `parseNumber(input)` (comma, spaces, €, %), `checkAnswer(block, raw)`
     → `{ ok: true, value, correct } | { ok: false, message }`.
  3. `src/lib/markdown.ts`: `renderMarkdown` with markdown-it (`html: false`, `linkify: false`).
  4. `src/lib/generators/{index,rng,billing}.ts` per 6.3 and 7: catalogue, params schema,
     formulas, tooltips, names.
  5. Model `exercise.ts` (blocks as discriminated subschemas, `plainBlocks()`), model `attempt.ts`.
  6. Tests: `parseNumber` table; `checkAnswer` tolerance and enum; `studentView` strips values;
     `validateEdit` cases; `renderMarkdown` neutralises `<script>` and raw HTML; billing: the two
     PDF examples, determinism, invariants of 7.3; every tooltip non-empty and containing the
     word *Exemple*.
- **Acceptance**: `npm run check` green with no routes or views added; a generated billing
  exercise printed as JSON in a test looks like the PDF table in order.
- **Do not**: touch views or routes; add a second generator family.

### E3: Student side

- **Read first**: section 6.2; `../pools/views/pooler/pool-form.ejs` for the form style.
- **Tasks**
  1. Routes `student.ts`: `/exercises`, `/exercises/next`, `/exercises/:id` (creates the attempt),
     `POST …/questions/:key`, `POST …/questions/:key/tooltip`; 403 when the exercise is not
     assigned to the student's group or is draft; closed → read-only.
  2. Views `student/exercises.ejs` (status per exercise, "Continuer" button), `student/exercise.ejs`
     rendering blocks (markdown, consecutive questions as one table; each question row = its own
     `<form>` with input, "Valider" button, state colour, tries count, "Indice" form and the open
     tooltip), `?done=1` banner with "Exercice suivant".
  3. `app.css`: `.row-ok` / `.row-ko` colours readable in light and dark, phone-first table.
  4. Tests (http): list shows only the group's non-draft exercises in position order; unassigned
     → 403; page contains no expected value; correct answer → solved and green class; wrong →
     recorded with `correct: false`; blank → 400 and nothing recorded; tooltip → `tooltipShown`
     and later tries carry `tooltip: true`; solving all → completed and `?done=1`; `/exercises/next`
     order; closed exercise refuses POST; solved question ignores further POSTs.
- **Acceptance**: with an exercise and a student created in the DB, a student logged in on a
  phone-width browser solves the piano-book exercise line by line, sees red/green, opens an
  indice, finishes, and lands on the next exercise.
- **Do not**: add JavaScript for submissions (progressive enhancement is a later idea); allow
  editing a recorded try.

### E4: Admin: students and groups

- **Read first**: section 8.2; `../pools/src/routes/admin-poolers.ts`; csv-parse sync API;
  multer memory storage; fflate `zipSync`.
- **Tasks**
  1. Routes `admin-groups.ts`, `admin-students.ts` (without the results dashboard, which is E6;
     `/admin` can list students plainly until then).
  2. `src/lib/import-students.ts`: `parseStudentsCsv(buffer)` → `{ rows, errors }` pure;
     `importStudents(rows, groupId)` → `{ created, skipped }`.
  3. `src/lib/zip.ts`: `zipQrCodes(students)`; file-name sanitising helper with tests.
  4. Views: groups, group (students, exercises, zip + sheet buttons), group-qr-sheet (print),
     students, student (edit, QR actions), student-qr, import (form + result).
  5. Tests: group CRUD and unique name; student create → QR page; regenerate → old URL 404;
     deactivate; move group; import of `sample/Export CSV.csv` creates exactly one student
     (Alice Martin, 2000-05-03) in the chosen group and reports 14 duplicates; a second import
     skips her; `;`-delimited and BOM variants; missing columns → nothing written; zip contains
     one PNG per active student with sanitised names; PNG route returns `image/png`.
- **Acceptance**: in the browser, create a group, import the sample CSV, open the student, print
  the QR, download the zip and open a PNG from it with a phone camera to log in.
- **Do not**: draw text inside PNGs; accept files over 2 MB; move existing students on import.

### E5: Admin: exercises

- **Read first**: section 8.3; `../pools/views/admin/pool-edit.ejs` and `public/question-editor.js`.
- **Tasks**
  1. Routes `admin-exercises.ts`: list, new, create, edit, update (edit rules), status, assign,
     position, preview, generate (list + per kind form + POST), regenerate.
  2. Views: exercises, exercise-edit + block-row (template for the three block types: markdown, given, question),
     generate-billing, preview (student view with answers shown).
  3. `public/block-editor.js`: add / remove / move rows, show fields per type, renumber before
     submit; rows with attempts are `data-locked` (no remove, no type change).
  4. Tests: create custom exercise with markdown + number + enum; duplicate name refused; edit
     rules when attempts exist; generate 3 billing exercises → 3 drafts with unique names and
     12 questions each; assign to a group makes it visible to that group's student (reuse E3
     tests' helpers); preview shows expected values and records nothing; student cannot reach
     any `/admin/exercises` route.
- **Acceptance**: an admin generates a billing exercise, previews it, opens it, assigns a group,
  and a student of that group solves it (E3 flow) end to end in the browser.
- **Do not**: add drag-and-drop; add a JSON API; let a generated exercise be regenerated once
  attempted.

### E6: Admin: results

- **Read first**: section 8.1; `../pools/src/routes/admin-pools.ts` results and CSV code.
- **Tasks**
  1. `/admin` dashboard per student with group filter (one aggregation over attempts, one over
     exercise assignments per group; no N+1).
  2. `/admin/students/:id` exercise rows + per-question detail (tries listed newest last).
  3. `/admin/exercises/:id/results` per student + `export.csv` (`src/lib/csv.ts`, streamed or
     built in memory, BOM, French headers).
  4. Tests: dashboard counts for two students in two groups; detail lists tries with tooltip
     flags; results page; CSV header and rows, accents intact, oui/non columns.
- **Acceptance**: after the E5 acceptance flow, the dashboard shows the student as *terminé*,
  the detail shows each try, and the CSV opens in LibreOffice with accents intact.
- **Do not**: add charts or statistics beyond counts.

### E7: Hardening and deploy

- **Tasks**
  1. Verify CSP with the new pages (no inline scripts, markdown output safe), `originCheck` on
     the multipart route, error pages, rate limits.
  2. README.md for humans (from pools' README, adapted: onboarding a class = create group →
     import CSV → print sheet or zip → assign exercises).
  3. Review this file: Layout matches disk, status table complete, open questions resolved or
     restated.
  4. Production: Atlas cluster, Vercel project, env vars (`QR_SECRET` included), custom domain,
     `BASE_URL` set **before** any QR is printed, seed real admins, smoke test: admin login →
     group → import → QR scan from a phone → solve a generated exercise → dashboard → CSV.
- **Acceptance**: live URL passes the smoke test; `npm run check` green; docs describe reality.

---

## 10. Open questions (apply the default unless the owner says otherwise)

1. **Tooltip wording**: `sample/ToolTip.png` has no text. Default: page 3 of the PDF, one
   definition + one worked example per line (7.2).
2. **Frais de livraison base**: the PDF gives a percentage without saying of what. Default:
   percentage of the net purchase price. Change one line in `billing.ts` if the owner says
   "of the gross price".
3. **Name inside the QR PNG**: the brief says "QrCode + Username, file named as UserName.png".
   Default: the name is the file name; the printable sheet carries name + QR on paper. Drawing
   the name in the PNG would need `@resvg/resvg-js` (prebuilt binary; usually fine on Vercel)
   and is a small follow-up.
4. **Tolerance**: answers are exact, but cent rounding differs between students. Default: the
   billing generator sets `tolerance: 0.01`; custom questions default to `0`, editable.
5. **Identity at login**: QR + name + login code (5.2). If the owner wants QR only, drop the
   form in `student-login.ts` and its tests; nothing else changes.
6. **Class column in the CSV**: empty in the sample, so the group is chosen at import. If a
   future export fills `Classe de rattachement`, offer "use the file's class" as an option.
7. **Justification part (PDF part 2)**: paper only in v1.

---

## Appendix A: original brief (verbatim)

```
Hey we're gonna make an app on the same model as @../pools

Same same two roles :
 - admins
 - comitees

 Except this times we will have exercises instead of pooling forms.

 Let's improve on the previous design :
 - have a revalidation process that ensure token get renewed if older than a day, ensuring each candidate stay connected.
  - make the auth QrCode multiple use

# Difference from pools

Exercice are to be defined yet but they'll be set of autogenerated forms, so adopt a modular design for now we're gonna have one test case but they all gonna have a common interface:

 ## Exercice interface

 An exercice will be a set of question, some question might involve a tooltip. each question will have an input and a submit button. Submitting the question hilghlight red false or green true. The exercise will be accepted when all question are green, the go to the next form.
Each try and tooltip activation(on a specific question) will be recorded in the database record stored as a number[ {tooltip : boolean , try : number}].
Response to question must be string enum or number (not range exact input)

 The exercice must be stuctured as blocks for now we we'll have markdown block and question block.

 Each exercice will have a unique name.

## Admin view :

Make the admin interface centered aroung per user result, they can still add create and generate code.

The user management view must be centered arround group of user, the admin can give acces to specific form to a all group of users.

Add the option to batch create student from a csv following the format you'll find in the sample directory.

Add the option to batch download QrCode + Username, file named as UserName.png.

### Exercice Creation :

### Custom Exercice

A one time exercice, the admin can edit every block and question then assign them to class.

### Billing Exercice

Generate an Exercice like the @samples/Billing.png in the sample directory. You'll make a list of possible items with associated french TVA and make "Prix d'achat"  cheange betwwen each exercice, make the ammount of the object purchase coherent with the price, and put the correct TVA.

Use @samples/ToolTip.png as reference for each question tooltips.

Additional exercices like this may come
```
