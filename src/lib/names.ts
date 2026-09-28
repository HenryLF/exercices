/** Case-, accent- and spacing-insensitive form of a person's name, used to match logins. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[\s\-']+/g, ' ')
    .trim();
}
