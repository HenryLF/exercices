import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import type { MongoClient } from 'mongodb';
import { config, isProd } from './config.js';
import { connectDb } from './db.js';
import { loadUser, originCheck } from './auth/middleware.js';
import { sessionMiddleware } from './auth/session.js';
import { formatDateTime, formatDob } from './lib/dates.js';
import { takeFlash } from './lib/flash.js';
import { formatNumber, STATUS_LABELS } from './lib/numbers.js';
import { HttpError, notFound } from './lib/http-error.js';
import { formatAmount } from './lib/answers.js';
import { PROGRESS_LABELS } from './lib/results.js';
import { publicRouter } from './routes/public.js';
import { studentRouter } from './routes/student.js';
import { adminImportRouter } from './routes/admin-import.js';
import { adminStudentsRouter } from './routes/admin-students.js';
import { adminGroupsRouter } from './routes/admin-groups.js';
import { adminExercisesRouter } from './routes/admin-exercises.js';

export const PICO_CSS = 'https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.classless.min.css';

export interface AppOptions {
  /** MongoDB client for the session store. Defaults to the app's mongoose connection. */
  clientPromise?: Promise<MongoClient>;
  /** Login POSTs allowed per IP per 15 minutes. */
  loginLimit?: number;
}

export function createApp(options: AppOptions = {}) {
  const root = process.cwd(); // Vercel ships views/ and public/ next to the function (includeFiles)
  const app = express();

  app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', path.join(root, 'views'));
  app.disable('x-powered-by');

  app.use(
    helmet({
      // Not helmet's default no-referrer: with it, browsers send `Origin: null` on form posts,
      // which originCheck must refuse.
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", 'https://cdn.jsdelivr.net'],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          ...(isProd ? { upgradeInsecureRequests: [] } : {}),
        },
      },
    }),
  );
  if (config.NODE_ENV === 'development') app.use(morgan('tiny'));

  app.use(express.static(path.join(root, 'public'), { maxAge: isProd ? '1h' : 0 }));
  app.use(express.urlencoded({ extended: true, limit: '200kb', parameterLimit: 5000 }));
  app.use((req, _res, next) => {
    req.body ??= {}; // Express 5 leaves it undefined when there is no form body
    next();
  });

  // Models buffer until connected, but fail fast here instead of timing out per query.
  app.use(async (_req, _res, next) => {
    await connectDb();
    next();
  });

  const clientPromise =
    options.clientPromise ?? connectDb().then((m) => m.connection.getClient() as MongoClient);
  app.use(sessionMiddleware(clientPromise));
  app.use(originCheck);
  app.use(loadUser);
  app.use((req, res, next) => {
    res.locals.user = req.user ?? null;
    res.locals.flash = takeFlash(req);
    res.locals.path = req.path;
    res.locals.pico = PICO_CSS;
    res.locals.fmtDateTime = formatDateTime;
    res.locals.fmtDob = formatDob;
    res.locals.fmtNumber = formatNumber;
    res.locals.statusLabel = STATUS_LABELS;
    res.locals.progressLabel = PROGRESS_LABELS;
    res.locals.fmtAmount = formatAmount;
    next();
  });

  app.use(publicRouter({ loginLimit: options.loginLimit ?? 20 }));
  app.use(studentRouter());
  app.use(adminImportRouter()); // before /admin/students/:id
  app.use(adminStudentsRouter());
  app.use(adminGroupsRouter());
  app.use(adminExercisesRouter());

  app.use((_req, _res, next) => next(notFound()));

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error(err);
    const message =
      err instanceof HttpError ? err.message : 'Une erreur est survenue. Veuillez réessayer.';
    if (res.headersSent) return res.end();
    res.status(status).render('error', {
      title: status === 404 ? 'Introuvable' : 'Erreur',
      status,
      message,
      stack: !isProd && status >= 500 && err instanceof Error ? err.stack : undefined,
      // The error may come before the locals middleware ran (e.g. database down).
      user: res.locals.user ?? null,
      pico: PICO_CSS,
    });
  };
  app.use(errorHandler);

  return app;
}
