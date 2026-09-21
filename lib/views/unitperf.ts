// lib/views/unitperf.ts — หน้า "🎯 ผลงานราย Unit" (พีสั่ง 21 ก.ย. 2569)
// ยอดเดือนนี้ vs เป้า + คาดการณ์สิ้นเดือน + สัญญาณเตือนที่ระบบตรวจเจอ เรียงตามความเสี่ยง
// ตัวเลขทุกตัวมาจาก apiUnitPerf (lib/api/unitperf.ts) — กติกาเดียวกับหน้า Sales ทุกช่อง
//
// หน้าตา = "ตารางจัดอันดับ" ทีมเลือกเองจาก 3 แบบที่เสนอ (21 ก.ย. 69) เหตุผลที่ให้มาคือ "ดูง่าย"
// ทุกยูนิตอยู่ในตารางเดียว เรียงได้ทุกคอลัมน์ กดปุ่มท้ายแถวเพื่อกางสัญญาณเต็ม + ตัวเลขรอง
// (ของเดิมเป็นการ์ดใบละยูนิต — เลิกใช้เพราะทีมอ่านเทียบยูนิตต่อยูนิตยาก)

import { serverCall, esc, THB, fmtNum, showError } from '@/lib/ui/helpers';

declare global {
  // app-core แนบ App ไว้บน global — view อ้างถึงตรงๆ (ห้าม import กัน cycle)
  // eslint-disable-next-line no-var
  var App: { switchView: (view: string) => void };
}

interface Signal { text: string; level: 'urgent' | 'watch' }
interface UnitRow {
  u: string; key: string; mapped: boolean; product: string;
  pages: number; admins: number; note: string;
  revenue: number; orders: number; spend: number; base: number; profit: number | null;
  target: number | null; attain: number | null;
  projected: number | null; projAttain: number | null; gap: number | null;
  closeRate: number | null; roas: number | null; costPerMsg: number | null; perBill: number | null;
  breakEven: number; breakEvenSet: boolean; lossStreak: number; closeStreak: number;
  signals: Signal[]; level: 'urgent' | 'watch' | 'ok';
}
interface PerfData {
  month: string; monthStart: string; monthEnd: string; lastYmd: string;
  daysElapsed: number; daysDone: number; daysInMonth: number; isCurrentMonth: boolean; closeTarget: number;
  needSalesRpc: boolean; needAdsRpc: boolean; salesFailed: boolean; adsFailed: boolean;
  beforeData: boolean; dataStart: string; lossUsable: boolean; lastDoneYmd: string; lossThroughDate: string;
  goalSheetId: string; goalYearMismatch: boolean;
  units: UnitRow[];
  totals: { revenue: number; target: number; spend: number; projected: number; profit: number; urgent: number; watch: number };
}

let lastData: PerfData | null = null;
let reqSeq = 0;
// ตัวกรอง/การเรียงจำข้ามการ re-render (หน้านี้รีเฟรชเองหลังโหลด ตัวกรองต้องไม่รีเซ็ต)
const state = {
  month: '', q: '',
  level: 'all' as 'all' | 'urgent' | 'watch' | 'ok',
  sortKey: '',                       // '' = ลำดับความเสี่ยงที่ API เรียงมาให้
  sortDir: 'desc' as 'asc' | 'desc',
  open: '',                          // key ของแถวที่กางอยู่ ('' = ไม่มีแถวไหนกาง)
  // ⚠️ ต้องใช้ key ไม่ใช่ u — กองที่ยังไม่จัดกลุ่มมี u = '' ซึ่งชนกับค่าว่างนี้พอดี แถวนั้นจะกางค้างทันทีที่เปิดหน้า
};

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const monthLabel = (m: string) => (TH_MONTHS[Number(m.slice(5, 7)) - 1] || m) + ' ' + ((Number(m.slice(0, 4)) + 543) % 100);
const LEVEL_LABEL: Record<string, string> = { urgent: 'ต้องแก้ทันที', watch: 'เฝ้าระวัง', ok: 'ปกติ' };

/** เงินแบบย่อให้ตารางอ่านรวดเดียว (฿2.6M / ฿91.3K) — ตัวเต็มอยู่ใน tooltip เสมอ
 *  ติดลบขึ้นเครื่องหมายหน้าสกุลเงิน (-฿34.8K) ไม่ใช่ ฿-34.8K ที่อ่านสะดุด */
function thbShort(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(Number(n))) return '—';
  const v = Number(n);
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 1e6) return sign + '฿' + (a / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (a >= 1e4) return sign + '฿' + (a / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return sign + '฿' + fmtNum(Math.round(a));
}
/** เงินเต็มจำนวนสำหรับ tooltip — ติดลบเป็น -฿34,810 ให้ตรงกับตัวเลขในตาราง */
function THBs(n: number): string {
  return n < 0 ? '-' + THB(Math.abs(n)) : THB(n);
}

/** เกณฑ์สีเดียวกับทั้งเว็บ: ถึงเป้า = เขียว, 80-99 = ส้ม, ต่ำกว่า = แดง */
function pctClass(pct: number | null): string {
  if (pct === null || pct === undefined) return '';
  return pct >= 100 ? 'good' : pct >= 80 ? 'warn' : 'bad';
}
const clampPct = (v: number) => Math.max(0, Math.min(100, v));
/** ตัวเลขที่ใช้ตัดสินสี = คาดการณ์ในเดือนที่ยังไม่จบ / ยอดจริงในเดือนที่จบแล้ว */
const headPct = (u: UnitRow, d: PerfData) => (d.isCurrentMonth && u.projected !== null ? u.projAttain : u.attain);

/**
 * แถบความคืบหน้า: เต็มแถบ = เป้าเดือน
 *   ทึบ = ยอดจริงถึงตอนนี้ · จาง = ส่วนที่คาดว่าจะได้เพิ่มจนสิ้นเดือน
 *   ขีด = ผ่านไปแล้วกี่ % ของเดือน (ถ้าขายสม่ำเสมอ ยอดควรถึงขีดนี้)
 * เดือนที่จบแล้วไม่มีทั้งส่วนจางและขีด
 */
function barHtml(u: UnitRow, d: PerfData, cls: string): string {
  if (!u.target) return '';
  const now = clampPct(u.attain === null ? 0 : u.attain);
  const projRaw = d.isCurrentMonth && u.projAttain !== null ? clampPct(u.projAttain) : now;
  const projW = Math.max(0, projRaw - now);
  const pace = d.isCurrentMonth ? clampPct((d.daysElapsed / d.daysInMonth) * 100) : null;
  return '<div class="up-bar">' +
    '<i class="fill ' + cls + '" style="width:' + now.toFixed(2) + '%"></i>' +
    (projW > 0 ? '<i class="proj ' + cls + '" style="left:' + now.toFixed(2) + '%;width:' + projW.toFixed(2) + '%"></i>' : '') +
    (pace !== null ? '<i class="pace" style="left:calc(' + pace.toFixed(2) + '% - 1px)"></i>' : '') +
  '</div>';
}

/* ---------------- คอลัมน์ของตาราง ----------------
   คอลัมน์ที่มี val = เรียงได้ · ค่าที่ไม่มี (—) ถูกดันไปท้ายเสมอ ไม่ว่าจะเรียงขึ้นหรือลง */
interface Col {
  key: string; label: string; r?: boolean; tip?: string;
  val?: (u: UnitRow, d: PerfData) => number | string | null;
  dir?: 'asc' | 'desc';            // ทิศที่ "มีประโยชน์" ตอนกดครั้งแรก
}
const COLS: Col[] = [
  { key: 'u', label: 'ยูนิต', val: (u) => u.u || 'zzz', dir: 'asc', tip: 'รหัสยูนิต + สินค้าหลัก • จุดสี = ระดับความเสี่ยง' },
  { key: 'revenue', label: 'ยอดขาย', r: true, val: (u) => u.revenue, dir: 'desc', tip: 'ยอดขายสะสมเดือนนี้ (กติกาเดียวกับหน้า Sales)' },
  { key: 'attain', label: 'เทียบเป้าเดือน', val: (u) => u.attain, dir: 'asc', tip: 'แถบ: ทึบ = ยอดจริง • จาง = ส่วนที่คาดว่าจะได้เพิ่ม • ขีด = ผ่านไปกี่ % ของเดือน' },
  { key: 'proj', label: 'คาดสิ้นเดือน', r: true, val: (u, d) => headPct(u, d), dir: 'asc', tip: 'ยอดเฉลี่ยของวันที่จบแล้ว × จำนวนวันทั้งเดือน (ไม่รวมวันนี้ที่ยังไม่จบ)' },
  { key: 'close', label: '%ปิด', r: true, val: (u) => u.closeRate, dir: 'asc', tip: 'ออเดอร์ ÷ รวมคนทัก (อินบ็อกซ์ใหม่ + คอมเมนต์ ของเพจ Facebook)' },
  { key: 'roas', label: 'ROAS', r: true, val: (u) => u.roas, dir: 'asc', tip: 'ยอดขาย ÷ ค่าแอด • สีขึ้นเฉพาะยูนิตที่ตั้งจุดคุ้มทุนไว้แล้ว' },
  { key: 'spend', label: 'ค่าแอด', r: true, val: (u) => u.spend, dir: 'desc', tip: 'ค่าแอดจริงจาก Meta ทั้งเดือน' },
  { key: 'profit', label: 'กำไร', r: true, val: (u) => u.profit, dir: 'asc', tip: 'กำไรสุทธิสะสมเดือนนี้ จากชีทสรุปรายสินค้า' },
  { key: 'sig', label: 'สัญญาณ', val: (u) => u.signals.length, dir: 'desc', tip: 'จำนวนเรื่องที่ระบบตรวจพบ — กด "ดู" เพื่ออ่านเต็ม' },
  { key: 'act', label: '', r: true },
];

function headHtml(): string {
  return COLS.map((c) => {
    const sorted = state.sortKey === c.key;
    const arrow = !c.val ? '' : sorted ? (state.sortDir === 'asc' ? '↑' : '↓') : '↕';
    const inner = c.val
      ? '<button type="button" class="up-sort" data-sort="' + c.key + '"' +
        ' aria-sort="' + (sorted ? state.sortDir : 'none') + '">' +
        esc(c.label) + '<i>' + arrow + '</i></button>'
      : esc(c.label);
    return '<th class="' + (c.r ? 'r' : '') + '"' + (c.tip ? ' title="' + esc(c.tip) + '"' : '') + '>' + inner + '</th>';
  }).join('');
}

function rowHtml(u: UnitRow, rank: number, d: PerfData): string {
  const p = headPct(u, d);
  const cls = pctClass(p);
  const name = u.mapped ? (u.u || '') : '⚠️ ยังไม่จัดกลุ่ม';
  const projSub = !u.target ? 'ไม่มีเป้าในชีท'
    : !d.isCurrentMonth ? 'ยอดจริงทั้งเดือน'
      : u.projected === null ? 'ยังคาดไม่ได้' : thbShort(u.projected);
  const roasCls = u.roas === null || !u.breakEvenSet ? '' : (u.roas >= u.breakEven ? 'good' : 'bad');

  const rowId = u.key || u.u || 'none';
  return '<tr data-u="' + esc(u.u) + '"' + (state.open === rowId ? ' class="up-open"' : '') + '>' +
    '<td title="' + esc((u.product || 'ยังไม่จัดกลุ่ม') + ' • ' + LEVEL_LABEL[u.level] +
      (u.mapped ? ' • ' + fmtNum(u.pages) + ' เพจ • ' + fmtNum(u.admins) + ' แอดมิน' : '') +
      (u.note ? ' • 📌 ' + u.note : '')) + '">' +
      '<div class="up-unit">' +
        '<span class="up-rank">' + rank + '</span>' +
        '<span class="up-dot ' + u.level + '"></span>' +
        '<span class="up-code">' + esc(name) + '</span>' +
        '<span class="up-prod">' + esc(u.product || '') + '</span>' +
      '</div></td>' +

    '<td class="r num" title="' + esc('ยอดจริง ' + THB(u.revenue) + ' • ออเดอร์ ' + fmtNum(u.orders) +
      (u.perBill ? ' • เปอร์บิล ' + THB(u.perBill) : '')) + '">' +
      '<div class="up-big">' + thbShort(u.revenue) + '</div>' +
      '<div class="up-sub">' + fmtNum(u.orders) + ' ออเดอร์</div></td>' +

    '<td class="up-goal" title="' + esc(u.target
      ? 'เป้าเดือน ' + THB(u.target) + ' • ทำได้ ' + (u.attain === null ? 0 : u.attain) + '%' +
        (u.gap ? ' • ขาดอีก ' + THB(u.gap) : ' • ถึงเป้าแล้ว') +
        (d.isCurrentMonth ? ' • ผ่านไปแล้ว ' + d.daysElapsed + ' จาก ' + d.daysInMonth + ' วัน' : '')
      : 'ยังไม่มีเป้าเดือนนี้ในชีท KPI') + '">' +
      (u.target
        ? '<div class="up-goal-top"><span class="num">' + thbShort(u.target) + '</span>' +
            '<span class="num ' + pctClass(u.attain) + '">' + (u.attain === null ? '—' : u.attain + '%') + '</span></div>' +
          barHtml(u, d, cls) +
          '<div class="up-sub">' + (u.gap ? 'ขาดอีก ' + thbShort(u.gap) : 'ถึงเป้าแล้ว') + '</div>'
        : '<span class="up-sub">ยังไม่มีเป้าในชีท KPI</span>') +
    '</td>' +

    '<td class="r num ' + cls + '" title="' + esc(d.isCurrentMonth && u.projected !== null
      ? 'คาดการณ์สิ้นเดือน ' + THB(u.projected) +
        (u.projAttain === null ? ' (ยังไม่มีเป้าในชีท KPI)' : ' = ' + u.projAttain + '% ของเป้า') +
        ' (ยอดเฉลี่ยของ ' + d.daysDone + ' วันที่จบแล้ว × ' + d.daysInMonth + ' วัน)'
      : d.isCurrentMonth ? 'วันแรกของเดือน ยังไม่มีวันที่จบแล้วให้คาดการณ์'
        : 'ยอดจริงทั้งเดือนเทียบเป้า') + '">' +
      '<div class="up-big">' + (p === null ? '—' : Math.round(p) + '%') + '</div>' +
      '<div class="up-sub">' + esc(projSub) + '</div></td>' +

    '<td class="r num ' + (u.closeRate === null ? '' : (u.closeRate >= d.closeTarget ? 'good' : 'bad')) +
      '" title="' + esc('ออเดอร์ ' + fmtNum(u.orders) + ' ÷ รวมคนทัก ' + fmtNum(u.base) +
        ' • เป้า ' + d.closeTarget + '% ขึ้นไป') + '">' +
      (u.closeRate === null ? '—' : u.closeRate.toFixed(2) + '%') + '</td>' +

    '<td class="r num ' + roasCls + '" title="' + esc('ยอดขาย ÷ ค่าแอด ' + THB(u.spend) +
      (u.breakEvenSet ? ' • จุดคุ้มทุนของยูนิตนี้ ' + u.breakEven + 'x'
        : ' • ยังไม่ได้ตั้งจุดคุ้มทุน (ใช้ค่าเริ่มต้น 1x จึงไม่ทาสี)')) + '">' +
      (u.roas === null ? '—' : u.roas.toFixed(2) + 'x') + '</td>' +

    '<td class="r num" title="' + esc('ค่าแอดจริงจาก Meta ทั้งเดือน ' + THB(u.spend) +
      (u.costPerMsg === null ? '' : ' • ค่าทัก ฿' + u.costPerMsg.toFixed(2) + ' ต่อคน')) + '">' +
      thbShort(u.spend) + '</td>' +

    '<td class="r num ' + (u.profit === null ? '' : (u.profit >= 0 ? 'good' : 'bad')) + '" title="' +
      esc(u.profit === null ? 'ยังไม่มีข้อมูลกำไรของยูนิตนี้ในชีทสรุปรายสินค้า'
        : 'กำไรสุทธิสะสมเดือนนี้จากชีท ' + THBs(u.profit)) + '">' +
      (u.profit === null ? '—' : thbShort(u.profit)) + '</td>' +

    '<td>' + (u.signals.length
      ? '<span class="up-sig ' + u.signals[0].level + '">' + u.signals.length + ' เรื่อง</span>'
      : '<span class="up-sig ok">ไม่มี</span>') + '</td>' +

    '<td class="r"><button type="button" class="up-more" data-more="' + esc(rowId) + '"' +
      ' aria-expanded="' + (state.open === rowId ? 'true' : 'false') + '">' +
      (state.open === rowId ? 'ปิด' : 'ดู') + '</button></td>' +
  '</tr>' +
  (state.open === rowId ? detailHtml(u) : '');
}

function detailHtml(u: UnitRow): string {
  const sigs = u.signals.length
    ? u.signals.map((s) => '<span class="up-sig ' + s.level + '">' + esc(s.text) + '</span>').join('')
    : '<span class="up-sig ok">ไม่พบสัญญาณผิดปกติ</span>';
  return '<tr class="up-detail"><td colspan="' + COLS.length + '">' +
    '<div class="up-sigs">' + sigs + '</div>' +
    '<div class="up-facts">' +
      '<span>คนทัก <b>' + fmtNum(u.base) + '</b></span>' +
      '<span>ออเดอร์ <b>' + fmtNum(u.orders) + '</b></span>' +
      '<span>เปอร์บิล <b>' + (u.perBill ? THB(u.perBill) : '—') + '</b></span>' +
      '<span>ค่าทัก <b>' + (u.costPerMsg === null ? '—' : '฿' + u.costPerMsg.toFixed(2)) + '</b></span>' +
      '<span>ขาดอีก <b>' + (u.gap ? THB(u.gap) : '—') + '</b></span>' +
      '<span>จุดคุ้มทุน <b>' + (u.breakEvenSet ? u.breakEven + 'x' : 'ยังไม่ตั้ง') + '</b></span>' +
      (u.mapped ? '<span>เพจ/แอดมิน <b>' + fmtNum(u.pages) + ' / ' + fmtNum(u.admins) + '</b></span>' : '') +
      (u.note ? '<span>📌 ' + esc(u.note) + '</span>' : '') +
    '</div>' +
    (u.mapped ? '<button type="button" class="up-daily" data-u="' + esc(u.u) + '">ดูยอดรายวันของ ' + esc(u.u) + ' ›</button>' : '') +
  '</td></tr>';
}

/** แถวรวมท้ายตาราง — รวมเฉพาะยูนิตที่ตัวกรองเหลือไว้ ไม่ใช่ยอดรวมทั้งหมดเสมอ */
function footHtml(list: UnitRow[]): string {
  const sum = list.reduce((a, u) => ({
    revenue: a.revenue + u.revenue,
    target: a.target + (u.target || 0),
    spend: a.spend + u.spend,
    orders: a.orders + u.orders,
    projected: a.projected + (u.projected === null ? u.revenue : u.projected),
    profit: a.profit + (u.profit || 0),
  }), { revenue: 0, target: 0, spend: 0, orders: 0, projected: 0, profit: 0 });
  const attain = sum.target > 0 ? Math.round((sum.revenue / sum.target) * 1000) / 10 : null;
  const projAttain = sum.target > 0 ? Math.round((sum.projected / sum.target) * 100) : null;
  return '<tr>' +
    '<td><b>รวม ' + fmtNum(list.length) + ' ยูนิต</b></td>' +
    '<td class="r num"><div class="up-big">' + thbShort(sum.revenue) + '</div>' +
      '<div class="up-sub">' + fmtNum(sum.orders) + ' ออเดอร์</div></td>' +
    '<td class="r num ' + pctClass(attain) + '">' + (attain === null ? '—' : attain + '% ของ ' + thbShort(sum.target)) + '</td>' +
    '<td class="r num ' + pctClass(projAttain) + '"><div class="up-big">' + (projAttain === null ? '—' : projAttain + '%') + '</div>' +
      '<div class="up-sub">' + thbShort(sum.projected) + '</div></td>' +
    '<td></td><td></td>' +
    '<td class="r num">' + thbShort(sum.spend) + '</td>' +
    '<td class="r num ' + (sum.profit >= 0 ? 'good' : 'bad') + '">' + thbShort(sum.profit) + '</td>' +
    '<td></td><td></td>' +
  '</tr>';
}

/** ค้นหาอย่างเดียว (ยังไม่กรองระดับ) — ใช้เป็นฐานนับจำนวนบนชิปกรอง ให้ตัวเลขตรงกับสิ่งที่จะได้เห็นจริง */
function searchOnly(units: UnitRow[]): UnitRow[] {
  const q = state.q.trim().toLowerCase();
  if (!q) return units;
  return units.filter((u) => (u.u || '').toLowerCase().indexOf(q) >= 0 || (u.product || '').toLowerCase().indexOf(q) >= 0);
}

function filterSort(units: UnitRow[], d: PerfData): UnitRow[] {
  const list = searchOnly(units).filter((u) => state.level === 'all' || u.level === state.level);
  const col = COLS.filter((c) => c.key === state.sortKey)[0];
  const val = col && col.val;
  if (!val) return list;               // '' = ลำดับความเสี่ยงที่ API เรียงมาให้แล้ว
  const dir = state.sortDir === 'asc' ? 1 : -1;
  return list.slice().sort((a, b) => {
    const va = val(a, d), vb = val(b, d);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;          // ค่าที่ไม่มี อยู่ท้ายเสมอ
    if (vb === null) return -1;
    if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb)) * dir;
    return (va - vb) * dir;
  });
}

/**
 * รายการเดือน = 6 เดือนล่าสุดนับจาก "เดือนปัจจุบัน" เสมอ (ไม่ใช่จากเดือนที่เลือก ไม่งั้นเดินถอยหลังทางเดียว
 * แล้วกลับมาเดือนนี้ไม่ได้) · ไม่ย้อนเกินเดือนที่ระบบเริ่มมีออเดอร์จริง · เดือนที่เลือกอยู่ต้องอยู่ในรายการเสมอ
 */
function monthOptions(cur: string, dataStart: string): string {
  const now = new Date(Date.now() + 7 * 3600e3);   // เวลาไทย
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  const floor = (dataStart || '2026-05-23').slice(0, 7);
  const keys: string[] = [];
  for (let i = 0; i < 6; i++) {
    const dt = new Date(Date.UTC(y, m - 1 - i, 1));
    const key = dt.toISOString().slice(0, 7);
    if (key < floor) break;
    keys.push(key);
  }
  if (cur && keys.indexOf(cur) < 0) keys.push(cur);
  keys.sort().reverse();
  return keys.map((key) => '<option value="' + key + '"' + (key === cur ? ' selected' : '') + '>' +
    esc(monthLabel(key)) + '</option>').join('');
}

function levelChips(units: UnitRow[]): string {
  const base = searchOnly(units);
  const n = (lv: string) => (lv === 'all' ? base.length : base.filter((u) => u.level === lv).length);
  const defs: Array<[string, string]> = [['all', 'ทั้งหมด'], ['urgent', 'ต้องแก้ทันที'], ['watch', 'เฝ้าระวัง'], ['ok', 'ปกติ']];
  return '<div class="up-chips" role="group" aria-label="กรองตามระดับความเสี่ยง">' +
    defs.map(([k, label]) => '<button type="button" class="up-chip ' + k + '" data-lv="' + k + '"' +
      ' aria-pressed="' + (state.level === k ? 'true' : 'false') + '">' +
      esc(label) + ' <b>' + fmtNum(n(k)) + '</b></button>').join('') +
  '</div>';
}

function render(container: HTMLElement, d: PerfData | null): void {
  if (!d) return;
  if (d.salesFailed) {
    container.innerHTML = '<div class="card"><h3>🎯 ผลงานราย Unit</h3>' +
      '<div class="empty-note">ดึงยอดขายรอบนี้ไม่สำเร็จ (ฐานข้อมูลตอบช้าหรือพลาด) — กดรีเฟรชอีกครั้ง' +
      ' ไม่ต้องรัน SQL ซ้ำ</div></div>';
    return;
  }
  // ไม่มี RPC ยอดขาย = ทั้งหน้าไม่มีตัวเลขเลย ต้องหยุดและบอกวิธีรัน
  // ส่วน RPC ค่าแอดหายไปแค่ทำให้ ROAS/ค่าทัก/ค่าแอด เป็น "—" ตัวเลขที่เหลือยังใช้ได้ จึงแค่เตือน
  if (d.needSalesRpc) {
    container.innerHTML = '<div class="card"><h3>🎯 ผลงานราย Unit</h3>' +
      '<div class="empty-note">ยังใช้ไม่ได้ — ต้องรันไฟล์ <b>db/migrations/2026-09-21-sales-daily-by-page.sql</b>' +
      ' ใน Supabase (SQL Editor → วาง → Run) ก่อนหนึ่งครั้ง</div></div>';
    return;
  }
  const t = d.totals;
  const list = filterSort(d.units || [], d);
  const dayNote = d.isCurrentMonth
    ? 'ข้อมูลถึงวันนี้ (' + d.daysElapsed + ' จาก ' + d.daysInMonth + ' วัน) • คาดการณ์คิดจากยอดเฉลี่ยของ ' +
      d.daysDone + ' วันที่จบแล้ว (ไม่รวมวันนี้)'
    : 'เดือนที่จบแล้ว — ตัวเลขคือยอดจริงทั้งเดือน' +
      (d.lossUsable ? '' : ' • สัญญาณ “ขาดทุนกี่วันติด” มีเฉพาะเดือนปัจจุบัน (งาน sync นับถอยจากเมื่อวาน)');

  const summary = '<div class="pg-summary">' +
    '<div class="pgs-item' + (t.urgent ? ' bad' : ' ok') + '"><b>' + fmtNum(t.urgent) + '</b><span>ยูนิตต้องแก้ทันที</span></div>' +
    '<div class="pgs-item' + (t.watch ? ' warn' : '') + '"><b>' + fmtNum(t.watch) + '</b><span>ยูนิตเฝ้าระวัง</span></div>' +
    '<div class="pgs-item"><b>' + thbShort(t.revenue) + '</b><span>ยอดรวมเดือนนี้' + (t.target ? ' / เป้า ' + thbShort(t.target) : '') + '</span></div>' +
    '<div class="pgs-item"><b>' + thbShort(d.isCurrentMonth ? t.projected : t.revenue) + '</b><span>' +
      (d.isCurrentMonth ? 'คาดการณ์สิ้นเดือนรวม' : 'ยอดจริงทั้งเดือน') + '</span></div>' +
  '</div>';

  const toolbar = '<div class="up-toolbar">' +
    '<div class="up-controls">' +
      '<input class="input up-search" id="up-q" placeholder="🔍 ค้นหารหัส U หรือชื่อสินค้า" value="' + esc(state.q) + '">' +
      '<select class="input" id="up-month" aria-label="เลือกเดือน">' + monthOptions(d.month, d.dataStart) + '</select>' +
    '</div>' +
    levelChips(d.units || []) +
  '</div>';

  container.innerHTML =
    '<div class="sr-head">' +
      '<div>' +
        '<div class="sr-title">🎯 ภาพรวมผลงานราย Unit — ' + esc(monthLabel(d.month)) + '</div>' +
        '<div class="sr-title-sub" aria-live="polite">แสดง ' + fmtNum(list.length) + ' จาก ' + fmtNum((d.units || []).length) +
          ' ยูนิต • ' + esc(dayNote) + '</div>' +
      '</div>' +
    '</div>' +
    toolbar +
    summary +
    (d.needAdsRpc
      ? '<div class="empty-note">⚠️ ค่าแอด / ROAS / ค่าทัก ยังขึ้นเป็น “—” เพราะยังไม่ได้รันไฟล์' +
        ' <b>db/migrations/2026-09-21-ads-daily-by-page.sql</b> ใน Supabase — ตัวเลขอื่นใช้ได้ตามปกติ</div>'
      : d.adsFailed
        ? '<div class="empty-note">⚠️ ดึงค่าแอดรอบนี้ไม่สำเร็จ — ค่าแอด / ROAS / ค่าทัก จึงขึ้นเป็น “—” ชั่วคราว</div>'
        : '') +
    (d.beforeData
      ? '<div class="empty-note">⚠️ เดือนนี้อยู่ก่อนวันที่ระบบเริ่มเก็บออเดอร์จริง (' + esc(d.dataStart) + ')' +
        ' — ยอด ฿0 แปลว่า “ไม่มีข้อมูล” ไม่ใช่ขายไม่ได้</div>'
      : '') +
    (d.goalYearMismatch ? '<div class="empty-note">⚠️ ชีท KPI ที่ sync มาเป็นของคนละปีกับเดือนที่เลือก — ตารางจึงไม่มีเป้า</div>' : '') +
    (list.length
      ? '<div class="card" style="padding:0;overflow:hidden">' +
          '<div class="table-scroll">' +
            '<table class="tbl up-tbl tbl-scroll-x" data-cards="off">' +
              '<thead><tr>' + headHtml() + '</tr></thead>' +
              '<tbody>' + list.map((u, i) => rowHtml(u, i + 1, d)).join('') + '</tbody>' +
              '<tfoot>' + footHtml(list) + '</tfoot>' +
            '</table>' +
          '</div>' +
        '</div>'
      : '<div class="empty-note">ไม่มียูนิตที่ตรงกับตัวกรองนี้</div>') +
    '<div class="card-sub" style="margin-top:10px">' +
      'กดหัวคอลัมน์เพื่อเรียง • กดปุ่ม “ดู” ท้ายแถวเพื่ออ่านสัญญาณเต็มและตัวเลขรอง • ' +
      'ยอดขาย/ออเดอร์/คนทัก/ค่าแอด = กติกาเดียวกับหน้า Sales (ไม่นับออเดอร์ยกเลิก ตีกลับ รอสินค้า และออเดอร์เปล่า) • ' +
      'กำไรมาจากชีทสรุปรายสินค้า • สัญญาณ “ขาดทุน/ROAS ต่ำกว่าคุ้มทุน” นับวันติดต่อกันถึง' +
      (d.lossThroughDate ? ' ' + esc(d.lossThroughDate) : 'เมื่อวาน') + ' (วันนี้ยังไม่จบ จึงยังไม่ตัดสิน)' +
    '</div>';
}

/** วาดใหม่แล้วคืนโฟกัสให้ปุ่ม/ช่องที่เพิ่งใช้ — ไม่งั้นโฟกัสตกไปที่ body และหน้าเด้งขึ้นบนสุด */
function rerender(container: HTMLElement, focusSel: string, caret?: number): void {
  render(container, lastData);
  bind(container);
  const el = container.querySelector(focusSel) as HTMLInputElement | null;
  if (!el) return;
  el.focus({ preventScroll: true });
  if (caret !== undefined && el.setSelectionRange) el.setSelectionRange(caret, caret);
}

function bind(container: HTMLElement): void {
  const q = container.querySelector('#up-q') as HTMLInputElement | null;
  if (q) q.addEventListener('input', function () {
    const pos = q.selectionStart === null ? q.value.length : q.selectionStart;
    state.q = q.value;
    rerender(container, '#up-q', pos);
  });
  container.querySelectorAll('.up-chip').forEach(function (c) {
    c.addEventListener('click', function () {
      state.level = ((c as HTMLElement).dataset.lv || 'all') as any;
      rerender(container, '.up-chip[data-lv="' + state.level + '"]');
    });
  });
  container.querySelectorAll('.up-sort').forEach(function (b) {
    b.addEventListener('click', function () {
      const key = (b as HTMLElement).dataset.sort || '';
      const col = COLS.filter((c) => c.key === key)[0];
      if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortKey = key; state.sortDir = (col && col.dir) || 'desc'; }
      rerender(container, '.up-sort[data-sort="' + key + '"]');
    });
  });
  container.querySelectorAll('.up-more').forEach(function (b) {
    b.addEventListener('click', function () {
      const u = (b as HTMLElement).dataset.more || '';
      state.open = state.open === u ? '' : u;
      rerender(container, '.up-more[data-more="' + u + '"]');
    });
  });
  container.querySelectorAll('.up-daily').forEach(function (b) {
    b.addEventListener('click', function () { openDaily((b as HTMLElement).dataset.u || ''); });
  });
  const mo = container.querySelector('#up-month') as HTMLSelectElement | null;
  if (mo) mo.addEventListener('change', function () {
    state.month = mo.value;
    state.open = '';
    container.innerHTML = '<div class="loading"><div class="spinner"></div>กำลังโหลดข้อมูล...</div>';
    fetchData(container);
  });
}

/**
 * "ดูยอดรายวันของ Uxx" — สลับไปหน้า Sales แล้วพาไปที่ตาราง 📅 ยอดขายรายวัน พร้อมไฮไลต์คอลัมน์ของยูนิตนั้น
 * หน้า Sales ยังทยอยวาดการ์ดด้านบนหลังสลับหน้า ตารางจึงถูกดันลงเรื่อยๆ ต้องเลื่อนตามจนตำแหน่งนิ่ง
 * (วัดบน prod: เลื่อนครั้งเดียวแล้วจบ ตารางอยู่ต่ำกว่าขอบจอ 4,429px) และหยุดทันทีถ้าผู้ใช้เลื่อนเอง
 */
function openDaily(u: string): void {
  App.switchView('sales');
  const t0 = Date.now();
  let stop = false;
  const cancel = function () { stop = true; };
  ['wheel', 'touchstart', 'keydown'].forEach(function (e) { window.addEventListener(e, cancel, { once: true, passive: true }); });
  const clear = function () { ['wheel', 'touchstart', 'keydown'].forEach(function (e) { window.removeEventListener(e, cancel); }); };

  const tick = function () {
    if (stop) { clear(); return; }
    const card = document.getElementById('sr-daily');
    if (card) {
      if (u) {
        card.querySelectorAll('[data-u]').forEach(function (el) {
          el.classList.toggle('ds-hl', (el as HTMLElement).dataset.u === u);
        });
      }
      let last = -1e9;
      const follow = function (left: number) {
        if (stop) { clear(); return; }
        const top = Math.round(card.getBoundingClientRect().top);
        if (Math.abs(top - last) > 4 || Math.abs(top) > 8) {
          last = top;
          card.scrollIntoView({ block: 'start', behavior: 'smooth' });
        } else { clear(); return; }
        if (left > 0) setTimeout(function () { follow(left - 1); }, 600);
        else clear();
      };
      follow(10);
      return;
    }
    if (Date.now() - t0 < 30000) setTimeout(tick, 400);
    else clear();
  };
  setTimeout(tick, 300);
}

function fetchData(container: HTMLElement): void {
  const seq = ++reqSeq;
  serverCall<PerfData>('apiUnitPerf', state.month ? { month: state.month } : {}).then(function (d) {
    if (seq !== reqSeq) return;
    lastData = d;
    state.month = d.month;
    render(container, d);
    bind(container);
  }).catch(function (err) {
    if (seq !== reqSeq) return;
    showError(container, (err && err.message) || 'เรียกข้อมูลไม่สำเร็จ', function () {
      container.innerHTML = '<div class="loading"><div class="spinner"></div>กำลังโหลดข้อมูล...</div>';
      fetchData(container);
    });
  });
}

export const unitperf = {
  load: async (container: HTMLElement, force?: boolean): Promise<void> => {
    if (lastData && !force) {
      render(container, lastData);
      bind(container);
      fetchData(container);
      return;
    }
    container.innerHTML = '<div class="loading"><div class="spinner"></div>กำลังโหลดผลงานราย Unit...</div>';
    fetchData(container);
  },
};
