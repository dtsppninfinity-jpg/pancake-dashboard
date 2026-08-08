// scripts/sync/envcheck.ts — ตรวจกุญแจ/ค่าตั้งต้นก่อนเริ่มรอบ sync
//
// บทเรียน 2026-08-07: env ตัวหนึ่งไม่ได้ตั้งบน Vercel งาน product-sheets เลย "ข้าม" ตัวเองเงียบๆ
// คืน ok=true ทุกวัน กำไร/ค่าคอมแช่แข็งอยู่ 7 วันโดยไม่มีใครรู้ — ของแบบนี้ต้องล้มดังๆ ตั้งแต่ต้นรอบ
//
// จำเป็น (missing = หยุดทั้งรอบ) : ไม่มีแล้วงานหลักทำอะไรไม่ได้เลย
// เสริม   (missing = ฟ้องแต่ไปต่อ): ขาดแล้วบางฟีเจอร์ตาบอด แต่ยอดขาย/แชทยังเดินได้
import { logJob, getState, setState } from '../../lib/supabase';

interface EnvSpec { name: string; why: string }

const REQUIRED: EnvSpec[] = [
  { name: 'SUPABASE_URL', why: 'ฐานข้อมูล' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', why: 'ฐานข้อมูล' },
  { name: 'PANCAKE_ACCESS_TOKEN', why: 'เพจ/แชท/สถิติ' },
  { name: 'POS_API_KEY', why: 'ออเดอร์ POS' },
  { name: 'POS_SHOP_ID', why: 'ออเดอร์ POS' },
];

const FEATURE: EnvSpec[] = [
  { name: 'META_ACCESS_TOKEN', why: 'ค่าแอดจริง + คนทักจาก Meta (ไม่มี = ค่าแอด/%ปิดจากแอดเพี้ยน)' },
  { name: 'GOOGLE_SA_KEY', why: 'กำไร/ค่าคอม/ตีกลับ/KPI จากชีททีม (ไม่มี = ตัวเลขค้างที่เดิม)' },
];

const missing_ = (list: EnvSpec[]) => list.filter((e) => !String(process.env[e.name] || '').trim());
const fmt_ = (list: EnvSpec[]) => list.map((e) => `${e.name} (${e.why})`).join(', ');

/**
 * ตรวจ env — คืน false เมื่อขาดตัวจำเป็น (ผู้เรียกต้องหยุดรอบ)
 *
 * เขียน log เฉพาะตอน "สถานะเปลี่ยน" (เพิ่งขาด / เพิ่งครบ) — ถ้าเขียนทุกรอบ 15 นาที
 * sync_log จะบวมจนหน้าต่างที่หน้าเว็บอ่าน (แถวล่าสุด) กินไม่ถึงงานรายวัน
 */
export async function checkEnv(): Promise<boolean> {
  const miss = missing_(REQUIRED);
  const missFeat = missing_(FEATURE);

  const parts: string[] = [];
  if (miss.length) parts.push(`ขาดค่าที่จำเป็น: ${fmt_(miss)}`);
  if (missFeat.length) parts.push(`ขาดค่าของฟีเจอร์: ${fmt_(missFeat)}`);
  const message = parts.length ? parts.join(' | ') : 'env ครบทุกตัว';
  const ok = !parts.length;

  const prev = await getState('env_check').catch(() => '');
  const cur = `${ok ? 'ok' : 'bad'}:${message}`;
  if (prev !== cur) {
    await logJob('env-check', ok, message, 0);
    await setState('env_check', cur);
  }

  if (miss.length) {
    console.error(`❌ env-check: ${message}`);
    return false;
  }
  if (missFeat.length) console.warn(`⚠️  env-check: ${message}`);
  return true;
}
