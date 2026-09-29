import type mongoose from 'mongoose';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Attempt, questionStates } from '../../src/models/attempt.js';
import { plainBlocks } from '../../src/models/exercise.js';
import { questionBlocks } from '../../src/lib/blocks.js';
import {
  createExercise,
  createGroup,
  createStudent,
  loginAsStudent,
  makeApp,
  type Agent,
} from '../helpers.js';

let app: ReturnType<typeof makeApp>;
beforeAll(() => {
  app = makeApp();
});

let agent: Agent;
let group: Awaited<ReturnType<typeof createGroup>>;
let s: Awaited<ReturnType<typeof createStudent>>;
beforeEach(async () => {
  group = await createGroup();
  s = await createStudent({ groupId: group._id });
  agent = request.agent(app);
  await loginAsStudent(agent, s);
});

const keys = (ex: Awaited<ReturnType<typeof createExercise>>) =>
  questionBlocks(plainBlocks(ex)).map((q) => q.key);
const attemptOf = async (ex: { _id: mongoose.Types.ObjectId }) =>
  Attempt.findOne({ exerciseId: ex._id, studentId: s.student._id }).lean();
const answer = (ex: { id: string }, key: string, value: string) =>
  agent.post(`/exercises/${ex.id}/questions/${key}`).type('form').send({ value });

describe('exercise list', () => {
  it('shows only the group’s non-draft exercises, in position order', async () => {
    const other = await createGroup('Autre');
    await createExercise({ name: 'B second', groupIds: [group._id], position: 2 });
    await createExercise({ name: 'A first', groupIds: [group._id], position: 1 });
    await createExercise({ name: 'Draft', groupIds: [group._id], status: 'draft' });
    await createExercise({ name: 'Other group', groupIds: [other._id] });
    const res = await agent.get('/exercises');
    expect(res.status).toBe(200);
    expect(res.text.indexOf('A first')).toBeLessThan(res.text.indexOf('B second'));
    expect(res.text).not.toContain('Draft');
    expect(res.text).not.toContain('Other group');
  });

  it('students without a class see a message', async () => {
    const lone = await createStudent({ login: 'c.sans' });
    const a = request.agent(app);
    await loginAsStudent(a, lone);
    expect((await a.get('/exercises')).text).toContain('data-testid="no-group"');
    expect((await a.get('/exercises/next')).headers.location).toBe('/exercises');
  });

  it('/exercises/next goes to the first unfinished open exercise', async () => {
    const first = await createExercise({ name: 'One', groupIds: [group._id], position: 1 });
    const second = await createExercise({ name: 'Two', groupIds: [group._id], position: 2 });
    await createExercise({
      name: 'Zero closed',
      groupIds: [group._id],
      position: 0,
      status: 'closed',
    });
    expect((await agent.get('/exercises/next')).headers.location).toBe(`/exercises/${first.id}`);
    await Attempt.create({ exerciseId: first._id, studentId: s.student._id, status: 'completed' });
    expect((await agent.get('/exercises/next')).headers.location).toBe(`/exercises/${second.id}`);
  });
});

describe('exercise page', () => {
  it('refuses unassigned and draft exercises', async () => {
    const other = await createExercise({ name: 'Elsewhere' });
    const draft = await createExercise({ name: 'Draft', status: 'draft', groupIds: [group._id] });
    expect((await agent.get(`/exercises/${other.id}`)).status).toBe(403);
    expect((await agent.get(`/exercises/${draft.id}`)).status).toBe(403);
    expect((await agent.get('/exercises/nope')).status).toBe(404);
  });

  it('renders blocks, starts the attempt, and never leaks expected answers or closed tooltips', async () => {
    const ex = await createExercise({
      groupIds: [group._id],
      blocks: [
        { type: 'markdown', body: 'Consigne **importante**' },
        { type: 'given', label: 'Prix d’achat brut', amount: 1021.24 },
        {
          type: 'question',
          label: 'Remise',
          hint: '4 %',
          tooltip: 'Secret *Exemple*',
          answer: { type: 'number', value: 40.85, decimals: 2, tolerance: 0.01 },
        },
      ],
    });
    const res = await agent.get(`/exercises/${ex.id}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('<strong>importante</strong>');
    expect(res.text).toContain('1 021,24'.replace(' ', ' '));
    expect(res.text).toContain('4 %');
    expect(res.text).not.toMatch(/40[.,]85/);
    expect(res.text).not.toContain('Secret');
    expect(await attemptOf(ex)).toMatchObject({ status: 'in_progress' });
  });

  it('records wrong and right tries, colours rows, and ignores posts once solved', async () => {
    const ex = await createExercise({ groupIds: [group._id] });
    const [remise, taux] = keys(ex) as [string, string];
    await agent.get(`/exercises/${ex.id}`);

    const wrong = await answer(ex, remise, '12,5');
    expect(wrong.headers.location).toBe(`/exercises/${ex.id}#${remise}`);
    let page = await agent.get(`/exercises/${ex.id}`);
    expect(page.text).toMatch(new RegExp(`data-testid="q-${remise}" data-state="ko"`));
    expect(page.text).toContain('value="12,50"');

    const right = await answer(ex, remise, '10 €');
    expect(right.headers.location).toBe(`/exercises/${ex.id}#${taux}`);
    page = await agent.get(`/exercises/${ex.id}`);
    expect(page.text).toMatch(new RegExp(`data-testid="q-${remise}" data-state="ok"`));
    // A solved question collapses to its answer: no field, no button, and progress moves on.
    expect(page.text).toMatch(new RegExp(`data-testid="answer-${remise}">10,00\u00a0€<`));
    expect(page.text).not.toContain(`data-testid="submit-${remise}"`);
    expect(page.text).toMatch(/<progress value="1" max="2"/);

    await answer(ex, remise, '999');
    const st = questionStates(await attemptOf(ex))[remise]!;
    expect(st.solved).toBe(true);
    expect(st.tries.map((t) => [t.try, t.value, t.correct, t.tooltip])).toEqual([
      [1, 12.5, false, false],
      [2, 10, true, false],
    ]);
  });

  it('blank or unparsable input re-renders with an error and records nothing', async () => {
    const ex = await createExercise({ groupIds: [group._id] });
    const [remise, taux] = keys(ex) as [string, string];
    const blank = await answer(ex, remise, '  ');
    expect(blank.status).toBe(400);
    expect(blank.text).toContain(`data-testid="error-${remise}"`);
    const junk = await answer(ex, remise, 'dix');
    expect(junk.status).toBe(400);
    expect(junk.text).toContain('value="dix"');
    const offList = await answer(ex, taux, 'inconnu');
    expect(offList.status).toBe(400);
    expect(questionStates(await attemptOf(ex))[remise]).toBeUndefined();
  });

  it('opening a tooltip is recorded once, shown, and flags later tries', async () => {
    const ex = await createExercise({ groupIds: [group._id] });
    const [remise] = keys(ex) as [string];
    await answer(ex, remise, '1');
    const open = await agent.post(`/exercises/${ex.id}/questions/${remise}/tooltip`);
    expect(open.headers.location).toBe(`/exercises/${ex.id}#${remise}`);
    await agent.post(`/exercises/${ex.id}/questions/${remise}/tooltip`);
    const page = await agent.get(`/exercises/${ex.id}`);
    expect(page.text).toContain(`data-testid="tip-${remise}"`);
    expect(page.text).toContain('<em>Exemple</em>');
    await answer(ex, remise, '10');
    const st = questionStates(await attemptOf(ex))[remise]!;
    expect(st.tooltipShown).toBe(true);
    expect(st.tooltipShownAt).toBeInstanceOf(Date);
    expect(st.tries.map((t) => ({ try: t.try, tooltip: t.tooltip }))).toEqual([
      { try: 1, tooltip: false },
      { try: 2, tooltip: true },
    ]);
  });

  it('solving every question completes the attempt and offers the next exercise', async () => {
    const ex = await createExercise({ groupIds: [group._id], position: 1 });
    const next = await createExercise({ name: 'Suivant', groupIds: [group._id], position: 2 });
    const [remise, taux] = keys(ex) as [string, string];
    await answer(ex, remise, '10');
    const done = await answer(ex, taux, 'normal');
    expect(done.headers.location).toBe(`/exercises/${ex.id}?done=1`);
    const attempt = await attemptOf(ex);
    expect(attempt).toMatchObject({ status: 'completed' });
    expect(attempt!.completedAt).toBeInstanceOf(Date);
    const page = await agent.get(`/exercises/${ex.id}?done=1`);
    expect(page.text).toContain('data-testid="done"');
    expect((await agent.get('/exercises/next')).headers.location).toBe(`/exercises/${next.id}`);
  });

  it('a closed exercise is read-only', async () => {
    const ex = await createExercise({ groupIds: [group._id], status: 'closed' });
    const [remise] = keys(ex) as [string];
    const page = await agent.get(`/exercises/${ex.id}`);
    expect(page.text).toContain('data-testid="closed"');
    expect(page.text).not.toContain(`data-testid="submit-${remise}"`);
    const res = await answer(ex, remise, '10');
    expect(res.headers.location).toBe(`/exercises/${ex.id}`);
    expect(await attemptOf(ex)).toBeNull();
  });

  it('a custom exercise has a single attempt: retry does nothing', async () => {
    const ex = await createExercise({ groupIds: [group._id] });
    const [remise, taux] = keys(ex) as [string, string];
    await answer(ex, remise, '10');
    await answer(ex, taux, 'normal');
    const page = await agent.get(`/exercises/${ex.id}`);
    expect(page.text).not.toContain('data-testid="retry"');
    await agent.post(`/exercises/${ex.id}/retry`);
    expect(await Attempt.countDocuments({ exerciseId: ex._id })).toBe(1);
  });

  it('unknown question keys are 404', async () => {
    const ex = await createExercise({ groupIds: [group._id] });
    expect((await answer(ex, 'b_deadbeef', '1')).status).toBe(404);
  });
});
