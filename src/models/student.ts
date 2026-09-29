import { Schema, model, type InferSchemaType } from 'mongoose';
import { normalizeName } from '../lib/names.js';

const studentSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    // normalizeName(name), kept in sync by the pre-validate hook; the login form is matched on it.
    nameKey: { type: String, required: true, index: true },
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

studentSchema.pre('validate', function () {
  if (typeof this.name === 'string') this.nameKey = normalizeName(this.name);
});

export type StudentDoc = InferSchemaType<typeof studentSchema>;
export const Student = model('Student', studentSchema);
