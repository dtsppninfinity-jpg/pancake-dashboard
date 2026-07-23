// scripts/setup/backfill-ads.ts — เติมย้อนหลัง ad_daily (ค่าแอดรายวัน)
//
// จำเป็นหลังสร้างตาราง ad_daily ครั้งแรก: งาน sync ปกติเก็บแค่ "วันนี้" กับ "เมื่อวาน"
// ถ้าไม่เติมย้อนหลัง ปุ่ม 7/30/90 วันบนหน้า Content & Ads จะเอา "ยอดขาย 7 วัน"
// ไปหารด้วย "ค่าแอดวันเดียว" → ROAS พุ่งเป็นสิบเท่า (ตัวเลขเกินจริงแบบที่เห็น)
//
//   npm run backfill:ads        → 30 วันล่าสุด
//   npm run backfill:ads 90     → 90 วันล่าสุด
import '../../lib/env';
import { fmtDateBkk, daysAgo } from '../../lib/config';
import { syncAdStatsForDate } from '../sync/jobs';

async function main() {
  const days = Math.min(95, Math.max(1, Math.round(Number(process.argv[2]) || 30)));
  console.log(`เติมค่าแอดย้อนหลัง ${days} วัน...`);
  for (let i = days - 1; i >= 0; i--) {
    const dateStr = fmtDateBkk(daysAgo(i));
    try {
      console.log(`  ${await syncAdStatsForDate(dateStr)}`);
    } catch (e: any) {
      console.error(`  ❌ ${dateStr}: ${e.message}`);
    }
  }
  console.log('✅ เสร็จ');
}

main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message); process.exit(1); });
