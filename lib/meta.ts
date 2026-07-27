// lib/meta.ts — Meta (Facebook) Marketing API client สำหรับดึงค่าแอด "จริง" จาก Meta โดยตรง
//
// ทำไม: ค่าแอดเดิมดึงจาก Pancake /statistics/ads ซึ่งไม่ครบทุกบัญชี (ต่ำกว่าจอ Meta จริง ~7%)
// Meta Marketing API insights ให้ spend/impressions/clicks/purchases/value ที่ตรงหน้า Meta Ads
// dashboard เป๊ะ. token อยู่ใน env META_ACCESS_TOKEN (USER token, scope ads_read/ads_management)
//
// เก็บลง ad_daily โดย "ทับเฉพาะ spend + เลข Meta" คงค่า page_id/name ที่ Pancake ใส่ไว้ (upsert
// merge — คอลัมน์ที่ไม่ส่งจะไม่ถูกแตะ) → หน้า Sales/Content&Ads ได้ค่าแอดจริงโดยไม่ต้องแก้ read

import { sleep } from './config';

const V = 'v21.0';
const BASE = `https://graph.facebook.com/${V}`;

function metaToken(): string {
  return process.env.META_ACCESS_TOKEN || '';
}

/** GET Graph API + retry เมื่อโดน rate-limit (code 4/17/32/613/80000-80004) */
async function metaGet(path: string, params: Record<string, string>, tries = 3): Promise<any> {
  const qs = new URLSearchParams({ access_token: metaToken(), ...params }).toString();
  let lastErr = '';
  for (let i = 0; i < tries; i++) {
    let j: any;
    try {
      const res = await fetch(`${BASE}/${path}?${qs}`);
      j = await res.json();
    } catch (e: any) { lastErr = e.message; await sleep(2000 * (i + 1)); continue; }
    if (j && j.error) {
      const code = Number(j.error.code);
      const rateLimited = [4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004].indexOf(code) >= 0;
      if (rateLimited && i < tries - 1) { await sleep(5000 * (i + 1)); continue; }
      throw new Error(`meta ${code}: ${j.error.message}`);
    }
    return j;
  }
  throw new Error(lastErr || 'meta fetch ล้มเหลว');
}

/**
 * รันงานพร้อมกันทีละ n ตัว (worker pool) — คงลำดับผลลัพธ์เท่ากับลำดับ input
 * ทำไม: ยิงทีละบัญชี (125 บัญชี × ~1.5 วิ) = ~3 นาที ซึ่งดันรอบ sync 15 นาทีจนเกือบชน
 */
export async function metaPool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  };
  const size = Math.max(1, Math.min(n, items.length));
  await Promise.all(Array.from({ length: size }, worker));
  return out;
}

export interface MetaAccount { account_id: string; name: string; account_status: number; }

/** ทุกบัญชีโฆษณาที่ token เข้าถึง (paginate) */
export async function metaListAdAccounts(): Promise<MetaAccount[]> {
  const out: MetaAccount[] = [];
  let after: string | undefined;
  do {
    const p: Record<string, string> = { fields: 'account_id,name,account_status', limit: '200' };
    if (after) p.after = after;
    const r = await metaGet('me/adaccounts', p);
    (r.data || []).forEach((a: any) => out.push({
      account_id: String(a.account_id), name: String(a.name || ''), account_status: Number(a.account_status),
    }));
    after = (r.paging && r.paging.next && r.paging.cursors) ? r.paging.cursors.after : undefined;
    await sleep(60);
  } while (after);
  return out;
}

export interface MetaAdInsight {
  date: string; ad_id: string; ad_name: string; spend: number; impressions: number; clicks: number;
  reach: number; purchases: number; purchase_value: number; msgs: number;
}

function sumActions(arr: any[], re: RegExp): number {
  let s = 0;
  (arr || []).forEach((a: any) => { if (re.test(String(a.action_type))) s += Number(a.value) || 0; });
  return s;
}

// omni_purchase = ยอด "ซื้อ" ที่ Meta ตัดซ้ำแล้ว (ตรงตัวเลขบนจอ) — ใช้ตัวนี้ตัวเดียว ไม่รวม pixel/onsite ซ้ำ
const PURCHASE_RE = /^omni_purchase$/;
const MSG_RE = /messaging_conversation_started/;

/**
 * insights ระดับ "แอด" ของ 1 บัญชี ในช่วง since..until — แตกเป็นรายวัน (time_increment=1)
 * ช่วง 1 วัน → since=until=วันนั้น (ได้ 1 แถว/แอด). ช่วงยาว (backfill) → 1 คอลได้ทุกวันในช่วง
 */
export async function metaAccountAdInsights(accountId: string, since: string, until: string): Promise<MetaAdInsight[]> {
  const out: MetaAdInsight[] = [];
  let after: string | undefined;
  do {
    const p: Record<string, string> = {
      time_range: JSON.stringify({ since, until }),
      time_increment: '1',
      level: 'ad',
      fields: 'ad_id,ad_name,spend,impressions,clicks,reach,actions,action_values',
      limit: '500',
    };
    if (after) p.after = after;
    const r = await metaGet(`act_${accountId}/insights`, p);
    (r.data || []).forEach((row: any) => {
      out.push({
        date: String(row.date_start || since),
        ad_id: String(row.ad_id || ''),
        ad_name: String(row.ad_name || ''),
        spend: Number(row.spend) || 0,
        impressions: Number(row.impressions) || 0,
        clicks: Number(row.clicks) || 0,
        reach: Number(row.reach) || 0,
        purchases: sumActions(row.actions, PURCHASE_RE),
        purchase_value: sumActions(row.action_values, PURCHASE_RE),
        msgs: sumActions(row.actions, MSG_RE),
      });
    });
    after = (r.paging && r.paging.next && r.paging.cursors) ? r.paging.cursors.after : undefined;
    await sleep(60);
  } while (after);
  return out;
}

/* ---------------- ครีเอทีฟของแอด (รูป / คลิป / ลิงก์โพสต์จริง) ---------------- */

/**
 * ⚠️ insights (ข้างบน) คืนครีเอทีฟไม่ได้ไม่ว่าใส่ field อะไร — ต้องอ่านจาก node Ad
 * ใช้ `creative` (เอกพจน์ บน Ad) ไม่ใช่ edge `adcreatives` ที่ไม่คืน ad_id มาด้วย (join กลับไม่ได้)
 *
 * thumbnail_url ถ้าไม่ระบุขนาด Meta คืน 64x64 (1.9KB — เอามาโชว์ไม่ได้)
 * ต้องส่งเป็น "field param" บน node creative แบบ .thumbnail_width(600) — ใส่เป็น query param
 * เฉยๆ ไม่มีผล (ยิงจริงเทียบแล้ว: 64x64/1.9KB → 600x600/47KB)
 */
const THUMB_PX = 600;

// object_story_spec / asset_feed_spec ต้องเจาะ sub-field เอง — ขอทั้งก้อนจะได้ page_welcome_message
// ก้อนใหญ่มากจน Meta ตอบ error #1 "Please reduce the amount of data you're asking for"
const CREATIVE_FIELDS =
  `creative.thumbnail_width(${THUMB_PX}).thumbnail_height(${THUMB_PX})` +
  '{id,name,object_type,thumbnail_url,image_url,video_id,object_story_id,effective_object_story_id,' +
  'instagram_permalink_url,link_url,call_to_action_type,' +
  'object_story_spec{page_id,link_data{picture,link,call_to_action},video_data{video_id,image_url,call_to_action}},' +
  'asset_feed_spec{images,videos,link_urls,call_to_action_types}}';

const AD_FIELDS = `id,name,account_id,effective_status,${CREATIVE_FIELDS}`;

export interface MetaAdCreative {
  ad_id: string; account_id: string; name: string;
  thumb_url: string; image_url: string; video_id: string; object_type: string;
  post_id: string; permalink: string; ig_permalink: string;
  cta: string; link_url: string;
}

/** ค่าแรกที่ไม่ว่าง (แปลงเป็น string ให้แล้ว) */
function firstStr_(...vals: any[]): string {
  for (const v of vals) {
    const s = v === null || v === undefined ? '' : String(v);
    if (s) return s;
  }
  return '';
}

/** node Ad (พร้อม creative) → แถว ad_creative — คืน null ถ้าไม่มี id */
function creativeFromAd_(ad: any, fallbackAccountId = ''): MetaAdCreative | null {
  const adId = String((ad && ad.id) || '');
  if (!adId) return null;
  const c = (ad && ad.creative) || {};
  const oss = c.object_story_spec || {};
  const link = oss.link_data || {};
  const vid = oss.video_data || {};
  const afs = c.asset_feed_spec || {};
  const afsImg = (afs.images && afs.images[0]) || {};
  const afsVid = (afs.videos && afs.videos[0]) || {};
  const afsLink = (afs.link_urls && afs.link_urls[0]) || {};
  // รูปคมสุดตามลำดับ — thumbnail_url เก็บแยก (เป็นตัวสำรองสุดท้าย: เล็กกว่า + URL หมดอายุเร็วกว่า)
  const image = firstStr_(c.image_url, link.picture, vid.image_url, afsImg.url, afsVid.thumbnail_url);
  // effective_object_story_id ครอบคลุม dark post (โพสต์ที่ไม่ขึ้นหน้าเพจ) — ใช้ก่อน object_story_id
  const postId = firstStr_(c.effective_object_story_id, c.object_story_id);
  return {
    ad_id: adId,
    account_id: String((ad && ad.account_id) || fallbackAccountId || ''),
    // ชื่อครีเอทีฟมักเป็นพาดหัว/ข้อความโพสต์ (สื่อความกว่าชื่อแอดที่ทีมตั้งว่า "VP4")
    name: firstStr_(c.name, ad && ad.name).slice(0, 300),
    thumb_url: String(c.thumbnail_url || ''),
    image_url: image,
    video_id: firstStr_(c.video_id, vid.video_id, afsVid.video_id),
    object_type: String(c.object_type || ''),
    post_id: postId,
    permalink: postId ? `https://www.facebook.com/${postId}` : '',
    ig_permalink: String(c.instagram_permalink_url || ''),
    cta: firstStr_(c.call_to_action_type, link.call_to_action && link.call_to_action.type,
      vid.call_to_action && vid.call_to_action.type, afs.call_to_action_types && afs.call_to_action_types[0]),
    link_url: firstStr_(c.link_url, link.link, afsLink.website_url),
  };
}

/**
 * ครีเอทีฟของ "ทุกแอด" ใน 1 บัญชี (paginate)
 * limit 50 ไม่ใช่ 200 — field ครีเอทีฟหนักมาก ขอ 200 แล้ว Meta ตอบ error #1 (ยิงจริงเจอมาแล้ว)
 */
export async function metaAccountAdCreatives(accountId: string): Promise<MetaAdCreative[]> {
  const out: MetaAdCreative[] = [];
  let after: string | undefined;
  do {
    const p: Record<string, string> = { fields: AD_FIELDS, limit: '50' };
    if (after) p.after = after;
    const r = await metaGet(`act_${accountId}/ads`, p);
    (r.data || []).forEach((ad: any) => {
      const row = creativeFromAd_(ad, accountId);
      if (row) out.push(row);
    });
    after = (r.paging && r.paging.next && r.paging.cursors) ? r.paging.cursors.after : undefined;
    await sleep(60);
  } while (after);
  return out;
}

/** ยิง /?ids=a,b,c ชุดเดียว — คืน null เมื่อ Meta ปฏิเสธทั้งก้อน (ให้ตัวเรียกไปแตกครึ่งเอง) */
async function creativesBatch_(ids: string[]): Promise<MetaAdCreative[] | null> {
  try {
    const r = await metaGet('', { ids: ids.join(','), fields: AD_FIELDS });
    const out: MetaAdCreative[] = [];
    Object.keys(r || {}).forEach((k) => {
      const row = creativeFromAd_(r[k]);
      if (row) out.push(row);
    });
    return out;
  } catch {
    return null;
  }
}

/**
 * ครีเอทีฟของ ad_id ที่ระบุ (batch ทีละ 50 ผ่าน /?ids=) — เติมเฉพาะแอดที่เรามีในตารางจริง
 * เร็วกว่ากวาดทุกบัญชีมาก (ad_daily สะสม ~28k ad_id แต่รอบหนึ่งเติมแค่ตัวใหม่)
 *
 * ⚠️ ถ้ามี ad_id สักตัวที่ token เข้าไม่ถึง/ถูกลบ Meta จะ error ทั้งก้อน → แตกครึ่งลงไปเรื่อยๆ
 * จนเหลือตัวเดียวแล้วค่อยข้ามเฉพาะตัวนั้น (missing) แทนที่จะทิ้งทั้ง 50 ตัว
 */
export async function metaAdCreativesByIds(
  adIds: string[], pool = 3
): Promise<{ rows: MetaAdCreative[]; missing: string[] }> {
  const CHUNK = 50;
  const chunks: string[][] = [];
  for (let i = 0; i < adIds.length; i += CHUNK) chunks.push(adIds.slice(i, i + CHUNK));

  const solve = async (ids: string[]): Promise<{ rows: MetaAdCreative[]; missing: string[] }> => {
    const r = await creativesBatch_(ids);
    if (r) return { rows: r, missing: [] };
    if (ids.length === 1) return { rows: [], missing: ids };
    const mid = Math.floor(ids.length / 2);
    const a = await solve(ids.slice(0, mid));
    const b = await solve(ids.slice(mid));
    return { rows: a.rows.concat(b.rows), missing: a.missing.concat(b.missing) };
  };

  const parts = await metaPool(chunks, pool, async (c) => {
    const r = await solve(c);
    await sleep(60);
    return r;
  });
  const rows: MetaAdCreative[] = [];
  const missing: string[] = [];
  parts.forEach((p) => { rows.push(...p.rows); missing.push(...p.missing); });
  return { rows, missing };
}
