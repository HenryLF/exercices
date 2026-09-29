// One-off data migrations, safe to run any number of times:
//
//   npm run migrate                       uses MONGODB_URI from the environment or .env
//   MONGODB_URI='mongodb+srv://...' npm run migrate
//
// 2026-09-29: a student's single `groupId` becomes a list `groupIds` (several classes, or none).
// 2026-09-29: dates of birth are no longer stored (login uses a code printed with the QR code).
import 'dotenv/config';
import mongoose from 'mongoose';

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

await mongoose.disconnect();
