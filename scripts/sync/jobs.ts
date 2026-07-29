// scripts/sync/jobs.ts — งาน sync ทั้งหมด (port จาก Sync*.gs + Setup.gs trigger entry points)
import {
  requireCredentials, daysAgo, startOfDayBkk, fmtDateBkk, parsePancakeTime, num, sleep, RETENTION_DAYS,
} from '../../lib/config';
import {
  posFetchOrders, posFetchUsers, posFetchAds, posFetchCampaigns,
  pageChatStats, pageConversations, pageUserStats, pageUsers, pageAdStats, pageCustomerEngagements,
  pagesListPages, pagesGenerateToken,
} from '../../lib/pancake';
import { mapOrder, mapChatHour, mapConversation, mapAd, mapAdDaily, mapEngagementDaily } from '../../lib/mappers';
import {
  metaListAdAccounts, metaAccountAdInsights, metaAccountAdCreatives, metaAdCreativesByIds, metaPool,
} from '../../lib/meta';
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

/* ---------------- PAGES ---------------- */

/**
 * ค้นเพจทั้งหมดจาก Pancake → upsert ตาราง `pages` + ออก page_access_token ให้เพจที่ยังไม่มี
 *
 * ⚠️ เดิมงานนี้อยู่แค่ใน scripts/setup/discover-pages.ts ที่ "รันมือครั้งเดียวตอน setup"
 * เพจที่เปิดใหม่หลังจากนั้นจึงไม่เคยเข้าตาราง pages เลย → ออเดอร์ของเพจพวกนั้นไม่มีชื่อ ไม่มียูนิต
 * และไม่ถูกดึงสถิติแชท (ตรวจ 2026-07-29 พบ 12 page_id มียอดขายจริงรวม ~฿134k/90 วัน แต่ไม่มีในตาราง)
 * จึงย้ายมาเป็นงานรายวัน — ทีมเปิดเพจใหม่แล้วระบบเห็นเองภายใน 1 วัน ไม่ต้องเรียกให้ใครรันมือ
 *
 * ไม่แตะคอลัมน์ในโพสต์อื่น (เช่น in_pos_shop) — upsert ของ PostgREST อัปเดตเฉพาะคอลัมน์ที่ส่งไป
 */
export async function syncPages(): Promise<string> {
  requireCredentials();
  const pages = await pagesListPages();
  if (!pages.length) throw new Error('ไม่พบเพจเลย — เช็คว่า PANCAKE_ACCESS_TOKEN ยังไม่หมดอายุ (~90 วัน)');

  const { data: existTok } = await supabase.from('page_tokens').select('page_id');
  const have = new Set((existTok || []).map((t: any) => String(t.page_id)));
  const { data: existPages } = await supabase.from('pages').select('page_id');
  const known = new Set((existPages || []).map((p: any) => String(p.page_id)));

  const rows = pages.map((p: any) => ({
    page_id: String(p.id),
    name: p.name || '',
    platform: String(p.platform || 'facebook').toLowerCase(),
    has_token: have.has(String(p.id)),
    updated_at: new Date().toISOString(),
  }));
  // pages ต้องมีก่อน page_tokens (FK อ้างอยู่)
  const { error: pErr } = await supabase.from('pages').upsert(rows, { onConflict: 'page_id' });
  if (pErr) throw new Error(`บันทึก pages ล้มเหลว: ${pErr.message}`);

  // ออก token ให้เฉพาะเพจใหม่ (เพจเก่ามี token อยู่แล้ว — ยิงซ้ำทุกวันเปลืองและเสี่ยงโดน rate limit)
  const fresh = pages.filter((p: any) => !have.has(String(p.id)));
  const tokRows: any[] = [];
  const fail: string[] = [];
  for (const p of fresh) {
    try {
      const tok = await pagesGenerateToken(String(p.id));
      tokRows.push({ page_id: String(p.id), token: tok, updated_at: new Date().toISOString() });
      await sleep(300);
    } catch { fail.push(p.name || String(p.id)); }
  }
  if (tokRows.length) {
    const { error: tErr } = await supabase.from('page_tokens').upsert(tokRows, { onConflict: 'page_id' });
    if (tErr) throw new Error(`บันทึก page_tokens ล้มเหลว: ${tErr.message}`);
    await supabase.from('pages').upsert(
      tokRows.map((t) => ({ page_id: t.page_id, has_token: true, updated_at: t.updated_at })),
      { onConflict: 'page_id' }
    );
  }
  const added = pages.filter((p: any) => !known.has(String(p.id))).length;
  return `pages: ${pages.length} เพจ (ใหม่ ${added}, ออก token ${tokRows.length}` +
    (fail.length ? `, ออกไม่ได้ ${fail.length}: ${fail.slice(0, 5).join(', ')}` : '') + ')';
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
 * "ยอดเรียลไทม์": เฉพาะออเดอร์ที่ขยับใน N นาทีล่าสุด — เบาพอให้ยิงได้ทุก 1 นาที
 *
 * ต่างจาก syncOrders ตรงที่ตัวนั้นกวาดย้อน 48 ชม. (สูงสุด 120 หน้า ~30 วิ) ซึ่งหนักเกินรอบ 1 นาที
 * ตัวนี้ทีมทำ ~2,800 ใบ/วัน = ~40 ใบ/20 นาที → 1 หน้าเกือบทุกครั้ง จบใน ~2-3 วิ
 *
 * หน้าต่างกว้าง 20 นาที (ไม่ใช่ 1 นาทีตามคาบ) เพื่อให้รอบที่พลาด/ดีเลย์ 19 ครั้งติดยังไม่เกิดรู
 * — ถึงพลาดยาวกว่านั้น รอบ fast ทุก 15 นาที (48 ชม.) ก็ยังตามเก็บให้อยู่ดี
 */
export async function syncOrdersDelta(minutes = 20): Promise<string> {
  requireCredentials();
  const since = new Date(Date.now() - Math.max(1, minutes) * 60 * 1000);
  const until = new Date(Date.now() + 60 * 1000);
  const raw = await posFetchOrders(since, until, 20);
  const map = await platformByPage();
  const rows = raw.map((o) => mapOrder(o, map));
  const n = await upsertRows('orders', rows, 'id');
  return `delta ${minutes} นาที: ${raw.length} รายการ (upsert ${n})`;
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
  const failed: string[] = [];
  for (let start = days; start > 0; start -= 2) {
    const since = daysAgo(start);
    const until = start - 2 <= 0 ? new Date(Date.now() + 3600 * 1000) : daysAgo(start - 2);
    const label = since.toISOString().slice(0, 10);

    // เน็ตสะดุดครั้งเดียว (fetch failed) ไม่ควรทิ้งงานที่ทำมาแล้ว 10-20 นาที — ลองซ้ำ 3 ครั้ง
    // ถอยเวลาเพิ่มขึ้นเรื่อยๆ แล้วค่อยข้ามไป slice ถัดไป (เก็บชื่อไว้ฟ้องตอนจบ ไม่เงียบ)
    let raw: any[] | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { raw = await posFetchOrders(since, until, 120); break; }
      catch (e: any) {
        if (attempt === 3) { failed.push(label); break; }
        await sleep(attempt * 10000);
      }
    }
    if (!raw) continue;

    if (raw.length >= 12000) {
      // ชนเพดาน = มีข้อมูลถูกตัดแน่นอน — ฟ้องดังๆ ดีกว่าเงียบ
      throw new Error(`backfill slice ${label} ชนเพดาน 12,000 ออเดอร์ — ลด slice ให้เล็กลง`);
    }
    const rows = raw.map((o) => mapOrder(o, map));
    await upsertRows('orders', rows, 'id');
    count += raw.length;
  }
  if (failed.length) {
    throw new Error(`backfill ออเดอร์ ${days} วัน: ได้ ${count} รายการ แต่ ${failed.length} ช่วงล้มเหลว ` +
      `(${failed.join(', ')}) — รันซ้ำเฉพาะช่วงนั้น ข้อมูลยังไม่ครบ`);
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
 * แหล่ง: pages /statistics/ads?type=by_id — ตัวเดียวของ Pancake ที่ให้ spend
 * (POS /ads_manager/ads_v2 คืน 0 แถวเสมอ ตาราง `ads` เดิมจึงว่างมาตลอด)
 *
 * รอบจริง: ชั่วโมงละครั้ง (runHourly) — วนทุกเพจ 130+ เพจ × sleep 80ms ช้าเกินรอบ 15 นาที
 * หน้าที่หลักคือเติม page_id / ชื่อแอด / สถานะ ให้ ad_daily ส่วน spend ที่แม่นยำมาจาก
 * syncMetaAds* (Meta Marketing API) ซึ่งรันทุก 15 นาทีและทับค่า spend ทีหลัง
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

/* ---------------- META ADS (ค่าแอด "จริง" จาก Meta Marketing API) ---------------- */

/** ยิงกี่บัญชีพร้อมกัน — 125 บัญชีแบบทีละตัวใช้ ~3.5 นาที ซึ่งดันรอบ fast (15 นาที) จนเกือบชน */
const META_POOL = 4;

/**
 * ดึง spend/impressions/clicks/purchases/value ระดับแอด จาก Meta ของ "ทุกบัญชีที่ยิงจริง"
 * แล้วทับลง ad_daily (merge — คงค่า page_id/name ที่ Pancake ใส่) → ค่าแอดตรงจอ Meta เป๊ะ
 * ต้องรัน "หลัง" syncAdStats (Pancake) ในรอบเดียวกัน เพื่อให้ค่า Meta ทับค่า Pancake
 */
export async function syncMetaAdsRange(since: string, until: string): Promise<string> {
  const token = process.env.META_ACCESS_TOKEN || '';
  if (!token) return 'ข้าม: ยังไม่ได้ตั้ง META_ACCESS_TOKEN';
  const accounts = await metaListAdAccounts();
  const active = accounts.filter((a) => a.account_status === 1);
  const rows: any[] = [];
  const errors: string[] = [];
  let spend = 0;
  const now = new Date().toISOString();
  await metaPool(active, META_POOL, async (acc) => {
    try {
      const ins = await metaAccountAdInsights(acc.account_id, since, until);
      for (const it of ins) {
        if (!it.ad_id || !it.date) continue;
        rows.push({
          date: it.date, ad_id: it.ad_id, account_id: acc.account_id,
          spend: it.spend, impressions: it.impressions, clicks: it.clicks, reach: it.reach,
          meta_purchases: it.purchases, meta_purchase_value: it.purchase_value,
          updated_at: now,
        });
        spend += it.spend;
      }
    } catch (e: any) { errors.push(`${acc.account_id}: ${e.message}`); }
    await sleep(120);
  });
  if (rows.length) await upsertRows('ad_daily', rows, 'date,ad_id');
  const range = since === until ? since : `${since}..${until}`;
  let msg = `meta ads ${range}: ${rows.length} แถว จาก ${active.length}/${accounts.length} บัญชี | spend ฿${spend.toFixed(2)}`;
  if (errors.length) msg += ` | ผิดพลาด ${errors.length} บัญชี: ${errors.slice(0, 2).join('; ')}`;
  return msg;
}

export const syncMetaAdsForDate = (dateStr: string) => syncMetaAdsRange(dateStr, dateStr);
export const syncMetaAdsToday = () => syncMetaAdsForDate(fmtDateBkk(new Date()));
export const syncMetaAdsYesterday = () => syncMetaAdsForDate(fmtDateBkk(daysAgo(1)));

/* ---------------- AD CREATIVE (รูป/คลิป/ลิงก์โพสต์ของแอด) ---------------- */

/** เพดานต่อรอบ — กันวันที่มีแอดใหม่พรวดเดียวเป็นหมื่นแล้วงาน daily ค้างยาว (ที่เหลือไปรอบหน้า) */
const CREATIVE_CAP = 4000;

/**
 * ad_id ไม่ซ้ำที่มีใน ad_daily ตั้งแต่ N วันก่อน (วนเอง — PostgREST คืนสูงสุด 1000 แถว/ครั้ง)
 * ต้อง order ด้วย (ad_id, date) = pk เต็ม — เรียงด้วย ad_id เฉยๆ ไม่ unique แล้วแถวจะข้ามเงียบๆ ตอนแบ่งหน้า
 */
async function adIdsFromDaily_(days: number): Promise<string[]> {
  const from = fmtDateBkk(daysAgo(Math.max(0, days - 1)));
  const set: Record<string, 1> = {};
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.from('ad_daily').select('ad_id,date')
      .gte('date', from)
      .order('ad_id', { ascending: true }).order('date', { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error(`อ่าน ad_daily ไม่ได้: ${error.message}`);
    const batch = data || [];
    batch.forEach((r: any) => { const id = String(r.ad_id || ''); if (id) set[id] = 1; });
    if (batch.length < 1000) break;
    offset += 1000;
  }
  return Object.keys(set);
}

/** ad_id ที่มีครีเอทีฟแล้ว — null = ยังไม่ได้สร้างตาราง (ให้ job ข้ามแบบไม่ล้ม) */
async function existingCreativeIds_(): Promise<Record<string, 1> | null> {
  const have: Record<string, 1> = {};
  let offset = 0;
  for (;;) {
    // ad_id เป็น pk อยู่แล้ว → order ตัวเดียวก็ unique พอสำหรับแบ่งหน้า
    const { data, error } = await supabase.from('ad_creative').select('ad_id')
      .order('ad_id', { ascending: true }).range(offset, offset + 999);
    if (error) {
      const m = String(error.message || '');
      // ยังไม่ได้รัน migration → ข้ามแบบไม่ล้ม; error อื่น (เน็ต/สิทธิ์) ต้องฟ้อง ไม่ใช่กลืน
      if (m.includes('ad_creative') || m.includes('schema cache')) return null;
      throw new Error(`อ่าน ad_creative ไม่ได้: ${error.message}`);
    }
    const batch = data || [];
    batch.forEach((r: any) => { have[String(r.ad_id)] = 1; });
    if (batch.length < 1000) break;
    offset += 1000;
  }
  return have;
}

/**
 * เติมครีเอทีฟของแอดที่เรามีใน ad_daily แต่ยังไม่มีใน ad_creative
 *
 * ครีเอทีฟไม่เปลี่ยนรายวัน → รันวันละครั้งพอ และดึงเฉพาะ "ตัวที่ยังไม่มี" (รอบแรกหนัก รอบต่อไปแทบว่าง)
 * แอดที่ Meta ปฏิเสธ (ถูกลบ / token ไม่มีสิทธิ์) เขียนแถวเปล่าไว้กันวนถามซ้ำทุกวัน —
 * อยากลองใหม่ให้รัน `npm run backfill:ad-creatives <วัน> force`
 */
export async function syncAdCreatives(days = 14, refresh = false): Promise<string> {
  const token = process.env.META_ACCESS_TOKEN || '';
  if (!token) return 'ข้าม: ยังไม่ได้ตั้ง META_ACCESS_TOKEN';
  const have = await existingCreativeIds_();
  if (!have) return 'ข้าม: ยังไม่มีตาราง ad_creative (รัน db/migrations/2026-07-27-ad-creative.sql ก่อน)';

  const ids = await adIdsFromDaily_(days);
  const want = refresh ? ids : ids.filter((id) => !have[id]);
  if (!want.length) return `ad creatives: ครบแล้ว (${ids.length} แอดใน ${days} วันล่าสุด)`;
  const capped = want.slice(0, CREATIVE_CAP);

  const now = new Date().toISOString();
  const { rows, missing } = await metaAdCreativesByIds(capped);
  const payload: any[] = rows.map((r) => ({ ...r, updated_at: now }));
  // แถวเปล่าของแอดที่ดึงไม่ได้ — มีไว้เป็น "เครื่องหมายว่าเคยลองแล้ว" ไม่ให้รอบหน้าถามซ้ำ
  missing.forEach((id) => payload.push({
    ad_id: id, account_id: '', name: '', thumb_url: '', image_url: '', video_id: '',
    object_type: '', post_id: '', permalink: '', ig_permalink: '', cta: '', link_url: '',
    updated_at: now,
  }));
  const n = await upsertRows('ad_creative', payload, 'ad_id');

  const withMedia = rows.filter((r) => r.image_url || r.thumb_url).length;
  const withPost = rows.filter((r) => r.permalink || r.ig_permalink).length;
  let msg = `ad creatives: ขอ ${capped.length} แอด → ได้ ${rows.length} (upsert ${n}) | ` +
    `มีรูป ${withMedia} | มีลิงก์โพสต์ ${withPost}`;
  if (missing.length) msg += ` | ดึงไม่ได้ ${missing.length}`;
  if (want.length > capped.length) msg += ` | เหลือ ${want.length - capped.length} ไว้รอบหน้า`;
  return msg;
}

/**
 * กวาดครีเอทีฟของ "ทุกแอดในทุกบัญชี" ผ่าน /act_{id}/ads (ไม่อิง ad_daily)
 * ใช้กับ backfill ครั้งแรกเมื่ออยากได้ครบจริงๆ — ช้ากว่าแบบ by-id มาก (25k+ แอด)
 */
export async function syncAdCreativesAllAccounts(): Promise<string> {
  const token = process.env.META_ACCESS_TOKEN || '';
  if (!token) return 'ข้าม: ยังไม่ได้ตั้ง META_ACCESS_TOKEN';
  const accounts = await metaListAdAccounts();
  const active = accounts.filter((a) => a.account_status === 1);
  const now = new Date().toISOString();
  const errors: string[] = [];
  let total = 0;
  await metaPool(active, META_POOL, async (acc) => {
    try {
      const rows = await metaAccountAdCreatives(acc.account_id);
      if (rows.length) {
        await upsertRows('ad_creative', rows.map((r) => ({ ...r, updated_at: now })), 'ad_id');
        total += rows.length;
      }
    } catch (e: any) { errors.push(`${acc.account_id}: ${e.message}`); }
  });
  let msg = `ad creatives (ทุกบัญชี): ${total} แอด จาก ${active.length} บัญชี`;
  if (errors.length) msg += ` | ผิดพลาด ${errors.length} บัญชี: ${errors.slice(0, 2).join('; ')}`;
  return msg;
}

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
