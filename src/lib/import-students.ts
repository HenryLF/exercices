import { parse } from 'csv-parse/sync';
import { normalizeName } from './names.js';

// Format of sample/Export CSV.csv (school software export): a header row, then one row per pupil.
// Only the name column is used, found by header name. Every other column (date of birth, sex,
// options...) is ignored and never stored: the app keeps as little personal data as possible.
const NAME_HEADERS = ['eleves', 'eleve', 'nom', 'nomprenom', 'nometprenom'];

const headerKey = (h: string) => normalizeName(h).replace(/[^a-z0-9]/g, '');

export interface ImportRow {
  line: number;
  name: string;
}

export interface ParsedImport {
  rows: ImportRow[];
  duplicates: { line: number; name: string }[];
  errors: { line: number; message: string }[];
  /** Set when the file can't be used at all; nothing is imported. */
  fatal?: string;
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
  if (nameCol < 0) {
    return {
      rows: [],
      duplicates: [],
      errors: [],
      fatal: 'Colonne introuvable\u00a0: le fichier doit avoir une colonne «\u00a0Élèves\u00a0».',
    };
  }

  const rows: ImportRow[] = [];
  const duplicates: ParsedImport['duplicates'] = [];
  const errors: ParsedImport['errors'] = [];
  const seen = new Set<string>();
  records.slice(1).forEach((rec, i) => {
    const line = i + 2;
    const name = (rec[nameCol] ?? '').replace(/\s+/g, ' ').trim();
    if (!name) {
      if (rec.some((cell) => cell.trim())) errors.push({ line, message: 'nom manquant' });
      return;
    }
    if (name.length > 200) return errors.push({ line, message: 'nom trop long' });
    const key = normalizeName(name);
    if (seen.has(key)) return duplicates.push({ line, name });
    seen.add(key);
    rows.push({ line, name });
  });
  return { rows, duplicates, errors };
}

// ---------------------------------------------------------------------------
// Matching rows against students already in the database

export interface Candidate {
  id: string;
  name: string;
  groupIds: string[];
}

/**
 * What to do with one CSV row:
 * - `new`: nobody has this name, a student is created in the class;
 * - `ask`: students with the same name exist, none in the class; the admin picks one of them
 *   (added to the class) or a new student; `suggested` is the oldest of them;
 * - `already`: a student with this name is already in the class.
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
    const inClass = candidates.find((c) => c.groupIds.includes(groupId));
    if (inClass) return { kind: 'already', row, candidate: inClass };
    return { kind: 'ask', row, candidates, suggested: candidates[0]!.id };
  });
}

/** The admin's answer for an `ask` row: `new`, or one of its candidates' ids. Anything else
 * falls back to the suggestion. */
export function resolveChoice(plan: RowPlan & { kind: 'ask' }, choice: unknown): string {
  if (choice === 'new') return 'new';
  if (typeof choice === 'string' && plan.candidates.some((c) => c.id === choice)) return choice;
  return plan.suggested;
}
