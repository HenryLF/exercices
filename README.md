# Exercices

Auto-corrected exercises for a class. Teachers (admins) create exercises, generate price-calculation
exercises with random numbers, and follow each student's results. Students sign in with a personal
QR code and solve the exercises from their phone, question by question: a wrong answer turns red, a
right one turns green, and a hint (*indice*) is available on each question.

The interface is in French. [CLAUDE.md](CLAUDE.md) is the plan and the guide for coding agents.
To add a new kind of generated exercise, follow [docs/GENERATORS.md](docs/GENERATORS.md).

## How it works

- **Students** scan their QR code, then type their name and the 6-digit code printed under the
  QR code. No date of birth is stored. The device stays signed in as long as it is used at
  least once a month: the session is renewed every day.
  The same QR code works on any number of devices and can be printed again at any time.
- **Admins** sign in at `/admin/login`. They create classes, import students from the school
  software's CSV export, print or download the QR codes, create or generate exercises, assign
  them to classes, and read the results per student or per exercise (with a CSV export).
- **Every try is recorded**: the value typed, whether it was right, and whether the hint was open.
  For generated exercises, each attempt keeps its seed, so every draw's results stay available.
- **A new QR code replaces the old one.** Every printed copy of the old code stops working and
  the student is signed out everywhere. Deactivating a student does the same and keeps their
  results.

## Local setup

You need Node 22 and Docker (or any MongoDB).

```bash
npm install
docker compose up -d          # MongoDB on localhost:27017
cp .env.example .env          # set SESSION_SECRET and QR_SECRET to long random strings
npm run admin -- set admin    # asks for the password twice, hidden
npm run dev                   # http://localhost:3000
```

Run the checks with `npm run check`. It runs the type checker, the linter and the tests.

## Configuration

| Variable | Meaning |
|---|---|
| `MONGODB_URI` | MongoDB connection string, including the database name (`.../exercices`) |
| `SESSION_SECRET` | At least 32 random characters; signs the session cookie |
| `QR_SECRET` | At least 32 random characters; signs the QR codes |
| `BASE_URL` | Public origin written into QR codes, e.g. `https://exercices.example.com` |
| `PORT` | Local port, default 3000 |

Changing `BASE_URL` or `QR_SECRET` breaks every QR code already printed. Set both before
printing any. Changing `SESSION_SECRET` signs everyone out; students sign in again with the QR
code they already have.

## Admins

There is no screen for managing admins. From a terminal that can reach the database:

```bash
npm run admin -- set <username>      # create, or reset the password
npm run admin -- list
npm run admin -- remove <username>
```

## Onboarding a class

1. In **Classes**, create the class.
2. On the class page, click **Importer un CSV** and send the export from the school software.
   Only the column *Élèves* is read; every other column (date of birth, sex...) is ignored and
   never stored. If a name matches a student already registered, the import asks, row by row,
   whether it is the same person (added to this class, same QR code and results) or a new
   student. A student can belong to several classes, or none.
3. Click **Planche à imprimer** to print one card per student (QR code, name and login code), or
   **Télécharger les QR codes (zip)** to get one PNG per student, named
   `<name> - <code>.png` (the image itself has no text, so hand the code over with it).
4. In **Exercices**, click **Générer un exercice**, pick *Calculs commerciaux*, and create it.
   It is endless: every student gets new numbers on each attempt and can start again once
   finished. Check it with **Aperçu**, which shows a new random draw each time.
5. Back on the class page, tick the exercise under **Exercices**, set the order, and click
   **Enregistrer les exercices de la classe**. Ticking a draft opens it to the students.

Names match loosely at sign-in: case, accents, hyphens and extra spaces are ignored. The code is
derived from the QR code (nothing stored) and changes when a new QR code is generated. After 5
wrong attempts, sign-in is locked for 15 minutes.

## Deleting

Students, classes and exercises each have a **Supprimer** button leading to a confirmation page.
Deleting a student or an exercise also deletes its attempts. Deleting a class keeps its students
and exercises. To hide something without losing results, deactivate the student or close the
exercise instead.

## End of the school year

Pupils' personal data (names, results) should not be kept longer than needed. At the end of the
year, purge it:

```bash
npm run purge                          # dry run: shows what would be deleted
npm run purge -- --yes                 # deletes every student, attempt and student session
npm run purge -- --yes --with-groups   # also deletes the classes
MONGODB_URI='mongodb+srv://...' npm run purge -- --yes   # production
```

Admins and exercises are kept. Export the results you need (CSV per exercise) before purging:
nothing can be recovered afterwards, except from a database backup.

## Upgrading data

After pulling a version that changes stored data, run `npm run migrate` once against each
database. It is safe to run again.

## Deploying to Vercel

Vercel runs the app as one serverless function (`api/index.ts`). `vercel.json` sends every
request to it and ships `views/` and `public/` with it. There is no build step.

1. **Database**: create a MongoDB Atlas cluster (region near the users, for example Paris), a
   database user with the *readWrite* role, and allow `0.0.0.0/0` under Network Access. Put the
   database name in the URI: `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/exercices`.
2. **Project**: import this folder at [vercel.com/new](https://vercel.com/new), or run
   `vercel link`. Keep the defaults. If the repository holds more than this app, set **Root
   Directory** to this folder.
3. **Environment variables** (Production): `MONGODB_URI`, `SESSION_SECRET`, `QR_SECRET` (each
   from `openssl rand -base64 48`), `BASE_URL` (final domain, no trailing slash),
   `NODE_ENV=production`.
4. **Deploy** with `vercel --prod`, then open `/healthz`: it must answer `{"ok":true,"db":"up"}`.
5. **Admins**: `MONGODB_URI='mongodb+srv://...' npm run admin -- set alice` from your machine.
6. **Domain**: add it under Settings → Domains, set `BASE_URL`, and redeploy before printing any
   QR code.
7. **Smoke test**: create a class, import the CSV, scan a QR code with a phone, solve a
   generated exercise, and check the results page and the CSV.
