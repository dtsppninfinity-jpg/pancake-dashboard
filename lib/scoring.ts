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
];

export const METRIC_BY_KEY: Record<string, Metric> = METRICS.reduce((m, x) => {
  m[x.key] = x;
  return m;
}, {} as Record<string, Metric>);

// ค่าเริ่มต้น — ตัวที่เปิดรวมน้ำหนักได้ 100 (ปรับได้หมดในหน้าเว็บ)
export const DEFAULT_CONFIG: MetricConfig[] = [
  { key: 'revenue',     weight: 40, target: 500000, enabled: true },
  { key: 'closeRate',   weight: 20, target: 30,     enabled: true },
  { key: 'orders',      weight: 15, target: 50,     enabled: true },
  { key: 'avgRespMins', weight: 15, target: 5,      enabled: true },
  { key: 'phones',      weight: 10, target: 100,    enabled: true },
  { key: 'replies',     weight: 0,  target: 1000,   enabled: false },
  { key: 'chats',       weight: 0,  target: 200,    enabled: false },
  { key: 'avgOrder',    weight: 0,  target: 30000,  enabled: false },
];

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
