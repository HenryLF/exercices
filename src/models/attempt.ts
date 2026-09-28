import { Schema, model, type InferSchemaType } from 'mongoose';

export interface Try {
  try: number;
  tooltip: boolean;
  value: string | number;
  correct: boolean;
  at: Date;
}

export interface QuestionState {
  solved: boolean;
  tooltipShown: boolean;
  tooltipShownAt?: Date;
  tries: Try[];
}

export type QuestionStates = Record<string, QuestionState>;

export const ATTEMPT_STATUSES = ['in_progress', 'completed'] as const;

const attemptSchema = new Schema(
  {
    exerciseId: { type: Schema.Types.ObjectId, ref: 'Exercise', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    // Generated exercises: the seed the numbers of this attempt were drawn from. A student can
    // start a new seed as often as they like, so there is one attempt per seed. Custom: null.
    seed: { type: String, default: null },
    status: { type: String, required: true, enum: ATTEMPT_STATUSES, default: 'in_progress' },
    // { [blockKey]: QuestionState }. Mixed so tries can be pushed atomically by path.
    questions: { type: Schema.Types.Mixed, required: true, default: {} },
    startedAt: { type: Date, required: true, default: () => new Date() },
    completedAt: { type: Date, default: null },
  },
  { minimize: false },
);

attemptSchema.index({ exerciseId: 1, studentId: 1, seed: 1 }, { unique: true });
attemptSchema.index({ exerciseId: 1, studentId: 1, startedAt: -1 });

export type AttemptDoc = InferSchemaType<typeof attemptSchema>;
export const Attempt = model('Attempt', attemptSchema);

/** The attempt's per-question states, with every field present (partial paths are stored). */
export function questionStates(
  attempt: { questions?: unknown } | null | undefined,
): QuestionStates {
  const raw = (attempt?.questions ?? {}) as Record<string, Partial<QuestionState> | undefined>;
  const out: QuestionStates = {};
  for (const [key, st] of Object.entries(raw)) {
    out[key] = {
      solved: !!st?.solved,
      tooltipShown: !!st?.tooltipShown,
      ...(st?.tooltipShownAt ? { tooltipShownAt: st.tooltipShownAt } : {}),
      tries: Array.isArray(st?.tries) ? st.tries : [],
    };
  }
  return out;
}

export function emptyState(): QuestionState {
  return { solved: false, tooltipShown: false, tries: [] };
}
