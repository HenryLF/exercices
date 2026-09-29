import { questionBlocks, type Block } from './blocks.js';
import type { QuestionStates } from '../models/attempt.js';
import { PROGRESS_LABELS, type AttemptSummary } from './results.js';

export function csvHeader(blocks: readonly Block[]): string[] {
  const cols = [
    'Élève',
    'Classe',
    'Tirage',
    'Statut',
    'Questions résolues',
    'Commencé le (UTC)',
    'Terminé le (UTC)',
  ];
  for (const q of questionBlocks(blocks))
    cols.push(`${q.label} – essais`, `${q.label} – indice`, `${q.label} – résolu`);
  return cols;
}

/** One CSV record. Numbers stay numbers so spreadsheets read them as such. */
export function csvRow(
  blocks: readonly Block[],
  student: { login: string; group: string; seed: string | null },
  summary: AttemptSummary,
  states: QuestionStates,
): (string | number)[] {
  const row: (string | number)[] = [
    student.login,
    student.group,
    student.seed ?? '',
    PROGRESS_LABELS[summary.progress],
    summary.solved,
    summary.startedAt?.toISOString() ?? '',
    summary.completedAt?.toISOString() ?? '',
  ];
  for (const q of questionBlocks(blocks)) {
    const st = states[q.key];
    row.push(st?.tries.length ?? 0, st?.tooltipShown ? 'oui' : 'non', st?.solved ? 'oui' : 'non');
  }
  return row;
}

export function slugFilename(title: string, ext: string, now = new Date()): string {
  const slug =
    title
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'export';
  return `${slug}-${now.toISOString().slice(0, 10)}${ext}`;
}
