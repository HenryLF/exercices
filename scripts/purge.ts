// End-of-year purge of pupils' personal data (names, results, sessions):
//
//   npm run purge                          dry run: shows what would be deleted
//   npm run purge -- --yes                 deletes every student, attempt and student session
//   npm run purge -- --yes --with-groups   also deletes the classes
//
// Admins and exercises are always kept. Nothing can be recovered afterwards, except from a
// database backup. MONGODB_URI comes from the environment or from .env; for production:
//   MONGODB_URI='mongodb+srv://...' npm run purge
import 'dotenv/config';
import mongoose from 'mongoose';
import { purgeStudents } from '../src/lib/purge.js';

const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== '--yes' && a !== '--with-groups');
if (unknown.length > 0) {
  console.error('Usage: npm run purge [-- --yes [--with-groups]]');
  process.exit(1);
}
const dryRun = !args.includes('--yes');
const withGroups = args.includes('--with-groups');

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set');
  process.exit(1);
}

await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
console.log(
  `Database: ${mongoose.connection.db!.databaseName} on ${new URL(uri.replace(/^mongodb(\+srv)?:/, 'http:')).host}`,
);

const counts = await purgeStudents(mongoose.connection.getClient().db(), { withGroups, dryRun });
const verb = dryRun ? 'would delete' : 'deleted';
console.log(`students: ${verb} ${counts.students}`);
console.log(`attempts: ${verb} ${counts.attempts}`);
console.log(`student sessions: ${verb} ${counts.sessions}`);
if (withGroups) console.log(`classes: ${verb} ${counts.groups}`);
if (dryRun) console.log('Dry run: nothing was deleted. Add --yes to delete.');

await mongoose.disconnect();
