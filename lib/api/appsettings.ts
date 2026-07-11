// lib/api/appsettings.ts — ตั้งค่ากลางของแอป (margin% กำไรประมาณการ + เกณฑ์ SLA)
// เก็บเป็น JSON ใน sync_state key เดียว — pattern เดียวกับ scoreconfig (ตั้งครั้งเดียว ทุกคนเห็นเหมือนกัน)
import { db } from '@/lib/db';

const KEY = 'app_settings';

export interface AppSettings {
  marginPct: number; // % กำไรขั้นต้นโดยประมาณ (0-95) — ใช้คำนวณ "กำไรประมาณการ" หน้า Sales
  slaMins: number;   // แชทที่รอเกินกี่นาทีถือว่า "เกิน SLA" (proxy จาก updated_at — ไม่ใช่ per-case จริง)
}

export const DEFAULT_APP_SETTINGS: AppSettings = { marginPct: 30, slaMins: 60 };

function clamp_(v: unknown, dv: number, min: number, max: number): number {
  const n = Number(v);
  if (!isFinite(n)) return dv;
  return Math.min(max, Math.max(min, Math.round(n * 10) / 10));
}

export function normalizeAppSettings(raw: any): AppSettings {
  const r = raw || {};
  return {
    marginPct: clamp_(r.marginPct, DEFAULT_APP_SETTINGS.marginPct, 0, 95),
    slaMins: Math.round(clamp_(r.slaMins, DEFAULT_APP_SETTINGS.slaMins, 5, 1440)),
  };
}

/** อ่านค่าปัจจุบัน (สำหรับ api อื่นใช้ฝั่ง server เช่น SLA ใน admins/adminperf) */
export async function getAppSettings(): Promise<AppSettings> {
  const { data } = await db.from('sync_state').select('value').eq('key', KEY).maybeSingle();
  if (data && data.value) {
    try { return normalizeAppSettings(JSON.parse(data.value)); } catch { /* ใช้ default */ }
  }
  return { ...DEFAULT_APP_SETTINGS };
}

export async function apiAppSettings(params: any) {
  const p = params || {};
  if (p.settings) {
    // partial merge — ส่งมาเฉพาะ field ที่แก้ได้ (หน้า Sales แก้ margin, หน้า Admins แก้ SLA)
    const cur = await getAppSettings();
    const clean = normalizeAppSettings({ ...cur, ...p.settings });
    const { error } = await db
      .from('sync_state')
      .upsert(
        { key: KEY, value: JSON.stringify(clean), updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );
    if (error) throw new Error('บันทึกการตั้งค่าไม่สำเร็จ: ' + error.message);
    return { ok: true, settings: clean };
  }
  return { ok: true, settings: await getAppSettings() };
}
