// lib/api/sales.ts — พอร์ตจาก WebApi.gs::apiSales (อ่านจาก Sheet → อ่านจาก Postgres)
// server-side เท่านั้น: import { db, fetchAll } จาก @/lib/db
// เปลี่ยนแค่แหล่งอ่าน (readTable_ → fetchAll) + กรองช่วงเวลาใน query เพื่อเลี่ยง 1000-row cap
import { db, fetchAll, fetchAllSliced, fetchAllDateSliced, dbStats } from '@/lib/db';
import { getPageUnitMap, getUnitTargets } from './umap';
import { nicknameByName } from './adminsettings';
import {
  EXCLUDED_STATUSES,
  NEED_CHECK_STATUSES,
  ORDER_STATUS_TH,
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
  prevLabel: string;   // ชื่อสั้นของหน้าต่างเทียบ เช่น '1 วันที่แล้ว' (ทูลทิปกราฟใช้)
  prevWindow: string;  // ช่วงจริงที่เทียบ เช่น '24 ก.ค. 00:00–14:32 น.' (legend/caption ใช้)
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

const TH_MON_ = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** 'HH:mm' เวลาไทย */
function bkkHm_(d: Date): string {
  const t = new Date(d.getTime() + BKK_OFFSET_MS);
  return ('0' + t.getUTCHours()).slice(-2) + ':' + ('0' + t.getUTCMinutes()).slice(-2);
}

/** '24 ก.ค. 14:32' (หรือ '24 ก.ค.' เมื่อ withTime=false) — เวลาไทย ไว้บอกช่วงให้คนอ่านเข้าใจ */
function bkkDT_(d: Date, withTime = true): string {
  const ymd = fmtDateBkk(d);
  const s = Number(ymd.slice(8, 10)) + ' ' + (TH_MON_[Number(ymd.slice(5, 7)) - 1] || '');
  return withTime ? s + ' ' + bkkHm_(d) : s;
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
 * preset: today | yesterday | 3d | 7d | 30d | month | custom (from/to = 'yyyy-MM-dd')
 * ⚠️ ต้องมีครบทุก key ใน RANGE_PRESETS (lib/ui/helpers.ts) — key ที่ไม่มี case จะตกไป default = วันนี้ เงียบๆ
 */
function resolveRange_(params: any): Range {
  const p = params || {};
  const preset = p.preset || 'today';
  const now = new Date();
  let start: Date;
  let end: Date = now;
  let label: string;
  switch (preset) {
    case 'yesterday':
      // เมื่อวาน = ทั้งวัน 00:00:00.000–23:59:59.999 เวลาไทย
      // (ไม่ตัดที่ "ตอนนี้" เหมือน preset อื่น — วันมันจบไปแล้ว ต้องได้ยอดเต็มวัน)
      start = daysAgo(1);
      end = new Date(startOfDayBkk(now).getTime() - 1);
      label = 'เมื่อวานนี้';
      break;
    case '3d':
      start = daysAgo(2); // 3 วันล่าสุด "รวมวันนี้" — กติกาเดียวกับ 7d/30d
      label = '3 วันล่าสุด';
      break;
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
  // ช่วงเปรียบเทียบ: 'prev' = เลื่อนถอยเท่าช่วงที่เลือก | 'prevN' = เลื่อนถอย N วันตรงๆ
  // (เช่น "วันนี้ + เทียบ 7 วันที่แล้ว" = เทียบกับวันเดียวกันสัปดาห์ก่อน)
  // clamp ไม่ให้เลื่อนน้อยกว่าความยาวช่วง — ไม่งั้นหน้าต่างเทียบซ้อนกับช่วงที่เลือกเอง เทรนด์เพี้ยน
  // (เลือก 30 วัน + เทียบ 7 วันที่แล้ว → ถอยเท่าช่วงแทน = เทียบช่วงก่อนหน้าปกติ)
  let shiftMs = span;
  // 'yesterday' จบที่ 23:59:59.999 → span สั้นกว่าวันจริง 1ms ถ้าเลื่อนถอยเท่า span
  // ช่วงเทียบจะเริ่ม 00:00:00.001 แล้วออเดอร์ตอนเที่ยงคืนตรงของวันก่อนหน้าหลุด — เลื่อนเต็มวันแทน
  if (preset === 'yesterday') shiftMs = 86400000;
  // prev1/prev3 (บอสสั่งเพิ่ม) ใช้กติกาเดียวกับ prev7/prev30 เป๊ะ — คง clamp ไว้เหมือนเดิม
  const shiftDaysWant = ({ prev1: 1, prev3: 3, prev7: 7, prev30: 30 } as Record<string, number>)[String(p.compare)];
  if (shiftDaysWant) shiftMs = Math.max(shiftDaysWant * 86400000, span);
  const prevStart = new Date(start.getTime() - shiftMs);
  const prevEnd = new Date(prevStart.getTime() + span);
  // ---- ป้ายบอกว่า "เทียบกับอะไร" (เดิมหน้าเว็บเขียน "ช่วงก่อนหน้า" ตายตัว ทั้งที่อาจเทียบ 7/30 วัน) ----
  // clamp อาจดันหน้าต่างเทียบให้ถอยไกลกว่าที่ผู้ใช้เลือก → บอกตามจริงว่ากลายเป็นช่วงก่อนหน้า
  const shiftDaysReal = Math.round(shiftMs / 86400000);
  const prevLabel = (shiftDaysWant && shiftDaysReal <= shiftDaysWant)
    ? shiftDaysWant + ' วันที่แล้ว'
    : 'ช่วงก่อนหน้า';
  // ⚠️ เคสที่คนอ่านผิดบ่อย: preset=today + เทียบช่วงก่อนหน้า → span = แค่ชั่วโมงที่ผ่านไปวันนี้
  //    หน้าต่างเทียบเลยเป็น "เมื่อวานช่วงบ่าย-ดึก" ไม่ใช่ทั้งวัน — จึงส่งช่วงจริงไปโชว์เสมอ
  const prevWindow = fmtDateBkk(prevStart) === fmtDateBkk(prevEnd)
    ? bkkDT_(prevStart) + '–' + bkkHm_(prevEnd) + ' น.'
    : bkkDT_(prevStart) + ' – ' + bkkDT_(prevEnd) + ' น.';
  return {
    start,
    end,
    prevStart,
    prevEnd,
    label,
    prevLabel,
    prevWindow,
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
// คอลัมน์ที่ใช้ทำ "ตารางออเดอร์ที่ต้องตรวจ" (modal) — ต้องมีในช่วงที่เลือก + ช่วงวันนี้ แต่ไม่ต้องมีในช่วงเทียบ
const DETAIL_COLS = 'id,display_id,customer_name,seller_name,creator_name';
const FULL_COLS = LIGHT_COLS + ',page_id,account_name,items_json,' + DETAIL_COLS;
// ก้อน "วันนี้" ไม่ต้องมี items_json (ไม่ได้ทำ Top สินค้า) แต่ต้องมีชื่อเพจ + รายละเอียดออเดอร์
const TODAY_COLS = LIGHT_COLS + ',page_id,account_name,' + DETAIL_COLS;

/**
 * อ่านออเดอร์จาก Postgres แปลงชนิดข้อมูลให้พร้อมใช้ (แถวละ object)
 * untilIso = null → ไม่จำกัดขอบบน (ถึงปัจจุบัน)
 */
async function loadOrders_(sinceIso: string, untilIso: string | null, cols: string): Promise<Row[]> {
  // หั่นช่วงเป็นก้อนดึงขนาน — ช่วงยาวๆ OFFSET ลึกช้าและชน statement timeout (ดู fetchAllSliced)
  const rows = await fetchAllSliced<Row>(
    (f, t) => db.from('orders').select(cols).gte('inserted_at', f).lt('inserted_at', t),
    new Date(sinceIso),
    untilIso ? new Date(new Date(untilIso).getTime() - 1) : new Date(), // -1ms: ก้อนใช้ [from,to) อยู่แล้ว คงความหมาย lt เดิม
  );
  return rows
    .map((o) => {
      o._at = toDate_(o.inserted_at);
      o.status = toNum_(o.status);
      o._placeholder = isPlaceholderOrder(o); // ต้องเช็คก่อนแปลงหน่วยเงิน (ใช้ค่าดิบ)
      o.total_price = money_(o.total_price);
      o._excluded = EXCLUDED_STATUSES.indexOf(o.status) >= 0;
      o._needCheck = NEED_CHECK_STATUSES.indexOf(o.status) >= 0;
      // 🧠 แตก items_json เป็น {name, qty} เล็กๆ แล้วทิ้งก้อนดิบทันที — jsonb ต่อแถวหลาย KB
      // ช่วงยาว 50k+ แถวถือรวมกันหลายร้อย MB จน function ตายเงียบ (OOM ไม่มี error ไม่มี log)
      if (o.items_json !== undefined) {
        o._items = parseItems_(o.items_json)
          .map((it: any) => ({ name: it && it.name, qty: (it && it.qty) || 1, price: (it && it.price) || 0 }));
        delete o.items_json;
      }
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
    // หั่นตามวัน — ช่วงนี้กิน "ช่วงที่เลือก + ช่วงเทียบ" (เลือก 35 วัน = ดึง 70 วัน ~56k แถว)
    // OFFSET ลึกช้าและโดน statement timeout ตัดจนหน้า 500 ทั้งหน้า (ดู fetchAllDateSliced)
    let rows: Row[];
    try {
      rows = await fetchAllDateSliced<Row>((f, t) =>
        db.from('ad_daily')
          .select('date,ad_id,page_id,name,status,spend,pos_orders,meta_purchases,meta_purchase_value,msgs_started,updated_at')
          .gte('date', f).lte('date', t),
        dateOf(r.prevStart), dateOf(r.end), { orderColumn: 'date,ad_id' }
      );
    } catch (e2: any) {
      if (!String((e2 && e2.message) || '').includes('meta_purchase')) throw e2;
      rows = await fetchAllDateSliced<Row>((f, t) =>
        db.from('ad_daily')
          .select('date,ad_id,page_id,name,status,spend,pos_orders,msgs_started,updated_at')
          .gte('date', f).lte('date', t),
        dateOf(r.prevStart), dateOf(r.end), { orderColumn: 'date,ad_id' }
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

/* ---------------- สินค้าตีกลับ (ตาราง returns) ---------------- */

/**
 * รวมสินค้าตีกลับในช่วงที่เลือก แยกตามเดือน / คน / สินค้า
 *
 * ที่มาของข้อมูลคือชีทที่ทีมกรอกมือ ไม่ใช่ Pancake (Pancake ไม่มีใบตีกลับเลยสักใบ)
 * คืน null เมื่อยังไม่ได้รัน migration returns → หน้าเว็บซ่อนการ์ดนี้แทนที่จะโชว์ 0 ที่ไม่จริง
 */
async function loadReturns_(r: Range) {
  const from = fmtDateBkk(r.start), to = fmtDateBkk(r.end);
  const rows = await fetchAll<Row>(() =>
    db.from('returns').select('key,month,staff,is_crm,price,qty,product,return_date')
      .gte('return_date', from).lte('return_date', to), 'key');

  const byMonth: Record<string, { orders: number; value: number }> = {};
  const byStaff: Record<string, { orders: number; value: number }> = {};
  const byProduct: Record<string, { orders: number; value: number }> = {};
  let value = 0, crmOrders = 0, crmValue = 0;
  rows.forEach((x) => {
    const v = toNum_(x.price) * (toNum_(x.qty) || 1);
    value += v;
    if (x.is_crm) { crmOrders++; crmValue += v; }
    const add = (b: Record<string, { orders: number; value: number }>, k: string) => {
      const key = k || 'ไม่ระบุ';
      if (!b[key]) b[key] = { orders: 0, value: 0 };
      b[key].orders++; b[key].value += v;
    };
    add(byMonth, String(x.month || ''));
    add(byStaff, String(x.staff || ''));
    add(byProduct, String(x.product || ''));
  });
  const list = (b: Record<string, { orders: number; value: number }>, sortByName?: boolean) =>
    Object.keys(b)
      .map((k) => ({ name: k, orders: b[k].orders, value: Math.round(b[k].value) }))
      .sort((a, x) => (sortByName ? (a.name < x.name ? -1 : 1) : x.orders - a.orders));

  return {
    orders: rows.length,
    value: Math.round(value),
    crmOrders,
    crmValue: Math.round(crmValue),
    adminOrders: rows.length - crmOrders,
    adminValue: Math.round(value - crmValue),
    byMonth: list(byMonth, true),
    byStaff: list(byStaff).slice(0, 60),
    byProduct: list(byProduct).slice(0, 40),
  };
}

/* ---------------- ต้นทุน/คนทัก แยกตามยูนิต ---------------- */

/** วันจันทร์ของสัปดาห์ที่วันนั้นอยู่ (เวลาไทย) เป็น 'YYYY-MM-DD' */
function bkkWeekStart_(d: Date): string {
  // ยึดเที่ยงวันไทยเป็นหลัก — บวกลบวันข้ามเดือน/ข้ามปีแล้วไม่หลุดไปวันข้างเคียง
  const noon = new Date(fmtDateBkk(d) + 'T12:00:00+07:00');
  const dow = (noon.getUTCDay() + 6) % 7;   // จันทร์ = 0
  return fmtDateBkk(new Date(noon.getTime() - dow * 86400000));
}

export interface UnitCost { spend: number; msgs: number; reached: number; engOrders: number }
type UnitCostByChannel = Record<string, Record<string, UnitCost>>;

/**
 * ค่าแอด (ad_daily) + คนทัก (chat_engagement_daily) รวมเป็นรายยูนิต
 *
 * ทั้งสองตารางเก็บเป็น "รายเพจต่อวัน" จึงจับเข้ายูนิตผ่าน pageUnit ได้ตรงๆ
 * แยกเก็บ 3 ช่อง (all / facebook / line) ตาม platform ของเพจ เพื่อให้สลับแท็บช่องทาง
 * แล้วตัวเลขต้นทุนขยับตามยอดขาย ไม่ใช่ค้างเป็นยอดรวมทุกช่อง
 *
 * เพจที่ยังไม่จับคู่ยูนิตตกกลุ่ม UNMAPPED เหมือนฝั่งยอดขาย — ตัวเลขจึงบวกกลับได้ครบเสมอ
 */
async function loadUnitCost_(
  r: Range,
  pageUnit: Record<string, { u: string; product: string }>,
  pagePlatform: Record<string, string>,
  unmappedKey: string
): Promise<UnitCostByChannel> {
  const from = fmtDateBkk(r.start), to = fmtDateBkk(r.end);
  const out: UnitCostByChannel = { all: {}, facebook: {}, line: {} };
  const bump = (pageId: string, patch: Partial<UnitCost>) => {
    const um = pageUnit[pageId];
    const key = um ? um.u : unmappedKey;
    const ch = platformChannel_(pagePlatform[pageId] || '');
    for (const bucket of ['all', ch]) {
      if (!out[bucket]) continue;   // ch = 'other' ไม่มีถัง — นับเฉพาะ all
      if (!out[bucket][key]) out[bucket][key] = { spend: 0, msgs: 0, reached: 0, engOrders: 0 };
      const t = out[bucket][key];
      t.spend += patch.spend || 0;
      t.msgs += patch.msgs || 0;
      t.reached += patch.reached || 0;
      t.engOrders += patch.engOrders || 0;
    }
  };

  try {
    const ads = await fetchAllDateSliced<Row>((f, t) =>
      db.from('ad_daily').select('ad_id,date,page_id,spend,msgs_started')
        .gte('date', f).lte('date', t), from, to, { orderColumn: 'date,ad_id' });
    ads.forEach((a) => {
      const pid = String(a.page_id || '');
      if (!pid) return;   // แอดที่ Pancake ยังไม่ผูกเพจ — ยัดเข้ายูนิตไหนก็มั่ว ทิ้งดีกว่าเดา
      bump(pid, { spend: toNum_(a.spend), msgs: toNum_(a.msgs_started) });
    });
  } catch { /* ยังไม่มีตาราง ad_daily — ปล่อยค่าเป็น 0 แล้วให้ฝั่ง UI โชว์ "—" */ }

  try {
    const eng = await fetchAll<Row>(() =>
      db.from('chat_engagement_daily').select('key,date,page_id,new_inbox,comment,order_count')
        .gte('date', from).lte('date', to), 'key');
    eng.forEach((e) => {
      const pid = String(e.page_id || '');
      if (!pid) return;
      bump(pid, { reached: toNum_(e.new_inbox) + toNum_(e.comment), engOrders: toNum_(e.order_count) });
    });
  } catch { /* ยังไม่มีตาราง chat_engagement_daily */ }

  return out;
}

/**
 * %ซื้อซ้ำ + ระยะห่างรอบซื้อ ของลูกค้ากลุ่มหนึ่ง (นับ "ภายในช่วงที่เลือก" เท่านั้น)
 *
 * ⚠️ ตัวเลขนี้ต่ำกว่าความจริงเสมอเมื่อช่วงสั้น — ลูกค้าที่ซื้อครั้งแรกเดือนก่อนแล้วซื้อซ้ำเดือนนี้
 * จะถูกนับเป็น "ซื้อครั้งเดียว" หน้าเว็บจึงต้องเขียนกำกับว่าเป็นการซื้อซ้ำในช่วงที่เลือก
 * (ตัวเลข "ลูกค้าเก่า" ที่มองย้อน 95 วันอยู่ที่ KPI ด้านบน คนละนิยามกัน)
 *
 * รอบซื้อใช้ค่ามัธยฐาน ไม่ใช่ค่าเฉลี่ย — ลูกค้าที่ซื้อรัวๆ วันเดียวกันจะดึงค่าเฉลี่ยเพี้ยน
 */
function repeatStats_(byCustomer: Record<string, number[]>) {
  const ids = Object.keys(byCustomer);
  let repeat = 0;
  const gaps: number[] = [];
  ids.forEach((id) => {
    const ts = byCustomer[id];
    if (ts.length < 2) return;
    repeat++;
    ts.sort((a, b) => a - b);
    for (let i = 1; i < ts.length; i++) gaps.push((ts[i] - ts[i - 1]) / 86400000);
  });
  gaps.sort((a, b) => a - b);
  const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
  return {
    customers: ids.length,
    repeat,
    rate: ids.length ? Math.round((repeat / ids.length) * 1000) / 10 : null,
    cycleDays: median === null ? null : Math.round(median * 10) / 10,
  };
}

/**
 * ประกอบแถว "ยูนิต" ที่ส่งให้หน้าเว็บ — ยอดขาย + ต้นทุนแอด + คนทัก + รายสัปดาห์
 *
 * ตัวหาร 0 คืน null ไม่ใช่ 0 ทุกจุด — หน้าเว็บจะได้แสดง "—" แทนเลขที่อ่านเหมือนวัดแล้วได้ศูนย์
 * (เช่นยูนิตที่ไม่ยิงแอดเลย ROAS ไม่ใช่ 0 แต่ "ไม่มีค่า")
 */
function unitRows_(
  unitAgg: Record<string, { u: string; product: string; revenue: number; orders: number }>,
  unitPages: Record<string, Record<string, { revenue: number; orders: number }>>,
  unitWeekly: Record<string, Record<string, number>>,
  unitCust: Record<string, Record<string, number[]>>,
  cost: Record<string, UnitCost>,
  unmappedKey: string,
  goal: { targets: Record<string, number>; monthRevenue: Record<string, number>; daysLeft: number }
) {
  // ยูนิตที่ "ยิงแอดแต่ยังไม่มียอด" ต้องโผล่ด้วย ไม่งั้นค่าแอดที่จ่ายไปหายจากหน้าจอเงียบๆ
  const keys = Array.from(new Set(Object.keys(unitAgg).concat(Object.keys(cost))));
  const grand = keys.reduce((s, k) => s + ((unitAgg[k] && unitAgg[k].revenue) || 0), 0);
  return keys
    .map((k) => {
      const agg = unitAgg[k] || { u: k === unmappedKey ? '' : k, product: k === unmappedKey ? 'ยังไม่จัดกลุ่ม' : '', revenue: 0, orders: 0 };
      const c = cost[k] || { spend: 0, msgs: 0, reached: 0, engOrders: 0 };
      const revenue = Math.round(agg.revenue);
      const spend = Math.round(c.spend);
      const rep = repeatStats_(unitCust[k] || {});
      return {
        key: k,
        u: agg.u,
        product: agg.product,
        revenue,
        orders: agg.orders,
        mapped: k !== unmappedKey,
        spend,
        // ROAS = ยอดขาย POS ÷ ค่าแอดจริงจาก Meta (ไม่ใช่ ROAS ที่ Meta ตีเองจาก pixel)
        roas: c.spend > 0 ? Math.round((agg.revenue / c.spend) * 100) / 100 : null,
        // "ค่าทัก" = ค่าแอดต่อ 1 บทสนทนาที่แอดเปิดได้ (messaging_conversation_started)
        costPerMsg: c.msgs > 0 ? Math.round((c.spend / c.msgs) * 100) / 100 : null,
        msgs: Math.round(c.msgs),
        reached: Math.round(c.reached),
        // %ปิด = ออเดอร์จากแชท ÷ คนทัก (สูตรเดียวกับ KPI ด้านบน — ตัวเลขทั้งคู่มาจาก Pancake)
        closeRate: c.reached > 0 ? Math.round((c.engOrders / c.reached) * 1000) / 10 : null,
        // สัดส่วนยอดของยูนิตนี้ต่อยอดรวมทั้งหมดในช่วง
        share: grand > 0 ? Math.round((agg.revenue / grand) * 1000) / 10 : null,
        // กำไรขั้นต้นแบบหยาบ: ยอดขาย - ค่าแอด (ยังไม่มีต้นทุนสินค้าในระบบ ห้ามเรียกว่า "กำไร")
        afterAds: c.spend > 0 ? revenue - spend : null,
        customers: rep.customers,
        repeatCustomers: rep.repeat,
        repeatRate: rep.rate,
        repeatCycleDays: rep.cycleDays,
        // เป้า/ความคืบหน้า — ของ "เดือนปัจจุบัน" เสมอ ไม่ขึ้นกับช่วงวันที่ที่เลือก
        // (เป้าที่ทีมตั้งเป็นเป้าต่อเดือน เอาไปเทียบกับช่วง 7 วันแล้วอ่านผิดทันที)
        target: goal.targets[k] || 0,
        monthRevenue: Math.round(goal.monthRevenue[k] || 0),
        attain: goal.targets[k]
          ? Math.round(((goal.monthRevenue[k] || 0) / goal.targets[k]) * 1000) / 10 : null,
        // ต้องขายอีกวันละเท่าไหร่ถึงจะถึงเป้าสิ้นเดือน (ถึงเป้าแล้ว = 0)
        needPerDay: goal.targets[k]
          ? Math.max(0, Math.round((goal.targets[k] - (goal.monthRevenue[k] || 0)) / goal.daysLeft)) : null,
        weekly: Object.keys(unitWeekly[k] || {})
          .sort()
          .map((w) => ({ week: w, revenue: Math.round(unitWeekly[k][w]) })),
        pages: Object.keys(unitPages[k] || {})
          .map((nm) => ({ name: nm, revenue: Math.round(unitPages[k][nm].revenue), orders: unitPages[k][nm].orders }))
          .sort((a, b) => b.revenue - a.revenue),
      };
    })
    .sort((a, b) => (a.mapped === b.mapped) ? (b.revenue - a.revenue) : (a.mapped ? -1 : 1));
}

/* ================================================================
 * apiSales
 * ================================================================ */

export async function apiSales(params: any) {
  const r = resolveRange_(params);
  const channel = (params && params.channel) || '';
  const compare = (params && params.compare) !== 'none';

  // timing trace — ช่วงวันยาวเคยวิ่งเกิน 300s แล้วตายเงียบ (Intl ต่อ call — แก้แล้วใน lib/config)
  // เขียน sync_log เฉพาะ preset custom: หน้า "วันนี้" auto-refresh ทุก 75 วิ ถ้า log ทุกครั้งจะสแปมหมื่นแถว/วัน
  // (vercel logs live-tail ใช้ไม่ได้จริง — trace ใน DB คือทางเดียวที่เห็นจุดตายจากระยะไกล)
  const t0 = Date.now();
  const traceDb = (params && params.preset) === 'custom';
  const mark_ = (s: string) => {
    const line = `apiSales[${r.label}] ${s} | ${dbStats()} | rss=${Math.round(process.memoryUsage().rss / 1e6)}MB`;
    console.log(line, Date.now() - t0 + 'ms');
    if (traceDb) db.from('sync_log').insert({ job: 'trace-apiSales', ok: true, message: line, ms: Date.now() - t0 })
      .then(() => undefined, () => undefined);
  };
  mark_('start');

  // ⚡ ตัวโหลดอิสระ (ไม่พึ่งผล orders) ยิงตั้งแต่ตอนนี้ — เดิมรอกันเป็นทอดๆ ท้ายฟังก์ชัน
  // ช่วงยาว 35 วันเวลารวมทะลุ 100s จน 504 (semaphore ใน lib/db คุมไม่ให้ถล่มฐานเอง)
  const engP = loadEngagement_(r).then((v) => { mark_('eng'); return v; });
  const returnsP = loadReturns_(r).catch(() => null).then((v) => { mark_('returns'); return v; });
  const adCostP = loadAdCost_(r, compare).then((v) => { mark_('adCost'); return v; });

  // orders ทั้งหมดที่อาจใช้ → กรองที่ query แยก 3 ก้อนกัน payload บวม:
  //   [prevStart, start)   คอลัมน์เบา (ช่วงเปรียบเทียบ)
  //   [start, end+1s)      คอลัมน์เต็ม (ทำ Top เพจ/สินค้า — จำกัดขอบบนตามช่วงที่เลือก
  //                        ไม่งั้น custom range ในอดีตจะลาก items_json หลายเดือนมาทิ้ง)
  //   [วันนี้ 00:00, now)  คอลัมน์เบา+รายละเอียด เฉพาะเมื่อช่วงที่เลือกจบก่อนวันนี้ (การ์ด "ธุรกิจวันนี้" ใช้)
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
      ? loadOrders_(todayStartForFetch.toISOString(), null, TODAY_COLS)
      : Promise.resolve([] as Row[]),
  ]);
  const orders = prevRows.concat(curRows, todayChunk);
  mark_(`orders prev=${prevRows.length} cur=${curRows.length}`);

  /* ---- ความคืบหน้าเทียบเป้า "ของเดือนนี้" (ไม่ขึ้นกับฟิลเตอร์ช่วงวันที่) ----
   * เป้าที่ทีมตั้งเป็นเป้า "ต่อเดือน" ถ้าเอาไปเทียบกับช่วงที่ผู้ใช้เลือก (เช่น 7 วัน) จะอ่านผิดทันที
   * จึงยิงอีกคิวรีสั้นๆ เฉพาะเดือนปัจจุบัน แล้วรายงานคู่กันเสมอ — แบบเดียวกับการ์ด "วันนี้"
   */
  const monthStart = new Date(fmtDateBkk(new Date()).slice(0, 7) + '-01T00:00:00+07:00');
  const unitTargets = await getUnitTargets().catch(() => ({} as Record<string, number>));
  // ชื่อเล่นแอดมิน — ทีมขอให้แสดงชื่อเล่นเป็นหลัก (ชื่อจริงยังเก็บไว้ ส่งไปด้วยเป็น fullName)
  const nickBy = await nicknameByName().catch(() => ({} as Record<string, string>));
  const nick_ = (n: unknown) => {
    const nm = String(n || '').replace(/\s+/g, ' ').trim();
    return nm ? (nickBy[nm] || nm) : '';
  };
  // ประหยัดคิวรี 2 ทาง: (1) ยังไม่มีใครตั้งเป้า = ไม่ต้องรู้ยอดเดือนนี้เลย
  // (2) ช่วงที่เลือกครอบเดือนนี้อยู่แล้ว = ใช้ orders ที่โหลดมาแล้วได้ ไม่ต้องยิงซ้ำ
  const hasTargets = Object.keys(unitTargets).length > 0;
  const rangeCoversMonth = r.start.getTime() <= monthStart.getTime() && r.end.getTime() >= Date.now() - 60_000;
  const monthRows: Row[] = !hasTargets ? []
    : rangeCoversMonth ? orders
    : await loadOrders_(monthStart.toISOString(), null, 'inserted_at,status,total_price,items_count,page_id');
  mark_('month');

  function matchChannel(o: Row): boolean {
    return !channel || orderChannel_(o) === channel;
  }

  const cur = orders.filter((o) => inRange_(o._at, r) && !o._excluded);
  const prev = orders.filter((o) => inPrevRange_(o._at, r) && !o._excluded);
  const curCh = cur.filter(matchChannel);
  const prevCh = prev.filter(matchChannel);

  function summarize(list: Row[]) {
    // ยอดขาย = เฉพาะออเดอร์ "ยืนยันแล้ว" (ตรงนิยาม Pancake POS ที่นับ "รวมสินค้าปิดการขาย")
    // ออเดอร์ใหม่/รอยืนยัน (_needCheck = status 0,17) ยังไม่ปิดการขาย จึงไม่นับเป็นยอดขาย
    // — แต่ยังนับใน orders (จำนวนใบ) และโชว์เป็น "ต้องตรวจ" ให้เห็น
    const s: any = { revenue: 0, allRevenue: 0, orders: list.length, confirmed: 0, customers: {}, needCheck: 0, adRevenue: 0 };
    list.forEach((o) => {
      s.allRevenue += o.total_price;
      if (o.customer_id) s.customers[o.customer_id] = 1;
      if (o._needCheck) {
        s.needCheck++;
      } else {
        s.confirmed++;
        s.revenue += o.total_price;               // ยอดขาย = เฉพาะยืนยันแล้ว
        if (o.ad_id) s.adRevenue += o.total_price;
      }
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

  // ยอดขายรายชั่วโมง (รวมทุกวันในช่วง bucket ตามชั่วโมงของวัน) — เฉพาะยืนยันแล้ว
  function hourlyBuckets(list: Row[]): number[] {
    const h: number[] = [];
    for (let i = 0; i < 24; i++) h.push(0);
    list.forEach((o) => {
      if (o._needCheck) return;   // ยอดขาย = เฉพาะออเดอร์ยืนยันแล้ว (ตรง Pancake)
      h[bkkHour_(o._at)] += o.total_price;
    });
    return h.map((v) => Math.round(v));
  }

  // สถิติแชท (ตัวหาร closeRate) — chat_hourly ~1,200 แถว/วัน หั่นตามวันกัน OFFSET ลึก
  const todayStr = fmtDateBkk(new Date());
  const chatSince = fmtDateBkk(r.start) < todayStr ? fmtDateBkk(r.start) : todayStr;
  const chatRows = await fetchAllDateSliced<Row>((f, t) =>
    db
      .from('chat_hourly')
      .select('date,platform,new_inbox_count,new_customer_count')
      .gte('date', f).lte('date', t),
    chatSince, todayStr
  );
  mark_('chat_hourly ' + chatRows.length);
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
  const eng = await engP;
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
    if (o._needCheck) { todayNeedCheck++; return; }   // ยอดขาย = เฉพาะยืนยันแล้ว
    const ch = orderChannel_(o);
    if (ch === 'line') todayLine += o.total_price;
    else if (ch === 'facebook') todayFb += o.total_price;
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
  const pagePlatform: Record<string, string> = {};
  {
    const pageRows = await fetchAll<Row>(() => db.from('pages').select('page_id,name,platform'), 'page_id');
    pageRows.forEach((p) => {
      pageNames[String(p.page_id)] = String(p.name || '');
      pagePlatform[String(p.page_id)] = String(p.platform || '');
    });
  }
  mark_('pages');
  // ---- รายออเดอร์ "ต้องตรวจ" (สถานะ ใหม่/รอยืนยัน) ให้หน้าเว็บกดดูได้ว่าเป็นใบไหนบ้าง ----
  // เดิมส่งมาแค่ตัวเลข กดแล้วไม่มีอะไรให้ดู แอดมินต้องไปไล่หาเองใน Pancake
  // จำกัด 200 แถวล่าสุด (ใหม่→เก่า) กัน payload บวมตอนเลือกช่วงยาว
  const NEEDCHK_LIMIT = 200;
  function needCheckList_(list: Row[]) {
    return list
      .filter((o) => o._needCheck)
      .sort((a, b) => b._at.getTime() - a._at.getTime())
      .slice(0, NEEDCHK_LIMIT)
      .map((o) => ({
        id: String(o.id || ''),
        // display_id = เลขที่ออเดอร์ที่แอดมินเห็นในจอ Pancake (บางใบยังไม่มี → ใช้ id แทน)
        code: String(o.display_id || '') || String(o.id || ''),
        at: bkkDT_(o._at),
        customer: String(o.customer_name || ''),
        page: pageNames[String(o.page_id || '')] || String(o.account_name || ''),
        total: Math.round(o.total_price),
        items: toNum_(o.items_count),
        status: o.status,                                   // 0 = ใหม่ | 17 = รอยืนยัน
        statusName: String(o.status_name || '') || ORDER_STATUS_TH[o.status] || String(o.status),
        // "คนขาย" ของ Pancake = seller ; ออเดอร์ใหม่บางใบมีแค่คนสร้าง (แอดมินที่กดสร้างจากแชท)
        seller: nick_(o.seller_name || o.creator_name),
        sellerFull: String(o.seller_name || o.creator_name || ''),
      }));
  }

  // แผนที่ เพจ→ยูนิต (U/สินค้า) จาก U Map — ใช้จัดกลุ่มยอดขายตามยูนิตแบบทีมแอด
  // เพจที่ยังไม่จับคู่ = กลุ่ม "ยังไม่จัดกลุ่ม" (บอสไปจับใน U Map ได้)
  let pageUnit: Record<string, { u: string; product: string }> = {};
  try { pageUnit = await getPageUnitMap(); } catch { pageUnit = {}; }
  const UNMAPPED = '__none__';
  // ค่าแอด/คนทัก รายยูนิต — โหลดครั้งเดียว ใช้ร่วมกันทั้ง 3 แท็บช่องทาง
  const unitCost = await loadUnitCost_(r, pageUnit, pagePlatform, UNMAPPED);
  mark_('unitCost');

  // ยอดเดือนนี้ต่อยูนิต (ไว้เทียบเป้า) — นับเฉพาะออเดอร์ที่ยืนยันแล้ว เหมือนยอดขายหลัก
  const monthByUnit: Record<string, number> = {};
  monthRows.forEach((o) => {
    if (o._excluded || o._needCheck) return;
    const um = pageUnit[String(o.page_id || '')];
    const key = um ? um.u : UNMAPPED;
    monthByUnit[key] = (monthByUnit[key] || 0) + o.total_price;
  });
  // เหลืออีกกี่วันในเดือน (รวมวันนี้) — ใช้คิด "ต้องขายอีกวันละเท่าไหร่ถึงจะถึงเป้า"
  const daysLeftInMonth = (() => {
    const today = fmtDateBkk(new Date());
    const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();   // วันสุดท้ายของเดือนนี้
    return Math.max(1, lastDay - Number(today.slice(8, 10)) + 1);
  })();

  function topAgg(list: Row[], chanKey: 'all' | 'facebook' | 'line' = 'all') {
    const pages: Record<string, { revenue: number; orders: number }> = {};
    const products: Record<string, { qty: number; value: number; orders: number }> = {};
    // cross-tab สำหรับ drilldown: เพจ→สินค้า และ สินค้า→เพจ (นับยอดขายรายคู่)
    const pageProd: Record<string, Record<string, { qty: number; value: number; orders: number }>> = {};
    const prodPage: Record<string, Record<string, { qty: number; value: number; orders: number }>> = {};
    // จัดกลุ่มตามยูนิต: unitAgg = ยอดรวมต่อยูนิต, unitPages = เพจในยูนิต (สำหรับเจาะ U→เพจ)
    const unitAgg: Record<string, { u: string; product: string; revenue: number; orders: number }> = {};
    const unitPages: Record<string, Record<string, { revenue: number; orders: number }>> = {};
    // ยอดรายสัปดาห์ต่อยูนิต (key = วันจันทร์ของสัปดาห์) — บรีฟขอ "ยอดขายรายสัปดาห์ของเดือน"
    const unitWeekly: Record<string, Record<string, number>> = {};
    // เวลาซื้อของลูกค้าแต่ละคนในยูนิต — ใช้คิด %ซื้อซ้ำ + ระยะห่างรอบซื้อ
    const unitCust: Record<string, Record<string, number[]>> = {};
    list.forEach((o) => {
      if (o._needCheck) return;   // Top เพจ/สินค้า นับเฉพาะยืนยันแล้ว (ตรงกับยอดขายหลัก)
      const pg = pageNames[String(o.page_id || '')] || String(o.account_name || '') || 'ไม่ระบุเพจ';
      if (!pages[pg]) pages[pg] = { revenue: 0, orders: 0 };
      pages[pg].revenue += o.total_price;
      pages[pg].orders++;
      // รวมตามยูนิต
      const um = pageUnit[String(o.page_id || '')];
      const ukey = um ? um.u : UNMAPPED;
      if (!unitAgg[ukey]) {
        unitAgg[ukey] = { u: um ? um.u : '', product: um ? um.product : 'ยังไม่จัดกลุ่ม', revenue: 0, orders: 0 };
      }
      unitAgg[ukey].revenue += o.total_price;
      unitAgg[ukey].orders++;
      if (!unitPages[ukey]) unitPages[ukey] = {};
      if (!unitPages[ukey][pg]) unitPages[ukey][pg] = { revenue: 0, orders: 0 };
      unitPages[ukey][pg].revenue += o.total_price;
      unitPages[ukey][pg].orders++;
      const wk = bkkWeekStart_(o._at);
      if (!unitWeekly[ukey]) unitWeekly[ukey] = {};
      unitWeekly[ukey][wk] = (unitWeekly[ukey][wk] || 0) + o.total_price;
      const cid = String(o.customer_id || '');
      if (cid) {
        if (!unitCust[ukey]) unitCust[ukey] = {};
        (unitCust[ukey][cid] = unitCust[ukey][cid] || []).push(o._at.getTime());
      }
      (o._items || []).forEach((it: any) => {
        const nm = String((it && it.name) || '').trim();
        if (!nm) return;
        const qty = toNum_(it.qty) || 1;
        const val = money_(it.price) * qty; // มูลค่าตามราคาขาย (ประมาณ — ไม่หักส่วนลดท้ายบิล)
        if (!products[nm]) products[nm] = { qty: 0, value: 0, orders: 0 };
        products[nm].qty += qty;
        products[nm].value += val;
        products[nm].orders++;
        // เพจ→สินค้า
        if (!pageProd[pg]) pageProd[pg] = {};
        if (!pageProd[pg][nm]) pageProd[pg][nm] = { qty: 0, value: 0, orders: 0 };
        pageProd[pg][nm].qty += qty; pageProd[pg][nm].value += val; pageProd[pg][nm].orders++;
        // สินค้า→เพจ
        if (!prodPage[nm]) prodPage[nm] = {};
        if (!prodPage[nm][pg]) prodPage[nm][pg] = { qty: 0, value: 0, orders: 0 };
        prodPage[nm][pg].qty += qty; prodPage[nm][pg].value += val; prodPage[nm][pg].orders++;
      });
    });
    // เพจ→สินค้า: เรียงตามมูลค่า top 25 ต่อเพจ (แต่ละเพจมักมีสินค้าไม่กี่ตัว payload เล็ก)
    const pageProducts: Record<string, any[]> = {};
    Object.keys(pageProd).forEach((pg) => {
      pageProducts[pg] = Object.keys(pageProd[pg])
        .map((nm) => ({ name: nm, qty: pageProd[pg][nm].qty, value: Math.round(pageProd[pg][nm].value), orders: pageProd[pg][nm].orders }))
        .sort((a, b) => (b.value - a.value) || (b.qty - a.qty))
        .slice(0, 25);
    });
    // สินค้า→เพจ: เรียงตามมูลค่า top 25 ต่อสินค้า
    const productPages: Record<string, any[]> = {};
    Object.keys(prodPage).forEach((nm) => {
      productPages[nm] = Object.keys(prodPage[nm])
        .map((pg) => ({ page: pg, qty: prodPage[nm][pg].qty, value: Math.round(prodPage[nm][pg].value), orders: prodPage[nm][pg].orders }))
        .sort((a, b) => (b.value - a.value) || (b.qty - a.qty))
        .slice(0, 25);
    });
    return {
      // ทุกเพจที่มียอด (ไม่จำกัด 10) — ใช้ปุ่ม "ดูทุกเพจ" ; เพจไม่มียอดไม่โผล่อยู่แล้ว
      pagesFull: Object.keys(pages)
        .map((nm) => ({ name: nm, revenue: Math.round(pages[nm].revenue), orders: pages[nm].orders }))
        .sort((a, b) => b.revenue - a.revenue),
      pages: Object.keys(pages)
        .map((nm) => ({ name: nm, revenue: Math.round(pages[nm].revenue), orders: pages[nm].orders }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10),
      products: Object.keys(products)
        .map((nm) => ({ name: nm, qty: products[nm].qty, value: Math.round(products[nm].value), orders: products[nm].orders }))
        .sort((a, b) => (b.value - a.value) || (b.qty - a.qty))
        .slice(0, 10),
      // ยอดขายจัดกลุ่มตามยูนิต (U/สินค้า) — เจาะ U→เพจ→สินค้า ได้ (กลุ่ม "ยังไม่จัดกลุ่ม" ต่อท้ายเสมอ)
      units: unitRows_(unitAgg, unitPages, unitWeekly, unitCust, unitCost[chanKey] || {}, UNMAPPED,
        { targets: unitTargets, monthRevenue: monthByUnit, daysLeft: daysLeftInMonth }),
      pageProducts,   // เพจ→รายการสินค้าที่ขายได้
      productPages,   // สินค้า→เพจที่ขายได้
    };
  }

  const top = {
    all: topAgg(cur, 'all'),
    facebook: topAgg(cur.filter((o) => orderChannel_(o) === 'facebook'), 'facebook'),
    line: topAgg(cur.filter((o) => orderChannel_(o) === 'line'), 'line'),
  };

  /* ---- ออเดอร์ที่ "ไม่เป็นยอด": ยกเลิก / ตีกลับ / ลบ ----
   * บรีฟขอภาพรวมสินค้าตีกลับ (รวม รายคน รายเดือน) แต่ Pancake /orders_returned คืน 0 ใบเสมอ
   * — ทีมไม่ได้เดินสถานะตีกลับในระบบจริง ตัวที่ "มีข้อมูลจริง" คือสถานะยกเลิก/ตีกลับบนใบออเดอร์
   * จึงรายงานจากตรงนั้นแทน และเขียนกำกับบนหน้าเว็บว่านับจากสถานะใบออเดอร์ ไม่ใช่ใบคืนสินค้า
   */
  const cancels = (() => {
    const list = orders.filter((o) => inRange_(o._at, r) && o._excluded && matchChannel(o));
    const byStatus: Record<string, { orders: number; value: number }> = {};
    const byPerson: Record<string, { orders: number; value: number }> = {};
    const byMonth: Record<string, { orders: number; value: number }> = {};
    let value = 0;
    list.forEach((o) => {
      value += o.total_price;
      const st = String(o.status_name || '') || ORDER_STATUS_TH[o.status] || String(o.status);
      const person = nick_(o.seller_name || o.creator_name) || 'ไม่ระบุคนขาย';
      const month = fmtDateBkk(o._at).slice(0, 7);
      for (const [bucket, key] of [[byStatus, st], [byPerson, person], [byMonth, month]] as const) {
        const b = bucket as Record<string, { orders: number; value: number }>;
        if (!b[key]) b[key] = { orders: 0, value: 0 };
        b[key].orders++; b[key].value += o.total_price;
      }
    });
    const toList = (b: Record<string, { orders: number; value: number }>) =>
      Object.keys(b).map((k) => ({ name: k, orders: b[k].orders, value: Math.round(b[k].value) }));
    const okOrders = curCh.length;
    return {
      orders: list.length,
      value: Math.round(value),
      // สัดส่วนต่อ "ใบทั้งหมดในช่วง" (ใบที่ยังอยู่ + ใบที่ยกเลิก) — ไม่ใช่ต่อยอดขาย
      rate: (okOrders + list.length) ? Math.round((list.length / (okOrders + list.length)) * 1000) / 10 : null,
      byStatus: toList(byStatus).sort((a, b) => b.orders - a.orders),
      byPerson: toList(byPerson).sort((a, b) => b.orders - a.orders).slice(0, 50),
      byMonth: toList(byMonth).sort((a, b) => (a.name < b.name ? -1 : 1)),
    };
  })();

  /* ---- สินค้าตีกลับจริง (ตาราง returns — มาจากชีทรายเดือนของทีม) ----
   * คนละเรื่องกับ "ยกเลิก" ด้านบน: ยกเลิก = ปิดใบก่อนส่ง / ตีกลับ = ส่งไปแล้วของกลับมา
   * นับตาม "วันที่รับตีกลับ" ไม่ใช่วันที่สั่ง — ของที่สั่งเดือนก่อนแล้วกลับมาเดือนนี้ต้องอยู่เดือนนี้
   */
  const returns = await returnsP;

  /* ---- แจ้งเตือน "ยูนิตขาดทุน" — งาน sync คำนวณไว้แล้ว หน้าเว็บแค่อ่านผล ----
   * ตัวเลขตัดสินจาก "วันที่จบแล้ว" จึงเปลี่ยนวันละครั้ง ไม่ต้องคำนวณใหม่ทุกครั้งที่เปิดหน้า
   * และไม่ขึ้นกับช่วงวันที่ที่ผู้ใช้เลือก — เป็นการเตือนสถานะปัจจุบันเสมอ
   */
  const unitAlerts = await (async () => {
    try {
      const { data } = await db.from('sync_state').select('value').eq('key', 'unit_loss_alerts').maybeSingle();
      if (!data || !data.value) return null;
      const j = JSON.parse(String(data.value));
      return { throughDate: j.throughDate || '', computedAt: j.computedAt || '', alerts: j.alerts || [] };
    } catch { return null; }
  })();

  // ---- ลูกค้าเก่า (เคยซื้อภายใน 95 วันก่อนช่วงที่เลือก) — นับฝั่ง Postgres ผ่าน RPC ----
  // RPC ยังไม่ถูกสร้าง (migration ไม่ได้รัน) → คืน null ให้หน้าเว็บแสดง "—" ไม่ใช่เลขปลอม
  let returning: { total: number; returning: number; pct: number | null } | null = null;
  {
    mark_('before-rpc');
    const lookback = new Date(r.start.getTime() - 95 * 86400000);
    // abort 30s — RPC สแกน orders ย้อน 95 วัน ช่วงยาวอาจอืด และ supabase-js ไม่มี timeout เอง
    // ถ้าแขวนจะลากทั้ง apiSales ค้างเกิน maxDuration (%ซื้อซ้ำเป็นการ์ดรอง เสียได้ ไม่คุ้มพังทั้งหน้า)
    const { data: rc, error: rcErr } = await db.rpc('sales_returning_customers', {
      p_start: r.start.toISOString(),
      p_end: r.end.toISOString(),
      p_lookback: lookback.toISOString(),
      p_channel: channel,
      p_excluded: EXCLUDED_STATUSES,
    }).abortSignal(AbortSignal.timeout(30_000));
    mark_('rpc' + (rcErr ? '-err:' + String(rcErr.message || '').slice(0, 40) : ''));
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
      // drill = เปิด modal รายออเดอร์ในหน้าเดิม (เดิมใส่ view:'sales' → กดแล้วสลับมาหน้าเดียวกัน = ไม่เกิดอะไร)
      drill: 'needcheck',
    });
  }
  const alertCutoff = convCutoff_();
  // conversations เกิน 1000 แถวได้ → กรอง waiting + updated_at >= cutoff ที่ query แล้วนับ
  // ดึง type มาด้วยเพื่อแยก อินบ็อกซ์ / คอมเมนต์ (เดิมนับรวมกันหมด บอสอ่านแล้วแยกไม่ออกว่าค้างตรงไหน)
  const cutoffIso = new Date(alertCutoff).toISOString();
  const waitingRows = await fetchAll<Row>(() =>
    db.from('conversations').select('id,type').eq('waiting', true).gte('updated_at', cutoffIso)
  );
  let waitingInbox = 0;
  let waitingComment = 0;
  waitingRows.forEach((c) => {
    // type ที่เจอจริง: INBOX / COMMENT / RATING — RATING มีแค่หลักหน่วย รวมไปกับอินบ็อกซ์
    // (เป็นข้อความในกล่องแชทเหมือนกัน ไม่คุ้มที่จะตั้งกลุ่มที่ 3 ให้หน้าจอรก)
    if (String(c.type || '').toUpperCase() === 'COMMENT') waitingComment++;
    else waitingInbox++;
  });
  const waitingConvs = waitingRows.length;
  const waitingSplit = '💬 อินบ็อกซ์ ' + waitingInbox + ' • 💭 คอมเมนต์ ' + waitingComment;
  if (waitingConvs >= 10) {
    alerts.push({
      icon: '💬',
      title: '⏰ แชทค้างรอตอบ ' + waitingConvs,
      reason: waitingSplit + ' — ลูกค้ารอการตอบกลับ (24 ชม.ล่าสุด)',
      level: 'red',
      view: 'dashboard',
    });
  } else if (waitingConvs > 0) {
    alerts.push({
      icon: '💬',
      title: '⏰ แชทค้างรอตอบ ' + waitingConvs,
      reason: waitingSplit + ' — รอการตอบกลับ (24 ชม.ล่าสุด)',
      level: 'yellow',
      view: 'dashboard',
    });
  }
  // ---- ค่าแอดจริง (ad_daily) + ROAS ของช่วงที่เลือก ----
  // spend ใน ad_daily เป็นบาทจริง (ทศนิยม) ไม่ใช่สตางค์ — ห้ามหาร MONEY_SCALE
  // ตารางอาจยังไม่ถูกสร้าง (ยังไม่รัน migration) → คืน null ให้หน้าเว็บโชว์ "-" ไม่ใช่ 0
  const adCost = await adCostP;

  // ---- ยอดขายแยกช่องทาง (ไม่สน channel filter — ใช้ทำ ROAS หลายแบบ) ----
  // เพจ = Facebook, ไลน์ = LINE — คิดจาก cur (ทุกช่องทางในช่วง) ตัดออเดอร์ยกเลิกแล้ว
  let fbRev = 0, lineRev = 0, adPagesRev = 0;
  const adPageSet = new Set((adCost && adCost.adPageIds) || []);
  cur.forEach((o) => {
    if (o._needCheck) return;   // ยอดขาย = เฉพาะยืนยันแล้ว (ตรง Pancake)
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

  mark_('done');
  return {
    rangeLabel: r.label,
    // ป้ายหน้าต่างเปรียบเทียบ (null เมื่อ "ไม่เปรียบเทียบ") — หน้าเว็บเอาไปใส่ legend/ทูลทิปกราฟ
    prevLabel: compare ? r.prevLabel : null,
    prevWindow: compare ? r.prevWindow : null,
    // รายออเดอร์ที่ต้องตรวจของช่วงที่เลือก (ตามช่องทางที่กรอง) — modal ในการ์ด "คำสั่งซื้อ"
    needCheckOrders: needCheckList_(curCh),
    // แชทค้างรอตอบ แยกตามชนิด (RATING รวมอยู่ใน inbox)
    waiting: { total: waitingConvs, inbox: waitingInbox, comment: waitingComment },
    // ยกเลิก (ปิดใบก่อนส่ง) ของช่วงที่เลือก — รวม + รายสถานะ + รายคน + รายเดือน
    cancels: cancels,
    // สินค้าตีกลับจริง (ส่งไปแล้วของกลับมา) จากชีทของทีม — null = ยังไม่ได้รัน migration returns
    returns: returns,
    // ยูนิตที่ขาดทุนติดต่อกัน (คำนวณโดยงาน sync รายชั่วโมง) — ไม่ขึ้นกับฟิลเตอร์ช่วงวันที่
    unitAlerts: unitAlerts,
    kpis: {
      revenue: Math.round(sCur.revenue),
      orders: sCur.orders,
      // ออเดอร์ที่แอดมินยืนยันแล้ว — Pancake นับตัวนี้เป็น "สร้างคำสั่งซื้อ"
      confirmedOrders: sCur.confirmed,
      customers: sCur.customers,
      // เฉลี่ย/ออเดอร์ = ยอดขายยืนยันแล้ว ÷ จำนวนออเดอร์ยืนยันแล้ว (ให้สอดคล้องกับยอดขาย)
      avgOrder: sCur.confirmed ? Math.round(sCur.revenue / sCur.confirmed) : 0,
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
      // รายออเดอร์ที่ต้องตรวจของ "วันนี้" (ทุกช่องทาง) — modal ในการ์ดธุรกิจวันนี้ + ปุ่มในแจ้งเตือน
      needCheckOrders: needCheckList_(todayOrders),
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
