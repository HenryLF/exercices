import { z } from 'zod';
import { LOGIN_RE } from './names.js';

// The CSV is read in the admin's browser (public/import-csv.js): the server only ever receives
// logins, never names. This is the shape the browser posts.
const MAX_ROWS = 3000;
const line = z.number().int().min(1);
const login = z.string().regex(LOGIN_RE);

export const importPayloadSchema = z.object({
  rows: z.array(z.object({ line, login })).max(MAX_ROWS),
  duplicates: z.array(z.object({ line, login })).max(MAX_ROWS),
  errors: z.array(z.object({ line, message: z.string().max(100) })).max(MAX_ROWS),
});

export type ImportPayload = z.infer<typeof importPayloadSchema>;
export type ImportRow = ImportPayload['rows'][number];

/** The posted JSON, or null when it isn't a valid payload. */
export function parseImportPayload(raw: unknown): ImportPayload | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = importPayloadSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Matching rows against students already in the database

export interface Candidate {
  id: string;
  login: string;
  groupIds: string[];
}

/** Whether `login` is `base` or `base` with a numeric suffix (m.alice, m.alice2...). */
export const sameBase = (login: string, base: string) =>
  login === base || (login.startsWith(base) && /^\d+$/.test(login.slice(base.length)));

/**
 * What to do with one CSV row. Different pupils can share a login, so existing students with the
 * same base login (m.alice, m.alice2...) are only possibly the same person:
 * - `already`: as many rows as there are such students in the class are taken to be them;
 * - `ask`: other rows, when such students exist outside the class; the admin picks one of them
 *   (added to the class) or a new student; `suggested` is the oldest;
 * - `new`: nobody has this login, a student is created (with a free suffix if needed).
 * `existing` must be sorted oldest first.
 */
export type RowPlan =
  | { kind: 'new'; row: ImportRow }
  | { kind: 'ask'; row: ImportRow; candidates: Candidate[]; suggested: string }
  | { kind: 'already'; row: ImportRow; candidate: Candidate };

export function planImport(rows: ImportRow[], existing: Candidate[], groupId: string): RowPlan[] {
  const seen = new Map<string, number>();
  return rows.map((row): RowPlan => {
    const matches = existing.filter((c) => sameBase(c.login, row.login));
    const inClass = matches.filter((c) => c.groupIds.includes(groupId));
    const others = matches.filter((c) => !c.groupIds.includes(groupId));
    const n = seen.get(row.login) ?? 0;
    seen.set(row.login, n + 1);
    const here = inClass[n];
    if (here) return { kind: 'already', row, candidate: here };
    if (others.length === 0) return { kind: 'new', row };
    return { kind: 'ask', row, candidates: others, suggested: others[0]!.id };
  });
}

/** The admin's answer for an `ask` row: `new`, or one of its candidates' ids. Anything else
 * falls back to the suggestion. */
export function resolveChoice(plan: RowPlan & { kind: 'ask' }, choice: unknown): string {
  if (choice === 'new') return 'new';
  if (typeof choice === 'string' && plan.candidates.some((c) => c.id === choice)) return choice;
  return plan.suggested;
}
