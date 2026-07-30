// TEMP: รัน apiSales ช่วง 35 วันในเครื่อง — reproduce จุดค้าง
import '../../lib/env';
import { apiSales } from '../../lib/api/sales';

async function main() {
  const t0 = Date.now();
  const d = await apiSales({ preset: 'custom', from: '2026-06-26', to: '2026-07-30', channel: 'facebook', compare: 'prev' });
  console.log('DONE', ((Date.now() - t0) / 1000).toFixed(1) + 's', 'rangeLabel=' + d.rangeLabel);
}
main().then(() => process.exit(0)).catch((e) => { console.error('ERR', e.message); process.exit(1); });
