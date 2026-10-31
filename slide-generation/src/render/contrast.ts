import { APCAcontrast, sRGBtoY } from 'apca-w3';
/** APCA-W3 0.1.9, base predictor 0.0.98G-4g. Exact constants; numeric output retains polarity.
 * Copyright © 2019–2023 Andrew Somers / Myndex. See assets/APCA-LICENSE.md.
 * Adapted to TypeScript/RGB arrays; string parsers and font lookup are outside this predictor.
 */
export const APCA_VERSION = 'apca-w3-0.1.9/0.0.98G-4g';
export type RGB = [number, number, number];
export function parseHex(value: string): RGB {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (!match) throw new Error('Expected hexadecimal sRGB color');
  const hex = match[1].length === 3 ? [...match[1]].map(c => c + c).join('') : match[1];
  return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)) as RGB;
}
export function blend(top: RGB, alpha: number, bottom: RGB): RGB {
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new Error('Invalid alpha');
  return top.map((v, i) => v * alpha + bottom[i] * (1 - alpha)) as RGB;
}
export function apcaContrast(text: RGB, background: RGB): number {
  if ([...text, ...background].some(v => !Number.isFinite(v) || v < 0 || v > 255)) throw new Error('Invalid sRGB channel');
  return APCAcontrast(sRGBtoY(text), sRGBtoY(background));
}
export function requiredLc(px: number, bold: boolean) { return px >= 36 || bold && px >= 24 ? 45 : px >= 24 || bold ? 60 : 75; }
