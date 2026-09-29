import mongoose from 'mongoose';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { Student } from '../../src/models/student.js';
import { SESSION_COOKIE } from '../../src/auth/session.js';
import {
  ADMIN,
  createAdmin,
  createGroup,
  createStudent,
  loginAsAdmin,
  loginAsStudent,
  makeApp,
} from '../helpers.js';

let app: ReturnType<typeof makeApp>;
beforeAll(() => {
  app = makeApp();
});

const sessionId = (res: request.Response): string => {
  const cookie = [res.headers['set-cookie']]
    .flat()
    .find((c) => c?.startsWith(`${SESSION_COOKIE}=`));
  return cookie?.split(';')[0] ?? '';
};

describe('public', () => {
  it('healthz and welcome', async () => {
    expect((await request(app).get('/healthz')).body).toEqual({ ok: true, db: 'up' });
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('scannez le QR code');
  });

  it('sets a strict CSP and a referrer policy that keeps Origin on posts', async () => {
    const res = await request(app).get('/');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('refuses cross-site posts', async () => {
    const res = await request(app)
      .post('/admin/login')
      .set('Origin', 'https://evil.test')
      .type('form')
      .send(ADMIN);
    expect(res.status).toBe(403);
  });
});

describe('admin login', () => {
  it('logs in and out', async () => {
    const agent = request.agent(app);
    await loginAsAdmin(agent);
    expect((await agent.get('/admin')).status).toBe(200);
    await agent.post('/logout');
    expect((await agent.get('/admin')).headers.location).toBe('/admin/login');
  });

  it('refuses a wrong password', async () => {
    await createAdmin();
    const res = await request(app)
      .post('/admin/login')
      .type('form')
      .send({ ...ADMIN, password: 'nope' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('Identifiant ou mot de passe incorrect');
  });

  it('rate-limits login posts', async () => {
    const limited = makeApp({ loginLimit: 2 });
    for (let i = 0; i < 2; i++)
      await request(limited)
        .post('/admin/login')
        .type('form')
        .send({ username: 'x', password: 'y' });
    expect(
      (
        await request(limited)
          .post('/admin/login')
          .type('form')
          .send({ username: 'x', password: 'y' })
      ).status,
    ).toBe(429);
  });
});

describe('student QR login', () => {
  it('unknown, malformed or forged tokens are 404', async () => {
    const s = await createStudent();
    expect((await request(app).get('/login/nope')).status).toBe(404);
    expect(
      (
        await request(app).get(
          `/login/${new mongoose.Types.ObjectId().toString()}.${'a'.repeat(43)}`,
        )
      ).status,
    ).toBe(404);
    expect((await request(app).get(`/login/${s.student.id}.${'a'.repeat(43)}`)).status).toBe(404);
    expect((await request(app).get(`/login/${s.token}`)).status).toBe(200);
  });

  it('checks the code; counts failures; locks after 5', async () => {
    const s = await createStudent();
    const wrongCode = s.code === '000000' ? '000001' : '000000';
    const bad = await request(app).post(`/login/${s.token}`).type('form').send({ code: wrongCode });
    expect(bad.status).toBe(400);
    expect(bad.text).toContain('Ce code ne correspond pas');
    expect((await Student.findById(s.student._id))!.failedAttempts).toBe(1);
    for (let i = 0; i < 3; i++)
      await request(app).post(`/login/${s.token}`).type('form').send({ code: wrongCode });
    const fifth = await request(app)
      .post(`/login/${s.token}`)
      .type('form')
      .send({ code: wrongCode });
    expect(fifth.status).toBe(429);
    const locked = await request(app).post(`/login/${s.token}`).type('form').send({ code: s.code });
    expect(locked.status).toBe(429);
  });

  it('the same QR code works on several devices at once, for 30 days', async () => {
    const s = await createStudent();
    const phone = request.agent(app);
    const laptop = request.agent(app);
    const res = await phone
      .post(`/login/${s.token}`)
      .type('form')
      .send({ code: ` ${s.code.slice(0, 3)} ${s.code.slice(3)} ` });
    expect(res.headers.location).toBe('/exercises/next');
    expect([res.headers['set-cookie']].flat().join()).toMatch(/Expires=/);
    await loginAsStudent(laptop, s);
    expect((await phone.get('/exercises')).status).toBe(200);
    expect((await laptop.get('/exercises')).status).toBe(200);
    // Scanning again while signed in skips the form.
    expect((await phone.get(`/login/${s.token}`)).headers.location).toBe('/exercises/next');
  });

  it('a new QR code kills the old one and every session', async () => {
    const s = await createStudent();
    const phone = request.agent(app);
    await loginAsStudent(phone, s);
    await Student.updateOne({ _id: s.student._id }, { $inc: { qrVersion: 1, authVersion: 1 } });
    expect((await phone.get('/exercises')).headers.location).toBe('/');
    expect((await request(app).get(`/login/${s.token}`)).status).toBe(404);
  });

  it('deactivation logs out and disables the QR code', async () => {
    const s = await createStudent();
    const phone = request.agent(app);
    await loginAsStudent(phone, s);
    await Student.updateOne(
      { _id: s.student._id },
      { $set: { active: false }, $inc: { authVersion: 1 } },
    );
    expect((await phone.get('/exercises')).headers.location).toBe('/');
    expect((await request(app).get(`/login/${s.token}`)).status).toBe(404);
  });
});

describe('daily session renewal', () => {
  it('issues a new session id and cookie after a day, not before', async () => {
    const group = await createGroup();
    const s = await createStudent({ groupId: group._id });
    const agent = request.agent(app);
    const login = await agent.post(`/login/${s.token}`).type('form').send({ code: s.code });
    const first = sessionId(login);
    expect(first).not.toBe('');

    // One hour later: same session, no new cookie beyond the rolling refresh of the same id.
    const soon = await agent.get('/exercises');
    expect(sessionId(soon) === '' || sessionId(soon) === first).toBe(true);

    // Age the session: renewedAt 25 hours ago.
    const sid = decodeURIComponent(first.split('=')[1]!).slice(2).split('.')[0]!;
    // connect-mongo writes to the client's default database, not the per-file test database.
    const sessions = mongoose.connection
      .getClient()
      .db()
      .collection<{ _id: string; session: string }>('sessions');
    const doc = await sessions.findOne({ _id: sid });
    const data = JSON.parse(doc!.session) as { renewedAt: number };
    data.renewedAt = Date.now() - 25 * 60 * 60 * 1000;
    await sessions.updateOne({ _id: sid }, { $set: { session: JSON.stringify(data) } });

    const later = await agent.get('/exercises');
    expect(later.status).toBe(200);
    const renewed = sessionId(later);
    expect(renewed).not.toBe('');
    expect(renewed).not.toBe(first);
    expect(await sessions.findOne({ _id: sid })).toBeNull();
    expect((await Student.findById(s.student._id))!.lastSeenAt).toBeInstanceOf(Date);
    // Still signed in with the new cookie.
    expect((await agent.get('/exercises')).status).toBe(200);
  });
});

describe('roles', () => {
  it('students cannot open admin pages and admins cannot open student pages', async () => {
    const s = await createStudent();
    const student = request.agent(app);
    await loginAsStudent(student, s);
    for (const path of [
      '/admin',
      '/admin/students',
      '/admin/groups',
      '/admin/exercises',
      '/admin/help',
    ])
      expect((await student.get(path)).status).toBe(403);
    const admin = request.agent(app);
    await loginAsAdmin(admin);
    expect((await admin.get('/exercises')).status).toBe(403);
    expect((await request(app).get('/exercises')).headers.location).toBe('/');
    expect((await request(app).get('/admin/exercises')).headers.location).toBe('/admin/login');
    expect((await request(app).get('/admin/help')).headers.location).toBe('/admin/login');
  });

  it('admins have a help page linked from the menu, with the privacy section', async () => {
    const admin = request.agent(app);
    await loginAsAdmin(admin);
    expect((await admin.get('/admin')).text).toContain('href="/admin/help"');
    const res = await admin.get('/admin/help');
    expect(res.status).toBe(200);
    expect(res.text).toContain('id="confidentialite"');
    expect(res.text).toContain('Confidentialité et sécurité');
  });
});
