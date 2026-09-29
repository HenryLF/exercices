import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { freeLogin, LOGIN_RE } from '../lib/names.js';

const studentSchema = new Schema(
  {
    // The only identity kept (m.alice): no name, no date of birth. Unique.
    login: { type: String, required: true, unique: true, match: LOGIN_RE },
    // Classes the student belongs to: any number, possibly none.
    groupIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Group' }],
      default: [],
      index: true,
    },
    // Part of the signed QR token and of the login code: bumping it kills every printed copy.
    qrVersion: { type: Number, required: true, default: 1 },
    // Bumped on QR regeneration and deactivation: sessions carrying an older value are dropped.
    authVersion: { type: Number, required: true, default: 1 },
    failedAttempts: { type: Number, required: true, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: null },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

export type StudentDoc = InferSchemaType<typeof studentSchema>;
export const Student = model('Student', studentSchema);

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Creates a student under `base`, or `base2`, `base3`... when taken. */
export async function createStudentWithLogin(
  base: string,
  groupIds: (string | Types.ObjectId)[] = [],
) {
  for (;;) {
    const taken = await Student.find(
      { login: { $regex: `^${escapeRegex(base)}\\d*$` } },
      { login: 1 },
    );
    const login = freeLogin(base, new Set(taken.map((s) => s.login)));
    try {
      return await Student.create({ login, groupIds });
    } catch (err) {
      // Someone took it in between: try the next one.
      if ((err as { code?: number }).code !== 11000) throw err;
    }
  }
}
