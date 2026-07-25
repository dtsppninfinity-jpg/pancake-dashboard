// Backfill ค่าแอด "จริง" จาก Meta ลง ad_daily ย้อนหลัง N วัน (default 90)
// ใช้: npx tsx scripts/setup/backfill-meta-ads.ts [days]
// ทับ spend/เลข Meta ของทุกวันในช่วง (merge — คง page_id/ชื่อที่ Pancake ใส่)
import '../../lib/env';
import { syncMetaAdsRange } from '../sync/jobs';
import { fmtDateBkk, daysAgo } from '../../lib/config';

async function main() {
  const days = Math.max(1, Math.min(95, Math.round(Number(process.argv[2]) || 90)));
  const CHUNK = 30; // แบ่งเป็นหน้าต่าง ~30 วัน กัน range ยาวเกินของ Meta insights
  console.log(`▶ backfill Meta ads ย้อนหลัง ${days} วัน (ทีละ ${CHUNK} วัน)`);
  for (let start = days; start >= 1; start -= CHUNK) {
    const since = fmtDateBkk(daysAgo(start));
    const untilOffset = Math.max(1, start - CHUNK + 1);
    const until = fmtDateBkk(daysAgo(untilOffset));
    const t0 = Date.now();
    const msg = await syncMetaAdsRange(since, until);
    console.log(`  ✅ ${msg} (${Math.round((Date.now() - t0) / 1000)}s)`);
  }
  console.log('■ เสร็จ');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
