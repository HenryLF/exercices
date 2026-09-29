import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Attempt, questionStates } from '../../src/models/attempt.js';
import { Exercise, plainBlocks } from '../../src/models/exercise.js';
import { questionBlocks } from '../../src/lib/blocks.js';
import { blocksFor } from '../../src/lib/content.js';
import {
  createExercise,
  createGroup,
  createStudent,
  editorForm,
  loginAsAdmin,
  loginAsStudent,
  makeApp,
  type Agent,
} from '../helpers.js';

let app: ReturnType<typeof makeApp>;
beforeAll(() => {
  app = makeApp();
});

let admin: Agent;
beforeEach(async () => {
  admin = request.agent(app);
  await loginAsAdmin(admin);
});

const rows: Record<string, string>[] = [
  { type: 'markdown', body: 'Lisez **bien**' },
  { type: 'given', label: 'Prix', amount: '100' },
  {
    type: 'question',
    label: 'Remise',
    hint: '10 %',
    answerType: 'number',
    value: '10',
    decimals: '2',
    tolerance: '0',
    unit: '€',
    tooltip: 'Aide',
  },
  {
    type: 'question',
    label: 'Taux',
    answerType: 'enum',
    options: 'normal\nréduit',
    value: 'normal',
  },
];

describe('custom exercises', () => {
  it('creates one with the three block types', async () => {
    const res = await admin
      .post('/admin/exercises')
      .type('form')
      .send(editorForm('Mon exercice', rows));
    expect(res.status).toBe(302);
    const ex = await Exercise.findOne({ name: 'Mon exercice' });
    expect(ex).toMatchObject({ kind: 'custom', status: 'draft' });
    expect(plainBlocks(ex!).map((b) => b.type)).toEqual([
      'markdown',
      'given',
      'question',
      'question',
    ]);
    expect((await admin.get(res.headers.location!)).text).toContain('Mon exercice');
  });

  it('refuses a duplicate name and invalid blocks, keeping the values', async () => {
    await createExercise({ name: 'Pris' });
    const dup = await admin.post('/admin/exercises').type('form').send(editorForm('Pris', rows));
    expect(dup.status).toBe(400);
    expect(dup.text).toContain('Un exercice porte déjà ce nom');
    const bad = await admin
      .post('/admin/exercises')
      .type('form')
      .send(
        editorForm('Nouveau', [
          { type: 'question', label: 'Q', answerType: 'number', value: 'dix' },
        ]),
      );
    expect(bad.status).toBe(400);
    expect(bad.text).toContain('Bloc 1');
    expect(bad.text).toContain('value="dix"');
  });

  it('applies the edit rules once students have started', async () => {
    const ex = await createExercise();
    const [remise, taux] = questionBlocks(plainBlocks(ex));
    const student = await createStudent();
    await Attempt.create({ exerciseId: ex._id, studentId: student.student._id });
    const removal = await admin
      .post(`/admin/exercises/${ex.id}`)
      .type('form')
      .send(
        editorForm('Remises', [
          {
            key: remise!.key,
            type: 'question',
            label: 'Remise',
            answerType: 'number',
            value: '11',
          },
        ]),
      );
    expect(removal.status).toBe(400);
    expect(removal.text).toContain('ne peut pas être supprimée');
    const ok = await admin
      .post(`/admin/exercises/${ex.id}`)
      .type('form')
      .send(
        editorForm('Remises v2', [
          {
            key: taux!.key,
            type: 'question',
            label: 'Taux',
            answerType: 'enum',
            options: 'normal\nréduit',
            value: 'réduit',
          },
          {
            key: remise!.key,
            type: 'question',
            label: 'Remise corrigée',
            answerType: 'number',
            value: '11',
          },
        ]),
      );
    expect(ok.status).toBe(302);
    const saved = questionBlocks(plainBlocks((await Exercise.findById(ex._id))!));
    expect(saved.map((q) => q.key)).toEqual([taux!.key, remise!.key]);
    expect(saved[1]).toMatchObject({ label: 'Remise corrigée', answer: { value: 11 } });
  });

  it('preview shows expected answers and tooltips and records nothing', async () => {
    const ex = await createExercise();
    const res = await admin.get(`/admin/exercises/${ex.id}/preview`);
    expect(res.text).toContain('value="10,00"');
    expect(res.text).toContain('<em>Exemple</em>');
    expect(await Attempt.countDocuments()).toBe(0);
  });
});

describe('class page assignment', () => {
  it('assigns from the class, opens drafts, sets the order, and unassigns', async () => {
    const group = await createGroup('2nde A');
    const other = await createGroup('2nde B');
    const s = await createStudent({ groupId: group._id });
    const draft = await createExercise({
      name: 'Brouillon',
      status: 'draft',
      groupIds: [other._id],
    });
    const open = await createExercise({ name: 'Ouvert' });
    const student = request.agent(app);
    await loginAsStudent(student, s);
    expect((await student.get(`/exercises/${draft.id}`)).status).toBe(403);

    const page = await admin.get(`/admin/groups/${group.id}`);
    expect(page.text.match(/data-testid="assign-row"/g)).toHaveLength(2);
    const res = await admin
      .post(`/admin/groups/${group.id}/exercises`)
      .type('form')
      .send(
        `assigned=${draft.id}&assigned=${open.id}&position[${draft.id}]=2&position[${open.id}]=1`,
      );
    expect(res.headers.location).toBe(`/admin/groups/${group.id}#exercises`);
    const d = (await Exercise.findById(draft._id))!;
    expect(d.status).toBe('open');
    expect(d.groupIds.map(String).sort()).toEqual([group.id, other.id].sort());
    expect(d.position).toBe(2);
    expect((await student.get('/exercises/next')).headers.location).toBe(`/exercises/${open.id}`);
    expect((await student.get(`/exercises/${draft.id}`)).status).toBe(200);

    await admin
      .post(`/admin/groups/${group.id}/exercises`)
      .type('form')
      .send(`assigned=${open.id}`);
    expect((await Exercise.findById(draft._id))!.groupIds.map(String)).toEqual([other.id]);
    expect((await student.get(`/exercises/${draft.id}`)).status).toBe(403);
  });

  it('status buttons still work on the exercise page', async () => {
    const ex = await createExercise({ status: 'open' });
    await admin.post(`/admin/exercises/${ex.id}/status`).type('form').send({ status: 'closed' });
    expect((await Exercise.findById(ex._id))!.status).toBe('closed');
  });
});

describe('exercise list assignment grid', () => {
  it('assigns and unassigns classes per exercise, opening drafts', async () => {
    const a = await createGroup('A');
    const b = await createGroup('B');
    const s = await createStudent({ groupId: b._id });
    const draft = await createExercise({ name: 'Brouillon', status: 'draft', groupIds: [a._id] });
    const open = await createExercise({ name: 'Ouvert', groupIds: [a._id] });

    const list = await admin.get('/admin/exercises');
    expect(list.text.match(/data-testid="group-column"/g)).toHaveLength(2);
    expect(list.text).toContain(`value="${draft.id}:${a.id}" aria-label="Brouillon — A" checked`);
    expect(list.text).toContain(`href="/admin/exercises/${open.id}/delete"`);

    const res = await admin
      .post('/admin/exercises/assign')
      .type('form')
      .send(
        [
          `shown=${draft.id}`,
          `shown=${open.id}`,
          `a=${draft.id}:${b.id}`, // draft: A -> B
          `a=${open.id}:${a.id}`, // open: keeps A
          `a=${open.id}:0123456789abcdef01234567`, // unknown class: ignored
          `a=nonsense`,
        ].join('&'),
      );
    expect(res.headers.location).toBe('/admin/exercises');
    const d = (await Exercise.findById(draft._id))!;
    expect(d.groupIds.map(String)).toEqual([b.id]);
    expect(d.status).toBe('open');
    expect((await Exercise.findById(open._id))!.groupIds.map(String)).toEqual([a.id]);

    const student = request.agent(app);
    await loginAsStudent(student, s);
    expect((await student.get(`/exercises/${draft.id}`)).status).toBe(200);

    // Nothing ticked for the draft: it leaves every class.
    await admin.post('/admin/exercises/assign').type('form').send(`shown=${draft.id}`);
    expect((await Exercise.findById(draft._id))!.groupIds).toEqual([]);
  });

  it('leaves exercises that were not on the submitted page alone', async () => {
    const a = await createGroup('A');
    const shown = await createExercise({ name: 'Affiché', groupIds: [a._id] });
    const later = await createExercise({ name: 'Créé entre-temps', groupIds: [a._id] });
    await admin.post('/admin/exercises/assign').type('form').send(`shown=${shown.id}`);
    expect((await Exercise.findById(shown._id))!.groupIds).toEqual([]);
    expect((await Exercise.findById(later._id))!.groupIds.map(String)).toEqual([a.id]);
  });

  it('is admin only', async () => {
    const a = await createGroup('A');
    const ex = await createExercise();
    const s = await createStudent({ groupId: a._id });
    const student = request.agent(app);
    await loginAsStudent(student, s);
    const res = await student
      .post('/admin/exercises/assign')
      .type('form')
      .send(`shown=${ex.id}&a=${ex.id}:${a.id}`);
    expect(res.status).toBe(403);
    expect((await Exercise.findById(ex._id))!.groupIds).toEqual([]);
  });
});

describe('generated exercises', () => {
  it('creates one template, asking every line by default', async () => {
    expect((await admin.get('/admin/exercises/generate')).text).toContain(
      'data-testid="generator-billing"',
    );
    const form = await admin.get('/admin/exercises/generate/billing');
    expect(form.text.match(/<select name="lines\[/g)).toHaveLength(12);
    expect(form.text).toMatch(/name="allowRetry" checked/);
    expect(form.text).toMatch(/data-testid="allow-retry">\s*Infini\s*</);
    expect((await admin.get('/admin/exercises/generate/nope')).status).toBe(404);
    const res = await admin
      .post('/admin/exercises/generate/billing')
      .type('form')
      .send({ allowRetry: 'on' });
    const ex = (await Exercise.findOne())!;
    expect(res.headers.location).toBe(`/admin/exercises/${ex.id}`);
    expect(ex).toMatchObject({
      name: 'Calculs commerciaux',
      kind: 'billing',
      status: 'draft',
      allowRetry: true,
    });
    expect(ex.blocks).toHaveLength(0);
    expect(Object.values(ex.generated?.params.lines)).toEqual(Array(12).fill('ask'));
    await admin.post('/admin/exercises/generate/billing').type('form').send({});
    await admin.post('/admin/exercises/generate/billing').type('form').send({ name: 'Révisions' });
    const all = await Exercise.find().sort({ createdAt: 1 });
    expect(all.map((e) => e.name)).toEqual([
      'Calculs commerciaux',
      'Calculs commerciaux – 2',
      'Révisions',
    ]);
    // Unticked checkbox: no retries.
    expect(all[1]!.allowRetry).toBe(false);
    const page = await admin.get(`/admin/exercises/${ex.id}`);
    expect(page.text).toContain('12 questions.');
  });

  it('refuses a duplicate name', async () => {
    await createExercise({ name: 'Pris' });
    const dup = await admin
      .post('/admin/exercises/generate/billing')
      .type('form')
      .send({ name: 'Pris' });
    expect(dup.status).toBe(400);
    expect(dup.text).toContain('Un exercice porte déjà ce nom');
    expect(await Exercise.countDocuments()).toBe(1);
  });

  it('the name and retry option stay editable after students start', async () => {
    await admin.post('/admin/exercises/generate/billing').type('form').send({ allowRetry: 'on' });
    const ex = (await Exercise.findOne())!;
    const s = await createStudent();
    await Attempt.create({ exerciseId: ex._id, studentId: s.student._id, seed: 'abc' });
    await admin.post(`/admin/exercises/${ex.id}`).type('form').send({ name: 'Renommé' });
    const after = (await Exercise.findById(ex._id))!;
    expect(after.name).toBe('Renommé');
    expect(after.allowRetry).toBe(false);
  });

  it('lines can be asked, given or hidden; unsolvable settings are refused', async () => {
    const bad = await admin
      .post('/admin/exercises/generate/billing')
      .type('form')
      .send('lines[remise]=hide&lines[marge]=give');
    expect(bad.status).toBe(400);
    expect(bad.text).toContain('data-testid="error-lines"');
    expect(bad.text).toContain('Prix d’achat net');
    // The admin's choices are kept in the form.
    expect(bad.text).toMatch(/data-testid="line-remise">[\s\S]*?<option value="hide" selected/);
    expect(await Exercise.countDocuments()).toBe(0);

    await admin
      .post('/admin/exercises/generate/billing')
      .type('form')
      .send('lines[remise]=give&lines[net]=hide&lines[tauxMarque]=hide');
    const ex = (await Exercise.findOne())!;
    expect(ex.generated?.params.lines).toMatchObject({
      remise: 'give',
      net: 'hide',
      tauxMarque: 'hide',
      coef: 'ask',
    });
    const page = await admin.get(`/admin/exercises/${ex.id}`);
    expect(page.text).toContain('9 questions, 1 donnée, 2 lignes masquées.');
    const preview = await admin.get(`/admin/exercises/${ex.id}/preview`);
    expect(preview.text).not.toContain('Prix d’achat net');
    expect(preview.text).not.toContain('Taux de marque');
    expect(questionBlocks(blocksFor(ex, 'any-seed'))).toHaveLength(9);

    // Settings stay editable until the first attempt, then are locked.
    await admin
      .post(`/admin/exercises/${ex.id}`)
      .type('form')
      .send('name=Remises&lines[remise]=ask');
    expect((await Exercise.findById(ex._id))!.generated?.params.lines.remise).toBe('ask');
    const s = await createStudent();
    await Attempt.create({ exerciseId: ex._id, studentId: s.student._id, seed: 'abc' });
    await admin
      .post(`/admin/exercises/${ex.id}`)
      .type('form')
      .send('name=Remises&lines[remise]=hide');
    expect((await Exercise.findById(ex._id))!.generated?.params.lines.remise).toBe('ask');
  });

  it('preview draws new numbers on each load', async () => {
    await admin.post('/admin/exercises/generate/billing').type('form').send({});
    const ex = (await Exercise.findOne())!;
    const a = /data-testid="seed">([0-9a-f]+)</.exec(
      (await admin.get(`/admin/exercises/${ex.id}/preview`)).text,
    )![1];
    const b = /data-testid="seed">([0-9a-f]+)</.exec(
      (await admin.get(`/admin/exercises/${ex.id}/preview`)).text,
    )![1];
    expect(a).not.toBe(b);
  });

  it('preview shows a chosen seed with that draw’s expected answers', async () => {
    await admin.post('/admin/exercises/generate/billing').type('form').send({});
    const ex = (await Exercise.findOne())!;
    const res = await admin.get(`/admin/exercises/${ex.id}/preview?seed=0b9afa45e0e30be8`);
    expect(res.text).toContain('data-testid="seed-form"');
    expect(res.text).toContain('name="seed" value="0b9afa45e0e30be8"');
    // Same numbers as a student attempt with this seed: every expected value is on the page.
    for (const q of questionBlocks(blocksFor(ex, '0b9afa45e0e30be8'))) {
      const v =
        q.answer.type === 'number' ? q.answer.value.toFixed(2).replace('.', ',') : q.answer.value;
      expect(res.text).toContain(`value="${v.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f')}"`);
    }
    // Stable: loading it again gives the same table (the first load also carried a flash message).
    const table = (html: string) => html.slice(html.indexOf('<table class="ex-table">'));
    const again = await admin.get(`/admin/exercises/${ex.id}/preview?seed=0b9afa45e0e30be8`);
    expect(table(again.text)).toBe(table(res.text));
    const bad = await admin.get(
      `/admin/exercises/${ex.id}/preview?seed=${encodeURIComponent('<x>')}`,
    );
    expect(bad.status).toBe(200);
    expect(bad.text).toContain('data-testid="seed-error"');
    expect(bad.text).not.toContain('<x>');
  });

  it('custom exercises have no seed form', async () => {
    const ex = await createExercise();
    const res = await admin.get(`/admin/exercises/${ex.id}/preview?seed=abc`);
    expect(res.text).not.toContain('data-testid="seed-form"');
  });

  it('a student solves it, retries with new numbers, and every seed is recorded', async () => {
    const group = await createGroup();
    const s = await createStudent({ groupId: group._id });
    await admin.post('/admin/exercises/generate/billing').type('form').send({ allowRetry: 'on' });
    const ex = (await Exercise.findOne())!;
    await admin.post(`/admin/groups/${group.id}/exercises`).type('form').send({ assigned: ex.id });
    const student = request.agent(app);
    await loginAsStudent(student, s);
    expect((await student.get('/exercises/next')).headers.location).toBe(`/exercises/${ex.id}`);

    const solve = async (withWrongFirst: boolean) => {
      await student.get(`/exercises/${ex.id}`);
      const attempt = (await Attempt.findOne({ exerciseId: ex._id }).sort({ startedAt: -1 }))!;
      const questions = questionBlocks(blocksFor(ex, attempt.seed));
      let last: request.Response | undefined;
      for (const [i, q] of questions.entries()) {
        if (withWrongFirst && i === 0)
          await student
            .post(`/exercises/${ex.id}/questions/${q.key}`)
            .type('form')
            .send({ value: '999999' });
        const v =
          q.answer.type === 'number' ? String(q.answer.value).replace('.', ',') : q.answer.value;
        last = await student
          .post(`/exercises/${ex.id}/questions/${q.key}`)
          .type('form')
          .send({ value: v });
      }
      expect(last!.headers.location).toBe(`/exercises/${ex.id}?done=1`);
      return attempt.seed;
    };

    const seed1 = await solve(true);
    const done = await student.get(`/exercises/${ex.id}?done=1`);
    expect(done.text).toContain('data-testid="retry"');
    // Finished once: /next no longer sends the student back here.
    expect((await student.get('/exercises/next')).headers.location).toBe('/exercises');

    await student.post(`/exercises/${ex.id}/retry`);
    await student.post(`/exercises/${ex.id}/retry`); // a second click doesn't start a third seed
    const seed2 = await solve(false);
    expect(seed2).not.toBe(seed1);

    const attempts = await Attempt.find({ exerciseId: ex._id }).sort({ startedAt: 1 }).lean();
    expect(attempts.map((a) => [a.seed, a.status])).toEqual([
      [seed1, 'completed'],
      [seed2, 'completed'],
    ]);
    const first = questionStates(attempts[0])['b_00000003']!;
    expect(first.tries.map((t) => t.correct)).toEqual([false, true]);

    const list = await student.get('/exercises');
    expect(list.text).toContain('Terminé ×2');
    const results = await admin.get(`/admin/exercises/${ex.id}/results`);
    expect(results.text.match(/data-testid="result-row"/g)).toHaveLength(2);
    expect(results.text).toContain(seed1!);
    // Every displayed seed links to the preview of that draw.
    expect(results.text).toContain(`href="/admin/exercises/${ex.id}/preview?seed=${seed1}"`);
    const detail = await admin.get(`/admin/students/${s.student.id}`);
    expect(detail.text.match(/data-testid="seed"/g)).toHaveLength(2);
    expect(detail.text).toContain(`href="/admin/exercises/${ex.id}/preview?seed=${seed2}"`);
  });

  it('with retries disabled, a finished student cannot start again', async () => {
    const group = await createGroup();
    const s = await createStudent({ groupId: group._id });
    await admin.post('/admin/exercises/generate/billing').type('form').send({});
    const ex = (await Exercise.findOne())!;
    expect(ex.allowRetry).toBe(false);
    await admin.post(`/admin/groups/${group.id}/exercises`).type('form').send({ assigned: ex.id });
    const student = request.agent(app);
    await loginAsStudent(student, s);
    await student.get(`/exercises/${ex.id}`);
    const attempt = (await Attempt.findOne({ exerciseId: ex._id }))!;
    for (const q of questionBlocks(blocksFor(ex, attempt.seed))) {
      const v =
        q.answer.type === 'number' ? String(q.answer.value).replace('.', ',') : q.answer.value;
      await student.post(`/exercises/${ex.id}/questions/${q.key}`).type('form').send({ value: v });
    }
    const done = await student.get(`/exercises/${ex.id}?done=1`);
    expect(done.text).toContain('data-testid="done"');
    expect(done.text).not.toContain('data-testid="retry"');
    await student.post(`/exercises/${ex.id}/retry`);
    expect(await Attempt.countDocuments({ exerciseId: ex._id })).toBe(1);
    const list = await student.get('/exercises');
    expect(list.text).not.toContain('S’entraîner encore');
  });
});

describe('results export', () => {
  it('exports a CSV per exercise with French headers, BOM and oui/non columns', async () => {
    const group = await createGroup('2nde A');
    const s = await createStudent({ login: 'm.elodie', groupId: group._id });
    await createStudent({ login: 'p.bruno', groupId: group._id });
    const ex = await createExercise({ groupIds: [group._id] });
    const [remise] = questionBlocks(plainBlocks(ex));
    await Attempt.create({
      exerciseId: ex._id,
      studentId: s.student._id,
      questions: {
        [remise!.key]: {
          solved: true,
          tooltipShown: true,
          tries: [{ try: 1, tooltip: true, value: 10, correct: true, at: new Date() }],
        },
      },
    });
    const res = await admin.get(`/admin/exercises/${ex.id}/export.csv`);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    const lines = res.text.slice(1).trim().split('\n');
    expect(lines[0]).toBe(
      'Élève,Classe,Tirage,Statut,Questions résolues,Commencé le (UTC),Terminé le (UTC),Remise – essais,Remise – indice,Remise – résolu,Taux – essais,Taux – indice,Taux – résolu',
    );
    expect(lines).toHaveLength(3);
    expect(lines.find((l) => l.startsWith('m.elodie'))).toMatch(
      /^m\.elodie,2nde A,,En cours,1,.+,,1,oui,oui,0,non,non$/,
    );
    expect(lines.find((l) => l.startsWith('p.bruno'))).toBe(
      'p.bruno,2nde A,,À faire,0,,,0,non,non,0,non,non',
    );
  });
});
