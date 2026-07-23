// scripts/setup/backfill-engagements.ts — เติมย้อนหลัง chat_engagement_daily
//
// ใช้ครั้งเดียวหลังรัน migration db/migrations/2026-07-23-chat-engagement.sql
// (งาน sync ปกติเก็บแค่ "วันนี้" กับ "เมื่อวาน" — ช่วง 7/30 วันบนหน้าเว็บจึงต้องเติมย้อนหลังก่อน)
//
//   npm run backfill:engagements        → 30 วันล่าสุด
//   npm run backfill:engagements 90     → 90 วันล่าสุด
import '../../lib/env';
import { fmtDateBkk, daysAgo } from '../../lib/config';
import { syncEngagementsForDate } from '../sync/jobs';

async function main() {
  const days = Math.min(95, Math.max(1, Math.round(Number(process.argv[2]) || 30)));
  console.log(`เติมย้อนหลัง ${days} วัน...`);
  // เพจที่ Pancake ตอบ HTTP 500 (เพจร้าง) จะพังทุกวันเหมือนกัน — จำไว้แล้วข้าม
  // ไม่งั้นเสีย ~5 วินาที/เพจ/วัน ไปกับการ retry ที่ไม่มีวันสำเร็จ
  const skip = new Set<string>();
  for (let i = days - 1; i >= 0; i--) {
    const dateStr = fmtDateBkk(daysAgo(i));
    try {
      console.log(`  ${await syncEngagementsForDate(dateStr, skip)}`);
    } catch (e: any) {
      console.error(`  ❌ ${dateStr}: ${e.message}`);
    }
  }
  if (skip.size) console.log(`ℹ️ ข้าม ${skip.size} เพจที่ Pancake ตอบ error (เพจร้าง ไม่มีทราฟฟิก)`);
  console.log('✅ เสร็จ');
}

main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message); process.exit(1); });
