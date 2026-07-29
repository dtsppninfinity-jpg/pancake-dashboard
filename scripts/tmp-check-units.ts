// ชั่วคราว — ตรวจตัวเลขยูนิตที่ apiSales ส่งออก (ลบทิ้งหลังใช้)
import '../lib/env';
import { apiSales } from '../lib/api/sales';

async function main() {
  const res: any = await apiSales({ preset: '30d' });
  const units = res.top.all.units;
  console.log('ยูนิตทั้งหมด', units.length);
  console.log('U      ยอดขาย      สัดส่วน  ค่าแอด     ROAS  ค่าทัก  %ปิด   คนทัก  วีค  สินค้า');
  units.slice(0, 14).forEach((u: any) => {
    console.log(
      String(u.u || '-').padEnd(6),
      String(u.revenue).padStart(9),
      String(u.share ?? '-').padStart(7),
      String(u.spend).padStart(9),
      String(u.roas ?? '-').padStart(6),
      String(u.costPerMsg ?? '-').padStart(6),
      String(u.closeRate ?? '-').padStart(5),
      String(u.reached).padStart(6),
      String((u.weekly || []).length).padStart(3),
      String(u.product || '').slice(0, 24),
    );
  });
  const sumRev = units.reduce((s: number, u: any) => s + u.revenue, 0);
  const sumSpend = units.reduce((s: number, u: any) => s + u.spend, 0);
  const sumShare = units.reduce((s: number, u: any) => s + (u.share || 0), 0);
  console.log('\nรวมยอดยูนิต', sumRev, '| ยอดรวมหลัก', res.kpi ? res.kpi.revenue : '?', '| ค่าแอดรวมยูนิต', sumSpend,
    '| ค่าแอดหลัก', res.adCost ? Math.round(res.adCost.spend) : '?', '| สัดส่วนรวม', Math.round(sumShare * 10) / 10);
  console.log('fb units', res.top.facebook.units.length, '| line units', res.top.line.units.length);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
