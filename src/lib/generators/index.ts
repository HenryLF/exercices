import type { z } from 'zod';
import type { NewBlock } from '../blocks.js';
import { billingGenerator } from './billing.js';

/** What a generator produces for one seed; block keys are assigned by `withStableKeys`. */
export interface ExerciseInput {
  blocks: NewBlock[];
}

/**
 * One family of generated exercises. `generate` is pure and deterministic: the same seed and
 * params always give the same exercise. To add a family, follow docs/GENERATORS.md.
 */
export interface Generator<P> {
  kind: string;
  label: string;
  description: string;
  paramsSchema: z.ZodType<P>;
  /** Settings form partial under views/admin (e.g. 'generate-foo-params'), or null if the
   * family has no settings. */
  paramsView: string | null;
  /** Suggested exercise name for these params (made unique by the route). */
  defaultName(params: P): string;
  /** One-line summary of the params, for the admin pages. */
  describeParams(params: P): string;
  /** Data the generator's form view needs (select options...). */
  formData(): Record<string, unknown>;
  generate(seed: string, params: P): ExerciseInput;
}

export const GENERATORS: Record<string, Generator<unknown>> = {
  [billingGenerator.kind]: billingGenerator as Generator<unknown>,
};

export function getGenerator(kind: string): Generator<unknown> | undefined {
  return Object.hasOwn(GENERATORS, kind) ? GENERATORS[kind] : undefined;
}

export const KIND_LABELS: Record<string, string> = {
  custom: 'Personnalisé',
  ...Object.fromEntries(Object.values(GENERATORS).map((g) => [g.kind, g.label])),
};
