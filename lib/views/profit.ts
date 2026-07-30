// lib/views/profit.ts — หน้า "กำไร & ตีกลับ" (บรีฟ 2026-07-31: กำไรภาพรวมรายปี ยูนิต พร้อมตีกลับ)
// กำไรจริงจากชีทสรุปรายสินค้า (unit_daily) — ตาราง pivot ยูนิต × เดือน + drill รายวัน + ตีกลับรายเดือน

import { serverCall, esc, fmtNum, THB, pctFmt, openModal, showError, downloadCSV, toast } from '@/lib/ui/helpers';

interface Cell { profit: number; sales: number; ads: number }
interface UnitAge { firstSale: string; days: number; openEnded: boolean; active: boolean }
interface UnitRow { u: string; product: string; age?: UnitAge | null; months: Record<string, Cell | null>; total: Cell }
interface ProfitData {
  setupNeeded?: boolean;
  year: string; months: string[]; units: UnitRow[];
  monthTotals: Record<string, Cell>;
  returnsByMonth: Record<string, { value: number; items: number }>;
  totals: { profit: number; sales: number; ads: number; returnValue: number; returnItems: number };
  testProducts?: Array<{ u: string; name: string; ok: boolean | null }>;
  testSummary?: { total: number; ok: number; fail: number; pending: number; pct: number | null };
}

let lastData: ProfitData | null = null;
let reqSeq = 0;

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const mLabel = (m: string) => TH_MONTHS[Number(m.slice(5, 7)) - 1] || m;

/** เงินแบบย่อ (1.2M / 340k) ให้ pivot 7+ เดือนอ่านได้ในจอเดียว */
function thbK(n: number): string {
  const v = Math.round(n);
  const a = Math.abs(v);
  const s = a >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : String(v);
  return s;
}

function profCell(c: Cell | null, u: string, m: string): string {
  if (!c || (c.profit === 0 && c.sales === 0 && c.ads === 0)) return '<td class="num" style="opacity:.35">—</td>';
  const cls = c.profit > 0 ? 'txt-good' : c.profit < 0 ? 'txt-bad' : '';
  return '<td class="num"><a href="javascript:void(0)" class="' + cls + '" data-drill="' + esc(u) + '|' + esc(m) +
    '" title="' + esc('ขาย ' + THB(c.sales) + ' • แอด ' + THB(c.ads) + ' • คลิกดูรายวัน') + '" ' +
    'style="text-decoration:none"><b>' + esc(thbK(c.profit)) + '</b></a></td>';
}

function render(container: HTMLElement, d: ProfitData | null): void {
  if (!d) return;
  if (d.setupNeeded) {
    container.innerHTML = '<div class="empty-note">⏳ ยังไม่มีข้อมูลกำไร — รอ sync ชีทสรุปรายสินค้า (npm run import:product-sheets)</div>';
    return;
  }
  const t = d.totals;
  const retPct = t.sales > 0 ? Math.round((t.returnValue / t.sales) * 1000) / 10 : null;

  const cards = '<div class="pg-summary">' +
    '<div class="pgs-item' + (t.profit < 0 ? ' warn' : ' ok') + '"><b>' + THB(t.profit) + '</b><span>กำไรสุทธิรวมปี ' + esc(d.year) + ' (ตามชีททีม)</span></div>' +
    '<div class="pgs-item"><b>' + THB(t.sales) + '</b><span>ยอดขายรวม (ชีท)</span></div>' +
    '<div class="pgs-item"><b>' + THB(t.ads) + '</b><span>ค่าแอดรวม (ชีท)</span></div>' +
    '<div class="pgs-item' + (retPct !== null && retPct > 5 ? ' warn' : '') + '"><b>' + THB(t.returnValue) + '</b>' +
      '<span>ตีกลับทั้งปี ' + fmtNum(t.returnItems) + ' รายการ' + (retPct !== null ? ' (' + retPct + '% ของยอด)' : '') + '</span></div>' +
  '</div>';

  // ---- pivot ยูนิต × เดือน ----
  const head = '<tr><th>ยูนิต</th><th class="num">อายุ</th>' + d.months.map((m) => '<th class="num">' + esc(mLabel(m)) + '</th>').join('') +
    '<th class="num">รวมปี</th><th class="num">มาร์จิ้น</th></tr>';
  const body = d.units.map((x) => {
    const cells = d.months.map((m) => profCell(x.months[m], x.u, m)).join('');
    const cls = x.total.profit > 0 ? 'txt-good' : x.total.profit < 0 ? 'txt-bad' : '';
    const margin = x.total.sales > 0 ? Math.round((x.total.profit / x.total.sales) * 1000) / 10 : null;
    // อายุสินค้า = นับจากวันแรกที่มียอดในชีท (ข้อมูลเริ่ม ม.ค. 2026 — ตัวที่ขายมาก่อนขึ้น ≥)
    const ageTxt = x.age
      ? '<span title="' + esc('เริ่มมียอด ' + x.age.firstSale + (x.age.active ? ' • ยังขายอยู่' : ' • หยุดขายแล้ว')) + '">' +
        (x.age.openEnded ? '≥' : '') + fmtNum(x.age.days) + ' วัน' + (x.age.active ? '' : ' ⏸') + '</span>'
      : '-';
    return '<tr><td><b>' + esc(x.u) + '</b>' +
      (x.product ? ' <span class="rank-fullname">' + esc(x.product) + '</span>' : '') + '</td>' +
      '<td class="num">' + ageTxt + '</td>' +
      cells +
      '<td class="num ' + cls + '"><b>' + THB(x.total.profit) + '</b></td>' +
      '<td class="num ' + cls + '">' + pctFmt(margin) + '</td></tr>';
  }).join('');
  const totRow = '<tr style="font-weight:700;border-top:2px solid var(--border,#ccc)"><td>รวม</td><td></td>' +
    d.months.map((m) => {
      const c = d.monthTotals[m];
      const cls = c.profit > 0 ? 'txt-good' : c.profit < 0 ? 'txt-bad' : '';
      return '<td class="num ' + cls + '" title="' + esc('ขาย ' + THB(c.sales) + ' • แอด ' + THB(c.ads)) + '">' + esc(thbK(c.profit)) + '</td>';
    }).join('') +
    '<td class="num ' + (t.profit < 0 ? 'txt-bad' : 'txt-good') + '">' + THB(t.profit) + '</td><td></td></tr>';

  const pivot = '<div class="card" style="margin-top:14px">' +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
      '<h3 style="margin:0">💹 กำไรสุทธิรายยูนิต × เดือน — ปี ' + esc(d.year) + '</h3>' +
      '<div class="spacer" style="flex:1"></div>' +
      '<button class="btn-mini" id="pf-csv">📄 CSV</button>' +
    '</div>' +
    '<div class="card-sub">ตัวเลขจากชีทสรุปรายสินค้าของทีม (หักต้นทุน + สำรองตีกลับ + Fixcost + ภาษี + คอมแล้ว) • ' +
      '👆 คลิกตัวเลขเพื่อดูกำไรรายวันของยูนิตเดือนนั้น • <b class="txt-good">เขียว = กำไร</b> <b class="txt-bad">แดง = ขาดทุน</b></div>' +
    '<div class="table-scroll"><table class="tbl"><thead>' + head + '</thead><tbody>' + body + totRow + '</tbody></table></div></div>';

  // ---- ตีกลับรายเดือน คู่กำไร ----
  const retMonths = d.months;
  const retBody = retMonths.map((m) => {
    const r = d.returnsByMonth[m] || { value: 0, items: 0 };
    const mt = d.monthTotals[m];
    const pct = mt && mt.sales > 0 ? Math.round((r.value / mt.sales) * 1000) / 10 : null;
    return '<tr><td>' + esc(mLabel(m)) + '</td>' +
      '<td class="num">' + THB(mt ? mt.sales : 0) + '</td>' +
      '<td class="num ' + (mt && mt.profit < 0 ? 'txt-bad' : 'txt-good') + '">' + THB(mt ? mt.profit : 0) + '</td>' +
      '<td class="num">' + THB(r.value) + '</td>' +
      '<td class="num">' + fmtNum(r.items) + '</td>' +
      '<td class="num"' + (pct !== null && pct > 5 ? ' style="color:var(--bad,#e74c3c)"' : '') + '>' + pctFmt(pct) + '</td></tr>';
  }).join('');
  const retTable = '<div class="card" style="margin-top:14px">' +
    '<h3>↩️ กำไร vs ตีกลับ รายเดือน</h3>' +
    '<div class="card-sub">ตีกลับจากชีทตีกลับของทีม (มูลค่า = ราคา × จำนวนชิ้น) • เกณฑ์ทีม: %ตีกลับต้อง &lt; 5% ของยอด</div>' +
    '<div class="table-scroll"><table class="tbl"><thead><tr>' +
      '<th>เดือน</th><th class="num">ยอดขาย (ชีท)</th><th class="num">กำไรสุทธิ</th>' +
      '<th class="num">ตีกลับ (มูลค่า)</th><th class="num">ตีกลับ (รายการ)</th><th class="num">%ตีกลับ/ยอด</th>' +
    '</tr></thead><tbody>' + retBody + '</tbody></table></div></div>';

  // ---- สินค้าเทสประจำปี (จากแท็บ 0.ข้อมูล ของชีท KPI: ✅ ติด / ❌ ไม่ติด) ----
  const ts = d.testSummary;
  const testCard = ts && ts.total
    ? '<div class="card" style="margin-top:14px">' +
      '<h3>🧪 สินค้าเทสประจำปี — สำเร็จ ' + (ts.pct === null ? '—' : ts.pct + '%') +
        ' (ติด ' + fmtNum(ts.ok) + ' / ตัดสินแล้ว ' + fmtNum(ts.ok + ts.fail) + ' จากทั้งหมด ' + fmtNum(ts.total) + ' ตัว)</h3>' +
      '<div class="card-sub">จากแท็บ 0.ข้อมูล ของชีท KPI — ✅ ติด • ❌ ไม่ติด • ไม่มีเครื่องหมาย = ยังเทสอยู่/ยังไม่ตัดสิน (' + fmtNum(ts.pending) + ' ตัว)</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
        (d.testProducts || []).map(function (t) {
          const badge = t.ok === true ? 'ai' : t.ok === false ? 'urgent' : 'neutral';
          const mark = t.ok === true ? '✅' : t.ok === false ? '❌' : '⏳';
          return '<span class="badge ' + badge + '">' + mark + ' ' + esc(t.u) + ' ' + esc(t.name) + '</span>';
        }).join('') +
      '</div></div>'
    : '';

  container.innerHTML = cards + pivot + retTable + testCard;
  bindEvents(container);
}

function openDaily(u: string, month: string): void {
  openModal(
    '<div class="modal-head"><h3>💹 ' + esc(u) + ' — กำไรรายวัน ' + esc(mLabel(month)) + '</h3>' +
    '<button class="modal-close">✕</button></div>' +
    '<div class="loading"><div class="spinner"></div>กำลังโหลด...</div>'
  );
  serverCall<any>('apiProfit', { u, month }).then(function (res) {
    const root = document.getElementById('modal-root');
    const modal = root && root.querySelector('.modal');
    if (!modal) return;
    const daily = (res && res.daily) || [];
    const body = daily.map(function (x: any) {
      const cls = x.profit > 0 ? 'txt-good' : x.profit < 0 ? 'txt-bad' : '';
      return '<tr><td>' + esc(String(x.date).slice(8, 10) + ' ' + mLabel(x.date)) + '</td>' +
        '<td class="num">' + THB(x.sales) + '</td>' +
        '<td class="num">' + fmtNum(x.orders) + '</td>' +
        '<td class="num">' + THB(x.ads) + '</td>' +
        '<td class="num ' + cls + '"><b>' + THB(x.profit) + '</b></td>' +
        '<td class="num ' + cls + '">' + pctFmt(x.margin * 100) + '</td></tr>';
    }).join('');
    const sum = daily.reduce(function (s: any, x: any) {
      s.sales += x.sales; s.ads += x.ads; s.profit += x.profit; return s;
    }, { sales: 0, ads: 0, profit: 0 });
    modal.innerHTML =
      '<div class="modal-head"><h3>💹 ' + esc(u) + ' — กำไรรายวัน ' + esc(mLabel(month)) + '</h3>' +
      '<button class="modal-close">✕</button></div>' +
      '<div class="card-sub" style="margin-bottom:8px">รวมเดือน: ขาย ' + THB(sum.sales) + ' • แอด ' + THB(sum.ads) +
        ' • <b class="' + (sum.profit < 0 ? 'txt-bad' : 'txt-good') + '">กำไร ' + THB(sum.profit) + '</b>' +
        ' • วันขาดทุนขึ้นแดง — ตรงกับการ์ดแจ้งเตือนหน้า Sales</div>' +
      '<div class="table-scroll" style="max-height:60vh"><table class="tbl"><thead><tr>' +
        '<th>วันที่</th><th class="num">ยอดขาย</th><th class="num">ออเดอร์</th>' +
        '<th class="num">ค่าแอด</th><th class="num">กำไรสุทธิ</th><th class="num">มาร์จิ้น</th>' +
      '</tr></thead><tbody>' + (body || '<tr><td colspan="6">ไม่มีข้อมูล</td></tr>') + '</tbody></table></div>';
    modal.querySelectorAll('.modal-close').forEach(function (x) {
      x.addEventListener('click', function () { const rt = document.getElementById('modal-root'); if (rt) rt.innerHTML = ''; });
    });
  }).catch(function () { toast('⚠️ โหลดรายวันไม่สำเร็จ'); });
}

function bindEvents(container: HTMLElement): void {
  container.querySelectorAll('[data-drill]').forEach(function (a) {
    a.addEventListener('click', function () {
      const parts = String(a.getAttribute('data-drill') || '').split('|');
      if (parts.length === 2) openDaily(parts[0], parts[1]);
    });
  });
  const csv = container.querySelector('#pf-csv');
  if (csv) csv.addEventListener('click', function () {
    const d = lastData;
    if (!d || !d.units.length) { toast('ยังไม่มีข้อมูลให้ Export'); return; }
    const out: (string | number)[][] = [
      ['กำไรสุทธิรายยูนิต ปี ' + d.year + ' (จากชีทสรุปรายสินค้า)'],
      ['ยูนิต', 'สินค้า', ...d.months.map(mLabel), 'รวมปี', 'ยอดขายปี', 'ค่าแอดปี'],
    ];
    d.units.forEach(function (x) {
      out.push([x.u, x.product,
        ...d.months.map(function (m) { const c = x.months[m]; return c ? Math.round(c.profit) : ''; }),
        x.total.profit, x.total.sales, x.total.ads]);
    });
    downloadCSV(out, 'profit-' + d.year);
  });
}

function fetchData(container: HTMLElement): void {
  const seq = ++reqSeq;
  serverCall<ProfitData>('apiProfit', {}).then(function (d) {
    if (seq !== reqSeq) return;
    lastData = d;
    render(container, d);
  }).catch(function (err) {
    if (seq !== reqSeq) return;
    showError(container, (err && err.message) || 'เรียกข้อมูลไม่สำเร็จ', function () {
      container.innerHTML = '<div class="loading"><div class="spinner"></div>กำลังโหลดข้อมูล...</div>';
      fetchData(container);
    });
  });
}

export const profit = {
  load: async (container: HTMLElement, force?: boolean): Promise<void> => {
    if (lastData && !force) {
      render(container, lastData);
      return;
    }
    container.innerHTML = '<div class="loading"><div class="spinner"></div>กำลังโหลดข้อมูลกำไร...</div>';
    fetchData(container);
  },
};
