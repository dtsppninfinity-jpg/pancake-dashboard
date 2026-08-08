// lib/views/report.ts — หน้า "รายงาน & การตลาด" (บรีฟ 2026-07-31)
// รายงานเป้า vs จริง รายยูนิต (เดือน/วีค/ปี — เป้าจากชีท KPI แท็บ เป้ายอดขาย, ยอดจริงจากชีทสรุปรายสินค้า)
// + การตลาด: ลูกค้าซื้อซ้ำต่อรอบ รายยูนิต (จากออเดอร์ POS จริง)

import { serverCall, esc, fmtNum, THB, pctFmt, showError, downloadCSV, toast } from '@/lib/ui/helpers';

interface UnitRow {
  u: string; product: string; target: number; actual: number;
  attain: number | null; gap: number | null; needPerDay: number | null;
  weekly: Array<{ week: string; sales: number }>;
}
interface YearRow {
  month: number; label: string; target: number; actual: number;
  attain: number | null; hitUnits: number; judgedUnits: number; closed: boolean;
}
interface ReportData {
  setupNeeded?: boolean;
  year: string; month: number; monthsAvail: number[]; isCurrent: boolean; daysLeft: number;
  hasTargets: boolean; units: UnitRow[]; yearSummary: YearRow[];
}
interface MarketRow {
  u: string; customers: number; repeat: number; repeatPct: number | null;
  avgGapDays: number | null; avgOrders: number | null;
}

let lastData: ReportData | null = null;
let marketData: { sinceDate: string; units: MarketRow[] } | null = null;
let reqSeq = 0;
let mkReq = 0;
const state = { month: 0 };

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function attainCls(v: number | null): string {
  if (v === null) return '';
  return v >= 100 ? 'txt-good' : v < 50 ? 'txt-bad' : '';
}

function unitTableHtml_(d: ReportData): string {
  if (!d.hasTargets) {
    return '<div class="card" style="margin-top:14px"><h3>🎯 เป้า vs จริง</h3>' +
      '<div class="empty-note">ยังไม่มีเป้าจากชีท KPI (แท็บ เป้ายอดขาย) — รอ sync หรือรัน npm run import:kpi</div></div>';
  }
  // หัวคอลัมน์วีค = วีคที่มีจริงในเดือน (รวมทุกยูนิต)
  const weekSet = new Set<string>();
  d.units.forEach((x) => x.weekly.forEach((w) => weekSet.add(w.week)));
  const weeks = Array.from(weekSet).sort();
  const wLabel = (w: string, i: number) => 'W' + (i + 1) + ' (' + w.slice(8, 10) + '+)';

  // ---- สถานะเทียบ "จังหวะที่ควรจะเป็น" ไม่ใช่เทียบ 100% เฉยๆ ----
  // ของเดิมตัดสินด้วย attain >= 100 อย่างเดียว เดือนปัจจุบันจึงขึ้นแดง "✗ ไม่ถึง" ทุกยูนิต
  // ตั้งแต่วันที่ 7 ของเดือน = แดงทั้งตารางประมาณ 3 ใน 4 ของเดือน แล้วไม่มีใครอ่านคอลัมน์นี้อีก
  // เดือนที่จบแล้วยังตัดสินแบบเดิม (ถึง/ไม่ถึง) เพราะไม่มี "จังหวะ" ให้เทียบแล้ว
  const daysInMonth = new Date(Number(d.year), d.month, 0).getDate();
  const dayOfMonth = d.isCurrent ? Math.max(1, daysInMonth - d.daysLeft + 1) : daysInMonth;
  const pacePct = Math.round((dayOfMonth / daysInMonth) * 1000) / 10;   // ผ่านมากี่ % ของเดือน

  function statusBadge(attain: number | null): string {
    if (attain === null) return '<span class="badge neutral">ไม่ตั้งเป้า</span>';
    if (attain >= 100) return '<span class="badge ai">✅ ถึงเป้าแล้ว</span>';
    if (!d.isCurrent) return '<span class="badge urgent">✗ ไม่ถึงเป้า</span>';
    if (attain >= pacePct) return '<span class="badge info">🟦 ตามแผน</span>';
    if (attain >= pacePct * 0.75) return '<span class="badge admin">⚠️ ช้ากว่าแผน</span>';
    return '<span class="badge urgent">🔴 ต่ำกว่าแผนมาก</span>';
  }

  const body = d.units.map((x) => {
    const wkMap: Record<string, number> = {};
    x.weekly.forEach((w) => { wkMap[w.week] = w.sales; });
    return '<tr>' +
      '<td><b>' + esc(x.u) + '</b>' + (x.product ? ' <span class="rank-fullname">' + esc(x.product) + '</span>' : '') + '</td>' +
      '<td class="num">' + (x.target ? THB(x.target) : '-') + '</td>' +
      '<td class="num">' + THB(x.actual) + '</td>' +
      '<td class="num ' + attainCls(x.attain) + '"><b>' + pctFmt(x.attain) + '</b></td>' +
      '<td>' + statusBadge(x.attain) + '</td>' +
      '<td class="num">' + (x.gap ? THB(x.gap) : '-') + '</td>' +
      '<td class="num">' + (x.needPerDay ? THB(x.needPerDay) + '/วัน' : '-') + '</td>' +
      weeks.map((w) => '<td class="num">' + (wkMap[w] ? THB(wkMap[w]) : '<span style="opacity:.35">—</span>') + '</td>').join('') +
      '</tr>';
  }).join('');

  return '<div class="card" style="margin-top:14px">' +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
      '<h3 style="margin:0">🎯 เป้า vs จริง รายยูนิต — ' + esc(TH_MONTHS[d.month - 1] + ' ' + d.year) + '</h3>' +
      '<div class="spacer" style="flex:1"></div>' +
      '<button class="btn-mini" id="rp-csv">📄 CSV</button>' +
    '</div>' +
    '<div class="card-sub">เป้าจากชีท KPI (แท็บ เป้ายอดขาย) • ยอดจริงจากชีทสรุปรายสินค้า (แหล่งเดียวกับที่ทีมใช้วัด) • ' +
      'ยอดรายวีคนับจันทร์–อาทิตย์' +
      (d.isCurrent
        ? ' • เดือนนี้ผ่านมา ' + pacePct + '% (เหลือ ' + fmtNum(d.daysLeft) + ' วัน) — ' +
          '<b>สถานะเทียบกับจังหวะที่ควรจะเป็น ไม่ใช่เทียบ 100%</b>: ' +
          'ตามแผน = %บรรลุ ≥ ' + pacePct + '% • ช้ากว่าแผน = ต่ำกว่านั้นแต่ยังไม่ถึงครึ่ง'
        : ' • เดือนที่ปิดแล้ว สถานะคือถึงเป้า/ไม่ถึงเป้าจริง') + '</div>' +
    '<div class="table-scroll"><table class="tbl"><thead><tr>' +
      '<th>ยูนิต</th><th class="num">เป้า/เดือน</th><th class="num">ยอดจริง</th><th class="num">%บรรลุ</th>' +
      '<th>สถานะ</th><th class="num">ขาดอีก</th><th class="num">ต้องขายเพิ่ม</th>' +
      weeks.map((w, i) => '<th class="num">' + esc(wLabel(w, i)) + '</th>').join('') +
    '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
}

function yearTableHtml_(d: ReportData): string {
  const body = d.yearSummary.map((y) => {
    const cls = attainCls(y.attain);
    return '<tr>' +
      '<td>' + esc(y.label) + (y.closed ? '' : ' <span class="chip">กำลังวิ่ง</span>') + '</td>' +
      '<td class="num">' + THB(y.target) + '</td>' +
      '<td class="num">' + THB(y.actual) + '</td>' +
      '<td class="num ' + cls + '"><b>' + pctFmt(y.attain) + '</b></td>' +
      '<td class="num">' + fmtNum(y.hitUnits) + '/' + fmtNum(y.judgedUnits) + '</td>' +
      '<td>' + (!y.closed ? '<span class="badge neutral">ยังไม่จบเดือน</span>'
        : y.attain !== null && y.attain >= 100 ? '<span class="badge ai">✅ สำเร็จ</span>'
        : '<span class="badge urgent">✗ ไม่ถึงเป้า</span>') + '</td>' +
      '</tr>';
  }).join('');
  const closed = d.yearSummary.filter((y) => y.closed && y.attain !== null);
  const okMonths = closed.filter((y) => (y.attain || 0) >= 100).length;
  return '<div class="card" style="margin-top:14px">' +
    '<h3>📅 ความสำเร็จรายเดือน ปี ' + esc(d.year) + ' — ถึงเป้า ' + fmtNum(okMonths) + '/' + fmtNum(closed.length) + ' เดือนที่จบแล้ว</h3>' +
    '<div class="card-sub">เป้ารวม = ผลรวมเป้าทุกยูนิตของเดือนนั้น • "ยูนิตถึงเป้า" นับเฉพาะยูนิตที่ตั้งเป้าไว้</div>' +
    '<div class="table-scroll"><table class="tbl"><thead><tr>' +
      '<th>เดือน</th><th class="num">เป้ารวม</th><th class="num">ยอดจริง</th><th class="num">%บรรลุ</th>' +
      '<th class="num">ยูนิตถึงเป้า</th><th>สรุป</th>' +
    '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
}

function marketHtml_(): string {
  let inner: string;
  if (!marketData) {
    inner = '<div class="loading"><div class="spinner"></div>กำลังวิเคราะห์ออเดอร์ทั้งหมด (ตั้งแต่ 23 พ.ค.) — ใช้เวลา ~15-30 วินาที...</div>';
  } else if (!marketData.units.length) {
    inner = '<div class="empty-note">ยังไม่มีข้อมูล (ต้องจับคู่เพจ↔ยูนิตในหน้า U Map ก่อน)</div>';
  } else {
    const body = marketData.units.map((x) => {
      return '<tr>' +
        '<td><b>' + esc(x.u) + '</b></td>' +
        '<td class="num">' + fmtNum(x.customers) + '</td>' +
        '<td class="num">' + fmtNum(x.repeat) + '</td>' +
        '<td class="num ' + ((x.repeatPct || 0) >= 10 ? 'txt-good' : '') + '"><b>' + pctFmt(x.repeatPct) + '</b></td>' +
        '<td class="num">' + (x.avgGapDays === null ? '-' : fmtNum(x.avgGapDays) + ' วัน') + '</td>' +
        '<td class="num">' + (x.avgOrders === null ? '-' : x.avgOrders) + '</td>' +
        '</tr>';
    }).join('');
    inner = '<div class="table-scroll"><table class="tbl"><thead><tr>' +
      '<th>ยูนิต</th><th class="num">ลูกค้าทั้งหมด</th><th class="num">ซื้อซ้ำ</th><th class="num">%ซื้อซ้ำ</th>' +
      '<th class="num">รอบซื้อซ้ำเฉลี่ย</th><th class="num">ออเดอร์/ลูกค้า</th>' +
      '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }
  return '<div class="card" style="margin-top:14px" id="rp-market">' +
    '<h3>🛒 การตลาด: ลูกค้าซื้อซ้ำรายยูนิต' + (marketData ? ' (ตั้งแต่ ' + esc(marketData.sinceDate) + ')' : '') + '</h3>' +
    '<div class="card-sub">จากออเดอร์ POS จริงทั้งหมดที่ระบบมี — รอบซื้อซ้ำ = ระยะห่างเฉลี่ยระหว่างออเดอร์ของลูกค้าคนเดิม • ' +
      'ช่วงข้อมูลยังสั้น (~2.5 เดือน) %ซื้อซ้ำจริงจะสูงกว่านี้เมื่อเก็บนานขึ้น</div>' +
    inner + '</div>';
}

function render(container: HTMLElement, d: ReportData | null): void {
  if (!d) return;
  if (d.setupNeeded) {
    container.innerHTML = '<div class="empty-note">⏳ ยังไม่มีข้อมูล — รอ sync ชีท (unit_daily)</div>';
    return;
  }
  const monthBtns = d.monthsAvail.map((m) =>
    '<button class="filter-btn' + (m === d.month ? ' active' : '') + '" data-rpmonth="' + m + '">' +
    esc(TH_MONTHS[m - 1]) + '</button>').join('');
  container.innerHTML =
    '<div class="pg-controls">' + monthBtns + '</div>' +
    unitTableHtml_(d) +
    yearTableHtml_(d) +
    marketHtml_();
  bindEvents(container);
  if (!marketData) fetchMarket(container); // โหลดครั้งแรกครั้งเดียว — แคชไว้ทั้ง session
}

function fetchMarket(container: HTMLElement): void {
  const seq = ++mkReq;
  serverCall<any>('apiReport', { section: 'marketing' }).then(function (res) {
    if (seq !== mkReq) return;
    marketData = res;
    const box = container.querySelector('#rp-market');
    if (box) box.outerHTML = marketHtml_();
  }).catch(function () {
    if (seq !== mkReq) return;
    const box = container.querySelector('#rp-market .loading');
    if (box) box.outerHTML = '<div class="empty-note">⚠️ วิเคราะห์ซื้อซ้ำไม่สำเร็จ — รีเฟรชเพื่อลองใหม่</div>';
  });
}

function bindEvents(container: HTMLElement): void {
  container.querySelectorAll('[data-rpmonth]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.month = Number(btn.getAttribute('data-rpmonth'));
      container.innerHTML = '<div class="loading"><div class="spinner"></div>กำลังโหลด...</div>';
      fetchData(container);
    });
  });
  const csv = container.querySelector('#rp-csv');
  if (csv) csv.addEventListener('click', function () {
    const d = lastData;
    if (!d || !d.units.length) { toast('ยังไม่มีข้อมูลให้ Export'); return; }
    const out: (string | number)[][] = [
      ['รายงานเป้า vs จริง ' + TH_MONTHS[d.month - 1] + ' ' + d.year],
      ['ยูนิต', 'สินค้า', 'เป้า/เดือน', 'ยอดจริง', '%บรรลุ', 'ขาดอีก', 'ต้องขายเพิ่ม/วัน'],
    ];
    d.units.forEach(function (x) {
      out.push([x.u, x.product, x.target, x.actual, x.attain === null ? '-' : x.attain,
        x.gap === null ? '-' : x.gap, x.needPerDay === null ? '-' : x.needPerDay]);
    });
    downloadCSV(out, 'report-' + d.year + '-' + String(d.month).padStart(2, '0'));
  });
}

function fetchData(container: HTMLElement): void {
  const seq = ++reqSeq;
  serverCall<ReportData>('apiReport', { month: state.month }).then(function (d) {
    if (seq !== reqSeq) return;
    lastData = d;
    if (d && d.month) state.month = d.month;
    render(container, d);
  }).catch(function (err) {
    if (seq !== reqSeq) return;
    showError(container, (err && err.message) || 'เรียกข้อมูลไม่สำเร็จ', function () {
      container.innerHTML = '<div class="loading"><div class="spinner"></div>กำลังโหลด...</div>';
      fetchData(container);
    });
  });
}

export const report = {
  load: async (container: HTMLElement, force?: boolean): Promise<void> => {
    if (lastData && !force) {
      // แสดง cache ก่อนแล้วดึงใหม่เบื้องหลัง — เดิม return ตรงนี้เลย ลูปอัปเดต 5 นาทีจึงไม่มีผล
      render(container, lastData);
      fetchData(container);
      return;
    }
    container.innerHTML = '<div class="loading"><div class="spinner"></div>กำลังโหลดรายงาน...</div>';
    fetchData(container);
  },
};
