import { Router, type Request, type Response } from 'express';
import { requireRole } from '../auth/middleware.js';
import { Attempt, questionStates, type Try } from '../models/attempt.js';
import { Exercise } from '../models/exercise.js';
import { checkAnswer } from '../lib/answers.js';
import { buildSegments, questionBlocks, type ViewOptions } from '../lib/blocks.js';
import { blocksFor, isGenerated, newSeed } from '../lib/content.js';
import { setFlash } from '../lib/flash.js';
import { forbidden, notFound } from '../lib/http-error.js';
import { standing, summarizeAttempt } from '../lib/results.js';
import { loadExercise } from './load.js';

type ExerciseDocument = Awaited<ReturnType<typeof loadExercise>>;

/** The exercise, if it is assigned to one of the student's classes and not a draft. */
async function assignedExercise(req: Request<{ id: string }>) {
  const exercise = await loadExercise(req.params.id);
  const mine = new Set(req.user!.groupIds ?? []);
  if (exercise.status === 'draft' || !exercise.groupIds.some((g) => mine.has(String(g))))
    throw forbidden();
  return exercise;
}

/** The attempt the student is on: their latest one. */
function currentAttempt(exercise: ExerciseDocument, studentId: string) {
  return Attempt.findOne({ exerciseId: exercise._id, studentId }).sort({ startedAt: -1 });
}

/**
 * Starts an attempt. A custom exercise has one attempt per student (seed null); a generated one
 * gets a fresh seed each time, so the student can practise with new numbers indefinitely.
 */
async function startAttempt(exercise: ExerciseDocument, studentId: string) {
  const seed = isGenerated(exercise) ? newSeed() : null;
  return Attempt.findOneAndUpdate(
    { exerciseId: exercise._id, studentId, seed },
    { $setOnInsert: { status: 'in_progress', questions: {}, startedAt: new Date() } },
    { upsert: true, returnDocument: 'after' },
  );
}

/** Exercises of the student's classes, in teaching order, with the student's progress. */
async function myExercises(req: Request) {
  const groupIds = req.user!.groupIds ?? [];
  if (groupIds.length === 0) return [];
  const exercises = await Exercise.find(
    { groupIds: { $in: groupIds }, status: { $ne: 'draft' } },
    { name: 1, status: 1, position: 1, blocks: 1, generated: 1, allowRetry: 1 },
  ).sort({ position: 1, name: 1 });
  const attempts = await Attempt.find({
    studentId: req.user!.id,
    exerciseId: { $in: exercises.map((e) => e._id) },
  }).lean();
  return exercises.map((e) => {
    const mine = attempts.filter((a) => String(a.exerciseId) === (e.id as string));
    return {
      id: e.id as string,
      name: e.name,
      status: e.status,
      generated: isGenerated(e),
      canRetry: isGenerated(e) && e.allowRetry,
      standing: standing((seed) => blocksFor(e, seed), mine, questionStates),
    };
  });
}

async function renderExercise(
  req: Request<{ id: string }>,
  res: Response,
  exercise: ExerciseDocument,
  opts: ViewOptions = {},
  status = 200,
) {
  const attempt = await currentAttempt(exercise, req.user!.id).lean();
  const blocks = blocksFor(exercise, attempt?.seed);
  const states = questionStates(attempt);
  const summary = summarizeAttempt(blocks, attempt, states);
  res.status(status).render('student/exercise', {
    title: exercise.name,
    exercise: {
      id: exercise.id as string,
      name: exercise.name,
      status: exercise.status,
      generated: isGenerated(exercise),
      canRetry: isGenerated(exercise) && exercise.allowRetry,
    },
    segments: buildSegments(blocks, states, opts),
    summary,
    readOnly: exercise.status !== 'open',
    preview: false,
    completed: summary.progress === 'completed',
    done: req.query.done === '1' && summary.progress === 'completed',
  });
}

export function studentRouter() {
  const router = Router();
  router.use('/exercises', requireRole('student'));

  router.get('/exercises', async (req, res) => {
    res.render('student/exercises', {
      title: 'Mes exercices',
      exercises: await myExercises(req),
      hasGroup: (req.user!.groupIds ?? []).length > 0,
    });
  });

  // First open exercise the student has never finished.
  router.get('/exercises/next', async (req, res) => {
    const next = (await myExercises(req)).find(
      (e) => e.status === 'open' && e.standing.completed === 0,
    );
    res.redirect(next ? `/exercises/${next.id}` : '/exercises');
  });

  router.get('/exercises/:id', async (req, res) => {
    const exercise = await assignedExercise(req);
    if (exercise.status === 'open' && !(await currentAttempt(exercise, req.user!.id)))
      await startAttempt(exercise, req.user!.id);
    await renderExercise(req, res, exercise);
  });

  // Generated exercises that allow it: new numbers, once the current attempt is finished.
  router.post('/exercises/:id/retry', async (req, res) => {
    const exercise = await assignedExercise(req);
    const current = await currentAttempt(exercise, req.user!.id);
    if (
      exercise.status === 'open' &&
      isGenerated(exercise) &&
      exercise.allowRetry &&
      current?.status === 'completed'
    )
      await startAttempt(exercise, req.user!.id);
    res.redirect(`/exercises/${exercise.id}`);
  });

  const loadQuestion = async (req: Request<{ id: string; key: string }>, res: Response) => {
    const exercise = await assignedExercise(req);
    if (exercise.status !== 'open') {
      setFlash(req, 'error', 'Cet exercice est fermé\u00a0: il n’accepte plus de réponses.');
      res.redirect(`/exercises/${exercise.id}`);
      return null;
    }
    const attempt =
      (await currentAttempt(exercise, req.user!.id)) ??
      (await startAttempt(exercise, req.user!.id))!;
    const blocks = blocksFor(exercise, attempt.seed);
    const question = questionBlocks(blocks).find((q) => q.key === req.params.key);
    if (!question) throw notFound('Question');
    return { exercise, question, attempt, blocks };
  };

  router.post('/exercises/:id/questions/:key', async (req, res) => {
    const found = await loadQuestion(req, res);
    if (!found) return;
    const { exercise, question, attempt, blocks } = found;
    const key = question.key;
    const state = questionStates(attempt)[key];
    if (state?.solved || attempt.status === 'completed')
      return res.redirect(`/exercises/${exercise.id}#${key}`);

    const result = checkAnswer(question.answer, req.body.value);
    if (!result.ok) {
      const input = {
        key,
        value: typeof req.body.value === 'string' ? req.body.value : '',
        error: result.message,
      };
      return renderExercise(req, res, exercise, { input }, 400);
    }

    const entry: Try = {
      try: (state?.tries.length ?? 0) + 1,
      tooltip: !!state?.tooltipShown,
      value: result.value,
      correct: result.correct,
      at: new Date(),
    };
    await Attempt.updateOne(
      { _id: attempt._id, [`questions.${key}.solved`]: { $ne: true } },
      {
        $push: { [`questions.${key}.tries`]: entry },
        ...(result.correct ? { $set: { [`questions.${key}.solved`]: true } } : {}),
      },
    );
    if (!result.correct) return res.redirect(`/exercises/${exercise.id}#${key}`);

    const after = questionStates(await Attempt.findById(attempt._id).lean());
    const next = questionBlocks(blocks).find((q) => !after[q.key]?.solved);
    if (next) return res.redirect(`/exercises/${exercise.id}#${next.key}`);
    await Attempt.updateOne(
      { _id: attempt._id, status: 'in_progress' },
      { $set: { status: 'completed', completedAt: new Date() } },
    );
    res.redirect(`/exercises/${exercise.id}?done=1`);
  });

  router.post('/exercises/:id/questions/:key/tooltip', async (req, res) => {
    const found = await loadQuestion(req, res);
    if (!found) return;
    const { exercise, question, attempt } = found;
    if (question.tooltip && attempt.status !== 'completed') {
      await Attempt.updateOne(
        { _id: attempt._id, [`questions.${question.key}.tooltipShown`]: { $ne: true } },
        {
          $set: {
            [`questions.${question.key}.tooltipShown`]: true,
            [`questions.${question.key}.tooltipShownAt`]: new Date(),
          },
        },
      );
    }
    res.redirect(`/exercises/${exercise.id}#${question.key}`);
  });

  return router;
}
