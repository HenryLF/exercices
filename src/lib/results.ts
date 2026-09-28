import { questionBlocks, type Block } from './blocks.js';
import type { QuestionStates } from '../models/attempt.js';

export type Progress = 'todo' | 'in_progress' | 'completed';

export const PROGRESS_LABELS: Record<Progress, string> = {
  todo: 'À faire',
  in_progress: 'En cours',
  completed: 'Terminé',
};

export interface AttemptSummary {
  progress: Progress;
  solved: number;
  total: number;
  tries: number;
  tooltips: number;
  startedAt: Date | null;
  completedAt: Date | null;
}

/** One student's standing on one exercise; `attempt` is null when they never opened it. */
export function summarizeAttempt(
  blocks: readonly Block[],
  attempt: { status: string; startedAt: Date; completedAt?: Date | null } | null,
  states: QuestionStates,
): AttemptSummary {
  const questions = questionBlocks(blocks);
  let solved = 0;
  let tries = 0;
  let tooltips = 0;
  for (const q of questions) {
    const st = states[q.key];
    if (!st) continue;
    if (st.solved) solved++;
    if (st.tooltipShown) tooltips++;
    tries += st.tries.length;
  }
  return {
    progress: !attempt ? 'todo' : attempt.status === 'completed' ? 'completed' : 'in_progress',
    solved,
    total: questions.length,
    tries,
    tooltips,
    startedAt: attempt?.startedAt ?? null,
    completedAt: attempt?.completedAt ?? null,
  };
}

export interface AttemptRecord {
  seed?: string | null;
  status: string;
  startedAt: Date;
  completedAt?: Date | null;
  questions?: unknown;
}

/** A student's standing on one exercise across all their attempts (one per seed). */
export interface Standing {
  progress: Progress;
  attempts: number;
  completed: number;
  tries: number;
  tooltips: number;
  /** The latest attempt, the one the student is on. */
  current: AttemptSummary | null;
}

export function standing(
  blocksOf: (seed: string | null | undefined) => readonly Block[],
  attempts: readonly AttemptRecord[],
  states: (a: AttemptRecord) => QuestionStates,
): Standing {
  const sorted = [...attempts].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  let tries = 0;
  let tooltips = 0;
  let completed = 0;
  let current: AttemptSummary | null = null;
  for (const a of sorted) {
    const sum = summarizeAttempt(blocksOf(a.seed), a, states(a));
    current ??= sum;
    tries += sum.tries;
    tooltips += sum.tooltips;
    if (sum.progress === 'completed') completed++;
  }
  return {
    progress: completed > 0 ? 'completed' : current ? 'in_progress' : 'todo',
    attempts: sorted.length,
    completed,
    tries,
    tooltips,
    current,
  };
}
