import session from 'express-session';
import { MongoStore } from 'connect-mongo';
import type { MongoClient } from 'mongodb';
import { config, isProd } from '../config.js';
import type { Flash } from '../lib/flash.js';

export type Role = 'admin' | 'student';

declare module 'express-session' {
  interface SessionData {
    role: Role;
    userId: string;
    authVersion: number;
    // Date.now() when the session id was last issued; student sessions are reissued daily.
    renewedAt: number;
    flash: Flash;
    // A CSV import waiting for the admin to decide about students with the same name.
    importDraft: {
      groupId: string;
      rows: { line: number; name: string }[];
      duplicates: { line: number; name: string }[];
      errors: { line: number; message: string }[];
    };
  }
}

export const SESSION_COOKIE = 'exercices.sid';
export const STUDENT_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
export const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;
export const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;

export function sessionMiddleware(clientPromise: Promise<MongoClient>) {
  return session({
    name: SESSION_COOKIE,
    secret: config.SESSION_SECRET,
    store: MongoStore.create({
      clientPromise,
      collectionName: 'sessions',
      // Expiry follows each session's cookie (30 days for students, 12 hours for admins).
      autoRemove: 'native',
      touchAfter: 60 * 60,
    }),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: isProd,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: ADMIN_SESSION_MS,
    },
  });
}
