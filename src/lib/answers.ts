import type { Answer } from './blocks.js';

const amount = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const plain = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 6 });

/**
 * A number as typed by a French student: `12,34`, `12.34`, `1 021,24`, `45,50 €`, `12 %`.
 * Returns null when the input is not one number.
 */
export function parseNumber(raw: string): number | null {
  const s = raw
    .trim()
    .replace(/\s*[€%]$/u, '')
    .replace(/[\s\u00a0\u202f]/gu, '')
    .replace(',', '.');
  if (!/^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((n + Number.EPSILON * Math.sign(n)) * f) / f;
}

export type CheckResult =
  { ok: true; value: string | number; correct: boolean } | { ok: false; message: string };

/**
 * Grades one answer. Blank or unparsable input is not a try (`ok: false`); the route re-renders
 * the form with the message and records nothing.
 */
export function checkAnswer(answer: Answer, raw: unknown): CheckResult {
  const input = typeof raw === 'string' ? raw.trim() : '';
  if (input === '') return { ok: false, message: 'Saisissez une réponse' };
  if (answer.type === 'enum') {
    if (!answer.options.includes(input))
      return { ok: false, message: 'Choisissez une des options proposées' };
    return { ok: true, value: input, correct: input === answer.value };
  }
  const n = parseNumber(input);
  if (n === null) return { ok: false, message: 'Saisissez un nombre, par exemple 12,50' };
  const value = roundTo(n, answer.decimals);
  // The epsilon absorbs binary rounding (0.1 + 0.2) so that a tolerance of 0 means "equal".
  const correct = Math.abs(value - answer.value) <= answer.tolerance + 1e-9;
  return { ok: true, value, correct };
}

/** 1250 -> '1 250,00' (2 decimals, fr-FR). */
export function formatAmount(n: number): string {
  return amount.format(n);
}

/** A stored try value or expected answer for display. */
export function formatValue(v: string | number, decimals?: number): string {
  if (typeof v === 'string') return v;
  return decimals === 2 ? amount.format(v) : plain.format(v);
}
