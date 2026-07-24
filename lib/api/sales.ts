// lib/api/sales.ts — พอร์ตจาก WebApi.gs::apiSales (อ่านจาก Sheet → อ่านจาก Postgres)
// server-side เท่านั้น: import { db, fetchAll } จาก @/lib/db
// เปลี่ยนแค่แหล่งอ่าน (readTable_ → fetchAll) + กรองช่วงเวลาใน query เพื่อเลี่ยง 1000-row cap
import { db, fetchAll } from '@/lib/db';
import {
  EXCLUDED_STATUSES,
  NEED_CHECK_STATUSES,
  BKK_OFFSET_MS,
  num,
  money_,
  isPlaceholderOrder,
  parsePancakeTime,
  fmtDateBkk,
  startOfDayBkk,
  daysAgo,
} from '@/lib/config';

type Row = Record<string, any>;

interface Range {
  start: Date;
  end: Date;
  prevStart: Date;
  prevEnd: Date;
  label: string;
}

/* ---------------- utilities (พอร์ตจาก WebApi.gs) ---------------- */

/** ค่าจาก DB อาจเป็น number/string — แปลงเป็นตัวเลขเสมอ (0 เมื่อ NaN) */
function toNum_(v: unknown): number {
  return num(v);
}

/** boolean column คืน true/false อยู่แล้ว แต่รองรับ string 'TRUE' ด้วย */
function toBool_(v: unknown): boolean {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

/** timestamptz เป็น ISO string / date เป็น 'YYYY-MM-DD' → Date (เวลาไทย) */
function toDate_(v: unknown): Date | null {
  if (v instanceof Date) return v;
  return parsePancakeTime(v);
}

function toDateStr_(v: unknown): string {
  const d = toDate_(v);
  return d ? fmtDateBkk(d) : '';
}

/** ชั่วโมงของวัน (0-23) ตามเวลาไทย — แทน Date.getHours() เดิม (GAS รันบนโซนไทย) */
function bkkHour_(d: Date): number {
  return new Date(d.getTime() + BKK_OFFSET_MS).getUTCHours();
}

/**
 * platform string → กลุ่มช่องทาง 'facebook' | 'line' | 'other'
 * ใช้กติกาเดียวกันทุกหน้า (facebook รวม instagram/messenger)
 */
function platformChannel_(pf: unknown): string {
  const s = String(pf || '').toLowerCase();
  if (s === 'line') return 'line';
  if (s === 'facebook' || s === 'instagram' || s === 'messenger') return 'facebook';
  return s ? 'other' : 'facebook';
}

/** platform ของออเดอร์ → 'facebook' | 'line' | 'other' */
function orderChannel_(o: Row): string {
  return platformChannel_(o.platform);
}

function pctChange_(cur: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

function inRange_(d: Date | null, r: Range): boolean {
  return !!d && d.getTime() >= r.start.getTime() && d.getTime() <= r.end.getTime();
}

function inPrevRange_(d: Date | null, r: Range): boolean {
  return !!d && d.getTime() >= r.prevStart.getTime() && d.getTime() < r.prevEnd.getTime();
}

/** cutoff 24 ชม. สำหรับข้อมูลบทสนทนา */
function convCutoff_(): number {
  return Date.now() - 24 * 3600 * 1000;
}

/**
 * แปลง params ช่วงเวลา → {start, end, prevStart, prevEnd, label}
 * preset: today | 7d | 30d | month | custom (from/to = 'yyyy-MM-dd')
 */
function resolveRange_(params: any): Range {
  const p = params || {};
  const now = new Date();
  let start: Date;
  let end: Date = now;
  let label: string;
  switch (p.preset || 'today') {
    case '7d':
      start = daysAgo(6);
      label = '7 วันล่าสุด';
      break;
    case '30d':
      start = daysAgo(29);
      label = '30 วันล่าสุด';
      break;
    case 'month': {
      const ymd = fmtDateBkk(now); // YYYY-MM-DD (ไทย)
      start = new Date(`${ymd.slice(0, 7)}-01T00:00:00+07:00`);
      label = 'เดือนนี้';
      break;
    }
    case 'custom':
      start = parsePancakeTime((p.from || fmtDateBkk(now)) + 'T00:00:00') as Date;
      end = parsePancakeTime((p.to || fmtDateBkk(now)) + 'T23:59:59') as Date;
      if (end.getTime() > now.getTime()) end = now;
      label = (p.from || '') + ' ถึง ' + (p.to || '');
      break;
    default: // today
      start = startOfDayBkk(now);
      label = 'วันนี้';
  }
  const span = end.getTime() - start.getTime();
  // ช่วงเปรียบเทียบ: 'prev' = เลื่อนถอยเท่าช่วงที่เลือก | 'prev7'/'prev30' = เลื่อนถอย 7/30 วันตรงๆ
  // (เช่น "วันนี้ + เทียบก่อน 7 วัน" = เทียบกับวันเดียวกันสัปดาห์ก่อน)
  // clamp ไม่ให้เลื่อนน้อยกว่าความยาวช่วง — ไม่งั้นหน้าต่างเทียบซ้อนกับช่วงที่เลือกเอง เทรนด์เพี้ยน
  // (เลือก 30 วัน + เทียบก่อน 7 วัน → ถอยเท่าช่วงแทน = เทียบช่วงก่อนหน้าปกติ)
  let shiftMs = span;
  if (p.compare === 'prev7') shiftMs = Math.max(7 * 86400000, span);
  else if (p.compare === 'prev30') shiftMs = Math.max(30 * 86400000, span);
  const prevStart = new Date(start.getTime() - shiftMs);
  return {
    start,
    end,
    prevStart,
    prevEnd: new Date(prevStart.getTime() + span),
    label,
  };
}

/** items_json อาจเป็น jsonb (array แล้ว) หรือ string — คืน array เสมอ */
function parseItems_(v: any): any[] {
  if (Array.isArray(v)) return v;
  try {
    return JSON.parse(String(v || '[]'));
  } catch (e) {
    return [];
  }
}

/* ---------------- โหลดออเดอร์ (เฉพาะช่วงที่ต้องใช้) ---------------- */

// ช่วงเปรียบเทียบใช้แค่ยอดรวม → คอลัมน์เบา | ช่วงปัจจุบันต้องทำ Top เพจ/สินค้า → เพิ่ม page+items
// (แยกกันเพื่อไม่ให้ payload บวม: items_json ของช่วง prev 30 วันไม่มีใครใช้)
// items_count ต้องมีเสมอ — isPlaceholderOrder() ใช้ตัดออเดอร์เปล่า ถ้าไม่ดึงมาจะอ่านเป็น 0
// แล้วออเดอร์จริงที่ราคา 0 (ของแถม/แลกแต้ม) จะถูกทิ้งทั้งที่มีของ
const LIGHT_COLS = 'inserted_at,status,status_name,total_price,items_count,customer_id,ad_id,platform';
const FULL_COLS = LIGHT_COLS + ',page_id,account_name,items_json';

/**
 * อ่านออเดอร์จาก Postgres แปลงชนิดข้อมูลให้พร้อมใช้ (แถวละ object)
 * untilIso = null → ไม่จำกัดขอบบน (ถึงปัจจุบัน)
 */
async function loadOrders_(sinceIso: string, untilIso: string | null, cols: string): Promise<Row[]> {
  const rows = await fetchAll<Row>(() => {
    let q = db.from('orders').select(cols).gte('inserted_at', sinceIso);
    if (untilIso) q = q.lt('inserted_at', untilIso);
    return q;
  });
  return rows
    .map((o) => {
      o._at = toDate_(o.inserted_at);
      o.status = toNum_(o.status);
      o._placeholder = isPlaceholderOrder(o); // ต้องเช็คก่อนแปลงหน่วยเงิน (ใช้ค่าดิบ)
      o.total_price = money_(o.total_price);
      o._excluded = EXCLUDED_STATUSES.indexOf(o.status) >= 0;
      o._needCheck = NEED_CHECK_STATUSES.indexOf(o.status) >= 0;
      return o;
    })
    // ตัด "ออเดอร์เปล่า" ที่ Pancake สร้างให้ทุกแชทจากแอด (43% ของตาราง) ทิ้งตั้งแต่ต้นทาง
    // — ไม่ใช่ออเดอร์จริง ไม่มีสินค้า ไม่มีเงิน ถ้านับรวมจะทำให้ทุกตัวเลขนับหัวเพี้ยน
    .filter((o) => o._at && !o._placeholder);
}

/* ---------------- สถิติลูกค้าแบบเดียวกับหน้า Pancake (chat_engagement_daily) ---------------- */

interface Engagement {
  total: number;      // ลูกค้าที่มีปฏิสัมพันธ์ทั้งหมด (inbox+comment ตัดซ้ำ) — ไว้อ้างอิง
  reached: number;    // "คนทัก" = อินบ็อกซ์ใหม่ + คอมเมนต์ = ตัวหารของ %ปิดการขาย (ตามที่บอสกำหนด)
  newInbox: number;   // ลูกค้าที่เปิดบทสนทนาอินบ็อกซ์ใหม่
  comment: number;    // ลูกค้าที่ทักผ่านคอมเมนต์
  orders: number;     // "สร้างคำสั่งซื้อ" (ออเดอร์ที่สร้างจากแชท) — ตัวตั้ง
  oldOrders: number;  // ออเดอร์จากลูกค้าเก่า
  byCh: Record<string, { total: number; reached: number; newInbox: number; comment: number; orders: number }>;
}

const emptyChEng_ = () => ({ total: 0, reached: 0, newInbox: 0, comment: 0, orders: 0 });
const emptyEng_ = (): Engagement => ({
  total: 0, reached: 0, newInbox: 0, comment: 0, orders: 0, oldOrders: 0,
  byCh: { facebook: emptyChEng_(), line: emptyChEng_(), other: emptyChEng_() },
});

/**
 * รวมสถิติลูกค้าของช่วงที่เลือก จาก chat_engagement_daily
 * (ตัวเลขชุดนี้มาจาก statistics/customer_engagements — แหล่งเดียวกับที่ Pancake โชว์)
 *
 * "คนทัก" (reached) = อินบ็อกซ์ใหม่ + คอมเมนต์ — ตามที่บอสระบุว่าเป็น "คนทักจริง"
 * (ไม่ใช่ total ที่รวม inbox เดิมของลูกค้าเก่าด้วย)
 * คืน null เมื่อยังไม่ได้รัน migration → หน้าเว็บโชว์ "—" ไม่ใช่ 0
 */
async function loadEngagement_(r: Range): Promise<Engagement | null> {
  try {
    const rows = await fetchAll<Row>(() =>
      db.from('chat_engagement_daily')
        .select('key,date,platform,total,comment,new_inbox,order_count,old_order_count')
        .gte('date', fmtDateBkk(r.start))
        .lte('date', fmtDateBkk(r.end)),
      'key'
    );
    const e = emptyEng_();
    rows.forEach((row) => {
      const ch = platformChannel_(row.platform);
      const total = toNum_(row.total);
      const ni = toNum_(row.new_inbox);
      const cm = toNum_(row.comment);
      const reached = ni + cm;   // คนทัก
      const oc = toNum_(row.order_count);
      e.total += total; e.reached += reached; e.newInbox += ni; e.comment += cm;
      e.orders += oc; e.oldOrders += toNum_(row.old_order_count);
      const b = e.byCh[ch];
      b.total += total; b.reached += reached; b.newInbox += ni; b.comment += cm; b.orders += oc;
    });
    return e;
  } catch {
    return null; // ยังไม่มีตาราง chat_engagement_daily
  }
}

/* ---------------- ค่าแอดจริงรายวัน (ad_daily) ---------------- */

interface AdCost {
  spend: number;
  spendPrev: number | null;
  trend: number | null;
  roas: number | null;        // ยอดขาย / ค่าแอด (ใส่ทีหลังที่ผู้เรียก)
  activeAds: number;
  syncedAt: string | null;    // เวลาที่ sync ค่าแอดล่าสุด (ให้หน้าเว็บบอก "สดถึงเมื่อไหร่")
  worst: { name: string; spend: number }[];
  // ตัวเลข Meta pixel (ให้ ROAS/%ปิด ตรงหน้า Meta Ads dashboard)
  metaValue: number;          // ยอดขายที่ Meta ตี (บาทจริง)
  metaValuePrev: number;      // ช่วงก่อนหน้า
  metaPurchases: number;      // "ซื้อ" ที่ Meta ตี
  metaMsgs: number;           // "ทัก" (messaging_conversation_started_7d)
  adPageIds: string[];        // page_id ของเพจที่มีค่าแอด (spend>0) ในช่วง — ใช้ทำ ROAS ใหม่
}

/**
 * รวมค่าแอดจาก ad_daily ตามช่วงวันที่ (เวลาไทย)
 * คืน null เมื่อตารางยังไม่ถูกสร้าง — หน้าเว็บต้องโชว์ "-" ไม่ใช่ 0
 * (0 จะอ่านเหมือน "วัดแล้วได้ศูนย์" ซึ่งไม่จริง)
 */
async function loadAdCost_(r: Range, compare: boolean): Promise<AdCost | null> {
  const dateOf = (d: Date) => fmtDateBkk(d);
  try {
    // meta_purchases/value อาจยังไม่มีคอลัมน์ (ยังไม่รัน migration 2026-07-24) → ลองแบบเต็มก่อน
    let rows: Row[];
    try {
      rows = await fetchAll<Row>(() =>
        db.from('ad_daily')
          .select('date,ad_id,page_id,name,status,spend,pos_orders,meta_purchases,meta_purchase_value,msgs_started,updated_at')
          .gte('date', dateOf(r.prevStart))
          .lte('date', dateOf(r.end)),
        'ad_id'
      );
    } catch (e2: any) {
      if (!String((e2 && e2.message) || '').includes('meta_purchase')) throw e2;
      rows = await fetchAll<Row>(() =>
        db.from('ad_daily')
          .select('date,ad_id,page_id,name,status,spend,pos_orders,msgs_started,updated_at')
          .gte('date', dateOf(r.prevStart))
          .lte('date', dateOf(r.end)),
        'ad_id'
      );
    }
    const curFrom = dateOf(r.start), curTo = dateOf(r.end);
    const prevFrom = dateOf(r.prevStart), prevTo = dateOf(r.prevEnd);
    let spend = 0, spendPrev = 0, syncedAt: string | null = null;
    let metaValue = 0, metaValuePrev = 0, metaPurchases = 0, metaMsgs = 0;
    const activeIds: Record<string, 1> = {};
    const adPageSet: Record<string, 1> = {};   // เพจที่มี spend>0 ในช่วง
    const byAd: Record<string, { name: string; spend: number; orders: number }> = {};
    rows.forEach((a) => {
      const d = String(a.date || '').slice(0, 10);
      const sp = toNum_(a.spend);
      if (d >= curFrom && d <= curTo) {
        spend += sp;
        metaValue += toNum_(a.meta_purchase_value);
        metaPurchases += toNum_(a.meta_purchases);
        metaMsgs += toNum_(a.msgs_started);
        if (sp > 0 && a.page_id) adPageSet[String(a.page_id)] = 1;
        if (String(a.status || '').toUpperCase() === 'ACTIVE') activeIds[String(a.ad_id)] = 1;
        const id = String(a.ad_id);
        if (!byAd[id]) byAd[id] = { name: String(a.name || ''), spend: 0, orders: 0 };
        byAd[id].spend += sp;
        byAd[id].orders += toNum_(a.pos_orders);
        const u = String(a.updated_at || '');
        if (u && (!syncedAt || u > syncedAt)) syncedAt = u;
      } else if (d >= prevFrom && d < prevTo) {
        spendPrev += sp;
        metaValuePrev += toNum_(a.meta_purchase_value);
      }
    });
    const worst = Object.keys(byAd)
      .map((id) => byAd[id])
      .filter((a) => a.spend > 800 && a.orders === 0)
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 5);
    return {
      spend,
      spendPrev: compare ? spendPrev : null,
      trend: compare ? pctChange_(spend, spendPrev) : null,
      roas: null,
      activeAds: Object.keys(activeIds).length,
      syncedAt,
      worst,
      metaValue,
      metaValuePrev,
      metaPurchases,
      metaMsgs,
      adPageIds: Object.keys(adPageSet),
    };
  } catch (e: any) {
    const m = String((e && e.message) || e || '');
    // ตารางยังไม่ถูกสร้าง = ยังไม่ได้รัน migration → ไม่ใช่ error ของระบบ
    if (m.includes('ad_daily') && (m.includes('does not exist') || m.includes('schema cache'))) return null;
    throw e;
  }
}

/* ================================================================
 * apiSales
 * ================================================================ */

export async function apiSales(params: any) {
  const r = resolveRange_(params);
  const channel = (params && params.channel) || '';
  const compare = (params && params.compare) !== 'none';

  // orders ทั้งหมดที่อาจใช้ → กรองที่ query แยก 3 ก้อนกัน payload บวม:
  //   [prevStart, start)   คอลัมน์เบา (ช่วงเปรียบเทียบ)
  //   [start, end+1s)      คอลัมน์เต็ม (ทำ Top เพจ/สินค้า — จำกัดขอบบนตามช่วงที่เลือก
  //                        ไม่งั้น custom range ในอดีตจะลาก items_json หลายเดือนมาทิ้ง)
  //   [วันนี้ 00:00, now)  คอลัมน์เบา เฉพาะเมื่อช่วงที่เลือกจบก่อนวันนี้ (การ์ด "ธุรกิจวันนี้" ใช้)
  const startIso = r.start.toISOString();
  const endExclusiveIso = new Date(r.end.getTime() + 1000).toISOString(); // inRange_ รวม r.end — บวก 1 วิกันแถวตรงขอบหลุด
  const todayStartForFetch = startOfDayBkk(new Date());
  const needTodayChunk = r.end.getTime() < todayStartForFetch.getTime();
  const [prevRows, curRows, todayChunk] = await Promise.all([
    r.prevStart.getTime() < r.start.getTime()
      ? loadOrders_(r.prevStart.toISOString(), startIso, LIGHT_COLS)
      : Promise.resolve([] as Row[]),
    loadOrders_(startIso, endExclusiveIso, FULL_COLS),
    needTodayChunk
      ? loadOrders_(todayStartForFetch.toISOString(), null, LIGHT_COLS)
      : Promise.resolve([] as Row[]),
  ]);
  const orders = prevRows.concat(curRows, todayChunk);

  function matchChannel(o: Row): boolean {
    return !channel || orderChannel_(o) === channel;
  }

  const cur = orders.filter((o) => inRange_(o._at, r) && !o._excluded);
  const prev = orders.filter((o) => inPrevRange_(o._at, r) && !o._excluded);
  const curCh = cur.filter(matchChannel);
  const prevCh = prev.filter(matchChannel);

  function summarize(list: Row[]) {
    const s: any = { revenue: 0, orders: list.length, confirmed: 0, customers: {}, needCheck: 0, adRevenue: 0 };
    list.forEach((o) => {
      s.revenue += o.total_price;
      if (o.customer_id) s.customers[o.customer_id] = 1;
      if (o._needCheck) s.needCheck++;
      // "ยืนยันแล้ว" = ผ่านการยืนยันของแอดมินแล้ว (ไม่ใช่ออเดอร์ใหม่/รอยืนยัน)
      // Pancake นับตัวนี้เป็น "สร้างคำสั่งซื้อ" — เราโชว์คู่กับยอดรวมเพื่อให้เทียบกันได้
      else s.confirmed++;
      if (o.ad_id) s.adRevenue += o.total_price;
    });
    s.customers = Object.keys(s.customers).length;
    return s;
  }

  const sCur = summarize(curCh);
  const sPrev = summarize(prevCh);

  // channel boxes (ไม่สน channel filter — โชว์ทั้ง 3 เสมอ)
  function chanSummary(ch: string) {
    const list = ch ? cur.filter((o) => orderChannel_(o) === ch) : cur;
    const listPrev = ch ? prev.filter((o) => orderChannel_(o) === ch) : prev;
    const s = summarize(list);
    const sp = summarize(listPrev);
    return {
      revenue: s.revenue,
      orders: s.orders,
      customers: s.customers,
      trend: compare ? pctChange_(s.revenue, sp.revenue) : null,
    };
  }

  // ยอดขายรายชั่วโมง (รวมทุกวันในช่วง bucket ตามชั่วโมงของวัน)
  function hourlyBuckets(list: Row[]): number[] {
    const h: number[] = [];
    for (let i = 0; i < 24; i++) h.push(0);
    list.forEach((o) => {
      h[bkkHour_(o._at)] += o.total_price;
    });
    return h.map((v) => Math.round(v));
  }

  // สถิติแชท (ตัวหาร closeRate) — chat_hourly เกิน 1000 แถวได้ → fetchAll + กรอง date
  const todayStr = fmtDateBkk(new Date());
  const chatSince = fmtDateBkk(r.start) < todayStr ? fmtDateBkk(r.start) : todayStr;
  const chatRows = await fetchAll<Row>(() =>
    db
      .from('chat_hourly')
      .select('date,platform,new_inbox_count,new_customer_count')
      .gte('date', chatSince),
    'key'
  );
  let newConvs = 0;
  const newConvsByCh: Record<string, number> = { facebook: 0, line: 0, other: 0 };
  let todayNewCust = 0;
  chatRows.forEach((c) => {
    const d = toDate_(c.date);
    if (!d) return;
    const dayStart = startOfDayBkk(d).getTime();
    if (dayStart >= startOfDayBkk(r.start).getTime() && dayStart <= r.end.getTime()) {
      const n = toNum_(c.new_inbox_count);
      newConvs += n;
      newConvsByCh[platformChannel_(c.platform)] += n;
    }
    if (toDateStr_(c.date) === todayStr) todayNewCust += toNum_(c.new_customer_count);
  });
  // ---- %ปิดการขาย = ออเดอร์ที่สร้างจากแชท ÷ คนทัก ----
  // "คนทัก" (reached) = บทสนทนาอินบ็อกซ์ใหม่ + คอมเมนต์ ตามที่บอสระบุว่าเป็น "คนทักจริง"
  // ทั้งตัวตั้ง (order_count) และตัวหารมาจาก statistics/customer_engagements ของ Pancake
  // (สูตรเก่าใช้ total = รวม inbox ของลูกค้าเก่าด้วย ทำให้ตัวหารใหญ่เกิน %ต่ำผิด)
  const eng = await loadEngagement_(r);
  const engCh = eng
    ? (channel ? eng.byCh[channel]
       : { total: eng.total, reached: eng.reached, newInbox: eng.newInbox, comment: eng.comment, orders: eng.orders })
    : null;
  const closeRate = engCh && engCh.reached ? Math.round((engCh.orders / engCh.reached) * 1000) / 10 : null;
  // ตัวหารเดิม (บทสนทนาที่เปิดใหม่) ยังใช้ต่อในกล่องช่องทาง/ป้ายกำกับ
  const convBase = channel ? newConvsByCh[channel] || 0 : newConvs;

  // แผงข้อมูลวันนี้ (ไม่สนฟิลเตอร์)
  const todayRange = resolveRange_({ preset: 'today' });
  const todayOrders = orders.filter((o) => inRange_(o._at, todayRange) && !o._excluded);
  const sToday = summarize(todayOrders);
  let todayFb = 0;
  let todayLine = 0;
  let todayNeedCheck = 0;
  todayOrders.forEach((o) => {
    const ch = orderChannel_(o);
    if (ch === 'line') todayLine += o.total_price;
    else if (ch === 'facebook') todayFb += o.total_price;
    if (o._needCheck) todayNeedCheck++;
  });

  // แหล่งที่มา FB / LINE / อื่นๆ
  const sources = (['facebook', 'line', 'other'] as const)
    .map((ch) => {
      const list = cur.filter((o) => orderChannel_(o) === ch);
      const s = summarize(list);
      // ใช้สูตรเดียวกับ KPI ด้านบน (ออเดอร์จากแชท ÷ คนทัก = อินบ็อกซ์ใหม่ + คอมเมนต์)
      const e = eng ? eng.byCh[ch] : null;
      const cRate = e && e.reached ? Math.round((e.orders / e.reached) * 1000) / 10 : null;
      let status;
      if (!s.orders) status = { label: '—', cls: 'neutral' };
      else if (cRate !== null && cRate >= 20) status = { label: '✅ ดี', cls: 'ai' };
      else if (cRate !== null && cRate < 5) status = { label: '🛠 ต้องปรับ', cls: 'admin' };
      else status = { label: '👀 เฝ้าดู', cls: 'info' };
      return {
        key: ch,
        label: ch === 'facebook' ? '📘 Facebook' : ch === 'line' ? '🟢 LINE OA' : '🌐 อื่นๆ',
        revenue: Math.round(s.revenue),
        orders: s.orders,
        customers: s.customers,
        closeRate: cRate,
        status: status,
      };
    })
    .filter((s) => s.key !== 'other' || s.orders > 0);

  // ---- Top เพจ / Top สินค้า ของช่วงที่เลือก (ใช้ทั้ง hbar บนหน้า + drilldown modal) ----
  const pageNames: Record<string, string> = {};
  {
    const pageRows = await fetchAll<Row>(() => db.from('pages').select('page_id,name'), 'page_id');
    pageRows.forEach((p) => { pageNames[String(p.page_id)] = String(p.name || ''); });
  }

  function topAgg(list: Row[]) {
    const pages: Record<string, { revenue: number; orders: number }> = {};
    const products: Record<string, { qty: number; value: number; orders: number }> = {};
    list.forEach((o) => {
      const pg = pageNames[String(o.page_id || '')] || String(o.account_name || '') || 'ไม่ระบุเพจ';
      if (!pages[pg]) pages[pg] = { revenue: 0, orders: 0 };
      pages[pg].revenue += o.total_price;
      pages[pg].orders++;
      parseItems_(o.items_json).forEach((it: any) => {
        const nm = String((it && it.name) || '').trim();
        if (!nm) return;
        const qty = toNum_(it.qty) || 1;
        if (!products[nm]) products[nm] = { qty: 0, value: 0, orders: 0 };
        products[nm].qty += qty;
        products[nm].value += money_(it.price) * qty; // มูลค่าตามราคาขาย (ประมาณ — ไม่หักส่วนลดท้ายบิล)
        products[nm].orders++;
      });
    });
    return {
      pages: Object.keys(pages)
        .map((nm) => ({ name: nm, revenue: Math.round(pages[nm].revenue), orders: pages[nm].orders }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10),
      products: Object.keys(products)
        .map((nm) => ({ name: nm, qty: products[nm].qty, value: Math.round(products[nm].value), orders: products[nm].orders }))
        .sort((a, b) => (b.value - a.value) || (b.qty - a.qty))
        .slice(0, 10),
    };
  }

  const top = {
    all: topAgg(cur),
    facebook: topAgg(cur.filter((o) => orderChannel_(o) === 'facebook')),
    line: topAgg(cur.filter((o) => orderChannel_(o) === 'line')),
  };

  // ---- ลูกค้าเก่า (เคยซื้อภายใน 95 วันก่อนช่วงที่เลือก) — นับฝั่ง Postgres ผ่าน RPC ----
  // RPC ยังไม่ถูกสร้าง (migration ไม่ได้รัน) → คืน null ให้หน้าเว็บแสดง "—" ไม่ใช่เลขปลอม
  let returning: { total: number; returning: number; pct: number | null } | null = null;
  {
    const lookback = new Date(r.start.getTime() - 95 * 86400000);
    const { data: rc, error: rcErr } = await db.rpc('sales_returning_customers', {
      p_start: r.start.toISOString(),
      p_end: r.end.toISOString(),
      p_lookback: lookback.toISOString(),
      p_channel: channel,
      p_excluded: EXCLUDED_STATUSES,
    });
    if (!rcErr && rc) {
      const row = Array.isArray(rc) ? rc[0] : rc;
      if (row) {
        const total = toNum_(row.total_customers);
        const ret = toNum_(row.returning_customers);
        returning = { total, returning: ret, pct: total ? Math.round((ret / total) * 1000) / 10 : null };
      }
    }
  }

  // สถานะออเดอร์ในช่วง (รวมที่ถูก exclude ด้วย เพื่อให้เห็นยกเลิก/ตีกลับ)
  const statusCount: Record<string, number> = {};
  orders
    .filter((o) => inRange_(o._at, r) && matchChannel(o))
    .forEach((o) => {
      const nm = String(o.status_name || o.status);
      statusCount[nm] = (statusCount[nm] || 0) + 1;
    });

  // แจ้งเตือน
  const alerts: any[] = [];
  if (todayNeedCheck > 0) {
    alerts.push({
      icon: '🧾',
      title: 'ออเดอร์รอตรวจ/รอยืนยัน',
      reason: 'วันนี้มี ' + todayNeedCheck + ' ออเดอร์ที่ยังไม่ยืนยัน',
      level: 'orange',
      view: 'sales',
    });
  }
  const alertCutoff = convCutoff_();
  // conversations เกิน 1000 แถวได้ → กรอง waiting + updated_at >= cutoff ที่ query แล้วนับ
  const cutoffIso = new Date(alertCutoff).toISOString();
  const waitingRows = await fetchAll<Row>(() =>
    db.from('conversations').select('id').eq('waiting', true).gte('updated_at', cutoffIso)
  );
  const waitingConvs = waitingRows.length;
  if (waitingConvs >= 10) {
    alerts.push({
      icon: '💬',
      title: 'แชทค้างรอตอบเยอะ',
      reason: 'มี ' + waitingConvs + ' บทสนทนาที่ลูกค้ารอการตอบกลับ',
      level: 'red',
      view: 'dashboard',
    });
  } else if (waitingConvs > 0) {
    alerts.push({
      icon: '💬',
      title: 'แชทรอตอบ',
      reason: 'มี ' + waitingConvs + ' บทสนทนารอการตอบกลับ',
      level: 'yellow',
      view: 'dashboard',
    });
  }
  // ---- ค่าแอดจริง (ad_daily) + ROAS ของช่วงที่เลือก ----
  // spend ใน ad_daily เป็นบาทจริง (ทศนิยม) ไม่ใช่สตางค์ — ห้ามหาร MONEY_SCALE
  // ตารางอาจยังไม่ถูกสร้าง (ยังไม่รัน migration) → คืน null ให้หน้าเว็บโชว์ "-" ไม่ใช่ 0
  const adCost = await loadAdCost_(r, compare);

  // ---- ยอดขายแยกช่องทาง (ไม่สน channel filter — ใช้ทำ ROAS หลายแบบ) ----
  // เพจ = Facebook, ไลน์ = LINE — คิดจาก cur (ทุกช่องทางในช่วง) ตัดออเดอร์ยกเลิกแล้ว
  let fbRev = 0, lineRev = 0, adPagesRev = 0;
  const adPageSet = new Set((adCost && adCost.adPageIds) || []);
  cur.forEach((o) => {
    const chn = orderChannel_(o);
    if (chn === 'facebook') fbRev += o.total_price;
    else if (chn === 'line') lineRev += o.total_price;
    // ยอดขายของ "เพจที่ยิงแอด" — เฉพาะเพจที่มีค่าแอด>0 ในช่วงนี้ (ทำ ROAS ใหม่)
    if (o.page_id && adPageSet.has(String(o.page_id))) adPagesRev += o.total_price;
  });
  const fbLineRev = fbRev + lineRev;

  const badAds = (adCost && adCost.worst) ? adCost.worst : [];
  if (badAds.length) {
    alerts.push({
      icon: '🕳',
      title: 'แอดจ่ายแล้วไม่มีออเดอร์',
      reason:
        badAds.length +
        ' แอดใช้เงิน >฿800 แต่ยังไม่มีออเดอร์ เช่น "' +
        String(badAds[0].name).slice(0, 40) +
        '"',
      level: 'red',
      view: 'contentads',
    });
  }
  // ROAS แบบ Meta (ยอดที่ Meta ตี ÷ ค่าแอด) — ต่ำกว่า 1 = ขายได้น้อยกว่าค่าแอด
  const adRoas = (adCost && adCost.spend > 0 && adCost.metaValue > 0)
    ? adCost.metaValue / adCost.spend : null;
  if (adCost && adRoas !== null && adRoas < 1) {
    alerts.push({
      icon: '📉',
      title: 'ROAS ต่ำกว่าทุน',
      reason: 'ช่วงนี้ยอดขายจากแอด(Meta) ฿' + Math.round(adCost.metaValue).toLocaleString('th-TH') +
        ' จากค่าแอด ฿' + Math.round(adCost.spend).toLocaleString('th-TH') +
        ' (ROAS ' + adRoas.toFixed(2) + 'x)',
      level: 'red',
      view: 'contentads',
    });
  }

  return {
    rangeLabel: r.label,
    kpis: {
      revenue: Math.round(sCur.revenue),
      orders: sCur.orders,
      // ออเดอร์ที่แอดมินยืนยันแล้ว — Pancake นับตัวนี้เป็น "สร้างคำสั่งซื้อ"
      confirmedOrders: sCur.confirmed,
      customers: sCur.customers,
      avgOrder: sCur.orders ? Math.round(sCur.revenue / sCur.orders) : 0,
      needCheck: sCur.needCheck,
      adRevenue: Math.round(sCur.adRevenue),
      // %ปิดการขาย = ออเดอร์ที่สร้างจากแชท ÷ คนทัก (อินบ็อกซ์ใหม่ + คอมเมนต์)
      closeRate: closeRate,
      closeBase: engCh ? engCh.reached : null,      // คนทัก = ตัวหาร
      closeOrders: engCh ? engCh.orders : null,     // ออเดอร์จากแชท = ตัวตั้ง
      closeNewInbox: engCh ? engCh.newInbox : null, // ในคนทัก: อินบ็อกซ์ใหม่กี่คน
      closeComment: engCh ? engCh.comment : null,   // ในคนทัก: คอมเมนต์กี่คน
      engTotal: engCh ? engCh.total : null,         // ลูกค้าคุยทั้งหมด (อ้างอิง)
      newInbox: engCh ? engCh.newInbox : null,
      newConvs: convBase,
    },
    // ค่าแอด + ROAS ของช่วงที่เลือก — null = ยังไม่ได้รัน migration ad_daily (หน้าเว็บโชว์ "-")
    // ⚠️ ROAS นับยอดขาย "ทุกช่องทาง" หารค่าแอดทั้งหมด (ไม่ได้จับคู่รายแอด)
    //    ค่าแอดไม่ได้แยก FB/LINE จึงไม่กรองตาม channel filter — ป้ายบนหน้าเว็บบอกไว้แล้ว
    adCost: adCost ? {
      spend: Math.round(adCost.spend),
      trend: adCost.trend,
      activeAds: adCost.activeAds,
      syncedAt: adCost.syncedAt,
      // ROAS = ยอดขายที่ Meta ตี ÷ ค่าแอด (ตรงหน้า Meta Ads dashboard)
      // เดิมใช้ยอดขายรวมทุกช่องทาง (รวม organic/LINE/ลูกค้าเก่า) หารค่าแอด → พองเกินจริง
      roas: adCost.spend > 0 && adCost.metaValue > 0
        ? Math.round((adCost.metaValue / adCost.spend) * 100) / 100 : null,
      roasPrev: (compare && adCost.spendPrev && adCost.spendPrev > 0 && adCost.metaValuePrev > 0)
        ? Math.round((adCost.metaValuePrev / adCost.spendPrev) * 100) / 100 : null,
      // ยอดขายจากแอด (Meta) + %ปิดแบบ Meta = ซื้อ ÷ ทัก
      adRevenueMeta: Math.round(adCost.metaValue),
      adCloseRate: adCost.metaMsgs > 0
        ? Math.round((adCost.metaPurchases / adCost.metaMsgs) * 1000) / 10 : null,
      adPurchases: adCost.metaPurchases,
      adMsgs: adCost.metaMsgs,
      // ---- ROAS แบบยอดขาย POS จริง (บอสสั่งเพิ่ม 2026-07-24) ----
      // ROAS ใหม่  = ยอดขายเฉพาะเพจที่ยิงแอด ÷ ค่าแอด
      // ROAS รวม  = ยอดขายทั้งหมดของ Facebook ÷ ค่าแอด
      roasNew: adCost.spend > 0 ? Math.round((adPagesRev / adCost.spend) * 100) / 100 : null,
      roasAll: adCost.spend > 0 ? Math.round((fbRev / adCost.spend) * 100) / 100 : null,
      adPagesRev: Math.round(adPagesRev),
    } : null,
    // ยอดขายแยกช่องทาง (ไม่ขึ้นกับ channel filter — โชว์ครบเสมอ)
    salesBreak: {
      total: Math.round(fbLineRev),   // เพจ + ไลน์
      fb: Math.round(fbRev),          // ยอดขายเพจ (Facebook)
      line: Math.round(lineRev),      // ยอดขายไลน์
    },
    trends: {
      revenue: compare ? pctChange_(sCur.revenue, sPrev.revenue) : null,
      orders: compare ? pctChange_(sCur.orders, sPrev.orders) : null,
    },
    channels: {
      all: chanSummary(''),
      facebook: chanSummary('facebook'),
      line: chanSummary('line'),
    },
    hourly: hourlyBuckets(curCh),
    hourlyPrev: compare ? hourlyBuckets(prevCh) : null,
    today: {
      revenue: Math.round(sToday.revenue),
      orders: sToday.orders,
      fb: Math.round(todayFb),
      line: Math.round(todayLine),
      newCust: todayNewCust,
      needCheck: todayNeedCheck,
      hourly: hourlyBuckets(todayOrders),
    },
    sources: sources,
    top: top,
    returning: returning,
    statusBreakdown: Object.keys(statusCount)
      .map((nm) => {
        return { name: nm, count: statusCount[nm] };
      })
      .sort((a, b) => b.count - a.count),
    alerts: alerts.slice(0, 3),
  };
}
