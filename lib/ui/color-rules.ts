// lib/ui/color-rules.ts — กติกาสีกลางของตัวเลขทั้งเว็บ (ตรวจ UI ข้อ E3 + B3)
//
// ทำไมต้องมีไฟล์นี้: เดิมแต่ละหน้าตัดสีเอง เกณฑ์ไม่ตรงกัน (หน้าหนึ่ง 80% = ส้ม อีกหน้า 80% = แดง)
// และใช้สีเขียวกับตัวเลขที่ไม่ได้ตัดสินอะไรเลย (เช่น ยอดขายเฉยๆ) — คนดูเลยแยกไม่ออกว่าเขียว = "ดี" หรือ "แค่ตกแต่ง"
//
// กติกา
// - เขียว = ดี/ถึงเกณฑ์ เท่านั้น · ส้ม = เฝ้าดู · แดง = ต้องแก้ · ไม่มีสี = ข้อมูลเฉยๆ หรือยังตัดสินไม่ได้
// - ตัวเลขที่ไม่ได้ตัดสินอะไร (ยอดขาย ค่าแอด จำนวนคน) ใช้ .v-plain (ตัวหนาสีปกติ) ห้ามใส่เขียว
// - คอลัมน์ที่ตัดสินสี ต้องมีบรรทัดอธิบายสีใต้หัวตาราง: legendHtml(LEGEND.attain) ฯลฯ
// - ฟังก์ชันในนี้คืน "ชนิด" (good/warn/bad/none) — แปลงเป็นคลาสด้วย kindClass() / sigClass()
//   หน้าไหนอยากได้ป้ายสถานะ ใช้ statusKindOf() ต่อกับ statusPill() ของ lib/ui/icons.ts
//
// ⚠️ ไฟล์นี้ pure ห้ามแตะ window/document ตอน import (ฝั่ง server อาจ import ผ่าน helpers ในอนาคต)

import { esc } from '@/lib/ui/helpers';
import type { StatusKind } from '@/lib/ui/icons';

export type ColorKind = 'good' | 'warn' | 'bad' | 'none';

/** %เทียบเป้า: ตั้งแต่ 100 = เขียว · 80–99.99 = ส้ม · ต่ำกว่า 80 = แดง (ตัวเลข 2 ตัวนี้พีเคาะเปลี่ยนได้ที่นี่ที่เดียว) */
export const ATTAIN_GOOD = 100;
export const ATTAIN_WARN = 80;

/** %ปิด: เป้าทีม 40% · ต่ำกว่า 33% = เส้น "เสี่ยง" ตามชีท KPI (สัดส่วน 33/40 ใช้กับเป้าอื่นด้วย) */
export const CLOSE_TARGET = 40;
const CLOSE_WARN_RATIO = 33 / 40;

const isNum = (n: unknown): n is number => typeof n === 'number' && isFinite(n);

/** แปลงค่าที่อาจเป็น string/null ให้เป็นตัวเลข — ค่าว่างถือว่า "ไม่มีข้อมูล" ไม่ใช่ 0
 *  (กับดักจากชีททีม: เซลล์ว่าง ≠ 0 — ถ้าตีเป็น 0 จะกลายเป็นป้ายแดงทั้งที่แค่ยังไม่ได้กรอก) */
function num(n: unknown): number | null {
  if (n === null || n === undefined || n === '') return null;
  const v = Number(n);
  return isFinite(v) ? v : null;
}

/** ตัดสินเปอร์เซ็นต์ที่ "คิดเทียบเป้ามาแล้ว" เช่น u.attain = 85.3 → 'warn' */
export function pctKind(pct: number | null | undefined): ColorKind {
  const p = num(pct);
  if (p === null) return 'none';
  return p >= ATTAIN_GOOD ? 'good' : p >= ATTAIN_WARN ? 'warn' : 'bad';
}

/**
 * ยอดจริงเทียบเป้า → good / warn / bad / none
 * - ไม่มีเป้า (ว่าง/0) หรือไม่มียอด = 'none' (ไม่ระบายสี ดีกว่าระบายผิด)
 * - opts.pace = สัดส่วนเวลาที่ผ่านไปของช่วงนั้น (0–1 เช่น ผ่านไป 10 จาก 30 วัน = 0.333)
 *   ใส่เมื่อเดือนยังไม่จบ: เทียบกับ "เป้าตามแผนถึงวันนี้" แทนเป้าเต็มเดือน ไม่งั้นต้นเดือนทุกยูนิตแดงหมด
 *   (ส่งเป็นเปอร์เซ็นต์ เช่น 33.3 ก็รับได้ — ค่าที่เกิน 1 จะถูกหารด้วย 100)
 * - หน้าที่ใช้ pace ต้องเขียนกำกับใต้ตาราง: legendHtml(LEGEND.attainPace)
 */
export function attainKind(
  actual: number | null | undefined,
  target: number | null | undefined,
  opts?: { pace?: number },
): ColorKind {
  const a = num(actual), t = num(target);
  if (a === null || t === null || t <= 0) return 'none';
  let expected = t;
  if (opts && isNum(opts.pace)) {
    let p = opts.pace > 1 ? opts.pace / 100 : opts.pace;
    p = Math.max(0, Math.min(1, p));
    if (p <= 0) return 'none';          // ยังไม่เริ่มช่วง = ยังตัดสินไม่ได้
    expected = t * p;
  }
  return pctKind((a / expected) * 100);
}

/**
 * ROAS เทียบจุดคุ้มทุนของยูนิต → ถึงจุดคุ้มทุน = good · ต่ำกว่า = bad · ไม่มีจุดคุ้มทุน = none
 * warnBand (ไม่บังคับ) = ช่วงเผื่อเป็นสัดส่วน เช่น 0.1 → ต่ำกว่าจุดคุ้มทุนไม่เกิน 10% ขึ้นส้มแทนแดง
 * ค่าเริ่มต้น 0 = 2 ระดับ ตรงกับที่หน้า Sales / ผลงานรายยูนิตใช้อยู่เดิม
 */
export function roasKind(roas: number | null | undefined, breakeven: number | null | undefined, warnBand = 0): ColorKind {
  const r = num(roas), b = num(breakeven);
  if (r === null || b === null || b <= 0) return 'none';
  if (r >= b) return 'good';
  if (warnBand > 0 && r >= b * (1 - warnBand)) return 'warn';
  return 'bad';
}

/** %ปิด (หน่วยเปอร์เซ็นต์ เช่น 38.5) → ถึงเป้า = good · ตั้งแต่ 33% (เส้นเสี่ยงของชีท KPI) = warn · ต่ำกว่า = bad */
export function closeRateKind(rate: number | null | undefined, target: number = CLOSE_TARGET): ColorKind {
  const r = num(rate);
  if (r === null || !isNum(target) || target <= 0) return 'none';
  if (r >= target) return 'good';
  return r >= target * CLOSE_WARN_RATIO ? 'warn' : 'bad';
}

/** กำไร/ขาดทุน: บวก = good · ติดลบ = bad · ศูนย์หรือไม่มีข้อมูล = none */
export function profitKind(n: number | null | undefined): ColorKind {
  const v = num(n);
  if (v === null || v === 0) return 'none';
  return v > 0 ? 'good' : 'bad';
}

/** ชนิด → คลาสสีตัวเลข (.v-good / .v-warn / .v-bad) · 'none' = '' */
export function kindClass(kind: ColorKind): string {
  return kind === 'good' ? 'v-good' : kind === 'warn' ? 'v-warn' : kind === 'bad' ? 'v-bad' : '';
}

/** ชนิด → แถบสีซ้ายของแถว/การ์ด (B3: เลิกทาพื้นทั้งแถวเป็นสีแดง/ชมพู) · good/none = '' (แถวปกติไม่ต้องมีแถบ) */
export function sigClass(kind: ColorKind): string {
  return kind === 'bad' ? 'sig-bad' : kind === 'warn' ? 'sig-warn' : '';
}

/** ชนิด → ชนิดของป้ายสถานะใน icons.ts (statusPill / statusDot) */
export function statusKindOf(kind: ColorKind): StatusKind {
  return kind === 'none' ? 'muted' : kind;
}

/**
 * ครอบตัวเลขด้วยสีตามชนิด — kind 'none' ได้ .v-plain (ตัวหนาสีปกติ) ไม่ใช่สีเขียว
 * valueHtml ต้อง escape มาแล้ว (ส่วนใหญ่เป็นผลของ THB()/pct2() ซึ่งปลอดภัยอยู่แล้ว)
 */
export function colorVal(valueHtml: string, kind: ColorKind): string {
  return '<span class="' + (kindClass(kind) || 'v-plain') + '">' + valueHtml + '</span>';
}

/**
 * ระดับสีพื้นจางๆ ของช่องตาราง (heat map — ตรวจ UI ข้อ G2 ตารางกำไรยูนิต × เดือน)
 * scale = ค่าสัมบูรณ์ที่ใหญ่สุดของตาราง (หรือค่าอ้างอิงที่เลือกเอง) แบ่ง 3 ขั้นเท่าๆ กัน
 * บวก → heat-p1..p3 · ลบ → heat-n1..n3 · ศูนย์/ไม่มีข้อมูล → '' (ช่องว่างต้องไม่ถูกระบายเหมือนขาดทุน)
 */
export function heatClass(v: number | null | undefined, scale: number): string {
  const x = num(v);
  if (x === null || x === 0 || !isNum(scale) || scale <= 0) return '';
  const r = Math.min(1, Math.abs(x) / scale);
  const lv = r > 2 / 3 ? 3 : r > 1 / 3 ? 2 : 1;
  return (x > 0 ? 'heat-p' : 'heat-n') + lv;
}

/** บรรทัดอธิบายสี (ภาษาคน บรรทัดเดียว) — ใส่ใต้หัวตารางที่ตัดสินสี ผ่าน legendHtml() */
export const LEGEND = {
  attain: 'สี: เขียว = ถึงเป้า (100% ขึ้นไป) • ส้ม = 80–99% • แดง = ต่ำกว่า 80%',
  attainPace: 'สี: เทียบกับเป้าตามจำนวนวันที่ผ่านไป — เขียว = ทันแผน • ส้ม = ได้ 80–99% ของแผน • แดง = ต่ำกว่า 80%',
  attainProjected: 'สี: ตัดสินจากยอดคาดการณ์สิ้นเดือน — เขียว = คาดว่าถึงเป้า • ส้ม = 80–99% • แดง = ต่ำกว่า 80%',
  roas: 'สี: เขียว = ROAS ถึงจุดคุ้มทุนของยูนิต • แดง = ต่ำกว่าจุดคุ้มทุน • ไม่มีสี = ยังไม่ได้ตั้งจุดคุ้มทุน',
  closeRate: 'สี: เขียว = %ปิดถึง 40% • ส้ม = 33–39.99% • แดง = ต่ำกว่า 33%',
  profit: 'สี: เขียว = กำไร • แดง = ขาดทุน • ไม่มีสี = ยังไม่มีข้อมูลในชีท',
  heat: 'สีพื้น: ยิ่งเข้มยิ่งกำไร (เขียว) หรือยิ่งขาดทุน (แดง) มาก • หน่วย: บาท (K = พัน)',
} as const;

/** บรรทัดอธิบายสี %ปิด เมื่อเป้าไม่ใช่ 40% */
export function closeRateLegend(target: number = CLOSE_TARGET): string {
  const warnFloor = Math.round(target * CLOSE_WARN_RATIO * 100) / 100;
  return 'สี: เขียว = %ปิดถึง ' + target + '% • ส้ม = ' + warnFloor + '% ขึ้นไปแต่ยังไม่ถึงเป้า • แดง = ต่ำกว่า ' + warnFloor + '%';
}

/** บรรทัดเล็กสีจางใต้หัวตาราง (.color-legend) — text เป็นข้อความธรรมดา จะถูก escape ให้ */
export function legendHtml(text: string): string {
  return '<div class="color-legend">' + esc(text) + '</div>';
}
