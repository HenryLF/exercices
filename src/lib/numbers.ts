import type { ExerciseStatus } from '../models/exercise.js';

const number = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 10 });

/** 3.5 -> '3,5' for display. Stored values and the CSV keep JavaScript numbers. */
export function formatNumber(n: number): string {
  return number.format(n);
}

export const STATUS_LABELS: Record<ExerciseStatus, string> = {
  draft: 'Brouillon',
  open: 'Ouvert',
  closed: 'Fermé',
};
