// lib/views/kpi.ts — หน้า "KPI ทีมขาย" (บรีฟ 2026-07-31)
// คะแนนจากชีท KPI กลางของทีม (สูตรอยู่ในชีท — หน้านี้คือกระจก + จัดอันดับ)
// KPI แอดมินรายคน • รองหัวหน้า • หัวหน้า • ท็อปเซล/ท็อป KPI ประจำเดือน • สรุปทั้งปี

import { serverCall, esc, fmtNum, THB, pctFmt, avatarHtml, showError, downloadCSV, toast } from '@/lib/ui/helpers';

interface AdminRow {
  id: string; name: string; nick: string; unit: string; unitFull: string;
  sales: number; close: number; err: number; perBill: number; ret: number; score: number;
}
interface Person { id: string; name: string; nick: string; units: string[]; sales: number; score: number }
interface SubRow {
  id: string; name: string; nick: string; unit: string;
  target: number; teamSales: number; teamCount: number; hitTarget: number;
  close: number; perBill: number; adCost: number; err: number; score: number; kpiAvg: number;
}
interface HeadRow {
  id: string; name: string; nick: string;
  kpiSub: number; target: number; sales: number; adCost: number; score: number;
  units: Array<{ unit: string; score: number; sales: number; target: number }>;
}
interface YearRow {
  id: string; name: string; nick: string;
  kpiYear: number; sales: number; close: number; err: number; perBill: number; ret: number; kpiAvg: number;
}
interface KpiData {
  setupNeeded?: boolean;
  year: number; months: number[]; month: number; updatedAt: string;
  admin: AdminRow[]; persons: Person[]; sub: SubRow[]; head: HeadRow[]; adminYear: YearRow[];
  topSales: Person[]; topKpi: Person[]; topSalesYear: YearRow[];
}

let lastData: KpiData | null = null;
let reqSeq = 0;
const state = { month: 0 };

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const MEDALS = ['🥇', '🥈', '🥉'];

/* ---------- format ---------- */

/** คะแนน KPI จากชีทเป็นสัดส่วน (0.78 = 78%) — เกิน 100% ได้เมื่อทะลุเป้า */
function scorePct(v: number | null | undefined): string {
  return (v === null || v === undefined || isNaN(Number(v))) ? '-' : (Math.round(Number(v) * 1000) / 10) + '%';
}

function scoreCls(v: number): string {
  if (v >= 0.8) return 'txt-good';
  if (v < 0.6) return 'txt-bad';
  return '';
}

function scoreBadge(v: number): string {
  const cls = v >= 0.8 ? 'ai' : v < 0.6 ? 'urgent' : 'info';
  return '<span class="badge ' + cls + '">' + esc(scorePct(v)) + '</span>';
}

/* ---------- sections ---------- */

function topCard_(title: string, sub: string, rows: Array<{ nick: string; name: string; id: string; big: string; small: string }>): string {
  const items = rows.map(function (r, i) {
    return '<div style="display:flex;align-items:center;gap:8px;margin-top:8px">' +
      '<div style="font-size:20px">' + MEDALS[i] + '</div>' +
      avatarHtml(r.id, r.nick || r.name, undefined, 'sm') +
      '<div style="flex:1;min-width:0"><b>' + esc(r.nick || r.name) + '</b>' +
        '<div class="card-sub" style="margin:0">' + esc(r.small) + '</div></div>' +
      '<b>' + r.big + '</b>' +
    '</div>';
  }).join('');
  return '<div class="card" style="flex:1;min-width:240px">' +
    '<h3>' + title + '</h3><div class="card-sub">' + esc(sub) + '</div>' +
    (items || '<div class="empty-note">ยังไม่มีข้อมูล</div>') + '</div>';
}

function adminTableHtml_(d: KpiData): string {
  const body = d.admin.map(function (r, i) {
    return '<tr>' +
      '<td>' + (i + 1) + '</td>' +
      '<td><b>' + esc(r.nick || r.name) + '</b> <span class="rank-fullname">' + esc(r.name) + '</span></td>' +
      '<td><span class="badge neutral" title="' + esc(r.unitFull) + '">' + esc(r.unit) + '</span></td>' +
      '<td class="num">' + THB(r.sales) + '</td>' +
      '<td class="num">' + pctFmt(r.close) + '</td>' +
      '<td class="num"' + (Math.abs(r.err) > 5 ? ' style="color:var(--bad,#e74c3c)"' : '') + '>' + pctFmt(r.err) + '</td>' +
      '<td class="num">' + fmtNum(Math.round(r.perBill)) + '</td>' +
      '<td class="num"' + (r.ret > 5 ? ' style="color:var(--bad,#e74c3c)"' : '') + '>' + pctFmt(r.ret) + '</td>' +
      '<td class="num ' + scoreCls(r.score) + '"><b>' + esc(scorePct(r.score)) + '</b></td>' +
    '</tr>';
  }).join('');
  return '<div class="card" style="margin-top:14px">' +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
      '<h3 style="margin:0">👥 KPI แอดมินรายคน — ' + esc(TH_MONTHS[d.month - 1] + ' ' + d.year) + '</h3>' +
      '<div class="spacer" style="flex:1"></div>' +
      '<button class="btn-mini" id="kpi-csv">📄 CSV</button>' +
    '</div>' +
    '<div class="card-sub">เกณฑ์จากชีททีม: ยอดขาย 35% • %ปิด 35% (เป้า ≥40%) • %Error 5% (±5%) • เปอร์บิล 20% • %ตีกลับ 5% (&lt;5%)' +
      ' — คนเดียวหลายยูนิต = หลายแถวตามชีท • <b class="txt-good">เขียว ≥80%</b> • <b class="txt-bad">แดง &lt;60%</b></div>' +
    '<div class="table-scroll"><table class="tbl"><thead><tr>' +
      '<th>#</th><th>แอดมิน</th><th>ยูนิต</th><th class="num">ยอดขาย</th><th class="num">%ปิด</th>' +
      '<th class="num">%Error</th><th class="num">เปอร์บิล</th><th class="num">%ตีกลับ</th><th class="num">คะแนน KPI</th>' +
    '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
}

function subTableHtml_(d: KpiData): string {
  if (!d.sub.length) return '';
  const body = d.sub.map(function (r) {
    return '<tr>' +
      '<td><b>' + esc(r.nick || r.name) + '</b></td>' +
      '<td><span class="badge neutral">' + esc(r.unit) + '</span></td>' +
      '<td class="num">' + THB(r.target) + '</td>' +
      '<td class="num">' + THB(r.teamSales) + '</td>' +
      '<td class="num">' + fmtNum(r.hitTarget) + '/' + fmtNum(r.teamCount) + '</td>' +
      '<td class="num">' + pctFmt(r.close) + '</td>' +
      '<td class="num">' + fmtNum(Math.round(r.perBill)) + '</td>' +
      '<td class="num"' + (r.adCost > 33 ? ' style="color:var(--bad,#e74c3c)"' : '') + '>' + pctFmt(r.adCost) + '</td>' +
      '<td class="num ' + scoreCls(r.score) + '"><b>' + esc(scorePct(r.score)) + '</b></td>' +
    '</tr>';
  }).join('');
  // ท็อปรอง = คะแนนเฉลี่ยยูนิตที่ดูแลสูงสุดของเดือน
  const byPerson: Record<string, { nick: string; sum: number; n: number }> = {};
  d.sub.forEach(function (r) {
    const a = (byPerson[r.id] = byPerson[r.id] || { nick: r.nick || r.name, sum: 0, n: 0 });
    a.sum += r.score;
    a.n++;
  });
  const tops = Object.values(byPerson).map(function (a) { return { nick: a.nick, avg: a.sum / a.n }; })
    .sort(function (x, y) { return y.avg - x.avg; });
  return '<div class="card" style="margin-top:14px">' +
    '<h3>🧭 KPI รองหัวหน้า — ' + esc(TH_MONTHS[d.month - 1]) + '</h3>' +
    '<div class="card-sub">เกณฑ์: ยอดยูนิต 30% • ลูกทีมถึงเป้า 20% (80% ของทีมต้องได้ 20k/วัน) • %ปิดเฉลี่ย 20% • เปอร์บิล 10% • ค่าแอด≤33%ของยอด 20%' +
      (tops.length ? ' — 🏅 ท็อปรองเดือนนี้: <b>' + esc(tops[0].nick) + '</b> (' + esc(scorePct(tops[0].avg)) + ' เฉลี่ยทุกยูนิตที่ดูแล)' : '') + '</div>' +
    '<div class="table-scroll"><table class="tbl"><thead><tr>' +
      '<th>รองหัวหน้า</th><th>ยูนิต</th><th class="num">เป้า/เดือน</th><th class="num">ยอดทีม</th>' +
      '<th class="num">ถึงเป้า/ทีม</th><th class="num">%ปิด</th><th class="num">เปอร์บิล</th>' +
      '<th class="num">ค่าแอด/ยอด</th><th class="num">คะแนน</th>' +
    '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
}

function headCardHtml_(d: KpiData): string {
  if (!d.head.length) return '';
  return d.head.map(function (h) {
    const units = h.units.map(function (u) {
      return '<span class="chip" title="' + esc('ยอด ' + THB(u.sales) + ' / เป้า ' + THB(u.target)) + '">' +
        esc(u.unit) + ' ' + esc(scorePct(u.score)) + '</span>';
    }).join(' ');
    return '<div class="card" style="margin-top:14px">' +
      '<h3>👑 KPI หัวหน้าทีม — ' + esc(h.nick || h.name) + ' (' + esc(TH_MONTHS[d.month - 1]) + ')</h3>' +
      '<div class="card-sub">เกณฑ์: KPI รองที่ดูแล 40% • ยอดขายรวม 40% • ค่าแอด≤33% 20%</div>' +
      '<div class="pg-summary">' +
        '<div class="pgs-item"><b class="' + scoreCls(h.score) + '">' + esc(scorePct(h.score)) + '</b><span>คะแนนรวม</span></div>' +
        '<div class="pgs-item"><b>' + esc(scorePct(h.kpiSub)) + '</b><span>KPI เฉลี่ยของรอง</span></div>' +
        '<div class="pgs-item"><b>' + THB(h.sales) + '</b><span>ยอดขาย / เป้า ' + THB(h.target) + '</span></div>' +
        '<div class="pgs-item' + (h.adCost > 33 ? ' warn' : '') + '"><b>' + pctFmt(h.adCost) + '</b><span>ค่าแอดต่อยอด (เป้า ≤33%)</span></div>' +
      '</div>' +
      (units ? '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">' + units + '</div>' : '') +
    '</div>';
  }).join('');
}

function yearTableHtml_(d: KpiData): string {
  if (!d.adminYear.length) return '';
  const body = d.adminYear.map(function (r, i) {
    return '<tr>' +
      '<td>' + (i + 1) + (i < 3 ? ' ' + MEDALS[i] : '') + '</td>' +
      '<td><b>' + esc(r.nick || r.name) + '</b> <span class="rank-fullname">' + esc(r.name) + '</span></td>' +
      '<td class="num">' + THB(r.sales) + '</td>' +
      '<td class="num">' + pctFmt(r.close) + '</td>' +
      '<td class="num">' + fmtNum(Math.round(r.perBill)) + '</td>' +
      '<td class="num">' + pctFmt(r.ret) + '</td>' +
      '<td class="num ' + scoreCls(r.kpiAvg) + '"><b>' + esc(scorePct(r.kpiAvg)) + '</b></td>' +
    '</tr>';
  }).join('');
  const topSale = d.topSalesYear[0];
  return '<div class="card" style="margin-top:14px">' +
    '<h3>📅 สรุปทั้งปี ' + esc(String(d.year)) + ' — ท็อปเซลประจำปี: <b>' +
      esc(topSale ? (topSale.nick || topSale.name) : '—') + '</b>' +
      (topSale ? ' (' + THB(topSale.sales) + ')' : '') + '</h3>' +
    '<div class="card-sub">เรียงตาม KPI เฉลี่ยรวม (เฉพาะเดือนที่มีข้อมูล) • ตัดคนไม่มียอดทั้งปีออก</div>' +
    '<div class="table-scroll"><table class="tbl"><thead><tr>' +
      '<th>#</th><th>แอดมิน</th><th class="num">ยอดขายรวมปี</th><th class="num">%ปิด</th>' +
      '<th class="num">เปอร์บิล</th><th class="num">%ตีกลับ</th><th class="num">KPI เฉลี่ยปี</th>' +
    '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
}

/* ---------- render ---------- */

function render(container: HTMLElement, d: KpiData | null): void {
  if (!d) return;
  if ((d as any).setupNeeded) {
    container.innerHTML = '<div class="empty-note">⏳ ยังไม่มีข้อมูล KPI — รอ sync รายวัน หรือรัน <code>npm run import:kpi</code></div>';
    return;
  }
  const monthBtns = d.months.map(function (m) {
    return '<button class="filter-btn' + (m === d.month ? ' active' : '') + '" data-kpimonth="' + m + '">' +
      esc(TH_MONTHS[m - 1]) + '</button>';
  }).join('');

  const tops =
    '<div class="perf-row" style="display:flex;gap:14px;flex-wrap:wrap">' +
      topCard_('🏆 ท็อป KPI ประจำเดือน', 'คะแนนรวมถ่วงตามยอดขายทุกยูนิตที่ประจำ',
        d.topKpi.map(function (p) {
          return { nick: p.nick, name: p.name, id: p.id, big: scorePct(p.score), small: p.units.join(' • ') + ' — ' + THB(p.sales) };
        })) +
      topCard_('💰 ท็อปเซลประจำเดือน', 'ยอดขายรวมทุกยูนิต (จากชีท KPI)',
        d.topSales.map(function (p) {
          return { nick: p.nick, name: p.name, id: p.id, big: THB(p.sales), small: p.units.join(' • ') + ' — KPI ' + scorePct(p.score) };
        })) +
    '</div>';

  container.innerHTML =
    '<div class="pg-controls">' + monthBtns +
      '<div class="spacer"></div>' +
      '<span class="chip" title="ดึงจากชีท KPI กลางของทีมวันละครั้ง">🕐 อัปเดต ' + esc(String(d.updatedAt).slice(0, 10)) + '</span>' +
    '</div>' +
    tops +
    headCardHtml_(d) +
    subTableHtml_(d) +
    adminTableHtml_(d) +
    yearTableHtml_(d);

  bindEvents(container);
}

function bindEvents(container: HTMLElement): void {
  container.querySelectorAll('[data-kpimonth]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.month = Number(btn.getAttribute('data-kpimonth'));
      fetchData(container);
    });
  });
  const csv = container.querySelector('#kpi-csv');
  if (csv) csv.addEventListener('click', function () {
    const d = lastData;
    if (!d || !d.admin.length) { toast('ยังไม่มีข้อมูลให้ Export'); return; }
    const out: (string | number)[][] = [
      ['KPI แอดมิน ' + TH_MONTHS[d.month - 1] + ' ' + d.year],
      ['ชื่อเล่น', 'ชื่อจริง', 'ยูนิต', 'ยอดขาย', '%ปิด', '%Error', 'เปอร์บิล', '%ตีกลับ', 'คะแนน KPI (%)'],
    ];
    d.admin.forEach(function (r) {
      out.push([r.nick, r.name, r.unit, r.sales, Math.round(r.close * 10) / 10,
        Math.round(r.err * 100) / 100, Math.round(r.perBill), Math.round(r.ret * 100) / 100,
        Math.round(r.score * 1000) / 10]);
    });
    downloadCSV(out, 'kpi-admin-' + d.year + '-' + String(d.month).padStart(2, '0'));
  });
}

function fetchData(container: HTMLElement): void {
  const seq = ++reqSeq;
  serverCall<KpiData>('apiKpi', { month: state.month }).then(function (d) {
    if (seq !== reqSeq) return;
    lastData = d;
    if (d && d.month) state.month = d.month;
    render(container, d);
  }).catch(function (err) {
    if (seq !== reqSeq) return;
    showError(container, (err && err.message) || 'เรียกข้อมูลไม่สำเร็จ', function () {
      container.innerHTML = '<div class="loading"><div class="spinner"></div>กำลังโหลดข้อมูล...</div>';
      fetchData(container);
    });
  });
}

export const kpi = {
  load: async (container: HTMLElement, force?: boolean): Promise<void> => {
    if (lastData && !force) {
      render(container, lastData);
      return;
    }
    container.innerHTML = '<div class="loading"><div class="spinner"></div>กำลังโหลดข้อมูล KPI...</div>';
    fetchData(container);
  },
};
