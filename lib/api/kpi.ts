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

  // ---- แนวโน้ม = คะแนนเดือนนี้เทียบเดือนก่อนหน้า (เดือนก่อนหน้าที่มีข้อมูลจริงในชีท) ----
  const mIdx = months.indexOf(month);
  const prevMonth = mIdx > 0 ? months[mIdx - 1] : 0;
  const prevPersons: Record<string, number> = {};
  const prevSub: Record<string, number> = {};
  const prevHead: Record<string, number> = {};
  if (prevMonth) {
    perPerson_(doc.admin[prevMonth] || []).forEach((p) => { prevPersons[p.id] = p.score; });
    ((doc.sub && doc.sub[prevMonth]) || []).forEach((r: any) => { prevSub[`${r.id}|${r.unit}`] = r.score; });
    ((doc.head && doc.head[prevMonth]) || []).forEach((r: any) => { prevHead[r.id || r.name] = r.score; });
  }

  // ประวัติคะแนนหัวหน้ารายเดือน — กราฟเส้นเล็กในแผงขวา
  const headHistory = months.map((m) => {
    const h: any = ((doc.head && doc.head[m]) || [])[0];
    return { month: m, score: h ? h.score : null };
  });

  // ---- แจ้งเตือน: ไม่ได้ค่าคอม 2 เดือนปิดยอดติดกัน (นิยามเดียวกับหน้า Admin Performance) ----
  const noCom: Array<{ admin: string; months: string[] }> = [];
  try {
    const { data: comData } = await db.from('admin_commission').select('month,admin,com');
    const comMonths = [...new Set((comData || []).map((x: any) => String(x.month)))].sort();
    const nowMonth = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 7);
    const closed = comMonths.filter((m) => m < nowMonth).slice(-2);
    if (closed.length === 2) {
      const byAdmin: Record<string, Record<string, number>> = {};
      (comData || []).forEach((x: any) => {
        const m = String(x.month);
        if (closed.indexOf(m) < 0) return;
        (byAdmin[String(x.admin)] = byAdmin[String(x.admin)] || {})[m] =
          (byAdmin[String(x.admin)][m] || 0) + (Number(x.com) || 0);
      });
      Object.keys(byAdmin).forEach((a) => {
        const mm = byAdmin[a];
        if (closed.every((m) => mm[m] !== undefined) && closed.every((m) => mm[m] === 0)) {
          noCom.push({ admin: a, months: closed });
        }
      });
    }
  } catch { /* ตารางยังไม่มา — ไม่ต้องเตือน */ }

  // ---- แจ้งเตือน: ยูนิตขาดทุน (จากงาน unit-alerts ที่คำนวณไว้แล้ว) ----
  let unitAlerts: Array<{ u: string; days: number; level: string }> = [];
  try {
    const { data: ua } = await db.from('sync_state').select('value').eq('key', 'unit_loss_alerts').maybeSingle();
    unitAlerts = (JSON.parse(String(ua?.value || '{}')).alerts || [])
      .map((a: any) => ({ u: String(a.u), days: Number(a.days) || 0, level: String(a.level) }));
  } catch { /* ยังไม่เคยคำนวณ */ }

  // สรุปรายปี: เรียงตาม KPI เฉลี่ยรวม (W — เฉพาะเดือนที่มีข้อมูล) — ตัดคนที่ไม่มียอดทั้งปีออกให้ตารางสั้นลง
  const year = (doc.adminYear || [])
    .filter((r) => r.sales > 0 || r.kpiAvg > 0)
    .sort((a, b) => b.kpiAvg - a.kpiAvg);

  return {
    setupNeeded: false,
    year: doc.year,
    months,
    month,
    prevMonth,
    updatedAt: doc.updatedAt,
    admin: adminRows,          // รายแถว (คน,ยูนิต) — ตารางหลัก ตรงชีท
    persons,                   // รายคน (รวมยูนิต) — ใช้จัดท็อป
    sub: subRows,
    head: headRows,
    adminYear: year,
    prevPersons,               // id → คะแนนเดือนก่อน (แนวโน้มรายคน)
    prevSub,                   // id|unit → คะแนนเดือนก่อน
    prevHead,                  // id → คะแนนเดือนก่อน
    headHistory,               // คะแนนหัวหน้าย้อนทุกเดือน — กราฟเส้นแผงขวา
    noComAlerts: noCom,        // ไม่ได้คอม 2 เดือนปิดยอดติด
    unitAlerts,                // ยูนิตขาดทุน (ย่อ) — ลิงก์ไปหน้า Sales
    topSales: persons.slice().sort((a, b) => b.sales - a.sales).slice(0, 3),  // ท็อปเซลเดือน
    topKpi: persons.slice(0, 3),                                              // ท็อป KPI เดือน
    topSalesYear: year.slice().sort((a, b) => b.sales - a.sales).slice(0, 3), // ท็อปเซลปี
  };
}
