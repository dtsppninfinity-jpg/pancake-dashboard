// scripts/setup/import-kpi.ts — ดึงคะแนน KPI จากชีทกลางทันที (งานเดียวกันรันรายวันอยู่แล้ว)
// ใช้: npm run import:kpi
import '../../lib/env';
import { syncKpiSheet } from '../sync/jobs';

async function main() {
  const t0 = Date.now();
  console.log('✅ ' + await syncKpiSheet() + `  (${Math.round((Date.now() - t0) / 1000)}s)`);
}
main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message); process.exit(1); });
