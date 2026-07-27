// Backfill สื่อ/ครีเอทีฟของแอด (รูป/คลิป/ลิงก์โพสต์) จาก Meta ลงตาราง ad_creative
//
// ใช้: npx tsx scripts/setup/backfill-ad-creatives.ts [วัน] [force|all]
//   วัน   = ย้อนหลังกี่วันของ ad_daily ที่จะเติมครีเอทีฟให้ (default 30)
//   force = ดึงใหม่ทับของเดิมด้วย (ปกติดึงเฉพาะแอดที่ยังไม่มีในตาราง)
//   all   = กวาดทุกแอดในทุกบัญชีผ่าน /act_{id}/ads (ไม่อิง ad_daily — ช้ามาก 25k+ แอด)
//
// ⚠️ ต้องรัน db/migrations/2026-07-27-ad-creative.sql ใน Supabase ก่อน ไม่งั้นสคริปต์จะบอกให้ไปรัน
import '../../lib/env';
import { syncAdCreatives, syncAdCreativesAllAccounts } from '../sync/jobs';

async function main() {
  const mode = String(process.argv[3] || '').toLowerCase();
  const t0 = Date.now();
  let msg: string;
  if (mode === 'all') {
    console.log('▶ backfill ครีเอทีฟ: กวาดทุกบัญชี (/act_{id}/ads)');
    msg = await syncAdCreativesAllAccounts();
  } else {
    const days = Math.max(1, Math.min(95, Math.round(Number(process.argv[2]) || 30)));
    console.log(`▶ backfill ครีเอทีฟของแอดใน ad_daily ย้อนหลัง ${days} วัน` +
      (mode === 'force' ? ' (ดึงใหม่ทับของเดิม)' : ' (เฉพาะที่ยังไม่มี)'));
    msg = await syncAdCreatives(days, mode === 'force');
  }
  console.log(`  ✅ ${msg} (${Math.round((Date.now() - t0) / 1000)}s)`);
  console.log('■ เสร็จ');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
