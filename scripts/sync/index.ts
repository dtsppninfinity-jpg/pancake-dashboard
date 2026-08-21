// scripts/sync/index.ts — orchestrator ที่ GitHub Actions / external pinger เรียก
// ใช้: npm run sync -- <mode>   (mode = fast | hourly | daily)
//
// โหมด fast = งานทุก 15 นาที (ออเดอร์/แชท/บทสนทนา/ออนไลน์) + จัดการ hourly/daily ให้เองตามรอบ
// (idempotent ผ่าน sync_state) → pinger ตัวเดียวที่ยิง fast ทุก 15 นาที ก็ครบทุกงาน
import '../../lib/env'; // ต้องเป็นบรรทัดแรก — โหลด .env.local ก่อนโมดูลอื่นอ่าน env
import { logJob, loadJobStats, saveJobStat } from '../../lib/supabase';
import { toResult, type JobOutput, type StoredJobStat } from '../../lib/jobstat';
import * as jobs from './jobs';
import { dueHourly, markHourly, dueDaily, markDaily } from './schedule';
import { checkEnv } from './envcheck';
import { checkInvariants } from './invariants';

/** สถิติรอบก่อนของทุกงาน — โหลดครั้งเดียว ใช้เทียบว่า "แถวหายไปครึ่ง" ไหม */
let prevStats: Record<string, StoredJobStat> = {};

/**
 * รันงาน 1 ตัว — คืน true ถ้าทำงานจนจบโดยไม่ throw (ใช้ตัดสินว่ารอบ daily ผ่านไหม)
 *
 * งานที่ "ข้ามตัวเอง" (skipped — ขาด env / ยังไม่มีตาราง) ถูกบันทึกเป็น ok=false ใน log
 * เพื่อให้ตัวเฝ้าระวังฟ้อง แต่ยังคืน true เพราะรันซ้ำอีกกี่รอบก็ข้ามเหมือนเดิม (คนต้องไปตั้ง env)
 */
async function runJob(name: string, fn: () => Promise<JobOutput>): Promise<boolean> {
  const t0 = Date.now();
  try {
    const r = toResult(await fn());
    const ms = Date.now() - t0;
    const ok = !r.skipped;
    console.log(`${ok ? '✅' : '⏭️'} ${name} (${ms}ms): ${r.message}`);
    await logJob(name, ok, r.message, ms);
    await recordStat(name, ok, r.message, ms, r);
    return true;
  } catch (e: any) {
    const ms = Date.now() - t0;
    const msg = e.message || String(e);
    console.error(`❌ ${name} (${ms}ms): ${msg}`);
    await logJob(name, false, msg, ms);
    await recordStat(name, false, msg, ms, {});
    return false;
  }
}

/** เก็บ "ใบรายงานผล" ของรอบนี้ พร้อมพก rowsWritten ของรอบก่อนไปด้วย (ไว้เทียบข้อมูลหาย) */
async function recordStat(job: string, ok: boolean, message: string, ms: number, stat: any): Promise<void> {
  const prev = prevStats[job];
  // เทียบจำนวนแถวข้ามรอบได้เฉพาะเมื่อรอบก่อนทำ "ข้อมูลชุดเดียวกัน" (scope ตรงกัน)
  // ไม่งั้นพอขึ้นวันใหม่ งาน *-today จะถูกหาว่าข้อมูลหายทุกเที่ยงคืน
  const sameScope = !!(prev && prev.scope && stat.scope && prev.scope === stat.scope);
  // ฐานเทียบต้องเป็น "รอบที่เขียนได้จริง" ครั้งล่าสุด — ถ้ารอบก่อนล้ม (0 แถว) แล้วเอามาเป็นฐาน
  // เกณฑ์ "หายเกินครึ่ง" จะพังทันที
  const prevRows = !sameScope ? null
    : (prev!.ok && prev!.rowsWritten ? prev!.rowsWritten : (prev!.prevRows ?? null));
  const cur: StoredJobStat = {
    job, ts: new Date().toISOString(), ok, ms, message: String(message).slice(0, 300),
    subject: stat.subject, unitsOk: stat.unitsOk, unitsFailed: stat.unitsFailed,
    unitsTotal: stat.unitsTotal, rowsWritten: stat.rowsWritten, skipped: stat.skipped,
    scope: stat.scope, prevRows,
  };
  await saveJobStat(cur).catch(() => { /* เก็บสถิติไม่ได้ ไม่ควรทำให้รอบ sync ล้ม */ });
  prevStats[job] = cur;
}

/** ตรวจว่าตัวเลขที่ได้ "เป็นไปได้" ไหม — ผลเขียนเป็นงาน invariants ให้หน้าเว็บฟ้อง */
async function runInvariants(): Promise<void> {
  const t0 = Date.now();
  try {
    const r = await checkInvariants();
    console.log(`${r.ok ? '🩺' : '🚨'} invariants: ${r.message}`);
    await logJob('invariants', r.ok, r.message, Date.now() - t0);
  } catch (e: any) {
    console.error('❌ invariants:', e.message);
    await logJob('invariants', false, 'ตรวจไม่สำเร็จ: ' + (e.message || String(e)), Date.now() - t0);
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
  // ทะเบียนเพจต้องมาก่อนงานที่วนตามรายชื่อเพจ (admins-roster/ad-stats)
  // เดิมอยู่แค่รอบ daily ตอนตี 2 — เพจที่ทีมเปิดใหม่ตอนกลางวันจึงหาไม่เจอใน U Map ทั้งวัน
  // (เจอจริง 21 ส.ค.: หัวหน้าจับคู่เพจ Myco 2 ตัวไม่ได้ตอนเที่ยงคืนครึ่ง ทั้งที่ขายมาแล้วตั้งแต่บ่าย)
  const h = await runJob('pages', jobs.syncPages);
  const a = await runJob('ads', jobs.syncAds);
  const b = await runJob('admins-roster', jobs.syncAdminsRoster);
  // Pancake เป็นตัวเติม page_id / ชื่อแอด / สถานะ ให้ ad_daily (วนทุกเพจ จึงหนักเกินรอบ 15 นาที)
  const c = await runJob('ad-stats-today', jobs.syncAdStatsToday);
  // ต้องยิง Meta ซ้ำ "ปิดท้าย" รอบ hourly ด้วย — เพราะ runFast (Meta) เดินก่อน runHourly (Pancake)
  // ในโปรเซสเดียวกัน ถ้าไม่ทับกลับ ค่า spend จะกลายเป็นของ Pancake (ต่ำกว่าจริง ~7%) ไปจนรอบหน้า
  const d = await runJob('meta-ads-today', jobs.syncMetaAdsToday);
  // "คนทัก" (messaging_started) ของ Meta รายงานช้า/แก้ย้อนหลังได้เป็นวัน — ดึงเมื่อวานซ้ำรายชั่วโมง
  // ให้ %ปิดจากแอดของเมื่อวานนิ่งเร็วที่สุด (เดิมดึงแค่รอบ daily ตอนเช้า เลขค้างสูงเกินจริงทั้งวัน)
  const g = await runJob('meta-ads-yesterday', jobs.syncMetaAdsYesterday);
  // แจ้งเตือนยูนิตขาดทุน — ตัดสินจาก "วันที่จบแล้ว" จึงเปลี่ยนวันละครั้ง แต่รันรายชั่วโมง
  // เพื่อให้ยอดของเมื่อวานที่ทยอยยืนยันเข้ามาตอนเช้าถูกนับทัน
  const e = await runJob('unit-alerts', jobs.syncUnitAlerts);
  // ชีทของทีม 2 ใบ — ทั้งคู่ยิงครั้งเดียวจบ (batchGet) ถูกพอสำหรับรอบชั่วโมง
  // เดิมอยู่รอบ daily ตอนตี 2 ทีมแก้ชีทตอนกลางวันแล้วหน้าเว็บไม่ขยับจนวันรุ่งขึ้น เข้าใจว่าระบบดึงค่าผิด
  const f = await runJob('kpi-sheet', jobs.syncKpiSheet);
  const i = await runJob('roster-sheet', jobs.syncRosterSheet);
  return a && b && c && d && e && f && g && h && i;
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
  // ขาดกุญแจตัวจำเป็น = หยุดทั้งรอบและฟ้อง — ห้ามปล่อยให้งานทยอย "ข้าม" ตัวเองเงียบๆ
  if (!(await checkEnv())) {
    console.error('■ หยุดรอบนี้ — ตั้ง env ให้ครบก่อน (ดูรายชื่อด้านบน)');
    process.exit(1);
  }
  prevStats = await loadJobStats().catch(() => ({}));

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
      // ตรวจความสมเหตุสมผลรอบชั่วโมง — กฎเกือบทั้งหมดดู "เมื่อวาน" จึงไม่ต้องตรวจทุก 15 นาที
      await runInvariants();
    }

    if (await dueDaily(now)) {
      console.log('↻ ถึงรอบ daily');
      // ทำเครื่องหมายเฉพาะเมื่อสำเร็จครบ — ถ้าล้มเหลว (เช่น API ล่มช่วงตี 2) ปล่อยให้รอบ 15 นาทีถัดไปลองใหม่ในวันเดียวกัน
      const ok = await runDaily();
      if (ok) await markDaily(now);
      else console.log('⚠️ daily มีงานล้มเหลว — ยังไม่ทำเครื่องหมาย จะลองใหม่รอบถัดไป');
      await runInvariants();
    }
  } else if (MODE === 'hourly') {
    await runHourly();
    await runInvariants();
  } else if (MODE === 'daily') {
    await runDaily();
    await runInvariants();
  } else {
    console.error(`mode ไม่รู้จัก: ${MODE} (ต้องเป็น fast | hourly | daily | auto)`);
    process.exit(1);
  }
  console.log('■ เสร็จสิ้น');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
