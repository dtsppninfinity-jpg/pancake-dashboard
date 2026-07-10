// lib/api/scoreconfig.ts — เก็บ/อ่าน "เกณฑ์การให้คะแนน Overall" ของหน้า Admin Performance
// เก็บเป็น JSON ในตาราง sync_state (key เดียว) → หัวหน้าตั้งครั้งเดียว ทุกคนเห็นเกณฑ์เดียวกัน
import { db } from '@/lib/db';
import { normalizeConfig } from '@/lib/scoring';

const KEY = 'adminperf_score_config';

export async function apiScoreConfig(params: any) {
  // มี config ส่งมา → บันทึก
  if (params && params.config) {
    const clean = normalizeConfig(params.config);           // กันค่าเพี้ยน/คีย์แปลกปลอม
    const value = JSON.stringify(clean);
    const { error } = await db
      .from('sync_state')
      .upsert({ key: KEY, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw new Error('บันทึกเกณฑ์ไม่สำเร็จ: ' + error.message);
    return { ok: true, config: clean };
  }

  // ไม่มี → อ่านค่าปัจจุบัน (null = ยังไม่เคยตั้ง → ฝั่ง client จะใช้ค่าเริ่มต้น)
  const { data } = await db.from('sync_state').select('value').eq('key', KEY).maybeSingle();
  let config: any = null;
  if (data && data.value) {
    try { config = normalizeConfig(JSON.parse(data.value)); } catch (e) { config = null; }
  }
  return { ok: true, config };
}
