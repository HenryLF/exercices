import bcrypt from 'bcryptjs';
import { Admin } from '../models/admin.js';

export const BCRYPT_COST = 12;

// Compared against when the username doesn't exist, so both cases take the same time.
const DUMMY_HASH = '$2b$12$MDkII7.BYJrjrHZBSUrLd.UyDT3ieinfy2Zydpsemjn2ZW9mIA.4C';

export async function verifyAdmin(username: string, password: string) {
  const admin = await Admin.findOne({ username: username.trim().toLowerCase() });
  const ok = await bcrypt.compare(password, admin?.passwordHash ?? DUMMY_HASH);
  return ok && admin ? admin : null;
}

/** Creates the admin, or resets its password and logs out its sessions. */
export async function upsertAdmin(username: string, password: string) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  return Admin.findOneAndUpdate(
    { username: username.trim().toLowerCase() },
    { $set: { passwordHash }, $inc: { authVersion: 1 } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
}
