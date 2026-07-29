// app/api/public/cron/delta/route.ts — "ยอดเรียลไทม์": ดึงออเดอร์ที่เพิ่งขยับ ทุก 1 นาที
//
// ทำไมไม่ใช้ GitHub Actions: cron ของ GitHub ละเอียดสุด 5 นาที และดีเลย์จริง 5-15 นาทีบ่อยมาก
// ทั้งยังต้อง checkout + npm ci (~40 วิ) ต่อรอบ — แพงเกินสำหรับคาบ 1 นาที
// เส้นนี้รันบน Vercel (region sin1 ใกล้ Pancake) จบใน ~2-3 วิ ให้ cron-job.org ยิงทุก 1 นาที
// รอบ fast 15 นาทีของ GitHub Actions ยังอยู่เหมือนเดิม — ตัวนี้แค่ "แซง" เรื่องออเดอร์ให้สดขึ้น
//
// ความปลอดภัย: middleware ยกเว้น /api/public/* จากรหัสทีม เส้นนี้จึงต้องกันตัวเอง
// ต้องแนบ CRON_SECRET มาทาง header `x-cron-secret` หรือ `?key=` — ไม่ตั้ง env = ปิดตาย (401)
import { syncOrdersDelta } from '@/scripts/sync/jobs';
import { getState, setState, logJob } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LOCK_KEY = 'delta_running_at';
const LAST_KEY = 'last_delta_at';
// รอบก่อนค้างเกิน 3 นาที = ถือว่าโปรเซสตายไปแล้ว ปล่อยรอบใหม่วิ่งต่อ (กันล็อกค้างถาวร)
const LOCK_TTL_MS = 3 * 60 * 1000;

async function run(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const secret = process.env.CRON_SECRET || '';
  const given = req.headers.get('x-cron-secret') || url.searchParams.get('key') || '';
  if (!secret || given !== secret) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const minutes = Math.max(1, Math.min(120, Math.round(Number(url.searchParams.get('minutes')) || 20)));

  // กันสองรอบทับกัน (ออเดอร์เดียวกัน upsert พร้อมกัน = เปลือง API quota เปล่าๆ)
  const lock = await getState(LOCK_KEY);
  const lockT = lock ? new Date(lock).getTime() : 0;
  if (lockT && Date.now() - lockT < LOCK_TTL_MS) {
    return Response.json({ ok: true, skipped: 'รอบก่อนยังไม่จบ', since: lock });
  }
  await setState(LOCK_KEY, new Date().toISOString());

  const t0 = Date.now();
  try {
    const msg = await syncOrdersDelta(minutes);
    const ms = Date.now() - t0;
    await setState(LAST_KEY, new Date().toISOString());
    return Response.json({ ok: true, msg, ms });
  } catch (e: any) {
    const ms = Date.now() - t0;
    // ลงตารางเฉพาะตอนพัง — สำเร็จทุกนาที = 1,440 แถว/วัน รกเปล่าๆ
    await logJob('orders-delta', false, e?.message || String(e), ms);
    return Response.json({ ok: false, error: e?.message || 'internal error', ms }, { status: 500 });
  } finally {
    await setState(LOCK_KEY, '');
  }
}

export const GET = run;
export const POST = run;
