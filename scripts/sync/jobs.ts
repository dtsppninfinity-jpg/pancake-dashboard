// scripts/sync/jobs.ts — งาน sync ทั้งหมด (port จาก Sync*.gs + Setup.gs trigger entry points)
import {
  requireCredentials, daysAgo, startOfDayBkk, fmtDateBkk, parsePancakeTime, num, sleep, RETENTION_DAYS,
} from '../../lib/config';
import {
  posFetchOrders, posFetchUsers, posFetchAds, posFetchCampaigns,
  pageChatStats, pageConversations, pageUserStats, pageUsers,
} from '../../lib/pancake';
import { mapOrder, mapChatHour, mapConversation, mapAd } from '../../lib/mappers';
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
  const raw = await posFetchOrders(since, until, 30);
  const map = await platformByPage();
  const rows = raw.map((o) => mapOrder(o, map));
  const n = await upsertRows('orders', rows, 'id');
  return `orders: ${raw.length} รายการ (upsert ${n})`;
}

/** Backfill ออเดอร์ย้อนหลัง (GitHub Actions ไม่มีลิมิต 6 นาที → ทำรวดเดียวได้เลย) */
export async function syncOrdersBackfill(days = 30): Promise<string> {
  requireCredentials();
  const map = await platformByPage();
  let count = 0;
  for (let start = days; start > 0; start -= 7) {
    const since = daysAgo(start);
    const until = start - 7 <= 0 ? new Date(Date.now() + 3600 * 1000) : daysAgo(start - 7);
    const raw = await posFetchOrders(since, until, 50);
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

/* ---------------- ADS ---------------- */

export async function syncAds(): Promise<string> {
  requireCredentials();
  const campaigns: Record<string, string> = {};
  try {
    (await posFetchCampaigns(5)).forEach((c: any) => { campaigns[String(c.id)] = c.name || ''; });
  } catch { /* ไม่มีชื่อแคมเปญก็ใช้ id แทนได้ */ }
  const ads = await posFetchAds(10);
  const rows = ads.map((a) => mapAd(a, campaigns));
  await replaceTable('ads', rows, 'ad_id');
  return `ads: ${rows.length} แอด`;
}

/* ---------------- ADMINS (roster + online) ---------------- */

export async function syncAdminsRoster(): Promise<string> {
  requireCredentials();
  const { pages, tokens } = await loadPagesWithTokens();
  const byUser: Record<string, any> = {};
  const errors: string[] = [];
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
    } catch (e: any) { errors.push(`${p.name}: ${e.message}`); }
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
  await replaceTable('admins', rows, 'user_id');
  let msg = `admins: ${rows.length} คน`;
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
  return `ลบข้อมูลเก่า ${removed} แถว`;
}
