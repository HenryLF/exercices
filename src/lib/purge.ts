import type { Db } from 'mongodb';
import { Attempt } from '../models/attempt.js';
import { Exercise } from '../models/exercise.js';
import { Group } from '../models/group.js';
import { Student } from '../models/student.js';

export interface PurgeCounts {
  students: number;
  attempts: number;
  sessions: number;
  groups: number;
}

// connect-mongo stores each session as a JSON string; student sessions carry this role.
const STUDENT_SESSION = { session: { $regex: '"role":"student"' } };

/**
 * End-of-year purge of pupils' personal data: every student, every attempt and every student
 * session. Admins and exercises are kept; classes too unless `withGroups`. With `dryRun`, only
 * counts what would be deleted. `sessionsDb` is the database connect-mongo writes to (the
 * client's default database, which may differ from mongoose's).
 */
export async function purgeStudents(
  sessionsDb: Db,
  opts: { withGroups: boolean; dryRun: boolean },
): Promise<PurgeCounts> {
  const sessions = sessionsDb.collection('sessions');
  if (opts.dryRun) {
    return {
      students: await Student.countDocuments(),
      attempts: await Attempt.countDocuments(),
      sessions: await sessions.countDocuments(STUDENT_SESSION),
      groups: opts.withGroups ? await Group.countDocuments() : 0,
    };
  }
  const attempts = await Attempt.deleteMany({});
  const students = await Student.deleteMany({});
  const deletedSessions = await sessions.deleteMany(STUDENT_SESSION);
  let groups = 0;
  if (opts.withGroups) {
    groups = (await Group.deleteMany({})).deletedCount;
    await Exercise.updateMany({}, { $set: { groupIds: [] } });
  }
  return {
    students: students.deletedCount,
    attempts: attempts.deletedCount,
    sessions: deletedSessions.deletedCount,
    groups,
  };
}
