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

/* ================================================================
 * 1) DASHBOARD — ภาพรวมแชทวันนี้
 * ================================================================ */

export async function apiDashboard(params?: { channel?: string }): Promise<any> {
  const channel = (params && params.channel) || '';
  const todayStr = fmtDateBkk(new Date());

  // อ่าน chat_hourly แค่ 7 วันล่าสุด (ลดจำนวนแถว) — วนจนครบ กัน 1000-row cap
  const weekStartStr = fmtDateBkk(daysAgo(6));
  const chatRows = await fetchAll<any>(() =>
    db
      .from('chat_hourly')
      .select(
        'platform,date,customer_inbox_count,customer_comment_count,page_inbox_count,page_comment_count,new_inbox_count,new_customer_count,uniq_phone_number_count'
      )
      .gte('date', weekStartStr),
    'key'
  );
  const chat = chatRows.filter((r: any) => {
    if (channel && platformChannel_(r.platform) !== channel) return false;
    return true;
  });

  // KPI วันนี้
  const k = { convsToday: 0, custMsgs: 0, newCustomers: 0, pageReplies: 0, phones: 0 };
  const weekMap: Record<string, { total: number; replied: number }> = {}; // date -> {total, replied}
  chat.forEach((r: any) => {
    const dateStr = toDateStr_(r.date);
    const total = toNum_(r.customer_inbox_count) + toNum_(r.customer_comment_count);
    const replied = toNum_(r.page_inbox_count) + toNum_(r.page_comment_count);
    if (!weekMap[dateStr]) weekMap[dateStr] = { total: 0, replied: 0 };
    weekMap[dateStr].total += total;
    weekMap[dateStr].replied += replied;
    if (dateStr === todayStr) {
      k.convsToday += toNum_(r.new_inbox_count);
      k.custMsgs += total;
      k.newCustomers += toNum_(r.new_customer_count);
      k.pageReplies += replied;
      k.phones += toNum_(r.uniq_phone_number_count);
    }
  });

  // กราฟ 7 วัน (วันนี้อยู่ขวาสุด)
  const thaiDays = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
  const week: any[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = daysAgo(i);
    const ds = fmtDateBkk(d);
    const m = weekMap[ds] || { total: 0, replied: 0 };
    week.push({
      date: ds,
      label: i === 0 ? 'วันนี้' : thaiDays[dayOfWeekBkk_(d)],
      total: m.total,
      replied: m.replied,
    });
  }

  // บทสนทนา 24 ชม. ล่าสุด (ตารางเก็บไว้ถึง 14 วัน — กรองเวลาเองให้ตรงป้าย "24 ชม.")
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

  const replyBase = donut.replied + donut.ai + donut.waiting;
  return {
    kpis: {
      convsToday: k.convsToday,
      custMsgs: k.custMsgs,
      newCustomers: k.newCustomers,
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
    tags: Object.keys(tagCount)
      .map((t) => ({ name: t, count: tagCount[t] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
    attention: attention.slice(0, 30),
  };
}
