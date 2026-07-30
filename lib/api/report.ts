// lib/api/report.ts — รายงานรายวีค/รายเดือน (เป้า vs จริง) + การตลาดซื้อซ้ำรายยูนิต
//
// เป้า = แท็บ "เป้ายอดขาย" ของชีท KPI (sync มาใน sync_state 'kpi_scores')
// ยอดจริง = unit_daily.sales (ชีทสรุปรายสินค้า — แหล่งเดียวกับที่ทีมใช้วัดเป้า ตัวเลขจึงเทียบกันตรงๆ)
// ซื้อซ้ำ = ออเดอร์ POS จริง (เริ่มมีข้อมูล 23 พ.ค. 2026) จัดกลุ่มยูนิตด้วยเพจ↔ยูนิตจาก U Map
import { db, fetchAll, fetchAllSliced } from '@/lib/db';
import { getUMapDoc, getPageUnitMap } from '@/lib/api/umap';
import { EXCLUDED_STATUSES, isPlaceholderOrder, money_ } from '@/lib/config';

const num_ = (v: unknown): number => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** วันจันทร์ต้นสัปดาห์ของวันนั้น (สตริง YYYY-MM-DD, คำนวณแบบ UTC ล้วน — date ในชีทไม่มีเวลา) */
function weekStart_(d: string): string {
  const t = new Date(d + 'T00:00:00Z');
  const dow = (t.getUTCDay() + 6) % 7; // จันทร์ = 0
  t.setUTCDate(t.getUTCDate() - dow);
  return t.toISOString().slice(0, 10);
}

export async function apiReport(params: any) {
  const p = params || {};

  /* ================= ส่วนการตลาด (ซื้อซ้ำรายยูนิต) — เรียกแยก หนักกว่าส่วนรายงาน ================= */
  if (p.section === 'marketing') {
    const pageUnit = await getPageUnitMap().catch(() => ({} as Record<string, { u: string; product: string }>));
    // ออเดอร์ทั้งหมดตั้งแต่ระบบเริ่มมีข้อมูลจริง (23 พ.ค. 2026) — คอลัมน์น้อยที่สุด
    const orders = await fetchAllSliced<any>((f, t) =>
      db.from('orders')
        .select('inserted_at,status,total_price,items_count,customer_id,page_id')
        .gte('inserted_at', f).lt('inserted_at', t),
      new Date('2026-05-23T00:00:00+07:00'), new Date(),
    );
    // per unit per customer → รายการเวลาซื้อ
    const cust: Record<string, Record<string, number[]>> = {};
    orders.forEach((o) => {
      if (EXCLUDED_STATUSES.indexOf(num_(o.status)) >= 0) return;
      if (isPlaceholderOrder(o)) return;
      const cid = String(o.customer_id || '');
      if (!cid) return;
      const um = pageUnit[String(o.page_id || '')];
      const u = um ? um.u : '__none__';
      const t = new Date(String(o.inserted_at)).getTime();
      if (!isFinite(t)) return;
      ((cust[u] = cust[u] || {})[cid] = cust[u][cid] || []).push(t);
    });
    const units = Object.keys(cust).filter((u) => u !== '__none__').map((u) => {
      const byC = cust[u];
      let total = 0, repeat = 0, gapSum = 0, gapN = 0, orderSum = 0;
      Object.keys(byC).forEach((cid) => {
        const ts = byC[cid].sort((a, b) => a - b);
        total++;
        orderSum += ts.length;
        if (ts.length >= 2) {
          repeat++;
          for (let i = 1; i < ts.length; i++) { gapSum += (ts[i] - ts[i - 1]) / 86400000; gapN++; }
        }
      });
      return {
        u,
        customers: total,
        repeat,
        repeatPct: total ? Math.round((repeat / total) * 1000) / 10 : null,
        avgGapDays: gapN ? Math.round(gapSum / gapN) : null,       // รอบซื้อซ้ำเฉลี่ย (วัน)
        avgOrders: total ? Math.round((orderSum / total) * 100) / 100 : null,
      };
    }).sort((a, b) => (b.repeatPct || 0) - (a.repeatPct || 0));
    return { ok: true, sinceDate: '2026-05-23', units };
  }

  /* ================= ส่วนรายงาน: เป้า vs จริง ================= */
  const [rows, kpiState, umap] = await Promise.all([
    fetchAll<any>(() => db.from('unit_daily').select('u,date,sales,profit'), 'key').catch(() => [] as any[]),
    db.from('sync_state').select('value').eq('key', 'kpi_scores').maybeSingle(),
    getUMapDoc().catch(() => ({ units: [] as any[] })),
  ]);
  if (!rows.length) return { setupNeeded: true };

  let targets: Record<string, number[]> = {};
  try { targets = JSON.parse(String(kpiState.data?.value || '{}')).targets || {}; } catch { /* ยังไม่ sync */ }
  const productOf: Record<string, string> = {};
  (umap.units || []).forEach((x: any) => { productOf[String(x.u)] = String(x.product || ''); });

  const year = String(rows.map((r) => String(r.date).slice(0, 4)).sort().pop() || '2026');
  // actual[u][m 1-12] + weekly[u][weekStart] ของเดือนที่เลือก
  const actual: Record<string, number[]> = {};
  const monthsSet = new Set<number>();
  rows.forEach((r) => {
    const d = String(r.date).slice(0, 10);
    if (!d.startsWith(year)) return;
    const m = Number(d.slice(5, 7));
    monthsSet.add(m);
    const u = String(r.u);
    (actual[u] = actual[u] || new Array(13).fill(0))[m] += num_(r.sales);
  });
  const monthsAvail = Array.from(monthsSet).sort((a, b) => a - b);
  const curMonth = Number(new Date(Date.now() + 7 * 3600000).toISOString().slice(5, 7));
  const ask = Number(p.month);
  const month = monthsAvail.includes(ask) ? ask : (monthsAvail[monthsAvail.length - 1] || curMonth);

  // รายยูนิตของเดือนที่เลือก + ยอดรายวีคในเดือน
  const mm = String(month).padStart(2, '0');
  const weekly: Record<string, Record<string, number>> = {};
  rows.forEach((r) => {
    const d = String(r.date).slice(0, 10);
    if (!d.startsWith(`${year}-${mm}`)) return;
    const u = String(r.u);
    const w = weekStart_(d);
    (weekly[u] = weekly[u] || {})[w] = (weekly[u][w] || 0) + num_(r.sales);
  });

  const allUnits = Array.from(new Set([...Object.keys(actual), ...Object.keys(targets)]));
  const isCurrent = month === curMonth && year === String(new Date().getFullYear());
  const daysInMonth = new Date(Number(year), month, 0).getDate();
  const dayOfMonth = Number(new Date(Date.now() + 7 * 3600000).toISOString().slice(8, 10));
  const daysLeft = isCurrent ? Math.max(1, daysInMonth - dayOfMonth + 1) : 0;

  const unitRows = allUnits.map((u) => {
    const t = (targets[u] || [])[month - 1] || 0;
    const a = (actual[u] || [])[month] || 0;
    const attain = t > 0 ? Math.round((a / t) * 1000) / 10 : null;
    const wk = weekly[u] || {};
    return {
      u,
      product: productOf[u] || '',
      target: Math.round(t),
      actual: Math.round(a),
      attain,
      gap: t > 0 ? Math.round(Math.max(0, t - a)) : null,
      // เดือนปัจจุบัน: ต้องขายเพิ่มวันละเท่าไหร่ถึงจะจบเดือนตรงเป้า
      needPerDay: isCurrent && t > 0 && t > a ? Math.round((t - a) / daysLeft) : null,
      weekly: Object.keys(wk).sort().map((w) => ({ week: w, sales: Math.round(wk[w]) })),
    };
  })
    .filter((x) => x.target > 0 || x.actual > 0)
    .sort((a, b) => (b.attain === null ? -1 : a.attain === null ? 1 : (b.attain - a.attain)));

  // สรุปทั้งปี: รายเดือน เป้ารวม vs จริงรวม + จำนวนยูนิตถึงเป้า
  const yearSummary = monthsAvail.map((m) => {
    let tSum = 0, aSum = 0, hit = 0, judged = 0;
    allUnits.forEach((u) => {
      const t = (targets[u] || [])[m - 1] || 0;
      const a = (actual[u] || [])[m] || 0;
      tSum += t; aSum += a;
      if (t > 0) { judged++; if (a >= t) hit++; }
    });
    return {
      month: m, label: TH_MONTHS[m - 1],
      target: Math.round(tSum), actual: Math.round(aSum),
      attain: tSum > 0 ? Math.round((aSum / tSum) * 1000) / 10 : null,
      hitUnits: hit, judgedUnits: judged,
      closed: m < curMonth, // เดือนที่จบแล้วเท่านั้นถึงตัดสิน "สำเร็จ/ไม่สำเร็จ" ได้จริง
    };
  });

  return {
    setupNeeded: false,
    year, month, monthsAvail, isCurrent, daysLeft,
    hasTargets: Object.keys(targets).length > 0,
    units: unitRows,
    yearSummary,
  };
}
