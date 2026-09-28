import { Schema, model, type InferSchemaType } from 'mongoose';
import { ANSWER_TYPES, BLOCK_TYPES, type Answer, type Block } from '../lib/blocks.js';

export const EXERCISE_STATUSES = ['draft', 'open', 'closed'] as const;
export type ExerciseStatus = (typeof EXERCISE_STATUSES)[number];

const answerSchema = new Schema(
  {
    type: { type: String, required: true, enum: ANSWER_TYPES },
    value: { type: Schema.Types.Mixed, required: true },
    decimals: { type: Number },
    tolerance: { type: Number },
    unit: { type: String },
    options: { type: [String], default: undefined },
  },
  { _id: false },
);

const blockSchema = new Schema(
  {
    key: { type: String, required: true },
    type: { type: String, required: true, enum: BLOCK_TYPES },
    body: { type: String },
    label: { type: String },
    hint: { type: String },
    tooltip: { type: String },
    amount: { type: Number },
    unit: { type: String },
    answer: { type: answerSchema, default: undefined },
  },
  { _id: false },
);

const exerciseSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150, unique: true },
    // 'custom' or a generator kind ('billing').
    kind: { type: String, required: true, default: 'custom' },
    status: { type: String, required: true, enum: EXERCISE_STATUSES, default: 'draft' },
    position: { type: Number, required: true, default: 0 },
    // Generated exercises: may a student start again with new numbers once finished?
    allowRetry: { type: Boolean, required: true, default: true },
    groupIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Group' }], default: [], index: true },
    blocks: { type: [blockSchema], default: [] },
    // Generated exercises are templates: no stored blocks, each attempt draws its own seed.
    generated: {
      type: new Schema(
        { kind: String, params: Schema.Types.Mixed },
        { _id: false, minimize: false },
      ),
      default: undefined,
    },
  },
  { timestamps: true },
);

export type ExerciseDoc = InferSchemaType<typeof exerciseSchema>;
export const Exercise = model('Exercise', exerciseSchema);

type Raw = Record<string, unknown>;

/** Mongoose subdocuments -> plain typed blocks with only the fields their type uses. */
export function plainBlocks(exercise: { blocks: unknown[] }): Block[] {
  return exercise.blocks.map((raw): Block => {
    const r = raw as Raw & { toObject?: () => Raw };
    const o = typeof r.toObject === 'function' ? r.toObject() : r;
    const key = o.key as string;
    const label = o.label as string;
    const hint = o.hint ? { hint: o.hint as string } : {};
    if (o.type === 'markdown') return { key, type: 'markdown', body: o.body as string };
    if (o.type === 'given')
      return {
        key,
        type: 'given',
        label,
        ...hint,
        amount: o.amount as number,
        ...(o.unit ? { unit: o.unit as string } : {}),
      };
    const a = o.answer as Raw;
    const answer: Answer =
      a.type === 'enum'
        ? { type: 'enum', options: [...(a.options as string[])], value: a.value as string }
        : {
            type: 'number',
            value: a.value as number,
            decimals: (a.decimals as number | undefined) ?? 2,
            tolerance: (a.tolerance as number | undefined) ?? 0,
            ...(a.unit ? { unit: a.unit as string } : {}),
          };
    return {
      key,
      type: 'question',
      label,
      ...hint,
      ...(o.tooltip ? { tooltip: o.tooltip as string } : {}),
      answer,
    };
  });
}
