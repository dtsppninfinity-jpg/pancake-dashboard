// lib/config.ts — ค่าคงที่ + helper วันที่ (port จาก Config.gs)
// เวลา Pancake เป็นโซนไทย/เวียดนาม (UTC+7) — เราคิดทุกอย่างบนโซน Asia/Bangkok

export const TZ = 'Asia/Bangkok';
export const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** สถานะออเดอร์ POS → ภาษาไทย (รหัสจากเอกสาร Pancake POS API) */
export const ORDER_STATUS_TH: Record<number, string> = {
  0: 'ใหม่', 17: 'รอยืนยัน', 11: 'รอสินค้า', 12: 'รอพิมพ์', 13: 'พิมพ์แล้ว',
  20: 'สั่งซื้อแล้ว', 1: 'ยืนยันแล้ว', 8: 'กำลังแพ็ค', 9: 'รอเข้ารับ',
  2: 'จัดส่งแล้ว', 3: 'ได้รับสินค้า', 16: 'เก็บเงินแล้ว',
  4: 'กำลังตีกลับ', 15: 'ตีกลับบางส่วน', 5: 'ตีกลับ', 6: 'ยกเลิก', 7: 'ลบล่าสุด',
};

/** สถานะที่ "ไม่นับเป็นยอดขาย" (ยกเลิก/ตีกลับ/ลบ) */
export const EXCLUDED_STATUSES = [4, 5, 6, 7, 15];
/** สถานะที่ถือว่า "ต้องตรวจ" (ออเดอร์ใหม่ที่ยังไม่ยืนยัน) */
export const NEED_CHECK_STATUSES = [0, 17];

/**
 * "ออเดอร์เปล่า" ที่ Pancake สร้างอัตโนมัติให้ทุกบทสนทนาที่มาจากแอด
 * — ไม่มีสินค้า ไม่มีราคา ไม่มีเลขที่ออเดอร์ (แค่ customer_id + ad_id)
 * มีถึง 43% ของแถวทั้งตาราง (35,038 จาก 81,015 เมื่อ 2026-07-23) ถ้านับรวมจะทำให้
 * "จำนวนออเดอร์" พองเกินจริงเท่าตัว และ "เฉลี่ย/ออเดอร์" ต่ำผิดปกติ
 * ⚠️ ห้ามตัดด้วย status=0 เฉยๆ — ออเดอร์ใหม่ที่มีของจริงก็เป็น status 0 เหมือนกัน
 */
export function isPlaceholderOrder(o: { items_count?: unknown; total_price?: unknown }): boolean {
  return num(o.items_count) === 0 && num(o.total_price) === 0;
}

/**
 * Pancake เก็บเงินเป็น "หน่วยย่อย" (สตางค์) แม้ order_currency = THB
 * พิสูจน์แล้ว 2 ทาง: (1) ค่าเงินทั้งตาราง 91,760 ค่า หาร 100 ลงตัวทุกค่า ไม่มีข้อยกเว้น
 * (2) ข้อความที่แอดมินพิมพ์เองในแชท ("เก็บปลายทาง 390 บาท") × 100 = total_price ที่เก็บ
 *     (ตรง 503 คู่จาก 510 คู่ที่จับได้ / ไม่มีคู่ไหนตรงแบบไม่หาร)
 * ถ้าวันหนึ่งพบว่า Pancake เปลี่ยนไปเก็บเป็นบาทตรงๆ ให้แก้ค่านี้เป็น 1 ที่เดียวจบ
 */
export const MONEY_SCALE: number = 100;

/** อ่านคอลัมน์เงินจาก DB → บาทจริง (ใช้ทุกที่ที่อ่าน total_price/cod/price) */
export function money_(v: unknown): number {
  return num(v) / MONEY_SCALE;
}

/** เก็บข้อมูลย้อนหลังกี่วันในแต่ละตาราง (งาน prune รายวันจะลบที่เก่ากว่านี้) */
export const RETENTION_DAYS = { ORDERS: 95, CHAT_HOURLY: 60, CONVERSATIONS: 14, ADMIN_CHAT_DAILY: 60, ADMIN_ONLINE_LOG: 35 };

/** credentials อ่านจาก environment (ตั้งใน .env.local หรือ GitHub Secrets) */
export const cfg = {
  posApiKey: process.env.POS_API_KEY || '',
  posShopId: process.env.POS_SHOP_ID || '',
  accessToken: process.env.PANCAKE_ACCESS_TOKEN || '',
};

export function requireCredentials(): void {
  const missing: string[] = [];
  if (!cfg.posApiKey) missing.push('POS_API_KEY');
  if (!cfg.posShopId) missing.push('POS_SHOP_ID');
  if (!cfg.accessToken) missing.push('PANCAKE_ACCESS_TOKEN');
  if (missing.length) throw new Error('ยังไม่ได้ตั้ง env: ' + missing.join(', '));
}

/* ---------------- เวลา / วันที่ (โซน Bangkok) ---------------- */

export function unixSec(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

/** "YYYY-MM-DD" ตามเวลาไทย */
export function fmtDateBkk(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/** "YYYY-MM-DDTHH:mm:ss" ตามเวลาไทย (ไม่ใส่โซน — เก็บเป็น local ไทย) */
export function fmtDateTimeBkk(d: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d).reduce((a, x) => (a[x.type] = x.value, a), {} as Record<string, string>);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/** ต้นวันของ "วันนี้" ตามเวลาไทย → คืน Date (จุดเวลาจริง) */
export function startOfDayBkk(d: Date): Date {
  const ds = fmtDateBkk(d);                 // YYYY-MM-DD ของวันไทย
  return new Date(`${ds}T00:00:00+07:00`);  // เที่ยงคืนไทยของวันนั้น
}

export function daysAgo(n: number): Date {
  return startOfDayBkk(new Date(Date.now() - n * 86400000));
}

/**
 * แปลง timestamp ที่ "ไม่มีโซน" แล้วถือว่าเป็น **เวลาไทย** → Date
 *
 * ⚠️ Pancake ใช้โซนไม่เหมือนกันในแต่ละ endpoint — เลือกฟังก์ชันให้ถูกตัว:
 *   • ใช้ตัวนี้กับ: label ชั่วโมงของ `statistics/pages` (พิสูจน์แล้ว: ขอช่วง 09:00-12:00
 *     เวลาไทย ได้ label 09,10,11 ตรงตัว) และกับสตริงวันที่ที่ "เราสร้างเอง" เช่นค่าจาก
 *     date picker ('2026-07-23T00:00:00') หรือค่าที่อ่านกลับจาก DB (มีโซนต่อท้ายอยู่แล้ว)
 *   • ห้ามใช้กับ: เวลาของออเดอร์ POS และ conversations — พวกนั้นเป็น UTC ใช้ parsePancakeUtc
 */
export function parsePancakeTime(s: unknown): Date | null {
  return parseWithFallback_(s, '+07:00');
}

/**
 * แปลง timestamp ที่ "ไม่มีโซน" แล้วถือว่าเป็น **UTC** → Date
 *
 * ใช้กับ POS `/orders` และ pages `/conversations` เท่านั้น
 * พิสูจน์: ยิง API ตอน UTC 06:00:00 (ไทย 13:00) ได้ updated_at = '2026-07-23T06:00:02'
 * — ตรงกับ UTC ไม่ใช่เวลาไทย เดิมโค้ดเติม '+07:00' ให้ ทำให้ทุกแถวถูกบันทึกเร็วไป 7 ชม.
 * (กราฟยอดขายรายชั่วโมงเลยขึ้นพีคตอนตี 2-4 ซึ่งเป็นไปไม่ได้)
 */
export function parsePancakeUtc(s: unknown): Date | null {
  return parseWithFallback_(s, 'Z');
}

function parseWithFallback_(s: unknown, tzSuffix: string): Date | null {
  if (!s) return null;
  if (s instanceof Date) return s;
  const str = String(s).replace(' ', 'T');
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) {
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }
  const hasTz = /([zZ]|[+-]\d{2}:?\d{2})$/.test(str);
  const iso = hasTz ? str : str.slice(0, 19) + tzSuffix;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/** ISO string (เก็บลง timestamptz) — สำหรับเวลาที่ไม่มีโซนแล้วเป็นเวลาไทย */
export function toIso(s: unknown): string | null {
  const d = parsePancakeTime(s);
  return d ? d.toISOString() : null;
}

/** ISO string (เก็บลง timestamptz) — สำหรับเวลา Pancake ที่เป็น UTC (orders / conversations) */
export function toIsoUtc(s: unknown): string | null {
  const d = parsePancakeUtc(s);
  return d ? d.toISOString() : null;
}

/** date_range param ของ pages API: 'dd/MM/yyyy HH:mm:ss - dd/MM/yyyy HH:mm:ss' (เวลาไทย) */
export function pagesDateRange(from: Date, to: Date): string {
  const f = (d: Date) => {
    const p = new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(d).reduce((a, x) => (a[x.type] = x.value, a), {} as Record<string, string>);
    return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`;
  };
  return `${f(from)} - ${f(to)}`;
}

export function num(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
