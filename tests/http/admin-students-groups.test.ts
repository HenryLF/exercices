import { unzipSync } from 'fflate';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Group } from '../../src/models/group.js';
import { Student } from '../../src/models/student.js';
import { Exercise } from '../../src/models/exercise.js';
import { Attempt } from '../../src/models/attempt.js';
import { loginCode } from '../../src/lib/qr.js';
import { readExport } from '../../public/import-csv.js';
import { purgeStudents } from '../../src/lib/purge.js';
import mongoose from 'mongoose';
import {
  createExercise,
  createGroup,
  createStudent,
  EXPORT_CSV,
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

const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('groups', () => {
  it('creates, refuses duplicates, renames', async () => {
    const res = await admin.post('/admin/groups').type('form').send({ name: '2nde A' });
    expect(res.status).toBe(302);
    const group = await Group.findOne({ name: '2nde A' });
    expect(res.headers.location).toBe(`/admin/groups/${group!.id}`);
    const dup = await admin.post('/admin/groups').type('form').send({ name: '2nde A' });
    expect(dup.status).toBe(400);
    expect(dup.text).toContain('Une classe porte déjà ce nom');
    await admin.post(`/admin/groups/${group!.id}`).type('form').send({ name: '2nde B' });
    expect((await Group.findById(group!._id))!.name).toBe('2nde B');
    expect((await admin.get('/admin/groups')).text).toContain('2nde B');
  });

  it('downloads one PNG per active student in a zip, named after their login', async () => {
    const group = await createGroup('2nde A');
    const alice = await createStudent({ login: 'm.alice', groupId: group._id });
    const bob = await createStudent({ login: 'd.bob', groupId: group._id });
    const gone = await createStudent({ login: 'parti', groupId: group._id });
    await Student.updateOne({ _id: gone.student._id }, { $set: { active: false } });
    const res = await admin.get(`/admin/groups/${group.id}/qr.zip`).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toContain('2nde A-qr.zip');
    const files = unzipSync(new Uint8Array(res.body as Buffer));
    // The PNG has no text: the login and code are in the file name.
    const aliceFile = `m.alice - ${alice.code}.png`;
    expect(Object.keys(files).sort()).toEqual([`d.bob - ${bob.code}.png`, aliceFile]);
    expect([...files[aliceFile]!.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('prints a sheet of QR cards', async () => {
    const group = await createGroup('2nde A');
    const alice = await createStudent({ login: 'm.alice', groupId: group._id });
    const res = await admin.get(`/admin/groups/${group.id}/qr`);
    expect(res.text.match(/data-testid="qr-card"/g)).toHaveLength(1);
    expect(res.text).toContain(`${alice.code.slice(0, 3)}\u00a0${alice.code.slice(3)}`);
    expect(res.text).toContain('data-testid="login-name">m.alice<');
    expect(res.text).toContain('<svg');
  });
});

describe('students', () => {
  it('creates a student in several classes and shows the reusable QR code', async () => {
    const group = await createGroup('A');
    const other = await createGroup('B');
    const res = await admin
      .post('/admin/students')
      .type('form')
      .send(`login=D.Zoe&groupIds=${group.id}&groupIds=${other.id}&groupIds=bogus`);
    const student = await Student.findOne({ login: 'd.zoe' });
    expect(student!.groupIds.map(String).sort()).toEqual([group.id, other.id].sort());
    expect(res.headers.location).toBe(`/admin/students/${student!.id}/qr`);
    const qr1 = await admin.get(res.headers.location!);
    const qr2 = await admin.get(res.headers.location!);
    expect(qr1.text).toContain('<svg');
    const url = /data-testid="login-url">([^<]+)</.exec(qr1.text)![1]!;
    expect(qr2.text).toContain(url);
    const code = loginCode({ id: student!.id as string, qrVersion: student!.qrVersion });
    expect(qr1.text).toContain(
      `data-testid="login-code">${code.slice(0, 3)}\u00a0${code.slice(3)}<`,
    );
    expect(qr1.text).toContain('data-testid="login-name">d.zoe<');
    // The login is all the app keeps about a student.
    expect(Object.keys(student!.toObject())).not.toContain('name');
    expect(student!.toObject()).not.toHaveProperty('dob');
    const png = await admin.get(`/admin/students/${student!.id}/qr.png`).buffer(true).parse(binary);
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.headers['content-disposition']).toContain(
      `filename*=UTF-8''d.zoe%20-%20${code}.png`,
    );
  });

  it('gives a taken login the next free number', async () => {
    await createStudent({ login: 'd.zoe' });
    await createStudent({ login: 'd.zoe2' });
    const res = await admin.post('/admin/students').type('form').send({ login: 'd.zoe' });
    const student = await Student.findOne({ login: 'd.zoe3' });
    expect(res.headers.location).toBe(`/admin/students/${student!.id}/qr`);
    expect((await admin.get(res.headers.location!)).text).toContain(
      'L’identifiant d.zoe était déjà pris\u00a0: l’élève a reçu d.zoe3.',
    );
  });

  it('validates the form and refuses a full name', async () => {
    const res = await admin.post('/admin/students').type('form').send({ login: '' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('L’identifiant est obligatoire');
    const named = await admin.post('/admin/students').type('form').send({ login: 'Zoé Durand' });
    expect(named.status).toBe(400);
    expect(named.text).toContain('Initiale du nom, un point, puis le prénom');
    expect(await Student.countDocuments()).toBe(0);
  });

  it('a student can have no class', async () => {
    await admin.post('/admin/students').type('form').send({ login: 'c.sans' });
    const student = await Student.findOne({ login: 'c.sans' });
    expect(student!.groupIds).toEqual([]);
    const list = await admin.get('/admin/students?group=none');
    expect(list.text).toContain('c.sans');
  });

  it('edits, changes classes, regenerates and deactivates', async () => {
    const a = await createGroup('A');
    const b = await createGroup('B');
    const s = await createStudent({ groupId: a._id });
    await createStudent({ login: 'p.bruno' });
    const phone = request.agent(app);
    await loginAsStudent(phone, s);

    await admin
      .post(`/admin/students/${s.student.id}`)
      .type('form')
      .send(`login=e.martin&groupIds=${a.id}&groupIds=${b.id}`);
    const moved = await Student.findById(s.student._id);
    expect(moved!.login).toBe('e.martin');
    expect(moved!.groupIds.map(String).sort()).toEqual([a.id, b.id].sort());
    expect((await admin.get(`/admin/students/${s.student.id}`)).text).toMatch(
      /data-testid="student-classes">A, B</,
    );
    // Another student's login is refused.
    const taken = await admin
      .post(`/admin/students/${s.student.id}`)
      .type('form')
      .send({ login: 'p.bruno' });
    expect(taken.status).toBe(400);
    expect(taken.text).toContain('Un autre élève a déjà cet identifiant');
    // No box ticked: no class at all.
    await admin.post(`/admin/students/${s.student.id}`).type('form').send({ login: 'e.martin' });
    expect((await Student.findById(s.student._id))!.groupIds).toEqual([]);

    await admin.post(`/admin/students/${s.student.id}/qr`);
    expect((await request(app).get(`/login/${s.token}`)).status).toBe(404);
    expect((await phone.get('/exercises')).headers.location).toBe('/');

    await admin.post(`/admin/students/${s.student.id}/deactivate`);
    expect((await Student.findById(s.student._id))!.active).toBe(false);
    expect((await admin.get(`/admin/students/${s.student.id}/qr`)).headers.location).toBe(
      `/admin/students/${s.student.id}`,
    );
    await admin.post(`/admin/students/${s.student.id}/qr`);
    expect((await Student.findById(s.student._id))!.active).toBe(true);
  });

  it('student detail lists each try with the tooltip flag', async () => {
    const group = await createGroup();
    const s = await createStudent({ groupId: group._id });
    const ex = await createExercise({ groupIds: [group._id] });
    const key = ex.blocks.find((b) => b.type === 'question')!.key;
    await Attempt.create({
      exerciseId: ex._id,
      studentId: s.student._id,
      questions: {
        [key]: {
          solved: true,
          tooltipShown: true,
          tries: [
            { try: 1, tooltip: false, value: 3.5, correct: false, at: new Date() },
            { try: 2, tooltip: true, value: 10, correct: true, at: new Date() },
          ],
        },
      },
    });
    const res = await admin.get(`/admin/students/${s.student.id}`);
    expect(res.text).toContain('Remises');
    expect(res.text).toContain('1. 3,50');
    expect(res.text).toContain('2. 10,00 (indice)');
  });
});

describe('CSV import', () => {
  // What public/import.js posts: the file stays in the browser, only logins are sent.
  const importFile = (agent: Agent, groupId: string, csv: string) =>
    agent
      .post('/admin/students/import')
      .type('form')
      .send({ groupId, payload: JSON.stringify(readExport(csv)) });

  it('imports the sample export into the chosen class', async () => {
    const group = await createGroup('2nde A');
    const res = await importFile(admin, group.id, EXPORT_CSV);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/data-testid="created-count">1</);
    expect(res.text).toMatch(/data-testid="skipped-count">14</);
    const students = await Student.find();
    expect(students.map((s) => [s.login, s.groupIds.map(String)])).toEqual([
      ['m.alice', [group.id]],
    ]);
    expect(Object.keys(students[0]!.toObject())).not.toContain('name');
    // Same file, same class: nothing to ask, nothing to create.
    const again = await importFile(admin, group.id, EXPORT_CSV);
    expect(again.text).toMatch(/data-testid="created-count">0</);
    expect(again.text).toMatch(/data-testid="already-count">1</);
    expect(await Student.countDocuments()).toBe(1);
  });

  it('two pupils with the same login both get created, the second with a number', async () => {
    const group = await createGroup('2nde A');
    await importFile(admin, group.id, 'Élèves\nMARTIN Alice\nMOREAU Alice\n');
    expect((await Student.find().sort({ login: 1 })).map((s) => s.login)).toEqual([
      'm.alice',
      'm.alice2',
    ]);
  });

  it('asks before importing a login that already exists, and reuses the student if chosen', async () => {
    const a = await createGroup('2nde A');
    const b = await createGroup('2nde B');
    const alice = await createStudent({ login: 'm.alice', groupId: a._id });
    const zoe = await createStudent({ login: 'p.zoe' });
    const csv =
      'Élèves,Né(e) le\n' +
      'MARTIN Alice,03/05/2000\n' + // same login: the existing student is suggested
      'PETIT Zoé,02/02/2010\n' +
      'VENU Nouveau,01/01/2010\n';
    const ask = await importFile(admin, b.id, csv);
    expect(ask.text).toContain('data-testid="import-confirm"');
    // Nothing is written before the admin answers.
    expect(await Student.countDocuments()).toBe(2);
    expect(ask.text).toMatch(new RegExp(`value="${alice.student.id}" checked`));
    expect(ask.text).toMatch(new RegExp(`value="${zoe.student.id}" checked`));

    // Keep Alice and Zoé.
    const done = await admin
      .post('/admin/students/import/confirm')
      .type('form')
      .send(`choice[L2]=${alice.student.id}&choice[L3]=${zoe.student.id}`);
    expect(done.status).toBe(200);
    expect(done.text).toMatch(/data-testid="created-count">1</);
    expect(done.text).toMatch(/data-testid="added-count">2</);
    const aliceNow = (await Student.findById(alice.student._id))!;
    expect(aliceNow.groupIds.map(String).sort()).toEqual([a.id, b.id].sort());
    expect(aliceNow.qrVersion).toBe(alice.student.qrVersion); // same QR code
    expect((await Student.findById(zoe.student._id))!.groupIds.map(String)).toEqual([b.id]);
    expect(await Student.countDocuments()).toBe(3);
    expect(await Student.countDocuments({ login: 'v.nouveau', groupIds: b._id })).toBe(1);

    // The draft is used once.
    const replay = await admin.post('/admin/students/import/confirm').type('form').send('');
    expect(replay.headers.location).toBe('/admin/students/import');
    expect(await Student.countDocuments()).toBe(3);
  });

  it('creating a new student for a shared login, or cancelling, are both possible', async () => {
    const a = await createGroup('2nde A');
    const alice = await createStudent({ login: 'm.alice', groupId: a._id });
    const csv = 'Élèves\nMARTIN Alice\n';
    const b = await createGroup('2nde B');
    await importFile(admin, b.id, csv);
    await admin.post('/admin/students/import/cancel');
    expect(await Student.countDocuments()).toBe(1);

    await importFile(admin, b.id, csv);
    await admin.post('/admin/students/import/confirm').type('form').send('choice[L2]=new');
    expect(await Student.countDocuments({ login: 'm.alice2', groupIds: b._id })).toBe(1);
    expect((await Student.findById(alice.student._id))!.groupIds.map(String)).toEqual([a.id]);
  });

  it('an unknown choice falls back to the suggestion', async () => {
    const a = await createGroup('2nde A');
    const b = await createGroup('2nde B');
    const alice = await createStudent({ login: 'm.alice', groupId: a._id });
    await importFile(admin, b.id, 'Élèves\nMARTIN Alice\n');
    await admin
      .post('/admin/students/import/confirm')
      .type('form')
      .send('choice[L2]=0123456789abcdef01234567');
    expect(await Student.countDocuments()).toBe(1);
    expect((await Student.findById(alice.student._id))!.groupIds.map(String).sort()).toEqual(
      [a.id, b.id].sort(),
    );
  });

  it('writes nothing without a class, without logins, or when names are posted', async () => {
    const group = await createGroup();
    const noGroup = await importFile(admin, '', 'Élèves\nMARTIN Alice\n');
    expect(noGroup.status).toBe(400);
    const noPayload = await admin
      .post('/admin/students/import')
      .type('form')
      .send({ groupId: group.id });
    expect(noPayload.status).toBe(400);
    expect(noPayload.text).toContain('activez JavaScript');
    const named = await admin
      .post('/admin/students/import')
      .type('form')
      .send({
        groupId: group.id,
        payload: JSON.stringify({
          rows: [{ line: 2, login: 'MARTIN Alice' }],
          duplicates: [],
          errors: [],
        }),
      });
    expect(named.status).toBe(400);
    expect(await Student.countDocuments()).toBe(0);
  });
});

describe('deleting', () => {
  it('a student, with their attempts, after a confirmation page', async () => {
    const group = await createGroup();
    const s = await createStudent({ groupId: group._id });
    const ex = await createExercise({ groupIds: [group._id] });
    await Attempt.create({ exerciseId: ex._id, studentId: s.student._id });
    const phone = request.agent(app);
    await loginAsStudent(phone, s);

    const confirm = await admin.get(`/admin/students/${s.student.id}/delete`);
    expect(confirm.text).toContain('1 tentative et tous leurs essais seront supprimés.');
    expect(await Student.countDocuments()).toBe(1);
    const res = await admin.post(`/admin/students/${s.student.id}/delete`);
    expect(res.headers.location).toBe('/admin/students');
    expect(await Student.countDocuments()).toBe(0);
    expect(await Attempt.countDocuments()).toBe(0);
    expect((await phone.get('/exercises')).headers.location).toBe('/');
    expect((await request(app).get(`/login/${s.token}`)).status).toBe(404);
  });

  it('a class keeps its students and exercises', async () => {
    const a = await createGroup('A');
    const b = await createGroup('B');
    const both = await createStudent({ login: 'c.deux', groupIds: [a._id, b._id] });
    const onlyA = await createStudent({ login: 'c.une', groupId: a._id });
    const ex = await createExercise({ groupIds: [a._id, b._id] });
    await Attempt.create({ exerciseId: ex._id, studentId: onlyA.student._id });

    const confirm = await admin.get(`/admin/groups/${a.id}/delete`);
    expect(confirm.text).toContain('Ses 2 élèves sont conservés avec leurs résultats');
    expect(confirm.text).toContain('1 n’aura plus aucune classe');
    await admin.post(`/admin/groups/${a.id}/delete`);
    expect(await Group.exists({ _id: a._id })).toBeNull();
    expect((await Student.findById(both.student._id))!.groupIds.map(String)).toEqual([b.id]);
    expect((await Student.findById(onlyA.student._id))!.groupIds).toEqual([]);
    expect((await Exercise.findById(ex._id))!.groupIds.map(String)).toEqual([b.id]);
    expect(await Attempt.countDocuments()).toBe(1);
  });

  it('an exercise, with its attempts', async () => {
    const group = await createGroup();
    const s = await createStudent({ groupId: group._id });
    const ex = await createExercise({ groupIds: [group._id] });
    const other = await createExercise({ name: 'Autre', groupIds: [group._id] });
    await Attempt.create({ exerciseId: ex._id, studentId: s.student._id });
    await Attempt.create({ exerciseId: other._id, studentId: s.student._id });
    const confirm = await admin.get(`/admin/exercises/${ex.id}/delete`);
    expect(confirm.text).toContain('1 tentative d’élèves');
    await admin.post(`/admin/exercises/${ex.id}/delete`);
    expect(await Exercise.countDocuments()).toBe(1);
    expect(await Attempt.countDocuments({ exerciseId: other._id })).toBe(1);
    expect(await Attempt.countDocuments({ exerciseId: ex._id })).toBe(0);
  });

  it('students cannot delete anything', async () => {
    const group = await createGroup();
    const s = await createStudent({ groupId: group._id });
    const ex = await createExercise({ groupIds: [group._id] });
    const student = request.agent(app);
    await loginAsStudent(student, s);
    for (const path of [
      `/admin/students/${s.student.id}/delete`,
      `/admin/groups/${group.id}/delete`,
      `/admin/exercises/${ex.id}/delete`,
    ])
      expect((await student.post(path)).status).toBe(403);
    expect(await Student.countDocuments()).toBe(1);
    expect(await Group.countDocuments()).toBe(1);
    expect(await Exercise.countDocuments()).toBe(1);
  });
});

describe('several classes', () => {
  it('a student sees the exercises of all their classes and appears in both class pages', async () => {
    const a = await createGroup('A');
    const b = await createGroup('B');
    const s = await createStudent({ groupIds: [a._id, b._id] });
    const exA = await createExercise({ name: 'Pour A', groupIds: [a._id] });
    const exB = await createExercise({ name: 'Pour B', groupIds: [b._id] });
    const student = request.agent(app);
    await loginAsStudent(student, s);
    const list = await student.get('/exercises');
    expect(list.text).toContain('Pour A');
    expect(list.text).toContain('Pour B');
    expect((await student.get(`/exercises/${exB.id}`)).status).toBe(200);
    expect((await admin.get(`/admin/groups/${a.id}`)).text).toContain(s.login);
    expect((await admin.get(`/admin/groups/${b.id}`)).text).toContain(s.login);
    expect((await admin.get('/admin/groups')).text).toMatch(/A<\/a><\/td><td class="num">1</);
    const dashboard = await admin.get('/admin');
    expect(dashboard.text).toMatch(/data-testid="completed">0\/2</);
    void exA;
  });
});

describe('dashboard', () => {
  it('shows results per student, filterable by group', async () => {
    const a = await createGroup('A');
    const b = await createGroup('B');
    const alice = await createStudent({ login: 'alice', groupId: a._id });
    await createStudent({ login: 'bruno', groupId: b._id });
    const ex = await createExercise({ groupIds: [a._id, b._id] });
    const key = ex.blocks.find((x) => x.type === 'question')!.key;
    await Attempt.create({
      exerciseId: ex._id,
      studentId: alice.student._id,
      status: 'completed',
      questions: {
        [key]: {
          solved: true,
          tooltipShown: true,
          tries: [{ try: 1, tooltip: true, value: 10, correct: true, at: new Date() }],
        },
      },
    });
    const res = await admin.get('/admin');
    expect(res.text.indexOf('>alice<')).toBeLessThan(res.text.indexOf('>bruno<'));
    expect(res.text).toMatch(/data-testid="completed">1\/1</);
    expect(res.text).toMatch(/data-testid="tooltips">1</);
    const filtered = await admin.get(`/admin?group=${b.id}`);
    expect(filtered.text).toContain('>bruno<');
    expect(filtered.text).not.toContain('>alice<');
  });
});

describe('delete wording', () => {
  it('uses the singular for a class with one student', async () => {
    const admin = request.agent(app);
    await loginAsAdmin(admin);
    const a = await createGroup('A');
    await createStudent({ groupId: a._id });
    const page = await admin.get(`/admin/groups/${a.id}/delete`);
    expect(page.text).toContain(
      'Son élève est conservé avec ses résultats\u00a0; il n’aura plus aucune classe.',
    );
  });
});

describe('end-of-year purge', () => {
  it('counts on a dry run, then deletes students, attempts and student sessions only', async () => {
    const group = await createGroup();
    const s = await createStudent({ groupId: group._id });
    const ex = await createExercise({ groupIds: [group._id] });
    await Attempt.create({ exerciseId: ex._id, studentId: s.student._id });
    // Sessions go to this file's own database, so other test files are untouched.
    const db = mongoose.connection.db!;
    await db.collection<{ _id: string; session: string }>('sessions').insertMany([
      { _id: 'st', session: JSON.stringify({ role: 'student', userId: s.student.id }) },
      { _id: 'ad', session: JSON.stringify({ role: 'admin', userId: 'x' }) },
    ]);

    const dry = await purgeStudents(db, { withGroups: false, dryRun: true });
    expect(dry).toEqual({ students: 1, attempts: 1, sessions: 1, groups: 0 });
    expect(await Student.countDocuments()).toBe(1);

    const done = await purgeStudents(db, { withGroups: false, dryRun: false });
    expect(done).toEqual({ students: 1, attempts: 1, sessions: 1, groups: 0 });
    expect(await Student.countDocuments()).toBe(0);
    expect(await Attempt.countDocuments()).toBe(0);
    expect(await db.collection('sessions').countDocuments()).toBe(1);
    expect(await Group.countDocuments()).toBe(1);
    expect(await Exercise.countDocuments()).toBe(1);

    const withGroups = await purgeStudents(db, { withGroups: true, dryRun: false });
    expect(withGroups.groups).toBe(1);
    expect((await Exercise.findById(ex._id))!.groupIds).toEqual([]);
  });
});
