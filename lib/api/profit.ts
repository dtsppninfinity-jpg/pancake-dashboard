// lib/api/profit.ts — กำไรจริงรายยูนิต/เดือน/ปี + ตีกลับ (บรีฟ 2026-07-31)
//
// กำไร = unit_daily.profit จากชีทสรุปรายสินค้าของทีม (หักต้นทุน+สำรองตีกลับ+Fixcost+ภาษี+คอมแล้ว)
// ⚠️ เราเป็นกระจกของชีท — ตัวเลขเพี้ยนเมื่อไหร่ให้ไปดูที่สูตรในชีท ไม่ใช่ที่นี่
// ตีกลับ = ตาราง returns (จากชีทตีกลับ) — มูลค่า price×qty สูตรเดียวกับหน้า Sales
import { db, fetchAll } from '@/lib/db';
import { getUMapDoc } from '@/lib/api/umap';

const num_ = (v: unknown): number => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};

export async function apiProfit(params: any) {
  const p = params || {};

  // ---- drill รายวัน: {u, month:'YYYY-MM'} → กำไรรายวันของยูนิตเดือนนั้น ----
  if (p.u && /^\d{4}-\d{2}$/.test(String(p.month || ''))) {
    const { data, error } = await db.from('unit_daily')
      .select('date,sales,orders,ads,profit,margin')
      .eq('u', String(p.u).toUpperCase())
      .gte('date', p.month + '-01').lte('date', p.month + '-31')
      .order('date', { ascending: true });
    if (error) throw new Error(error.message);
    return {
      ok: true,
      daily: (data || []).map((d: any) => ({
        date: String(d.date).slice(0, 10),
        sales: num_(d.sales), orders: num_(d.orders), ads: num_(d.ads),
        profit: num_(d.profit), margin: num_(d.margin),
      })),
    };
  }

  // ---- ภาพรวมปี ----
  const [rows, retRows, umap] = await Promise.all([
    fetchAll<any>(() => db.from('unit_daily').select('u,date,sales,orders,ads,profit'), 'key')
      .catch(() => [] as any[]),
    fetchAll<any>(() => db.from('returns').select('key,return_date,month,price,qty'), 'key')
      .catch(() => [] as any[]),
    getUMapDoc().catch(() => ({ units: [] as any[] })),
  ]);
  if (!rows.length) return { setupNeeded: true };

  const productOf: Record<string, string> = {};
  (umap.units || []).forEach((x: any) => { productOf[String(x.u)] = String(x.product || ''); });

  interface Cell { profit: number; sales: number; ads: number }
  const byUnit: Record<string, { months: Record<string, Cell>; total: Cell; hasData: boolean }> = {};
  const monthTotals: Record<string, Cell> = {};
  const monthsSet = new Set<string>();
  const year = String(rows.map((r) => String(r.date).slice(0, 4)).sort().pop() || new Date().getFullYear());

  rows.forEach((r) => {
    const d = String(r.date).slice(0, 10);
    if (!d.startsWith(year)) return; // โฟกัสปีล่าสุดที่มีข้อมูล
    const m = d.slice(0, 7);
    monthsSet.add(m);
    const u = String(r.u);
    const cell = { profit: num_(r.profit), sales: num_(r.sales), ads: num_(r.ads) };
    const bu = (byUnit[u] = byUnit[u] || { months: {}, total: { profit: 0, sales: 0, ads: 0 }, hasData: false });
    const mc = (bu.months[m] = bu.months[m] || { profit: 0, sales: 0, ads: 0 });
    const mt = (monthTotals[m] = monthTotals[m] || { profit: 0, sales: 0, ads: 0 });
    for (const k of ['profit', 'sales', 'ads'] as const) {
      mc[k] += cell[k]; bu.total[k] += cell[k]; mt[k] += cell[k];
    }
    if (cell.profit !== 0 || cell.sales > 0 || cell.ads > 0) bu.hasData = true;
  });

  // ตีกลับรายเดือน — ยึด return_date (คอลัมน์ month ในชีทพิมพ์มือ ไว้ใจไม่ได้)
  const returnsByMonth: Record<string, { value: number; items: number }> = {};
  let retYearValue = 0, retYearItems = 0;
  retRows.forEach((x) => {
    const d = String(x.return_date || '').slice(0, 10);
    if (!d.startsWith(year)) return;
    const m = d.slice(0, 7);
    const v = num_(x.price) * (num_(x.qty) || 1);
    const b = (returnsByMonth[m] = returnsByMonth[m] || { value: 0, items: 0 });
    b.value += v; b.items++;
    retYearValue += v; retYearItems++;
  });

  const months = Array.from(monthsSet).sort();
  const units = Object.keys(byUnit)
    .filter((u) => byUnit[u].hasData)
    .map((u) => ({
      u,
      product: productOf[u] || '',
      months: Object.fromEntries(months.map((m) => {
        const c = byUnit[u].months[m];
        return [m, c ? { profit: Math.round(c.profit), sales: Math.round(c.sales), ads: Math.round(c.ads) } : null];
      })),
      total: {
        profit: Math.round(byUnit[u].total.profit),
        sales: Math.round(byUnit[u].total.sales),
        ads: Math.round(byUnit[u].total.ads),
      },
    }))
    .sort((a, b) => b.total.profit - a.total.profit);

  return {
    setupNeeded: false,
    year,
    months,
    units,
    monthTotals: Object.fromEntries(months.map((m) => {
      const c = monthTotals[m];
      return [m, { profit: Math.round(c.profit), sales: Math.round(c.sales), ads: Math.round(c.ads) }];
    })),
    returnsByMonth: Object.fromEntries(Object.keys(returnsByMonth).sort().map((m) => [m, {
      value: Math.round(returnsByMonth[m].value), items: returnsByMonth[m].items,
    }])),
    totals: {
      profit: Math.round(units.reduce((s, x) => s + x.total.profit, 0)),
      sales: Math.round(units.reduce((s, x) => s + x.total.sales, 0)),
      ads: Math.round(units.reduce((s, x) => s + x.total.ads, 0)),
      returnValue: Math.round(retYearValue),
      returnItems: retYearItems,
    },
  };
}
