// lib/api/creatives.ts — สื่อ/ครีเอทีฟของแอด (ตาราง ad_creative จาก Meta) ใช้ร่วมกัน:
//   apiContentAds  = สื่อของแอดชุดแรกที่หน้าเว็บโชว์ทันที (แจ้งเตือน + 30 อันดับแรก)
//   apiPageMedia {adIds} = หน้าเว็บขอเพิ่มทีละชุดเฉพาะแอดที่กำลังจะโชว์ (เปลี่ยนตัวกรอง/อันดับ, เปิดหน้าวิเคราะห์)
// เดิม apiContentAds ดึงสื่อของ "ทุกแอดในช่วง" (~11k แอด / 7 วัน = 46% ของเวลาโหลด + 16MB) ทั้งที่จอใช้แค่ ~30
import { db, fetchAll } from '@/lib/db';
import { metaAdCreativesByIds } from '@/lib/meta';

/**
 * error นี้แปลว่า "ยังไม่ได้สร้างตาราง" (ยังไม่รัน migration) เท่านั้นไหม
 * ⚠️ เดิมเช็คแค่ชื่อตาราง + 'does not exist' — "column ad_daily.x does not exist" ก็ผ่าน
 *    ชื่อคอลัมน์ผิดทีเดียว หน้าเว็บขึ้น "ยังไม่ได้เปิดใช้ข้อมูลค่าแอด" เงียบๆ ไม่มี error ให้เห็น
 */
export function isMissingTable(msg: string, table: string): boolean {
  if (!msg.includes(table) || /column/i.test(msg)) return false;
  return /does not exist|schema cache|Could not find the table/i.test(msg);
}

/** สื่อ/ครีเอทีฟที่ผูกกับแอด (มาจาก Meta) — เก็บแยกตาราง เพราะไม่เปลี่ยนรายวัน */
export interface CreativeRow {
  ad_id: string; name?: string | null; thumb_url?: string | null; image_url?: string | null;
  video_id?: string | null; object_type?: string | null; post_id?: string | null;
  permalink?: string | null; ig_permalink?: string | null; cta?: string | null; link_url?: string | null;
}

/** สื่อของแอดในรูปที่หน้าเว็บใช้ (lib/views/contentads.ts mediaBoxHtml_ / mediaPanelHtml_) */
export interface MediaObj {
  img: string; imgAlt: string; video: string; type: string; postId: string;
  permalink: string; ig: string; cta: string; link: string; title: string;
}

/**
 * ครีเอทีฟของ ad_id ที่ระบุ → map ต่อ ad_id
 * แบ่ง .in() ทีละ 300 id — ยัดหลายพัน id ใน URL เดียว PostgREST จะตอบ 414 (URI ยาวเกิน) · ก้อนยิงพร้อมกัน (semaphore ใน db.ts คุม)
 * ตารางยังไม่ถูกสร้าง (ยังไม่รัน migration) → คืน {} เงียบๆ หน้าเว็บทำงานต่อได้แค่ไม่มีรูป
 * ⚠️ ห้ามก๊อป query แบบใน pagemedia.ts (โหมดเลือกเพจ) มาใช้แทน — ตัวนั้นไม่มี ig_permalink/cta/link_url
 */
export async function loadCreatives(adIds: string[]): Promise<Record<string, CreativeRow>> {
  const out: Record<string, CreativeRow> = {};
  if (!adIds.length) return out;
  const CHUNK = 300;
  const cols = 'ad_id,name,thumb_url,image_url,video_id,object_type,post_id,permalink,ig_permalink,cta,link_url';
  try {
    const parts: string[][] = [];
    for (let i = 0; i < adIds.length; i += CHUNK) parts.push(adIds.slice(i, i + CHUNK));
    const results = await Promise.all(parts.map((part) =>
      fetchAll<CreativeRow>(() => db.from('ad_creative').select(cols).in('ad_id', part), 'ad_id')));
    results.forEach(function (rows) { rows.forEach(function (r) { out[String(r.ad_id)] = r; }); });
  } catch (e: any) {
    const m = String((e && e.message) || e || '');
    if (isMissingTable(m, 'ad_creative')) return {};   // ยังไม่รัน 2026-07-27-ad-creative.sql
    throw e;
  }
  return out;
}

/**
 * แถวครีเอทีฟ → สื่อที่หน้าเว็บใช้ · null = แอดนี้ไม่มีอะไรให้โชว์ (ไม่มีแถว หรือเป็นแถวเปล่าที่ Meta ปฏิเสธ)
 * image_url เป็นรูปคมสุด, thumb เป็นตัวสำรอง (URL ของ Meta มีวันหมดอายุ หน้าเว็บจึงต้องมี fallback ทั้งคู่ก่อนตกไปที่กล่องเปล่า)
 */
export function toMediaObj(cr: CreativeRow | undefined | null): MediaObj | null {
  if (!cr || !(cr.image_url || cr.thumb_url || cr.permalink || cr.ig_permalink)) return null;
  return {
    img: String(cr.image_url || cr.thumb_url || ''),
    imgAlt: String(cr.thumb_url || ''),
    video: String(cr.video_id || ''),
    type: String(cr.object_type || ''),
    postId: String(cr.post_id || ''),
    permalink: String(cr.permalink || ''),
    ig: String(cr.ig_permalink || ''),
    cta: String(cr.cta || ''),
    link: String(cr.link_url || ''),
    title: String(cr.name || ''),
  };
}

/* ---------------- ลิงก์รูปของ Meta หมดอายุ → ขอใหม่เฉพาะตัวที่จะโชว์ (พีเลือกทาง ก. 28 ก.ย.) ----------------
 * ลิงก์รูป/รูปย่อจาก Meta (scontent/fbcdn) มีวันหมดอายุฝังในพารามิเตอร์ oe (วินาที unix ฐาน 16) อยู่ได้ราว 4 วัน
 * แต่งาน sync ดึงครีเอทีฟครั้งเดียวตอนแอดเกิด → แอดที่ยิงนานกว่า 4 วันรูปดับหมด (วัด 28 ก.ย.: ~2/3 ของจอแรก)
 * ทางที่เลือก: ตอนหน้าเว็บขอรูปชุดไหน (≤60) ตัวที่หมดแล้ว/จะหมดใน 1 ชม. ขอลิงก์ใหม่จาก Meta ตอนนั้น (≤2 คำขอ)
 * แล้วเขียนทับ "เฉพาะช่องลิงก์รูป" ในตาราง — คนถัดไปใช้ต่อได้อีก ~4 วัน · ช่องอื่น (post_id ฯลฯ) ห้ามแตะ:
 *   งานเติมเพจให้ค่าแอด (syncAdPageFill) อาศัย post_id — ทับเป็นค่าว่างเมื่อไหร่ ค่าแอดก้อนนั้นหลุดจากตารางยูนิต
 * เทียบทางรีเฟรชทุกแอดวันละครั้ง: ~9,700 แอด/วัน ≈ เพิ่มโควตา Meta เกือบเท่าตัว (เคยชนเพดาน 27 ส.ค.) */

/** เวลาหมดอายุของลิงก์ Meta (ms) — null = ลิงก์ไม่มีวันหมดอายุ / ไม่ใช่ลิงก์แบบนั้น */
export function urlExpiresAt(u: string | null | undefined): number | null {
  const m = /[?&]oe=([0-9A-Fa-f]{6,10})(?:&|#|$)/.exec(String(u || ''));
  return m ? parseInt(m[1], 16) * 1000 : null;
}
/** หมดแล้วหรือจะหมดใน 1 ชม. (เปิดหน้าค้างไว้แล้วรูปดับกลางทาง) */
const EXPIRY_MARGIN_MS = 60 * 60 * 1000;
function urlStale_(u: string | null | undefined): boolean {
  const t = urlExpiresAt(u);
  return t !== null && t < Date.now() + EXPIRY_MARGIN_MS;
}
/** รูปที่จอใช้ของแถวนี้หมดอายุไหม — 'img' = หน้าโฆษณา (image_url ก่อน, toMediaObj) · 'thumb' = สื่อรายเพจ (thumb_url ก่อน) */
export function creativeExpired(cr: CreativeRow | undefined | null, which: 'img' | 'thumb' = 'img'): boolean {
  if (!cr) return false;
  const u = which === 'thumb' ? (cr.thumb_url || cr.image_url) : (cr.image_url || cr.thumb_url);
  return !!u && urlStale_(u);
}

/** id ที่ลองขอใหม่ไปแล้วเมื่อไหร่ (ต่อโปรเซส) — ขอไม่สำเร็จ/Meta ไม่ให้ จะไม่ถามซ้ำทุกคำขอ (20 นาทีค่อยลองใหม่) */
const refreshTried_ = new Map<string, number>();
const RETRY_AFTER_MS = 20 * 60 * 1000;
const REFRESH_MAX = 60;

/**
 * ขอลิงก์รูปใหม่ให้แถวที่หมดอายุใน crs (เฉพาะ ids ที่ส่งมา ≤60 ตัว) แล้วแก้ crs ในที่ + เขียนลงตาราง
 * รอไม่เกิน budgetMs — เกินนั้นคืนของเดิม (รูปดับแบบเดิม) ปล่อยงานวิ่งต่อ ถ้าเสร็จทีหลังตารางได้ลิงก์ใหม่ คนถัดไปได้รูป
 * ไม่มี token / Meta ปฏิเสธ / เน็ตพลาด = เงียบ คืน 0 (รูปเป็นของเสริม ห้ามทำให้คำขอพัง) · คืนจำนวนแถวที่ได้ลิงก์ใหม่
 */
export async function refreshExpiredCreatives(
  crs: Record<string, CreativeRow>, ids: string[], which: 'img' | 'thumb', budgetMs = 8000,
): Promise<number> {
  if (!process.env.META_ACCESS_TOKEN) return 0;
  const now = Date.now();
  const want = ids.filter((id) => creativeExpired(crs[id], which) && !(now - (refreshTried_.get(id) || 0) < RETRY_AFTER_MS))
    .slice(0, REFRESH_MAX);
  if (!want.length) return 0;
  want.forEach((id) => refreshTried_.set(id, now));
  if (refreshTried_.size > 5000) {   // กันโตไม่หยุดในโปรเซสที่อยู่นาน
    refreshTried_.forEach((t, id) => { if (now - t >= RETRY_AFTER_MS) refreshTried_.delete(id); });
  }
  const work = metaAdCreativesByIds(want, 2).then(async ({ rows }) => {
    // เฉพาะแถวที่ได้รูปจริง · เขียนแค่ ad_id + 2 ช่องลิงก์ (upsert แบบรวม = ช่องที่ไม่ส่งไม่ถูกแตะ แถวมีอยู่แล้วทุกตัว)
    const got = rows.filter((r) => want.indexOf(String(r.ad_id)) >= 0 && (r.image_url || r.thumb_url));
    if (got.length) {
      const { error } = await db.from('ad_creative')
        .upsert(got.map((r) => ({ ad_id: String(r.ad_id), image_url: r.image_url, thumb_url: r.thumb_url })), { onConflict: 'ad_id' });
      if (error) console.error('[creatives] save refreshed urls', error.message);
    }
    return got;
  });
  work.catch((e: any) => console.error('[creatives] refresh', (e && e.message) || e));
  let timer: ReturnType<typeof setTimeout> | null = null;
  const got = await Promise.race([
    work.catch(() => null),
    new Promise<null>((res) => { timer = setTimeout(() => res(null), budgetMs); }),
  ]);
  if (timer) clearTimeout(timer);
  if (!got) return 0;
  got.forEach((r) => {
    const c = crs[String(r.ad_id)];
    if (c) { c.image_url = r.image_url; c.thumb_url = r.thumb_url; }
  });
  return got.length;
}

/** มีครีเอทีฟที่ใช้ได้สักแถวในตารางไหม — ตัวตัดสินว่าหน้าเว็บวาดกล่องรูปย่อไหม / ขึ้นแถบ "ยังไม่มีรูปครีเอทีฟ"
 *  ⚠️ คอลัมน์ของ ad_creative ค่าเริ่มต้นเป็น '' ไม่ใช่ NULL และ sync เขียนแถวเปล่าให้แอดที่ Meta ปฏิเสธ → เช็ค neq '' ไม่ใช่ not null
 *  0 = ไม่มีตาราง/ไม่มีแถวจริงเท่านั้น · error อื่น (เน็ตสะดุด/timeout) ลองซ้ำ แล้วถ้ายังพลาดตอบ 1 = "ไม่แน่ใจ"
 *  ให้หน้าเว็บวาดกล่องรูปแล้วขอรูปเองตามปกติ — ไม่ใช่ขึ้นแถบ "ยังไม่ได้รัน migration" หลอกตาเพราะเน็ตสะดุดครั้งเดียว */
export async function hasAnyCreative(): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let msg = '';
    try {
      const { data, error } = await db.from('ad_creative').select('ad_id')
        .or('image_url.neq.,thumb_url.neq.').limit(1)
        .abortSignal(AbortSignal.timeout(15_000));
      if (!error) return (data || []).length;
      msg = String(error.message || '');
    } catch (e: any) {
      msg = String((e && e.message) || e || '');
    }
    if (isMissingTable(msg, 'ad_creative')) return 0;
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  return 1;
}
