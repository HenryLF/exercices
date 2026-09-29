// Reads the school software's CSV export in the browser and turns each pupil into a login
// ("MARTIN Alice" → "m.alice"). Names never leave the admin's computer: only logins are sent.
// Also imported by scripts/migrate.ts and the unit tests, so it has no DOM code.

/** Lowercase letters and digits only. */
export function loginKey(input) {
  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const isUpperWord = (w) => /\p{Lu}/u.test(w) && w === w.toUpperCase();

/**
 * Initial of the last name, a dot, then the first name. The export writes the last name in
 * capitals first ("MARTENS--BILONGO Carlos" → "m.carlos"); a name with no leading capitalised
 * word is read as "First Last" ("Alice Martin" → "m.alice").
 * @param {string} name
 * @returns {string}
 */
export function loginName(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return loginKey(words[0] ?? '');
  let n = 0;
  while (n < words.length - 1 && isUpperWord(words[n])) n++;
  const [first, last] =
    n > 0 ? [words.slice(n), words.slice(0, n)] : [words.slice(0, -1), words.slice(-1)];
  return [loginKey(last.join('')).charAt(0), loginKey(first.join(''))].filter(Boolean).join('.');
}

/**
 * Minimal CSV reader: quoted fields with doubled quotes, `,` or `;` (the one more frequent on
 * the header line), CRLF or LF.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (c) => firstLine.split(c).length - 1;
  const delimiter = count(';') > count(',') ? ';' : ',';
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field.trim() === '') {
      field = '';
      quoted = true;
    } else if (c === delimiter) {
      record.push(field.trim());
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      record.push(field.trim());
      records.push(record);
      record = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || record.length > 0) {
    record.push(field.trim());
    records.push(record);
  }
  return records;
}

const NAME_HEADERS = ['eleves', 'eleve', 'nom', 'nomprenom', 'nometprenom'];

/**
 * The export's pupils as logins, one row per pupil. Only the `Élèves` column is read; the same
 * pupil repeated in the file is reported in `duplicates`.
 * @param {string} text
 * @returns {{ rows: { line: number; login: string }[];
 *   duplicates: { line: number; login: string }[];
 *   errors: { line: number; message: string }[];
 *   fatal?: string }}
 */
export function readExport(text) {
  const records = parseCsv(text.replace(/^\uFEFF/, ''));
  const header = (records[0] ?? []).map(loginKey);
  const nameCol = header.findIndex((h) => NAME_HEADERS.includes(h));
  if (nameCol < 0)
    return {
      rows: [],
      duplicates: [],
      errors: [],
      fatal: 'Colonne introuvable\u00a0: le fichier doit avoir une colonne «\u00a0Élèves\u00a0».',
    };

  const rows = [];
  const duplicates = [];
  const errors = [];
  const seen = new Set();
  records.slice(1).forEach((rec, i) => {
    const line = i + 2;
    const name = (rec[nameCol] ?? '').replace(/\s+/g, ' ').trim();
    if (!name) {
      if (rec.some((cell) => cell.trim())) errors.push({ line, message: 'nom manquant' });
      return;
    }
    const login = loginName(name);
    if (!login) return errors.push({ line, message: 'nom illisible' });
    if (login.length > 40) return errors.push({ line, message: 'nom trop long' });
    // Two different pupils may share a login; the same pupil twice may not.
    const key = loginKey(name);
    if (seen.has(key)) return duplicates.push({ line, login });
    seen.add(key);
    rows.push({ line, login });
  });
  return { rows, duplicates, errors };
}
