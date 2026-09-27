// lib/views/profit.ts — หน้า "กำไร & ตีกลับ" (บรีฟ 2026-07-31: กำไรภาพรวมรายปี ยูนิต พร้อมตีกลับ)
// กำไรจริงจากชีทสรุปรายสินค้า (unit_daily) — ตาราง pivot ยูนิต × เดือน + drill รายวัน + ตีกลับรายเดือน
//
// UI รอบ 2 (26 ก.ย. 69): แถวเครื่องมือกลาง (C4) · "ยังไม่มีในชีท" ไม่ใช่ ฿0 (E1) · สีพื้น 3 ระดับตามขนาดกำไร/ขาดทุน
// + กดหัวคอลัมน์เรียงได้ (G2) · สีตัวเลขตามกติกากลาง color-rules (E3) · คำอธิบายยาวย้ายเข้า ⓘ (D3)

import {
  serverCall, esc, fmtNum, THB, numK, pct1, pct2, dash, dateTh, monthTh, openModal, rebindModalClose, modalCloseBtn,
  showError, downloadCSV, downloadXLS, toast, infoTip, stateHtml, downloadMenuHtml, bindDownloadMenu,
} from '@/lib/ui/helpers';
import { icon, statusPill, statusDot, statIcon } from '@/lib/ui/icons';
import { profitKind, kindClass, heatClass, legendHtml, type ColorKind } from '@/lib/ui/color-rules';
import { makeSortable, sortTh } from '@/lib/ui/table-sort';
import { profitSkel } from '@/lib/ui/skeletons';

interface Cell { profit: number; sales: number; ads: number }
interface UnitAge { firstSale: string; days: number; openEnded: boolean; active: boolean }
interface UnitRow { u: string; product: string; age?: UnitAge | null; months: Record<string, Cell | null>; total: Cell }
interface RetPerson { name: string; crm: boolean; items: number; value: number }
interface ProfitData {
  setupNeeded?: boolean;
  year: string; months: string[]; units: UnitRow[];
  // ยูนิตที่ตั้งเป้าในชีท KPI แต่ชีทสรุปรายสินค้ายังไม่มีแถวเลย (E1) · วันล่าสุดที่ชีทกำไร/ชีทตีกลับมีข้อมูล
  missingUnits?: Array<{ u: string; product: string }>;
  asOf?: string; retAsOf?: string;
  monthTotals: Record<string, Cell>;
  returnsByMonth: Record<string, { value: number; items: number; crmValue?: number; crmItems?: number }>;
  returnsByPerson?: Record<string, RetPerson[]>;
  totals: { profit: number; sales: number; ads: number; returnValue: number; returnItems: number };
  testProducts?: Array<{ u: string; name: string; ok: boolean | null }>;
  testSummary?: { total: number; ok: number; fail: number; pending: number; pct: number | null };
}

let lastData: ProfitData | null = null;
let reqSeq = 0;
// ตัวกรองส่วน "ตีกลับรายคน" — จำข้ามการ re-render (เดือน '' = เดือนล่าสุดที่มีข้อมูล)
let retMonthSel = '';
let retTypeSel: 'all' | 'admin' | 'crm' = 'all';

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const mLabel = (m: string) => TH_MONTHS[Number(m.slice(5, 7)) - 1] || m;
const yearTh_ = (year: string | number) => String(Number(year) + 543);
/** ช่องที่ชีทยังไม่มีแถว — ตัวหนังสือสีเทา ไม่ใช่ ฿0 (E1) */
const NA_SHEET = '<span class="kpr-na">ยังไม่มีในชีท</span>';
/** เกณฑ์ทีม: %ตีกลับต้องไม่เกิน 5% ของยอด */
const RET_LIMIT = 5;

const colorNum_ = (html: string, kind: ColorKind) => '<span class="' + (kindClass(kind) || 'v-plain') + '">' + html + '</span>';

/** เดือนนี้ชีทตีกลับยังไม่มีข้อมูล (หลังวันล่าสุดที่มีรายการ) — ต่างจาก "ตีกลับ 0 จริง" */
function retMissing_(d: ProfitData, m: string): boolean {
  if (d.returnsByMonth[m]) return false;
  return !d.retAsOf || m > d.retAsOf.slice(0, 7);
}

/**
 * ระดับสีพื้นของตาราง pivot — ใช้เปอร์เซ็นไทล์ที่ 90 ของขนาดกำไร/ขาดทุนเป็นเพดาน ไม่ใช่ค่าสูงสุด
 * เพราะเดือนเดียวที่ติดลบหนักมาก (UN1 ม.ค. −794K) จะทำให้ช่องอื่นเกือบทั้งตารางจางระดับ 1 หมด อ่านอะไรไม่ออก
 * ช่องที่เกินเพดานได้ระดับเข้มสุด (heatClass ตัดที่ 1 ให้เอง)
 */
function heatScale_(d: ProfitData): number {
  const v: number[] = [];
  d.units.forEach((x) => d.months.forEach((m) => { const c = x.months[m]; if (c && c.profit) v.push(Math.abs(c.profit)); }));
  if (!v.length) return 0;
  v.sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.floor(0.9 * (v.length - 1)))];
}

function profCell(c: Cell | null, u: string, m: string, scale: number): string {
  // ไม่มีแถวในชีทเดือนนั้น ≠ กำไร 0 (E1)
  if (!c) return '<td class="num" data-sort="">' + NA_SHEET + '</td>';
  // มีแถวแต่ศูนย์ทั้งหมด (ยังไม่เริ่มขาย) = ศูนย์จริง — เลขจางๆ ไม่ระบายสี ไม่มีอะไรให้กดดู
  if (c.profit === 0 && c.sales === 0 && c.ads === 0) return '<td class="num" data-sort="0"><span class="tx-muted">0</span></td>';
  const detail = 'ขาย ' + THB(c.sales) + ' • แอด ' + THB(c.ads) + ' • กำไร ' + THB(c.profit);
  return '<td class="num ' + heatClass(c.profit, scale) + '" data-sort="' + c.profit + '">' +
    '<button type="button" class="pf-drill ' + (kindClass(profitKind(c.profit)) || 'v-plain') + '" data-drill="' + esc(u) + '|' + esc(m) + '"' +
    ' title="' + esc(detail + ' • กดดูรายวัน') + '" aria-label="' + esc(u + ' ' + mLabel(m) + ' ' + detail + ' กดดูกำไรรายวัน') + '">' +
    esc(numK(c.profit)) + '</button></td>';
}

function summaryHtml_(d: ProfitData): string {
  const t = d.totals;
  // %ตีกลับคิดเฉพาะเดือนที่ชีทตีกลับมีข้อมูลแล้ว — เดิมหารด้วยยอดทั้งปีรวมเดือนที่ยังไม่มีตีกลับ ทำให้ % ต่ำกว่าจริง (E1)
  const missRet = d.months.filter((m) => retMissing_(d, m));
  const salesWithRet = d.months.filter((m) => !retMissing_(d, m))
    .reduce((s, m) => s + ((d.monthTotals[m] && d.monthTotals[m].sales) || 0), 0);
  const retPct = salesWithRet > 0 ? Math.round((t.returnValue / salesWithRet) * 10000) / 100 : null;
  const box = (label: string, value: string, sub: string) =>
    '<div class="stat-box"><div class="sb-label">' + label + '</div><div class="sb-value">' + value + '</div>' +
    (sub ? '<div class="sb-sub">' + sub + '</div>' : '') + '</div>';
  return '<div class="stat-boxes pf-stats">' +
    box(statIcon('profit') + ' กำไรสุทธิรวมปี ' + esc(yearTh_(d.year)), colorNum_(THB(t.profit), profitKind(t.profit)), 'ตามชีทสรุปรายสินค้า') +
    box(statIcon('revenue') + ' ยอดขายรวม', colorNum_(THB(t.sales), 'none'), 'จากชีทสรุปรายสินค้า') +
    box(statIcon('adSpend') + ' ค่าแอดรวม', colorNum_(THB(t.ads), 'none'), 'จากชีทสรุปรายสินค้า') +
    box(icon('package-x', { size: 14, cls: 'si si-order' }) + ' ตีกลับทั้งปี',
      // เกินเกณฑ์ 5% = ส้ม (เฝ้าดู) สีเดียวกับคอลัมน์ %ตีกลับในตารางรายเดือน
      colorNum_(THB(t.returnValue), retPct !== null && retPct > RET_LIMIT ? 'warn' : 'none'),
      fmtNum(t.returnItems) + ' รายการ' + (retPct !== null ? ' • ' + pct2(retPct) + ' ของยอด' : '') +
      (missRet.length ? ' • ' + esc(missRet.map(mLabel).join(', ')) + ' ยังไม่มีในชีท' : '')) +
  '</div>';
}

function pivotHtml_(d: ProfitData): string {
  const t = d.totals;
  const scale = heatScale_(d);
  const head = '<tr>' + sortTh('ยูนิต', 'u') + sortTh('อายุ', 'age', { num: true }) +
    d.months.map((m, i) => sortTh(esc(mLabel(m)), 'm' + i, { num: true })).join('') +
    sortTh('รวมปี', 'total', { num: true }) + sortTh('มาร์จิ้น', 'margin', { num: true }) + '</tr>';
  const body = d.units.map((x) => {
    const cells = d.months.map((m) => profCell(x.months[m], x.u, m, scale)).join('');
    const kind = profitKind(x.total.profit);
    const margin = x.total.sales > 0 ? Math.round((x.total.profit / x.total.sales) * 1000) / 10 : null;
    // อายุสินค้า = นับจากวันแรกที่มียอดในชีท (ข้อมูลเริ่ม ม.ค. 2026 — ตัวที่ขายมาก่อนขึ้น ≥)
    const ageTxt = x.age
      ? '<span title="' + esc('เริ่มมียอด ' + dateTh(x.age.firstSale) + (x.age.active ? ' • ยังขายอยู่' : ' • หยุดขายแล้ว')) + '">' +
        '<span class="pf-age-n">' + (x.age.openEnded ? '≥' : '') + fmtNum(x.age.days) + ' วัน</span>' +
        (x.age.active ? '' : ' <span class="tx-muted pf-stop">หยุดขาย</span>') + '</span>'
      : dash();
    return '<tr><td data-sort="' + esc(x.u) + '"><b>' + esc(x.u) + '</b>' +
      (x.product ? ' <span class="rank-fullname">' + esc(x.product) + '</span>' : '') + '</td>' +
      '<td class="num" data-sort="' + (x.age ? x.age.days : '') + '">' + ageTxt + '</td>' +
      cells +
      '<td class="num" data-sort="' + x.total.profit + '">' + colorNum_(THB(x.total.profit), kind) + '</td>' +
      '<td class="num" data-sort="' + (margin === null ? '' : margin) + '">' + (margin === null ? dash() : colorNum_(pct1(margin), kind)) + '</td></tr>';
  }).join('');
  const totRow = '<tr class="tbl-total"><td>รวม</td><td></td>' +
    d.months.map((m) => {
      const c = d.monthTotals[m];
      return '<td class="num" title="' + esc('ขาย ' + THB(c.sales) + ' • แอด ' + THB(c.ads)) + '">' + colorNum_(esc(numK(c.profit)), profitKind(c.profit)) + '</td>';
    }).join('') +
    '<td class="num">' + colorNum_(THB(t.profit), profitKind(t.profit)) + '</td><td></td></tr>';

  const miss = d.missingUnits || [];
  const note = miss.length
    ? '<div class="kpr-note">' + icon('info', { size: 14 }) + '<span>' + fmtNum(miss.length) + ' ยูนิตยังไม่มีในชีทสรุปรายสินค้า (' +
      miss.map((x) => esc(x.u)).join(', ') + ') — จึงยังไม่อยู่ในตารางและไม่นับในยอดรวม (ไม่ใช่กำไร 0)</span></div>'
    : '';

  return '<div class="card">' +
    '<div class="card-head"><h3>กำไรสุทธิรายยูนิต × เดือน — ปี ' + esc(yearTh_(d.year)) +
      infoTip('ตัวเลขจากชีทสรุปรายสินค้าของทีม • กำไรสุทธิ = ยอดขาย − ต้นทุน − ค่าแอด − สำรองตีกลับ − Fixcost − ภาษี − ค่าคอม ' +
        '(ชีทหักให้แล้ว เว็บอ่านผลอย่างเดียว) • มาร์จิ้น = กำไรสุทธิรวมปี ÷ ยอดขายรวมปี', 'กำไรสุทธิ') + '</h3></div>' +
    '<div class="card-sub">กดตัวเลขเพื่อดูกำไรรายวันของยูนิตเดือนนั้น</div>' +
    // บรรทัดอธิบายสี + หน่วย (ตัวเลขในช่องเป็นแบบย่อไม่มี ฿ ให้ 9 เดือนอ่านได้ในจอเดียว)
    '<div class="color-legend"><span class="lg lg-good">กำไร</span><span class="lg lg-bad">ขาดทุน</span>' +
      '<span>สีพื้นยิ่งเข้ม = กำไร/ขาดทุนยิ่งมาก</span><span>หน่วย: บาท (K = พัน)</span></div>' +
    '<div class="table-scroll"><table class="tbl pf-pivot"><thead>' + head + '</thead><tbody>' + body + totRow + '</tbody></table></div>' +
    note + '</div>';
}

function returnsHtml_(d: ProfitData): string {
  const retBody = d.months.map((m) => {
    const r = d.returnsByMonth[m] || { value: 0, items: 0 };
    const missing = retMissing_(d, m);
    const mt = d.monthTotals[m];
    const pct = !missing && mt && mt.sales > 0 ? Math.round((r.value / mt.sales) * 10000) / 100 : null;
    return '<tr><td>' + esc(mLabel(m)) + '</td>' +
      '<td class="num">' + colorNum_(THB(mt ? mt.sales : 0), 'none') + '</td>' +
      '<td class="num">' + colorNum_(THB(mt ? mt.profit : 0), profitKind(mt ? mt.profit : 0)) + '</td>' +
      '<td class="num">' + (missing ? NA_SHEET : THB(r.value)) + '</td>' +
      '<td class="num">' + (missing ? dash() : fmtNum(r.items)) + '</td>' +
      '<td class="num">' + (pct === null ? dash() : colorNum_(pct2(pct), pct > RET_LIMIT ? 'warn' : 'none')) + '</td></tr>';
  }).join('');
  return '<div class="card">' +
    '<div class="card-head"><h3>กำไรเทียบตีกลับ รายเดือน' +
      infoTip('ตีกลับจากชีทตีกลับของทีม • มูลค่า = ราคา × จำนวนชิ้น • %ตีกลับ = มูลค่าตีกลับ ÷ ยอดขายเดือนนั้น • เกณฑ์ทีม: ต้องไม่เกิน 5% ของยอด', 'ตีกลับ') + '</h3></div>' +
    '<div class="color-legend"><span class="lg lg-good">กำไร</span><span class="lg lg-bad">ขาดทุน</span>' +
      '<span class="lg lg-warn">%ตีกลับเกินเกณฑ์ทีม 5%</span></div>' +
    '<div class="table-scroll"><table class="tbl pf-ret"><thead><tr>' +
      '<th>เดือน</th><th class="num">ยอดขาย (ชีท)</th><th class="num">กำไรสุทธิ</th>' +
      '<th class="num">ตีกลับ (มูลค่า)</th><th class="num">ตีกลับ (รายการ)</th><th class="num">%ตีกลับ</th>' +
    '</tr></thead><tbody>' + retBody + '</tbody></table></div></div>';
}

function testCardHtml_(d: ProfitData): string {
  // ผลเทสบอกด้วยป้ายสถานะ (จุด+พื้นสี) — ต้องมีคำ "ติด/ไม่ติด" อยู่ในป้ายด้วย (สีอย่างเดียวคนตาบอดสีแยกไม่ได้)
  const ts = d.testSummary;
  if (!ts || !ts.total) return '';
  return '<div class="card">' +
    '<div class="card-head"><h3>สินค้าเทสประจำปี' +
      infoTip('จากแท็บ 0.ข้อมูล ของชีท KPI • %สำเร็จ = ติด ÷ (ติด + ไม่ติด) ไม่นับตัวที่ยังเทสอยู่', 'สินค้าเทส') + '</h3></div>' +
    '<div class="card-sub">สำเร็จ <b>' + (ts.pct === null ? '—' : pct1(ts.pct)) + '</b> — ติด ' + fmtNum(ts.ok) + ' จากที่ตัดสินแล้ว ' +
      fmtNum(ts.ok + ts.fail) + ' ตัว (ทั้งหมด ' + fmtNum(ts.total) + ' ตัว)</div>' +
    '<div class="color-legend"><span>' + statusDot('good') + ' ติด</span><span>' + statusDot('bad') + ' ไม่ติด</span>' +
      '<span>' + statusDot('muted') + ' ยังเทสอยู่ (' + fmtNum(ts.pending) + ' ตัว)</span></div>' +
    '<div class="pf-tests">' +
      (d.testProducts || []).map(function (t) {
        const kind = t.ok === true ? 'good' : t.ok === false ? 'bad' : 'muted';
        const word = t.ok === true ? 'ติด' : t.ok === false ? 'ไม่ติด' : 'ยังเทสอยู่';
        return statusPill(kind, esc(t.u) + ' ' + esc(t.name) + ' · ' + word);
      }).join('') +
    '</div></div>';
}

function render(container: HTMLElement, d: ProfitData | null): void {
  if (!d) return;
  if (d.setupNeeded) {
    container.innerHTML = stateHtml('wait', {
      body: 'ยังไม่มีข้อมูลกำไรจากชีทสรุปรายสินค้า — ระบบดึงเป็นรอบๆ ลองกลับมาดูอีกครั้งในอีกสักครู่',
      adminDetail: 'unit_daily ว่าง — รอ sync ชีทสรุปรายสินค้า (npm run import:product-sheets)',
    });
    return;
  }
  container.innerHTML =
    '<div class="toolbar">' +
      '<div class="tb-range"><span class="kpr-year">ปี ' + esc(yearTh_(d.year)) + '</span></div>' +
      (d.units.length ? '<div class="tb-actions">' + downloadMenuHtml('pf-dl', { excel: true }) + '</div>' : '') +
    '</div>' +
    '<div class="data-asof">' + icon('calendar', { size: 14 }) + '<span>' +
      'กำไรจากชีทสรุปรายสินค้า' + (d.asOf ? ' ข้อมูลถึง ' + esc(dateTh(d.asOf)) : '') +
      (d.retAsOf ? ' • ตีกลับจากชีทตีกลับ ข้อมูลถึง ' + esc(dateTh(d.retAsOf)) : '') + '</span></div>' +
    summaryHtml_(d) +
    '<div class="stack">' + pivotHtml_(d) + returnsHtml_(d) + personCardHtml_(d) + testCardHtml_(d) + '</div>';
  bindEvents(container);
}

/** เดือนที่ใช้แสดงตีกลับรายคน — ค่าที่เลือกไว้ ถ้าไม่มีข้อมูลใช้เดือนล่าสุดที่มี */
function retPersonMonth_(d: ProfitData): string {
  const months = Object.keys(d.returnsByPerson || {}).sort();
  if (!months.length) return '';
  return retMonthSel && months.indexOf(retMonthSel) >= 0 ? retMonthSel : months[months.length - 1];
}

function personRowsHtml_(d: ProfitData, month: string): string {
  const all = (d.returnsByPerson || {})[month] || [];
  const list = retTypeSel === 'all' ? all : all.filter((p) => (retTypeSel === 'crm') === p.crm);
  if (!list.length) return '<tr><td colspan="6" class="tx-muted">ไม่มีรายการตีกลับของกลุ่มนี้ในเดือนนี้</td></tr>';
  const monthTotal = all.reduce((s, p) => s + p.value, 0);
  const rows = list.map((p, i) => {
    const pct = monthTotal > 0 ? Math.round((p.value / monthTotal) * 1000) / 10 : null;
    return '<tr><td class="num"><span class="sort-rank">' + (i + 1) + '</span></td>' +
      '<td><b>' + esc(p.name.replace(/^CRM/i, '')) + '</b></td>' +
      // ป้ายประเภทเป็นสีกลาง (ม่วง/เทา) — เดิมแอดมินเป็นป้ายเขียว แต่เขียวในเว็บนี้แปลว่า "ดี" อย่างเดียว (E3)
      '<td data-sort="' + (p.crm ? 'CRM' : 'แอดมิน') + '">' + (p.crm ? '<span class="badge neutral">CRM</span>' : '<span class="badge brand">แอดมิน</span>') + '</td>' +
      '<td class="num">' + fmtNum(p.items) + '</td>' +
      '<td class="num">' + colorNum_(THB(p.value), 'none') + '</td>' +
      '<td class="num" data-sort="' + (pct === null ? '' : pct) + '">' + pct1(pct) + '</td></tr>';
  }).join('');
  const sum = list.reduce((s, p) => { s.items += p.items; s.value += p.value; return s; }, { items: 0, value: 0 });
  return rows + '<tr class="tbl-total"><td></td><td>รวม ' + fmtNum(list.length) + ' คน</td><td></td>' +
    '<td class="num">' + fmtNum(sum.items) + '</td><td class="num">' + THB(sum.value) + '</td><td></td></tr>';
}

function personCardHtml_(d: ProfitData): string {
  const months = Object.keys(d.returnsByPerson || {}).sort();
  if (!months.length) return '';
  const month = retPersonMonth_(d);
  const rm = d.returnsByMonth[month];
  const fbValue = rm ? rm.value - (rm.crmValue || 0) : 0;
  const fbItems = rm ? rm.items - (rm.crmItems || 0) : 0;
  const opts = months.map((m) =>
    '<option value="' + esc(m) + '"' + (m === month ? ' selected' : '') + '>' + esc(monthTh(m)) + '</option>').join('');
  const typeOpts = [['all', 'ทุกคน'], ['admin', 'เฉพาะแอดมิน'], ['crm', 'เฉพาะ CRM']].map(([v, t]) =>
    '<option value="' + v + '"' + (v === retTypeSel ? ' selected' : '') + '>' + t + '</option>').join('');
  return '<div class="card">' +
    '<div class="card-head"><h3>ตีกลับรายคน (แอดมิน + CRM)' +
        infoTip('จากชีทตีกลับของทีม (คอลัมน์พนักงาน) • ชื่อที่ขึ้นต้นด้วย CRM = ทีม CRM • % = สัดส่วนของมูลค่าตีกลับทั้งเดือน', 'ตีกลับรายคน') + '</h3>' +
      '<div class="card-actions">' +
        '<select id="pf-ret-month" class="input" aria-label="เลือกเดือน">' + opts + '</select>' +
        '<select id="pf-ret-type" class="input" aria-label="เลือกกลุ่มพนักงาน">' + typeOpts + '</select>' +
        downloadMenuHtml('pf-ret-dl') +
      '</div></div>' +
    '<div class="card-sub" id="pf-ret-sub">' + esc(monthTh(month)) + ': ' +
      'แอดมิน <b>' + THB(fbValue) + '</b> (' + fmtNum(fbItems) + ' รายการ) • ' +
      'CRM <b>' + THB(rm ? rm.crmValue || 0 : 0) + '</b> (' + fmtNum(rm ? rm.crmItems || 0 : 0) + ' รายการ)</div>' +
    '<div class="table-scroll pf-ret-scroll"><table class="tbl pf-person"><thead><tr>' +
      '<th class="num">#</th>' + sortTh('พนักงาน', 'name') + sortTh('ประเภท', 'type') +
      sortTh('รายการ', 'items', { num: true }) + sortTh('มูลค่าตีกลับ', 'value', { num: true }) +
      sortTh('% ของตีกลับเดือน', 'pct', { num: true }) +
    '</tr></thead><tbody id="pf-ret-body">' + personRowsHtml_(d, month) + '</tbody></table></div>' +
    // มือถือโชว์ 10 คนแรก (ตามลำดับที่เรียงอยู่) + ปุ่มนี้ — syncRetCut_ ตัดสินใจตอนผูก event
    '<button type="button" class="btn pf-ret-more" id="pf-ret-more" hidden></button>' +
  '</div>';
}

/** มือถือ: ตีกลับรายคน 84 คน = การ์ดยาว ~17,000px ในกล่องเลื่อนครึ่งจอ ปัดเลื่อนหน้าแล้วโดนกล่องดูดนิ้ว
 *  → จอ <600 เลิกกล่องเลื่อน (CSS) และโชว์ 10 คนแรก + "ดูทั้งหมด (N คน)" (รีวิวมือถือ 27 ก.ย. 69) */
let retShowAll_ = false;
function syncRetCut_(root: ParentNode): void {
  const box = root.querySelector('.pf-ret-scroll');
  const btn = root.querySelector('#pf-ret-more') as HTMLButtonElement | null;
  if (!box || !btn) return;
  const n = box.querySelectorAll('#pf-ret-body > tr:not(.tbl-total)').length;
  const cut = !retShowAll_ && n > 10 && !window.matchMedia('(min-width: 600px)').matches;
  box.classList.toggle('pf-ret-cut', cut);
  btn.hidden = !cut;
  btn.textContent = 'ดูทั้งหมด (' + fmtNum(n) + ' คน)';
}

function openDaily(u: string, month: string): void {
  const head = '<div class="modal-head"><h3>' + esc(u) + ' — กำไรรายวัน ' + esc(monthTh(month)) + '</h3>' + modalCloseBtn() + '</div>';
  openModal(head + '<div class="loading"><div class="spinner"></div>กำลังโหลด...</div>');
  serverCall<any>('apiProfit', { u, month }).then(function (res) {
    const root = document.getElementById('modal-root');
    const modal = root && root.querySelector('.modal');
    if (!modal) return;
    const daily = (res && res.daily) || [];
    const body = daily.map(function (x: any) {
      const kind = profitKind(x.profit);
      return '<tr><td>' + esc(dateTh(String(x.date))) + '</td>' +
        '<td class="num">' + THB(x.sales) + '</td>' +
        '<td class="num">' + fmtNum(x.orders) + '</td>' +
        '<td class="num">' + THB(x.ads) + '</td>' +
        '<td class="num">' + colorNum_(THB(x.profit), kind) + '</td>' +
        '<td class="num">' + colorNum_(pct1(x.margin * 100), kind) + '</td></tr>';
    }).join('');
    const sum = daily.reduce(function (s: any, x: any) {
      s.sales += x.sales; s.ads += x.ads; s.profit += x.profit; return s;
    }, { sales: 0, ads: 0, profit: 0 });
    modal.innerHTML = head +
      '<div class="card-sub pf-daily-sub">รวมเดือน: ขาย ' + THB(sum.sales) + ' • แอด ' + THB(sum.ads) +
        ' • ' + colorNum_('กำไร ' + THB(sum.profit), profitKind(sum.profit)) +
        ' • วันขาดทุนเป็นตัวแดง ตรงกับการ์ดแจ้งเตือนหน้า ยอดขาย</div>' +
      (daily.length
        ? '<div class="table-scroll pf-daily-scroll"><table class="tbl"><thead><tr>' +
          '<th>วันที่</th><th class="num">ยอดขาย</th><th class="num">ออเดอร์</th>' +
          '<th class="num">ค่าแอด</th><th class="num">กำไรสุทธิ</th><th class="num">มาร์จิ้น</th>' +
          '</tr></thead><tbody>' + body + '</tbody></table></div>'
        : stateHtml('nodata', { title: 'เดือนนี้ยังไม่มีข้อมูลรายวัน', body: 'ชีทสรุปรายสินค้ายังไม่มีแถวรายวันของยูนิตนี้' }));
    // โมดัลนี้เขียนทับเนื้อหาตัวเอง ปุ่มปิดที่ openModal ผูกไว้จึงหายไปกับของเดิม ต้องผูกใหม่
    rebindModalClose();
  }).catch(function () {
    const root = document.getElementById('modal-root');
    const box = root && root.querySelector('.modal .loading');
    if (box) box.outerHTML = stateHtml('error', { body: 'โหลดกำไรรายวันไม่สำเร็จ ปิดหน้าต่างแล้วกดตัวเลขอีกครั้ง' });
    else toast('โหลดกำไรรายวันไม่สำเร็จ', 'error');
  });
}

/** แถวของไฟล์ดาวน์โหลดตาราง pivot (CSV/Excel ชุดเดียวกัน) — ตัวเลขดิบ ช่องที่ชีทไม่มีแถว = ว่าง (เหมือนเดิม) */
function pivotRows_(d: ProfitData): (string | number)[][] {
  const out: (string | number)[][] = [
    ['กำไรสุทธิรายยูนิต ปี ' + d.year + ' (จากชีทสรุปรายสินค้า)'],
    ['ยูนิต', 'สินค้า', ...d.months.map(mLabel), 'รวมปี', 'ยอดขายปี', 'ค่าแอดปี'],
  ];
  d.units.forEach(function (x) {
    out.push([x.u, x.product,
      ...d.months.map(function (m) { const c = x.months[m]; return c ? Math.round(c.profit) : ''; }),
      x.total.profit, x.total.sales, x.total.ads]);
  });
  return out;
}

function bindEvents(container: HTMLElement): void {
  container.querySelectorAll('[data-drill]').forEach(function (a) {
    a.addEventListener('click', function () {
      const parts = String(a.getAttribute('data-drill') || '').split('|');
      if (parts.length === 2) openDaily(parts[0], parts[1]);
    });
  });
  // ส่วนตีกลับรายคน — เปลี่ยนเดือน/ประเภทแล้ววาดใหม่ทั้งหน้า (ข้อมูลอยู่ใน lastData ครบแล้ว ไม่ยิง API ซ้ำ)
  syncRetCut_(container);
  const retMore = container.querySelector('#pf-ret-more');
  if (retMore) retMore.addEventListener('click', function () { retShowAll_ = true; syncRetCut_(container); });
  const retMonth = container.querySelector('#pf-ret-month') as HTMLSelectElement | null;
  if (retMonth) retMonth.addEventListener('change', function () {
    retMonthSel = retMonth.value;
    if (lastData) render(container, lastData);
  });
  const retType = container.querySelector('#pf-ret-type') as HTMLSelectElement | null;
  if (retType) retType.addEventListener('change', function () {
    retTypeSel = (retType.value as typeof retTypeSel) || 'all';
    if (lastData) render(container, lastData);
  });
  bindDownloadMenu(container, 'pf-ret-dl', {
    csv: function () {
      const d = lastData;
      if (!d || !d.returnsByPerson) { toast('ยังไม่มีข้อมูลให้ดาวน์โหลด', 'warn'); return; }
      const month = retPersonMonth_(d);
      const all = d.returnsByPerson[month] || [];
      const list = retTypeSel === 'all' ? all : all.filter(function (p) { return (retTypeSel === 'crm') === p.crm; });
      const out: (string | number)[][] = [
        ['ตีกลับรายคน ' + mLabel(month) + ' ' + d.year],
        ['พนักงาน', 'ประเภท', 'รายการ', 'มูลค่าตีกลับ'],
      ];
      list.forEach(function (p) { out.push([p.name, p.crm ? 'CRM' : 'แอดมิน', p.items, p.value]); });
      downloadCSV(out, 'returns-person-' + month);
    },
  });
  const guard = (fn: (d: ProfitData) => void) => function () {
    const d = lastData;
    if (!d || !d.units.length) { toast('ยังไม่มีข้อมูลให้ดาวน์โหลด', 'warn'); return; }
    fn(d);
  };
  bindDownloadMenu(container, 'pf-dl', {
    csv: guard(function (d) { downloadCSV(pivotRows_(d), 'profit-' + d.year); }),
    xls: guard(function (d) { downloadXLS(pivotRows_(d), 'profit-' + d.year, 'กำไรรายยูนิต'); }),
  });
  // เรียงได้ทุกรอบวาด (รวมรอบรีเฟรชเอง 5 นาที) — แถวรวมค้างล่างสุด · จำคอลัมน์ที่เลือกไว้
  makeSortable(container, 'table.pf-pivot', { id: 'profit-pivot' });
  makeSortable(container, 'table.pf-person', { id: 'profit-returns-person' });
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
      container.innerHTML = profitSkel();
      fetchData(container);
    });
  });
}

export const profit = {
  load: async (container: HTMLElement, force?: boolean): Promise<void> => {
    if (lastData && !force) {
      // แสดง cache ก่อนแล้วดึงใหม่เบื้องหลัง — เดิม return ตรงนี้เลย ลูปอัปเดต 5 นาทีจึงไม่มีผล
      render(container, lastData);
      fetchData(container);
      return;
    }
    container.innerHTML = profitSkel();
    fetchData(container);
  },
};
