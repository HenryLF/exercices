import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { requireRole } from '../auth/middleware.js';
import { Group } from '../models/group.js';
import { createStudentWithLogin, Student } from '../models/student.js';
import { setFlash } from '../lib/flash.js';
import {
  parseImportPayload,
  planImport,
  resolveChoice,
  type ImportRow,
  type RowPlan,
} from '../lib/import-students.js';
import { groupNames } from './load.js';

type Draft = NonNullable<Request['session']['importDraft']>;

/** Current plan for the draft's rows: the database may have changed since the upload. */
async function plan(rows: ImportRow[], groupId: string): Promise<RowPlan[]> {
  // Logins are [a-z0-9] with at most one dot (checked by the payload schema): only the dot needs
  // escaping inside a regex.
  const bases = [...new Set(rows.map((r) => r.login))];
  const existing = bases.length
    ? await Student.find(
        { login: { $regex: `^(${bases.map((b) => b.replace('.', '\\.')).join('|')})\\d*$` } },
        { login: 1, groupIds: 1 },
      ).sort({ createdAt: 1 })
    : [];
  return planImport(
    rows,
    existing.map((s) => ({
      id: s.id as string,
      login: s.login,
      groupIds: s.groupIds.map(String),
    })),
    groupId,
  );
}

/** Creates the new students and adds the chosen existing ones to the class. */
async function apply(draft: Draft, plans: RowPlan[], choices: Record<string, unknown>) {
  const names = await groupNames();
  const created: { id: string; login: string }[] = [];
  const added: { id: string; login: string; line: number }[] = [];
  const already: { id: string; login: string; line: number }[] = [];
  const used = new Set<string>();
  for (const p of plans) {
    if (p.kind === 'already') {
      already.push({ id: p.candidate.id, login: p.candidate.login, line: p.row.line });
      continue;
    }
    // Keys are `L<line>`: purely numeric keys would make qs build a compacted array.
    let choice = p.kind === 'ask' ? resolveChoice(p, choices[`L${p.row.line}`]) : 'new';
    // One existing student can stand for one row only; a second row is a different pupil.
    if (used.has(choice)) choice = 'new';
    if (choice === 'new') {
      const s = await createStudentWithLogin(p.row.login, [draft.groupId]);
      created.push({ id: s.id as string, login: s.login });
    } else {
      used.add(choice);
      await Student.updateOne({ _id: choice }, { $addToSet: { groupIds: draft.groupId } });
      const c = (p as RowPlan & { kind: 'ask' }).candidates.find((x) => x.id === choice)!;
      added.push({ id: c.id, login: c.login, line: p.row.line });
    }
  }
  return {
    created,
    added,
    already,
    skipped: draft.duplicates.map((d) => ({ ...d, reason: 'doublon dans le fichier' })),
    errors: draft.errors,
    groupId: draft.groupId,
    groupName: names.get(draft.groupId) ?? '',
  };
}

export function adminImportRouter() {
  const router = Router();
  router.use('/admin/students/import', requireRole('admin'));

  const groupOptions = async () =>
    (await Group.find().sort({ name: 1 })).map((g) => ({ id: g.id as string, name: g.name }));

  const render = async (
    res: Response,
    status: number,
    locals: { groupId?: string; error?: string | null; result?: unknown },
  ) =>
    res.status(status).render('admin/import', {
      title: 'Importer des élèves',
      groups: await groupOptions(),
      groupId: locals.groupId ?? '',
      error: locals.error ?? null,
      result: locals.result ?? null,
    });

  router.get('/admin/students/import', (req, res) =>
    render(res, 200, { groupId: typeof req.query.group === 'string' ? req.query.group : '' }),
  );

  router.post('/admin/students/import', async (req, res) => {
    const raw = typeof req.body.groupId === 'string' ? req.body.groupId : '';
    const groupId = mongoose.isValidObjectId(raw) && (await Group.exists({ _id: raw })) ? raw : '';
    if (!groupId) return render(res, 400, { error: 'Choisissez la classe des élèves importés.' });
    const parsed = parseImportPayload(req.body.payload);
    if (!parsed)
      return render(res, 400, {
        groupId,
        error: 'Fichier non lu. Le fichier est lu par le navigateur\u00a0: activez JavaScript.',
      });

    const draft: Draft = {
      groupId,
      rows: parsed.rows,
      duplicates: parsed.duplicates,
      errors: parsed.errors,
    };
    const plans = await plan(draft.rows, groupId);
    if (!plans.some((p) => p.kind === 'ask')) {
      delete req.session.importDraft;
      return render(res, 200, { groupId, result: await apply(draft, plans, {}) });
    }
    // Same logins found: ask before creating anyone.
    req.session.importDraft = draft;
    await renderConfirm(res, draft, plans);
  });

  const renderConfirm = async (res: Response, draft: Draft, plans: RowPlan[]) => {
    const names = await groupNames();
    const groupsOf = (ids: string[]) => ids.map((id) => names.get(id) ?? '').filter(Boolean);
    res.render('admin/import-confirm', {
      title: 'Élèves déjà enregistrés',
      groupName: names.get(draft.groupId) ?? '',
      asks: plans
        .filter((p): p is RowPlan & { kind: 'ask' } => p.kind === 'ask')
        .map((p) => ({
          line: p.row.line,
          login: p.row.login,
          suggested: p.suggested,
          candidates: p.candidates.map((c) => ({
            id: c.id,
            login: c.login,
            groups: groupsOf(c.groupIds),
          })),
        })),
      newCount: plans.filter((p) => p.kind === 'new').length,
      alreadyCount: plans.filter((p) => p.kind === 'already').length,
    });
  };

  router.post('/admin/students/import/confirm', async (req, res) => {
    const draft = req.session.importDraft;
    if (!draft) {
      setFlash(req, 'error', 'Cet import n’est plus en attente. Importez le fichier à nouveau.');
      return res.redirect('/admin/students/import');
    }
    if (!(await Group.exists({ _id: draft.groupId }))) {
      delete req.session.importDraft;
      setFlash(req, 'error', 'La classe de cet import a été supprimée.');
      return res.redirect('/admin/students/import');
    }
    const plans = await plan(draft.rows, draft.groupId);
    const choices = (req.body.choice ?? {}) as Record<string, unknown>;
    const result = await apply(draft, plans, choices);
    delete req.session.importDraft;
    await render(res, 200, { groupId: draft.groupId, result });
  });

  router.post('/admin/students/import/cancel', (req, res) => {
    delete req.session.importDraft;
    setFlash(req, 'success', 'Import annulé. Aucun élève n’a été créé ni modifié.');
    res.redirect('/admin/students/import');
  });

  return router;
}
