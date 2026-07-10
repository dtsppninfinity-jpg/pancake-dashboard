// lib/supabase.ts — client สำหรับ worker เขียน DB (ใช้ service_role key — ข้าม RLS)
// ⚠️ service_role key ห้ามหลุดออกไปฝั่ง frontend — ใช้เฉพาะ sync worker (GitHub Actions) เท่านั้น
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!url || !key) {
  console.warn('⚠️  ยังไม่ได้ตั้ง SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (worker จะเขียน DB ไม่ได้)');
}

export const supabase = createClient(url, key, { auth: { persistSession: false } });

/**
 * upsert เป็นก้อน (batch) — แบ่งทีละ 500 แถวกัน payload ใหญ่เกิน
 * onConflict = คอลัมน์ primary key ของตารางนั้น
 */
export async function upsertRows(table: string, rows: any[], onConflict: string): Promise<number> {
  if (!rows.length) return 0;
  // ตัดแถวที่ conflict key ซ้ำในชุดเดียวกันออก (เก็บอันหลังสุด) — Postgres upsert
  // ห้ามมี key ซ้ำในคำสั่งเดียว ("ON CONFLICT ... cannot affect row a second time")
  const cols = onConflict.split(',').map((s) => s.trim());
  const keyOf = (r: any) => cols.map((c) => String(r[c])).join('||');
  const seen = new Map<string, any>();
  for (const r of rows) seen.set(keyOf(r), r);
  const unique = Array.from(seen.values());

  const CHUNK = 500;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const batch = unique.slice(i, i + CHUNK);
    const { error } = await supabase.from(table).upsert(batch, { onConflict });
    if (error) throw new Error(`upsert ${table} ล้มเหลว: ${error.message}`);
  }
  return unique.length;
}

/** เขียนทับทั้งตาราง (ลบเก่าทั้งหมด แล้วใส่ใหม่) — สำหรับ ads / admins snapshot */
export async function replaceTable(table: string, rows: any[], pkColumn: string): Promise<number> {
  // ลบทุกแถว (ใช้เงื่อนไขที่จริงเสมอ)
  const { error: delErr } = await supabase.from(table).delete().not(pkColumn, 'is', null);
  if (delErr) throw new Error(`ลบ ${table} ล้มเหลว: ${delErr.message}`);
  return upsertRows(table, rows, pkColumn);
}

/** เขียน log ลง sync_log */
export async function logJob(job: string, ok: boolean, message: string, ms: number): Promise<void> {
  await supabase.from('sync_log').insert({ job, ok, message: String(message).slice(0, 1000), ms });
}

/* ---------- state / cursor (แทน Script Properties) ---------- */
export async function getState(key: string): Promise<string> {
  const { data } = await supabase.from('sync_state').select('value').eq('key', key).maybeSingle();
  return data?.value ?? '';
}
export async function setState(key: string, value: string): Promise<void> {
  await supabase.from('sync_state').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
}
