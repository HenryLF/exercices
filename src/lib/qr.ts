import { createHmac, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { config } from '../config.js';

// A QR token is `<studentId>.<HMAC(studentId:qrVersion)>`. Nothing is stored: the token can be
// recomputed at any time (QR codes are re-printable and multiple-use) and bumping qrVersion
// invalidates every printed copy.
const TOKEN_RE = /^([0-9a-f]{24})\.([A-Za-z0-9_-]{43})$/;

export function qrSignature(studentId: string, qrVersion: number): string {
  return createHmac('sha256', config.QR_SECRET)
    .update(`${studentId}:${qrVersion}`)
    .digest('base64url');
}

export function loginToken(student: { id: string; qrVersion: number }): string {
  return `${student.id}.${qrSignature(student.id, student.qrVersion)}`;
}

export function loginUrl(student: { id: string; qrVersion: number }): string {
  return `${config.BASE_URL}/login/${loginToken(student)}`;
}

export function parseLoginToken(token: string): { id: string; sig: string } | null {
  const m = TOKEN_RE.exec(token);
  return m ? { id: m[1]!, sig: m[2]! } : null;
}

export function signatureMatches(studentId: string, qrVersion: number, sig: string): boolean {
  const expected = Buffer.from(qrSignature(studentId, qrVersion));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * The 6-digit code printed next to the QR code and typed at login. Derived like the token, so it
 * is never stored and changes with qrVersion. Someone who only saw the QR code (a photo of a
 * screen, a leaked PNG) cannot sign in without it.
 */
export function loginCode(student: { id: string; qrVersion: number }): string {
  const mac = createHmac('sha256', config.QR_SECRET)
    .update(`code:${student.id}:${student.qrVersion}`)
    .digest();
  return String(mac.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

/** '482193' -> '482 193' (non-breaking space), easier to read on paper. */
export function formatCode(code: string): string {
  return `${code.slice(0, 3)}\u00a0${code.slice(3)}`;
}

export function codeMatches(student: { id: string; qrVersion: number }, typed: string): boolean {
  const expected = Buffer.from(loginCode(student));
  const given = Buffer.from(typed.replace(/[\s\u00a0]/g, ''));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 });
}

export function qrPng(text: string): Promise<Buffer> {
  return QRCode.toBuffer(text, { type: 'png', errorCorrectionLevel: 'M', margin: 2, width: 512 });
}
