// scripts/setup/fill-ad-pages.ts — เติม page_id ให้ ad_daily ย้อนหลัง (จาก ad_creative.post_id)
// งานตัวเดียวกันรันเองทุกวันแล้ว (45 วัน) — ตัวนี้ไว้ไล่ย้อนไกลกว่านั้นตอนกู้ข้อมูล
// ใช้: npx tsx scripts/setup/fill-ad-pages.ts [days]   (default 400)
import '../../lib/env';
import { syncAdPageFill } from '../sync/jobs';

async function main() {
  const days = Math.max(1, Math.min(400, Math.round(Number(process.argv[2]) || 400)));
  console.log('✅ ' + await syncAdPageFill(days));
}

main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message); process.exit(1); });
