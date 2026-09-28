import { describe, expect, it } from 'vitest';
import {
  billingParamsSchema,
  LINES,
  unsolvableLines,
  type LineModes,
  billingBlocks,
  CATALOGUE,
  computeBilling,
  generateBilling,
  randomBillingInput,
  TOOLTIPS,
  TVA_REGIMES,
} from '../../src/lib/generators/billing.js';
import { getGenerator, GENERATORS } from '../../src/lib/generators/index.js';
import { questionBlocks, withKeys } from '../../src/lib/blocks.js';

describe('computeBilling reproduces the PDF', () => {
  it('Exercice I.1: guitare électrique, TVA normale', () => {
    expect(
      computeBilling({ brutC: 102124, remisePct: 4, fraisPct: 2, tvaPerMille: 200, pvHTC: 125000 }),
    ).toEqual({
      brut: 1021.24,
      remise: 40.85,
      net: 980.39,
      frais: 19.61,
      coutHT: 1000,
      tvaDed: 200,
      coutTTC: 1200,
      pvHT: 1250,
      tvaCol: 250,
      pvTTC: 1500,
      coef: 1.5,
      marge: 250,
      tauxMarge: 25,
      tauxMarque: 20,
    });
  });

  it('Exercice I.2: livre de piano, TVA réduite', () => {
    expect(
      computeBilling({ brutC: 4041, remisePct: 2, fraisPct: 1, tvaPerMille: 55, pvHTC: 4550 }),
    ).toEqual({
      brut: 40.41,
      remise: 0.81,
      net: 39.6,
      frais: 0.4,
      coutHT: 40,
      tvaDed: 2.2,
      coutTTC: 42.2,
      pvHT: 45.5,
      tvaCol: 2.5,
      pvTTC: 48,
      coef: 1.2,
      marge: 5.5,
      tauxMarge: 13.75,
      tauxMarque: 12.09,
    });
  });
});

describe('generateBilling', () => {
  it('is deterministic', () => {
    expect(generateBilling('seed-1')).toEqual(generateBilling('seed-1'));
    expect(generateBilling('seed-1')).not.toEqual(generateBilling('seed-2'));
  });

  it('follows the PDF table: 2 given lines, 12 questions with tooltips, in order', () => {
    const ex = generateBilling('order');
    const { product } = randomBillingInput('order');
    const labels = ex.blocks
      .filter((b) => b.type !== 'markdown')
      .map((b) => ('label' in b ? b.label : ''));
    expect(labels).toEqual([
      'Prix d’achat brut',
      'Remise',
      'Prix d’achat net',
      'Frais de livraison',
      'Coût d’achat HT',
      'TVA déductible',
      'Coût d’achat TTC',
      'Prix de vente HT',
      'TVA collectée',
      'Prix de vente TTC',
      'Coefficient multiplicateur TTC',
      'Marge commerciale',
      'Taux de marge',
      'Taux de marque',
    ]);
    const questions = questionBlocks(withKeys(ex.blocks));
    expect(questions).toHaveLength(12);
    for (const q of questions) {
      expect(q.tooltip).toMatch(/Exemple/);
      expect(q.answer).toMatchObject({ type: 'number', decimals: 2, tolerance: 0.01 });
    }
    expect(ex.blocks[0]).toMatchObject({ type: 'markdown' });
    expect((ex.blocks[0] as { body: string }).body).toContain(product.product);
    expect((ex.blocks[0] as { body: string }).body).toContain(TVA_REGIMES[product.tva].label);
  });

  it('generates coherent numbers for many seeds', () => {
    for (let i = 0; i < 300; i++) {
      const { product, input } = randomBillingInput(`s${i}`);
      const r = computeBilling(input);
      expect(input.tvaPerMille).toBe(TVA_REGIMES[product.tva].perMille);
      expect(r.coutHT).toBeGreaterThanOrEqual(product.min * 0.99);
      expect(r.coutHT).toBeLessThanOrEqual(product.max * 1.01 + 5);
      expect(r.pvHT).toBeGreaterThan(r.coutHT);
      expect(r.marge).toBeGreaterThan(0);
      expect(r.remise).toBeGreaterThan(0);
      expect(Number.isInteger(Math.round(r.brut * 100))).toBe(true);
      expect(r.pvTTC).toBeCloseTo(r.pvHT + r.tvaCol, 6);
      expect(r.coutTTC).toBeCloseTo(r.coutHT + r.tvaDed, 6);
    }
  });

  it('every catalogue entry has a known regime and a sane band', () => {
    expect(new Set(CATALOGUE.map((p) => p.id)).size).toBe(CATALOGUE.length);
    for (const p of CATALOGUE) {
      expect(TVA_REGIMES[p.tva]).toBeDefined();
      expect(p.min).toBeLessThan(p.max);
    }
    for (const regime of Object.keys(TVA_REGIMES))
      expect(CATALOGUE.some((p) => p.tva === regime)).toBe(true);
  });

  it('shows the rates as hints and the tooltips never use the exercise numbers', () => {
    const blocks = billingBlocks(CATALOGUE[1]!, {
      brutC: 4041,
      remisePct: 2,
      fraisPct: 1,
      tvaPerMille: 55,
      pvHTC: 4550,
    });
    const hints = blocks.map((b) => ('hint' in b ? b.hint : undefined)).filter(Boolean);
    expect(hints).toEqual(['2\u00a0%', '1\u00a0%', '5,5\u00a0%', '5,5\u00a0%']);
    for (const t of Object.values(TOOLTIPS)) expect(t).not.toContain('40,41');
  });
});

describe('generator registry', () => {
  it('knows billing and nothing else', () => {
    expect(Object.keys(GENERATORS)).toEqual(['billing']);
    expect(getGenerator('billing')?.label).toBe('Calculs commerciaux');
    expect(getGenerator('toString')).toBeUndefined();
  });
  it('asks every line by default and has a settings form', () => {
    const g = getGenerator('billing')!;
    expect(g.paramsSchema.parse({})).toEqual({
      lines: Object.fromEntries(LINES.map((l) => [l.id, 'ask'])),
    });
    expect(g.paramsView).toBe('generate-billing-params');
  });
});

describe('blocksFor', () => {
  const template = { blocks: [], generated: { kind: 'billing', params: {} } };
  it('is deterministic per seed, with the same keys for every seed', async () => {
    const { blocksFor } = await import('../../src/lib/content.js');
    const a = blocksFor(template, 'seed-a');
    expect(blocksFor(template, 'seed-a')).toEqual(a);
    const b = blocksFor(template, 'seed-b');
    expect(b).not.toEqual(a);
    expect(b.map((x) => x.key)).toEqual(a.map((x) => x.key));
    expect(a[0]!.key).toBe('b_00000001');
    expect(blocksFor(template, null)).toEqual([]);
  });
});

describe('line modes', () => {
  const all = (mode: 'ask' | 'give' | 'hide' = 'ask') =>
    Object.fromEntries(LINES.map((l) => [l.id, mode])) as LineModes;
  const guitar = { brutC: 102124, remisePct: 4, fraisPct: 2, tvaPerMille: 200, pvHTC: 125000 };

  it('asked lines become questions, given lines show their value, hidden lines disappear', () => {
    const blocks = billingBlocks(CATALOGUE[0]!, guitar, {
      ...all(),
      remise: 'give',
      net: 'hide',
      tauxMarque: 'give',
    });
    const rows = blocks.filter((b) => b.type !== 'markdown');
    expect(rows.map((b) => ('label' in b ? b.label : ''))).not.toContain('Prix d’achat net');
    expect(rows.find((b) => 'label' in b && b.label === 'Remise')).toEqual({
      type: 'given',
      label: 'Remise',
      hint: '4\u00a0%',
      amount: 40.85,
      unit: '€',
    });
    expect(rows.find((b) => 'label' in b && b.label === 'Taux de marque')).toMatchObject({
      type: 'given',
      amount: 20,
      unit: '%',
    });
    expect(rows.filter((b) => b.type === 'question')).toHaveLength(9);
  });

  it('finds asked lines that cannot be computed', () => {
    expect(unsolvableLines(all())).toEqual([]);
    // Hiding the discount hides its rate: nothing on the purchase side can be computed.
    expect(unsolvableLines({ ...all(), remise: 'hide' })).toEqual(
      expect.arrayContaining(['Prix d’achat net', 'Coût d’achat HT', 'Marge commerciale']),
    );
    // Given instead of hidden, its rate and value are visible again.
    expect(unsolvableLines({ ...all(), remise: 'give' })).toEqual([]);
    // A hidden intermediate is fine when it can be recomputed.
    expect(unsolvableLines({ ...all(), net: 'hide', coutHT: 'hide' })).toEqual([]);
    // Both VAT lines hidden: no VAT rate anywhere.
    expect(unsolvableLines({ ...all(), tvaDed: 'hide', tvaCol: 'hide' })).toEqual([
      'Coût d’achat TTC',
      'Prix de vente TTC',
      'Coefficient multiplicateur TTC',
    ]);
    // A given selling price TTC brings the VAT back for the rest.
    expect(unsolvableLines({ ...all(), tvaDed: 'hide', tvaCol: 'hide', pvTTC: 'give' })).toEqual(
      [],
    );
  });

  it('the schema refuses unsolvable settings and settings without a question', () => {
    const bad = billingParamsSchema.safeParse({ lines: { remise: 'hide' } });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toMatch(/Impossible à calculer.*Prix d’achat net/);
    expect(billingParamsSchema.safeParse({ lines: all('give') }).error?.issues[0]?.message).toBe(
      'Gardez au moins une question.',
    );
    expect(billingParamsSchema.safeParse({ lines: { net: 'bogus' } }).success).toBe(false);
  });
});
