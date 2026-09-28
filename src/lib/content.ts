import { randomBytes } from 'node:crypto';
import { withStableKeys, type Block } from './blocks.js';
import { getGenerator } from './generators/index.js';
import { plainBlocks } from '../models/exercise.js';

export interface ExerciseLike {
  blocks: unknown[];
  generated?: { kind?: string | null; params?: unknown } | null;
}

export const newSeed = () => randomBytes(8).toString('hex');

/** Seeds the admin may type in the preview: what newSeed makes, plus short test-style seeds. */
export const SEED_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isGenerated(exercise: ExerciseLike): boolean {
  return !!exercise.generated?.kind;
}

/**
 * The blocks a student sees: stored blocks for a custom exercise, or the generator's output for
 * the attempt's seed. Generation is deterministic, so the same seed always gives the same numbers.
 */
export function blocksFor(exercise: ExerciseLike, seed: string | null | undefined): Block[] {
  if (!isGenerated(exercise)) return plainBlocks(exercise);
  const generator = getGenerator(exercise.generated!.kind!);
  if (!generator || !seed) return [];
  const params = generator.paramsSchema.parse(exercise.generated!.params ?? {});
  return withStableKeys(generator.generate(seed, params).blocks);
}

/** Question labels of an exercise, for result tables (any seed gives the same structure). */
export function templateBlocks(exercise: ExerciseLike): Block[] {
  return blocksFor(exercise, isGenerated(exercise) ? 'template' : null);
}
