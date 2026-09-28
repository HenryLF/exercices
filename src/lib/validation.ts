import type { z } from 'zod';

/** Zod issues as { 'path.to.field': 'first message' }. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '_';
    out[key] ??= issue.message;
  }
  return out;
}

/** Form fields that may come as one value or many (checkboxes) -> always an array of strings. */
export function asArray(v: unknown): string[] {
  if (v === undefined || v === null || v === '') return [];
  return (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === 'string');
}

/**
 * qs turns `rows[0][x]` into an array, but into an object once indexes exceed its array limit
 * or have gaps. Accept both, in index order.
 */
export function asIndexedList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') {
    return Object.entries(v)
      .filter(([k]) => /^\d+$/.test(k))
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, x]) => x);
  }
  return [];
}
