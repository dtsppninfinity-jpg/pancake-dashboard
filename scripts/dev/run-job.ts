// scripts/dev/run-job.ts — รันงาน sync ตัวเดียวกับ DB จริง (ไว้ตรวจงานที่ล้มโดยไม่ต้องรอรอบ cron)
// ใช้: npx tsx scripts/dev/run-job.ts unit-alerts
// ไม่เขียน sync_log / job_stat — งานเขียนผลของตัวเองลง sync_state ตามปกติเท่านั้น
import '../../lib/env'; // ต้องเป็นบรรทัดแรก — โหลด .env.local ก่อนโมดูลอื่นอ่าน env
import * as jobs from '../sync/jobs';

const NAMES: Record<string, () => Promise<any>> = {
  'unit-alerts': jobs.syncUnitAlerts,
  orders: jobs.syncOrders,
  pages: jobs.syncPages,
  conversations: jobs.syncConversations,
  'online-status': jobs.syncOnlineStatus,
  'admins-roster': jobs.syncAdminsRoster,
  ads: jobs.syncAds,
  returns: jobs.syncReturns,
  'product-sheets': jobs.syncProductSheets,
  'kpi-sheet': jobs.syncKpiSheet,
};

const name = String(process.argv[2] || '');
const fn = NAMES[name];
if (!fn) {
  console.error('ไม่รู้จักงาน "' + name + '" — เลือกจาก: ' + Object.keys(NAMES).join(', '));
  process.exit(2);
}

const t0 = Date.now();
fn()
  .then((r) => {
    console.log('✓ ' + name + ' สำเร็จใน ' + Math.round((Date.now() - t0) / 1000) + 's');
    console.log(JSON.stringify(r).slice(0, 900));
    process.exit(0);
  })
  .catch((e) => {
    console.log('❌ ' + name + ' ล้มหลัง ' + Math.round((Date.now() - t0) / 1000) + 's: ' + ((e && e.message) || e));
    process.exit(1);
  });
