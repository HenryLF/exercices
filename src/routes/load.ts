import mongoose from 'mongoose';
import { Exercise } from '../models/exercise.js';
import { Group } from '../models/group.js';
import { Student } from '../models/student.js';
import { notFound } from '../lib/http-error.js';

export async function loadExercise(id: string) {
  const exercise = mongoose.isValidObjectId(id) ? await Exercise.findById(id) : null;
  if (!exercise) throw notFound('Exercice');
  return exercise;
}

export async function loadStudent(id: string) {
  const student = mongoose.isValidObjectId(id) ? await Student.findById(id) : null;
  if (!student) throw notFound('Élève');
  return student;
}

export async function loadGroup(id: string) {
  const group = mongoose.isValidObjectId(id) ? await Group.findById(id) : null;
  if (!group) throw notFound('Classe');
  return group;
}

/** { groupId: name } for every group. */
export async function groupNames(): Promise<Map<string, string>> {
  const groups = await Group.find({}, { name: 1 });
  return new Map(groups.map((g) => [g.id as string, g.name]));
}

export const isDuplicateKey = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
