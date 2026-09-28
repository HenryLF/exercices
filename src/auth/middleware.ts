import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { Admin } from '../models/admin.js';
import { Student } from '../models/student.js';
import { forbidden, HttpError } from '../lib/http-error.js';
import { startSession } from './login-session.js';
import { RENEW_AFTER_MS, STUDENT_SESSION_MS, type Role } from './session.js';

export interface SessionUser {
  role: Role;
  id: string;
  name: string;
  groupIds?: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

/**
 * Resolves the session to a user on every request. A session whose authVersion no longer matches
 * (QR regenerated, student deactivated, admin password reset) is destroyed: that is how revocation
 * reaches every device without scanning the sessions collection.
 *
 * Student sessions older than a day get a new id and a fresh 30-day cookie, so a student who uses
 * the app at least once a month never has to scan their QR code again.
 */
export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  const { role, userId, authVersion } = req.session ?? {};
  if (!role || !userId) return next();

  let user: SessionUser | undefined;
  if (mongoose.isValidObjectId(userId)) {
    if (role === 'admin') {
      const a = await Admin.findById(userId, { username: 1, authVersion: 1 });
      if (a && a.authVersion === authVersion) user = { role, id: a.id, name: a.username };
    } else {
      const s = await Student.findById(userId, { name: 1, authVersion: 1, active: 1, groupIds: 1 });
      if (s && s.active && s.authVersion === authVersion)
        user = { role, id: s.id, name: s.name, groupIds: s.groupIds.map(String) };
    }
  }

  if (!user) {
    await new Promise<void>((resolve, reject) =>
      req.session.destroy((err) => (err ? reject(err) : resolve())),
    );
    return next();
  }

  req.user = user;
  if (user.role === 'student' && Date.now() - (req.session.renewedAt ?? 0) > RENEW_AFTER_MS) {
    await startSession(req, 'student', user.id, authVersion!, STUDENT_SESSION_MS);
    await Student.updateOne({ _id: user.id }, { $set: { lastSeenAt: new Date() } });
  }
  next();
}

export function requireRole(role: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.redirect(role === 'admin' ? '/admin/login' : '/');
    if (req.user.role !== role) return next(forbidden());
    next();
  };
}

/**
 * Cross-site form posts: browsers send Origin (or at least Referer) on POST, so a request that
 * names another host is refused. Requests with neither header can't come from a browser page.
 * SameSite=Lax cookies already block most of this; this is the second layer.
 */
export function originCheck(req: Request, _res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const source = req.get('origin') ?? req.get('referer');
  if (!source) return next();
  let host: string;
  try {
    host = new URL(source).host;
  } catch {
    return next(new HttpError(403, 'Requête intersite refusée'));
  }
  if (host !== req.get('host')) return next(new HttpError(403, 'Requête intersite refusée'));
  next();
}
