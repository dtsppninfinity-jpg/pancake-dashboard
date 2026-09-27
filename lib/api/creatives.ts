// lib/api/creatives.ts — สื่อ/ครีเอทีฟของแอด (ตาราง ad_creative จาก Meta) ใช้ร่วมกัน:
//   apiContentAds  = สื่อของแอดชุดแรกที่หน้าเว็บโชว์ทันที (แจ้งเตือน + 30 อันดับแรก)
//   apiPageMedia {adIds} = หน้าเว็บขอเพิ่มทีละชุดเฉพาะแอดที่กำลังจะโชว์ (เปลี่ยนตัวกรอง/อันดับ, เปิดหน้าวิเคราะห์)
// เดิม apiContentAds ดึงสื่อของ "ทุกแอดในช่วง" (~11k แอด / 7 วัน = 46% ของเวลาโหลด + 16MB) ทั้งที่จอใช้แค่ ~30
import { db, fetchAll } from '@/lib/db';

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
