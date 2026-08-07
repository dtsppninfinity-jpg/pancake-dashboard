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

  /* ---- 🩺 สุขภาพงาน sync (บทเรียน 2026-08-07: product-sheets "ข้าม" เงียบๆ อยู่ 7 วันไม่มีใครเห็น)
   * เตือน 3 แบบ: ล้มเหลว (ok=false) / ข้าม (message ขึ้นต้น "ข้าม") / เงียบนานเกินรอบที่ควรรัน */
  const HOUR = 60;
  const MAX_AGE_MINS: Record<string, number> = {
    // รอบ 15 นาที (เผื่อเป็น 90 นาที — Vercel cold start / Meta ช้าได้)
    orders: 90, 'chat-today': 90, conversations: 90, 'online-status': 90,
    'engagements-today': 90, 'admin-chat-today': 90, 'meta-ads-today': 90,
    // delta รันรายนาที — เงียบเกิน 30 นาที = pinger/Pancake มีปัญหา
    'orders-delta': 30,
    // รายชั่วโมง
    ads: 3 * HOUR, 'admins-roster': 3 * HOUR, 'ad-stats-today': 3 * HOUR,
    'meta-ads-yesterday': 3 * HOUR, 'unit-alerts': 3 * HOUR,
    // รายวัน (default 26 ชม. อยู่แล้ว — ระบุเฉพาะที่อยากตึงกว่า)
  };
  const nowMs = Date.now();
  const syncHealth: Array<{ job: string; kind: string; ageMins: number; message: string }> = [];
  Object.keys(lastByJob).forEach((k) => {
    const l = lastByJob[k];
    const t = parsePancakeTime(l.ts);
    const ageMins = t ? Math.round((nowMs - t.getTime()) / 60000) : 999999;
    const maxAge = MAX_AGE_MINS[k] || 26 * HOUR;
    if (!l.ok) syncHealth.push({ job: k, kind: 'fail', ageMins, message: l.message.slice(0, 120) });
    else if (/^ข้าม/.test(l.message)) syncHealth.push({ job: k, kind: 'skip', ageMins, message: l.message.slice(0, 120) });
    else if (ageMins > maxAge) syncHealth.push({ job: k, kind: 'stale', ageMins, message: 'เงียบมา ' + Math.round(ageMins / 60) + ' ชม. (ควรรันทุก ' + Math.round(maxAge / 60) + ' ชม.)' });
  });

  return {
    ok: true,
    pages: pages,
    lastSync: Object.keys(lastByJob).map((k) => lastByJob[k]),
    syncHealth,
    generatedAt: fmtDateTimeBkk(new Date()),
  };
}
