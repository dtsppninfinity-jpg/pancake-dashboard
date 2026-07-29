// Backfill ค่าแอด "จริง" จาก Meta ลง ad_daily ย้อนหลัง N วัน (default 90)
// ใช้: npx tsx scripts/setup/backfill-meta-ads.ts [days]
// ทับ spend/เลข Meta ของทุกวันในช่วง (merge — คง page_id/ชื่อที่ Pancake ใส่)
import '../../lib/env';
import { syncMetaAdsRange } from '../sync/jobs';
import { fmtDateBkk, daysAgo } from '../../lib/config';

async function main() {
  // เพดาน 400 วันให้ตรงกับ RETENTION_DAYS.AD_DAILY (เดิม 95 = ดึงย้อนได้ไม่เกิน retention เก่า)
  // ต้นทาง Meta เก็บ insights ได้ 37 เดือน แต่ธุรกิจนี้เพิ่งเริ่ม ~มี.ค. 2026 ยิงเกินไปก็ได้ 0
  const days = Math.max(1, Math.min(400, Math.round(Number(process.argv[2]) || 90)));
  const CHUNK = 30; // แบ่งเป็นหน้าต่าง ~30 วัน กัน range ยาวเกินของ Meta insights
  console.log(`▶ backfill Meta ads ย้อนหลัง ${days} วัน (ทีละ ${CHUNK} วัน)`);
  const failed: string[] = [];
  for (let start = days; start >= 1; start -= CHUNK) {
    const since = fmtDateBkk(daysAgo(start));
    const untilOffset = Math.max(1, start - CHUNK + 1);
    const until = fmtDateBkk(daysAgo(untilOffset));
    const t0 = Date.now();
    // ช่วงหนึ่งพังไม่ควรทิ้งช่วงที่เหลือ (รอบก่อนเน็ตหลุดตอนเขียน DB แล้วงานตายทั้งดุ้น)
    try {
      const msg = await syncMetaAdsRange(since, until);
      console.log(`  ✅ ${msg} (${Math.round((Date.now() - t0) / 1000)}s)`);
    } catch (e: any) {
      failed.push(`${since}..${until}`);
      console.log(`  ❌ ${since}..${until}: ${e?.message || e} (${Math.round((Date.now() - t0) / 1000)}s)`);
    }
  }
  if (failed.length) {
    console.log(`■ จบแบบไม่ครบ — ${failed.length} ช่วงล้มเหลว: ${failed.join(', ')} (รันซ้ำได้ ทุกอย่างเป็น upsert)`);
    process.exitCode = 1;
    return;
  }
  console.log('■ เสร็จ');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
