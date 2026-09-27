// lib/views/report.ts — หน้า "รายงานการตลาด" (บรีฟ 2026-07-31)
// รายงานเป้าเทียบยอดจริง รายยูนิต (เดือน/วีค/ปี — เป้าจากชีท KPI แท็บ เป้ายอดขาย, ยอดจริงจากชีทสรุปรายสินค้า)
// + การตลาด: ลูกค้าซื้อซ้ำต่อรอบ รายยูนิต (จากออเดอร์จริง)
//
// UI รอบ 2 (26 ก.ย. 69): แถวเครื่องมือกลาง (C4) · "ยังไม่มีในชีท" ไม่ใช่ ฿0 (E1) · ตารางกดเรียง + แถวรวม (G2)
// · สีตามกติกากลาง color-rules (E3) · ป้ายแดงเฉพาะเดือนที่ยังแก้ได้ (B3) · คำอธิบายยาวย้ายเข้า ⓘ (D3)

import {
  serverCall, esc, fmtNum, THB, THBk, pct1, dash, dateTh, monthTh, showError, downloadCSV, downloadXLS, toast,
  infoTip, stateHtml, downloadMenuHtml, bindDownloadMenu,
} from '@/lib/ui/helpers';
import { icon, statusPill, statusDot, type StatusKind } from '@/lib/ui/icons';
import { attainKind, kindClass, legendHtml, LEGEND, type ColorKind } from '@/lib/ui/color-rules';
import { makeSortable, sortTh } from '@/lib/ui/table-sort';
import { reportSkel } from '@/lib/ui/skeletons';

interface UnitRow {
  u: string; product: string; target: number;
  // null = ชีทสรุปรายสินค้ายังไม่มีแถวของยูนิตนี้เดือนนี้ (noData) — ไม่ใช่ขายได้ 0
  actual: number | null;
  attain: number | null; gap: number | null; needPerDay: number | null;
  noData?: boolean;
  weekly: Array<{ week: string; sales: number }>;
}
interface YearRow {
  month: number; label: string; target: number; actual: number;
  attain: number | null; hitUnits: number; judgedUnits: number; closed: boolean;
  missingUnits?: number; missingTarget?: number;
}
interface ReportData {
  setupNeeded?: boolean;
  year: string; month: number; monthsAvail: number[]; isCurrent: boolean; daysLeft: number;
  asOf?: string;
  hasTargets: boolean; units: UnitRow[]; yearSummary: YearRow[];
}
interface MarketRow {
  u: string; customers: number; repeat: number; repeatPct: number | null;
  avgGapDays: number | null; avgOrders: number | null;
}

let lastData: ReportData | null = null;
let marketData: { sinceDate: string; units: MarketRow[] } | null = null;
let marketFailed = false;
let reqSeq = 0;
let mkReq = 0;
const state = { month: 0 };

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const ym_ = (year: string, m: number) => year + '-' + String(m).padStart(2, '0');
/** ปี พ.ศ. เต็ม — ป้ายปีหน้าแถวเลือกเดือน (เดือนย่อ "ก.ย. 69" ใช้ monthTh) */
const yearTh_ = (year: string | number) => String(Number(year) + 543);
/** ช่องที่ชีทยังไม่มีแถว — ตัวหนังสือสีเทา ไม่ใช่ ฿0 (E1) */
const NA_SHEET = '<span class="kpr-na">ยังไม่มีในชีท</span>';

/** เดือนนี้ผ่านมากี่ส่วน (0–1) ตามวันที่ไทย — ใช้ตัดสีเดือนที่ยังไม่จบ (เทียบเป้าตามวันที่ผ่านไป) */
function paceOf_(year: string, m: number, d: ReportData): number {
  const daysInMonth = new Date(Number(year), m, 0).getDate();
  if (d.isCurrent && m === d.month) return Math.max(1, daysInMonth - d.daysLeft + 1) / daysInMonth;
  const bkk = new Date(Date.now() + 7 * 3600000);
  return Math.min(1, bkk.getUTCDate() / daysInMonth);
}

/** ชนิดสีของแถวยูนิต: ไม่มีข้อมูล/ไม่ตั้งเป้า = none · เดือนนี้เทียบเป้าตามวันที่ผ่านไป · เดือนที่จบแล้วเทียบเป้าเต็ม */
function unitKind_(x: UnitRow, pace: number | null): ColorKind {
  if (x.noData || x.actual === null) return 'none';
  return attainKind(x.actual, x.target, pace !== null ? { pace } : undefined);
}

/**
 * ป้ายสถานะ = จุดสี + คำ — สีเดียวกับตัวเลข %บรรลุ (กติกากลาง color-rules)
 * งบสีแดง (B3): แดงเฉพาะ "เดือนนี้" ที่ยังแก้ทัน · เดือนที่ปิดแล้วไม่ถึงเป้า = ป้ายเทา (เป็นประวัติ แก้ไม่ได้แล้ว
 * สี %บรรลุ ข้างๆ บอกระดับอยู่แล้ว) · ยังไม่มีในชีท = เทา "รอข้อมูล" ไม่ใช่แดง (E1)
 */
function statusOf_(x: UnitRow, d: ReportData, kind: ColorKind): { kind: StatusKind; txt: string; rank: number | null } {
  if (x.noData || x.actual === null) return { kind: 'muted', txt: 'รอข้อมูล', rank: null };
  if (!x.target) return { kind: 'muted', txt: 'ไม่ตั้งเป้า', rank: null };
  if (x.attain !== null && x.attain >= 100) return { kind: 'good', txt: 'ถึงเป้าแล้ว', rank: 4 };
  if (!d.isCurrent) return { kind: 'muted', txt: 'ไม่ถึงเป้า', rank: 1 };
  if (kind === 'good') return { kind: 'good', txt: 'ตามแผน', rank: 3 };
  if (kind === 'warn') return { kind: 'warn', txt: 'ช้ากว่าแผน', rank: 2 };
  return { kind: 'bad', txt: 'ต่ำกว่าแผนมาก', rank: 1 };
}

function unitTableHtml_(d: ReportData): string {
  const title = 'เป้าเทียบยอดจริง รายยูนิต — ' + monthTh(ym_(d.year, d.month));
  if (!d.hasTargets) {
    return '<div class="card"><div class="card-head"><h3>' + esc(title) + '</h3></div>' +
      stateHtml('wait', {
        title: 'ยังไม่มีเป้าจากชีท KPI',
        body: 'ตั้งเป้าในแท็บ "เป้ายอดขาย" ของชีท KPI แล้วรอระบบดึงรอบถัดไป',
        adminDetail: 'sync_state kpi_scores ยังไม่มี targets — รอ sync หรือรัน npm run import:kpi',
      }) + '</div>';
  }
  // หัวคอลัมน์วีค = วีคที่มีจริงในเดือน (รวมทุกยูนิต)
  const weekSet = new Set<string>();
  d.units.forEach((x) => x.weekly.forEach((w) => weekSet.add(w.week)));
  const weeks = Array.from(weekSet).sort();
  // "วีค 1" + วันจันทร์ที่เริ่ม (บรรทัดเล็ก) — เดิม "W1 (31+)" ต้องเดาว่า 31 คือวันที่อะไร
  const wLabel = (w: string, i: number) => '<span class="rp-wk">วีค ' + (i + 1) + '<small>เริ่ม ' + esc(dateTh(w).replace(/ \d+$/, '')) + '</small></span>';

  const daysInMonth = new Date(Number(d.year), d.month, 0).getDate();
  const dayOfMonth = d.isCurrent ? Math.max(1, daysInMonth - d.daysLeft + 1) : daysInMonth;
  const pace = d.isCurrent ? dayOfMonth / daysInMonth : null;
  const pacePct = Math.round((dayOfMonth / daysInMonth) * 1000) / 10;   // ผ่านมากี่ % ของเดือน

  const count = { good: 0, warn: 0, bad: 0, wait: 0, missed: 0 };
  let tSum = 0, aSum = 0, withData = 0;
  const wkSum: Record<string, number> = {};
  const missing: UnitRow[] = [];

  const body = d.units.map((x) => {
    const wkMap: Record<string, number> = {};
    x.weekly.forEach((w) => { wkMap[w.week] = w.sales; });
    const kind = unitKind_(x, pace);
    const st = statusOf_(x, d, kind);
    const noData = !!x.noData || x.actual === null;
    if (noData) { missing.push(x); count.wait++; } else {
      // แถวรวมนับเฉพาะยูนิตที่มีข้อมูล — ยูนิตที่ยังไม่มีในชีทไม่ถูกนับเป็นยอด 0 (E1)
      withData++; tSum += x.target; aSum += x.actual || 0;
      x.weekly.forEach((w) => { wkSum[w.week] = (wkSum[w.week] || 0) + w.sales; });
      if (st.kind === 'good') count.good++;
      else if (st.kind === 'warn') count.warn++;
      else if (st.kind === 'bad') count.bad++;
      else if (st.txt === 'ไม่ถึงเป้า') count.missed++;
    }
    return '<tr>' +
      '<td data-sort="' + esc(x.u) + '"><b>' + esc(x.u) + '</b>' + (x.product ? ' <span class="rank-fullname">' + esc(x.product) + '</span>' : '') + '</td>' +
      '<td class="num" data-sort="' + (x.target || '') + '">' + (x.target ? THB(x.target) : dash()) + '</td>' +
      '<td class="num" data-sort="' + (noData ? '' : x.actual) + '">' + (noData ? NA_SHEET : THB(x.actual)) + '</td>' +
      '<td class="num" data-sort="' + (x.attain === null ? '' : x.attain) + '">' +
        (x.attain === null ? dash() : '<span class="' + (kindClass(kind) || 'v-plain') + '">' + pct1(x.attain) + '</span>') + '</td>' +
      '<td data-sort="' + (st.rank === null ? '' : st.rank) + '">' + statusPill(st.kind, esc(st.txt)) + '</td>' +
      '<td class="num" data-sort="' + (x.gap === null ? '' : x.gap) + '">' + (x.gap ? THB(x.gap) : dash()) + '</td>' +
      '<td class="num rp-need" data-sort="' + (x.needPerDay === null ? '' : x.needPerDay) + '">' +
        (x.needPerDay ? THB(x.needPerDay) : dash()) + '</td>' +
      weeks.map((w) => {
        const has = !noData && Object.prototype.hasOwnProperty.call(wkMap, w);
        return '<td class="num" data-sort="' + (has ? wkMap[w] : '') + '">' + (has ? THB(wkMap[w]) : dash()) + '</td>';
      }).join('') +
      '</tr>';
  }).join('');

  const tAttain = tSum > 0 ? Math.round((aSum / tSum) * 1000) / 10 : null;
  const tKind = attainKind(aSum, tSum, pace !== null ? { pace } : undefined);
  const totalRow = withData
    ? '<tr class="tbl-total"><td>รวม ' + fmtNum(withData) + ' ยูนิต</td>' +
      '<td class="num">' + THB(tSum) + '</td><td class="num">' + THB(aSum) + '</td>' +
      '<td class="num">' + (tAttain === null ? dash() : '<span class="' + (kindClass(tKind) || 'v-plain') + '">' + pct1(tAttain) + '</span>') + '</td>' +
      '<td></td><td></td><td></td>' +
      weeks.map((w) => '<td class="num">' + (wkSum[w] ? THB(wkSum[w]) : dash()) + '</td>').join('') +
      '</tr>'
    : '';

  // สรุปจำนวนรายระดับเป็นตัวหนังสือสีปกติ (B3) — ถ้าเกินครึ่งอยู่ระดับเดียวกัน หัวข้อไม่ควรแดงทั้งก้อน
  const tally = (d.isCurrent
    ? [
      count.good ? statusDot('good') + ' ถึงเป้า/ตามแผน ' + fmtNum(count.good) : '',
      count.warn ? statusDot('warn') + ' ช้ากว่าแผน ' + fmtNum(count.warn) : '',
      count.bad ? statusDot('bad') + ' ต่ำกว่าแผนมาก ' + fmtNum(count.bad) : '',
    ]
    : [
      statusDot('good') + ' ถึงเป้า ' + fmtNum(count.good) + ' จาก ' + fmtNum(withData) + ' ยูนิต',
    ]).concat(count.wait ? [statusDot('muted') + ' รอข้อมูล ' + fmtNum(count.wait)] : [])
    .filter(Boolean).map((t) => '<span class="rp-tally-i">' + t + '</span>').join('');

  const tip = 'เป้า = ชีท KPI แท็บ "เป้ายอดขาย" • ยอดจริง = ชีทสรุปรายสินค้า (แหล่งเดียวกับที่ทีมใช้วัด) • ' +
    'ยอดรายวีคนับจันทร์–อาทิตย์ • ' +
    (d.isCurrent
      ? 'สถานะเดือนนี้ = เทียบกับเป้าตามจำนวนวันที่ผ่านไป ไม่ใช่เทียบ 100% • ตามแผน = ได้ตั้งแต่ ' + pacePct + '% ของเป้าเต็มเดือน'
      : 'เดือนที่ปิดแล้ว สถานะคือถึงเป้า/ไม่ถึงเป้าจริง');
  const missTarget = missing.reduce((s, x) => s + (x.target || 0), 0);
  const note = missing.length
    ? '<div class="kpr-note">' + icon('info', { size: 14 }) + '<span>' + fmtNum(missing.length) + ' ยูนิตยังไม่มีในชีทสรุปรายสินค้า (' +
      missing.map((x) => esc(x.u)).join(', ') + ') — ยังไม่รู้ยอดจริง จึงไม่นับในแถวรวมและสรุปรายเดือน' +
      (missTarget ? ' • เป้ารวมของกลุ่มนี้ ' + THB(missTarget) : '') + '</span></div>'
    : '';

  return '<div class="card">' +
    '<div class="card-head"><h3>' + esc(title) + infoTip(tip, 'ตารางนี้คิดยังไง') + '</h3></div>' +
    '<div class="card-sub rp-sub">' +
      (d.isCurrent ? '<span>เดือนนี้ผ่านมา ' + pacePct + '% (เหลือ ' + fmtNum(d.daysLeft) + ' วัน)</span>' : '<span>เดือนที่ปิดแล้ว</span>') +
      tally + '</div>' +
    legendHtml(d.isCurrent ? LEGEND.attainPace : LEGEND.attain) +
    '<div class="table-scroll"><table class="tbl rp-tgt"><thead><tr>' +
      sortTh('ยูนิต', 'u') + sortTh('เป้า/เดือน', 'target', { num: true }) + sortTh('ยอดจริง', 'actual', { num: true }) +
      sortTh('%บรรลุ', 'attain', { num: true }) +
      // สถานะเรียงจากหนักไปเบาเมื่อกดครั้งแรก (B3) — รอข้อมูล/ไม่ตั้งเป้าอยู่ท้ายเสมอ
      sortTh('สถานะ', 'st', { dir: 'asc' }) +
      sortTh('ขาดอีก', 'gap', { num: true }) +
      sortTh('<span class="rp-wk">ต้องขายเพิ่ม<small>ต่อวัน</small></span>', 'need', { num: true }) +
      weeks.map((w, i) => sortTh(wLabel(w, i), 'w' + i, { num: true })).join('') +
    '</tr></thead><tbody>' + body + totalRow + '</tbody></table></div>' +
    note + '</div>';
}

function yearTableHtml_(d: ReportData): string {
  let cT = 0, cA = 0, cN = 0;
  const body = d.yearSummary.map((y) => {
    const pace = y.closed ? null : paceOf_(d.year, y.month, d);
    const kind = attainKind(y.actual, y.target, pace !== null ? { pace } : undefined);
    if (y.closed) { cT += y.target; cA += y.actual; cN++; }
    const miss = y.missingUnits || 0;
    // สรุป: เดือนที่จบแล้วไม่ถึงเป้า = ป้ายเทา (ประวัติ) — สี %บรรลุ ข้างๆ บอกระดับอยู่แล้ว (B3 งบสีแดง)
    const verdict = !y.closed ? statusPill('muted', 'ยังไม่จบเดือน')
      : y.attain !== null && y.attain >= 100 ? statusPill('good', 'สำเร็จ')
      : statusPill('muted', 'ไม่ถึงเป้า');
    return '<tr>' +
      '<td>' + esc(y.label) + '</td>' +
      '<td class="num">' + THB(y.target) + '</td>' +
      '<td class="num">' + THB(y.actual) + '</td>' +
      '<td class="num">' + (y.attain === null ? dash() : '<span class="' + (kindClass(kind) || 'v-plain') + '">' + pct1(y.attain) + '</span>') + '</td>' +
      '<td class="num">' + fmtNum(y.hitUnits) + '/' + fmtNum(y.judgedUnits) + '</td>' +
      // ยูนิตที่ตั้งเป้าแต่ชีทยังไม่มีแถวเดือนนั้น — ไม่นับในเป้ารวม/%บรรลุ (E1) บอกไว้ตรงนี้ให้เห็นว่าตัดอะไรออก
      '<td class="num">' + (miss
        ? '<span class="kpr-na" title="' + esc('เป้ารวมของกลุ่มนี้ ' + THB(y.missingTarget || 0)) + '">' + fmtNum(miss) + ' ยูนิต · เป้า ' + esc(THBk(y.missingTarget || 0)) + '</span>'
        : dash()) + '</td>' +
      '<td>' + verdict + '</td>' +
      '</tr>';
  }).join('');
  const closed = d.yearSummary.filter((y) => y.closed && y.attain !== null);
  const okMonths = closed.filter((y) => (y.attain || 0) >= 100).length;
  const cAttain = cT > 0 ? Math.round((cA / cT) * 1000) / 10 : null;
  const first = d.yearSummary.find((y) => y.closed);
  const lastClosed = d.yearSummary.filter((y) => y.closed).pop();
  // แถวรวมเฉพาะเดือนที่จบแล้ว — เดือนที่ยังวิ่งอยู่มีเป้าเต็มเดือนแต่ยอดยังไม่ครบ ถ้ารวมด้วย %บรรลุจะต่ำเกินจริง
  const totalRow = cN
    ? '<tr class="tbl-total"><td>รวม ' + esc(first && lastClosed && first !== lastClosed ? first.label + '–' + lastClosed.label : (first ? first.label : '')) + '</td>' +
      '<td class="num">' + THB(cT) + '</td><td class="num">' + THB(cA) + '</td>' +
      '<td class="num">' + (cAttain === null ? dash() : '<span class="' + (kindClass(attainKind(cA, cT)) || 'v-plain') + '">' + pct1(cAttain) + '</span>') + '</td>' +
      '<td></td><td></td><td></td></tr>'
    : '';
  return '<div class="card">' +
    '<div class="card-head"><h3>ความสำเร็จรายเดือน ปี ' + esc(yearTh_(d.year)) +
      infoTip('เป้ารวม = ผลรวมเป้าของยูนิตที่มีข้อมูลในชีทสรุปรายสินค้าเดือนนั้น • ' +
        'ยูนิตที่ตั้งเป้าแต่ชีทยังไม่มีแถว ไม่นับในเป้ารวมและ %บรรลุ (ยังไม่รู้ยอดจริง ไม่ใช่ขายได้ 0) ดูจำนวนที่คอลัมน์ ยังไม่มีในชีท • ' +
        '"ยูนิตถึงเป้า" นับเฉพาะยูนิตที่ตั้งเป้าไว้และมีข้อมูล • แถวรวม = เฉพาะเดือนที่จบแล้ว', 'ความสำเร็จรายเดือน') + '</h3></div>' +
    '<div class="card-sub">ถึงเป้า ' + fmtNum(okMonths) + ' จาก ' + fmtNum(closed.length) + ' เดือนที่จบแล้ว</div>' +
    legendHtml(LEGEND.attain + ' • เดือนที่ยังไม่จบเทียบกับเป้าตามจำนวนวันที่ผ่านไป') +
    '<div class="table-scroll"><table class="tbl rp-year"><thead><tr>' +
      '<th>เดือน</th><th class="num">เป้ารวม</th><th class="num">ยอดจริง</th><th class="num">%บรรลุ</th>' +
      '<th class="num">ยูนิตถึงเป้า</th><th class="num">ยังไม่มีในชีท</th><th>สรุป</th>' +
    '</tr></thead><tbody>' + body + totalRow + '</tbody></table></div></div>';
}

function marketHtml_(): string {
  let inner: string;
  if (!marketData && marketFailed) {
    inner = stateHtml('error', {
      body: 'วิเคราะห์ซื้อซ้ำไม่สำเร็จ ลองใหม่อีกครั้ง',
      actionsHtml: '<button type="button" class="btn" id="rp-mk-retry">' + icon('refresh-cw', { size: 16 }) + 'ลองใหม่</button>',
    });
  } else if (!marketData) {
    // ส่วนนี้โหลดแยก (สแกนออเดอร์ทั้งหมด) — วงหมุนของตัวเองพร้อมบอกเวลารอ ไม่ใช้โครงร่างของหน้า
    inner = '<div class="loading"><div class="spinner"></div>กำลังวิเคราะห์ออเดอร์ทั้งหมด (ตั้งแต่ 23 พ.ค.) — ใช้เวลาราว 15-30 วินาที...</div>';
  } else if (!marketData.units.length) {
    inner = stateHtml('notready', {
      title: 'ยังจัดกลุ่มออเดอร์ตามยูนิตไม่ได้',
      body: 'ต้องจับคู่เพจกับยูนิตในหน้า "จับคู่ยูนิต" ก่อน',
    });
  } else {
    const body = marketData.units.map((x) => {
      const good = (x.repeatPct || 0) >= 10;
      return '<tr>' +
        '<td data-sort="' + esc(x.u) + '"><b>' + esc(x.u) + '</b></td>' +
        '<td class="num">' + fmtNum(x.customers) + '</td>' +
        '<td class="num">' + fmtNum(x.repeat) + '</td>' +
        '<td class="num" data-sort="' + (x.repeatPct === null ? '' : x.repeatPct) + '"><span class="' + (good ? 'v-good' : 'v-plain') + '">' + pct1(x.repeatPct) + '</span></td>' +
        '<td class="num" data-sort="' + (x.avgGapDays === null ? '' : x.avgGapDays) + '">' + (x.avgGapDays === null ? dash() : fmtNum(x.avgGapDays) + ' วัน') + '</td>' +
        '<td class="num" data-sort="' + (x.avgOrders === null ? '' : x.avgOrders) + '">' + (x.avgOrders === null ? dash() : x.avgOrders.toFixed(2)) + '</td>' +
        '</tr>';
    }).join('');
    inner = legendHtml('สี: เขียว = ลูกค้าซื้อซ้ำตั้งแต่ 10% ขึ้นไป') +
      '<div class="table-scroll"><table class="tbl rp-mk"><thead><tr>' +
      sortTh('ยูนิต', 'u') + sortTh('ลูกค้าทั้งหมด', 'cust', { num: true }) + sortTh('ซื้อซ้ำ', 'rep', { num: true }) +
      sortTh('%ซื้อซ้ำ', 'pct', { num: true }) + sortTh('รอบซื้อซ้ำเฉลี่ย', 'gap', { num: true }) +
      sortTh('ออเดอร์/ลูกค้า', 'ord', { num: true }) +
      '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }
  return '<div class="card" id="rp-market">' +
    '<div class="card-head"><h3>การตลาด: ลูกค้าซื้อซ้ำรายยูนิต' +
      infoTip('จากออเดอร์จริงทั้งหมดที่ระบบมี • รอบซื้อซ้ำ = ระยะห่างเฉลี่ยระหว่างออเดอร์ของลูกค้าคนเดิม • ' +
        'ข้อมูลเริ่ม 23 พ.ค. 69 ช่วงยังสั้น %ซื้อซ้ำจริงจะสูงกว่านี้เมื่อเก็บนานขึ้น', 'ซื้อซ้ำ') + '</h3></div>' +
    '<div class="card-sub">' + (marketData ? 'ตั้งแต่ ' + esc(dateTh(marketData.sinceDate)) + ' ถึงวันนี้' : 'ออเดอร์จริงตั้งแต่ 23 พ.ค. 69') + '</div>' +
    inner + '</div>';
}

function toolbarHtml_(d: ReportData): string {
  const monthBtns = d.monthsAvail.map((m) =>
    '<button type="button" class="filter-btn' + (m === d.month ? ' active' : '') + '" data-rpmonth="' + m + '">' +
    esc(TH_MONTHS[m - 1]) + '</button>').join('');
  return '<div class="toolbar">' +
      '<div class="tb-range" role="group" aria-label="เลือกเดือน"><span class="kpr-year">ปี ' + esc(yearTh_(d.year)) + '</span>' + monthBtns + '</div>' +
      (d.hasTargets && d.units.length ? '<div class="tb-actions">' + downloadMenuHtml('rp-dl', { excel: true }) + '</div>' : '') +
    '</div>' +
    '<div class="data-asof">' + icon('calendar', { size: 14 }) +
      '<span>ยอดจริงจากชีทสรุปรายสินค้า' + (d.asOf ? ' ข้อมูลถึง ' + esc(dateTh(d.asOf)) : '') + ' • เป้าจากชีท KPI</span></div>';
}

function render(container: HTMLElement, d: ReportData | null): void {
  if (!d) return;
  if (d.setupNeeded) {
    container.innerHTML = stateHtml('wait', {
      body: 'ยังไม่มีข้อมูลจากชีทสรุปรายสินค้า — ระบบดึงเป็นรอบๆ ลองกลับมาดูอีกครั้งในอีกสักครู่',
      adminDetail: 'unit_daily ว่าง — รอ sync ชีทสรุปรายสินค้า (npm run import:product-sheets)',
    });
    return;
  }
  container.innerHTML =
    toolbarHtml_(d) +
    '<div class="stack">' +
      unitTableHtml_(d) +
      yearTableHtml_(d) +
      marketHtml_() +
    '</div>';
  bindEvents(container);
  if (!marketData && !marketFailed) fetchMarket(container); // โหลดครั้งแรกครั้งเดียว — แคชไว้ทั้ง session
}

function bindMarket_(container: HTMLElement): void {
  makeSortable(container, 'table.rp-mk', { id: 'report-market' });
  const retry = container.querySelector('#rp-mk-retry');
  if (retry) retry.addEventListener('click', function () {
    marketFailed = false;
    const box = container.querySelector('#rp-market');
    if (box) box.outerHTML = marketHtml_();
    fetchMarket(container);
  });
}

function fetchMarket(container: HTMLElement): void {
  const seq = ++mkReq;
  serverCall<any>('apiReport', { section: 'marketing' }).then(function (res) {
    if (seq !== mkReq) return;
    marketData = res;
    const box = container.querySelector('#rp-market');
    if (box) { box.outerHTML = marketHtml_(); bindMarket_(container); }
  }).catch(function () {
    if (seq !== mkReq) return;
    marketFailed = true;
    const box = container.querySelector('#rp-market');
    if (box) { box.outerHTML = marketHtml_(); bindMarket_(container); }
  });
}

/** แถวของไฟล์ดาวน์โหลด (CSV/Excel ใช้ชุดเดียวกัน) — ตัวเลขดิบ ไม่ผ่านตัวจัดรูปแบบ */
function exportRows_(d: ReportData): (string | number)[][] {
  const out: (string | number)[][] = [
    ['รายงานเป้า vs จริง ' + TH_MONTHS[d.month - 1] + ' ' + d.year],
    ['ยูนิต', 'สินค้า', 'เป้า/เดือน', 'ยอดจริง', '%บรรลุ', 'ขาดอีก', 'ต้องขายเพิ่ม/วัน'],
  ];
  d.units.forEach(function (x) {
    // ยูนิตที่ชีทยังไม่มีแถว: ยอดจริงเขียนเป็นคำ ไม่ใช่ 0 (คนเปิดไฟล์จะได้ไม่นึกว่าขายไม่ได้เลย)
    out.push([x.u, x.product, x.target, x.actual === null ? 'ยังไม่มีในชีท' : x.actual, x.attain === null ? '-' : x.attain,
      x.gap === null ? '-' : x.gap, x.needPerDay === null ? '-' : x.needPerDay]);
  });
  return out;
}

function bindEvents(container: HTMLElement): void {
  container.querySelectorAll('[data-rpmonth]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.month = Number(btn.getAttribute('data-rpmonth'));
      container.innerHTML = reportSkel();
      fetchData(container);
    });
  });
  const fname = () => { const d = lastData; return d ? 'report-' + d.year + '-' + String(d.month).padStart(2, '0') : 'report'; };
  const guard = (fn: (d: ReportData) => void) => function () {
    const d = lastData;
    if (!d || !d.units.length) { toast('ยังไม่มีข้อมูลให้ดาวน์โหลด', 'warn'); return; }
    fn(d);
  };
  bindDownloadMenu(container, 'rp-dl', {
    csv: guard(function (d) { downloadCSV(exportRows_(d), fname()); }),
    xls: guard(function (d) { downloadXLS(exportRows_(d), fname(), 'เป้า vs จริง'); }),
  });
  // เรียงได้ทุกรอบวาด (รวมรอบรีเฟรชเอง 5 นาที) — จำคอลัมน์ที่เลือกไว้ ไม่เด้งกลับ
  makeSortable(container, 'table.rp-tgt', { id: 'report-target' });
  bindMarket_(container);
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
      container.innerHTML = reportSkel();
      fetchData(container);
    });
  });
}

export const report = {
  load: async (container: HTMLElement, force?: boolean): Promise<void> => {
    // กดรีเฟรชเอง = ให้โอกาสส่วนซื้อซ้ำที่เคยโหลดพลาดลองใหม่ด้วย
    if (force) marketFailed = false;
    if (lastData && !force) {
      // แสดง cache ก่อนแล้วดึงใหม่เบื้องหลัง — เดิม return ตรงนี้เลย ลูปอัปเดต 5 นาทีจึงไม่มีผล
      render(container, lastData);
      fetchData(container);
      return;
    }
    container.innerHTML = reportSkel();
    fetchData(container);
  },
};
