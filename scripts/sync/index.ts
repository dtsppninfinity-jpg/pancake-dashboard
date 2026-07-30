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
  // ตัวเลขชุดเดียวกับหน้าสถิติแชท Pancake (ลูกค้าทั้งหมด / ลูกค้าใหม่ / ออเดอร์) — ใช้เป็น %ปิดการขาย
  await runJob('engagements-today', jobs.syncEngagementsToday);
  // สถิติตอบแชทรายแอดมิน (ตอบวันนี้ / เวลาตอบเฉลี่ย) — ย้ายจาก hourly มา fast (ทุก 15 นาที)
  // เพราะแอดมินที่ยุ่งมากยิงข้อความเร็ว เลขจะคลาดกับจอ Pancake หลายร้อยถ้าอัปเดตแค่ชั่วโมงละครั้ง
  await runJob('admin-chat-today', jobs.syncAdminChatToday);
  // ค่าแอดจริง (Meta) — ย้ายจาก hourly มา fast: เดิมค่าแอดบนหน้าเว็บช้าได้ถึง 75 นาที
  // ยิง Meta ตรงๆ ไม่ต้องวนเพจ จึงเร็วพอสำหรับรอบ 15 นาที (ต่างจาก ad-stats-today ของ Pancake)
  await runJob('meta-ads-today', jobs.syncMetaAdsToday);
}

async function runHourly(): Promise<boolean> {
  const a = await runJob('ads', jobs.syncAds);
  const b = await runJob('admins-roster', jobs.syncAdminsRoster);
  // Pancake เป็นตัวเติม page_id / ชื่อแอด / สถานะ ให้ ad_daily (วนทุกเพจ จึงหนักเกินรอบ 15 นาที)
  const c = await runJob('ad-stats-today', jobs.syncAdStatsToday);
  // ต้องยิง Meta ซ้ำ "ปิดท้าย" รอบ hourly ด้วย — เพราะ runFast (Meta) เดินก่อน runHourly (Pancake)
  // ในโปรเซสเดียวกัน ถ้าไม่ทับกลับ ค่า spend จะกลายเป็นของ Pancake (ต่ำกว่าจริง ~7%) ไปจนรอบหน้า
  const d = await runJob('meta-ads-today', jobs.syncMetaAdsToday);
  // แจ้งเตือนยูนิตขาดทุน — ตัดสินจาก "วันที่จบแล้ว" จึงเปลี่ยนวันละครั้ง แต่รันรายชั่วโมง
  // เพื่อให้ยอดของเมื่อวานที่ทยอยยืนยันเข้ามาตอนเช้าถูกนับทัน
  const e = await runJob('unit-alerts', jobs.syncUnitAlerts);
  return a && b && c && d && e;
}

async function runDaily(): Promise<boolean> {
  // ต้องมาก่อนงานอื่น — เพจใหม่ที่เพิ่งเข้าตารางจะได้ถูกดึงสถิติในรอบเดียวกันเลย
  const h = await runJob('pages', jobs.syncPages);
  const a = await runJob('chat-yesterday', jobs.syncChatYesterday);
  const b = await runJob('admin-chat-2d', () => jobs.syncAdminChatBackfill(2));
  // Meta ปรับยอด spend ย้อนหลังได้อีก 1-2 วัน — เก็บซ้ำของเมื่อวานให้ตรง (Pancake ก่อน → Meta ทับ)
  const d = await runJob('ad-stats-yesterday', jobs.syncAdStatsYesterday);
  const f = await runJob('meta-ads-yesterday', jobs.syncMetaAdsYesterday);
  // ปิดยอดของเมื่อวานให้ครบ (ออเดอร์ที่ยืนยันข้ามคืนทำให้ order_count ขยับได้)
  const e = await runJob('engagements-yesterday', jobs.syncEngagementsYesterday);
  // สื่อ/ครีเอทีฟของแอด — ครีเอทีฟไม่เปลี่ยนรายวัน วันละครั้งพอ (ดึงเฉพาะแอดที่ยังไม่มีในตาราง)
  const g = await runJob('ad-creatives', () => jobs.syncAdCreatives(14));
  // ต้องหลัง ad-creatives — งานนี้อาศัย post_id ของครีเอทีฟเติมเพจให้แถวที่ Pancake ผูกไม่ได้
  const i = await runJob('ad-page-fill', () => jobs.syncAdPageFill(45));
  // ตีกลับจากชีทของทีม — ทีมกรอกมือรายวัน วันละครั้งพอ (ไม่ต้องถี่กว่านี้)
  const j = await runJob('returns', jobs.syncReturns);
  // กำไรจริง + ค่าคอม จากชีทสรุปรายสินค้า (ต้องมาก่อน unit-alerts ที่ใช้กำไรตัดสิน)
  const k = await runJob('product-sheets', jobs.syncProductSheets);
  const c = await runJob('prune', jobs.prune);
  return a && b && c && d && e && f && g && h && i && j && k;
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
