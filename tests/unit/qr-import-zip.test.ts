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
  parseImportPayload,
  planImport,
  resolveChoice,
  sameBase,
  type RowPlan,
} from '../../src/lib/import-students.js';
import { attachment, safeFileName, uniqueFileNames, zipFiles } from '../../src/lib/zip.js';
import { freeLogin } from '../../src/lib/names.js';
import { loginKey, loginName, readExport } from '../../public/import-csv.js';
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

describe('readExport (runs in the browser)', () => {
  it('reads the school software export: one pupil repeated 15 times', () => {
    const r = readExport(EXPORT_CSV);
    expect(r.fatal).toBeUndefined();
    expect(r.rows).toEqual([{ line: 2, login: 'm.alice' }]);
    expect(r.duplicates).toHaveLength(14);
    expect(r.errors).toEqual([]);
    // Only logins come out: no name, no other column.
    expect(JSON.stringify(r)).not.toMatch(/Martin|2000/);
  });

  it('accepts semicolons, a BOM, quotes and reports bad lines', () => {
    const csv =
      '﻿Nom;"Né(e) le";Classe\n' +
      '"DUPONT; Jean ""Jo""";01/02/2009;2A\n' +
      'DURAND Zoé;;2A\r\n' +
      ';01/01/2009;2A\n' +
      'DURAND  zoé;02/02/2010;2A\n' +
      'DUVAL Zoé;;2A\n' +
      ';;\n';
    const r = readExport(csv);
    expect(r.rows).toEqual([
      { line: 2, login: 'd.jeanjo' },
      { line: 3, login: 'd.zoe' },
      { line: 6, login: 'd.zoe' },
    ]);
    expect(r.errors.map((e) => e.line)).toEqual([4]);
    expect(r.duplicates).toEqual([{ line: 5, login: 'd.zoe' }]);
  });

  it('is fatal without a name column', () => {
    expect(readExport('Prénom,Classe\nA,B\n').fatal).toMatch(/Colonne introuvable/);
  });

  it('loginName is the initial of the last name, a dot, then the first name', () => {
    expect(loginName('MARTIN Alice')).toBe('m.alice');
    expect(loginName('MARTENS--BILONGO Carlos')).toBe('m.carlos');
    expect(loginName('DE LA FONTAINE Jean-Pierre')).toBe('d.jeanpierre');
    expect(loginName('ÉTIENNE Zoé Anne')).toBe('e.zoeanne');
    expect(loginName('Alice Martin')).toBe('m.alice');
    expect(loginName('ALICE MARTIN')).toBe('a.martin');
    expect(loginName('Parti')).toBe('parti');
    expect(loginKey(' Alice-M ')).toBe('alicem');
  });
});

describe('logins on the server', () => {
  it('freeLogin adds the first free number', () => {
    expect(freeLogin('m.alice', new Set())).toBe('m.alice');
    expect(freeLogin('m.alice', new Set(['m.alice', 'm.alice2']))).toBe('m.alice3');
  });

  it('sameBase matches numeric suffixes only', () => {
    expect(sameBase('m.alice2', 'm.alice')).toBe(true);
    expect(sameBase('m.alice', 'm.alice')).toBe(true);
    expect(sameBase('m.alicea', 'm.alice')).toBe(false);
  });

  it('parseImportPayload refuses anything but logins', () => {
    const ok = { rows: [{ line: 2, login: 'm.alice' }], duplicates: [], errors: [] };
    expect(parseImportPayload(JSON.stringify(ok))).toEqual(ok);
    for (const login of ['Alice Martin', 'm..alice', 'm.a.lice', '.alice', 'x'.repeat(41)]) {
      const bad = { ...ok, rows: [{ line: 2, login }] };
      expect(parseImportPayload(JSON.stringify(bad))).toBeNull();
    }
    expect(parseImportPayload('{')).toBeNull();
    expect(parseImportPayload(undefined)).toBeNull();
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
    { id: 'a', login: 'm.alice', groupIds: ['g0'] },
    { id: 'b', login: 'm.alice2', groupIds: [] },
    { id: 'c', login: 'p.zoe', groupIds: [G] },
  ];
  const row = (line: number, login: string) => ({ line, login });

  it('sorts rows into new, ask and already', () => {
    const plans = planImport(
      [row(2, 'm.alice'), row(3, 'p.zoe'), row(4, 'v.nouveau'), row(5, 'p.zoe')],
      existing,
      G,
    );
    // The second p.zoe of the file is another pupil: the class has only one.
    expect(plans.map((p) => p.kind)).toEqual(['ask', 'already', 'new', 'new']);
    const [same] = plans as [RowPlan & { kind: 'ask' }];
    expect(same.candidates.map((c) => c.id)).toEqual(['a', 'b']);
    // The oldest student with this login is suggested.
    expect(same.suggested).toBe('a');
  });

  it('resolveChoice accepts only new or a candidate', () => {
    const [p] = planImport([row(2, 'm.alice')], existing, G) as [RowPlan & { kind: 'ask' }];
    expect(resolveChoice(p, 'new')).toBe('new');
    expect(resolveChoice(p, 'b')).toBe('b');
    expect(resolveChoice(p, 'c')).toBe('a');
    expect(resolveChoice(p, undefined)).toBe('a');
  });
});
