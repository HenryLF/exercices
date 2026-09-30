import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireRole } from '../auth/middleware.js';
import { Attempt, questionStates } from '../models/attempt.js';
import { Exercise } from '../models/exercise.js';
import { Group } from '../models/group.js';
import { createStudentWithLogin, Student } from '../models/student.js';
import { formatValue } from '../lib/answers.js';
import { questionBlocks } from '../lib/blocks.js';
import { setFlash } from '../lib/flash.js';
import { LOGIN_RE } from '../lib/names.js';
import { formatCode, loginCode, loginUrl, qrPng, qrSvg } from '../lib/qr.js';
import { standing, summarizeAttempt } from '../lib/results.js';
import { blocksFor, isGenerated } from '../lib/content.js';
import { asArray, fieldErrors } from '../lib/validation.js';
import { attachment, safeFileName } from '../lib/zip.js';
import { loadStudent } from './load.js';

const LOGIN_HELP =
  'Initiale du nom, un point, puis le prénom, en minuscules sans accent ni espace (ex.\u00a0: m.alice)';

const studentSchema = z.object({
  login: z
    .string({ error: 'L’identifiant est obligatoire' })
    .trim()
    .toLowerCase()
    .min(1, 'L’identifiant est obligatoire')
    .regex(LOGIN_RE, LOGIN_HELP),
});

/** The ticked classes of the form that exist; any number, possibly none. */
async function chosenGroupIds(body: Record<string, unknown>): Promise<string[]> {
  const ids = asArray(body.groupIds).filter((id) => mongoose.isValidObjectId(id));
  const found = await Group.find({ _id: { $in: ids } }, { _id: 1 });
  return found.map((g) => g.id as string);
}

/** Mongo filter for the `?group=` of the lists: one class, no class, or everyone. */
function groupFilter(filter: string): Record<string, unknown> {
  if (filter === 'none') return { groupIds: { $size: 0 } };
  if (mongoose.isValidObjectId(filter)) return { groupIds: new mongoose.Types.ObjectId(filter) };
  return {};
}

const groupLabel = (ids: unknown[], names: Map<string, string>) =>
  ids
    .map((id) => names.get(String(id)))
    .filter(Boolean)
    .sort((a, b) => a!.localeCompare(b!, 'fr'))
    .join(', ');

/**
 * Replaces the student's QR code: every printed copy of the old one stops working and every
 * session of the student is dropped. Also reactivates a deactivated student.
 */
function regenerateQr(studentId: string) {
  return Student.updateOne(
    { _id: studentId },
    {
      $set: { active: true, failedAttempts: 0, lockedUntil: null },
      $inc: { qrVersion: 1, authVersion: 1 },
    },
  );
}

type GroupOption = { id: string; name: string };
const groupOptions = async (): Promise<GroupOption[]> =>
  (await Group.find().sort({ name: 1 })).map((g) => ({ id: g.id as string, name: g.name }));

export function adminStudentsRouter() {
  const router = Router();
  router.use('/admin', requireRole('admin'));

  // ---------------------------------------------------------------------------
  // Dashboard: results per student

  router.get('/admin', async (req, res) => {
    const groups = await groupOptions();
    const filter = typeof req.query.group === 'string' ? req.query.group : '';
    const query = { active: true, ...groupFilter(filter) };

    const [students, exercises] = await Promise.all([
      Student.find(query, { login: 1, groupIds: 1, lastSeenAt: 1, lastLoginAt: 1 }),
      Exercise.find({ status: { $ne: 'draft' } }, { groupIds: 1, blocks: 1, generated: 1 }),
    ]);
    const attempts = await Attempt.find({ studentId: { $in: students.map((s) => s._id) } }).lean();
    const names = new Map(groups.map((g) => [g.id, g.name]));

    const rows = students.map((s) => {
      const mine = attempts.filter((a) => String(a.studentId) === (s.id as string));
      let assigned = 0;
      let completed = 0;
      let inProgress = 0;
      let rounds = 0;
      let tries = 0;
      let tooltips = 0;
      for (const e of exercises) {
        const theirs = mine.filter((a) => String(a.exerciseId) === (e.id as string));
        const isAssigned = e.groupIds.some((g) => s.groupIds.some((m) => String(m) === String(g)));
        if (!isAssigned && theirs.length === 0) continue;
        if (isAssigned) assigned++;
        const st = standing((seed) => blocksFor(e, seed), theirs, questionStates);
        if (st.completed > 0) completed++;
        if (st.current?.progress === 'in_progress') inProgress++;
        rounds += st.completed;
        tries += st.tries;
        tooltips += st.tooltips;
      }
      const seen = [s.lastSeenAt, s.lastLoginAt].filter((d): d is Date => !!d);
      return {
        id: s.id as string,
        login: s.login,
        group: groupLabel(s.groupIds, names),
        assigned,
        completed,
        inProgress,
        rounds,
        tries,
        tooltips,
        lastSeen: seen.length ? new Date(Math.max(...seen.map((d) => d.getTime()))) : null,
      };
    });
    rows.sort((a, b) => a.group.localeCompare(b.group, 'fr') || a.login.localeCompare(b.login));

    res.render('admin/index', { title: 'Résultats', groups, filter, rows });
  });

  // ---------------------------------------------------------------------------
  // Students

  const renderList = async (
    req: Request,
    res: Response,
    values: Record<string, unknown>,
    errors: Record<string, string>,
    status = 200,
  ) => {
    const groups = await groupOptions();
    const filter = typeof req.query.group === 'string' ? req.query.group : '';
    const students = await Student.find(groupFilter(filter)).sort({ active: -1, login: 1 });
    const names = new Map(groups.map((g) => [g.id, g.name]));
    res.status(status).render('admin/students', {
      title: 'Élèves',
      groups,
      filter,
      students: students.map((s) => ({
        id: s.id as string,
        login: s.login,
        group: groupLabel(s.groupIds, names),
        active: s.active,
        lastLoginAt: s.lastLoginAt,
      })),
      values,
      errors,
    });
  };

  router.get('/admin/students', (req, res) =>
    renderList(
      req,
      res,
      { groupIds: mongoose.isValidObjectId(req.query.group) ? [String(req.query.group)] : [] },
      {},
    ),
  );

  router.post('/admin/students', async (req, res) => {
    const parsed = studentSchema.safeParse(req.body);
    const groupIds = await chosenGroupIds(req.body);
    if (!parsed.success)
      return renderList(req, res, { ...req.body, groupIds }, fieldErrors(parsed.error), 400);
    const student = await createStudentWithLogin(parsed.data.login, groupIds);
    if (student.login !== parsed.data.login)
      setFlash(
        req,
        'success',
        `L’identifiant ${parsed.data.login} était déjà pris\u00a0: l’élève a reçu ${student.login}.`,
      );
    res.redirect(`/admin/students/${student.id}/qr`);
  });

  // --- One student
  const renderDetail = async (
    res: Response,
    student: Awaited<ReturnType<typeof loadStudent>>,
    values: Record<string, unknown>,
    errors: Record<string, string>,
    status = 200,
  ) => {
    const groups = await groupOptions();
    const attempts = await Attempt.find({ studentId: student._id }).sort({ startedAt: 1 }).lean();
    const or: Record<string, unknown>[] = [{ _id: { $in: attempts.map((a) => a.exerciseId) } }];
    if (student.groupIds.length > 0)
      or.push({ groupIds: { $in: student.groupIds }, status: { $ne: 'draft' } });
    const exercises = await Exercise.find({ $or: or } as mongoose.QueryFilter<unknown>).sort({
      position: 1,
      name: 1,
    });

    res.status(status).render('admin/student', {
      title: student.login,
      student: {
        id: student.id as string,
        login: student.login,
        group: groupLabel(student.groupIds, new Map(groups.map((g) => [g.id, g.name]))),
        active: student.active,
        lastLoginAt: student.lastLoginAt,
        lastSeenAt: student.lastSeenAt,
        locked: !!student.lockedUntil && student.lockedUntil > new Date(),
      },
      groups,
      exercises: exercises.map((e) => {
        const theirs = attempts.filter((a) => String(a.exerciseId) === (e.id as string));
        return {
          id: e.id as string,
          name: e.name,
          status: e.status,
          generated: isGenerated(e),
          standing: standing((seed) => blocksFor(e, seed), theirs, questionStates),
          attempts: theirs.map((a) => {
            const blocks = blocksFor(e, a.seed);
            const states = questionStates(a);
            return {
              seed: a.seed ?? null,
              summary: summarizeAttempt(blocks, a, states),
              questions: questionBlocks(blocks).map((q) => {
                const st = states[q.key];
                const decimals = q.answer.type === 'number' ? q.answer.decimals : undefined;
                return {
                  label: q.label,
                  expected: formatValue(q.answer.value, decimals),
                  solved: !!st?.solved,
                  tooltipShown: !!st?.tooltipShown,
                  tries: (st?.tries ?? []).map((t) => ({
                    ...t,
                    value: formatValue(t.value, decimals),
                  })),
                };
              }),
            };
          }),
        };
      }),
      values,
      errors,
    });
  };

  router.get('/admin/students/:id', async (req, res) => {
    const student = await loadStudent(req.params.id);
    // Coming from a class's exercise page: that exercise's detail is shown open.
    res.locals.openExercise = typeof req.query.exercise === 'string' ? req.query.exercise : '';
    await renderDetail(
      res,
      student,
      {
        login: student.login,
        groupIds: student.groupIds.map(String),
      },
      {},
    );
  });

  router.post('/admin/students/:id', async (req, res) => {
    const student = await loadStudent(req.params.id);
    const parsed = studentSchema.safeParse(req.body);
    const groupIds = await chosenGroupIds(req.body);
    if (!parsed.success)
      return renderDetail(res, student, { ...req.body, groupIds }, fieldErrors(parsed.error), 400);
    if (await Student.exists({ login: parsed.data.login, _id: { $ne: student._id } }))
      return renderDetail(
        res,
        student,
        { ...req.body, groupIds },
        { login: 'Un autre élève a déjà cet identifiant' },
        400,
      );
    student.set({ ...parsed.data, groupIds });
    await student.save();
    setFlash(req, 'success', 'Élève enregistré.');
    res.redirect(`/admin/students/${student.id}`);
  });

  // QR codes are re-printable: the page and the PNG can be opened any number of times.
  router.get('/admin/students/:id/qr', async (req, res) => {
    const student = await loadStudent(req.params.id);
    if (!student.active) {
      setFlash(
        req,
        'error',
        'Ce compte est désactivé\u00a0: générez un nouveau QR code pour le réactiver.',
      );
      return res.redirect(`/admin/students/${student.id}`);
    }
    const ref = { id: student.id as string, qrVersion: student.qrVersion };
    const url = loginUrl(ref);
    res.set('Cache-Control', 'no-store');
    res.render('admin/student-qr', {
      title: `QR code\u00a0: ${student.login}`,
      student: { id: student.id as string, login: student.login },
      url,
      code: formatCode(loginCode(ref)),
      svg: await qrSvg(url),
    });
  });

  router.get('/admin/students/:id/qr.png', async (req, res) => {
    const student = await loadStudent(req.params.id);
    if (!student.active) return res.redirect(`/admin/students/${student.id}`);
    const ref = { id: student.id as string, qrVersion: student.qrVersion };
    const png = await qrPng(loginUrl(ref));
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'image/png');
    // The PNG has no text in it: the login and the code travel in the file name.
    res.set(
      'Content-Disposition',
      attachment(`${safeFileName(`${student.login} - ${loginCode(ref)}`)}.png`),
    );
    res.send(png);
  });

  router.post('/admin/students/:id/qr', async (req, res) => {
    const student = await loadStudent(req.params.id);
    await regenerateQr(student.id as string);
    setFlash(req, 'success', 'Nouveau QR code généré. L’ancien ne fonctionne plus.');
    res.redirect(`/admin/students/${student.id}/qr`);
  });

  router.post('/admin/students/:id/deactivate', async (req, res) => {
    const student = await loadStudent(req.params.id);
    await Student.updateOne(
      { _id: student._id },
      { $set: { active: false }, $inc: { authVersion: 1 } },
    );
    setFlash(req, 'success', 'Compte désactivé. Ses résultats sont conservés.');
    res.redirect(`/admin/students/${student.id}`);
  });

  // Deleting a student removes their attempts too; their sessions die with the account.
  router.get('/admin/students/:id/delete', async (req, res) => {
    const student = await loadStudent(req.params.id);
    const attempts = await Attempt.countDocuments({ studentId: student._id });
    res.render('admin/confirm-delete', {
      title: `Supprimer\u00a0: ${student.login}`,
      heading: `Supprimer l’élève ${student.login}\u00a0?`,
      consequences: [
        attempts === 0
          ? 'Aucune tentative enregistrée.'
          : `${attempts} tentative${attempts > 1 ? 's' : ''} et tous leurs essais seront supprimés.`,
        'Son QR code ne fonctionnera plus et ses appareils seront déconnectés.',
        'Pour garder ses résultats, désactivez plutôt le compte.',
      ],
      action: `/admin/students/${student.id}/delete`,
      cancel: `/admin/students/${student.id}`,
    });
  });

  router.post('/admin/students/:id/delete', async (req, res) => {
    const student = await loadStudent(req.params.id);
    await Attempt.deleteMany({ studentId: student._id });
    await Student.deleteOne({ _id: student._id });
    setFlash(req, 'success', `Élève ${student.login} supprimé, avec ses tentatives.`);
    res.redirect('/admin/students');
  });

  return router;
}
