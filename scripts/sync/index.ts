// scripts/sync/index.ts — orchestrator ที่ GitHub Actions / external pinger เรียก
// ใช้: npm run sync -- <mode>   (mode = fast | hourly | daily)
//
// โหมด fast = งานทุก 15 นาที (ออเดอร์/แชท/บทสนทนา/ออนไลน์) + จัดการ hourly/daily ให้เองตามรอบ
// (idempotent ผ่าน sync_state) → pinger ตัวเดียวที่ยิง fast ทุก 15 นาที ก็ครบทุกงาน
import '../../lib/env'; // ต้องเป็นบรรทัดแรก — โหลด .env.local ก่อนโมดูลอื่นอ่าน env
import { logJob } from '../../lib/supabase';
import * as jobs from './jobs';
import { dueHourly, markHourly, dueDaily, markDaily } from './schedule';

/** รันงาน 1 ตัว — คืน true ถ้าสำเร็จ (error ถูกกลืน+log ไว้ ไม่ throw ต่อ) */
async function runJob(name: string, fn: () => Promise<string>): Promise<boolean> {
  const t0 = Date.now();
  try {
    const msg = await fn();
    const ms = Date.now() - t0;
    console.log(`✅ ${name} (${ms}ms): ${msg}`);
    await logJob(name, true, msg, ms);
    return true;
  } catch (e: any) {
    const ms = Date.now() - t0;
    console.error(`❌ ${name} (${ms}ms): ${e.message}`);
    await logJob(name, false, e.message || String(e), ms);
    return false;
  }
}

async function runFast(): Promise<void> {
  await runJob('orders', jobs.syncOrders);
  await runJob('chat-today', jobs.syncChatToday);
  await runJob('conversations', jobs.syncConversations);
  await runJob('online-status', jobs.syncOnlineStatus);
}

async function runHourly(): Promise<boolean> {
  const a = await runJob('ads', jobs.syncAds);
  const b = await runJob('admins-roster', jobs.syncAdminsRoster);
  const c = await runJob('admin-chat-today', jobs.syncAdminChatToday);
  return a && b && c;
}

async function runDaily(): Promise<boolean> {
  const a = await runJob('chat-yesterday', jobs.syncChatYesterday);
  const b = await runJob('admin-chat-2d', () => jobs.syncAdminChatBackfill(2));
  const c = await runJob('prune', jobs.prune);
  return a && b && c;
}

const MODE = (process.argv[2] || 'fast').toLowerCase();

async function main() {
  console.log(`▶ เริ่ม sync (mode = ${MODE})`);
  if (MODE === 'fast' || MODE === 'auto') {
    await runFast();

    // pinger 15 นาทีตัวเดียวจัดการงานรายชั่วโมง/รายวันเอง (idempotent ผ่าน sync_state)
    // ใช้ now ค่าเดียวตลอด block — กัน mark ข้ามวันตอนรันคาบเที่ยงคืน
    const now = new Date();

    if (await dueHourly(now)) {
      console.log('↻ ถึงรอบ hourly');
      // ทำเครื่องหมาย "ตอนเริ่ม" (ไม่ใช่ตอนจบ) — กันเวลารันของงานไปกินช่วงห่าง ให้คาบคงที่ ~60 นาที
      await markHourly(now);
      await runHourly();
    }

    if (await dueDaily(now)) {
      console.log('↻ ถึงรอบ daily');
      // ทำเครื่องหมายเฉพาะเมื่อสำเร็จครบ — ถ้าล้มเหลว (เช่น API ล่มช่วงตี 2) ปล่อยให้รอบ 15 นาทีถัดไปลองใหม่ในวันเดียวกัน
      const ok = await runDaily();
      if (ok) await markDaily(now);
      else console.log('⚠️ daily มีงานล้มเหลว — ยังไม่ทำเครื่องหมาย จะลองใหม่รอบถัดไป');
    }
  } else if (MODE === 'hourly') {
    await runHourly();
  } else if (MODE === 'daily') {
    await runDaily();
  } else {
    console.error(`mode ไม่รู้จัก: ${MODE} (ต้องเป็น fast | hourly | daily | auto)`);
    process.exit(1);
  }
  console.log('■ เสร็จสิ้น');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
