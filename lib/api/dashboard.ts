// lib/api/dashboard.ts — port ของ apiDashboard จาก WebApi.gs
// อ่านจาก Supabase (server-side) แทนการอ่านชีต — output ตรง CONTRACT.md ทุก key
import { db, fetchAll, fetchAllDateSliced } from '@/lib/db';
import { fmtDateBkk, fmtDateTimeBkk, daysAgo, parsePancakeTime, num, TZ } from '@/lib/config';

/* ---------------- utilities (port จาก WebApi.gs) ---------------- */

/** ค่าจาก DB อาจเป็น Date/number/string/ISO — แปลงเป็น Date เสมอ */
function toDate_(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  return parsePancakeTime(String(v));
}

function toDateStr_(v: unknown): string {
  const d = toDate_(v);
  return d ? fmtDateBkk(d) : '';
}

function toBool_(v: unknown): boolean {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

function toNum_(v: unknown): number {
  return num(v);
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

/** cutoff 24 ชม. สำหรับข้อมูลบทสนทนา (ตารางเก็บถึง 14 วัน แต่หน้าเว็บสัญญาว่าโชว์ 24 ชม.) */
function convCutoff_(): number {
  return Date.now() - 24 * 3600 * 1000;
}

function convInWindow_(c: any, cutoff: number): boolean {
  const upd = toDate_(c.updated_at);
  return !!upd && upd.getTime() >= cutoff;
}

/** วันในสัปดาห์ (0=อาทิตย์ .. 6=เสาร์) ตามเวลาไทย */
const WD_MAP: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function dayOfWeekBkk_(d: Date): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(d);
  return WD_MAP[wd] ?? 0;
}

/* ---------------- ช่วงเวลาที่เลือก (preset) ---------------- */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface DayRange {
  startStr: string;  // 'YYYY-MM-DD' เวลาไทย
  endStr: string;
  days: number;
  label: string;
}

/** 'YYYY-MM-DD' (เวลาไทย) → Date ของเที่ยงคืนไทยวันนั้น */
function dayStart_(ds: string): Date {
  return new Date(ds + 'T00:00:00+07:00');
}

/** จำนวนวันในช่วง (รวมวันแรกและวันสุดท้าย) */
function dayCount_(startStr: string, endStr: string): number {
  const n = Math.round((dayStart_(endStr).getTime() - dayStart_(startStr).getTime()) / 86400000) + 1;
  return isNaN(n) ? 1 : Math.max(1, n);
}

/** ลิสต์ Date เที่ยงคืนไทย n วันย้อนหลังจาก endStr (เรียงเก่า → ใหม่) */
function dayList_(endStr: string, n: number): Date[] {
  const end = dayStart_(endStr).getTime();
  const out: Date[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(end - i * 86400000));
  return out;
}

/**
 * แปลง params ช่วงเวลา → ช่วง "วัน" ที่ใช้กรอง chat_hourly / chat_engagement_daily
 * preset: today | yesterday | 3d | 7d | 30d | month | custom (from/to = 'yyyy-MM-dd')
 * ⚠️ ต้องมีครบทุก key ใน RANGE_PRESETS (lib/ui/helpers.ts) — key ที่ไม่มี case จะตกไป default = วันนี้ เงียบๆ
 * (กติกาเดียวกับ resolveRange_ ของ lib/api/adminperf.ts แต่หน้านี้อ่านตารางที่คีย์เป็น "วัน" ไม่ใช่
 *  timestamp จึงคืนเป็นสตริงวันที่ และไม่ต้องมี prevStart/prevEnd — Dashboard ไม่เทียบช่วงก่อนหน้า)
 */
function resolveRange_(params: any): DayRange {
  const p = params || {};
  const preset = p.preset || 'today';
  const todayStr = fmtDateBkk(new Date());
  let startStr = todayStr, endStr = todayStr, label = 'วันนี้';
  switch (preset) {
    case 'yesterday':
      // เมื่อวาน = ทั้งวัน (วันมันจบไปแล้ว — ไม่ตัดที่ "ตอนนี้" เหมือน preset อื่น)
      startStr = endStr = fmtDateBkk(daysAgo(1));
      label = 'เมื่อวานนี้';
      break;
    case '3d':
      startStr = fmtDateBkk(daysAgo(2)); // 3 วันล่าสุด "รวมวันนี้" — กติกาเดียวกับ 7d/30d
      label = '3 วันล่าสุด';
      break;
    case '7d':
      startStr = fmtDateBkk(daysAgo(6));
      label = '7 วันล่าสุด';
      break;
    case '30d':
      startStr = fmtDateBkk(daysAgo(29));
      label = '30 วันล่าสุด';
      break;
    case 'month':
      startStr = todayStr.slice(0, 8) + '01';
      label = 'เดือนนี้';
      break;
    case 'custom': {
      // ค่าจาก date picker ของผู้ใช้ — ตรวจรูปแบบก่อนเสมอ (ค่าเพี้ยนทำให้ label/ช่วงพัง)
      const f = String(p.from || '');
      const t = String(p.to || '');
      startStr = DATE_RE.test(f) ? f : todayStr;
      endStr = DATE_RE.test(t) ? t : todayStr;
      if (endStr > todayStr) endStr = todayStr;   // ไม่มีข้อมูลอนาคต
      if (startStr > endStr) startStr = endStr;   // ผู้ใช้เลือกสลับกัน — กันช่วงว่าง
      label = startStr === endStr ? startStr : startStr + ' ถึง ' + endStr;
      break;
    }
    default: // today
      break;
  }
  return { startStr, endStr, days: dayCount_(startStr, endStr), label };
}

/* ================================================================
 * 1) DASHBOARD — ภาพรวมแชทวันนี้
 * ================================================================ */

/**
 * สถิติลูกค้าในช่วงที่เลือก จาก chat_engagement_daily (ต้นทาง: statistics/customer_engagements)
 * คืน null เมื่อยังไม่มีตาราง — หน้าเว็บต้องโชว์ "—" ไม่ใช่ 0
 * ⚠️ ตัวเลขเป็น "รายวันต่อเพจ" — ช่วงหลายวันคือผลรวมรายวัน (คนเดิมที่ทักคนละวันถูกนับซ้ำ)
 *    ไม่มีทางรู้ unique ข้ามวันจาก endpoint นี้ — หน้าเว็บติดป้ายบอกไว้แทน
 */
async function loadEngagementRange_(
  range: DayRange, channel: string, commentMode: boolean,
): Promise<{ total: number; reached: number; newInbox: number; comment: number; orders: number } | null> {
  try {
    const rows = await fetchAll<any>(() =>
      db.from('chat_engagement_daily')
        .select('key,platform,total,comment,new_inbox,order_count')
        .gte('date', range.startStr)
        .lte('date', range.endStr),
      'key'
    );
    const out = { total: 0, reached: 0, newInbox: 0, comment: 0, orders: 0 };
    rows.forEach((r: any) => {
      // มุมคอมเมนต์ไม่มีตัวเลขแยกจาก endpoint นี้ → รวมทุก platform เหมือน commentMode ที่อื่น
      if (!commentMode && channel && platformChannel_(r.platform) !== channel) return;
      const ni = toNum_(r.new_inbox);
      const cm = toNum_(r.comment);
      out.total += toNum_(r.total);
      out.newInbox += ni;
      out.comment += cm;
      out.reached += ni + cm;   // คนทัก = อินบ็อกซ์ใหม่ + คอมเมนต์
      out.orders += toNum_(r.order_count);
    });
    return out;
  } catch {
    return null;
  }
}

/**
 * กราฟแท่งรายวันของหน้านี้ (svgWeekBars) วางแท่ง+ตัวเลขทับกันถ้าวันเยอะเกิน ~14
 * และช่วงสั้น (วันนี้/เมื่อวาน) ก็ยังอยากเห็นเทรนด์สัปดาห์เหมือนเดิม → บีบอยู่ระหว่าง 7-14 วัน
 * ช่วงที่ยาวกว่านั้น KPI ยังรวมทั้งช่วง แต่กราฟโชว์แค่ท้ายช่วง (weekNote บอกผู้ใช้ตรงๆ)
 */
/* ---------------- บทสนทนา 24 ชม. แบบนับกลุ่ม ----------------
 * groups เรียงตาม id แรกของกลุ่ม · tags เรียงตามจุดที่แท็กดิบโผล่ครั้งแรก (id, ลำดับในช่อง) — ดู dash_conv_24h ในไฟล์ migration
 * waiting/ai เป็น boolean แล้ว (toBool_ / last_sent_by === 'ai' แบบลูปเดิม) */
interface ConvGroup { page_name: unknown; platform: unknown; type: unknown; waiting: boolean; ai: boolean; n: number }
interface ConvTag { tag: unknown; platform: unknown; type: unknown; n: number }
interface ConvAgg { groups: ConvGroup[]; tags: ConvTag[] }

/** แถวดิบ (เรียง id แล้ว กรองช่วงเวลาแล้ว) → กลุ่มแบบเดียวกับที่ฐานคืน — ทางถอยเมื่อยังไม่ได้รัน migration */
function convAggFromRows_(rows: any[]): ConvAgg {
  const groups: ConvGroup[] = [];
  const gIdx: Record<string, number> = {};
  const tags: ConvTag[] = [];
  const tIdx: Record<string, number> = {};
  const k_ = (v: unknown) => (v === null || v === undefined ? '\u0000' : '\u0001' + String(v));
  rows.forEach((c: any) => {
    const waiting = toBool_(c.waiting);
    const ai = String(c.last_sent_by) === 'ai';
    const gk = [k_(c.page_name), k_(c.platform), k_(c.type), waiting ? 1 : 0, ai ? 1 : 0].join('\u0002');
    if (gIdx[gk] === undefined) { gIdx[gk] = groups.length; groups.push({ page_name: c.page_name, platform: c.platform, type: c.type, waiting, ai, n: 0 }); }
    groups[gIdx[gk]].n++;
    String(c.tags || '').split(',').forEach((t: string) => {
      const tk = [k_(t), k_(c.platform), k_(c.type)].join('\u0002');
      if (tIdx[tk] === undefined) { tIdx[tk] = tags.length; tags.push({ tag: t, platform: c.platform, type: c.type, n: 0 }); }
      tags[tIdx[tk]].n++;
    });
  });
  return { groups, tags };
}

/** ฟังก์ชันรวมยอดในฐาน (ถ้ารัน migration แล้ว) — null = ยังไม่มี/พลาด ให้ผู้เรียกถอยไปอ่านแถวดิบ */
async function convAggRpc_(cutoffIso: string): Promise<ConvAgg | null> {
  try {
    const { data, error } = await db.rpc('dash_conv_24h', { p_cutoff: cutoffIso }).abortSignal(AbortSignal.timeout(20_000));
    if (error || !data || !Array.isArray((data as any).groups) || !Array.isArray((data as any).tags)) return null;
    const d = data as any;
    return {
      groups: d.groups.map((g: any) => ({ page_name: g.page_name, platform: g.platform, type: g.type, waiting: g.waiting === true, ai: g.ai === true, n: Number(g.n) || 0 })),
      tags: d.tags.map((t: any) => ({ tag: t.tag, platform: t.platform, type: t.type, n: Number(t.n) || 0 })),
    };
  } catch { return null; }
}

/** แชทรายวันต่อ platform จากฐาน (ถ้ารัน migration แล้ว) — ชื่อคอลัมน์เหมือนแถว chat_hourly · null = ถอยไปอ่านแถวดิบ */
async function chatDailyRpc_(fromStr: string, toStr: string): Promise<any[] | null> {
  try {
    const { data, error } = await db.rpc('dash_chat_daily', { p_from: fromStr, p_to: toStr }).abortSignal(AbortSignal.timeout(20_000));
    if (error || !Array.isArray(data)) return null;
    // ≤ 14 วัน × ไม่กี่ platform — เกิน 1,000 แถว (เพดาน PostgREST) แปลว่าข้อมูลผิดรูป ถอยไปทางเดิมดีกว่าได้ครึ่งเดียว
    if (data.length >= 1000) return null;
    return (data as any[]).map((r) => ({
      date: r.d, platform: r.platform,
      customer_inbox_count: r.customer_inbox_count, customer_comment_count: r.customer_comment_count,
      page_inbox_count: r.page_inbox_count, page_comment_count: r.page_comment_count,
      new_inbox_count: r.new_inbox_count, new_customer_count: r.new_customer_count,
      uniq_phone_number_count: r.uniq_phone_number_count,
    }));
  } catch { return null; }
}

const CHART_MIN_DAYS = 7;
const CHART_MAX_DAYS = 14;

export async function apiDashboard(
  params?: { channel?: string; preset?: string; from?: string; to?: string },
): Promise<any> {
  const channel = (params && params.channel) || '';
  // โหมดพิเศษ: channel='comment' = มุมมองเฉพาะคอมเมนต์ (ทุก platform, นับคู่ *_comment_count)
  const commentMode = channel === 'comment';
  const todayStr = fmtDateBkk(new Date());
  const range = resolveRange_(params);

  // วันที่ของกราฟ (ยึดวันท้ายช่วงแล้วถอยหลัง) — อาจย้อนก่อนช่วงที่เลือกเมื่อช่วงสั้นกว่า 7 วัน
  const chartDays = Math.min(Math.max(range.days, CHART_MIN_DAYS), CHART_MAX_DAYS);
  const chartDates = dayList_(range.endStr, chartDays);
  const chartStartStr = fmtDateBkk(chartDates[0]);
  // ดึงเท่าที่ใช้จริง = ช่วงที่เลือก ∪ ช่วงกราฟ (ลดจำนวนแถว) — วนจนครบ กัน 1000-row cap
  const fetchStartStr = chartStartStr < range.startStr ? chartStartStr : range.startStr;
  // 3 แหล่งข้างล่าง (แชทรายชั่วโมง / บทสนทนา 24 ชม. / สถิติลูกค้า) ไม่ขึ้นกับกันเลย — ยิงพร้อมกันตั้งแต่ต้น
  // เดิมรอทีละตัว 3 ต่อ · ลำดับแถวของแต่ละก้อนเหมือนเดิม (order ของแต่ละคิวรีไม่เปลี่ยน)
  const cutoff = convCutoff_();
  const cutoffIso = new Date(cutoff).toISOString();
  // บทสนทนาแยก 2 คิวรีขนาน (เรียง id เหมือนเดิมทั้งคู่):
  //   ทุกแถว = คอลัมน์ที่ใช้นับ (donut/ประเภท/เพจ/แท็ก) — ~11k แถว/24 ชม. เดิมลากข้อความล่าสุด+ชื่อลูกค้ามาด้วยทุกแถว
  //   เฉพาะแถวรอตอบ (~5%) = คอลัมน์ที่ใช้ทำรายการ "ต้องตอบ" — .eq('waiting', true) ตรงกับ toBool_ เป๊ะ (คอลัมน์ boolean)
  // ⚡ ถ้ามีฟังก์ชัน dash_conv_24h (db/migrations/2026-09-28-dashboard-aggregates.sql) ให้ฐานนับกลุ่มมาให้
  //    ไม่มี/พลาด = ถอยไปอ่านแถวดิบแบบเดิม (convAggFromRows_) — ผลลัพธ์ชุดเดียวกันทุกตัว
  const convAggP: Promise<ConvAgg> = convAggRpc_(cutoffIso).then((agg) => agg || fetchAll<any>(() =>
    db
      .from('conversations')
      .select('page_name,platform,type,updated_at,waiting,last_sent_by,tags')
      .gte('updated_at', cutoffIso)
  ).then((rows) => convAggFromRows_(rows.filter((c: any) => convInWindow_(c, cutoff)))));
  const convWaitP = fetchAll<any>(() =>
    db
      .from('conversations')
      .select('id,page_id,page_name,platform,type,customer_name,snippet,updated_at')
      .gte('updated_at', cutoffIso)
      .eq('waiting', true)
  );
  const engP = loadEngagementRange_(range, channel, commentMode);
  // คิวรีที่ await ก่อนล้ม → อีกตัวยังวิ่งต่อ แต่ต้องไม่กลายเป็น unhandled rejection
  convAggP.catch(() => {});
  convWaitP.catch(() => {});
  // แชทรายชั่วโมงแยก 2 คิวรีขนาน (~1,200 แถว/วัน × 7-14 วัน):
  //   ตัวเลข = ทุกแถว ไม่ลากชื่อเพจภาษาไทยมาด้วย (เดิมลากทุกแถว ~1 MB ต่อการเปิด/รีเฟรช 5 นาที) · หั่นตามวันกัน OFFSET ลึก
  //     ผลรวมเป็นจำนวนเต็มล้วน ลำดับแถวไม่มีผลกับตัวเลข
  //   คอมเมนต์รายเพจ = เฉพาะแถวในช่วงที่มีคอมเมนต์ (เงื่อนไขเดียวกับที่ลูปเดิมใช้) เรียง key แบบเดิมคิวรีเดียว
  //     → เพจที่เจอก่อน (platform / ลำดับเสมอกัน) เหมือนเดิมทุกตัว
  const chatFilter_ = (r: any) => {
    if (commentMode) return true; // มุมคอมเมนต์ = ทุก platform
    if (channel && platformChannel_(r.platform) !== channel) return false;
    return true;
  };
  const commentRowsP = fetchAll<any>(() =>
    db
      .from('chat_hourly')
      .select('platform,page_name,date,customer_comment_count')
      .gt('customer_comment_count', 0)
      .gte('date', range.startStr)
      .lte('date', range.endStr),
    'key'
  );
  commentRowsP.catch(() => {});
  // ⚡ ถ้ามีฟังก์ชัน dash_chat_daily ให้ฐานรวมเป็นรายวันต่อ platform มาให้ (≤ 14 วัน × ไม่กี่ platform)
  //    ชื่อคอลัมน์เหมือนแถวดิบ ลูปข้างล่างใช้ได้ทั้งสองแบบ — ผลบวกเป็นจำนวนเต็มล้วน ลำดับไม่มีผล
  //    ไม่มี/พลาด = ถอยไปอ่านแถวรายชั่วโมงแบบเดิม
  const chatRows = (await chatDailyRpc_(fetchStartStr, range.endStr)) || await fetchAllDateSliced<any>((f, t) =>
    db
      .from('chat_hourly')
      .select(
        'platform,date,customer_inbox_count,customer_comment_count,page_inbox_count,page_comment_count,new_inbox_count,new_customer_count,uniq_phone_number_count'
      )
      .gte('date', f)
      .lte('date', t),
    fetchStartStr, range.endStr, { orderColumn: 'key' }
  );
  const chat = chatRows.filter(chatFilter_);

  // KPI ของ "ช่วงที่เลือก" (โหมดคอมเมนต์นับเฉพาะคู่ *_comment_count)
  // weekMap เก็บทุกวันที่ดึงมา เพราะกราฟอาจกว้างกว่าช่วงที่เลือก (ช่วงสั้นกว่า 7 วัน)
  const k = { convsToday: 0, custMsgs: 0, newCustomers: 0, pageReplies: 0, phones: 0 };
  const weekMap: Record<string, { total: number; replied: number }> = {}; // date -> {total, replied}
  const commentPage: Record<string, { count: number; platform: string }> = {}; // คอมเมนต์ในช่วงต่อเพจ
  (await commentRowsP).filter(chatFilter_).forEach((r: any) => {
    const dateStr = toDateStr_(r.date);
    if (!(dateStr >= range.startStr && dateStr <= range.endStr)) return;
    const cc = toNum_(r.customer_comment_count);
    if (cc > 0) {
      const pn = String(r.page_name || 'ไม่ระบุเพจ');
      if (!commentPage[pn]) commentPage[pn] = { count: 0, platform: String(r.platform || '') };
      commentPage[pn].count += cc;
    }
  });
  chat.forEach((r: any) => {
    const dateStr = toDateStr_(r.date);
    const inRange = dateStr >= range.startStr && dateStr <= range.endStr; // 'YYYY-MM-DD' เทียบสตริงได้ตรงๆ
    const total = commentMode
      ? toNum_(r.customer_comment_count)
      : toNum_(r.customer_inbox_count) + toNum_(r.customer_comment_count);
    const replied = commentMode
      ? toNum_(r.page_comment_count)
      : toNum_(r.page_inbox_count) + toNum_(r.page_comment_count);
    if (!weekMap[dateStr]) weekMap[dateStr] = { total: 0, replied: 0 };
    weekMap[dateStr].total += total;
    weekMap[dateStr].replied += replied;
    if (inRange) {
      k.convsToday += commentMode ? toNum_(r.customer_comment_count) : toNum_(r.new_inbox_count);
      k.custMsgs += total;
      k.newCustomers += toNum_(r.new_customer_count);
      k.pageReplies += replied;
      k.phones += toNum_(r.uniq_phone_number_count);
    }
  });

  // กราฟรายวัน (วันท้ายช่วงอยู่ขวาสุด) — เกิน 8 วันใช้ป้าย d/M แทนชื่อวัน ไม่งั้นชื่อวันซ้ำจนอ่านไม่รู้เรื่อง
  const thaiDays = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
  const week: any[] = [];
  chartDates.forEach((d) => {
    const ds = fmtDateBkk(d);
    const m = weekMap[ds] || { total: 0, replied: 0 };
    week.push({
      date: ds,
      label: ds === todayStr
        ? 'วันนี้'
        : (chartDays > 8 ? Number(ds.slice(8, 10)) + '/' + Number(ds.slice(5, 7)) : thaiDays[dayOfWeekBkk_(d)]),
      total: m.total,
      replied: m.replied,
    });
  });
  const weekLabel = range.endStr === todayStr
    ? chartDays + ' วันล่าสุด'
    : chartDays + ' วัน (ถึง ' + Number(range.endStr.slice(8, 10)) + '/' + Number(range.endStr.slice(5, 7)) + ')';
  // ช่วงยาวกว่ากราฟ → บอกตรงๆ ว่ากราฟไม่ได้ครอบทั้งช่วง (KPI ด้านบนยังรวมทั้งช่วง)
  const weekNote = range.days > chartDays
    ? 'ช่วงที่เลือกยาว ' + range.days + ' วัน — กราฟแสดง ' + chartDays + ' วันท้ายของช่วง'
    : '';

  // บทสนทนา 24 ชม. ล่าสุด (ตารางเก็บไว้ถึง 14 วัน — กรองเวลาเองให้ตรงป้าย "24 ชม.")
  // ⚠️ ทุกอย่างที่คำนวณจากก้อนนี้ (donut / replyRate / waiting / byType / tags / byPage / attention)
  //    เป็น "สถานะตอนนี้" ไม่ขึ้นกับช่วงที่เลือก และแกล้งทำให้ย้อนหลังไม่ได้:
  //    conversations เก็บ "สถานะล่าสุด" ของแต่ละบทสนทนา (1 แถว/บทสนทนา ทับของเดิม) ไม่ใช่ประวัติรายวัน
  //    เลือก '30 วันล่าสุด' แล้วกรอง updated_at ย้อนหลังจะได้ "แชทที่ยังค้างอยู่ตอนนี้" ปนกับของเก่า
  //    ซึ่งอ่านผิดเป็น "แชทที่ค้างเมื่อ 30 วันก่อน" — หน้าเว็บจึงติดป้ายกำกับว่าเป็นค่าตอนนี้แทน
  const convAgg = await convAggP;
  const convWaitRows = await convWaitP;
  // ตัวกรองมุมมอง (ช่องทาง / มุมคอมเมนต์) ขึ้นกับ platform + type เท่านั้น → ใช้ได้ทั้งกับแถวดิบและกลุ่มที่นับมาแล้ว
  const convViewOk_ = (c: { platform: unknown; type: unknown }) => {
    if (commentMode) return String(c.type || '').toUpperCase() === 'COMMENT';
    if (channel && platformChannel_(c.platform) !== channel) return false;
    return true;
  };
  const convFilter_ = (c: any) => convInWindow_(c, cutoff) && convViewOk_(c);

  const donut = { replied: 0, waiting: 0, ai: 0 };
  const byType: Record<string, number> = {};
  const byPage: Record<string, { count: number; platform: string }> = {};
  const tagCount: Record<string, number> = {};
  const attention: any[] = [];
  const now = Date.now();
  // กลุ่มเรียงตาม id แรกของกลุ่ม = ลำดับที่แถวแรกของแต่ละเพจ/ประเภทเคยโผล่ → key ใน byPage/byType เกิดลำดับเดิม
  // (ค่าเท่ากันตอนเรียงจำนวน "เจอก่อนชนะ" เหมือนเดิม) และ platform ของเพจ = ของแถวแรกที่เจอ แบบเดิม
  convAgg.groups.forEach((g) => {
    if (!convViewOk_(g)) return;
    // จำนวนรอตอบนับจากก้อน "แชทรอตอบ" ข้างล่าง (ก้อนเดียวกับรายการต้องตอบ) — สองคิวรีอ่านคนละจังหวะ
    // ถ้านับจากก้อนนี้ sync ที่ลงระหว่างนั้นทำให้เลขการ์ดกับรายการขัดกันได้ · ไม่มี sync คั่น = ผลเท่าเดิมทุกตัว
    if (g.waiting) { /* นับข้างล่าง */ }
    else if (g.ai) donut.ai += g.n;
    else donut.replied += g.n;
    const type = String(g.type || 'INBOX');
    byType[type] = (byType[type] || 0) + g.n;
    const pageName = String(g.page_name || '');
    if (!byPage[pageName]) byPage[pageName] = { count: 0, platform: String(g.platform) };
    byPage[pageName].count += g.n;
  });
  // แท็กเรียงตามจุดที่เจอครั้งแรก (id, ลำดับในช่องแท็ก) — ตัดช่องว่างฝั่งเว็บแบบเดิม (แท็กดิบต่างกันแต่ตัดแล้วเหมือนกัน = รวมกัน)
  convAgg.tags.forEach((tg) => {
    if (!convViewOk_(tg)) return;
    const t = String(tg.tag || '').trim();
    if (t) tagCount[t] = (tagCount[t] || 0) + tg.n;
  });
  // รายการ "ต้องตอบ" — แถวรอตอบตามลำดับ id เดิม (= ลำดับเดียวกับที่เคยหยิบจากก้อนรวม)
  convWaitRows.filter(convFilter_).forEach((c: any) => {
    donut.waiting++;
    const upd = toDate_(c.updated_at);
    attention.push({
      id: String(c.id),
      pageId: String(c.page_id),
      pageName: String(c.page_name || ''),
      platform: String(c.platform),
      customer: String(c.customer_name || 'ลูกค้า'),
      snippet: String(c.snippet || ''),
      updatedAt: upd ? fmtDateTimeBkk(upd) : '',
      waitMins: upd ? Math.max(0, Math.round((now - upd.getTime()) / 60000)) : 0,
    });
  });
  attention.sort((a, b) => b.waitMins - a.waitMins);

  // ตัวเลขชุดเดียวกับหน้าสถิติแชทของ Pancake (chat_engagement_daily) — ใช้ยืนยันว่า
  // "ลูกค้าใหม่" ที่เราโชว์ตรงกับที่บอสเห็นบนจอ Pancake จริง
  // null = ยังไม่ได้รัน migration 2026-07-23-chat-engagement.sql → หน้าเว็บโชว์ "—"
  const eng = await engP;

  const replyBase = donut.replied + donut.ai + donut.waiting;
  return {
    // ป้ายช่วงเวลา — หน้าเว็บเอาไปแทนคำว่า "วันนี้" ที่เคย hard-code ไว้ทุกการ์ด
    rangeLabel: range.label,
    rangeDays: range.days,
    weekLabel: weekLabel,
    weekNote: weekNote,
    kpis: {
      convsToday: k.convsToday,
      custMsgs: k.custMsgs,
      newCustomers: k.newCustomers,
      // จาก Pancake ตรงๆ: ลูกค้าที่คุยทั้งหมด / ลูกค้าที่เปิดแชทใหม่ / ออเดอร์ที่สร้างจากแชท
      engCustomers: eng ? eng.total : null,
      engReached: eng ? eng.reached : null,     // คนทัก = อินบ็อกซ์ใหม่ + คอมเมนต์
      engNewInbox: eng ? eng.newInbox : null,
      engComment: eng ? eng.comment : null,
      engOrders: eng ? eng.orders : null,
      pageReplies: k.pageReplies,
      phones: k.phones,
      waiting: donut.waiting,
      replyRate: replyBase ? Math.round(((donut.replied + donut.ai) / replyBase) * 100) : 0,
    },
    week: week,
    donut: donut,
    byType: Object.keys(byType)
      .map((t) => ({ label: t, count: byType[t] }))
      .sort((a, b) => b.count - a.count),
    byPage: Object.keys(byPage)
      .map((n) => ({ name: n, platform: byPage[n].platform, count: byPage[n].count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    commentByPage: Object.keys(commentPage)
      .map((n) => ({ name: n, platform: commentPage[n].platform, count: commentPage[n].count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    tags: Object.keys(tagCount)
      .map((t) => ({ name: t, count: tagCount[t] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
    attention: attention.slice(0, 30),
  };
}
