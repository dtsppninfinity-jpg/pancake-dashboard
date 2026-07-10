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

/** ถึงรอบ daily ไหม — ยังไม่ได้รันของ "วันไทยวันนี้" และเลย 02:00 ไทยแล้ว */
export async function dueDaily(now: Date = new Date()): Promise<boolean> {
  const today = fmtDateBkk(now);
  const last = await getState('last_daily_date');
  return last !== today && bkkHour(now) >= 2;
}

export async function markDaily(now: Date = new Date()): Promise<void> {
  await setState('last_daily_date', fmtDateBkk(now));
}
