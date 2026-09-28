import { Schema, model, type InferSchemaType } from 'mongoose';

const adminSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    // Bumped when the password is reset: sessions carrying an older value are dropped.
    authVersion: { type: Number, required: true, default: 1 },
  },
  { timestamps: true },
);

export type AdminDoc = InferSchemaType<typeof adminSchema>;
export const Admin = model('Admin', adminSchema);
