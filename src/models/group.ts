import { Schema, model, type InferSchemaType } from 'mongoose';

const groupSchema = new Schema(
  { name: { type: String, required: true, trim: true, maxlength: 100, unique: true } },
  { timestamps: true },
);

export type GroupDoc = InferSchemaType<typeof groupSchema>;
export const Group = model('Group', groupSchema);
