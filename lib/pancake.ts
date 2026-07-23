// lib/pancake.ts — HTTP client สำหรับ Pancake POS API + Pages API (port จาก PancakeApi.gs)
// ใช้ global fetch ของ Node 18+ (เครื่องคุณ Node 24 มีให้อยู่แล้ว)
import { cfg, unixSec, pagesDateRange } from './config';

const POS_BASE = 'https://pos.pages.fm/api/v1';
const PAGES_BASE = 'https://pages.fm/api/v1';
const PUBLIC_V1 = 'https://pages.fm/api/public_api/v1';
const PUBLIC_V2 = 'https://pages.fm/api/public_api/v2';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Params = Record<string, string | number | undefined | null>;

function qs(params: Params): string {
  const parts: string[] = [];
  for (const k of Object.keys(params || {})) {
    const v = params[k];
    if (v === undefined || v === null || v === '') continue;
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
  }
  return parts.length ? '?' + parts.join('&') : '';
}

/** ตัด token ออกจาก URL ก่อนใส่ error message */
function safeUrl(url: string): string {
  return url.replace(/(api_key|access_token|page_access_token)=[^&]+/g, '$1=***');
}

/**
 * fetch พร้อม retry: 429/5xx → รอแล้วลองใหม่สูงสุด 3 ครั้ง
 * Pancake ตอบ 200 พร้อม {success:false} เมื่อ token/สิทธิ์มีปัญหา — นับเป็น error
 */
export async function fetchJson(url: string, options: RequestInit = {}): Promise<any> {
  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(1500 * attempt);
    let resp: Response;
    try {
      resp = await fetch(url, options);
    } catch (e: any) {
      lastErr = e?.message || String(e);
      continue;
    }
    const code = resp.status;
    const body = await resp.text();
    if (code === 429 || code >= 500) { lastErr = 'HTTP ' + code; continue; }
    if (code >= 400) throw new Error(`HTTP ${code} — ${body.slice(0, 300)} — ${safeUrl(url)}`);
    let parsed: any;
    try { parsed = JSON.parse(body); }
    catch { throw new Error('ตอบกลับไม่ใช่ JSON: ' + body.slice(0, 200)); }
    if (parsed && typeof parsed === 'object' && parsed.success === false) {
      throw new Error('API แจ้งไม่สำเร็จ: ' +
        String(parsed.message || parsed.error || body.slice(0, 200)) + ' — ' + safeUrl(url));
    }
    return parsed;
  }
  throw new Error('เรียก API ไม่สำเร็จหลัง retry: ' + lastErr + ' — ' + safeUrl(url));
}

/* ---------------- POS API ---------------- */

function posGet(path: string, params: Params = {}): Promise<any> {
  const p: Params = { ...params, api_key: cfg.posApiKey };
  return fetchJson(`${POS_BASE}/shops/${cfg.posShopId}${path}${qs(p)}`);
}

/**
 * ดึงออเดอร์ทีละหน้า (เรียงตาม updated_at) ในช่วงเวลา
 * ⚠️ ห้ามให้เพดานเงียบ: ถ้า total_pages เกิน maxPages แปลว่าข้อมูลถูกตัดทิ้งแน่นอน
 *    ต้อง throw ให้ sync_log ขึ้นแดง ดีกว่าปล่อยให้ยอดขายขาดหายแบบไม่มีใครรู้
 *    (เคยเกิดมาแล้ว: ออเดอร์ 1-4 ก.ค. 2026 หายทั้ง 4 วัน ~10,000 ใบ เพราะเพดานเงียบแบบนี้)
 */
export async function posFetchOrders(since: Date, until: Date, maxPages = 120): Promise<any[]> {
  const all: any[] = [];
  let totalPages = 1;
  for (let page = 1; page <= totalPages && page <= maxPages; page++) {
    const res = await posGet('/orders', {
      updateStatus: 'updated_at',
      startDateTime: unixSec(since),
      endDateTime: unixSec(until),
      page_number: page,
      page_size: 100,
    });
    const data = res?.data ?? [];
    all.push(...data);
    totalPages = res?.total_pages ?? 1;
    if (!data.length) break;
    await sleep(250);
  }
  if (totalPages > maxPages) {
    throw new Error(
      `posFetchOrders ชนเพดาน: มี ${totalPages} หน้า แต่ดึงได้แค่ ${maxPages} หน้า ` +
      `(${since.toISOString()} → ${until.toISOString()}) — ข้อมูลขาดแน่นอน ต้องลดช่วงเวลาหรือเพิ่มเพดาน`
    );
  }
  return all;
}

export async function posFetchUsers(): Promise<any[]> {
  const res = await posGet('/users', { page_size: 200 });
  return res?.data ?? [];
}

const ADS_SELECT_FIELDS = [
  'spend', 'impressions', 'reach', 'clicks', 'ctr', 'cpm',
  'onsite_conversion_messaging_conversation_started_7d',
  'cost_per_messaging_conversation_started',
  'order_created', 'order_shipped',
].join(',');

export async function posFetchAds(maxPages = 10): Promise<any[]> {
  const all: any[] = [];
  let totalPages = 1;
  for (let page = 1; page <= totalPages && page <= maxPages; page++) {
    const res = await posGet('/ads_manager/ads_v2', { page, page_size: 50, select_fields: ADS_SELECT_FIELDS });
    const data = res?.data ?? [];
    all.push(...data);
    totalPages = res?.total_pages ?? 1;
    if (!data.length) break;
    await sleep(250);
  }
  return all;
}

export async function posFetchCampaigns(maxPages = 5): Promise<any[]> {
  const all: any[] = [];
  let totalPages = 1;
  for (let page = 1; page <= totalPages && page <= maxPages; page++) {
    const res = await posGet('/ads_manager/campaigns_v2', { page, page_size: 50, select_fields: 'spend' });
    const data = res?.data ?? [];
    all.push(...data);
    totalPages = res?.total_pages ?? 1;
    if (!data.length) break;
    await sleep(250);
  }
  return all;
}

/* ---------------- Pages API (ระดับบัญชี — ใช้ access_token) ---------------- */

export async function pagesListPages(): Promise<any[]> {
  const res = await fetchJson(`${PAGES_BASE}/pages${qs({ access_token: cfg.accessToken })}`);
  if (res && Array.isArray(res.pages)) return res.pages;
  if (res?.categorized && Array.isArray(res.categorized.activated)) return res.categorized.activated;
  if (res?.data && Array.isArray(res.data)) return res.data;
  return [];
}

export async function pagesGenerateToken(pageId: string): Promise<string> {
  const url = `${PAGES_BASE}/pages/${pageId}/generate_page_access_token` +
    qs({ access_token: cfg.accessToken, page_id: pageId });
  const res = await fetchJson(url, { method: 'POST' });
  const pat = res?.page_access_token || res?.data?.page_access_token;
  if (!pat) throw new Error(`สร้าง page_access_token ของเพจ ${pageId} ไม่สำเร็จ: ${JSON.stringify(res).slice(0, 200)}`);
  return pat;
}

/* ---------------- Pages API (ระดับเพจ — ใช้ page_access_token) ---------------- */

function pagePublicGet(version: 1 | 2, pageId: string, token: string, path: string, params: Params = {}): Promise<any> {
  if (!token) throw new Error(`ไม่มี page_access_token ของเพจ ${pageId}`);
  const base = version === 2 ? PUBLIC_V2 : PUBLIC_V1;
  return fetchJson(`${base}/pages/${pageId}${path}${qs({ ...params, page_access_token: token })}`);
}

/** สถิติแชทของเพจรายชั่วโมง */
export async function pageChatStats(pageId: string, token: string, since: Date, until: Date): Promise<any[]> {
  const res = await pagePublicGet(1, pageId, token, '/statistics/pages', { since: unixSec(since), until: unixSec(until) });
  return res?.data ?? [];
}

/**
 * ค่าแอดของเพจ แยกรายแอด (spend/impressions/clicks/ctr/cpm/สถานะ)
 * นี่คือแหล่งค่าแอด "ที่ใช้ได้จริง" — POS /ads_manager/ads_v2 คืน 0 แถวเสมอ
 * spend เป็นบาทจริง (ทศนิยม) ไม่ใช่สตางค์เหมือน orders.total_price
 */
export async function pageAdStats(pageId: string, token: string, since: Date, until: Date): Promise<any[]> {
  const res = await pagePublicGet(1, pageId, token, '/statistics/ads', {
    type: 'by_id', since: unixSec(since), until: unixSec(until),
  });
  return res?.data ?? [];
}

/** บทสนทนาล่าสุด (v2, cursor pagination ทีละ 60) */
export async function pageConversations(pageId: string, token: string, since: Date, until: Date, maxBatches = 3): Promise<any[]> {
  const all: any[] = [];
  let lastId: string | null = null;
  for (let batch = 0; batch < maxBatches; batch++) {
    const params: Params = { since: unixSec(since), until: unixSec(until), order_by: 'updated_at' };
    if (lastId) params.last_conversation_id = lastId;
    const res = await pagePublicGet(2, pageId, token, '/conversations', params);
    const convs = res?.conversations ?? res?.data ?? [];
    if (!convs.length) break;
    all.push(...convs);
    if (convs.length < 60) break;
    lastId = convs[convs.length - 1].id;
    await sleep(250);
  }
  return all;
}

/** สถิติการตอบของแอดมินรายคน ในช่วง date_range (คืน {statistics, users}) */
export async function pageUserStats(pageId: string, token: string, from: Date, to: Date): Promise<any> {
  const res = await pagePublicGet(1, pageId, token, '/statistics/users', { date_range: pagesDateRange(from, to) });
  return res?.data ?? {};
}

/** รายชื่อแอดมินของเพจ + สถานะออนไลน์ + สิทธิ์ */
export async function pageUsers(pageId: string, token: string): Promise<{ users: any[]; disabled: any[] }> {
  const res = await pagePublicGet(1, pageId, token, '/users', {});
  return {
    users: res?.users ?? res?.data?.users ?? [],
    disabled: res?.disabled_users ?? [],
  };
}
