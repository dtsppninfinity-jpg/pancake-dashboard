// lib/supabase.ts — client สำหรับ worker เขียน DB (ใช้ service_role key — ข้าม RLS)
// ⚠️ service_role key ห้ามหลุดออกไปฝั่ง frontend — ใช้เฉพาะ sync worker (GitHub Actions) เท่านั้น
import { createClient } from '@supabase/supabase-js';
import { JOB_STAT_PREFIX, type StoredJobStat } from './jobstat';

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
    // เน็ตสะดุด/Supabase คืน 5xx ชั่วคราว ไม่ควรทำงาน backfill ที่รันมาแล้วครึ่งชั่วโมงพังทั้งดุ้น
    // ลองซ้ำ 3 ครั้งแบบถอยเวลา แล้วค่อยโยน — ข้อผิดพลาดของข้อมูลเอง (schema/constraint) ไม่ลองซ้ำ
    let lastErr = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { error } = await supabase.from(table).upsert(batch, { onConflict });
        if (!error) { lastErr = ''; break; }
        lastErr = error.message;
        if (!isTransient_(lastErr)) break;
      } catch (e: any) {
        lastErr = String((e && e.message) || e);
        if (!isTransient_(lastErr)) break;
      }
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 5000));
    }
    if (lastErr) throw new Error(`upsert ${table} ล้มเหลว: ${lastErr}`);
  }
  return unique.length;
}

/** ข้อผิดพลาดชั่วคราวที่ลองใหม่แล้วมีโอกาสผ่าน (เน็ต/เกตเวย์) — ไม่ใช่ปัญหาที่ตัวข้อมูล */
function isTransient_(msg: string): boolean {
  const m = String(msg || '').toLowerCase();
  return m.includes('fetch failed') || m.includes('timeout') || m.includes('etimedout') ||
    m.includes('econnreset') || m.includes('socket') || m.includes('network') ||
    m.includes('502') || m.includes('503') || m.includes('504');
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

/* ---------- สถิติผลงานของแต่ละ job (สัญญาใน lib/jobstat.ts) ---------- */

/** สถิติรอบล่าสุดของทุกงาน (คีย์ = ชื่องาน) — โหลดครั้งเดียวตอนเริ่มโปรเซส */
export async function loadJobStats(): Promise<Record<string, StoredJobStat>> {
  const { data } = await supabase.from('sync_state').select('key,value').like('key', JOB_STAT_PREFIX + '%');
  const out: Record<string, StoredJobStat> = {};
  (data || []).forEach((r: any) => {
    try {
      const s = JSON.parse(String(r.value || '{}')) as StoredJobStat;
      if (s && s.job) out[s.job] = s;
    } catch { /* ค่าเสีย = ถือว่าไม่เคยมี */ }
  });
  return out;
}

export async function saveJobStat(s: StoredJobStat): Promise<void> {
  await setState(JOB_STAT_PREFIX + s.job, JSON.stringify(s));
}

/* ---------- state / cursor (แทน Script Properties) ---------- */
export async function getState(key: string): Promise<string> {
  const { data } = await supabase.from('sync_state').select('value').eq('key', key).maybeSingle();
  return data?.value ?? '';
}
export async function setState(key: string, value: string): Promise<void> {
  await supabase.from('sync_state').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
}
