import type { Request } from 'express';
import type { Role } from './session.js';

function regenerate(req: Request): Promise<void> {
  return new Promise((resolve, reject) =>
    req.session.regenerate((err) => (err ? reject(err) : resolve())),
  );
}

function save(req: Request): Promise<void> {
  return new Promise((resolve, reject) =>
    req.session.save((err) => (err ? reject(err) : resolve())),
  );
}

/** New session id (no session fixation), with the role's lifetime. Used at login and renewal. */
export async function startSession(
  req: Request,
  role: Role,
  userId: string,
  authVersion: number,
  maxAge: number,
): Promise<void> {
  const flash = req.session.flash;
  await regenerate(req);
  req.session.role = role;
  req.session.userId = userId;
  req.session.authVersion = authVersion;
  req.session.renewedAt = Date.now();
  if (flash) req.session.flash = flash;
  req.session.cookie.maxAge = maxAge;
  await save(req);
}

export function endSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) =>
    req.session.destroy((err) => (err ? reject(err) : resolve())),
  );
}
