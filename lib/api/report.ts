// lib/api/report.ts — รายงานรายวีค/รายเดือน (เป้า vs จริง) + การตลาดซื้อซ้ำรายยูนิต
//
// เป้า = แท็บ "เป้ายอดขาย" ของชีท KPI (sync มาใน sync_state 'kpi_scores')
// ยอดจริง = unit_daily.sales (ชีทสรุปรายสินค้า — แหล่งเดียวกับที่ทีมใช้วัดเป้า ตัวเลขจึงเทียบกันตรงๆ)
// ซื้อซ้ำ = ออเดอร์ POS จริง (เริ่มมีข้อมูล 23 พ.ค. 2026) จัดกลุ่มยูนิตด้วยเพจ↔ยูนิตจาก U Map
import { db, fetchAll, fetchAllSliced } from '@/lib/db';
import { getUMapDoc, getPageUnitMap } from '@/lib/api/umap';
import { EXCLUDED_STATUSES, money_ } from '@/lib/config';

const num_ = (v: unknown): number => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** วันจันทร์ต้นสัปดาห์ของวันนั้น (สตริง YYYY-MM-DD, คำนวณแบบ UTC ล้วน — date ในชีทไม่มีเวลา) */
function weekStart_(d: string): string {
  const t = new Date(d + 'T00:00:00Z');
  const dow = (t.getUTCDay() + 6) % 7; // จันทร์ = 0
  t.setUTCDate(t.getUTCDate() - dow);
  return t.toISOString().slice(0, 10);
}

/* ================= แถวออเดอร์ของส่วนซื้อซ้ำ: แคชต่อโปรเซส + เติมเฉพาะแถวที่เปลี่ยน =================
 * เดิมทุกครั้งที่เลื่อนถึงส่วนนี้ ดึงออเดอร์ทั้งหมดตั้งแต่ 23 พ.ค. (~18 หมื่นแถว ~180 หน้า ~6-7 วิ + egress หลาย MB)
 * ตอนนี้: ครั้งแรก (หรือครบ 15 นาที) ดึงเต็มแบบเดิม · ครั้งถัดไปดึงเฉพาะออเดอร์ที่ updated_at ขยับในชั่วโมงล่าสุด
 * (มี index idx_orders_updated · ทุกทางที่เขียน orders คือ upsert ที่ตั้ง updated_at ตาม Pancake) แล้วแทนที่ตาม id
 * → ออเดอร์ใหม่/เปลี่ยนสถานะเห็นทันทีเหมือนดึงเต็ม ตัวเลขไม่ค้าง · รีเฟรชเต็มทุก 15 นาทีเป็นตาข่ายกรณีที่ไล่ไม่ทัน:
 *   แถวที่ถูกเติมย้อนหลังด้วย updated_at เก่ากว่าค่าสูงสุดที่เห็นเกิน 1 ชม. (backfill / sync ตามหลังเกินชั่วโมง) และแถวที่ถูกลบ
 *   → สองกรณีนี้ตัวเลขตามทันช้าสุด 15 นาที (ปกติไม่เกิดในรอบ sync ประจำ — ตรวจแล้วไม่มี updated_at ว่าง/ล้ำอนาคต)
 * ผลที่คืน = แถวชุดเดียวกับคิวรีเดิม (inserted_at ≥ 23 พ.ค. และ < ตอนนี้ · ตัดออเดอร์เปล่าแบบเดียวกับฐาน)
 * เรียง inserted_at,id แบบเดิม → ลำดับลูกค้า/ยูนิตที่ค่าเท่ากัน และผลบวกทศนิยม เหมือนเดิมทุกตัว */
interface MkRow { id: string; inserted_at: string; t: number; status: unknown; customer_id: unknown; page_id: unknown }
const MK_SINCE = new Date('2026-05-23T00:00:00+07:00');
const MK_FULL_MS = 15 * 60 * 1000;      // ดึงเต็มใหม่ทุก 15 นาที
const MK_OVERLAP_MS = 60 * 60 * 1000;   // ดึงแถวที่ updated_at ย้อนจากค่าสูงสุดที่เคยเห็น 1 ชม. (กันแถวที่ sync เข้ามาช้า)
let mkCache_: { rows: Map<string, MkRow>; hwm: string; fullAt: number } | null = null;
let mkBusy_: Promise<void> | null = null;

/** เงื่อนไขเดียวกับ .or('items_count.neq.0,total_price.neq.0') ของฐาน (NULL = ไม่ผ่าน) */
const mkKeep_ = (o: any): boolean => {
  const nz = (v: unknown) => v !== null && v !== undefined && Number(v) !== 0;
  return nz(o.items_count) || nz(o.total_price);
};
const mkRow_ = (o: any): MkRow => ({
  id: String(o.id), inserted_at: String(o.inserted_at), t: new Date(String(o.inserted_at)).getTime(),
  status: o.status, customer_id: o.customer_id, page_id: o.page_id,
});

async function mkRefresh_(): Promise<void> {
  const now = Date.now();
  if (!mkCache_ || now - mkCache_.fullAt >= MK_FULL_MS) {
    const rows = await fetchAllSliced<any>((f, t) =>
      db.from('orders')
        .select('id,inserted_at,updated_at,status,customer_id,page_id')
        .or('items_count.neq.0,total_price.neq.0')
        .gte('inserted_at', f).lt('inserted_at', t),
      MK_SINCE, new Date(now),
      // pool 4: เวลาหมดไปกับรอ round-trip (~180 หน้า × ~0.3 วิ) ไม่ใช่ฐานคิดหนัก — ยิงก้อนพร้อมกันมากขึ้น
      // จำนวนคิวรีพร้อมกันจริงยังโดน MAX_INFLIGHT=12 ใน db.ts คุมอยู่ (ค่าที่วัดแล้วว่าฐานรับไหว)
      { pool: 4 },
    );
    const map = new Map<string, MkRow>();
    let hwm = '';
    rows.forEach((o) => {
      map.set(String(o.id), mkRow_(o));
      const u = String(o.updated_at || '');
      if (u > hwm) hwm = u;
    });
    mkCache_ = { rows: map, hwm, fullAt: now };
    return;
  }
  const c = mkCache_;
  const since = c.hwm ? new Date(new Date(c.hwm).getTime() - MK_OVERLAP_MS).toISOString() : new Date(now - MK_OVERLAP_MS).toISOString();
  const changed = await fetchAll<any>(() =>
    db.from('orders')
      .select('id,inserted_at,updated_at,status,customer_id,page_id,items_count,total_price')
      .gte('updated_at', since), 'id');
  let hwm = c.hwm;
  changed.forEach((o) => {
    const id = String(o.id);
    const at = new Date(String(o.inserted_at)).getTime();
    if (mkKeep_(o) && isFinite(at) && at >= MK_SINCE.getTime()) c.rows.set(id, mkRow_(o));
    else c.rows.delete(id);   // กลายเป็นออเดอร์เปล่า / ย้ายวันออกนอกช่วง = ไม่อยู่ในผลของคิวรีเดิม
    const u = String(o.updated_at || '');
    if (u > hwm) hwm = u;
  });
  c.hwm = hwm;
}

/** แถวออเดอร์ของส่วนซื้อซ้ำ ณ เวลา asOf — ชุดเดียวกับคิวรีเดิมทุกแถว เรียง inserted_at,id */
async function marketOrders_(asOf: Date): Promise<MkRow[]> {
  // คำขอที่มาพร้อมกันรอการดึงรอบเดียวกัน · พลาด = ทิ้งแคชทั้งก้อน (รอบหน้าดึงเต็มใหม่) แล้วโยน error ต่อแบบเดิม
  if (!mkBusy_) {
    mkBusy_ = mkRefresh_().catch((e) => { mkCache_ = null; throw e; }).finally(() => { mkBusy_ = null; });
  }
  await mkBusy_;
  const cache = mkCache_;
  if (!cache) throw new Error('marketOrders_: cache empty');
  const end = asOf.getTime();
  const out: MkRow[] = [];
  // คิวรีเดิม fetchAllSliced(…, new Date()) = inserted_at ≤ เวลาที่ขอ (ก้อนสุดท้าย lt ตอนนี้ + 1ms)
  cache.rows.forEach((r) => { if (r.t <= end) out.push(r); });
  // ลำดับเดียวกับ ORDER BY inserted_at,id ของคิวรีเดิม: เวลาเท่ากันระดับมิลลิวินาที → เทียบสตริงเวลา (เศษไมโครวินาทีรูปแบบเดียวกัน)
  // แล้วค่อย id — id เป็นตัวเลขล้วน เทียบสตริงแบบไบต์ได้ลำดับเดียวกับฐาน
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  out.sort((a, b) => (a.t - b.t) || cmp(a.inserted_at, b.inserted_at) || cmp(a.id, b.id));
  return out;
}

export async function apiReport(params: any) {
  const p = params || {};

  /* ================= ส่วนการตลาด (ซื้อซ้ำรายยูนิต) — เรียกแยก หนักกว่าส่วนรายงาน ================= */
  if (p.section === 'marketing') {
    // แผนที่เพจ→ยูนิตไม่พึ่งออเดอร์ — เริ่มดึงพร้อมกัน (เดิมรอแผนที่เสร็จก่อนค่อยเริ่มสแกนออเดอร์)
    const pageUnitP = getPageUnitMap().catch(() => ({} as Record<string, { u: string; product: string }>));
    // ออเดอร์ทั้งหมดตั้งแต่ระบบเริ่มมีข้อมูลจริง (23 พ.ค. 2026) — คอลัมน์น้อยที่สุด
    // ตัดออเดอร์เปล่า (ไม่มีสินค้า + ยอด 0) ที่ฐานเลย — เท่ากับ !isPlaceholderOrder ทุกกรณีรวม NULL
    // ออเดอร์เปล่ามี ~35% ของทั้งหมด (27 ก.ย.: 97k จาก 276k แถว) เดิมดึงมาทิ้งทุกครั้งที่เปิดหน้า
    // ลำดับแถวที่เหลือเหมือนเดิม (inserted_at,id) → ลำดับยูนิตที่ %ซื้อซ้ำเท่ากันไม่เปลี่ยน
    const orders = await marketOrders_(new Date());
    const pageUnit = await pageUnitP;
    // per unit per customer → รายการเวลาซื้อ
    const cust: Record<string, Record<string, number[]>> = {};
    orders.forEach((o) => {
      if (EXCLUDED_STATUSES.indexOf(num_(o.status)) >= 0) return;
      const cid = String(o.customer_id || '');
      if (!cid) return;
      const um = pageUnit[String(o.page_id || '')];
      const u = um ? um.u : '__none__';
      const t = new Date(String(o.inserted_at)).getTime();
      if (!isFinite(t)) return;
      ((cust[u] = cust[u] || {})[cid] = cust[u][cid] || []).push(t);
    });
    const units = Object.keys(cust).filter((u) => u !== '__none__').map((u) => {
      const byC = cust[u];
      let total = 0, repeat = 0, gapSum = 0, gapN = 0, orderSum = 0;
      Object.keys(byC).forEach((cid) => {
        const ts = byC[cid].sort((a, b) => a - b);
        total++;
        orderSum += ts.length;
        if (ts.length >= 2) {
          repeat++;
          for (let i = 1; i < ts.length; i++) { gapSum += (ts[i] - ts[i - 1]) / 86400000; gapN++; }
        }
      });
      return {
        u,
        customers: total,
        repeat,
        repeatPct: total ? Math.round((repeat / total) * 1000) / 10 : null,
        avgGapDays: gapN ? Math.round(gapSum / gapN) : null,       // รอบซื้อซ้ำเฉลี่ย (วัน)
        avgOrders: total ? Math.round((orderSum / total) * 100) / 100 : null,
      };
    }).sort((a, b) => (b.repeatPct || 0) - (a.repeatPct || 0));
    return { ok: true, sinceDate: '2026-05-23', units };
  }

  /* ================= ส่วนรายงาน: เป้า vs จริง ================= */
  const [rows, kpiState, umap] = await Promise.all([
    fetchAll<any>(() => db.from('unit_daily').select('u,date,sales,profit'), 'key').catch(() => [] as any[]),
    db.from('sync_state').select('value').eq('key', 'kpi_scores').maybeSingle(),
    getUMapDoc().catch(() => ({ units: [] as any[] })),
  ]);
  if (!rows.length) return { setupNeeded: true };

  let targets: Record<string, number[]> = {};
  try { targets = JSON.parse(String(kpiState.data?.value || '{}')).targets || {}; } catch { /* ยังไม่ sync */ }
  const productOf: Record<string, string> = {};
  (umap.units || []).forEach((x: any) => { productOf[String(x.u)] = String(x.product || ''); });

  const year = String(rows.map((r) => String(r.date).slice(0, 4)).sort().pop() || '2026');
  // actual[u][m 1-12] + weekly[u][weekStart] ของเดือนที่เลือก
  const actual: Record<string, number[]> = {};
  // เดือนที่ยูนิตนั้น "มีแถวในชีท" จริง (ยอด 0 ก็นับว่ามี) — แยก "ยังไม่มีในชีท" ออกจาก "ขายได้ 0 จริง" (ตรวจ UI ข้อ E1)
  // เดิม actual ของยูนิตที่ชีทสรุปรายสินค้ายังไม่มีแท็บ = 0 → %บรรลุ 0% ป้ายแดง "ต่ำกว่าแผนมาก"
  // ทั้งที่ยูนิตพวกนั้นขายได้จริง (เช่น U26/UN6/UN7 มีออเดอร์หลายพันในส่วนซื้อซ้ำ) แค่ชีทยังไม่มีแถว
  const hasRows: Record<string, Set<number>> = {};
  const monthsSet = new Set<number>();
  let asOf = '';
  rows.forEach((r) => {
    const d = String(r.date).slice(0, 10);
    if (!d.startsWith(year)) return;
    const m = Number(d.slice(5, 7));
    monthsSet.add(m);
    if (d > asOf) asOf = d;
    const u = String(r.u);
    (actual[u] = actual[u] || new Array(13).fill(0))[m] += num_(r.sales);
    (hasRows[u] = hasRows[u] || new Set<number>()).add(m);
  });
  const has_ = (u: string, m: number): boolean => !!hasRows[u] && hasRows[u].has(m);
  const monthsAvail = Array.from(monthsSet).sort((a, b) => a - b);
  const curMonth = Number(new Date(Date.now() + 7 * 3600000).toISOString().slice(5, 7));
  const ask = Number(p.month);
  const month = monthsAvail.includes(ask) ? ask : (monthsAvail[monthsAvail.length - 1] || curMonth);

  // รายยูนิตของเดือนที่เลือก + ยอดรายวีคในเดือน
  const mm = String(month).padStart(2, '0');
  const weekly: Record<string, Record<string, number>> = {};
  rows.forEach((r) => {
    const d = String(r.date).slice(0, 10);
    if (!d.startsWith(`${year}-${mm}`)) return;
    const u = String(r.u);
    const w = weekStart_(d);
    (weekly[u] = weekly[u] || {})[w] = (weekly[u][w] || 0) + num_(r.sales);
  });

  const allUnits = Array.from(new Set([...Object.keys(actual), ...Object.keys(targets)]));
  const isCurrent = month === curMonth && year === String(new Date().getFullYear());
  const daysInMonth = new Date(Number(year), month, 0).getDate();
  const dayOfMonth = Number(new Date(Date.now() + 7 * 3600000).toISOString().slice(8, 10));
  const daysLeft = isCurrent ? Math.max(1, daysInMonth - dayOfMonth + 1) : 0;

  const unitRows = allUnits.map((u) => {
    const t = (targets[u] || [])[month - 1] || 0;
    const a = (actual[u] || [])[month] || 0;
    // ไม่มีแถวในชีทเดือนนี้ = ยังไม่รู้ยอด → null ทั้งชุด (ยอด/%บรรลุ/ขาดอีก/ต้องขายเพิ่ม) ไม่ใช่ 0
    const noData = !has_(u, month);
    const attain = !noData && t > 0 ? Math.round((a / t) * 1000) / 10 : null;
    const wk = weekly[u] || {};
    return {
      u,
      product: productOf[u] || '',
      target: Math.round(t),
      actual: noData ? null : Math.round(a),
      attain,
      gap: !noData && t > 0 ? Math.round(Math.max(0, t - a)) : null,
      // เดือนปัจจุบัน: ต้องขายเพิ่มวันละเท่าไหร่ถึงจะจบเดือนตรงเป้า
      needPerDay: !noData && isCurrent && t > 0 && t > a ? Math.round((t - a) / daysLeft) : null,
      noData,
      weekly: Object.keys(wk).sort().map((w) => ({ week: w, sales: Math.round(wk[w]) })),
    };
  })
    .filter((x) => x.target > 0 || (x.actual || 0) > 0)
    // มีข้อมูลก่อน (เรียง %บรรลุ มาก→น้อย, ไม่ตั้งเป้าท้ายกลุ่ม) แล้วค่อยยูนิตที่ยังไม่มีในชีท
    .sort((a, b) => (Number(a.noData) - Number(b.noData)) ||
      (b.attain === null ? -1 : a.attain === null ? 1 : (b.attain - a.attain)));

  // สรุปทั้งปี: รายเดือน เป้ารวม vs จริงรวม + จำนวนยูนิตถึงเป้า
  // ยูนิตที่ตั้งเป้าแต่ชีทยังไม่มีแถวเดือนนั้น ไม่นับในเป้ารวม/ยูนิตที่ตัดสิน (E1) — เดิมนับเป็นยอด 0
  // ทำให้ %บรรลุรวมต่ำกว่าจริง · เป้าที่ตัดออกส่งไปเป็น missingTarget ให้หน้าเว็บบอกไว้ใต้ตาราง (ไม่หายเงียบ)
  const yearSummary = monthsAvail.map((m) => {
    // aTgt = ยอดจริงเฉพาะยูนิตที่มีเป้า — ตัวตั้งของ %บรรลุ (ยอดรวมทั้งเดือนยังเป็น aSum ทุกยูนิตเหมือนเดิม)
    let tSum = 0, aSum = 0, aTgt = 0, hit = 0, judged = 0, missN = 0, missT = 0;
    allUnits.forEach((u) => {
      const t = (targets[u] || [])[m - 1] || 0;
      const a = (actual[u] || [])[m] || 0;
      if (!has_(u, m)) {
        if (t > 0) { missN++; missT += t; }
        return;
      }
      tSum += t; aSum += a;
      if (t > 0) { aTgt += a; judged++; if (a >= t) hit++; }
    });
    return {
      month: m, label: TH_MONTHS[m - 1],
      target: Math.round(tSum), actual: Math.round(aSum), actualTgt: Math.round(aTgt),
      attain: tSum > 0 ? Math.round((aTgt / tSum) * 1000) / 10 : null,
      hitUnits: hit, judgedUnits: judged,
      missingUnits: missN, missingTarget: Math.round(missT),
      closed: m < curMonth, // เดือนที่จบแล้วเท่านั้นถึงตัดสิน "สำเร็จ/ไม่สำเร็จ" ได้จริง
    };
  });

  return {
    setupNeeded: false,
    year, month, monthsAvail, isCurrent, daysLeft,
    asOf, // วันล่าสุดที่ชีทสรุปรายสินค้ามีแถว — บรรทัด "ข้อมูลถึง" ใต้แถวเครื่องมือ
    hasTargets: Object.keys(targets).length > 0,
    units: unitRows,
    yearSummary,
  };
}
