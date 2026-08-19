// lib/kpisheet.ts — ตัวแกะ "ชีท KPI" กลางของทีม (คะแนน KPI รายคนรายเดือน ทุกตำแหน่ง)
//
// ⚠️ เราไม่คำนวณคะแนนเอง — อ่านคะแนนที่สูตรในชีทของทีมคิดไว้แล้วมาแสดงตรงๆ
//    (สูตรมีรายละเอียดเยอะ เช่น %Error สเกลพิเศษ -8=70คะแนน — คิดเองเพี้ยนแน่)
//
// โครงชีท: ตาราง "แนวนอน" — เดือนถัดไปต่อไปทางขวาเป็นก้อนคอลัมน์ขนาดคงที่
//   KPI ADMIN/month   : ม.ค. เริ่มคอลัมน์ G(6)  ก้อนละ 17 คอลัมน์ [Unit, ยอด, %ปิด, %Error, เปอร์บิล, %ตีกลับ, ...(คะแนนย่อย), คะแนนเดือน]
//   KPI รอง ADMIN/month: ม.ค. เริ่ม G(6) ก้อนละ 15 [Unit, เป้า, ยอดทีม, _, ทีม(คน), ถึงเป้า(คน), _, %ปิด, _, เปอร์บิล, _, ต้นทุนแอด, _, %Error, คะแนน]
//   KPI หัวหน้า ADMIN/month: ม.ค. เริ่ม G(6) ก้อนละ 8 [KPIรอง, _, เป้า, ยอด, _, ต้นทุนแอด, _, คะแนนรวม]
//   KPI ADMIN/year    : แถวเดียวต่อคน (D=ID, F=ชื่อเล่น, G=KPI 2026, H..L ค่าดิบ, W=KPI เฉลี่ยรวม)
// แถวข้อมูล = แถวที่คอลัมน์ ID เป็นรหัสพนักงาน 4-6 หลัก; คนหนึ่งหลายแถว = ประจำหลายยูนิต
// ตำแหน่งคอลัมน์ยืนยันกับชีทจริงแล้ว 2026-07-31 (dump ทุกแท็บ) — ทีมแทรกคอลัมน์เมื่อไหร่ต้องแก้ตาม

const num_ = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(/,/g, '').trim());
  return isFinite(n) ? n : 0;
};
const clean_ = (v: unknown) => String(v || '').replace(/\s+/g, ' ').trim();
/**
 * เหมือน num_ แต่แยก "เซลล์ว่าง" ออกจาก "เลขศูนย์" — คืน null เมื่อทีมยังไม่กรอก
 *
 * เจ็บมาแล้ว: ทีมหยุดกรอก "ต้นทุนค่าโฆษณารวม" ตั้งแต่ ก.ค. 2026 แล้วหน้าเว็บโชว์ "0.0%"
 * ซึ่งอ่านได้ว่า "ยิงแอดฟรี" แทนที่จะบอกว่า "ยังไม่มีข้อมูล" — ทีมเข้าใจผิดว่าระบบดึงค่าผิด
 */
const numOrNull_ = (v: unknown): number | null => {
  const raw = String(v ?? '').trim();
  if (!raw) return null;
  const n = Number(raw.replace(/,/g, ''));
  return isFinite(n) ? n : null;
};
/**
 * สัดส่วน 0-1 ในชีท → เปอร์เซ็นต์ • ว่าง = null
 * ค่า 0 ก็ถือว่า "ยังไม่กรอก" — ต้นทุนแอด 0% ของยูนิตที่ยิงแอดอยู่เป็นไปไม่ได้จริง
 * (แท็บหัวหน้าใส่เลข 0 ไว้จริงตั้งแต่ ก.ค. ไม่ได้ปล่อยว่างเหมือนแท็บรอง)
 */
const pct100_ = (v: number | null): number | null => (v === null || v === 0 ? null : v * 100);
/** สัดส่วน 0-1 → เปอร์เซ็นต์ • ว่าง = null แต่ 0 คือ 0 จริง (ไม่มีของตีกลับ/ไม่มี error เกิดขึ้นได้) */
const pct_ = (v: number | null): number | null => (v === null ? null : v * 100);
const isEmpId_ = (v: unknown) => /^\d{4,6}$/.test(clean_(v));

/** 'U16 C Biofla' → 'U16' (คืน '' ถ้าไม่ใช่รหัสยูนิต) */
export function kpiUnitCode(s: unknown): string {
  const m = clean_(s).toUpperCase().match(/^(UN?\d{1,3})\b/);
  return m ? m[1] : '';
}

export interface KpiAdminMonthRow {
  id: string; name: string; nick: string; unit: string; unitFull: string;
  sales: number;
  // ว่าง = null ไม่ใช่ 0 — เดือนที่ทีมยังไม่กรอกจะได้ไม่โชว์ "0.0%" ให้เข้าใจผิดว่าไม่มีของตีกลับ/ไม่มี error
  close: number | null; err: number | null; perBill: number | null; ret: number | null; score: number;
}
export interface KpiSubMonthRow {
  id: string; name: string; nick: string; unit: string; unitFull: string;
  target: number; teamSales: number; teamCount: number | null; hitTarget: number | null;
  close: number; perBill: number; adCost: number | null; err: number; score: number; kpiAvg: number;
}
export interface KpiHeadMonth {
  id: string; name: string; nick: string;
  kpiSub: number; target: number; sales: number; adCost: number | null; score: number;
  units: Array<{ unit: string; unitFull: string; score: number; sales: number; target: number }>;
}
export interface KpiAdminYearRow {
  id: string; name: string; nick: string;
  kpiYear: number; sales: number;
  close: number | null; err: number | null; perBill: number | null; ret: number | null; kpiAvg: number;
}

const ADMIN_BASE = 6, ADMIN_STRIDE = 17;
const SUB_BASE = 6, SUB_STRIDE = 15;
const HEAD_BASE = 6, HEAD_STRIDE = 8;
const MONTHS = 12;

/** แท็บ KPI ADMIN/month → { เดือน 1-12: แถว[] } — เก็บเฉพาะ (คน,ยูนิต) ที่มีข้อมูลเดือนนั้น */
export function parseKpiAdminMonth(grid: string[][]): Record<number, KpiAdminMonthRow[]> {
  const out: Record<number, KpiAdminMonthRow[]> = {};
  const seen = new Set<string>(); // `${m}|${id}|${unit}` — ชีทมีแถวซ้ำ (ก๊อปค้าง) กันนับสองรอบ
  for (const row of grid) {
    if (!isEmpId_(row[2])) continue;
    const id = clean_(row[2]), name = clean_(row[3]), nick = clean_(row[4]);
    for (let m = 0; m < MONTHS; m++) {
      const b = ADMIN_BASE + m * ADMIN_STRIDE;
      const unitFull = clean_(row[b]);
      const unit = kpiUnitCode(unitFull);
      if (!unit) continue; // เดือนนี้แถวนี้ไม่มียูนิต = ไม่มีข้อมูล
      const key = `${m + 1}|${id}|${unit}`;
      if (seen.has(key)) continue;
      seen.add(key);
      (out[m + 1] = out[m + 1] || []).push({
        id, name, nick, unit, unitFull,
        sales: num_(row[b + 1]),
        close: pct_(numOrNull_(row[b + 2])),
        err: pct_(numOrNull_(row[b + 3])),
        perBill: numOrNull_(row[b + 4]),
        ret: pct_(numOrNull_(row[b + 5])),
        score: num_(row[b + 16]), // สัดส่วน 0-1+ (เกิน 1 ได้เมื่อทะลุเป้า)
      });
    }
  }
  return out;
}

/** แท็บ KPI รอง ADMIN/month → { เดือน: แถวต่อ (รอง,ยูนิต) } */
export function parseKpiSubMonth(grid: string[][]): Record<number, KpiSubMonthRow[]> {
  const out: Record<number, KpiSubMonthRow[]> = {};
  let cur: { id: string; name: string; nick: string; kpiAvg: number } | null = null;
  const seen = new Set<string>();
  for (const row of grid) {
    if (isEmpId_(row[2])) {
      cur = {
        id: clean_(row[2]), name: clean_(row[3]), nick: clean_(row[4]),
        kpiAvg: num_(row[5]), // F = KPI เฉลี่ยรวม (มีเฉพาะแถวแรกของคน)
      };
    }
    if (!cur) continue;
    for (let m = 0; m < MONTHS; m++) {
      const b = SUB_BASE + m * SUB_STRIDE;
      const unitFull = clean_(row[b]);
      const unit = kpiUnitCode(unitFull);
      if (!unit) continue;
      const key = `${m + 1}|${cur.id}|${unit}`;
      if (seen.has(key)) continue;
      seen.add(key);
      (out[m + 1] = out[m + 1] || []).push({
        id: cur.id, name: cur.name, nick: cur.nick, unit, unitFull,
        target: num_(row[b + 1]),
        teamSales: num_(row[b + 2]),
        teamCount: numOrNull_(row[b + 4]),
        hitTarget: numOrNull_(row[b + 5]),
        close: num_(row[b + 7]) * 100,
        perBill: num_(row[b + 9]),
        adCost: pct100_(numOrNull_(row[b + 11])), // สัดส่วนต้นทุนแอดต่อยอด (เป้า ≤33%)
        err: num_(row[b + 13]) * 100,
        score: num_(row[b + 14]),
        kpiAvg: cur.kpiAvg,
      });
    }
  }
  return out;
}

/** แท็บ KPI หัวหน้า ADMIN/month → { เดือน: หัวหน้า[] } (แถว ID = คน, แถว F=Unit ใต้คนนั้น = breakdown) */
export function parseKpiHeadMonth(grid: string[][]): Record<number, KpiHeadMonth[]> {
  const out: Record<number, KpiHeadMonth[]> = {};
  let curByMonth: Record<number, KpiHeadMonth> = {};
  for (const row of grid) {
    if (isEmpId_(row[2])) {
      curByMonth = {};
      for (let m = 0; m < MONTHS; m++) {
        const b = HEAD_BASE + m * HEAD_STRIDE;
        const score = num_(row[b + 7]);
        const sales = num_(row[b + 3]);
        if (!score && !sales) continue; // เดือนยังไม่เกิด/ว่าง
        const h: KpiHeadMonth = {
          id: clean_(row[2]), name: clean_(row[3]), nick: clean_(row[4]),
          kpiSub: num_(row[b]), target: num_(row[b + 2]), sales,
          adCost: pct100_(numOrNull_(row[b + 5])), score, units: [],
        };
        curByMonth[m + 1] = h;
        (out[m + 1] = out[m + 1] || []).push(h);
      }
      continue;
    }
    // แถว breakdown รายยูนิต (F = ชื่อยูนิต)
    const unitFull = clean_(row[5]);
    const unit = kpiUnitCode(unitFull);
    if (!unit) continue;
    for (let m = 0; m < MONTHS; m++) {
      const h = curByMonth[m + 1];
      if (!h) continue;
      const b = HEAD_BASE + m * HEAD_STRIDE;
      const score = num_(row[b + 7]);
      const sales = num_(row[b + 3]);
      if (!score && !sales) continue;
      h.units.push({ unit, unitFull, score, sales, target: num_(row[b + 2]) });
    }
  }
  return out;
}

/** แท็บ KPI ADMIN/year → แถวเดียวต่อคน */
export function parseKpiAdminYear(grid: string[][]): KpiAdminYearRow[] {
  const out: KpiAdminYearRow[] = [];
  const seen = new Set<string>();
  for (const row of grid) {
    if (!isEmpId_(row[3])) continue; // แท็บนี้ ID อยู่คอลัมน์ D
    const id = clean_(row[3]);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id, name: clean_(row[4]), nick: clean_(row[5]),
      kpiYear: num_(row[6]),
      sales: num_(row[7]),
      close: pct_(numOrNull_(row[8])),
      err: pct_(numOrNull_(row[9])),
      perBill: numOrNull_(row[10]),
      ret: pct_(numOrNull_(row[11])),
      kpiAvg: num_(row[22]), // W = KPI เฉลี่ยรวมเฉพาะเดือนที่มีข้อมูล
    });
  }
  return out;
}
