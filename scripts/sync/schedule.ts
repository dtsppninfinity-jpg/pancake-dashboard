// scripts/sync/schedule.ts — ตัวตัดสินว่า "ถึงรอบ" hourly/daily หรือยัง (idempotent ผ่าน sync_state)
// ให้ pinger ที่ยิง fast ทุก 15 นาที จัดการงาน hourly/daily ได้เองโดยไม่รันซ้ำ
// รับ `now` เป็นพารามิเตอร์เพื่อให้ unit-test ด้วยเวลาปลอมได้
import { getState, setState } from '../../lib/supabase';
import { fmtDateBkk, TZ } from '../../lib/config';

// pinger ยิงทุก ~15 นาที → ใช้ช่องว่าง 55 นาที เพื่อให้ hourly รัน ~1 ครั้ง/ชม. (รอบที่ครบ ~60 นาทีถึงรัน)
const HOURLY_MIN_GAP_MS = 55 * 60 * 1000;

/** ถึงรอบ hourly ไหม — ครั้งแรก (ไม่มี cursor) = ถึงเลย */
export async function dueHourly(now: Date = new Date()): Promise<boolean> {
  const last = await getState('last_hourly_at');
  if (!last) return true;
  const t = new Date(last).getTime();
  if (isNaN(t)) return true;
  return now.getTime() - t >= HOURLY_MIN_GAP_MS;
}

export async function markHourly(now: Date = new Date()): Promise<void> {
  await setState('last_hourly_at', now.toISOString());
}

/** ชั่วโมงตามเวลาไทย (0–23) */
function bkkHour(d: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(d)) % 24;
}

// daily ล้มแล้วเว้นอย่างน้อย 2 ชม. ก่อนลองใหม่ (เดิมลองซ้ำทุกรอบ 15 นาที)
// เจอจริง 14 ก.ย. 2569: PANCAKE_ACCESS_TOKEN หมดอายุ → งาน pages ใน daily ล้มทุกรอบ → daily วนทั้งวัน
// รอบ GitHub ยาวเกิน timeout 30 นาที ถูกตัด 30 รอบในวันเดียว ข้อมูลที่ควรเข้าทุก 15 นาทีช้าลงเหลือ ~35 นาที
const DAILY_RETRY_GAP_MS = 2 * 60 * 60 * 1000;

/**
 * ตัดสินรอบ daily แบบ pure (ไม่แตะ DB) — แยกไว้ให้ทดสอบด้วยเวลาปลอมได้
 * ถึงรอบ = ยังไม่สำเร็จของ "วันไทยวันนี้" + เลย 02:00 ไทยแล้ว + ห่างจากครั้งที่ลองล่าสุด ≥ 2 ชม.
 * waitMins > 0 = วันนี้เคยลองแล้วล้ม กำลังรอเว้นช่วง (ให้ log บอกได้ ไม่ใช่เงียบ)
 */
export function dailyDecision(now: Date, lastDailyDate: string, lastAttemptIso: string): { due: boolean; waitMins: number } {
  if (lastDailyDate === fmtDateBkk(now) || bkkHour(now) < 2) return { due: false, waitMins: 0 };
  const t = new Date(lastAttemptIso || '').getTime();
  if (!isNaN(t)) {
    const left = DAILY_RETRY_GAP_MS - (now.getTime() - t);
    if (left > 0) return { due: false, waitMins: Math.ceil(left / 60000) };
  }
  return { due: true, waitMins: 0 };
}

export async function dailyStatus(now: Date = new Date()): Promise<{ due: boolean; waitMins: number }> {
  const [last, attempt] = await Promise.all([getState('last_daily_date'), getState('last_daily_attempt_at')]);
  return dailyDecision(now, last, attempt);
}

/** จด "เริ่มลอง daily" ก่อนรัน — รอบที่ถูกตัดกลางคัน (timeout) ก็นับเป็นการลองแล้ว จะได้ไม่วนทุก 15 นาที */
export async function markDailyAttempt(now: Date = new Date()): Promise<void> {
  await setState('last_daily_attempt_at', now.toISOString());
}

export async function markDaily(now: Date = new Date()): Promise<void> {
  await setState('last_daily_date', fmtDateBkk(now));
}
