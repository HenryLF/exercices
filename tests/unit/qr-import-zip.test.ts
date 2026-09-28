import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
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
  toIsoDate,
  type RowPlan,
} from '../../src/lib/import-students.js';
import { attachment, safeFileName, uniqueFileNames, zipFiles } from '../../src/lib/zip.js';
import { normalizeName } from '../../src/lib/names.js';

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
  it.each(['', 'abc', `${ID}.short`, `${ID}x.${'a'.repeat(43)}`, `../${ID}.${'a'.repeat(43)}`])(
    'rejects malformed token %j',
    (t) => expect(parseLoginToken(t)).toBeNull(),
  );
});

describe('parseStudentsCsv', () => {
  it('reads the sample export: one pupil repeated 15 times', () => {
    const r = parseStudentsCsv(readFileSync('sample/Export CSV.csv'));
    expect(r.fatal).toBeUndefined();
    expect(r.rows).toEqual([{ line: 2, name: 'Alice Martin', dob: '2000-05-03' }]);
    expect(r.duplicates).toHaveLength(14);
    expect(r.errors).toEqual([]);
  });

  it('accepts semicolons, a BOM, quotes and reports bad lines', () => {
    const csv =
      '﻿Nom;"Né(e) le";Classe\n' +
      '"Dupont, Jean";01/02/2009;2A\n' +
      'Zoé Durand;1/2/2009;2A\n' +
      'Sans Date;;2A\n' +
      'Futur;01/01/2999;2A\n' +
      ';;\n';
    const r = parseStudentsCsv(csv);
    expect(r.rows.map((x) => [x.name, x.dob])).toEqual([
      ['Dupont, Jean', '2009-02-01'],
      ['Zoé Durand', '2009-02-01'],
    ]);
    expect(r.errors.map((e) => e.line)).toEqual([4, 5]);
  });

  it('is fatal without the two columns', () => {
    expect(parseStudentsCsv('Prénom,Classe\nA,B\n').fatal).toMatch(/Colonnes introuvables/);
  });

  it('dates', () => {
    expect(toIsoDate('03/05/2000')).toBe('2000-05-03');
    expect(toIsoDate('2000-05-03')).toBe('2000-05-03');
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
    { id: 'a', name: 'Alice Martin', dob: '2000-05-03', groupIds: ['g0'] },
    { id: 'b', name: 'Alice MARTIN', dob: '2001-01-01', groupIds: [] },
    { id: 'c', name: 'Zoé Petit', dob: '2009-01-01', groupIds: [G] },
  ];
  const row = (line: number, name: string, dob: string) => ({ line, name, dob });

  it('sorts rows into new, ask and already', () => {
    const plans = planImport(
      [
        row(2, 'alice martin', '2000-05-03'),
        row(3, 'Alice Martin', '2002-02-02'),
        row(4, 'Zoe Petit', '2009-01-01'),
        row(5, 'Zoé Petit', '2010-10-10'),
        row(6, 'Nouveau', '2010-01-01'),
      ],
      existing,
      G,
    );
    expect(plans.map((p) => p.kind)).toEqual(['ask', 'ask', 'already', 'ask', 'new']);
    const [same, other] = plans as [RowPlan & { kind: 'ask' }, RowPlan & { kind: 'ask' }];
    expect(same.candidates.map((c) => c.id)).toEqual(['a', 'b']);
    expect(same.suggested).toBe('a');
    expect(other.suggested).toBe('new');
  });

  it('resolveChoice accepts only new or a candidate', () => {
    const [p] = planImport([row(2, 'Alice Martin', '2000-05-03')], existing, G) as [
      RowPlan & { kind: 'ask' },
    ];
    expect(resolveChoice(p, 'new')).toBe('new');
    expect(resolveChoice(p, 'b')).toBe('b');
    expect(resolveChoice(p, 'c')).toBe('a');
    expect(resolveChoice(p, undefined)).toBe('a');
  });
});
