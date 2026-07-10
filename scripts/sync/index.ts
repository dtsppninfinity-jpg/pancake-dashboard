// scripts/sync/index.ts — orchestrator ที่ GitHub Actions เรียก
// ใช้: npm run sync -- <mode>   (mode = fast | hourly | daily)
import '../../lib/env'; // ต้องเป็นบรรทัดแรก — โหลด .env.local ก่อนโมดูลอื่นอ่าน env
import { logJob } from '../../lib/supabase';
import * as jobs from './jobs';

async function runJob(name: string, fn: () => Promise<string>): Promise<void> {
  const t0 = Date.now();
  try {
    const msg = await fn();
    const ms = Date.now() - t0;
    console.log(`✅ ${name} (${ms}ms): ${msg}`);
    await logJob(name, true, msg, ms);
  } catch (e: any) {
    const ms = Date.now() - t0;
    console.error(`❌ ${name} (${ms}ms): ${e.message}`);
    await logJob(name, false, e.message || String(e), ms);
  }
}

const MODE = (process.argv[2] || 'fast').toLowerCase();

async function main() {
  console.log(`▶ เริ่ม sync (mode = ${MODE})`);
  if (MODE === 'fast') {
    await runJob('orders', jobs.syncOrders);
    await runJob('chat-today', jobs.syncChatToday);
    await runJob('conversations', jobs.syncConversations);
    await runJob('online-status', jobs.syncOnlineStatus);
  } else if (MODE === 'hourly') {
    await runJob('ads', jobs.syncAds);
    await runJob('admins-roster', jobs.syncAdminsRoster);
    await runJob('admin-chat-today', jobs.syncAdminChatToday);
  } else if (MODE === 'daily') {
    await runJob('chat-yesterday', jobs.syncChatYesterday);
    await runJob('admin-chat-2d', () => jobs.syncAdminChatBackfill(2));
    await runJob('prune', jobs.prune);
  } else {
    console.error(`mode ไม่รู้จัก: ${MODE} (ต้องเป็น fast | hourly | daily)`);
    process.exit(1);
  }
  console.log('■ เสร็จสิ้น');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
