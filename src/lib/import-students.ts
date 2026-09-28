import { parse } from 'csv-parse/sync';
import { dobSchema } from './dates.js';
import { normalizeName } from './names.js';

// Format of sample/Export CSV.csv (school software export): a header row, then one row per pupil.
// Only the name and date-of-birth columns are used; they are found by header name.
const NAME_HEADERS = ['eleves', 'eleve', 'nom', 'nomprenom', 'nometprenom'];
const DOB_HEADERS = ['neele', 'nele', 'datedenaissance', 'naissance'];

const headerKey = (h: string) => normalizeName(h).replace(/[^a-z0-9]/g, '');

export interface ImportRow {
  line: number;
  name: string;
  dob: string; // YYYY-MM-DD
}

export interface ParsedImport {
  rows: ImportRow[];
  duplicates: { line: number; name: string }[];
  errors: { line: number; message: string }[];
  /** Set when the file can't be used at all; nothing is imported. */
  fatal?: string;
}

/** 'DD/MM/YYYY' (or D/M/YYYY, or YYYY-MM-DD) -> 'YYYY-MM-DD', unvalidated. */
export function toIsoDate(s: string): string {
  const t = s.trim();
  const fr = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (fr) return `${fr[3]}-${fr[2]!.padStart(2, '0')}-${fr[1]!.padStart(2, '0')}`;
  return t;
}

export function parseStudentsCsv(input: Buffer | string): ParsedImport {
  const text = (typeof input === 'string' ? input : input.toString('utf8')).replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';

  let records: string[][];
  try {
    records = parse(text, {
      delimiter,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      trim: true,
    }) as string[][];
  } catch {
    return { rows: [], duplicates: [], errors: [], fatal: 'Le fichier n’est pas un CSV lisible.' };
  }

  const header = (records[0] ?? []).map(headerKey);
  const nameCol = header.findIndex((h) => NAME_HEADERS.includes(h));
  const dobCol = header.findIndex((h) => DOB_HEADERS.includes(h));
  if (nameCol < 0 || dobCol < 0) {
    return {
      rows: [],
      duplicates: [],
      errors: [],
      fatal:
        'Colonnes introuvables\u00a0: le fichier doit avoir les colonnes «\u00a0Élèves\u00a0» et «\u00a0Né(e) le\u00a0».',
    };
  }

  const rows: ImportRow[] = [];
  const duplicates: ParsedImport['duplicates'] = [];
  const errors: ParsedImport['errors'] = [];
  const seen = new Set<string>();
  records.slice(1).forEach((rec, i) => {
    const line = i + 2;
    const name = (rec[nameCol] ?? '').replace(/\s+/g, ' ').trim();
    const rawDob = rec[dobCol] ?? '';
    if (!name && !rawDob.trim()) return;
    if (!name) return errors.push({ line, message: 'nom manquant' });
    if (name.length > 200) return errors.push({ line, message: 'nom trop long' });
    const dob = dobSchema.safeParse(toIsoDate(rawDob));
    if (!dob.success)
      return errors.push({ line, message: `date de naissance invalide («\u00a0${rawDob}\u00a0»)` });
    const key = `${normalizeName(name)}|${dob.data}`;
    if (seen.has(key)) return duplicates.push({ line, name });
    seen.add(key);
    rows.push({ line, name, dob: dob.data });
  });
  return { rows, duplicates, errors };
}

// ---------------------------------------------------------------------------
// Matching rows against students already in the database

export interface Candidate {
  id: string;
  name: string;
  dob: string;
  groupIds: string[];
}

/**
 * What to do with one CSV row:
 * - `new`: nobody has this name, a student is created in the class;
 * - `ask`: students with the same name exist, the admin picks one of them (added to the class) or
 *   a new student; `suggested` is the one with the same date of birth, if any;
 * - `already`: the same student (name and date of birth) is already in the class.
 */
export type RowPlan =
  | { kind: 'new'; row: ImportRow }
  | { kind: 'ask'; row: ImportRow; candidates: Candidate[]; suggested: string }
  | { kind: 'already'; row: ImportRow; candidate: Candidate };

export function planImport(rows: ImportRow[], existing: Candidate[], groupId: string): RowPlan[] {
  const byName = new Map<string, Candidate[]>();
  for (const c of existing) {
    const key = normalizeName(c.name);
    byName.set(key, [...(byName.get(key) ?? []), c]);
  }
  return rows.map((row): RowPlan => {
    const candidates = byName.get(normalizeName(row.name)) ?? [];
    if (candidates.length === 0) return { kind: 'new', row };
    const same = candidates.find((c) => c.dob === row.dob);
    if (same?.groupIds.includes(groupId)) return { kind: 'already', row, candidate: same };
    return { kind: 'ask', row, candidates, suggested: same?.id ?? 'new' };
  });
}

/** The admin's answer for an `ask` row: `new`, or one of its candidates' ids. Anything else
 * falls back to the suggestion. */
export function resolveChoice(plan: RowPlan & { kind: 'ask' }, choice: unknown): string {
  if (choice === 'new') return 'new';
  if (typeof choice === 'string' && plan.candidates.some((c) => c.id === choice)) return choice;
  return plan.suggested;
}
