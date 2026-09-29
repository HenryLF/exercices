import { Router, type Response } from 'express';
import mongoose from 'mongoose';
import { stringify } from 'csv-stringify';
import { z } from 'zod';
import { requireRole } from '../auth/middleware.js';
import { Attempt, questionStates } from '../models/attempt.js';
import {
  Exercise,
  EXERCISE_STATUSES,
  plainBlocks,
  type ExerciseStatus,
} from '../models/exercise.js';
import { Group } from '../models/group.js';
import { Student } from '../models/student.js';
import {
  blankRow,
  buildSegments,
  parseExerciseForm,
  questionBlocks,
  toEditorRows,
  validateEdit,
  type ExerciseFormValues,
} from '../lib/blocks.js';
import { blocksFor, isGenerated, newSeed, SEED_RE, templateBlocks } from '../lib/content.js';
import { csvHeader, csvRow, slugFilename } from '../lib/csv.js';
import { setFlash } from '../lib/flash.js';
import { GENERATORS, getGenerator, KIND_LABELS, type Generator } from '../lib/generators/index.js';
import { notFound } from '../lib/http-error.js';
import { summarizeAttempt } from '../lib/results.js';
import { asArray, fieldErrors } from '../lib/validation.js';
import { groupNames, isDuplicateKey, loadExercise } from './load.js';

const STATUS_MESSAGES: Record<ExerciseStatus, string> = {
  draft: 'L’exercice est repassé en brouillon.',
  open: 'L’exercice est ouvert aux classes affectées.',
  closed: 'L’exercice est fermé.',
};

const DUPLICATE_NAME = 'Un exercice porte déjà ce nom';

type ExerciseDocument = Awaited<ReturnType<typeof loadExercise>>;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `base` if free, else `base – 2`, `base – 3`... */
async function uniqueName(base: string): Promise<string> {
  const existing = await Exercise.find({ name: { $regex: `^${escapeRegex(base)}` } }, { name: 1 });
  const used = new Set(existing.map((e) => e.name));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} – ${n}`)) n++;
  return `${base} – ${n}`;
}

const nameSchema = z
  .string({ error: 'Le nom est obligatoire' })
  .trim()
  .min(1, 'Le nom est obligatoire')
  .max(150, 'Le nom est trop long');

function generatorOf(exercise: ExerciseDocument): Generator<unknown> {
  const generator = getGenerator(exercise.generated?.kind ?? '');
  if (!generator) throw notFound('Générateur');
  return generator;
}

async function exerciseHeader(exercise: ExerciseDocument) {
  const [attemptCount, names] = await Promise.all([
    Attempt.countDocuments({ exerciseId: exercise._id }),
    groupNames(),
  ]);
  return {
    attemptCount,
    exercise: {
      id: exercise.id as string,
      name: exercise.name,
      status: exercise.status,
      kind: exercise.kind,
      kindLabel: KIND_LABELS[exercise.kind] ?? exercise.kind,
      generated: isGenerated(exercise),
      groups: exercise.groupIds.map((g) => ({ id: String(g), name: names.get(String(g)) ?? '' })),
    },
    statuses: EXERCISE_STATUSES,
  };
}

async function renderEditor(
  res: Response,
  exercise: ExerciseDocument | null,
  values: ExerciseFormValues,
  errors: string[],
  status = 200,
) {
  const header = exercise ? await exerciseHeader(exercise) : { attemptCount: 0, exercise: null };
  res.status(status).render('admin/exercise-edit', {
    title: exercise ? `Modifier\u00a0: ${exercise.name}` : 'Nouvel exercice',
    ...header,
    statuses: EXERCISE_STATUSES,
    values,
    errors,
    // With tries stored, existing questions can't be removed or change answer type.
    lockedKeys:
      header.attemptCount > 0 ? questionBlocks(plainBlocks(exercise!)).map((q) => q.key) : [],
  });
}

async function renderGeneratedEditor(
  res: Response,
  exercise: ExerciseDocument,
  values: Record<string, unknown>,
  errors: Record<string, string>,
  status = 200,
) {
  const generator = generatorOf(exercise);
  const header = await exerciseHeader(exercise);
  res.status(status).render('admin/exercise-generated', {
    title: `Modifier\u00a0: ${exercise.name}`,
    ...header,
    generator: { kind: generator.kind, label: generator.label, description: generator.description },
    summary: generator.describeParams(
      generator.paramsSchema.parse(exercise.generated?.params ?? {}),
    ),
    paramsView: generator.paramsView,
    allowRetry: exercise.allowRetry,
    ...generator.formData(),
    values,
    errors,
  });
}

/** An HTML checkbox: present ('on') when ticked, absent otherwise. */
const checked = (v: unknown) => v === 'on' || v === 'true';
const formValues = (body: Record<string, unknown>) => ({
  ...body,
  allowRetry: checked(body.allowRetry),
});

/**
 * One row per attempt (one per seed for a generated exercise), plus one "à faire" row for each
 * active student of the assigned classes who hasn't started.
 */
async function resultRows(exercise: ExerciseDocument) {
  const attempts = await Attempt.find({ exerciseId: exercise._id }).sort({ startedAt: 1 }).lean();
  const students = await Student.find({
    $or: [
      { groupIds: { $in: exercise.groupIds }, active: true },
      { _id: { $in: attempts.map((a) => a.studentId) } },
    ],
  } as mongoose.QueryFilter<unknown>);
  const names = await groupNames();
  const byStudent = new Map(students.map((s) => [s.id as string, s]));
  // A student's classes that have this exercise (all their classes if none has it any more).
  const assigned = new Set(exercise.groupIds.map(String));
  const groupOf = (s: (typeof students)[number]) => {
    const ids = s.groupIds.map(String);
    const relevant = ids.filter((id) => assigned.has(id));
    return (relevant.length > 0 ? relevant : ids)
      .map((id) => names.get(id) ?? '')
      .filter(Boolean)
      .join(', ');
  };
  const template = templateBlocks(exercise);

  const rows = attempts.flatMap((a) => {
    const s = byStudent.get(String(a.studentId));
    if (!s) return [];
    const states = questionStates(a);
    return [
      {
        id: s.id as string,
        login: s.login,
        group: groupOf(s),
        seed: a.seed ?? null,
        summary: summarizeAttempt(blocksFor(exercise, a.seed), a, states),
        states,
      },
    ];
  });
  const started = new Set(attempts.map((a) => String(a.studentId)));
  for (const s of students) {
    if (started.has(s.id as string) || !s.active) continue;
    rows.push({
      id: s.id as string,
      login: s.login,
      group: groupOf(s),
      seed: null,
      summary: summarizeAttempt(template, null, {}),
      states: {},
    });
  }
  rows.sort(
    (a, b) =>
      a.group.localeCompare(b.group, 'fr') ||
      a.login.localeCompare(b.login) ||
      (a.summary.startedAt?.getTime() ?? 0) - (b.summary.startedAt?.getTime() ?? 0),
  );
  return { blocks: template, rows };
}

export function adminExercisesRouter() {
  const router = Router();
  router.use('/admin/exercises', requireRole('admin'));

  router.get('/admin/exercises', async (_req, res) => {
    const [exercises, names, groups, counts] = await Promise.all([
      Exercise.find({}, { name: 1, kind: 1, status: 1, position: 1, groupIds: 1 }).sort({
        position: 1,
        name: 1,
      }),
      groupNames(),
      Group.find({}, { name: 1 }).sort({ name: 1 }),
      Attempt.aggregate<{ _id: mongoose.Types.ObjectId; started: number; completed: number }>([
        {
          $group: {
            _id: '$exerciseId',
            started: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          },
        },
      ]),
    ]);
    const countBy = new Map(counts.map((c) => [String(c._id), c]));
    res.render('admin/exercises', {
      title: 'Exercices',
      groups: groups.map((g) => ({ id: g.id as string, name: g.name })),
      exercises: exercises.map((e) => ({
        id: e.id as string,
        name: e.name,
        kind: KIND_LABELS[e.kind] ?? e.kind,
        status: e.status,
        groups: e.groupIds.map((g) => names.get(String(g))).filter(Boolean),
        groupIds: e.groupIds.map(String),
        started: countBy.get(e.id as string)?.started ?? 0,
        completed: countBy.get(e.id as string)?.completed ?? 0,
      })),
    });
  });

  /**
   * The list's grid: one checkbox per exercise and class, `a=<exerciseId>:<groupId>`. Only the
   * exercises listed in `shown` are touched, so one created meanwhile keeps its classes. As on the
   * class page, assigning a draft opens it.
   */
  router.post('/admin/exercises/assign', async (req, res) => {
    const shown = new Set(asArray(req.body.shown).filter((id) => mongoose.isValidObjectId(id)));
    const known = new Set((await Group.find({}, { _id: 1 })).map((g) => g.id as string));
    const ticked = new Map<string, Set<string>>();
    for (const pair of asArray(req.body.a)) {
      const [exerciseId, groupId] = pair.split(':');
      if (!exerciseId || !groupId || !shown.has(exerciseId) || !known.has(groupId)) continue;
      ticked.set(exerciseId, (ticked.get(exerciseId) ?? new Set()).add(groupId));
    }
    let changed = 0;
    let opened = 0;
    for (const e of await Exercise.find({ _id: { $in: [...shown] } })) {
      const next = [...(ticked.get(e.id as string) ?? [])].sort();
      const before = e.groupIds.map(String).sort();
      if (next.join() !== before.join()) {
        e.set(
          'groupIds',
          next.map((id) => new mongoose.Types.ObjectId(id)),
        );
        changed++;
      }
      if (next.length > 0 && e.status === 'draft') {
        e.status = 'open';
        opened++;
      }
      if (e.isModified()) await e.save();
    }
    setFlash(
      req,
      'success',
      (changed === 0
        ? 'Aucune affectation modifiée.'
        : `Affectations enregistrées pour ${changed} exercice${changed > 1 ? 's' : ''}.`) +
        (opened > 0
          ? ` ${opened === 1 ? 'Un brouillon a été ouvert' : `${opened} brouillons ont été ouverts`} aux élèves.`
          : ''),
    );
    res.redirect('/admin/exercises');
  });

  // --- Custom exercise
  router.get('/admin/exercises/new', async (_req, res) => {
    await renderEditor(
      res,
      null,
      { name: '', rows: [blankRow('markdown'), blankRow('question')] },
      [],
    );
  });

  router.post('/admin/exercises', async (req, res) => {
    const parsed = parseExerciseForm(req.body);
    if (!parsed.ok) return renderEditor(res, null, parsed.values, parsed.errors, 400);
    const values = { name: parsed.value.name, rows: toEditorRows(parsed.value.blocks) };
    if (await Exercise.exists({ name: parsed.value.name }))
      return renderEditor(res, null, values, [DUPLICATE_NAME], 400);
    try {
      const exercise = await Exercise.create({ ...parsed.value, kind: 'custom' });
      setFlash(
        req,
        'success',
        'Exercice créé. Affectez-le à une classe depuis la page de la classe.',
      );
      res.redirect(`/admin/exercises/${exercise.id}`);
    } catch (err) {
      if (isDuplicateKey(err)) return renderEditor(res, null, values, [DUPLICATE_NAME], 400);
      throw err;
    }
  });

  // --- Generated exercises: one template, new numbers for every attempt
  router.get('/admin/exercises/generate', (_req, res) => {
    res.render('admin/generate', {
      title: 'Générer un exercice',
      generators: Object.values(GENERATORS).map((g) => ({
        kind: g.kind,
        label: g.label,
        description: g.description,
      })),
    });
  });

  const renderGenerator = (
    res: Response,
    kind: string,
    values: Record<string, unknown>,
    errors: Record<string, string>,
    status = 200,
  ) => {
    const generator = getGenerator(kind);
    if (!generator) throw notFound('Type d’exercice');
    res.status(status).render(`admin/generate-${generator.kind}`, {
      title: `Générer\u00a0: ${generator.label}`,
      generator: {
        kind: generator.kind,
        label: generator.label,
        description: generator.description,
      },
      paramsView: generator.paramsView,
      ...generator.formData(),
      values,
      errors,
    });
  };

  router.get('/admin/exercises/generate/:kind', (req, res) =>
    renderGenerator(res, req.params.kind, { allowRetry: true }, {}),
  );

  router.post('/admin/exercises/generate/:kind', async (req, res) => {
    const generator = getGenerator(req.params.kind);
    if (!generator) throw notFound('Type d’exercice');
    const params = generator.paramsSchema.safeParse(req.body);
    const rawName = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const name = rawName ? nameSchema.safeParse(rawName) : null;
    if (!params.success || (name && !name.success)) {
      const errors = {
        ...(params.success ? {} : fieldErrors(params.error)),
        ...(name && !name.success ? { name: name.error.issues[0]!.message } : {}),
      };
      return renderGenerator(res, generator.kind, formValues(req.body), errors, 400);
    }
    if (name && (await Exercise.exists({ name: name.data })))
      return renderGenerator(
        res,
        generator.kind,
        formValues(req.body),
        { name: DUPLICATE_NAME },
        400,
      );
    const exercise = await Exercise.create({
      name: name?.data ?? (await uniqueName(generator.defaultName(params.data))),
      kind: generator.kind,
      blocks: [],
      allowRetry: checked(req.body.allowRetry),
      generated: { kind: generator.kind, params: params.data },
    });
    setFlash(
      req,
      'success',
      'Exercice créé. Chaque élève reçoit de nouveaux nombres à chaque tentative. Affectez-le à une classe depuis la page de la classe.',
    );
    res.redirect(`/admin/exercises/${exercise.id}`);
  });

  // --- One exercise
  router.get('/admin/exercises/:id', async (req, res) => {
    const exercise = await loadExercise(req.params.id);
    if (isGenerated(exercise))
      return renderGeneratedEditor(
        res,
        exercise,
        {
          name: exercise.name,
          allowRetry: exercise.allowRetry,
          ...(exercise.generated?.params as object),
        },
        {},
      );
    await renderEditor(
      res,
      exercise,
      { name: exercise.name, rows: toEditorRows(plainBlocks(exercise)) },
      [],
    );
  });

  router.post('/admin/exercises/:id', async (req, res) => {
    const exercise = await loadExercise(req.params.id);
    const nameTaken = async (name: string) =>
      !!(await Exercise.exists({ name, _id: { $ne: exercise._id } }));

    if (isGenerated(exercise)) {
      const generator = generatorOf(exercise);
      const name = nameSchema.safeParse(req.body.name);
      const hasAttempts = !!(await Attempt.exists({ exerciseId: exercise._id }));
      // Once students have tries, the params stay: their seeds must keep giving the same numbers.
      const params = hasAttempts
        ? { success: true as const, data: exercise.generated?.params }
        : generator.paramsSchema.safeParse(req.body);
      const errors: Record<string, string> = {
        ...(name.success ? {} : { name: name.error.issues[0]!.message }),
        ...(params.success ? {} : fieldErrors(params.error)),
      };
      if (name.success && (await nameTaken(name.data))) errors.name = DUPLICATE_NAME;
      if (Object.keys(errors).length > 0 || !name.success || !params.success)
        return renderGeneratedEditor(res, exercise, formValues(req.body), errors, 400);
      exercise.set({
        name: name.data,
        allowRetry: checked(req.body.allowRetry),
        generated: { kind: generator.kind, params: params.data },
      });
      await exercise.save();
      setFlash(req, 'success', 'Exercice enregistré.');
      return res.redirect(`/admin/exercises/${exercise.id}`);
    }

    const existing = plainBlocks(exercise);
    const parsed = parseExerciseForm(req.body, new Set(existing.map((b) => b.key)));
    if (!parsed.ok) return renderEditor(res, exercise, parsed.values, parsed.errors, 400);

    const values = { name: parsed.value.name, rows: toEditorRows(parsed.value.blocks) };
    const hasAttempts = !!(await Attempt.exists({ exerciseId: exercise._id }));
    const errors = validateEdit(existing, parsed.value.blocks, hasAttempts);
    if (await nameTaken(parsed.value.name)) errors.push(DUPLICATE_NAME);
    if (errors.length > 0) return renderEditor(res, exercise, values, errors, 400);

    exercise.set({ name: parsed.value.name, blocks: parsed.value.blocks });
    try {
      await exercise.save();
    } catch (err) {
      if (isDuplicateKey(err)) return renderEditor(res, exercise, values, [DUPLICATE_NAME], 400);
      throw err;
    }
    setFlash(req, 'success', 'Exercice enregistré.');
    res.redirect(`/admin/exercises/${exercise.id}`);
  });

  router.post('/admin/exercises/:id/status', async (req, res) => {
    const exercise = await loadExercise(req.params.id);
    const status = z.enum(EXERCISE_STATUSES).safeParse(req.body.status);
    if (!status.success) setFlash(req, 'error', 'Statut inconnu.');
    else {
      exercise.status = status.data;
      await exercise.save();
      setFlash(req, 'success', STATUS_MESSAGES[status.data]);
    }
    res.redirect(`/admin/exercises/${exercise.id}`);
  });

  // Deleting an exercise removes every attempt made on it.
  router.get('/admin/exercises/:id/delete', async (req, res) => {
    const exercise = await loadExercise(req.params.id);
    const attempts = await Attempt.countDocuments({ exerciseId: exercise._id });
    const classes = exercise.groupIds.length;
    res.render('admin/confirm-delete', {
      title: `Supprimer\u00a0: ${exercise.name}`,
      heading: `Supprimer l’exercice ${exercise.name}\u00a0?`,
      consequences: [
        attempts === 0
          ? 'Aucun élève ne l’a commencé.'
          : `${attempts} tentative${attempts > 1 ? 's' : ''} d’élèves et tous leurs essais seront supprimés.`,
        classes === 0
          ? 'Il n’est affecté à aucune classe.'
          : `Il disparaîtra de ${classes === 1 ? 'la classe qui l’a' : `ses ${classes} classes`}.`,
        'Pour le retirer aux élèves sans perdre les résultats, fermez-le ou décochez-le dans la classe.',
      ],
      action: `/admin/exercises/${exercise.id}/delete`,
      cancel: `/admin/exercises/${exercise.id}`,
    });
  });

  router.post('/admin/exercises/:id/delete', async (req, res) => {
    const exercise = await loadExercise(req.params.id);
    await Attempt.deleteMany({ exerciseId: exercise._id });
    await Exercise.deleteOne({ _id: exercise._id });
    setFlash(req, 'success', `Exercice ${exercise.name} supprimé, avec ses tentatives.`);
    res.redirect('/admin/exercises');
  });

  // A generated exercise shows the draw of `?seed=`, or a fresh random one: the same seed always
  // gives the same numbers, so any student's attempt can be replayed here with its answers.
  router.get('/admin/exercises/:id/preview', async (req, res) => {
    const exercise = await loadExercise(req.params.id);
    const asked = typeof req.query.seed === 'string' ? req.query.seed.trim() : '';
    const valid = SEED_RE.test(asked);
    const seed = isGenerated(exercise) ? (valid ? asked : newSeed()) : null;
    res.render('admin/preview', {
      title: `Aperçu\u00a0: ${exercise.name}`,
      exercise: {
        id: exercise.id as string,
        name: exercise.name,
        status: exercise.status,
        generated: isGenerated(exercise),
      },
      seed,
      seedError:
        isGenerated(exercise) && asked && !valid
          ? 'Tirage invalide\u00a0: lettres, chiffres, «\u00a0-\u00a0» et «\u00a0_\u00a0» uniquement (64 au plus). Un autre tirage est affiché.'
          : null,
      segments: buildSegments(blocksFor(exercise, seed), {}, { showAnswers: true }),
      readOnly: true,
      preview: true,
    });
  });

  router.get('/admin/exercises/:id/results', async (req, res) => {
    const exercise = await loadExercise(req.params.id);
    const { blocks, rows } = await resultRows(exercise);
    res.render('admin/exercise-results', {
      title: `Résultats\u00a0: ${exercise.name}`,
      exercise: {
        id: exercise.id as string,
        name: exercise.name,
        status: exercise.status,
        generated: isGenerated(exercise),
      },
      questions: questionBlocks(blocks).map((q) => ({ key: q.key, label: q.label })),
      rows,
    });
  });

  router.get('/admin/exercises/:id/export.csv', async (req, res) => {
    const exercise = await loadExercise(req.params.id);
    const { blocks, rows } = await resultRows(exercise);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${slugFilename(exercise.name, '.csv')}"`,
    );
    // BOM so Excel reads UTF-8 accents correctly.
    const csv = stringify({ bom: true, header: true, columns: csvHeader(blocks) });
    csv.pipe(res);
    for (const r of rows) csv.write(csvRow(blocks, r, r.summary, r.states));
    csv.end();
  });

  return router;
}
