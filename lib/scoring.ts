// lib/scoring.ts — โมเดลให้คะแนน "Overall Performance" ของแอดมิน
// pure (ไม่มี DOM / ไม่ import ฝั่ง server) → ใช้ได้ทั้ง client view และ route
//
// แนวคิด: แต่ละตัวชี้วัดมี "น้ำหนัก(%)" + "เป้าหมาย(=100 คะแนน)" ที่ปรับเองได้
//   sub-score ของตัวชี้วัด = clamp(actual/target, 0..1) × 100   (dir=high)
//                          = clamp(target/actual, 0..1) × 100   (dir=low  ยิ่งน้อยยิ่งดี)
//   Overall = ผลรวมถ่วงน้ำหนัก / ผลรวมน้ำหนัก (เฉพาะตัวที่ "มีข้อมูล")

export interface Metric {
  key: string;           // ต้องตรงกับ field ใน PerfRow (revenue, closeRate, ...)
  label: string;
  unit: string;          // '฿' | '%' | 'นาที' | ''
  dir: 'high' | 'low';   // high = มากยิ่งดี, low = น้อยยิ่งดี
}

export interface MetricConfig {
  key: string;
  weight: number;   // เปอร์เซ็นต์ (ไม่จำเป็นต้องรวมได้ 100 — normalize ให้เอง)
  target: number;   // ค่าที่ถือเป็น 100 คะแนนของตัวนั้น
  enabled: boolean;
}

export interface ScorePart {
  key: string;
  label: string;
  unit: string;
  dir: 'high' | 'low';
  weight: number;
  target: number;
  value: number | null;
  sub: number | null;      // 0..100 หรือ null (ไม่มีข้อมูล/ถูกข้าม)
  skipped: boolean;        // ไม่ถูกนำมาคิด (ปิดอยู่ / น้ำหนัก 0 / ไม่มีข้อมูล)
}

export interface ScoreResult {
  score: number | null;    // 0..100 หรือ null (ไม่มีตัวชี้วัดที่คิดได้)
  parts: ScorePart[];
}

export const METRICS: Metric[] = [
  { key: 'revenue',     label: 'ยอดขาย',            unit: '฿',    dir: 'high' },
  { key: 'closeRate',   label: '% ปิดการขาย',       unit: '%',    dir: 'high' },
  { key: 'orders',      label: 'ออเดอร์',            unit: '',     dir: 'high' },
  { key: 'avgRespMins', label: 'เวลาตอบเฉลี่ย',      unit: 'นาที', dir: 'low'  },
  { key: 'phones',      label: 'เบอร์ที่ได้',        unit: '',     dir: 'high' },
  { key: 'replies',     label: 'ข้อความที่ตอบ',      unit: '',     dir: 'high' },
  { key: 'chats',       label: 'แชทที่ดูแล',         unit: '',     dir: 'high' },
  { key: 'avgOrder',    label: 'ยอดเฉลี่ย/ออเดอร์',  unit: '฿',    dir: 'high' },
  // เท่า (ROAS) = ยอดที่ผูกแอด ÷ ค่าแอดปันส่วน — null สำหรับคนที่ไม่มียอดจากแอด (สาย LINE) → ไม่ถูกคิด
  { key: 'roas',        label: 'เท่า (ROAS)',        unit: 'เท่า', dir: 'high' },
];

export const METRIC_BY_KEY: Record<string, Metric> = METRICS.reduce((m, x) => {
  m[x.key] = x;
  return m;
}, {} as Record<string, Metric>);

// ค่าเริ่มต้น — ตัวที่เปิดรวมน้ำหนักได้ 100 (ปรับได้หมดในหน้าเว็บ)
// ⚠️ เป้าหมายที่หน่วยเป็น ฿ ถูกหาร 100 พร้อมกับการแก้หน่วยเงิน (MONEY_SCALE) เมื่อ 2026-07-23
//    เดิม revenue 500,000 / avgOrder 30,000 คิดบนตัวเลขที่พองอยู่ 100 เท่า
export const DEFAULT_CONFIG: MetricConfig[] = [
  { key: 'revenue',     weight: 40, target: 5000, enabled: true },
  { key: 'closeRate',   weight: 20, target: 30,   enabled: true },
  { key: 'orders',      weight: 15, target: 50,   enabled: true },
  { key: 'avgRespMins', weight: 15, target: 5,    enabled: true },
  { key: 'phones',      weight: 10, target: 100,  enabled: true },
  { key: 'replies',     weight: 0,  target: 1000, enabled: false },
  { key: 'chats',       weight: 0,  target: 200,  enabled: false },
  { key: 'avgOrder',    weight: 0,  target: 300,  enabled: false },
  // ปิดไว้ก่อน — โหมดจัดอันดับ "🔥 เท่า" ใช้ ROAS ตรงๆ อยู่แล้ว ตัวนี้ไว้ให้เปิดถ้าอยากผสมเข้าคะแนน Overall
  { key: 'roas',        weight: 0,  target: 3,    enabled: false },
];

/** คีย์ที่เป้าหมายเป็นจำนวนเงิน — ใช้ตอนย้ายค่าที่ทีมเคยตั้งไว้ให้เข้าหน่วยใหม่ */
export const MONEY_METRIC_KEYS = ['revenue', 'avgOrder'];

/** รวม config ที่เก็บไว้กับค่าเริ่มต้น → คืน array ครบทุกตัวชี้วัดตามลำดับ METRICS */
export function normalizeConfig(raw: unknown): MetricConfig[] {
  const byKey: Record<string, any> = {};
  if (Array.isArray(raw)) raw.forEach((c: any) => { if (c && c.key) byKey[c.key] = c; });
  const posNum = (v: any, dv: number): number => {
    const n = Number(v);
    return isFinite(n) && n >= 0 ? n : dv;
  };
  return METRICS.map((m) => {
    const d = DEFAULT_CONFIG.find((x) => x.key === m.key)!;
    const c = byKey[m.key] || {};
    return {
      key: m.key,
      weight: posNum(c.weight, d.weight),
      target: posNum(c.target, d.target),
      enabled: c.enabled === undefined ? d.enabled : !!c.enabled,
    };
  });
}

/* ================================================================
 * เป้า KPI ต่อคน/ต่อวัน (หน้า Admin Performance — แถบความคืบหน้า realtime)
 *
 * ทำไมเก็บชุดเดียวใน sync_state (ไม่ใช่ต่อคนใน admin_settings):
 *   บอสตั้ง "เป้าต่อคนต่อวัน" แบบเดียวกันทั้งทีม (ยอดขาย/ออเดอร์/%ปิด/ตอบเฉลี่ย) เหมือน
 *   scoreConfig และ appSettings — ตั้งครั้งเดียวทุกคนเห็นเกณฑ์เดียวกัน ไม่ต้องแตะ schema
 *   และไม่ต้องไล่ตั้งทีละคนตอนมีแอดมินใหม่ (ถ้าวันหนึ่งต้องการเป้ารายคนค่อยเพิ่ม
 *   คอลัมน์ override ใน admin_settings ทับชุดกลางนี้)
 * ================================================================ */

export interface KpiTargets {
  revenue: number;      // ยอดขาย/คน/วัน (บาทจริง)
  orders: number;       // ออเดอร์/คน/วัน
  closeRate: number;    // % ปิดการขาย
  avgRespMins: number;  // เวลาตอบเฉลี่ย (นาที) — ยิ่งน้อยยิ่งดี
}

/** ตัวชี้วัดที่ตั้งเป้าได้ + ทิศทาง (ใช้วาดฟอร์ม/แถบความคืบหน้าฝั่ง client) */
export const KPI_TARGET_METRICS: { key: keyof KpiTargets; label: string; unit: string; dir: 'high' | 'low' }[] = [
  { key: 'revenue',     label: 'ยอดขาย',          unit: '฿',    dir: 'high' },
  { key: 'orders',      label: 'ออเดอร์',          unit: '',     dir: 'high' },
  { key: 'closeRate',   label: '% ปิดการขาย',     unit: '%',    dir: 'high' },
  { key: 'avgRespMins', label: 'เวลาตอบเฉลี่ย',    unit: 'นาที', dir: 'low'  },
];

// ค่าเริ่มต้น: %ปิด 40 = เป้า KPI จริงของทีม (บอสยืนยัน 2026-08-03 — ตรงชีทตัวชี้วัด "ปิด ≥40%")
// ทีมปรับเองได้ที่ปุ่ม 🎯 เป้า KPI หน้า Admin Performance (เก็บ sync_state ทับค่านี้)
export const DEFAULT_KPI_TARGETS: KpiTargets = { revenue: 5000, orders: 20, closeRate: 40, avgRespMins: 5 };

/** ตรวจ/เติมเป้า KPI ให้อยู่ในช่วงที่ใช้งานได้เสมอ (0 = ปิดตัวชี้วัดนั้น ไม่โชว์แถบ) */
export function normalizeKpiTargets(raw: unknown): KpiTargets {
  const r = (raw || {}) as Record<string, unknown>;
  const num = (v: unknown, dv: number, max: number): number => {
    const n = Number(v);
    if (!isFinite(n) || n < 0) return dv;
    return Math.min(max, Math.round(n * 10) / 10);
  };
  return {
    revenue: num(r.revenue, DEFAULT_KPI_TARGETS.revenue, 100000000),
    orders: num(r.orders, DEFAULT_KPI_TARGETS.orders, 100000),
    closeRate: num(r.closeRate, DEFAULT_KPI_TARGETS.closeRate, 100),
    avgRespMins: num(r.avgRespMins, DEFAULT_KPI_TARGETS.avgRespMins, 1440),
  };
}

/**
 * % ความคืบหน้าเทียบเป้า (0..100+ — เกินเป้าได้ ให้เห็นว่าทำได้กี่ %)
 * null = ไม่มีข้อมูล/ไม่ได้ตั้งเป้า → หน้าเว็บต้องโชว์ "—" ไม่ใช่ 0%
 */
export function kpiProgress(value: number | null | undefined, target: number, dir: 'high' | 'low'): number | null {
  if (!(target > 0)) return null;
  if (value === null || value === undefined || isNaN(Number(value))) return null;
  const v = Number(value);
  if (dir === 'low') {
    if (v <= 0) return null;              // เวลาตอบ 0 = ไม่มีข้อมูลจริง
    return Math.round((target / v) * 1000) / 10;
  }
  return Math.round((v / target) * 1000) / 10;
}

/** คะแนนย่อย 0..100 ของตัวชี้วัดเดียว (null = ไม่มีข้อมูล/คิดไม่ได้) */
export function subScore(value: number | null | undefined, m: Metric, target: number): number | null {
  if (value === null || value === undefined || isNaN(Number(value))) return null;
  if (!(target > 0)) return null;
  const v = Number(value);
  let ratio: number;
  if (m.dir === 'low') {
    if (v <= 0) return null;          // เช่นเวลาตอบ 0 = ไม่มีข้อมูลจริง → ไม่คิด
    ratio = target / v;
  } else {
    ratio = v / target;
  }
  return Math.max(0, Math.min(100, ratio * 100));
}

// ตัวชี้วัดกลุ่มขาย/กลุ่มแชท — ใช้ตัดสินว่าคนนี้ "มีบทบาท" ด้านนั้นไหม
// (คนที่ไม่มีบทบาทด้านนั้นจะไม่ถูกคิดตัวชี้วัดกลุ่มนั้น — ยุติธรรมกับทั้งเซลล์และแอดมินแชท)
const SALES_KEYS = new Set(['revenue', 'orders', 'avgOrder']);
const CHAT_KEYS = new Set(['closeRate', 'avgRespMins', 'phones', 'replies', 'chats']);

/** คำนวณ Overall score + รายละเอียดรายตัวชี้วัดของ 1 แถว */
export function computeScore(row: any, config: MetricConfig[]): ScoreResult {
  const hasSales = (Number(row.orders) || 0) > 0 || (Number(row.revenue) || 0) > 0;
  const hasChat = (Number(row.chats) || 0) > 0 || (Number(row.replies) || 0) > 0;

  let acc = 0;
  let wsum = 0;
  const parts: ScorePart[] = [];

  config.forEach((c) => {
    const m = METRIC_BY_KEY[c.key];
    if (!m) return;
    const raw = row[c.key];
    const value = (raw === null || raw === undefined || isNaN(Number(raw))) ? null : Number(raw);

    let skipped = false;
    if (!c.enabled || !(c.weight > 0)) skipped = true;
    else if (SALES_KEYS.has(c.key) && !hasSales) skipped = true;
    else if (CHAT_KEYS.has(c.key) && !hasChat) skipped = true;

    const sub = skipped ? null : subScore(value, m, c.target);
    if (!skipped && sub !== null) {
      acc += c.weight * sub;
      wsum += c.weight;
    }
    parts.push({
      key: c.key, label: m.label, unit: m.unit, dir: m.dir,
      weight: c.weight, target: c.target, value,
      sub: skipped ? null : sub,
      skipped: skipped || sub === null,
    });
  });

  return { score: wsum > 0 ? Math.round((acc / wsum) * 10) / 10 : null, parts };
}
