import { z } from 'zod';

/** A calendar date as sent by <input type="date">: YYYY-MM-DD, real, not in the future. */
export const dobSchema = z
  .string({ error: 'La date de naissance est obligatoire' })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La date de naissance doit être une date')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, 'Cette date de naissance n’existe pas')
  .refine(
    (s) => s <= new Date().toISOString().slice(0, 10),
    'La date de naissance est dans le futur',
  )
  .refine((s) => s >= '1900-01-01', 'La date de naissance est trop ancienne');

const dateTime = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  dateStyle: 'short',
  timeStyle: 'short',
});

export function formatDateTime(d: Date | null | undefined): string {
  return d ? dateTime.format(d) : '';
}

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY' */
export function formatDob(dob: string): string {
  const [y, m, d] = dob.split('-');
  return `${d}/${m}/${y}`;
}
