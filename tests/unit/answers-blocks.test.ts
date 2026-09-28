import { describe, expect, it } from 'vitest';
import { checkAnswer, parseNumber } from '../../src/lib/answers.js';
import {
  buildSegments,
  parseExerciseForm,
  validateEdit,
  withKeys,
  type Block,
  type QuestionBlock,
} from '../../src/lib/blocks.js';
import { renderMarkdown } from '../../src/lib/markdown.js';
import { editorForm, sampleBlocks } from '../helpers.js';

const qs = (s: string) => Object.fromEntries(new URLSearchParams(s)) as Record<string, string>;
// The form parser reads qs-style nested objects: rebuild them from the flat editor encoding.
function body(form: string): Record<string, unknown> {
  const out: Record<string, unknown> = { blocks: [] as Record<string, string>[] };
  for (const [k, v] of Object.entries(qs(form))) {
    const m = /^blocks\[(\d+)\]\[(\w+)\]$/.exec(k);
    if (!m) out[k] = v;
    else ((out.blocks as Record<string, string>[])[Number(m[1])] ??= {})[m[2]!] = v;
  }
  return out;
}

describe('parseNumber', () => {
  it.each([
    ['12,34', 12.34],
    ['12.34', 12.34],
    ['1 021,24', 1021.24],
    ['1\u00a0021,24', 1021.24],
    ['1 250,00 €', 1250],
    ['45,50€', 45.5],
    ['12 %', 12],
    ['-3', -3],
    [',5', 0.5],
  ])('%s -> %s', (input, expected) => expect(parseNumber(input)).toBe(expected));

  it.each(['', 'abc', '1,2,3', '12..5', '1.021,24', '12 € 50'])('rejects %j', (input) =>
    expect(parseNumber(input)).toBeNull(),
  );
});

describe('checkAnswer', () => {
  const number = { type: 'number' as const, value: 40.85, decimals: 2, tolerance: 0.01 };
  it('accepts the exact value in French notation', () => {
    expect(checkAnswer(number, '40,85')).toEqual({ ok: true, value: 40.85, correct: true });
  });
  it('accepts within tolerance, refuses beyond', () => {
    expect(checkAnswer(number, '40,86')).toMatchObject({ correct: true });
    expect(checkAnswer(number, '40,84')).toMatchObject({ correct: true });
    expect(checkAnswer(number, '40,87')).toMatchObject({ correct: false });
  });
  it('rounds the input to the expected decimals', () => {
    expect(checkAnswer({ ...number, tolerance: 0 }, '40,849')).toMatchObject({
      value: 40.85,
      correct: true,
    });
  });
  it('tolerance 0 means equal despite float noise', () => {
    expect(
      checkAnswer({ type: 'number', value: 0.3, decimals: 2, tolerance: 0 }, '0,3'),
    ).toMatchObject({ correct: true });
  });
  it('blank and unparsable input is not a try', () => {
    expect(checkAnswer(number, '  ')).toMatchObject({ ok: false });
    expect(checkAnswer(number, 'quarante')).toMatchObject({ ok: false });
    expect(checkAnswer(number, undefined)).toMatchObject({ ok: false });
  });
  it('enum: exact option only', () => {
    const e = { type: 'enum' as const, options: ['oui', 'non'], value: 'oui' };
    expect(checkAnswer(e, 'oui')).toEqual({ ok: true, value: 'oui', correct: true });
    expect(checkAnswer(e, 'non')).toEqual({ ok: true, value: 'non', correct: false });
    expect(checkAnswer(e, 'peut-être')).toMatchObject({ ok: false });
  });
});

describe('renderMarkdown', () => {
  it('escapes raw HTML and refuses javascript links', () => {
    const html = renderMarkdown('<script>alert(1)</script> [x](javascript:alert(1)) **gras**');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('<strong>gras</strong>');
  });
});

describe('parseExerciseForm', () => {
  const rows: Record<string, string>[] = [
    { type: 'markdown', body: 'Consigne' },
    { type: 'given', label: 'Brut', amount: '1 021,24' },
    {
      type: 'question',
      label: 'Remise',
      hint: '4 %',
      answerType: 'number',
      value: '40,85',
      decimals: '2',
      tolerance: '0,01',
      unit: '€',
    },
    {
      type: 'question',
      label: 'TVA',
      answerType: 'enum',
      options: 'normal\nréduit\nnormal',
      value: 'réduit',
    },
  ];

  it('parses the three block types with French numbers and new keys', () => {
    const r = parseExerciseForm(body(editorForm('Ex 1', rows)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [md, given, q1, q2] = r.value.blocks as [Block, Block, QuestionBlock, QuestionBlock];
    expect(md).toMatchObject({ type: 'markdown', body: 'Consigne' });
    expect(given).toMatchObject({ type: 'given', amount: 1021.24 });
    expect(q1.answer).toEqual({
      type: 'number',
      value: 40.85,
      decimals: 2,
      tolerance: 0.01,
      unit: '€',
    });
    expect(q2.answer).toEqual({ type: 'enum', options: ['normal', 'réduit'], value: 'réduit' });
    expect(new Set(r.value.blocks.map((b) => b.key)).size).toBe(4);
    for (const b of r.value.blocks) expect(b.key).toMatch(/^b_[0-9a-f]{8}$/);
  });

  it('keeps only known keys, never twice', () => {
    const r = parseExerciseForm(
      body(
        editorForm('Ex', [
          { ...rows[2]!, key: 'b_00000001' },
          { ...rows[2]!, key: 'b_00000001' },
          { ...rows[2]!, key: 'b_99999999' },
        ]),
      ),
      new Set(['b_00000001']),
    );
    expect(r.ok && r.value.blocks.map((b) => b.key)[0]).toBe('b_00000001');
    expect(r.ok && r.value.blocks[1]!.key).not.toBe('b_00000001');
    expect(r.ok && r.value.blocks[2]!.key).not.toBe('b_99999999');
  });

  it('reports errors per block and keeps the values', () => {
    const r = parseExerciseForm(
      body(
        editorForm('', [
          { type: 'question', label: '', answerType: 'enum', options: 'a', value: 'b' },
        ]),
      ),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toContain('Le nom de l’exercice est obligatoire');
    expect(r.errors.join('\n')).toMatch(/Bloc 1.*intitulé/);
    expect(r.errors.join('\n')).toMatch(/au moins 2 options/);
    expect(r.errors.join('\n')).toMatch(/doit être une des options/);
  });

  it('requires at least one question', () => {
    const r = parseExerciseForm(body(editorForm('Ex', [rows[0]!])));
    expect(!r.ok && r.errors).toContain('Ajoutez au moins une question');
  });
});

describe('validateEdit', () => {
  const blocks = withKeys(sampleBlocks);
  const q = blocks[2] as QuestionBlock;
  it('allows anything without attempts', () => {
    expect(validateEdit(blocks, [], false)).toEqual([]);
  });
  it('refuses removing a question or changing its answer type once tried', () => {
    expect(
      validateEdit(
        blocks,
        blocks.filter((b) => b.key !== q.key),
        true,
      ),
    ).toHaveLength(1);
    const changed = blocks.map((b) =>
      b.key === q.key
        ? { ...q, answer: { type: 'enum' as const, options: ['a', 'b'], value: 'a' } }
        : b,
    );
    expect(validateEdit(blocks, changed, true)[0]).toMatch(/type de réponse est figé/);
  });
  it('allows relabelling, correcting values, removing markdown, reordering', () => {
    const next = blocks
      .filter((b) => b.type !== 'markdown')
      .map((b) =>
        b.key === q.key
          ? {
              ...q,
              label: 'Remise (€)',
              answer: { type: 'number' as const, value: 11, decimals: 2, tolerance: 0 },
            }
          : b,
      )
      .reverse();
    expect(validateEdit(blocks, next, true)).toEqual([]);
  });
});

describe('buildSegments', () => {
  const blocks = withKeys(sampleBlocks);
  const [, given, q1, q2] = blocks as [Block, Block, QuestionBlock, QuestionBlock];

  it('groups given and question blocks into one table after the markdown', () => {
    const segs = buildSegments(blocks, {});
    expect(segs.map((s) => s.kind)).toEqual(['markdown', 'table']);
    expect(segs[1]!.kind === 'table' && segs[1]!.rows.map((r) => r.key)).toEqual([
      given.key,
      q1.key,
      q2.key,
    ]);
  });

  it('never includes the expected answer or a closed tooltip', () => {
    const json = JSON.stringify(buildSegments(blocks, {}));
    expect(json).not.toContain('"expected":"10');
    expect(json).not.toContain('Exemple');
  });

  it('shows state, last value and the opened tooltip', () => {
    const at = new Date();
    const segs = buildSegments(blocks, {
      [q1.key]: {
        solved: false,
        tooltipShown: true,
        tries: [{ try: 1, tooltip: false, value: 12.5, correct: false, at }],
      },
      [q2.key]: {
        solved: true,
        tooltipShown: false,
        tries: [{ try: 1, tooltip: false, value: 'normal', correct: true, at }],
      },
    });
    const rows = segs[1]!.kind === 'table' ? segs[1]!.rows : [];
    expect(rows[1]).toMatchObject({ state: 'ko', tries: 1, value: '12,50' });
    expect(rows[1]!.type === 'question' && rows[1]!.tooltipHtml).toContain('<em>Exemple</em>');
    expect(rows[2]).toMatchObject({ state: 'ok', value: 'normal' });
  });

  it('preview shows expected answers', () => {
    const segs = buildSegments(blocks, {}, { showAnswers: true });
    const rows = segs[1]!.kind === 'table' ? segs[1]!.rows : [];
    expect(rows[1]).toMatchObject({ expected: '10,00' });
  });
});
