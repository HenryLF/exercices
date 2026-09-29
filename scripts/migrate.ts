// One-off data migrations, safe to run any number of times:
//
//   npm run migrate                       uses MONGODB_URI from the environment or .env
//   MONGODB_URI='mongodb+srv://...' npm run migrate
//
// 2026-09-29: a student's single `groupId` becomes a list `groupIds` (several classes, or none).
// 2026-09-29: dates of birth are no longer stored (login uses a code printed with the QR code).
// 2026-09-29: names are no longer stored: each student gets a unique login (m.alice) from their
//             name, then the name is deleted.
import 'dotenv/config';
import mongoose from 'mongoose';
import { loginName } from '../public/import-csv.js';
import { freeLogin } from '../src/lib/names.js';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set');
  process.exit(1);
}

await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
const db = mongoose.connection.db!;
console.log(
  `Database: ${db.databaseName} on ${new URL(uri.replace(/^mongodb(\+srv)?:/, 'http:')).host}`,
);

const students = await db.collection('students').updateMany({ groupId: { $exists: true } }, [
  {
    $set: {
      groupIds: {
        $setUnion: [
          { $ifNull: ['$groupIds', []] },
          { $cond: [{ $eq: [{ $ifNull: ['$groupId', null] }, null] }, [], ['$groupId']] },
        ],
      },
    },
  },
  { $unset: 'groupId' },
]);
console.log(`students: ${students.modifiedCount} moved from groupId to groupIds`);

const indexes = await db.collection('students').indexes();
if (indexes.some((i) => i.name === 'groupId_1')) {
  await db.collection('students').dropIndex('groupId_1');
  console.log('students: dropped index groupId_1');
}

const dobs = await db
  .collection('students')
  .updateMany({ dob: { $exists: true } }, { $unset: { dob: '' } });
console.log(`students: ${dobs.modifiedCount} dates of birth removed`);

const coll = db.collection<{ name?: string; login?: string }>('students');
const taken = new Set(
  (await coll.find({ login: { $exists: true } }, { projection: { login: 1 } }).toArray()).map(
    (s) => s.login!,
  ),
);
let renamed = 0;
for (const s of await coll
  .find({ name: { $exists: true } }, { projection: { name: 1, login: 1 } })
  .sort({ createdAt: 1 })
  .toArray()) {
  const login = s.login ?? freeLogin(loginName(s.name ?? '') || 'eleve', taken);
  taken.add(login);
  await coll.updateOne({ _id: s._id }, { $set: { login }, $unset: { name: '', nameKey: '' } });
  renamed++;
}
console.log(`students: ${renamed} names replaced by a login and deleted`);
if ((await coll.indexes()).some((i) => i.name === 'nameKey_1')) {
  await coll.dropIndex('nameKey_1');
  console.log('students: dropped index nameKey_1');
}

await mongoose.disconnect();
