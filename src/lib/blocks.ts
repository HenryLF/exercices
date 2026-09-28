import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { QuestionStates } from '../models/attempt.js';
import { formatAmount, formatValue, parseNumber } from './answers.js';
import { renderMarkdown } from './markdown.js';
import { asIndexedList } from './validation.js';

export const BLOCK_TYPES = ['markdown', 'given', 'question'] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];
export const ANSWER_TYPES = ['number', 'enum'] as const;
export type AnswerType = (typeof ANSWER_TYPES)[number];

export type NumberAnswer = {
  type: 'number';
  value: number;
  decimals: number;
  tolerance: number;
  unit?: string;
};
export type EnumAnswer = { type: 'enum'; options: string[]; value: string };
export type Answer = NumberAnswer | EnumAnswer;

export type MarkdownBlock = { key: string; type: 'markdown'; body: string };
/** A table row without input: a value the student is given (e.g. the gross purchase price). */
export type GivenBlock = {
  key: string;
  type: 'given';
  label: string;
  hint?: string;
  amount: number;
  unit?: string;
};
export type QuestionBlock = {
  key: string;
  type: 'question';
  label: string;
  hint?: string;
  tooltip?: string;
  answer: Answer;
};
export type Block = MarkdownBlock | GivenBlock | QuestionBlock;

/** A block before the server assigns its key. */
export type NewBlock =
  Omit<MarkdownBlock, 'key'> | Omit<GivenBlock, 'key'> | Omit<QuestionBlock, 'key'>;

const KEY_RE = /^b_[0-9a-f]{8}$/;

/** Attempts are stored under this key, so it never changes once a block is saved. */
export function newBlockKey(): string {
  return `b_${randomBytes(4).toString('hex')}`;
}

export function withKeys(blocks: NewBlock[]): Block[] {
  const used = new Set<string>();
  return blocks.map((b) => {
    let key = newBlockKey();
    while (used.has(key)) key = newBlockKey();
    used.add(key);
    return { ...b, key } as Block;
  });
}

/** Keys that depend only on the block's position: a generated exercise gets the same keys for
 * every seed, so tries of different seeds line up question by question. */
export function withStableKeys(blocks: NewBlock[]): Block[] {
  return blocks.map(
    (b, i) => ({ ...b, key: `b_${(i + 1).toString(16).padStart(8, '0')}` }) as Block,
  );
}

export function questionBlocks(blocks: readonly Block[]): QuestionBlock[] {
  return blocks.filter((b): b is QuestionBlock => b.type === 'question');
}

// ---------------------------------------------------------------------------
// Editor form

/** A block as the editor shows it: every field a string, options one per line. */
export interface EditorRow {
  key: string;
  type: string;
  body: string;
  label: string;
  hint: string;
  tooltip: string;
  amount: string;
  unit: string;
  answerType: string;
  value: string;
  decimals: string;
  tolerance: string;
  options: string;
}

export interface ExerciseFormValues {
  name: string;
  rows: EditorRow[];
}

export const blankRow = (type: BlockType = 'question'): EditorRow => ({
  key: '',
  type,
  body: '',
  label: '',
  hint: '',
  tooltip: '',
  amount: '',
  unit: '',
  answerType: 'number',
  value: '',
  decimals: '2',
  tolerance: '0',
  options: '',
});

const numText = (n: number) => String(n).replace('.', ',');

export function toEditorRows(blocks: readonly Block[]): EditorRow[] {
  return blocks.map((b) => {
    const row = { ...blankRow(b.type), key: b.key };
    if (b.type === 'markdown') return { ...row, body: b.body };
    if (b.type === 'given')
      return {
        ...row,
        label: b.label,
        hint: b.hint ?? '',
        amount: numText(b.amount),
        unit: b.unit ?? '',
      };
    const base = { ...row, label: b.label, hint: b.hint ?? '', tooltip: b.tooltip ?? '' };
    if (b.answer.type === 'enum')
      return {
        ...base,
        answerType: 'enum',
        options: b.answer.options.join('\n'),
        value: b.answer.value,
      };
    return {
      ...base,
      answerType: 'number',
      value: numText(b.answer.value),
      decimals: String(b.answer.decimals),
      tolerance: numText(b.answer.tolerance),
      unit: b.answer.unit ?? '',
    };
  });
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function readExerciseForm(body: Record<string, unknown>): ExerciseFormValues {
  const rows = asIndexedList(body.blocks).map((raw): EditorRow => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const row = blankRow();
    for (const k of Object.keys(row) as (keyof EditorRow)[]) row[k] = str(r[k]);
    row.key = row.key.trim();
    return row;
  });
  return { name: str(body.name), rows };
}

const numberField = (label: string) =>
  z.string().transform((s, ctx) => {
    const n = parseNumber(s);
    if (n === null) {
      ctx.addIssue({ code: 'custom', message: `${label}\u00a0: saisissez un nombre` });
      return z.NEVER;
    }
    return n;
  });

const optional = (max: number, what: string) =>
  z
    .string()
    .trim()
    .max(max, `${what} est trop long`)
    .transform((s) => s || undefined);

const label = z
  .string()
  .trim()
  .min(1, 'l’intitulé est obligatoire')
  .max(300, 'l’intitulé est trop long');

const markdownRow = z.object({
  body: z.string().trim().min(1, 'le texte est obligatoire').max(10000, 'le texte est trop long'),
});

const givenRow = z.object({
  label,
  hint: optional(50, 'le taux'),
  amount: numberField('le montant'),
  unit: optional(10, 'l’unité'),
});

const questionBase = z.object({
  label,
  hint: optional(50, 'le taux'),
  tooltip: optional(5000, 'l’indice'),
});

const numberAnswer = z.object({
  value: numberField('la réponse attendue'),
  decimals: z
    .string()
    .trim()
    .transform((s) => (s === '' ? 2 : Number(s)))
    .pipe(
      z
        .number()
        .int('décimales\u00a0: un nombre entier')
        .min(0)
        .max(6, 'décimales\u00a0: 6 au plus'),
    ),
  tolerance: z
    .string()
    .transform((s) => (s.trim() === '' ? '0' : s))
    .pipe(numberField('la tolérance'))
    .pipe(z.number().min(0, 'la tolérance ne peut pas être négative')),
  unit: optional(10, 'l’unité'),
});

const enumAnswer = z
  .object({
    options: z.string().transform((s) => [
      ...new Set(
        s
          .split(/\r?\n/)
          .map((o) => o.trim())
          .filter(Boolean),
      ),
    ]),
    value: z.string().trim(),
  })
  .superRefine((a, ctx) => {
    if (a.options.length < 2)
      ctx.addIssue({ code: 'custom', message: 'une liste doit avoir au moins 2 options' });
    if (a.options.some((o) => o.length > 200))
      ctx.addIssue({ code: 'custom', message: 'une option dépasse 200 caractères' });
    if (!a.options.includes(a.value))
      ctx.addIssue({ code: 'custom', message: 'la réponse attendue doit être une des options' });
  });

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Le nom de l’exercice est obligatoire')
  .max(150, 'Le nom de l’exercice est trop long');

export type ParseResult =
  | { ok: true; value: { name: string; blocks: Block[] } }
  | { ok: false; errors: string[]; values: ExerciseFormValues };

function parseRow(row: EditorRow): { block?: NewBlock; errors: string[] } {
  const issues = (e: z.ZodError) => e.issues.map((i) => i.message);
  switch (row.type) {
    case 'markdown': {
      const p = markdownRow.safeParse(row);
      return p.success
        ? { block: { type: 'markdown', ...p.data }, errors: [] }
        : { errors: issues(p.error) };
    }
    case 'given': {
      const p = givenRow.safeParse(row);
      return p.success
        ? { block: { type: 'given', ...p.data }, errors: [] }
        : { errors: issues(p.error) };
    }
    case 'question': {
      const base = questionBase.safeParse(row);
      const errors = base.success ? [] : issues(base.error);
      let answer: Answer | undefined;
      if (row.answerType === 'enum') {
        const a = enumAnswer.safeParse(row);
        if (a.success) answer = { type: 'enum', ...a.data };
        else errors.push(...issues(a.error));
      } else if (row.answerType === 'number') {
        const a = numberAnswer.safeParse(row);
        if (a.success) answer = { type: 'number', ...a.data };
        else errors.push(...issues(a.error));
      } else errors.push('choisissez un type de réponse');
      if (!base.success || !answer) return { errors };
      return { block: { type: 'question', ...base.data, answer }, errors };
    }
    default:
      return { errors: ['type de bloc inconnu'] };
  }
}

/**
 * Validates the editor form. `existingKeys` are the keys of the exercise being edited: a row keeps
 * its key only if it is one of them, so a client can't invent or duplicate keys.
 */
export function parseExerciseForm(
  body: Record<string, unknown>,
  existingKeys: ReadonlySet<string> = new Set(),
): ParseResult {
  const values = readExerciseForm(body);
  const errors: string[] = [];
  const name = nameSchema.safeParse(values.name);
  if (!name.success) errors.push(...name.error.issues.map((i) => i.message));
  if (values.rows.length > 200) errors.push('Un exercice peut avoir au plus 200 blocs');

  const used = new Set<string>();
  const blocks: Block[] = [];
  values.rows.forEach((row, i) => {
    const { block, errors: rowErrors } = parseRow(row);
    for (const e of rowErrors) errors.push(`Bloc ${i + 1}\u00a0: ${e}`);
    if (!block) return;
    let key =
      KEY_RE.test(row.key) && existingKeys.has(row.key) && !used.has(row.key) ? row.key : '';
    while (!key || used.has(key)) key = newBlockKey();
    used.add(key);
    blocks.push({ ...block, key } as Block);
  });
  if (errors.length === 0 && questionBlocks(blocks).length === 0)
    errors.push('Ajoutez au moins une question');

  if (errors.length > 0 || !name.success) return { ok: false, errors, values };
  return { ok: true, value: { name: name.data, blocks } };
}

/**
 * Once students have started an exercise, their tries must keep their meaning: question blocks
 * can't be removed or change answer type. Everything else (labels, expected values, order,
 * markdown and given blocks) can change; past tries are not re-graded.
 */
export function validateEdit(
  existing: readonly Block[],
  next: readonly Block[],
  hasAttempts: boolean,
): string[] {
  if (!hasAttempts) return [];
  const byKey = new Map(next.map((b) => [b.key, b]));
  const errors: string[] = [];
  for (const q of questionBlocks(existing)) {
    const n = byKey.get(q.key);
    if (!n || n.type !== 'question')
      errors.push(`«\u00a0${q.label}\u00a0» a déjà des essais et ne peut pas être supprimée`);
    else if (n.answer.type !== q.answer.type)
      errors.push(`«\u00a0${q.label}\u00a0» a déjà des essais\u00a0: son type de réponse est figé`);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Student view. The expected answer never leaves the server unless `showAnswers` is set
// (admin preview).

export type RowState = 'ok' | 'ko' | 'none';

export type ViewRow =
  | { type: 'given'; key: string; label: string; hint: string; amount: string }
  | {
      type: 'question';
      key: string;
      label: string;
      hint: string;
      hasTooltip: boolean;
      tooltipHtml: string | null;
      answerType: AnswerType;
      options: string[];
      unit: string;
      state: RowState;
      tries: number;
      value: string;
      error: string | null;
      expected: string | null;
    };

export type Segment = { kind: 'markdown'; html: string } | { kind: 'table'; rows: ViewRow[] };

export interface ViewOptions {
  showAnswers?: boolean;
  /** Re-rendered input after a rejected (unparsable) answer. */
  input?: { key: string; value: string; error: string };
}

/** Markdown blocks become HTML; runs of given and question blocks become one table. */
export function buildSegments(
  blocks: readonly Block[],
  states: QuestionStates,
  opts: ViewOptions = {},
): Segment[] {
  const segments: Segment[] = [];
  let table: ViewRow[] | null = null;
  for (const b of blocks) {
    if (b.type === 'markdown') {
      table = null;
      segments.push({ kind: 'markdown', html: renderMarkdown(b.body) });
      continue;
    }
    if (!table) {
      table = [];
      segments.push({ kind: 'table', rows: table });
    }
    if (b.type === 'given') {
      table.push({
        type: 'given',
        key: b.key,
        label: b.label,
        hint: b.hint ?? '',
        // Amounts in € read like the PDF (no unit); rates keep their % sign.
        amount: formatAmount(b.amount) + (b.unit === '%' ? '\u00a0%' : ''),
      });
      continue;
    }
    const st = states[b.key];
    const last = st?.tries.at(-1);
    const decimals = b.answer.type === 'number' ? b.answer.decimals : undefined;
    const input = opts.input?.key === b.key ? opts.input : undefined;
    const tooltipOpen = !!b.tooltip && (opts.showAnswers || !!st?.tooltipShown);
    table.push({
      type: 'question',
      key: b.key,
      label: b.label,
      hint: b.hint ?? '',
      hasTooltip: !!b.tooltip,
      tooltipHtml: tooltipOpen ? renderMarkdown(b.tooltip!) : null,
      answerType: b.answer.type,
      options: b.answer.type === 'enum' ? b.answer.options : [],
      unit: b.answer.type === 'number' ? (b.answer.unit ?? '') : '',
      state: st?.solved ? 'ok' : last ? 'ko' : 'none',
      tries: st?.tries.length ?? 0,
      value: input ? input.value : last ? formatValue(last.value, decimals) : '',
      error: input?.error ?? null,
      expected: opts.showAnswers ? formatValue(b.answer.value, decimals) : null,
    });
  }
  return segments;
}
