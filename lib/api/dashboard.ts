// lib/api/dashboard.ts — port ของ apiDashboard จาก WebApi.gs
// อ่านจาก Supabase (server-side) แทนการอ่านชีต — output ตรง CONTRACT.md ทุก key
import { db, fetchAll } from '@/lib/db';
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
  const chatRows = await fetchAll<any>(() =>
    db
      .from('chat_hourly')
      .select(
        'platform,page_name,date,customer_inbox_count,customer_comment_count,page_inbox_count,page_comment_count,new_inbox_count,new_customer_count,uniq_phone_number_count'
      )
      .gte('date', fetchStartStr)
      .lte('date', range.endStr),
    'key'
  );
  const chat = chatRows.filter((r: any) => {
    if (commentMode) return true; // มุมคอมเมนต์ = ทุก platform
    if (channel && platformChannel_(r.platform) !== channel) return false;
    return true;
  });

  // KPI ของ "ช่วงที่เลือก" (โหมดคอมเมนต์นับเฉพาะคู่ *_comment_count)
  // weekMap เก็บทุกวันที่ดึงมา เพราะกราฟอาจกว้างกว่าช่วงที่เลือก (ช่วงสั้นกว่า 7 วัน)
  const k = { convsToday: 0, custMsgs: 0, newCustomers: 0, pageReplies: 0, phones: 0 };
  const weekMap: Record<string, { total: number; replied: number }> = {}; // date -> {total, replied}
  const commentPage: Record<string, { count: number; platform: string }> = {}; // คอมเมนต์ในช่วงต่อเพจ
  chat.forEach((r: any) => {
    const dateStr = toDateStr_(r.date);
    const inRange = dateStr >= range.startStr && dateStr <= range.endStr; // 'YYYY-MM-DD' เทียบสตริงได้ตรงๆ
    if (inRange) {
      const cc = toNum_(r.customer_comment_count);
      if (cc > 0) {
        const pn = String(r.page_name || 'ไม่ระบุเพจ');
        if (!commentPage[pn]) commentPage[pn] = { count: 0, platform: String(r.platform || '') };
        commentPage[pn].count += cc;
      }
    }
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
  const cutoff = convCutoff_();
  const cutoffIso = new Date(cutoff).toISOString();
  const convRows = await fetchAll<any>(() =>
    db
      .from('conversations')
      .select('id,page_id,page_name,platform,type,customer_name,snippet,updated_at,waiting,last_sent_by,tags')
      .gte('updated_at', cutoffIso)
  );
  const convs = convRows.filter((c: any) => {
    if (!convInWindow_(c, cutoff)) return false;
    if (commentMode) return String(c.type || '').toUpperCase() === 'COMMENT';
    if (channel && platformChannel_(c.platform) !== channel) return false;
    return true;
  });

  const donut = { replied: 0, waiting: 0, ai: 0 };
  const byType: Record<string, number> = {};
  const byPage: Record<string, { count: number; platform: string }> = {};
  const tagCount: Record<string, number> = {};
  const attention: any[] = [];
  const now = Date.now();
  convs.forEach((c: any) => {
    const waiting = toBool_(c.waiting);
    const lastBy = String(c.last_sent_by);
    if (waiting) donut.waiting++;
    else if (lastBy === 'ai') donut.ai++;
    else donut.replied++;
    const type = String(c.type || 'INBOX');
    byType[type] = (byType[type] || 0) + 1;
    const pageName = String(c.page_name || '');
    if (!byPage[pageName]) byPage[pageName] = { count: 0, platform: String(c.platform) };
    byPage[pageName].count++;
    String(c.tags || '')
      .split(',')
      .forEach((t: string) => {
        t = t.trim();
        if (t) tagCount[t] = (tagCount[t] || 0) + 1;
      });
    if (waiting) {
      const upd = toDate_(c.updated_at);
      attention.push({
        id: String(c.id),
        pageId: String(c.page_id),
        pageName: pageName,
        platform: String(c.platform),
        customer: String(c.customer_name || 'ลูกค้า'),
        snippet: String(c.snippet || ''),
        updatedAt: upd ? fmtDateTimeBkk(upd) : '',
        waitMins: upd ? Math.max(0, Math.round((now - upd.getTime()) / 60000)) : 0,
      });
    }
  });
  attention.sort((a, b) => b.waitMins - a.waitMins);

  // ตัวเลขชุดเดียวกับหน้าสถิติแชทของ Pancake (chat_engagement_daily) — ใช้ยืนยันว่า
  // "ลูกค้าใหม่" ที่เราโชว์ตรงกับที่บอสเห็นบนจอ Pancake จริง
  // null = ยังไม่ได้รัน migration 2026-07-23-chat-engagement.sql → หน้าเว็บโชว์ "—"
  const eng = await loadEngagementRange_(range, channel, commentMode);

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
