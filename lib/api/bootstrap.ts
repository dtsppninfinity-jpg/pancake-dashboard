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

  // sync_log: เอาเฉพาะช่วงท้าย (พอครอบ >26 ชม. = ทุกงานรวมงานรายวัน) แล้วเรียงเก่า→ใหม่
  // เดิม fetchAll ทั้งตาราง (หลักหมื่นแถว) — เปลืองเวลาเปล่าเพราะใช้แค่แถวล่าสุดต่อ job
  const { data: logRows } = await db.from('sync_log')
    .select('ts,job,ok,message').order('id', { ascending: false }).limit(1500);
  const logs = (logRows || []).slice().reverse();
  const lastByJob: Record<string, { job: string; ts: string; ok: boolean; message: string }> = {};
  // นับ "ล้มติดกันกี่รอบล่าสุด" ต่อ job — Pancake ตอบ HTTP 500 เป็นครั้งคราวแล้วรอบถัดไปก็สำเร็จ
  // ถ้าเตือนตั้งแต่ครั้งแรกทีมจะเห็นไฟแดงกระพริบทั้งวันจนเลิกสนใจ (alarm fatigue)
  const failStreak: Record<string, number> = {};
  logs.forEach((l) => {
    const job = String(l.job);
    const ok = toBool_(l.ok);
    failStreak[job] = ok ? 0 : (failStreak[job] || 0) + 1;
    lastByJob[job] = {
      job,
      ts: toDateTimeStr_(l.ts),
      ok,
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
  // orders-delta ลงตาราง log เฉพาะตอนพัง (สำเร็จเก็บใน sync_state last_delta_at) — ต้องดูจาก state
  let deltaOkAgeMins: number | null = null;
  try {
    const { data: dl } = await db.from('sync_state').select('value').eq('key', 'last_delta_at').maybeSingle();
    const t = dl && dl.value ? new Date(String(dl.value)).getTime() : 0;
    if (t) deltaOkAgeMins = Math.round((nowMs - t) / 60000);
  } catch { /* ยังไม่เคยรัน */ }
  // orders-delta สำเร็จไม่ลง log (เก็บใน state) — เช็คนอกลูป ไม่งั้นถ้า pinger หยุดโดยไม่เคย error
  // ชื่องานจะไม่มีใน lastByJob เลย แล้วไม่มีใครเตือน (จุดบอดที่รีวิวจับได้ 2026-08-08)
  if (deltaOkAgeMins === null || deltaOkAgeMins > 30) {
    const dl = lastByJob['orders-delta'];
    const age = deltaOkAgeMins === null ? (dl ? Math.round((nowMs - (parsePancakeTime(dl.ts)?.getTime() || nowMs)) / 60000) : 999999) : deltaOkAgeMins;
    syncHealth.push({
      job: 'orders-delta', kind: 'stale', ageMins: age,
      message: 'ยอดสดรายนาทีไม่อัปเดตมา ' + Math.round(age / 6) / 10 + ' ชม.' +
        (dl && !dl.ok ? ' — ' + dl.message.slice(0, 90) : ' (เช็ค pinger ที่ cron-job.org)'),
    });
  }
  Object.keys(lastByJob).forEach((k) => {
    if (k.startsWith('trace-')) return; // งานดีบักชั่วคราว ไม่ใช่ sync จริง
    if (k === 'orders-delta') return;   // เช็คไปแล้วข้างบน (สำเร็จไม่ลง log)
    const l = lastByJob[k];
    const t = parsePancakeTime(l.ts);
    const ageMins = t ? Math.round((nowMs - t.getTime()) / 60000) : 999999;
    const maxAge = MAX_AGE_MINS[k] || 26 * HOUR;
    // ล้มครั้งเดียวแล้วรอบถัดไปสำเร็จ = อาการปกติของ Pancake (HTTP 500 เป็นครั้งคราว) ไม่ต้องเตือน
    // เตือนเมื่อล้มติดกัน ≥2 รอบ (แก้เองไม่ได้แล้ว) หรือค้างนานเกินรอบที่ควรรัน
    const streak = failStreak[k] || 0;
    if (!l.ok && streak >= 2) {
      syncHealth.push({ job: k, kind: 'fail', ageMins, message: 'ล้มติดกัน ' + streak + ' รอบ — ' + l.message.slice(0, 110) });
    } else if (!l.ok && ageMins > maxAge) {
      syncHealth.push({ job: k, kind: 'fail', ageMins, message: 'ล้มและยังไม่สำเร็จอีกเลย — ' + l.message.slice(0, 100) });
    } else if (l.ok && /^ข้าม/.test(l.message)) {
      syncHealth.push({ job: k, kind: 'skip', ageMins, message: l.message.slice(0, 120) });
    } else if (l.ok) {
      // ⚠️ จุดบอดที่ทำให้เรื่อง %ปิดการขายเพี้ยนหลุดไป 1 สัปดาห์: งานคืน ok=true พร้อมหมายเหตุ
      // "ผิดพลาด N เพจ" — ไม่ล้ม ไม่ข้าม ไม่ค้าง จึงไม่มีใครเตือน ทั้งที่ข้อมูลหายเกินครึ่ง
      // เตือนเมื่อเพจพลาดเกิน 1 ใน 3 ของเพจทั้งหมด
      const m = /ผิดพลาด (\d+) เพจ/.exec(l.message);
      const failedPages = m ? Number(m[1]) : 0;
      if (failedPages > 0 && pages.length > 0 && failedPages / pages.length > 1 / 3) {
        syncHealth.push({
          job: k, kind: 'partial', ageMins,
          message: 'ดึงข้อมูลไม่ได้ ' + failedPages + ' จาก ' + pages.length + ' เพจ — ตัวเลขที่คิดจากงานนี้จะต่ำกว่าจริง',
        });
      }
    }
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
