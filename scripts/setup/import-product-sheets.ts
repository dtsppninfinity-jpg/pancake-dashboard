// scripts/setup/import-product-sheets.ts — ดึงกำไรจริง + ค่าคอม จากชีทสรุปรายสินค้า (รันมือ)
// งานตัวเดียวกันรันเองทุกวันในรอบ daily — ตัวนี้ไว้ยิงทันทีตอนตั้งค่าเสร็จ/ตอนแก้ชีท
// ใช้: npm run import:product-sheets
import '../../lib/env';
import { syncProductSheets } from '../sync/jobs';

async function main() {
  const t0 = Date.now();
  console.log('✅ ' + await syncProductSheets() + `  (${Math.round((Date.now() - t0) / 1000)}s)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message); process.exit(1); });
