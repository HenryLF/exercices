import type { Request } from 'express';

export type Flash = { type: 'success' | 'error'; message: string };

export function setFlash(req: Request, type: Flash['type'], message: string): void {
  req.session.flash = { type, message };
}

export function takeFlash(req: Request): Flash | undefined {
  const flash = req.session?.flash;
  if (flash) delete req.session.flash;
  return flash;
}
