import { Router } from 'express';
import mongoose from 'mongoose';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { attemptStudentLogin, findStudentByToken, identitySchema } from '../auth/student-login.js';
import { verifyAdmin } from '../auth/admin-login.js';
import { endSession, startSession } from '../auth/login-session.js';
import { ADMIN_SESSION_MS, SESSION_COOKIE, STUDENT_SESSION_MS } from '../auth/session.js';
import { HttpError } from '../lib/http-error.js';
import { fieldErrors } from '../lib/validation.js';

const INVALID_QR =
  'Ce QR code n’est pas valide. Il a peut-être été remplacé par un nouveau\u00a0: demandez-en un à votre professeur.';

const adminLoginSchema = z.object({
  username: z.string().trim().min(1, 'L’identifiant est obligatoire').max(100),
  password: z.string().min(1, 'Le mot de passe est obligatoire').max(200),
});

export function publicRouter({ loginLimit }: { loginLimit: number }) {
  const router = Router();

  // Per IP, in memory: resets on cold starts. The per-student lockout is the durable guard.
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: loginLimit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(
        new HttpError(
          429,
          'Trop de tentatives de connexion. Patientez quelques minutes, puis réessayez.',
        ),
      ),
  });

  router.get('/', (req, res) => {
    if (req.user?.role === 'admin') return res.redirect('/admin');
    if (req.user?.role === 'student') return res.redirect('/exercises');
    res.render('welcome', { title: 'Bienvenue' });
  });

  router.get('/healthz', async (_req, res) => {
    const db = mongoose.connection.db;
    const up =
      !!db &&
      (await db
        .admin()
        .ping()
        .then(
          () => true,
          () => false,
        ));
    res.status(up ? 200 : 503).json({ ok: up, db: up ? 'up' : 'down' });
  });

  // --- Student: QR code (reusable), then name + the code printed next to it
  router.get('/login/:token', async (req, res) => {
    const student = await findStudentByToken(req.params.token);
    if (!student) throw new HttpError(404, INVALID_QR);
    // Already signed in as this student on this device: skip the form.
    if (req.user?.role === 'student' && req.user.id === student.id)
      return res.redirect('/exercises/next');
    res.render('login-student', { title: 'Connexion', values: {}, errors: {} });
  });

  router.post('/login/:token', limiter, async (req, res) => {
    const render = (status: number, errors: Record<string, string>) =>
      res.status(status).render('login-student', { title: 'Connexion', values: req.body, errors });

    const parsed = identitySchema.safeParse(req.body);
    if (!parsed.success) return render(400, fieldErrors(parsed.error));

    const outcome = await attemptStudentLogin(
      String(req.params.token),
      parsed.data.name,
      parsed.data.code,
    );
    switch (outcome.status) {
      case 'invalid-token':
        throw new HttpError(404, INVALID_QR);
      case 'locked':
        return render(429, { _: 'Trop de tentatives échouées. Réessayez dans 15 minutes.' });
      case 'mismatch':
        return render(outcome.locked ? 429 : 400, {
          _: outcome.locked
            ? 'Trop de tentatives échouées. Réessayez dans 15 minutes.'
            : 'Le nom ou le code ne correspond pas à ce QR code.',
        });
      case 'ok':
        await startSession(
          req,
          'student',
          outcome.studentId,
          outcome.authVersion,
          STUDENT_SESSION_MS,
        );
        return res.redirect('/exercises/next');
    }
  });

  // --- Admin: username + password
  router.get('/admin/login', (req, res) => {
    if (req.user?.role === 'admin') return res.redirect('/admin');
    res.render('login-admin', { title: 'Connexion administrateur', values: {}, errors: {} });
  });

  router.post('/admin/login', limiter, async (req, res) => {
    const render = (status: number, errors: Record<string, string>) =>
      res.status(status).render('login-admin', {
        title: 'Connexion administrateur',
        values: { username: req.body?.username },
        errors,
      });
    const parsed = adminLoginSchema.safeParse(req.body);
    if (!parsed.success) return render(400, fieldErrors(parsed.error));
    const admin = await verifyAdmin(parsed.data.username, parsed.data.password);
    if (!admin) return render(400, { _: 'Identifiant ou mot de passe incorrect.' });
    await startSession(req, 'admin', admin.id as string, admin.authVersion, ADMIN_SESSION_MS);
    res.redirect('/admin');
  });

  router.post('/logout', async (req, res) => {
    const wasAdmin = req.user?.role === 'admin';
    await endSession(req);
    res.clearCookie(SESSION_COOKIE);
    res.redirect(wasAdmin ? '/admin/login' : '/');
  });

  return router;
}
