// lib/api/kpi.ts — KPI ทีมขาย (แอดมิน/รองหัวหน้า/หัวหน้า) + ท็อปประจำเดือน/ปี
// อ่านคะแนนที่ sync จากชีท KPI กลาง (sync_state 'kpi_scores' — jobs.syncKpiSheet รายวัน)
// เราไม่คำนวณคะแนนเอง สูตรอยู่ในชีทของทีม — หน้าเว็บคือกระจกของชีท + จัดอันดับให้ดูง่าย
import { db } from '@/lib/db';
import type { KpiAdminMonthRow, KpiSubMonthRow, KpiHeadMonth, KpiAdminYearRow } from '@/lib/kpisheet';

interface KpiDoc {
  year: number;
  admin: Record<number, KpiAdminMonthRow[]>;
  sub: Record<number, KpiSubMonthRow[]>;
  head: Record<number, KpiHeadMonth[]>;
  adminYear: KpiAdminYearRow[];
  updatedAt: string;
}

/** รวมแถว (คน,ยูนิต) → รายคน: ยอดรวมทุกยูนิต + คะแนนถ่วงด้วยยอดขาย (ยูนิตใหญ่น้ำหนักมากกว่า) */
function perPerson_(rows: KpiAdminMonthRow[]) {
  const by: Record<string, any> = {};
  rows.forEach((r) => {
    const a = (by[r.id] = by[r.id] || { id: r.id, name: r.name, nick: r.nick, units: [], sales: 0, _sw: 0, _w: 0 });
    a.units.push(r.unit);
    a.sales += r.sales;
    const w = r.sales > 0 ? r.sales : 1;
    a._sw += r.score * w;
    a._w += w;
  });
  return Object.values(by).map((a: any) => ({
    id: a.id, name: a.name, nick: a.nick, units: a.units,
    sales: Math.round(a.sales),
    score: a._w ? Math.round((a._sw / a._w) * 1000) / 1000 : 0,
  }));
}

export async function apiKpi(params: any) {
  const { data, error } = await db.from('sync_state').select('value').eq('key', 'kpi_scores').maybeSingle();
  if (error) throw new Error('อ่าน kpi_scores ไม่สำเร็จ: ' + error.message);
  if (!data || !data.value) return { setupNeeded: true };
  let doc: KpiDoc;
  try { doc = JSON.parse(String(data.value)); } catch { return { setupNeeded: true }; }

  const months = Object.keys(doc.admin || {}).map(Number).sort((a, b) => a - b);
  if (!months.length) return { setupNeeded: true };
  const ask = Number(params && params.month);
  const month = months.includes(ask) ? ask : months[months.length - 1];

  const adminRows = (doc.admin[month] || []).slice().sort((a, b) => b.score - a.score);
  const subRows = (doc.sub && doc.sub[month]) || [];
  const headRows = (doc.head && doc.head[month]) || [];
  const persons = perPerson_(adminRows).sort((a, b) => b.score - a.score);

  // สรุปรายปี: เรียงตาม KPI เฉลี่ยรวม (W — เฉพาะเดือนที่มีข้อมูล) — ตัดคนที่ไม่มียอดทั้งปีออกให้ตารางสั้นลง
  const year = (doc.adminYear || [])
    .filter((r) => r.sales > 0 || r.kpiAvg > 0)
    .sort((a, b) => b.kpiAvg - a.kpiAvg);

  return {
    setupNeeded: false,
    year: doc.year,
    months,
    month,
    updatedAt: doc.updatedAt,
    admin: adminRows,          // รายแถว (คน,ยูนิต) — ตารางหลัก ตรงชีท
    persons,                   // รายคน (รวมยูนิต) — ใช้จัดท็อป
    sub: subRows,
    head: headRows,
    adminYear: year,
    topSales: persons.slice().sort((a, b) => b.sales - a.sales).slice(0, 3),  // ท็อปเซลเดือน
    topKpi: persons.slice(0, 3),                                              // ท็อป KPI เดือน
    topSalesYear: year.slice().sort((a, b) => b.sales - a.sales).slice(0, 3), // ท็อปเซลปี
  };
}
