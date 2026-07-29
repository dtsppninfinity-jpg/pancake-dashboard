// scripts/setup/import-returns.ts — ดึงสินค้าตีกลับจากชีทของทีมเข้า Supabase (รันมือ)
// งานตัวเดียวกันรันเองทุกวันแล้วในรอบ daily — ตัวนี้ไว้ยิงทันทีตอนตั้งค่าเสร็จ/ตอนแก้ชีท
// ใช้: npm run import:returns
import '../../lib/env';
import { syncReturns } from '../sync/jobs';

async function main() {
  const t0 = Date.now();
  console.log('✅ ' + await syncReturns() + `  (${Math.round((Date.now() - t0) / 1000)}s)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message); process.exit(1); });
