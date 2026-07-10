// scripts/setup/backfill.ts — ดึงข้อมูลย้อนหลังครั้งแรก (port จาก menuInitialSync)
// GitHub Actions / เครื่อง local ไม่มีลิมิต 6 นาที → ทำครบทุกขั้นในรอบเดียวได้เลย ไม่ต้องแบ่ง chunk
// เขียนความคืบหน้าลง sync_state ('backfill') ให้ `npm run watch` ดู progress ได้
import '../../lib/env';
import { requireCredentials, daysAgo } from '../../lib/config';
import { setState } from '../../lib/supabase';
import * as jobs from '../sync/jobs';

const STEPS: [string, () => Promise<string>][] = [
  ['ออเดอร์ 30 วัน', () => jobs.syncOrdersBackfill(30)],
  ['สถิติแชท 7 วัน', () => jobs.syncChatStats(daysAgo(7), new Date())],
  ['บทสนทนา', () => jobs.syncConversations()],
  ['รายชื่อแอดมิน', () => jobs.syncAdminsRoster()],
  ['แอด', () => jobs.syncAds()],
  ['สถิติแอดมิน 7 วัน', () => jobs.syncAdminChatBackfill(7)],
  ['สถิติแอดมินวันนี้', () => jobs.syncAdminChatToday()],
];

async function main() {
  requireCredentials();
  console.log('🚀 เริ่ม backfill (ร้านใหญ่อาจใช้เวลาหลายนาที — ปล่อยให้รันจนจบ)\n');
  await setState('backfill', JSON.stringify({ current: 0, total: STEPS.length, done: false }));

  for (let i = 0; i < STEPS.length; i++) {
    const [label, fn] = STEPS[i];
    await setState('backfill', JSON.stringify({ current: i + 1, total: STEPS.length, label, done: false }));
    const t0 = Date.now();
    process.stdout.write(`⏳ ${i + 1}/${STEPS.length} ${label} ... `);
    const msg = await fn();
    console.log(`${msg}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }

  await setState('backfill', JSON.stringify({ current: STEPS.length, total: STEPS.length, label: 'เสร็จ', done: true }));
  console.log('\n✅ backfill เสร็จครบทุกขั้นแล้ว');
}

main().then(() => process.exit(0)).catch((e) => { console.error('\n❌', e.message); process.exit(1); });
