// lib/api/unitperf.ts — หน้า "🎯 ผลงานราย Unit" (พีสั่ง 21 ก.ย. 2569)
//
// การ์ดใบละยูนิต: ยอดเดือนนี้ vs เป้า · คาดการณ์สิ้นเดือน · สัญญาณเตือนที่ระบบตรวจเจอ · จัดอันดับความเสี่ยง
//
// ที่มาของตัวเลข (ทุกก้อนรวมมาแล้วฝั่ง Postgres หรือเป็นตารางเล็ก — หน้านี้อ่านทั้งเดือน)
//   ยอดขาย/ออเดอร์  RPC sales_daily_by_page  (กติกาเดียวกับหน้า Sales เป๊ะ — ดู db/migrations/2026-09-21-sales-daily-by-page.sql)
//   ค่าแอด          RPC ads_daily_by_page    (ad_daily ทั้งเดือน = ~110,000 แถว ห้ามลากดิบ)
//   คนทัก           chat_engagement_daily ของเพจ Facebook (ตัวหารเดียวกับ %ปิด หน้า Sales)
//   กำไร            unit_daily.profit จากชีทสรุปรายสินค้า (แหล่งเดียวกับหน้า กำไร & ตีกลับ)
//   ขาดทุนต่อเนื่อง  sync_state 'unit_loss_alerts' (งาน sync คำนวณวันละครั้ง — กติกาเดียวกับการ์ด 🚨 หน้า Sales)
//   เป้าเดือน        sync_state 'unit_goals' (ชีท KPI แท็บ เป้ายอดขาย)
import { db, fetchAll } from '@/lib/db';
import { getUMapDoc, getPageUnitMap } from '@/lib/api/umap';
import { EXCLUDED_STATUSES, NEED_CHECK_STATUSES, money_, UNIT_CLOSE_TARGET } from '@/lib/config';

const num_ = (v: unknown): number => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};

const BKK_MS = 7 * 3600 * 1000;
const ymdBkk_ = (d: Date): string => new Date(d.getTime() + BKK_MS).toISOString().slice(0, 10);
const ymdShift_ = (ymd: string, n: number): string => {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const bkkDayIso_ = (ymd: string): string => new Date(ymd + 'T00:00:00+07:00').toISOString();

/** PostgREST ตัดผลลัพธ์ทุกคิวรีที่ 1,000 แถว รวม RPC — ต้องแบ่งหน้าเองพร้อม order ที่ไม่กำกวม */
async function rpcAll_(fn: string, args: any, orderCols: string[]): Promise<any[] | null> {
  const PAGE = 1000;
  const out: any[] = [];
  for (let off = 0; off <= 100000; off += PAGE) {
    let q: any = db.rpc(fn, args);
    orderCols.forEach((c) => { q = q.order(c, { ascending: true }); });
    const { data, error } = await q.range(off, off + PAGE - 1).abortSignal(AbortSignal.timeout(30_000));
    if (error) return null;
    const got = (data || []) as any[];
    out.push(...got);
    if (got.length < PAGE) break;
  }
  return out;
}

interface Daily { rev: number; orders: number; spend: number; base: number; profit: number | null }

const emptyDay_ = (): Daily => ({ rev: 0, orders: 0, spend: 0, base: 0, profit: null });

export async function apiUnitPerf(params: any) {
  const p = params || {};
  const todayYmd = ymdBkk_(new Date());
  const month = /^\d{4}-\d{2}$/.test(String(p.month || '')) ? String(p.month) : todayYmd.slice(0, 7);
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const monthStart = month + '-01';
  const monthEnd = month + '-' + String(daysInMonth).padStart(2, '0');
  const isCurrentMonth = month === todayYmd.slice(0, 7);
  // เดือนปัจจุบันตัดที่ "วันนี้" — วันในอนาคตไม่มีข้อมูล และต้องไม่ถูกนับเป็นวันที่ผ่านไปแล้ว
  const lastYmd = isCurrentMonth ? todayYmd : monthEnd;
  const daysElapsed = Number(lastYmd.slice(8, 10));

  /* ---- แผนที่เพจ → ยูนิต + จำนวนเพจ/แอดมินต่อยูนิต ---- */
  const [pageUnit, doc, pagesRows] = await Promise.all([
    getPageUnitMap().catch(() => ({} as Record<string, { u: string; product: string }>)),
    getUMapDoc().catch(() => ({ units: [] as any[], updatedAt: '' })),
    fetchAll<any>(() => db.from('pages').select('page_id,platform'), 'page_id').catch(() => [] as any[]),
  ]);
  const platformOf: Record<string, string> = {};
  pagesRows.forEach((r) => { platformOf[String(r.page_id)] = String(r.platform || '').toLowerCase(); });
  const UNMAPPED = '__none__';
  const unitOfPage = (pid: string): string => {
    const um = pageUnit[String(pid || '')];
    return um ? um.u : UNMAPPED;
  };

  const meta: Record<string, { product: string; pages: number; admins: number; breakEven: number; note: string }> = {};
  (doc.units || []).forEach((u: any) => {
    meta[u.u] = {
      product: String(u.product || ''),
      pages: (u.pages || []).length,
      admins: (u.admins || []).length,
      breakEven: num_(u.breakEven) || 1,
      note: String(u.note || ''),
    };
  });

  /* ---- ยอดขาย/ออเดอร์ รายวันต่อเพจ (กติกาเดียวกับหน้า Sales) ---- */
  const salesRows = await rpcAll_('sales_daily_by_page', {
    p_from: bkkDayIso_(monthStart),
    p_to: bkkDayIso_(ymdShift_(lastYmd, 1)),
    p_excluded: EXCLUDED_STATUSES,
    p_needcheck: NEED_CHECK_STATUSES,
  }, ['d', 'page_id', 'channel']);

  /* ---- ค่าแอดรายวันต่อเพจ ---- */
  const adsRows = await rpcAll_('ads_daily_by_page', { p_from: monthStart, p_to: lastYmd }, ['d', 'page_id']);

  /* ---- คนทักรายวันต่อเพจ (เฉพาะเพจ Facebook — ตัวหารเดียวกับ %ปิด หน้า Sales) ---- */
  const engRows = await fetchAll<any>(
    () => db.from('chat_engagement_daily').select('key,date,page_id,new_inbox,comment')
      .gte('date', monthStart).lte('date', lastYmd),
    'key',
  ).catch(() => [] as any[]);

  /* ---- กำไรรายวันต่อยูนิต (ชีท) ---- */
  const profitRows = await fetchAll<any>(
    () => db.from('unit_daily').select('key,u,date,profit').gte('date', monthStart).lte('date', lastYmd),
    'key',
  ).catch(() => [] as any[]);

  /* ---- ขาดทุนต่อเนื่อง (งาน sync คำนวณไว้แล้ว) ---- */
  const lossAlerts = await (async () => {
    try {
      const { data } = await db.from('sync_state').select('value').eq('key', 'unit_loss_alerts').maybeSingle();
      if (!data || !data.value) return null;
      const j = JSON.parse(String(data.value));
      const byU: Record<string, any> = {};
      (j.alerts || []).forEach((a: any) => { byU[String(a.u)] = a; });
      return { throughDate: String(j.throughDate || ''), byU };
    } catch { return null; }
  })();

  /* ---- เป้าเดือนจากชีท KPI ---- */
  const goals = await (async () => {
    try {
      const { data } = await db.from('sync_state').select('value').eq('key', 'unit_goals').maybeSingle();
      if (!data || !data.value) return null;
      const g = JSON.parse(String(data.value));
      return { year: num_(g.year), sheetId: String(g.sheetId || ''), targets: g.targets || {} as Record<string, number[]> };
    } catch { return null; }
  })();
  const monthTargetOf = (u: string): number => {
    if (!goals || goals.year !== year) return 0;
    return num_((goals.targets[u] || [])[mon - 1]);
  };

  /* ---- ประกอบเป็น ยูนิต × วัน ---- */
  const byUnit: Record<string, Record<string, Daily>> = {};
  const touch = (u: string, ymd: string): Daily => {
    const m = byUnit[u] = byUnit[u] || {};
    return m[ymd] = m[ymd] || emptyDay_();
  };
  (salesRows || []).forEach((r) => {
    const ymd = String(r.d || '').slice(0, 10);
    if (!ymd) return;
    const c = touch(unitOfPage(r.page_id), ymd);
    c.rev += money_(r.revenue);
    c.orders += num_(r.orders);
  });
  (adsRows || []).forEach((r) => {
    const ymd = String(r.d || '').slice(0, 10);
    if (!ymd) return;
    touch(unitOfPage(r.page_id), ymd).spend += num_(r.spend);   // ad_daily.spend เป็นบาทจริง ห้ามหาร 100
  });
  engRows.forEach((r) => {
    const pid = String(r.page_id || '');
    if (platformOf[pid] === 'line') return;                     // ตัวหาร %ปิด นับเฉพาะเพจ Facebook
    const ymd = String(r.date || '').slice(0, 10);
    if (!ymd) return;
    touch(unitOfPage(pid), ymd).base += num_(r.new_inbox) + num_(r.comment);
  });
  profitRows.forEach((r) => {
    const u = String(r.u || '');
    const ymd = String(r.date || '').slice(0, 10);
    if (!u || !ymd) return;
    const c = touch(u, ymd);
    c.profit = (c.profit || 0) + num_(r.profit);
  });

  /* ---- สรุปต่อยูนิต + ไล่นับ streak ---- */
  const yesterdayYmd = ymdShift_(todayYmd, -1);
  const keys = Array.from(new Set(
    Object.keys(byUnit).concat(Object.keys(meta)).concat(goals && goals.year === year ? Object.keys(goals.targets) : []),
  ));

  const units = keys.map((k) => {
    const days = byUnit[k] || {};
    const mapped = k !== UNMAPPED;
    const m = meta[k] || { product: '', pages: 0, admins: 0, breakEven: 1, note: '' };
    let rev = 0, orders = 0, spend = 0, base = 0, profit = 0, hasProfit = false;
    Object.keys(days).forEach((ymd) => {
      const c = days[ymd];
      rev += c.rev; orders += c.orders; spend += c.spend; base += c.base;
      if (c.profit !== null) { profit += c.profit; hasProfit = true; }
    });
    const target = mapped ? monthTargetOf(k) : 0;
    const attain = target > 0 ? Math.round((rev / target) * 1000) / 10 : null;
    // คาดการณ์สิ้นเดือน = ยอดเฉลี่ยต่อวันของวันที่ผ่านมาแล้ว × จำนวนวันทั้งเดือน
    // (เดือนที่จบแล้ว = ยอดจริง ไม่ต้องคาด)
    const projected = isCurrentMonth && daysElapsed > 0 ? Math.round((rev / daysElapsed) * daysInMonth) : Math.round(rev);
    const projAttain = target > 0 ? Math.round((projected / target) * 1000) / 10 : null;

    // ---- %ปิด ต่ำกว่าเป้าติดต่อกันกี่วัน (ไล่ย้อนจากเมื่อวาน — วันนี้ยังไม่จบ ตัดสินไม่ได้) ----
    let closeStreak = 0;
    for (let d = yesterdayYmd; d >= monthStart; d = ymdShift_(d, -1)) {
      const c = days[d];
      if (!c || c.base <= 0) break;                    // ไม่มีคนทัก = ตัดสินไม่ได้ streak ขาด
      const rate = (c.orders / c.base) * 100;
      if (rate >= UNIT_CLOSE_TARGET) break;
      closeStreak++;
    }
    // ---- ROAS ต่ำกว่าจุดคุ้มทุนติดต่อกันกี่วัน (กติกาเดียวกับการ์ด 🚨 — งาน sync คำนวณไว้) ----
    const la = lossAlerts ? lossAlerts.byU[k] : null;
    const lossStreak = la ? num_(la.days || la.streak) : 0;

    const closeRate = base > 0 ? Math.round((orders / base) * 10000) / 100 : null;
    const roas = spend > 0 ? Math.round((rev / spend) * 100) / 100 : null;
    const costPerMsg = base > 0 ? Math.round((spend / base) * 100) / 100 : null;
    const perBill = orders > 0 ? Math.round(rev / orders) : null;

    /* ---- สัญญาณเตือน + ระดับความเสี่ยง ---- */
    const signals: Array<{ text: string; level: 'urgent' | 'watch' }> = [];
    if (lossStreak >= 1) {
      signals.push({
        text: 'ROAS ต่ำกว่าจุดคุ้มทุน ' + lossStreak + ' วันติด' + (m.breakEven ? ' (จุดคุ้มทุน ' + m.breakEven + 'x)' : ''),
        level: lossStreak >= 2 ? 'urgent' : 'watch',
      });
    }
    if (closeStreak >= 2) {
      signals.push({
        text: '%ปิดการขายต่ำกว่า ' + UNIT_CLOSE_TARGET + '% ' + closeStreak + ' วันติด',
        level: closeStreak >= 7 ? 'urgent' : 'watch',
      });
    }
    if (target > 0 && projAttain !== null && isCurrentMonth) {
      if (projAttain < 80) signals.push({ text: 'คาดว่าจะไม่ถึงเป้าเดือนนี้ (คาด ' + projAttain + '% ของเป้า)', level: 'urgent' });
      else if (projAttain < 100) signals.push({ text: 'คาดว่าจะเฉียดเป้า (คาด ' + projAttain + '% ของเป้า)', level: 'watch' });
    }
    if (hasProfit && profit < 0) {
      signals.push({ text: 'กำไรสะสมเดือนนี้ติดลบ', level: 'urgent' });
    }
    const level: 'urgent' | 'watch' | 'ok' =
      signals.some((s) => s.level === 'urgent') ? 'urgent' : (signals.length ? 'watch' : 'ok');

    return {
      u: mapped ? k : '',
      key: k,
      mapped,
      product: mapped ? (m.product || (pageUnit[k] && pageUnit[k].product) || '') : 'ยังไม่จัดกลุ่ม',
      pages: m.pages,
      admins: m.admins,
      note: m.note,
      revenue: Math.round(rev),
      orders,
      spend: Math.round(spend),
      base,
      profit: hasProfit ? Math.round(profit) : null,
      target: target > 0 ? Math.round(target) : null,
      attain,
      projected,
      projAttain,
      gap: target > 0 ? Math.max(0, Math.round(target - rev)) : null,
      closeRate,
      roas,
      costPerMsg,
      perBill,
      breakEven: m.breakEven,
      lossStreak,
      closeStreak,
      signals,
      level,
    };
  })
    // ยูนิตที่ไม่มีทั้งยอด ไม่มีค่าแอด และไม่มีเป้าในเดือนนี้ = ไม่มีอะไรให้ดู
    .filter((u) => u.revenue > 0 || u.spend > 0 || (u.target || 0) > 0);

  const rank = { urgent: 0, watch: 1, ok: 2 };
  units.sort((a, b) => {
    if (a.mapped !== b.mapped) return a.mapped ? -1 : 1;
    if (rank[a.level] !== rank[b.level]) return rank[a.level] - rank[b.level];
    const aa = a.projAttain === null ? 9999 : a.projAttain;
    const bb = b.projAttain === null ? 9999 : b.projAttain;
    if (aa !== bb) return aa - bb;
    return b.revenue - a.revenue;
  });

  const totals = units.reduce((t, u) => ({
    revenue: t.revenue + u.revenue,
    target: t.target + (u.target || 0),
    spend: t.spend + u.spend,
    projected: t.projected + u.projected,
    profit: t.profit + (u.profit || 0),
    urgent: t.urgent + (u.level === 'urgent' ? 1 : 0),
    watch: t.watch + (u.level === 'watch' ? 1 : 0),
  }), { revenue: 0, target: 0, spend: 0, projected: 0, profit: 0, urgent: 0, watch: 0 });

  return {
    month,
    monthStart,
    monthEnd,
    lastYmd,
    daysElapsed,
    daysInMonth,
    isCurrentMonth,
    closeTarget: UNIT_CLOSE_TARGET,
    // null = ยังไม่ได้รัน migration ของ RPC นั้น (หน้าเว็บบอกวิธีรัน ไม่ใช่โชว์ 0)
    needSalesRpc: salesRows === null,
    needAdsRpc: adsRows === null,
    lossThroughDate: lossAlerts ? lossAlerts.throughDate : '',
    goalSheetId: goals ? goals.sheetId : '',
    goalYearMismatch: !!goals && goals.year !== year,
    units,
    totals,
  };
}
