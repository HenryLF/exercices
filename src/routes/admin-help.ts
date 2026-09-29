import { Router } from 'express';
import { requireRole } from '../auth/middleware.js';
import { LOCK_MS, MAX_FAILED_ATTEMPTS } from '../auth/student-login.js';

export function adminHelpRouter() {
  const router = Router();
  router.use('/admin/help', requireRole('admin'));

  router.get('/admin/help', (_req, res) => {
    res.render('admin/help', {
      title: 'Aide',
      maxFailed: MAX_FAILED_ATTEMPTS,
      lockMinutes: LOCK_MS / 60_000,
    });
  });

  return router;
}
