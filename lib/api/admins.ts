// lib/api/admins.ts — port ของ apiAdmins จาก WebApi.gs
// อ่านจาก Supabase (แทน readTable_ ของชีต) — ระวัง PostgREST 1000-row cap จึงใช้ fetchAll
import { db, fetchAll } from '@/lib/db';
import {
  EXCLUDED_STATUSES,
  fmtDateBkk,
  parsePancakeTime,
  startOfDayBkk,
} from '@/lib/config';

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
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

/** cutoff 24 ชม. สำหรับข้อมูลบทสนทนา */
function convCutoff_(): number {
  return Date.now() - 24 * 3600 * 1000;
}

function convInWindow_(c: any, cutoff: number): boolean {
  const upd = toDate_(c.updated_at);
  return !!upd && upd.getTime() >= cutoff;
}

/* ---------------- apiAdmins ---------------- */

export async function apiAdmins(_params?: any) {
  const now = new Date();
  const todayStr = fmtDateBkk(now);

  // ช่วง "วันนี้" (เวลาไทย) สำหรับกรองออเดอร์
  const todayStart = startOfDayBkk(now);
  const todayStartIso = todayStart.toISOString();
  const todayEndTime = now.getTime();
  const todayStartTime = todayStart.getTime();

  const [adminsRows, chatDailyRows, orderRows, convRows] = await Promise.all([
    // Admins — ตารางเล็ก
    fetchAll<any>(() =>
      db
        .from('admins')
        .select(
          'user_id,pos_user_id,name,email,is_online,status_in_page,pages,page_count,permissions,department,sale_group,avatar_url'
        ),
      'user_id'
    ),
    // AdminChatDaily — กรองเฉพาะวันนี้ในตัว query เพื่อลดแถว
    fetchAll<any>(() =>
      db
        .from('admin_chat_daily')
        .select(
          'date,user_id,inbox_count,comment_count,unique_inbox_count,phone_number_count,avg_response_ms'
        )
        .eq('date', todayStr),
      'key'
    ),
    // Orders — กรองตั้งแต่ต้นวันนี้ (เวลาไทย) ในตัว query
    fetchAll<any>(() =>
      db
        .from('orders')
        .select('inserted_at,status,total_price,seller_id,seller_name,creator_name')
        .gte('inserted_at', todayStartIso)
    ),
    // Conversations — กรองเฉพาะที่อัปเดตใน 24 ชม. ล่าสุด
    fetchAll<any>(() =>
      db
        .from('conversations')
        .select('waiting,updated_at,assignees')
        .gte('updated_at', new Date(convCutoff_()).toISOString())
    ),
  ]);

  // สถิติแชทวันนี้ต่อ user_id (รวมทุกเพจ)
  const chatToday: Record<
    string,
    { replies: number; chats: number; phones: number; respSum: number; respN: number }
  > = {};
  chatDailyRows.forEach((r) => {
    if (toDateStr_(r.date) !== todayStr) return;
    const uid = String(r.user_id);
    if (!chatToday[uid]) chatToday[uid] = { replies: 0, chats: 0, phones: 0, respSum: 0, respN: 0 };
    const t = chatToday[uid];
    t.replies += toNum_(r.inbox_count) + toNum_(r.comment_count);
    t.chats += toNum_(r.unique_inbox_count);
    t.phones += toNum_(r.phone_number_count);
    const resp = toNum_(r.avg_response_ms);
    if (resp > 0) {
      t.respSum += resp;
      t.respN++;
    }
  });

  // ยอดขายวันนี้ต่อ seller (pos id และชื่อ)
  const salesByPosId: Record<string, { orders: number; revenue: number }> = {};
  const salesByName: Record<string, { orders: number; revenue: number }> = {};
  orderRows.forEach((o) => {
    const at = toDate_(o.inserted_at);
    if (!at) return;
    const status = toNum_(o.status);
    const excluded = EXCLUDED_STATUSES.indexOf(status) >= 0;
    const t = at.getTime();
    if (t < todayStartTime || t > todayEndTime || excluded) return;
    const totalPrice = toNum_(o.total_price);
    const sid = String(o.seller_id || '');
    const snm = String(o.seller_name || o.creator_name || '');
    if (sid) {
      if (!salesByPosId[sid]) salesByPosId[sid] = { orders: 0, revenue: 0 };
      salesByPosId[sid].orders++;
      salesByPosId[sid].revenue += totalPrice;
    } else if (snm) {
      if (!salesByName[snm]) salesByName[snm] = { orders: 0, revenue: 0 };
      salesByName[snm].orders++;
      salesByName[snm].revenue += totalPrice;
    }
  });

  // แชทค้างต่อแอดมิน (จาก assignees ใน Conversations, เฉพาะ 24 ชม. ล่าสุด)
  const waitingByName: Record<string, number> = {};
  let waitingTotal = 0;
  const waitCutoff = convCutoff_();
  convRows.forEach((c) => {
    if (!toBool_(c.waiting) || !convInWindow_(c, waitCutoff)) return;
    waitingTotal++;
    String(c.assignees || '')
      .split(',')
      .forEach((nm) => {
        nm = nm.trim();
        if (nm) waitingByName[nm] = (waitingByName[nm] || 0) + 1;
      });
  });

  const out = adminsRows.map((a) => {
    const uid = String(a.user_id);
    const t = chatToday[uid] || { replies: 0, chats: 0, phones: 0, respSum: 0, respN: 0 };
    // ออเดอร์ของคนเดียวกันอาจมาทั้งแบบผูก seller_id และแบบไม่ผูก (จับด้วยชื่อ) — รวมสองทาง
    const sp = (a.pos_user_id && salesByPosId[String(a.pos_user_id)]) || { orders: 0, revenue: 0 };
    const sn = salesByName[String(a.name)] || { orders: 0, revenue: 0 };
    const sales = { orders: sp.orders + sn.orders, revenue: sp.revenue + sn.revenue };
    return {
      id: uid,
      posId: String(a.pos_user_id || ''),
      name: String(a.name || ''),
      email: String(a.email || ''),
      online: toBool_(a.is_online),
      statusInPage: String(a.status_in_page || ''),
      pages: String(a.pages || ''),
      pageCount: toNum_(a.page_count),
      permissions: String(a.permissions || ''),
      department: String(a.department || ''),
      saleGroup: String(a.sale_group || ''),
      avatar: String(a.avatar_url || ''),
      today: {
        replies: t.replies,
        chats: t.chats,
        phones: t.phones,
        respMins: t.respN ? Math.round((t.respSum / t.respN / 60000) * 10) / 10 : null,
        orders: sales.orders,
        revenue: Math.round(sales.revenue),
      },
      waiting: waitingByName[String(a.name)] || 0,
    };
  });

  const kpis = {
    total: out.length,
    online: out.filter((a) => a.online).length,
    offline: out.filter((a) => !a.online).length,
    withSalesToday: out.filter((a) => a.today.orders > 0).length,
    repliedToday: out.filter((a) => a.today.replies > 0).length,
    waitingTotal: waitingTotal,
    phonesToday: out.reduce((s, a) => s + a.today.phones, 0),
  };

  return { kpis: kpis, admins: out };
}
