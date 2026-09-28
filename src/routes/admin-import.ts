import { Router, type NextFunction, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { requireRole } from '../auth/middleware.js';
import { Group } from '../models/group.js';
import { Student } from '../models/student.js';
import { formatDob } from '../lib/dates.js';
import { setFlash } from '../lib/flash.js';
import {
  parseStudentsCsv,
  planImport,
  resolveChoice,
  type ImportRow,
  type RowPlan,
} from '../lib/import-students.js';
import { normalizeName } from '../lib/names.js';
import { groupNames } from './load.js';

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_BYTES, files: 1 },
});

type Draft = NonNullable<Request['session']['importDraft']>;

/** Current plan for the draft's rows: the database may have changed since the upload. */
async function plan(rows: ImportRow[], groupId: string): Promise<RowPlan[]> {
  const nameKeys = [...new Set(rows.map((r) => normalizeName(r.name)))];
  const existing = await Student.find(
    { nameKey: { $in: nameKeys } },
    { name: 1, dob: 1, groupIds: 1 },
  ).sort({ createdAt: 1 });
  return planImport(
    rows,
    existing.map((s) => ({
      id: s.id as string,
      name: s.name,
      dob: s.dob,
      groupIds: s.groupIds.map(String),
    })),
    groupId,
  );
}

/** Creates the new students and adds the chosen existing ones to the class. */
async function apply(draft: Draft, plans: RowPlan[], choices: Record<string, unknown>) {
  const names = await groupNames();
  const created: { id: string; name: string }[] = [];
  const added: { id: string; name: string; line: number }[] = [];
  const already: { id: string; name: string; line: number }[] = [];
  for (const p of plans) {
    if (p.kind === 'already') {
      already.push({ id: p.candidate.id, name: p.candidate.name, line: p.row.line });
      continue;
    }
    // Keys are `L<line>`: purely numeric keys would make qs build a compacted array.
    const choice = p.kind === 'ask' ? resolveChoice(p, choices[`L${p.row.line}`]) : 'new';
    if (choice === 'new') {
      const s = await Student.create({
        name: p.row.name,
        dob: p.row.dob,
        groupIds: [draft.groupId],
      });
      created.push({ id: s.id as string, name: s.name });
    } else {
      await Student.updateOne({ _id: choice }, { $addToSet: { groupIds: draft.groupId } });
      const c = (p as RowPlan & { kind: 'ask' }).candidates.find((x) => x.id === choice)!;
      added.push({ id: c.id, name: c.name, line: p.row.line });
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

  const receiveFile = (req: Request, res: Response, next: NextFunction) =>
    upload.single('file')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        res.locals.uploadError =
          err.code === 'LIMIT_FILE_SIZE'
            ? 'Le fichier dépasse 2\u00a0Mo.'
            : 'Envoyez un seul fichier CSV.';
        return next();
      }
      next(err);
    });

  router.post('/admin/students/import', receiveFile, async (req, res) => {
    const raw = typeof req.body.groupId === 'string' ? req.body.groupId : '';
    const groupId = mongoose.isValidObjectId(raw) && (await Group.exists({ _id: raw })) ? raw : '';
    if (res.locals.uploadError)
      return render(res, 400, { groupId, error: res.locals.uploadError as string });
    if (!groupId) return render(res, 400, { error: 'Choisissez la classe des élèves importés.' });
    if (!req.file || req.file.size === 0)
      return render(res, 400, { groupId, error: 'Choisissez un fichier CSV.' });

    const parsed = parseStudentsCsv(req.file.buffer);
    if (parsed.fatal) return render(res, 400, { groupId, error: parsed.fatal });

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
    // Same names found: ask before creating anyone.
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
          name: p.row.name,
          dob: formatDob(p.row.dob),
          suggested: p.suggested,
          candidates: p.candidates.map((c) => ({
            id: c.id,
            name: c.name,
            dob: formatDob(c.dob),
            sameDob: c.dob === p.row.dob,
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
      setFlash(req, 'error', 'Cet import n’est plus en attente. Envoyez le fichier à nouveau.');
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
