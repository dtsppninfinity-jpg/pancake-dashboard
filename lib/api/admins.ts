// lib/api/admins.ts — port ของ apiAdmins จาก WebApi.gs
// อ่านจาก Supabase (แทน readTable_ ของชีต) — ระวัง PostgREST 1000-row cap จึงใช้ fetchAll
// อัปเกรด Admin Management: ตั้งค่าต่อคน (admin_settings) + สถิติออนไลน์จริง (admin_online_log)
// ตารางใหม่ 2 ตัวอาจยังไม่ถูกสร้าง — ทุกจุดอ่านแบบ graceful (หน้าเว็บทำงานได้ปกติ แค่ไม่มีข้อมูลส่วนนั้น)
import { db, fetchAll } from '@/lib/db';
import {
  EXCLUDED_STATUSES,
  fmtDateBkk,
  parsePancakeTime,
  startOfDayBkk,
} from '@/lib/config';
import { defaultRolePerms, effectiveStatus, capacityOf, normalizeRolePermsShape, DEFAULT_MAX_ACTIVE } from '@/lib/adminconfig';

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

/**
 * catch เฉพาะ "ตารางยังไม่ถูกสร้าง" เท่านั้น — error อื่น (503/timeout) ต้องโยนต่อ
 * ไม่งั้น error ชั่วคราวจะถูกตีความว่า "ยังไม่รัน migration" แล้ว UI แสดงค่า default
 * ปลอมทั้งหน้า (อันตราย: กดบันทึกทับค่าจริงใน DB ได้)
 */
function missingTable_(table: string): (e: any) => null {
  return (e: any) => {
    const m = String((e && e.message) || e || '');
    if (m.includes(table) && (m.includes('does not exist') || m.includes('schema cache'))) return null;
    throw e;
  };
}

function convInWindow_(c: any, cutoff: number): boolean {
  const upd = toDate_(c.updated_at);
  return !!upd && upd.getTime() >= cutoff;
}

/* ---------------- online history (จาก admin_online_log) ---------------- */

interface OnlineToday {
  mins: number;                  // นาทีออนไลน์รวมวันนี้
  gapMins: number | null;        // ช่วงหายนานสุดหลังออนไลน์ครั้งแรกของวัน (นาที)
  marks: [number, boolean][];    // จุดเปลี่ยนสถานะวันนี้ [ts(ms), online] — ให้ timeline
}

/**
 * คำนวณเวลาออนไลน์วันนี้จาก log การเปลี่ยนสถานะ (ความละเอียด ~15 นาทีตามรอบ sync)
 * baseline = สถานะล่าสุดก่อนเที่ยงคืน; ไม่มี baseline + ไม่มี log วันนี้ → null (ไม่รู้จริง ไม่เดา)
 */
function onlineStats_(
  entries: { ts: number; on: boolean }[], dayStart: number, now: number
): OnlineToday | null {
  const before = entries.filter((e) => e.ts < dayStart);
  const today = entries.filter((e) => e.ts >= dayStart && e.ts <= now);
  let state: boolean;
  if (before.length) state = before[before.length - 1].on;
  else if (today.length) state = !today[0].on;
  else return null;

  let t = dayStart;
  let onlineMs = 0;
  let firstOnlineTs: number | null = state ? dayStart : null;
  let gapMs = 0;
  let gapStart: number | null = state ? null : -1; // -1 = ออฟไลน์ตั้งแต่ต้นวัน (ยังไม่นับจนกว่าจะเคยออนไลน์)

  const segEnd = (endTs: number) => {
    if (state) {
      onlineMs += endTs - t;
      if (firstOnlineTs === null) firstOnlineTs = t;
    } else if (gapStart !== null && gapStart >= 0) {
      gapMs = Math.max(gapMs, endTs - gapStart);
    }
  };

  for (const e of today) {
    segEnd(e.ts);
    state = e.on;
    if (!state) gapStart = firstOnlineTs !== null ? e.ts : -1;
    t = e.ts;
  }
  segEnd(now);

  return {
    mins: Math.round(onlineMs / 60000),
    gapMins: gapMs > 0 ? Math.round(gapMs / 60000) : null,
    marks: today.slice(-50).map((e) => [e.ts, e.on] as [number, boolean]),
  };
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
  // log ออนไลน์: เอาย้อนถึง 26 ชม.ก่อนต้นวัน เพื่อได้ baseline สถานะตอนเที่ยงคืน
  const logSinceIso = new Date(todayStartTime - 26 * 3600 * 1000).toISOString();

  const [adminsRows, chatDailyRows, orderRows, convRows, settingsRows, onlineLogRows, rolePermsRow] =
    await Promise.all([
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
      // ตั้งค่าแอดมิน (catch เฉพาะกรณีตารางยังไม่ถูกสร้าง — error อื่นโยนต่อ)
      fetchAll<any>(() => db.from('admin_settings').select('*'), 'user_id')
        .catch(missingTable_('admin_settings')),
      // ประวัติออนไลน์ (catch เฉพาะกรณีตารางยังไม่ถูกสร้าง → null = ไม่รู้)
      fetchAll<any>(() =>
        db
          .from('admin_online_log')
          .select('user_id,is_online,changed_at')
          .gte('changed_at', logSinceIso),
        'id'
      ).catch(missingTable_('admin_online_log')),
      // ตารางสิทธิ์ role (JSON ใน sync_state)
      db.from('sync_state').select('value').eq('key', 'admin_role_permissions').maybeSingle(),
    ]);

  const setupNeeded = settingsRows === null; // ยังไม่ได้รัน migration

  // จุดเริ่มของ log ทั้งระบบ — ถ้า log ทำงานมาตั้งแต่ก่อนเที่ยงคืน แปลว่า "ไม่มี flip วันนี้ = สถานะคงที่ทั้งวัน"
  // (กันเคสแอดมินที่ออนไลน์/ออฟไลน์ยาวๆ ไม่เคย flip เลย ค้างเป็น "รอเก็บข้อมูล" ตลอดกาล)
  let logAliveBeforeToday = false;
  if (onlineLogRows !== null) {
    try {
      const { data: b } = await db
        .from('admin_online_log')
        .select('changed_at')
        .order('changed_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      const bd = b ? toDate_(b.changed_at) : null;
      logAliveBeforeToday = !!bd && bd.getTime() < todayStartTime;
    } catch { logAliveBeforeToday = false; }
  }

  // สถิติแชทวันนี้ต่อ user_id (รวมทุกเพจ) + เร็วสุด/ช้าสุดรายเพจ (min/max ของ avg รายเพจ)
  const chatToday: Record<
    string,
    { replies: number; chats: number; phones: number; respSum: number; respN: number;
      respMin: number; respMax: number }
  > = {};
  chatDailyRows.forEach((r) => {
    if (toDateStr_(r.date) !== todayStr) return;
    const uid = String(r.user_id);
    if (!chatToday[uid]) {
      chatToday[uid] = { replies: 0, chats: 0, phones: 0, respSum: 0, respN: 0, respMin: 0, respMax: 0 };
    }
    const t = chatToday[uid];
    t.replies += toNum_(r.inbox_count) + toNum_(r.comment_count);
    t.chats += toNum_(r.unique_inbox_count);
    t.phones += toNum_(r.phone_number_count);
    const resp = toNum_(r.avg_response_ms);
    if (resp > 0) {
      t.respSum += resp;
      t.respN++;
      if (!t.respMin || resp < t.respMin) t.respMin = resp;
      if (resp > t.respMax) t.respMax = resp;
    }
  });

  // ยอดขายวันนี้ต่อ seller (pos id และชื่อ) + จุดเวลาออเดอร์ (ให้ timeline ใน modal)
  const salesByPosId: Record<string, { orders: number; revenue: number; marks: [number, number][] }> = {};
  const salesByName: Record<string, { orders: number; revenue: number; marks: [number, number][] }> = {};
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
      if (!salesByPosId[sid]) salesByPosId[sid] = { orders: 0, revenue: 0, marks: [] };
      salesByPosId[sid].orders++;
      salesByPosId[sid].revenue += totalPrice;
      salesByPosId[sid].marks.push([t, totalPrice]);
    } else if (snm) {
      if (!salesByName[snm]) salesByName[snm] = { orders: 0, revenue: 0, marks: [] };
      salesByName[snm].orders++;
      salesByName[snm].revenue += totalPrice;
      salesByName[snm].marks.push([t, totalPrice]);
    }
  });

  // แชทต่อแอดมิน (จาก assignees ใน Conversations, เฉพาะ 24 ชม. ล่าสุด)
  // active = ทุกบทสนทนาที่ถูกมอบหมาย (วัด workload) / waiting = เฉพาะที่ลูกค้ารอตอบ
  const waitingByName: Record<string, number> = {};
  const activeByName: Record<string, number> = {};
  let waitingTotal = 0;
  const waitCutoff = convCutoff_();
  convRows.forEach((c) => {
    if (!convInWindow_(c, waitCutoff)) return;
    const isWaiting = toBool_(c.waiting);
    if (isWaiting) waitingTotal++;
    String(c.assignees || '')
      .split(',')
      .forEach((nm) => {
        nm = nm.trim();
        if (!nm) return;
        activeByName[nm] = (activeByName[nm] || 0) + 1;
        if (isWaiting) waitingByName[nm] = (waitingByName[nm] || 0) + 1;
      });
  });

  // ตั้งค่าต่อคน (default เมื่อยังไม่มีแถว)
  const settingsById: Record<string, any> = {};
  (settingsRows || []).forEach((s) => { settingsById[String(s.user_id)] = s; });

  // log ออนไลน์ต่อคน (เรียงเวลา)
  const logsById: Record<string, { ts: number; on: boolean }[]> = {};
  (onlineLogRows || []).forEach((r) => {
    const at = toDate_(r.changed_at);
    if (!at) return;
    const uid = String(r.user_id);
    if (!logsById[uid]) logsById[uid] = [];
    logsById[uid].push({ ts: at.getTime(), on: toBool_(r.is_online) });
  });
  Object.keys(logsById).forEach((k) => logsById[k].sort((a, b) => a.ts - b.ts));

  const out = adminsRows.map((a) => {
    const uid = String(a.user_id);
    const t = chatToday[uid] ||
      { replies: 0, chats: 0, phones: 0, respSum: 0, respN: 0, respMin: 0, respMax: 0 };
    // ออเดอร์ของคนเดียวกันอาจมาทั้งแบบผูก seller_id และแบบไม่ผูก (จับด้วยชื่อ) — รวมสองทาง
    const sp = (a.pos_user_id && salesByPosId[String(a.pos_user_id)]) ||
      { orders: 0, revenue: 0, marks: [] as [number, number][] };
    const sn = salesByName[String(a.name)] || { orders: 0, revenue: 0, marks: [] as [number, number][] };
    const sales = { orders: sp.orders + sn.orders, revenue: sp.revenue + sn.revenue };
    const orderMarks = sp.marks.concat(sn.marks)
      .sort((x: [number, number], y: [number, number]) => x[0] - y[0])
      .slice(-30);

    const s = settingsById[uid] || {};
    const enabled = s.enabled !== false; // ไม่มีแถว = เปิดใช้งาน
    const statusOverride = String(s.status_override || '');
    const maxActive = toNum_(s.max_active) || DEFAULT_MAX_ACTIVE;
    const online = toBool_(a.is_online);
    const active = activeByName[String(a.name)] || 0;

    const logs = logsById[uid] || [];
    let onlineToday: OnlineToday | null = null;
    if (onlineLogRows !== null) {
      if (logs.length) {
        onlineToday = onlineStats_(logs, todayStartTime, todayEndTime);
      } else if (logAliveBeforeToday) {
        // ไม่มี flip ในหน้าต่างเลย + ระบบ log ทำงานมาก่อนวันนี้ → สถานะคงที่ทั้งวัน = สถานะปัจจุบัน
        onlineToday = {
          mins: online ? Math.round((todayEndTime - todayStartTime) / 60000) : 0,
          gapMins: null,
          marks: [],
        };
      }
    }

    return {
      id: uid,
      posId: String(a.pos_user_id || ''),
      name: String(a.name || ''),
      email: String(a.email || ''),
      online,
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
        respMinMins: t.respMin ? Math.round((t.respMin / 60000) * 10) / 10 : null, // เพจที่ตอบเร็วสุด
        respMaxMins: t.respMax ? Math.round((t.respMax / 60000) * 10) / 10 : null, // เพจที่ตอบช้าสุด
        orders: sales.orders,
        revenue: Math.round(sales.revenue),
      },
      waiting: waitingByName[String(a.name)] || 0,
      active,
      // ---- ส่วนตั้งค่า (จาก admin_settings — default เมื่อยังไม่ตั้ง) ----
      enabled,
      statusOverride,
      role: String(s.role || ''),
      channels: String(s.channels || 'both'),
      productGroups: String(s.product_groups || ''),
      maxActive,
      note: String(s.note || ''),
      status: effectiveStatus(enabled, statusOverride, online),
      capacity: capacityOf(active, maxActive),
      onlineToday,
      orderMarks,
    };
  });

  // ตารางสิทธิ์ role
  let rolePerms = defaultRolePerms();
  if (rolePermsRow && rolePermsRow.data && rolePermsRow.data.value) {
    try { rolePerms = normalizeRolePermsShape(JSON.parse(rolePermsRow.data.value)); } catch { /* ใช้ default */ }
  }

  const enabledAdmins = out.filter((a) => a.enabled);
  const kpis = {
    total: out.length,
    activeTotal: enabledAdmins.reduce((s2, a) => s2 + a.active, 0), // แชทค้างรวมทีม (24 ชม.)
    online: enabledAdmins.filter((a) => a.status === 'online').length,
    away: enabledAdmins.filter((a) => a.status === 'away' || a.status === 'busy').length,
    offline: enabledAdmins.filter((a) => a.status === 'offline').length,
    disabled: out.length - enabledAdmins.length,
    fullCap: enabledAdmins.filter((a) => a.capacity.key === 'full').length,
    withSalesToday: enabledAdmins.filter((a) => a.today.orders > 0).length,
    repliedToday: enabledAdmins.filter((a) => a.today.replies > 0).length,
    waitingTotal: waitingTotal,
    phonesToday: enabledAdmins.reduce((s2, a) => s2 + a.today.phones, 0),
  };

  return { kpis, admins: out, rolePerms, setupNeeded };
}
