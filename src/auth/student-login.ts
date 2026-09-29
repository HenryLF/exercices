import { z } from 'zod';
import { Student } from '../models/student.js';
import { normalizeName } from '../lib/names.js';
import { codeMatches, parseLoginToken, signatureMatches } from '../lib/qr.js';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MS = 15 * 60 * 1000;

export const identitySchema = z.object({
  name: z
    .string({ error: 'Le nom est obligatoire' })
    .trim()
    .min(1, 'Le nom est obligatoire')
    .max(200),
  code: z
    .string({ error: 'Le code est obligatoire' })
    .trim()
    .min(1, 'Le code est obligatoire')
    .max(20),
});

type StudentIdentity = { id: string; nameKey: string; qrVersion: number };
type StudentLock = { lockedUntil?: Date | null };

export function isLocked(student: StudentLock, now = new Date()): boolean {
  return !!student.lockedUntil && student.lockedUntil > now;
}

export function identityMatches(student: StudentIdentity, name: string, code: string): boolean {
  // Both checks always run, so the timing does not tell which one failed.
  const codeOk = codeMatches(student, code);
  return student.nameKey === normalizeName(name) && codeOk;
}

/** The active student whose current QR code carries this token, if any. */
export async function findStudentByToken(token: string) {
  const parsed = parseLoginToken(token);
  if (!parsed) return null;
  const student = await Student.findOne({ _id: parsed.id, active: true });
  if (!student || !signatureMatches(parsed.id, student.qrVersion, parsed.sig)) return null;
  return student;
}

export type LoginOutcome =
  | { status: 'invalid-token' }
  | { status: 'locked' }
  | { status: 'mismatch'; locked: boolean }
  | { status: 'ok'; studentId: string; authVersion: number };

/**
 * QR token + name + the code printed next to the QR code. Failures are counted on the student, in the database, so the
 * lockout survives serverless cold starts (unlike the per-IP rate limit).
 */
export async function attemptStudentLogin(
  token: string,
  name: string,
  code: string,
  now = new Date(),
): Promise<LoginOutcome> {
  const student = await findStudentByToken(token);
  if (!student) return { status: 'invalid-token' };
  if (isLocked(student, now)) return { status: 'locked' };

  if (!identityMatches(student, name, code)) {
    const updated = await Student.findByIdAndUpdate(
      student._id,
      { $inc: { failedAttempts: 1 } },
      { returnDocument: 'after' },
    );
    const locked = (updated?.failedAttempts ?? 0) >= MAX_FAILED_ATTEMPTS;
    if (locked) {
      await Student.updateOne(
        { _id: student._id },
        { $set: { failedAttempts: 0, lockedUntil: new Date(now.getTime() + LOCK_MS) } },
      );
    }
    return { status: 'mismatch', locked };
  }

  await Student.updateOne(
    { _id: student._id },
    { $set: { failedAttempts: 0, lockedUntil: null, lastLoginAt: now, lastSeenAt: now } },
  );
  return { status: 'ok', studentId: student.id as string, authVersion: student.authVersion };
}
