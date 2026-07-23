// scripts/sync/jobs.ts — งาน sync ทั้งหมด (port จาก Sync*.gs + Setup.gs trigger entry points)
import {
  requireCredentials, daysAgo, startOfDayBkk, fmtDateBkk, parsePancakeTime, num, sleep, RETENTION_DAYS,
} from '../../lib/config';
import {
  posFetchOrders, posFetchUsers, posFetchAds, posFetchCampaigns,
  pageChatStats, pageConversations, pageUserStats, pageUsers, pageAdStats, pageCustomerEngagements,
} from '../../lib/pancake';
import { mapOrder, mapChatHour, mapConversation, mapAd, mapAdDaily, mapEngagementDaily } from '../../lib/mappers';
import { supabase, upsertRows, replaceTable } from '../../lib/supabase';

/* ---------------- helper: โหลดเพจ + token จาก DB ---------------- */

async function loadPagesWithTokens(): Promise<{ pages: any[]; tokens: Record<string, string> }> {
  const { data: pages } = await supabase.from('pages').select('*');
  const { data: toks } = await supabase.from('page_tokens').select('page_id, token');
  const tokens: Record<string, string> = {};
  (toks || []).forEach((t: any) => { tokens[String(t.page_id)] = t.token; });
  const withToken = (pages || []).filter((p: any) => tokens[String(p.page_id)]);
  return { pages: withToken, tokens };
}

async function platformByPage(): Promise<Record<string, string>> {
  const { data } = await supabase.from('pages').select('page_id, platform');
  const m: Record<string, string> = {};
  (data || []).forEach((p: any) => { m[String(p.page_id)] = p.platform; });
  return m;
}

/* ---------------- ORDERS ---------------- */

/** งานประจำ: ออเดอร์ที่อัปเดตใน 48 ชม.ล่าสุด */
export async function syncOrders(): Promise<string> {
  requireCredentials();
  const since = new Date(Date.now() - 48 * 3600 * 1000);
  const until = new Date(Date.now() + 3600 * 1000);
  // เพดาน 120 หน้า = 12,000 ออเดอร์/48 ชม. — ทีมทำ ~2,800/วัน จึงเหลือที่เผื่ออีกเท่าตัว
  // เดิมตั้งไว้ 30 หน้า (3,000 ใบ) ซึ่ง "ชนพอดี" ทุกรอบ = ออเดอร์หายเงียบทุก 15 นาที
  const raw = await posFetchOrders(since, until, 120);
  const map = await platformByPage();
  const rows = raw.map((o) => mapOrder(o, map));
  const n = await upsertRows('orders', rows, 'id');
  return `orders: ${raw.length} รายการ (upsert ${n})`;
}

/**
 * Backfill ออเดอร์ย้อนหลัง (GitHub Actions ไม่มีลิมิต 6 นาที → ทำรวดเดียวได้เลย)
 * slice ทีละ 2 วัน + เพดาน 120 หน้า (12,000 ออเดอร์/slice) — ทีมทำ ~2,800/วัน
 * ⚠️ ห้ามกลับไปใช้ slice 7 วัน + 50 หน้า (5,000 cap) — เคยทำข้อมูล 1-4 ก.ค. 2026 หายเงียบๆ มาแล้ว
 */
export async function syncOrdersBackfill(days = 30): Promise<string> {
  requireCredentials();
  const map = await platformByPage();
  let count = 0;
  for (let start = days; start > 0; start -= 2) {
    const since = daysAgo(start);
    const until = start - 2 <= 0 ? new Date(Date.now() + 3600 * 1000) : daysAgo(start - 2);
    const raw = await posFetchOrders(since, until, 120);
    if (raw.length >= 12000) {
      // ชนเพดาน = มีข้อมูลถูกตัดแน่นอน — ฟ้องดังๆ ดีกว่าเงียบ
      throw new Error(`backfill slice ${since.toISOString().slice(0, 10)} ชนเพดาน 12,000 ออเดอร์ — ลด slice ให้เล็กลง`);
    }
    const rows = raw.map((o) => mapOrder(o, map));
    await upsertRows('orders', rows, 'id');
    count += raw.length;
  }
  return `backfill ออเดอร์ ${days} วัน: ${count} รายการ`;
}

/* ---------------- CHAT STATS (ChatHourly) ---------------- */

export async function syncChatStats(since: Date, until: Date): Promise<string> {
  requireCredentials();
  const { pages, tokens } = await loadPagesWithTokens();
  const rows: any[] = [];
  const errors: string[] = [];
  for (const p of pages) {
    try {
      const buckets = await pageChatStats(String(p.page_id), tokens[String(p.page_id)], since, until);
      for (const b of buckets) { const row = mapChatHour(p, b); if (row) rows.push(row); }
    } catch (e: any) { errors.push(`${p.name}: ${e.message}`); }
    await sleep(100);
  }
  if (rows.length) await upsertRows('chat_hourly', rows, 'key');
  let msg = `chat stats: ${rows.length} ชั่วโมง จาก ${pages.length} เพจ`;
  if (errors.length) msg += ` | ผิดพลาด ${errors.length} เพจ: ${errors.slice(0, 3).join('; ')}`;
  return msg;
}

export const syncChatToday = () => syncChatStats(startOfDayBkk(new Date()), new Date());

/* ---------------- CUSTOMER ENGAGEMENTS (ตัวเลขชุดเดียวกับหน้าสถิติแชท Pancake) ---------------- */

/**
 * ดึง statistics/customer_engagements ของทุกเพจ ลง chat_engagement_daily
 *
 * ทำไมต้องมีทั้งที่มี chat_hourly อยู่แล้ว: chat_hourly (statistics/pages) นับ "ข้อความ"
 * ส่วน endpoint นี้นับ "ลูกค้า" แบบตัดซ้ำ + ให้ order_count/old_order_count มาด้วย
 * → เป็นตัวหาร/ตัวตั้งของ %ปิดการขายแบบที่ Pancake โชว์ ("ยอดสั่งซื้อจากลูกค้าทั้งหมด")
 *
 * ⚠️ บางเพจตอบ HTTP 500 — จับรายเพจ ไม่ให้ล้มทั้ง job (ตรวจแล้วเป็นเพจที่ไม่มีทราฟฟิก)
 */
export async function syncEngagementsForDate(dateStr: string, skip?: Set<string>): Promise<string> {
  requireCredentials();
  const { pages, tokens } = await loadPagesWithTokens();
  const since = parsePancakeTime(`${dateStr}T00:00:00`)!;
  const until = parsePancakeTime(`${dateStr}T23:59:59`)!;
  const rows: any[] = [];
  const errors: string[] = [];
  let total = 0;
  let orderCount = 0;
  for (const p of pages) {
    // backfill ส่ง set ของเพจที่ 500 มาแล้วมาให้ข้าม — ไม่งั้นเสียเวลา retry ซ้ำทุกวัน
    if (skip && skip.has(String(p.page_id))) continue;
    try {
      const s = await pageCustomerEngagements(String(p.page_id), tokens[String(p.page_id)], since, until);
      const row = mapEngagementDaily(p, s, dateStr);
      // เพจที่ไม่มีความเคลื่อนไหวเลย ไม่ต้องเขียนแถวศูนย์ให้ตารางบวม
      if (row.total || row.order_count || row.inbox) {
        rows.push(row);
        total += row.total;
        orderCount += row.order_count;
      }
    } catch (e: any) {
      errors.push(`${p.name}: ${e.message}`);
      if (skip) skip.add(String(p.page_id));
    }
    await sleep(80);
  }
  if (rows.length) await upsertRows('chat_engagement_daily', rows, 'key');
  let msg = `engagements ${dateStr}: ${rows.length} เพจ | ลูกค้า ${total} | ออเดอร์ ${orderCount}`;
  if (errors.length) msg += ` | ผิดพลาด ${errors.length} เพจ: ${errors.slice(0, 2).join('; ')}`;
  return msg;
}

export const syncEngagementsToday = () => syncEngagementsForDate(fmtDateBkk(new Date()));
export const syncEngagementsYesterday = () => syncEngagementsForDate(fmtDateBkk(daysAgo(1)));

/* ---------------- CONVERSATIONS ---------------- */

export async function syncConversations(): Promise<string> {
  requireCredentials();
  const { pages, tokens } = await loadPagesWithTokens();
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const until = new Date();
  const rows: any[] = [];
  const errors: string[] = [];
  for (const p of pages) {
    try {
      const convs = await pageConversations(String(p.page_id), tokens[String(p.page_id)], since, until, 2);
      convs.forEach((c) => rows.push(mapConversation(p, c)));
    } catch (e: any) { errors.push(`${p.name}: ${e.message}`); }
    await sleep(100);
  }
  if (rows.length) await upsertRows('conversations', rows, 'id');
  let msg = `conversations: ${rows.length} บทสนทนา จาก ${pages.length} เพจ`;
  if (errors.length) msg += ` | ผิดพลาด ${errors.length} เพจ`;
  return msg;
}

/* ---------------- AD STATS รายวัน (ค่าแอดจริง) ---------------- */

/**
 * ดึงค่าแอดรายแอดของทุกเพจ ลง ad_daily (1 วัน = 1 ชุด)
 * แหล่ง: pages /statistics/ads?type=by_id — ตัวเดียวที่ให้ spend จริง
 * (POS /ads_manager/ads_v2 คืน 0 แถวเสมอ ตาราง `ads` เดิมจึงว่างมาตลอด)
 * เรียกทุกรอบ sync (15 นาที) สำหรับ "วันนี้" → หน้าเว็บได้ค่าแอดสดตามเวลา sync
 */
export async function syncAdStatsForDate(dateStr: string): Promise<string> {
  requireCredentials();
  const { pages, tokens } = await loadPagesWithTokens();
  const since = parsePancakeTime(`${dateStr}T00:00:00`)!;
  const until = parsePancakeTime(`${dateStr}T23:59:59`)!;
  const rows: any[] = [];
  const errors: string[] = [];
  let spend = 0;
  for (const p of pages) {
    try {
      const ads = await pageAdStats(String(p.page_id), tokens[String(p.page_id)], since, until);
      for (const a of ads) {
        const row = mapAdDaily(p, a, dateStr);
        if (row) { rows.push(row); spend += row.spend; }
      }
    } catch (e: any) { errors.push(`${p.name}: ${e.message}`); }
    await sleep(80);
  }
  if (rows.length) await upsertRows('ad_daily', rows, 'date,ad_id');
  let msg = `ad stats ${dateStr}: ${rows.length} แอด จาก ${pages.length} เพจ | spend ฿${spend.toFixed(2)}`;
  if (errors.length) msg += ` | ผิดพลาด ${errors.length} เพจ: ${errors.slice(0, 2).join('; ')}`;
  return msg;
}

export const syncAdStatsToday = () => syncAdStatsForDate(fmtDateBkk(new Date()));
/** ยอดของ Meta ยังขยับย้อนหลังได้อีก 1-2 วัน — งานรายวันตามเก็บซ้ำ */
export const syncAdStatsYesterday = () => syncAdStatsForDate(fmtDateBkk(daysAgo(1)));

/* ---------------- ADS (ตารางเดิม — POS endpoint ตายแล้ว) ---------------- */

export async function syncAds(): Promise<string> {
  requireCredentials();
  const campaigns: Record<string, string> = {};
  try {
    (await posFetchCampaigns(5)).forEach((c: any) => { campaigns[String(c.id)] = c.name || ''; });
  } catch { /* ไม่มีชื่อแคมเปญก็ใช้ id แทนได้ */ }
  const ads = await posFetchAds(10);
  const rows = ads.map((a) => mapAd(a, campaigns));
  // กันข้อมูลหาย: ถ้า API คืนว่าง (ล่ม/ไม่มีสิทธิ์ชั่วคราว) อย่าเขียนทับตาราง ads ด้วยของว่าง
  if (!rows.length) return 'ads: 0 แอด (ข้ามการเขียนทับ — คงข้อมูลเดิม)';
  await replaceTable('ads', rows, 'ad_id');
  return `ads: ${rows.length} แอด`;
}

/* ---------------- ADMINS (roster + online) ---------------- */

/**
 * บันทึกการเปลี่ยนสถานะออนไลน์ลง admin_online_log (ให้หน้า Admin คำนวณ
 * "ออนไลน์ X ชม. / หาย Y นาที" ของจริง) — non-fatal: ตารางยังไม่ถูกสร้างก็ไม่ล้ม sync
 */
async function logOnlineChanges(rows: { user_id: string; is_online: boolean }[]): Promise<string> {
  if (!rows.length) return '';
  try {
    const now = new Date().toISOString();
    const { error } = await supabase.from('admin_online_log').insert(
      rows.map((r) => ({ user_id: String(r.user_id), is_online: !!r.is_online, changed_at: now }))
    );
    if (error) throw error;
    return ` | log ${rows.length} จุด`;
  } catch (e: any) {
    return ` | log ไม่สำเร็จ: ${String(e.message || e).slice(0, 80)}`;
  }
}

export async function syncAdminsRoster(): Promise<string> {
  requireCredentials();
  const { pages, tokens } = await loadPagesWithTokens();
  const byUser: Record<string, any> = {};
  const errors: string[] = [];
  const failedPages: string[] = []; // เพจที่ดึงพลาดรอบนี้ — ห้ามตัดสินว่าคนของเพจนั้นออฟไลน์/หายไป
  let okPages = 0;

  for (const p of pages) {
    try {
      const res = await pageUsers(String(p.page_id), tokens[String(p.page_id)]);
      okPages++;
      for (const u of res.users) {
        const uid = String(u.id);
        let rec = byUser[uid];
        if (!rec) {
          rec = byUser[uid] = {
            user_id: uid, pos_user_id: '', name: u.name || '', email: u.email || '',
            fb_id: u.fb_id || '', is_online: false, status_in_page: '', pagesList: [],
            permissions: '', department: '', sale_group: '', avatar_url: u.avatar_url || '',
          };
        }
        rec.pagesList.push(p.name);
        if (u.is_online) rec.is_online = true;
        if (u.status_in_page && !rec.status_in_page) rec.status_in_page = String(u.status_in_page);
        if (u.status && !rec.status_in_page) rec.status_in_page = String(u.status);
        const perms = u.page_permissions && u.page_permissions.permissions;
        if (perms && perms.length && !rec.permissions) rec.permissions = perms.join(', ').slice(0, 300);
      }
    } catch (e: any) {
      errors.push(`${p.name}: ${e.message}`);
      failedPages.push(String(p.name || p.page_id));
    }
    await sleep(150);
  }

  // เติมข้อมูลจาก POS users (แผนก / กลุ่มขาย / pos_user_id สำหรับ join กับออเดอร์)
  try {
    const posUsers = await posFetchUsers();
    const pancakeList = Object.keys(byUser).map((k) => byUser[k]);
    for (const pu of posUsers) {
      const u = pu.user || {};
      const posId = String(pu.user_id || u.id || '');
      const match = pancakeList.find((r) =>
        (u.email && r.email && u.email.toLowerCase() === r.email.toLowerCase()) ||
        (u.fb_id && r.fb_id && String(u.fb_id) === String(r.fb_id)));
      if (match) {
        match.pos_user_id = posId;
        match.department = (pu.department && pu.department.name) || '';
        match.sale_group = (pu.sale_group && pu.sale_group.name) || '';
      } else {
        byUser['pos:' + posId] = {
          user_id: 'pos:' + posId, pos_user_id: posId, name: u.name || '', email: u.email || '',
          fb_id: u.fb_id ? String(u.fb_id) : '', is_online: false, status_in_page: '',
          pagesList: [], permissions: '', department: (pu.department && pu.department.name) || '',
          sale_group: (pu.sale_group && pu.sale_group.name) || '', avatar_url: '',
        };
      }
    }
  } catch (e: any) { errors.push(`POS users: ${e.message}`); }

  // กันข้อมูลหาย: ถ้าดึงไม่สำเร็จเลยสักเพจ ห้ามเขียนทับตาราง admins
  if (pages.length && !okPages) {
    throw new Error('ดึงรายชื่อแอดมินไม่สำเร็จทุกเพจ — คงข้อมูลเดิม: ' + errors.slice(0, 3).join('; '));
  }

  const now = new Date().toISOString();
  const rows = Object.keys(byUser).map((k) => {
    const r = byUser[k];
    return {
      user_id: r.user_id, pos_user_id: r.pos_user_id, name: r.name, email: r.email, fb_id: r.fb_id,
      is_online: r.is_online, status_in_page: r.status_in_page,
      pages: r.pagesList.join(', ').slice(0, 400), page_count: r.pagesList.length,
      permissions: r.permissions, department: r.department, sale_group: r.sale_group,
      avatar_url: r.avatar_url, updated_at: now,
    };
  });

  // สถานะเดิม (อ่านทั้งแถว — ใช้ทั้งเทียบ flip, กันเพจล้ม และ carry-forward คนที่หายชั่วคราว)
  const { data: prevRows, error: prevErr } = await supabase.from('admins').select('*');
  const prevList: any[] | null = prevErr ? null : (prevRows || []);
  const newIds: Record<string, boolean> = {};
  rows.forEach((r) => { newIds[r.user_id] = true; });
  const rowById: Record<string, any> = {};
  rows.forEach((r) => { rowById[r.user_id] = r; });

  if (prevList) {
    const touchesFailed = (pr: any) =>
      failedPages.length > 0 && failedPages.some((fp) => String(pr.pages || '').includes(fp));
    for (const pr of prevList) {
      const uid = String(pr.user_id);
      if (!newIds[uid]) {
        // หายจาก roster ใหม่ — ถ้าเพจของเขาดึงพลาดรอบนี้ ให้คงแถวเดิมไว้ (กันหลุดจากระบบชั่วคราว)
        if (touchesFailed(pr)) {
          const kept = { ...pr, updated_at: now };
          rows.push(kept);
          newIds[uid] = true;
          rowById[uid] = kept;
        }
      } else if (pr.is_online === true && rowById[uid].is_online !== true && touchesFailed(pr)) {
        // เดิมออนไลน์ แต่รอบนี้สัญญาณหายเพราะเพจล้ม — คงออนไลน์ไว้ (guard เดียวกับ syncOnlineStatus)
        rowById[uid].is_online = true;
      }
    }
  }

  // flip สถานะออนไลน์ (เทียบได้ต่อเมื่ออ่าน prev สำเร็จ — ห้ามเทียบกับ baseline ว่าง เดี๋ยว log มั่ว)
  let flips: { user_id: string; is_online: boolean }[] = [];
  if (prevList) {
    const prevOnline: Record<string, boolean> = {};
    prevList.forEach((r: any) => { prevOnline[String(r.user_id)] = r.is_online === true; });
    flips = rows.filter((r) => (prevOnline[r.user_id] || false) !== (r.is_online === true))
      .map((r) => ({ user_id: r.user_id, is_online: r.is_online === true }));
    // คนที่เคยออนไลน์แล้วหายจาก roster จริงๆ (ถูกถอดจากทุกเพจ) → ปิด log เป็นออฟไลน์
    prevList.forEach((pr: any) => {
      const uid = String(pr.user_id);
      if (pr.is_online === true && !newIds[uid]) flips.push({ user_id: uid, is_online: false });
    });
  }

  // เขียนแบบไม่ให้ตารางว่าง: upsert ก่อน แล้วค่อยลบแถวที่ไม่อยู่แล้ว
  // (replaceTable เดิม delete-ทั้งตาราง-แล้ว-insert → มีจังหวะที่หน้าเว็บเห็นตารางว่าง)
  await upsertRows('admins', rows, 'user_id');
  if (rows.length) {
    const keep = rows.map((r) => '"' + String(r.user_id).replace(/"/g, '') + '"').join(',');
    const { error: delErr } = await supabase.from('admins').delete().not('user_id', 'in', '(' + keep + ')');
    if (delErr) errors.push(`ลบแถวเก่า: ${delErr.message}`);
  }

  let msg = `admins: ${rows.length} คน`;
  msg += await logOnlineChanges(flips);
  if (prevErr) msg += ' | อ่านสถานะเดิมพลาด (ข้าม log รอบนี้)';
  if (errors.length) msg += ` | ผิดพลาด: ${errors.slice(0, 3).join('; ')}`;
  return msg;
}

/** อัปเดตเฉพาะสถานะออนไลน์ (เบากว่า full roster) */
export async function syncOnlineStatus(): Promise<string> {
  requireCredentials();
  const { pages, tokens } = await loadPagesWithTokens();
  if (!pages.length) return 'ยังไม่มีเพจ';
  const { data: existing } = await supabase.from('admins').select('*');
  if (!existing || !existing.length) return syncAdminsRoster();

  const online: Record<string, boolean> = {};
  let checked = 0;
  const failedPages: string[] = [];
  for (const p of pages) {
    try {
      const res = await pageUsers(String(p.page_id), tokens[String(p.page_id)]);
      res.users.forEach((u: any) => { if (u.is_online) online[String(u.id)] = true; });
      checked++;
    } catch { failedPages.push(String(p.name || p.page_id)); }
    await sleep(100);
  }
  if (!checked) return 'เช็คสถานะออนไลน์ไม่ได้สักเพจ';

  const now = new Date().toISOString();
  const changed = existing.filter((r: any) => {
    const want = !!online[String(r.user_id)];
    const cur = r.is_online === true;
    if (want === cur) return false;
    // ปิดออนไลน์ได้ต่อเมื่อเพจของคนนั้นไม่ได้อยู่ในกลุ่มที่ดึงพลาด (กันเพจล่มชั่วคราว)
    if (!want && failedPages.length) {
      const pagesStr = String(r.pages || '');
      for (const fp of failedPages) if (pagesStr.includes(fp)) return false;
    }
    return true;
  }).map((r: any) => ({ ...r, is_online: !!online[String(r.user_id)], updated_at: now }));

  if (changed.length) await upsertRows('admins', changed, 'user_id');
  let msg = `online status: เปลี่ยน ${changed.length} คน (${Object.keys(online).length} ออนไลน์)`;
  msg += await logOnlineChanges(changed.map((r: any) => ({ user_id: r.user_id, is_online: r.is_online })));
  if (failedPages.length) msg += ` | ดึงพลาด ${failedPages.length} เพจ`;
  return msg;
}

/* ---------------- ADMIN CHAT DAILY ---------------- */

export async function syncAdminChatForDate(dateStr: string): Promise<string> {
  const { pages, tokens } = await loadPagesWithTokens();
  const from = parsePancakeTime(`${dateStr}T00:00:00`)!;
  const to = parsePancakeTime(`${dateStr}T23:59:59`)!;
  const rows: any[] = [];
  const errors: string[] = [];
  for (const p of pages) {
    try {
      const data = await pageUserStats(String(p.page_id), tokens[String(p.page_id)], from, to);
      const totals = data.users || {};
      for (const uid of Object.keys(totals)) {
        const u = totals[uid] || {};
        rows.push({
          key: `${dateStr}|${p.page_id}|${uid}`,
          date: dateStr, page_id: String(p.page_id), page_name: p.name,
          user_id: String(uid), user_name: u.user_name || '',
          inbox_count: num(u.inbox_count), comment_count: num(u.comment_count),
          unique_inbox_count: num(u.unique_inbox_count), private_reply_count: num(u.private_reply_count),
          phone_number_count: num(u.phone_number_count), avg_response_ms: num(u.average_response_time),
          updated_at: new Date().toISOString(),
        });
      }
    } catch (e: any) { errors.push(`${p.name}: ${e.message}`); }
    await sleep(150);
  }
  if (rows.length) await upsertRows('admin_chat_daily', rows, 'key');
  let msg = `admin chat ${dateStr}: ${rows.length} แถว`;
  if (errors.length) msg += ` | ผิดพลาด ${errors.length} เพจ`;
  return msg;
}

export const syncAdminChatToday = () => syncAdminChatForDate(fmtDateBkk(new Date()));

export async function syncAdminChatBackfill(days = 7): Promise<string> {
  const msgs: string[] = [];
  for (let i = days; i >= 1; i--) msgs.push(await syncAdminChatForDate(fmtDateBkk(daysAgo(i))));
  return msgs.join(' | ');
}

/* ---------------- DAILY: catch-up + prune ---------------- */

export const syncChatYesterday = () => syncChatStats(daysAgo(1), startOfDayBkk(new Date()));

async function deleteOlder(table: string, col: string, cutoff: string): Promise<number> {
  const { count, error } = await supabase.from(table).delete({ count: 'exact' }).lt(col, cutoff);
  if (error) throw new Error(`prune ${table}: ${error.message}`);
  return count || 0;
}

export async function prune(): Promise<string> {
  const cutIso = (d: number) => daysAgo(d).toISOString();
  const cutDate = (d: number) => fmtDateBkk(daysAgo(d));
  let removed = 0;
  removed += await deleteOlder('orders', 'inserted_at', cutIso(RETENTION_DAYS.ORDERS));
  removed += await deleteOlder('chat_hourly', 'date', cutDate(RETENTION_DAYS.CHAT_HOURLY));
  removed += await deleteOlder('conversations', 'updated_at', cutIso(RETENTION_DAYS.CONVERSATIONS));
  removed += await deleteOlder('admin_chat_daily', 'date', cutDate(RETENTION_DAYS.ADMIN_CHAT_DAILY));
  // ตารางใหม่ อาจยังไม่ถูกสร้าง — ข้ามได้โดยไม่ให้งาน prune ทั้งก้อนล้ม
  try {
    removed += await deleteOlder('admin_online_log', 'changed_at', cutIso(RETENTION_DAYS.ADMIN_ONLINE_LOG));
  } catch { /* ยังไม่มีตาราง admin_online_log */ }
  try {
    removed += await deleteOlder('ad_daily', 'date', cutDate(RETENTION_DAYS.AD_DAILY));
  } catch { /* ยังไม่มีตาราง ad_daily */ }
  try {
    removed += await deleteOlder('chat_engagement_daily', 'date', cutDate(RETENTION_DAYS.CHAT_ENGAGEMENT));
  } catch { /* ยังไม่มีตาราง chat_engagement_daily */ }
  return `ลบข้อมูลเก่า ${removed} แถว`;
}
