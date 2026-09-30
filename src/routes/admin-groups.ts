import { Router, type Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireRole } from '../auth/middleware.js';
import { Attempt, questionStates } from '../models/attempt.js';
import { Exercise } from '../models/exercise.js';
import { Group } from '../models/group.js';
import { Student } from '../models/student.js';
import { setFlash } from '../lib/flash.js';
import { blocksFor, isGenerated } from '../lib/content.js';
import { KIND_LABELS } from '../lib/generators/index.js';
import { formatCode, loginCode, loginUrl, qrPng, qrSvg } from '../lib/qr.js';
import { standing } from '../lib/results.js';
import { asArray, fieldErrors } from '../lib/validation.js';
import { attachment, safeFileName, uniqueFileNames, zipFiles } from '../lib/zip.js';
import { isDuplicateKey, loadExercise, loadGroup } from './load.js';

const groupSchema = z.object({
  name: z
    .string({ error: 'Le nom est obligatoire' })
    .trim()
    .min(1, 'Le nom est obligatoire')
    .max(100, 'Le nom est trop long'),
});

const DUPLICATE = { name: 'Une classe porte déjà ce nom' };

export function adminGroupsRouter() {
  const router = Router();
  router.use('/admin/groups', requireRole('admin'));

  const renderList = async (
    res: Response,
    values: Record<string, unknown>,
    errors: Record<string, string>,
    status = 200,
  ) => {
    const [groups, counts, exercises] = await Promise.all([
      Group.find().sort({ name: 1 }),
      Student.aggregate<{ _id: unknown; n: number }>([
        { $match: { active: true } },
        { $unwind: '$groupIds' },
        { $group: { _id: '$groupIds', n: { $sum: 1 } } },
      ]),
      Exercise.find({}, { groupIds: 1 }),
    ]);
    const studentsBy = new Map(counts.map((c) => [String(c._id), c.n]));
    res.status(status).render('admin/groups', {
      title: 'Classes',
      groups: groups.map((g) => ({
        id: g.id as string,
        name: g.name,
        students: studentsBy.get(g.id as string) ?? 0,
        exercises: exercises.filter((e) => e.groupIds.some((id) => String(id) === g.id)).length,
      })),
      withoutGroup: await Student.countDocuments({ active: true, groupIds: { $size: 0 } }),
      values,
      errors,
    });
  };

  router.get('/admin/groups', (_req, res) => renderList(res, {}, {}));

  router.post('/admin/groups', async (req, res) => {
    const parsed = groupSchema.safeParse(req.body);
    if (!parsed.success) return renderList(res, req.body, fieldErrors(parsed.error), 400);
    try {
      const group = await Group.create(parsed.data);
      setFlash(req, 'success', 'Classe créée. Importez ses élèves depuis un fichier CSV.');
      res.redirect(`/admin/groups/${group.id}`);
    } catch (err) {
      if (isDuplicateKey(err)) return renderList(res, req.body, DUPLICATE, 400);
      throw err;
    }
  });

  const renderDetail = async (
    res: Response,
    group: Awaited<ReturnType<typeof loadGroup>>,
    values: Record<string, unknown>,
    errors: Record<string, string>,
    status = 200,
  ) => {
    const [students, exercises] = await Promise.all([
      Student.find({ groupIds: group._id }).sort({ active: -1, login: 1 }),
      Exercise.find({}, { name: 1, status: 1, kind: 1, position: 1, groupIds: 1 }).sort({
        position: 1,
        name: 1,
      }),
    ]);
    res.status(status).render('admin/group', {
      title: group.name,
      group: { id: group.id as string, name: group.name },
      students: students.map((s) => ({
        id: s.id as string,
        login: s.login,
        active: s.active,
        lastLoginAt: s.lastLoginAt,
      })),
      exercises: exercises.map((e) => ({
        id: e.id as string,
        name: e.name,
        status: e.status,
        kind: KIND_LABELS[e.kind] ?? e.kind,
        position: e.position,
        assigned: e.groupIds.some((g) => String(g) === group.id),
      })),
      values,
      errors,
    });
  };

  router.get('/admin/groups/:id', async (req, res) => {
    const group = await loadGroup(req.params.id);
    await renderDetail(res, group, { name: group.name }, {});
  });

  router.post('/admin/groups/:id', async (req, res) => {
    const group = await loadGroup(req.params.id);
    const parsed = groupSchema.safeParse(req.body);
    if (!parsed.success) return renderDetail(res, group, req.body, fieldErrors(parsed.error), 400);
    group.name = parsed.data.name;
    try {
      await group.save();
    } catch (err) {
      if (isDuplicateKey(err)) return renderDetail(res, group, req.body, DUPLICATE, 400);
      throw err;
    }
    setFlash(req, 'success', 'Classe renommée.');
    res.redirect(`/admin/groups/${group.id}`);
  });

  /**
   * Assignment is done per class: the ticked exercises are added to this class, the others removed
   * from it. Assigning a draft opens it, since the teacher means students to see it. The order is
   * shared by every class the exercise belongs to.
   */
  router.post('/admin/groups/:id/exercises', async (req, res) => {
    const group = await loadGroup(req.params.id);
    const ticked = new Set(asArray(req.body.assigned));
    const positions = (req.body.position ?? {}) as Record<string, unknown>;
    const exercises = await Exercise.find({}, { status: 1, groupIds: 1, position: 1 });
    let opened = 0;
    for (const e of exercises) {
      const was = e.groupIds.some((g) => String(g) === group.id);
      const now = ticked.has(e.id as string);
      if (now && !was) e.groupIds.push(group._id);
      if (!now && was)
        e.set(
          'groupIds',
          e.groupIds.filter((g) => String(g) !== group.id),
        );
      if (now && e.status === 'draft') {
        e.status = 'open';
        opened++;
      }
      const pos = Number.parseInt(String(positions[e.id as string] ?? ''), 10);
      if (Number.isInteger(pos) && Math.abs(pos) <= 10000) e.position = pos;
      if (e.isModified()) await e.save();
    }
    const n = exercises.filter((e) => ticked.has(e.id as string)).length;
    setFlash(
      req,
      'success',
      `${n === 0 ? 'Aucun exercice affecté' : n === 1 ? '1 exercice affecté' : `${n} exercices affectés`} à ${group.name}.` +
        (opened > 0
          ? ` ${opened === 1 ? 'Un brouillon a été ouvert' : `${opened} brouillons ont été ouverts`} aux élèves.`
          : ''),
    );
    res.redirect(`/admin/groups/${group.id}#exercises`);
  });

  // Deleting a class keeps its students and exercises: they just lose this class.
  router.get('/admin/groups/:id/delete', async (req, res) => {
    const group = await loadGroup(req.params.id);
    const [students, only, exercises] = await Promise.all([
      Student.countDocuments({ groupIds: group._id }),
      Student.countDocuments({ groupIds: [group._id] }),
      Exercise.countDocuments({ groupIds: group._id }),
    ]);
    res.render('admin/confirm-delete', {
      title: `Supprimer\u00a0: ${group.name}`,
      heading: `Supprimer la classe ${group.name}\u00a0?`,
      consequences: [
        students === 0
          ? 'Elle n’a aucun élève.'
          : students === 1
            ? `Son élève est conservé avec ses résultats${only > 0 ? '\u00a0; il n’aura plus aucune classe' : ''}.`
            : `Ses ${students} élèves sont conservés avec leurs résultats${only > 0 ? `\u00a0; ${only} n’${only > 1 ? 'auront' : 'aura'} plus aucune classe` : ''}.`,
        exercises === 0
          ? 'Aucun exercice ne lui est affecté.'
          : `${exercises} exercice${exercises > 1 ? 's' : ''} ne lui ${exercises > 1 ? 'seront' : 'sera'} plus affecté${exercises > 1 ? 's' : ''}, sans perdre de résultats.`,
      ],
      action: `/admin/groups/${group.id}/delete`,
      cancel: `/admin/groups/${group.id}`,
    });
  });

  router.post('/admin/groups/:id/delete', async (req, res) => {
    const group = await loadGroup(req.params.id);
    await Student.updateMany({ groupIds: group._id }, { $pull: { groupIds: group._id } });
    await Exercise.updateMany({ groupIds: group._id }, { $pull: { groupIds: group._id } });
    await Group.deleteOne({ _id: group._id });
    setFlash(
      req,
      'success',
      `Classe ${group.name} supprimée. Ses élèves et exercices sont conservés.`,
    );
    res.redirect('/admin/groups');
  });

  const activeStudents = (groupId: mongoose.Types.ObjectId) =>
    Student.find({ groupIds: groupId, active: true }, { login: 1, qrVersion: 1 }).sort({
      login: 1,
    });

  // Printable sheet: one card (QR + login + code) per active student.
  router.get('/admin/groups/:id/qr', async (req, res) => {
    const group = await loadGroup(req.params.id);
    const students = await activeStudents(group._id);
    const cards = await Promise.all(
      students.map(async (s) => {
        const ref = { id: s.id as string, qrVersion: s.qrVersion };
        return {
          login: s.login,
          code: formatCode(loginCode(ref)),
          svg: await qrSvg(loginUrl(ref)),
        };
      }),
    );
    res.set('Cache-Control', 'no-store');
    res.render('admin/group-qr-sheet', {
      title: `QR codes\u00a0: ${group.name}`,
      group: { id: group.id as string, name: group.name },
      cards,
    });
  });

  // One PNG per active student, named `<login> - <code>.png` (no text inside the image).
  router.get('/admin/groups/:id/qr.zip', async (req, res) => {
    const group = await loadGroup(req.params.id);
    const students = await activeStudents(group._id);
    const names = uniqueFileNames(
      students.map(
        (s) => `${s.login} - ${loginCode({ id: s.id as string, qrVersion: s.qrVersion })}`,
      ),
      '.png',
    );
    const files = await Promise.all(
      students.map(async (s, i) => ({
        name: names[i]!,
        data: await qrPng(loginUrl({ id: s.id as string, qrVersion: s.qrVersion })),
      })),
    );
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', attachment(`${safeFileName(group.name)}-qr.zip`));
    res.send(zipFiles(files));
  });

  /**
   * One class on one exercise: a card per active student with where they are now (their latest
   * attempt) and how many times they finished it. Each card opens the student's detail.
   */
  router.get('/admin/groups/:id/exercises/:exerciseId', async (req, res) => {
    const group = await loadGroup(req.params.id);
    const exercise = await loadExercise(req.params.exerciseId);
    const students = await Student.find(
      { groupIds: group._id, active: true },
      { login: 1, lastSeenAt: 1, lastLoginAt: 1 },
    ).sort({ login: 1 });
    const attempts = await Attempt.find({
      exerciseId: exercise._id,
      studentId: { $in: students.map((s) => s._id) },
    }).lean();
    const cards = students.map((s) => {
      const mine = attempts.filter((a) => String(a.studentId) === (s.id as string));
      return {
        id: s.id as string,
        login: s.login,
        standing: standing((seed) => blocksFor(exercise, seed), mine, questionStates),
      };
    });
    const count = (p: (c: (typeof cards)[number]) => boolean) => cards.filter(p).length;
    res.render('admin/group-exercise', {
      title: `${exercise.name} · ${group.name}`,
      group: { id: group.id as string, name: group.name },
      exercise: {
        id: exercise.id as string,
        name: exercise.name,
        status: exercise.status,
        generated: isGenerated(exercise),
        assigned: exercise.groupIds.some((g) => String(g) === group.id),
      },
      cards,
      totals: {
        completed: count((c) => c.standing.completed > 0),
        inProgress: count((c) => c.standing.current?.progress === 'in_progress'),
        todo: count((c) => !c.standing.current),
      },
    });
  });

  return router;
}
