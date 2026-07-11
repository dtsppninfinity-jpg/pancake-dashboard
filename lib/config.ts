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
 * แปลง timestamp จาก Pancake ("2026-07-07T09:08:31" = เวลาไทย) → Date
 * ถ้าไม่มีโซนต่อท้าย ให้ถือเป็น +07:00
 */
export function parsePancakeTime(s: unknown): Date | null {
  if (!s) return null;
  if (s instanceof Date) return s;
  const str = String(s).replace(' ', 'T');
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) {
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }
  const hasTz = /([zZ]|[+-]\d{2}:?\d{2})$/.test(str);
  const iso = hasTz ? str : str.slice(0, 19) + '+07:00';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/** ISO string (เก็บลง timestamptz) จาก Pancake time */
export function toIso(s: unknown): string | null {
  const d = parsePancakeTime(s);
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
