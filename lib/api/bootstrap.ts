// lib/api/bootstrap.ts — apiBootstrap (port จาก WebApi.gs)
// อ่านจาก Postgres (Supabase) เท่านั้น — คืน pages + สถานะ sync ล่าสุด
import { db, fetchAll } from '@/lib/db';
import { fmtDateTimeBkk, parsePancakeTime } from '@/lib/config';

/* ---------------- utilities (port จาก WebApi.gs) ---------------- */

/** ค่าจาก DB อาจเป็น Date / ISO string — แปลงเป็น Date เสมอ */
function toDate_(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  return parsePancakeTime(String(v));
}

/** timestamptz (ISO) → 'yyyy-MM-ddTHH:mm:ss' เวลาไทย (รูปแบบเดียวกับ fmtDateTime_ เดิม) */
function toDateTimeStr_(v: unknown): string {
  const d = toDate_(v);
  return d ? fmtDateTimeBkk(d) : '';
}

/** boolean ใน Postgres มาเป็น true/false อยู่แล้ว — แต่รองรับ string 'TRUE'/'OK' เดิมด้วย */
function toBool_(v: unknown): boolean {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

/* ================================================================
 * BOOTSTRAP
 * ================================================================ */

export async function apiBootstrap(_params?: unknown) {
  // pages: ตารางเล็ก — แต่ใช้ fetchAll กันพลาด (คอลัมน์ = page_id, name, platform)
  const pageRows = await fetchAll<{ page_id: unknown; name: unknown; platform: unknown }>(
    () => db.from('pages').select('page_id,name,platform'),
    'page_id'
  );
  const pages = pageRows.map((p) => ({
    id: String(p.page_id),
    name: String(p.name),
    platform: String(p.platform),
  }));

  // sync_log: order by ts asc เพื่อให้แถวล่าสุดของแต่ละ job มาทีหลัง (last wins เหมือน sheet append)
  const logs = await fetchAll<{ ts: unknown; job: unknown; ok: unknown; message: unknown }>(
    () => db.from('sync_log').select('ts,job,ok,message').order('ts', { ascending: true })
  );
  const lastByJob: Record<string, { job: string; ts: string; ok: boolean; message: string }> = {};
  logs.forEach((l) => {
    lastByJob[String(l.job)] = {
      job: String(l.job),
      ts: toDateTimeStr_(l.ts),
      ok: toBool_(l.ok),
      message: String(l.message == null ? '' : l.message),
    };
  });

  return {
    ok: true,
    pages: pages,
    lastSync: Object.keys(lastByJob).map((k) => lastByJob[k]),
    generatedAt: fmtDateTimeBkk(new Date()),
  };
}
