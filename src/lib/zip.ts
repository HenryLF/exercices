import { zipSync } from 'fflate';

/** A person's name as a portable file name: no path or reserved characters, NFC. */
export function safeFileName(name: string): string {
  return (
    name
      .normalize('NFC')
      .replace(/[/\\:*?"<>|]|\p{Cc}/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 150) || 'eleve'
  );
}

/** `<name>.png` for each file, ` (2)`, ` (3)`... on collisions. */
export function uniqueFileNames(names: string[], ext: string): string[] {
  const used = new Set<string>();
  return names.map((n) => {
    const base = safeFileName(n);
    let file = `${base}${ext}`;
    for (let i = 2; used.has(file.toLowerCase()); i++) file = `${base} (${i})${ext}`;
    used.add(file.toLowerCase());
    return file;
  });
}

/** PNGs are already compressed: store them as-is. */
export function zipFiles(files: { name: string; data: Uint8Array }[]): Buffer {
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const f of files) entries[f.name] = [f.data, { level: 0 }];
  return Buffer.from(zipSync(entries));
}

/** RFC 6266 Content-Disposition with a UTF-8 file name and an ASCII fallback. */
export function attachment(fileName: string): string {
  const ascii = fileName
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
