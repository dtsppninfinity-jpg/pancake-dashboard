// lib/api/scoreconfig.ts — เก็บ/อ่าน "เกณฑ์การให้คะแนน Overall" ของหน้า Admin Performance
// เก็บเป็น JSON ในตาราง sync_state (key เดียว) → หัวหน้าตั้งครั้งเดียว ทุกคนเห็นเกณฑ์เดียวกัน
import { db } from '@/lib/db';
import { normalizeConfig, normalizeRankRules, MONEY_METRIC_KEYS } from '@/lib/scoring';
import { MONEY_SCALE } from '@/lib/config';

const KEY = 'adminperf_score_config';
const RANK_KEY = 'adminperf_rank_rules';   // เกณฑ์เข้าอันดับโหมด "เท่า" — คนละเรื่องกับน้ำหนักคะแนน จึงแยกคีย์
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
  const now = new Date().toISOString();
  const hasConfig = !!(params && params.config);
  const hasRank = !!(params && params.rank);

  // มีอะไรส่งมา → บันทึก (ปุ่ม 💾 ส่งมาพร้อมกันทั้งสองก้อน)
  if (hasConfig || hasRank) {
    const out: any = { ok: true };
    if (hasConfig) {
      const clean = normalizeConfig(params.config);         // กันค่าเพี้ยน/คีย์แปลกปลอม
      const { error } = await db
        .from('sync_state')
        .upsert({ key: KEY, value: JSON.stringify(clean), updated_at: now }, { onConflict: 'key' });
      if (error) throw new Error('บันทึกเกณฑ์ไม่สำเร็จ: ' + error.message);
      out.config = clean;
    }
    if (hasRank) {
      const cleanRank = normalizeRankRules(params.rank);
      const { error } = await db
        .from('sync_state')
        .upsert({ key: RANK_KEY, value: JSON.stringify(cleanRank), updated_at: now }, { onConflict: 'key' });
      if (error) throw new Error('บันทึกเกณฑ์เข้าอันดับไม่สำเร็จ: ' + error.message);
      out.rank = cleanRank;
    }
    return out;
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

  const { data: rankRow } = await db.from('sync_state').select('value').eq('key', RANK_KEY).maybeSingle();
  let rank: any = null;
  if (rankRow && rankRow.value) {
    try { rank = normalizeRankRules(JSON.parse(rankRow.value)); } catch (e) { rank = null; }
  }
  return { ok: true, config, rank, moneyRescaled };
}
