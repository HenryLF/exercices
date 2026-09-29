import type mongoose from 'mongoose';
import request from 'supertest';
import { expect } from 'vitest';
import { createApp, type AppOptions } from '../src/create-app.js';
import { upsertAdmin } from '../src/auth/admin-login.js';
import { Exercise } from '../src/models/exercise.js';
import { Group } from '../src/models/group.js';
import { Student } from '../src/models/student.js';
import { withKeys, type NewBlock } from '../src/lib/blocks.js';
import { loginCode, loginToken } from '../src/lib/qr.js';

export type Agent = ReturnType<typeof request.agent>;

/** Call inside beforeAll/it: the database connection is opened by tests/setup.ts. */
export function makeApp(options: AppOptions = {}) {
  return createApp({ loginLimit: 1000, ...options });
}

export const ADMIN = { username: 'admin', password: 'correct-horse-battery' };

export async function createAdmin() {
  return upsertAdmin(ADMIN.username, ADMIN.password);
}

export async function loginAsAdmin(agent: Agent) {
  await createAdmin();
  const res = await agent.post('/admin/login').type('form').send(ADMIN);
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('/admin');
}

/** Same shape as the school software's export: a header, then one pupil repeated 15 times. */
export const EXPORT_CSV =
  'Élèves,Né(e) le,Classe de rattachement,Sexe\n' + 'Alice Martin,03/05/2000,,F\n'.repeat(15);

export async function createGroup(name = '2nde MRC') {
  return Group.create({ name });
}

export async function createStudent(
  opts: {
    login?: string;
    /** Shortcut for one class. */
    groupId?: mongoose.Types.ObjectId | null;
    groupIds?: mongoose.Types.ObjectId[];
  } = {},
) {
  const login = opts.login ?? 'm.elodie';
  const groupIds = opts.groupIds ?? (opts.groupId ? [opts.groupId] : []);
  const student = await Student.create({ login, groupIds });
  const ref = { id: student.id as string, qrVersion: student.qrVersion };
  return { student, token: loginToken(ref), login, code: loginCode(ref) };
}

export async function loginAsStudent(agent: Agent, s: { token: string; code: string }) {
  const res = await agent.post(`/login/${s.token}`).type('form').send({ code: s.code });
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('/exercises/next');
}

export const sampleBlocks: NewBlock[] = [
  { type: 'markdown', body: 'Consigne **importante**' },
  { type: 'given', label: 'Prix d’achat brut', amount: 100, unit: '€' },
  {
    type: 'question',
    label: 'Remise',
    hint: '10 %',
    tooltip: '*Exemple* : 200 − 20',
    answer: { type: 'number', value: 10, decimals: 2, tolerance: 0, unit: '€' },
  },
  {
    type: 'question',
    label: 'Taux',
    answer: { type: 'enum', options: ['normal', 'réduit'], value: 'normal' },
  },
];

export async function createExercise(
  opts: {
    name?: string;
    status?: 'draft' | 'open' | 'closed';
    groupIds?: mongoose.Types.ObjectId[];
    position?: number;
    blocks?: NewBlock[];
  } = {},
) {
  return Exercise.create({
    name: opts.name ?? 'Remises',
    kind: 'custom',
    status: opts.status ?? 'open',
    position: opts.position ?? 0,
    groupIds: opts.groupIds ?? [],
    blocks: withKeys(opts.blocks ?? sampleBlocks),
  });
}

/** Encodes the exercise editor form the way the browser sends it. */
export function editorForm(name: string, rows: Record<string, string | undefined>[]): string {
  const parts = [`name=${encodeURIComponent(name)}`];
  rows.forEach((r, i) => {
    for (const [k, v] of Object.entries(r))
      if (v !== undefined)
        parts.push(`${encodeURIComponent(`blocks[${i}][${k}]`)}=${encodeURIComponent(v)}`);
  });
  return parts.join('&');
}
