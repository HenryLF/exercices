import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  codeMatches,
  formatCode,
  loginCode,
  loginToken,
  loginUrl,
  parseLoginToken,
  qrSignature,
  signatureMatches,
} from '../../src/lib/qr.js';
import {
  parseStudentsCsv,
  planImport,
  resolveChoice,
  type RowPlan,
} from '../../src/lib/import-students.js';
import { attachment, safeFileName, uniqueFileNames, zipFiles } from '../../src/lib/zip.js';
import { normalizeName } from '../../src/lib/names.js';
import { EXPORT_CSV } from '../helpers.js';

const ID = '0123456789abcdef01234567';

describe('QR tokens', () => {
  it('are stable, versioned and verifiable', () => {
    expect(qrSignature(ID, 1)).toBe(qrSignature(ID, 1));
    expect(qrSignature(ID, 1)).not.toBe(qrSignature(ID, 2));
    const token = loginToken({ id: ID, qrVersion: 3 });
    const parsed = parseLoginToken(token)!;
    expect(parsed.id).toBe(ID);
    expect(signatureMatches(ID, 3, parsed.sig)).toBe(true);
    expect(signatureMatches(ID, 2, parsed.sig)).toBe(false);
    expect(loginUrl({ id: ID, qrVersion: 3 })).toBe(`http://exercices.test/login/${token}`);
  });
  it('derive a 6-digit login code that changes with the QR version', () => {
    const code = loginCode({ id: ID, qrVersion: 1 });
    expect(code).toMatch(/^\d{6}$/);
    expect(loginCode({ id: ID, qrVersion: 1 })).toBe(code);
    expect(loginCode({ id: ID, qrVersion: 2 })).not.toBe(code);
    expect(formatCode('482193')).toBe('482\u00a0193');
    expect(codeMatches({ id: ID, qrVersion: 1 }, ` ${formatCode(code)} `)).toBe(true);
    expect(codeMatches({ id: ID, qrVersion: 2 }, code)).toBe(false);
    expect(codeMatches({ id: ID, qrVersion: 1 }, `${code}0`)).toBe(false);
    expect(codeMatches({ id: ID, qrVersion: 1 }, '')).toBe(false);
  });
  it.each(['', 'abc', `${ID}.short`, `${ID}x.${'a'.repeat(43)}`, `../${ID}.${'a'.repeat(43)}`])(
    'rejects malformed token %j',
    (t) => expect(parseLoginToken(t)).toBeNull(),
  );
});

describe('parseStudentsCsv', () => {
  it('reads the school software export: one pupil repeated 15 times', () => {
    const r = parseStudentsCsv(EXPORT_CSV);
    expect(r.fatal).toBeUndefined();
    expect(r.rows).toEqual([{ line: 2, name: 'Alice Martin' }]);
    expect(r.duplicates).toHaveLength(14);
    expect(r.errors).toEqual([]);
  });

  it('accepts semicolons, a BOM, quotes and reports bad lines', () => {
    const csv =
      '﻿Nom;"Né(e) le";Classe\n' +
      '"Dupont, Jean";01/02/2009;2A\n' +
      'Zoé Durand;;2A\n' +
      ';01/01/2009;2A\n' +
      'zoe  DURAND;02/02/2010;2A\n' +
      ';;\n';
    const r = parseStudentsCsv(csv);
    expect(r.rows.map((x) => x.name)).toEqual(['Dupont, Jean', 'Zoé Durand']);
    expect(r.errors.map((e) => e.line)).toEqual([4]);
    expect(r.duplicates.map((d) => d.line)).toEqual([5]);
  });

  it('is fatal without a name column', () => {
    expect(parseStudentsCsv('Prénom,Classe\nA,B\n').fatal).toMatch(/Colonne introuvable/);
  });

  it('normalizeName ignores case, accents, hyphens and spacing', () => {
    expect(normalizeName('  Élodie-Anne  MARTIN ')).toBe(normalizeName('elodie anne martin'));
  });
});

describe('zip helpers', () => {
  it('sanitises and deduplicates file names', () => {
    expect(safeFileName('A/B\\C:*?"<>|\u0007 d  e')).toBe('ABC d e');
    expect(uniqueFileNames(['Alice Martin', 'alice martin', 'Bob'], '.png')).toEqual([
      'Alice Martin.png',
      'alice martin (2).png',
      'Bob.png',
    ]);
  });
  it('zips files that unzip identically', () => {
    const data = new Uint8Array([137, 80, 78, 71]);
    const out = unzipSync(zipFiles([{ name: 'Élodie.png', data }]));
    expect(Object.keys(out)).toEqual(['Élodie.png']);
    expect([...out['Élodie.png']!]).toEqual([...data]);
  });
  it('builds an RFC 6266 attachment header', () => {
    expect(attachment('Élodie "M".png')).toBe(
      `attachment; filename="Elodie M.png"; filename*=UTF-8''%C3%89lodie%20%22M%22.png`,
    );
  });
});

describe('planImport', () => {
  const G = 'g1';
  const existing = [
    { id: 'a', name: 'Alice Martin', groupIds: ['g0'] },
    { id: 'b', name: 'Alice MARTIN', groupIds: [] },
    { id: 'c', name: 'Zoé Petit', groupIds: [G] },
  ];
  const row = (line: number, name: string) => ({ line, name });

  it('sorts rows into new, ask and already', () => {
    const plans = planImport(
      [row(2, 'alice martin'), row(3, 'Zoe Petit'), row(4, 'Nouveau')],
      existing,
      G,
    );
    expect(plans.map((p) => p.kind)).toEqual(['ask', 'already', 'new']);
    const [same] = plans as [RowPlan & { kind: 'ask' }];
    expect(same.candidates.map((c) => c.id)).toEqual(['a', 'b']);
    // The oldest student with this name is suggested.
    expect(same.suggested).toBe('a');
  });

  it('resolveChoice accepts only new or a candidate', () => {
    const [p] = planImport([row(2, 'Alice Martin')], existing, G) as [RowPlan & { kind: 'ask' }];
    expect(resolveChoice(p, 'new')).toBe('new');
    expect(resolveChoice(p, 'b')).toBe('b');
    expect(resolveChoice(p, 'c')).toBe('a');
    expect(resolveChoice(p, undefined)).toBe('a');
  });
});
