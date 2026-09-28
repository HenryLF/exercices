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

export function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 });
}

export function qrPng(text: string): Promise<Buffer> {
  return QRCode.toBuffer(text, { type: 'png', errorCorrectionLevel: 'M', margin: 2, width: 512 });
}
