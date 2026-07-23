// lib/api/scoreconfig.ts — เก็บ/อ่าน "เกณฑ์การให้คะแนน Overall" ของหน้า Admin Performance
// เก็บเป็น JSON ในตาราง sync_state (key เดียว) → หัวหน้าตั้งครั้งเดียว ทุกคนเห็นเกณฑ์เดียวกัน
import { db } from '@/lib/db';
import { normalizeConfig, MONEY_METRIC_KEYS } from '@/lib/scoring';
import { MONEY_SCALE } from '@/lib/config';

const KEY = 'adminperf_score_config';
const MIGRATED_KEY = 'score_config_money_scaled'; // มาร์กว่าย้ายหน่วยเงินแล้ว (กันรันซ้ำ)

/**
 * เกณฑ์ที่ทีมตั้งไว้ก่อน 2026-07-23 คิดบนตัวเลขเงินที่พองอยู่ 100 เท่า
 * พอแก้หน่วยเงิน (MONEY_SCALE) คะแนนของทุกคนจะร่วงทันทีถ้าไม่ย้ายเป้าหมายตาม
 * → หารเป้าหมายเฉพาะตัวชี้วัดที่เป็นเงิน ครั้งเดียว แล้วมาร์กไว้ว่าทำแล้ว
 */
async function migrateMoneyTargets_(raw: any[]): Promise<{ config: any[]; migrated: boolean }> {
  if (MONEY_SCALE === 1) return { config: raw, migrated: false };
  const { data: mark } = await db.from('sync_state').select('value').eq('key', MIGRATED_KEY).maybeSingle();
  if (mark && mark.value) return { config: raw, migrated: false };

  const scaled = raw.map((m: any) =>
    MONEY_METRIC_KEYS.indexOf(String(m.key)) >= 0
      ? { ...m, target: Math.max(1, Math.round(Number(m.target) / MONEY_SCALE)) }
      : m
  );
  const now = new Date().toISOString();
  await db.from('sync_state').upsert(
    { key: KEY, value: JSON.stringify(scaled), updated_at: now }, { onConflict: 'key' }
  );
  await db.from('sync_state').upsert(
    { key: MIGRATED_KEY, value: '1', updated_at: now }, { onConflict: 'key' }
  );
  return { config: scaled, migrated: true };
}

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
  let moneyRescaled = false;
  if (data && data.value) {
    try {
      const parsed = normalizeConfig(JSON.parse(data.value));
      const res = await migrateMoneyTargets_(parsed);
      config = normalizeConfig(res.config);
      moneyRescaled = res.migrated;
    } catch (e) { config = null; }
  }
  return { ok: true, config, moneyRescaled };
}
