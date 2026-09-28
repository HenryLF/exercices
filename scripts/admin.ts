// Admin accounts have no UI: manage them from a shell that can reach the database.
//
//   npm run admin -- set <username>      create an admin, or reset its password
//   npm run admin -- list                list admins
//   npm run admin -- remove <username>   delete an admin
//
// Only MONGODB_URI is needed. It comes from the environment, or from .env. For production, pass
// it inline or point tsx at another env file:
//   MONGODB_URI='mongodb+srv://...' npm run admin -- set alice
//   npx tsx --env-file=.env.production.local scripts/admin.ts set alice
//
// The password is asked for, hidden, so it never lands in shell history. When stdin is not a
// terminal, it is read from the first line of stdin. Add --yes to skip the confirmation.
import 'dotenv/config';
import { createInterface } from 'node:readline';
import mongoose from 'mongoose';
import { upsertAdmin } from '../src/auth/admin-login.js';
import { Admin } from '../src/models/admin.js';

const MIN_PASSWORD = 12;

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const [command, username] = args.filter((a) => a !== '--yes');

function usage(): never {
  console.error(
    'Usage:\n  npm run admin -- set <username>\n  npm run admin -- list\n  npm run admin -- remove <username>',
  );
  process.exit(1);
}

function ask(question: string, hidden = false): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      if (hidden && process.stdin.isTTY) process.stdout.write('\n');
      resolve(answer);
    });
    // The prompt is already written; from here on, typed characters are not echoed.
    if (hidden && process.stdin.isTTY) {
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
    }
  });
}

/** Host and database of the URI, without credentials, so the operator sees where they write. */
function describeTarget(uri: string): string {
  try {
    const u = new URL(uri);
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return '(unparsable MONGODB_URI)';
  }
}

async function confirm(action: string, uri: string) {
  if (yes) return;
  if (!process.stdin.isTTY) {
    console.error('Not a terminal: add --yes to confirm.');
    process.exit(1);
  }
  const answer = await ask(`${action} on ${describeTarget(uri)}? [y/N] `);
  if (!/^y(es)?$/i.test(answer.trim())) {
    console.error('Cancelled.');
    process.exit(1);
  }
}

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) return (await ask('')).trim();
  const first = await ask(`Password (at least ${MIN_PASSWORD} characters): `, true);
  const second = await ask('Repeat password: ', true);
  if (first !== second) {
    console.error('The passwords differ.');
    process.exit(1);
  }
  return first;
}

async function main() {
  if (!command || (command !== 'list' && !username)) usage();
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set.');
    process.exit(1);
  }

  switch (command) {
    case 'set': {
      await confirm(`Create or reset admin "${username}"`, uri);
      const password = await readPassword();
      if (password.length < MIN_PASSWORD) {
        console.error(`Use a password of at least ${MIN_PASSWORD} characters.`);
        process.exit(1);
      }
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
      const admin = await upsertAdmin(username!, password);
      console.log(`Admin "${admin?.username}" saved. Any open session of it is signed out.`);
      break;
    }
    case 'list': {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
      const admins = await Admin.find({}, { username: 1, createdAt: 1 }).sort({ username: 1 });
      console.log(`Admins on ${describeTarget(uri)}:`);
      for (const a of admins) console.log(`  ${a.username}`);
      if (admins.length === 0) console.log('  (none)');
      break;
    }
    case 'remove': {
      await confirm(`Delete admin "${username}"`, uri);
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
      // Its sessions die with it: loadUser drops sessions whose user no longer exists.
      const res = await Admin.deleteOne({ username: username!.trim().toLowerCase() });
      console.log(res.deletedCount ? `Admin "${username}" deleted.` : `No admin "${username}".`);
      break;
    }
    default:
      usage();
  }
  await mongoose.disconnect();
}

try {
  await main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Failed: ${message}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
}
