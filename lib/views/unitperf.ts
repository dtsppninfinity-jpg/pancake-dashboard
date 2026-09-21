// lib/views/unitperf.ts — หน้า "🎯 ผลงานราย Unit" (พีสั่ง 21 ก.ย. 2569)
// การ์ดใบละยูนิต: ยอดเดือนนี้ vs เป้า + คาดการณ์สิ้นเดือน + สัญญาณเตือนที่ระบบตรวจเจอ เรียงตามความเสี่ยง
// ตัวเลขทุกตัวมาจาก apiUnitPerf (lib/api/unitperf.ts) — กติกาเดียวกับหน้า Sales ทุกช่อง
//
// โครงการ์ด = แถบนอน 4 ชั้น (หัว / เป้า / ตัวเลข / สัญญาณ) — รื้อจากแบบ 4 คอลัมน์ 21 ก.ย.
// เพราะแบบคอลัมน์ ความสูงถูกดันด้วยคอลัมน์สัญญาณคอลัมน์เดียว อีก 3 คอลัมน์ว่างราว 40% ของการ์ด

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
// ตัวกรองจำข้ามการ re-render (ผู้ใช้เลื่อนดูแล้วรีเฟรชอัตโนมัติ ตัวกรองต้องไม่รีเซ็ตเอง)
const state = { month: '', q: '', level: 'all' as 'all' | 'urgent' | 'watch' | 'ok', sort: 'risk' as 'risk' | 'attain' | 'revenue' | 'profit' };

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const monthLabel = (m: string) => (TH_MONTHS[Number(m.slice(5, 7)) - 1] || m) + ' ' + ((Number(m.slice(0, 4)) + 543) % 100);

const LEVEL_LABEL: Record<string, string> = { urgent: 'ต้องแก้ทันที', watch: 'เฝ้าระวัง', ok: 'ปกติ' };
const LEVEL_CLS: Record<string, string> = { urgent: 'urgent', watch: 'info', ok: 'ai' };

/** เงินแบบย่อให้การ์ดอ่านรวดเดียว (฿2.6M / ฿91.3K) — ตัวเต็มอยู่ใน tooltip เสมอ
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

/** เงินเต็มจำนวนสำหรับ tooltip — ติดลบต้องเป็น -฿34,810 ให้ตรงกับตัวเลขบนการ์ด (THB() กลางของเว็บให้ ฿-34,810) */
function THBs(n: number): string {
  return n < 0 ? '-' + THB(Math.abs(n)) : THB(n);
}

/** เกณฑ์สีเดียวกับทั้งเว็บ: ถึงเป้า = เขียว, 80-99 = ส้ม, ต่ำกว่า = แดง */
function pctClass(pct: number | null): string {
  if (pct === null || pct === undefined) return '';
  return pct >= 100 ? 'good' : pct >= 80 ? 'warn' : 'bad';
}

const clampPct = (v: number) => Math.max(0, Math.min(100, v));

/**
 * แถบความคืบหน้า: เต็มแถบ = เป้าเดือน
 *   ทึบ  = ยอดจริงถึงตอนนี้
 *   จาง  = ส่วนที่คาดว่าจะได้เพิ่มจนสิ้นเดือน
 *   ขีด  = ผ่านไปแล้วกี่ % ของเดือน (ถ้าขายสม่ำเสมอ ยอดควรถึงขีดนี้)
 * เดือนที่จบแล้วไม่มีทั้งส่วนจางและขีด
 */
function barHtml(u: UnitRow, d: PerfData, cls: string): string {
  if (u.target === null || !u.target) return '';
  const now = clampPct(u.attain === null ? 0 : u.attain);
  const projRaw = d.isCurrentMonth && u.projAttain !== null ? clampPct(u.projAttain) : now;
  const projW = Math.max(0, projRaw - now);
  const pace = d.isCurrentMonth ? clampPct((d.daysElapsed / d.daysInMonth) * 100) : null;
  const tip = 'เต็มแถบ = เป้าเดือน ' + THB(u.target) +
    ' • ส่วนทึบ = ยอดจริง ' + (u.attain === null ? '0' : u.attain) + '%' +
    (projW > 0 ? ' • ส่วนจาง = คาดการณ์ถึงสิ้นเดือน ' + u.projAttain + '%' : '') +
    (pace !== null ? ' • ขีด = ผ่านไปแล้ว ' + d.daysElapsed + ' จาก ' + d.daysInMonth + ' วัน (' + Math.round(pace) + '%)' : '');
  return '<div class="up-bar" title="' + esc(tip) + '">' +
    '<i class="fill ' + cls + '" style="width:' + now.toFixed(2) + '%"></i>' +
    (projW > 0 ? '<i class="proj ' + cls + '" style="left:' + now.toFixed(2) + '%;width:' + projW.toFixed(2) + '%"></i>' : '') +
    (pace !== null ? '<i class="pace" style="left:calc(' + pace.toFixed(2) + '% - 1px)"></i>' : '') +
  '</div>';
}

function statTile(label: string, value: string, ref: string, tip: string, cls?: string): string {
  return '<div class="up-stat' + (cls ? ' ' + cls : '') + '" title="' + esc(tip) + '">' +
    '<span>' + esc(label) + '</span><b>' + value + '</b><em>' + esc(ref) + '</em></div>';
}

function cardHtml(u: UnitRow, rank: number, d: PerfData): string {
  const name = u.mapped ? (u.u || '') : '⚠️ ยังไม่จัดกลุ่ม';
  // ตัวเลขที่ใช้ตัดสินสี = คาดการณ์ในเดือนที่ยังไม่จบ / ยอดจริงในเดือนที่จบแล้ว (กติกาเดิมของวงแหวน)
  const headPct = d.isCurrentMonth && u.projected !== null ? u.projAttain : u.attain;
  const cls = pctClass(headPct);
  const projTip = d.isCurrentMonth && u.projected !== null
    ? 'คาดการณ์สิ้นเดือน ' + THB(u.projected) +
      (u.projAttain === null ? ' (ยังไม่มีเป้าเดือนนี้ในชีท KPI จึงเทียบ %บรรลุไม่ได้)' : ' = ' + u.projAttain + '% ของเป้า') +
      ' (ยอดเฉลี่ยของ ' + d.daysDone + ' วันที่จบแล้ว × ' + d.daysInMonth + ' วัน — ไม่รวมวันนี้ที่ยังไม่จบ)'
    : d.isCurrentMonth ? 'วันแรกของเดือน ยังไม่มีวันที่จบแล้วให้คาดการณ์ — ตัวเลขนี้คือ %บรรลุจริงถึงตอนนี้'
      : 'ยอดจริงทั้งเดือนเทียบเป้า';
  const projSub = u.target === null ? 'ยังไม่มีเป้าในชีท KPI'
    : !d.isCurrentMonth ? 'ยอดจริงทั้งเดือน'
      : u.projected === null ? 'ยังคาดไม่ได้ (วันแรกของเดือน)' : 'คาดสิ้นเดือน ' + thbShort(u.projected);

  const signals = u.signals.length
    ? u.signals.map((s) => '<span class="up-sig ' + (s.level === 'urgent' ? 'urgent' : 'watch') + '">' + esc(s.text) + '</span>').join('')
    : '<span class="up-sig ok">ไม่พบสัญญาณผิดปกติ</span>';

  return '<article class="up-card lv-' + u.level + '">' +
    '<div class="up-head">' +
      '<span class="up-rank" title="ลำดับตามการเรียงที่เลือกอยู่">' + rank + '</span>' +
      '<div class="up-id">' +
        '<span class="up-u">' + esc(name) + '</span>' +
        (u.product ? '<span class="up-prod">' + esc(u.product) + '</span>' : '') +
        (u.mapped ? '<span class="up-meta">' + fmtNum(u.pages) + ' เพจ • ' + fmtNum(u.admins) + ' แอดมิน</span>' : '') +
      '</div>' +
      (u.note ? '<span class="chip" title="หมายเหตุยูนิต (แก้ที่หน้า Sales → ตั้งค่ายูนิต)">📌 ' + esc(u.note) + '</span>' : '') +
      '<span class="badge ' + LEVEL_CLS[u.level] + '">' + esc(LEVEL_LABEL[u.level]) + '</span>' +
    '</div>' +

    '<div class="up-goal">' +
      '<div class="up-goal-top">' +
        '<div>' +
          '<span class="up-amount-lb">ยอดเดือนนี้ / เป้าเดือน</span>' +
          '<div class="up-amount" title="' + esc('ยอดจริง ' + THB(u.revenue) + (u.target ? ' • เป้าเดือน ' + THB(u.target) : ' • ยังไม่มีเป้าในชีท KPI')) + '">' +
            thbShort(u.revenue) + (u.target ? '<small>/ ' + thbShort(u.target) + '</small>' : '') +
          '</div>' +
        '</div>' +
        '<div class="up-proj ' + cls + '" title="' + esc(projTip) + '">' +
          '<b>' + (headPct === null ? '—' : Math.round(headPct) + '%') + '</b>' +
          '<span>' + esc(projSub) + '</span>' +
        '</div>' +
      '</div>' +
      barHtml(u, d, cls) +
      '<div class="up-goal-sub">' +
        '<span>' + (u.attain === null ? 'ยังไม่มีเป้าเดือนนี้ในชีท KPI'
          : 'ทำได้ ' + u.attain + '% ของเป้า' + (u.gap ? ' • ขาดอีก ' + thbShort(u.gap) : ' • ถึงเป้าแล้ว')) + '</span>' +
        '<span>ออเดอร์ ' + fmtNum(u.orders) + (u.perBill ? ' • เปอร์บิล ' + THB(u.perBill) : '') + '</span>' +
      '</div>' +
    '</div>' +

    '<div class="up-stats">' +
      statTile('ทัก', fmtNum(u.base), 'คนทักรวม',
        'รวมคนทัก (อินบ็อกซ์ใหม่ + คอมเมนต์ ของเพจ Facebook) ทั้งเดือน — ตัวหารของ %ปิดและค่าทัก') +
      statTile('%ปิด', u.closeRate === null ? '—' : u.closeRate.toFixed(2) + '%', 'เป้า ' + d.closeTarget + '%',
        'ออเดอร์ ' + fmtNum(u.orders) + ' ÷ รวมคนทัก ' + fmtNum(u.base) + ' • เป้า ' + d.closeTarget + '% ขึ้นไป',
        u.closeRate === null ? '' : (u.closeRate >= d.closeTarget ? 'good' : 'bad')) +
      statTile('ROAS', u.roas === null ? '—' : u.roas.toFixed(2) + 'x',
        u.breakEvenSet ? 'คุ้มทุน ' + u.breakEven + 'x' : 'ยังไม่ตั้งคุ้มทุน (ใช้ 1x)',
        'ยอดขาย ÷ ค่าแอด ' + THB(u.spend) + ' • จุดคุ้มทุนของยูนิตนี้ ' + u.breakEven + 'x' +
          (u.breakEvenSet ? '' : ' (ค่าเริ่มต้น เพราะยังไม่ได้ตั้งในหน้า Sales → ตั้งค่ายูนิต)'),
        u.roas === null || !u.breakEvenSet ? '' : (u.roas >= u.breakEven ? 'good' : 'bad')) +
      statTile('ค่าทัก', u.costPerMsg === null ? '—' : '฿' + u.costPerMsg.toFixed(2), 'ต่อคนทัก 1 คน', 'ค่าแอด ÷ รวมคนทัก') +
      statTile('ค่าแอด', thbShort(u.spend), 'จ่ายจริงเดือนนี้', 'ค่าแอดจริงจาก Meta ทั้งเดือน ' + THB(u.spend)) +
      statTile('กำไร', u.profit === null ? '—' : thbShort(u.profit), 'จากชีทสินค้า',
        u.profit === null ? 'ยังไม่มีข้อมูลกำไรของยูนิตนี้ในชีทสรุปรายสินค้า' : 'กำไรสุทธิสะสมเดือนนี้จากชีท ' + THBs(u.profit),
        u.profit === null ? '' : (u.profit >= 0 ? 'good' : 'bad')) +
    '</div>' +

    '<div class="up-sigs">' +
      '<span class="up-sigs-lb">ระบบตรวจพบ</span>' + signals +
      (u.mapped ? '<button type="button" class="up-daily" data-u="' + esc(u.u) + '">ดูรายวันของ ' + esc(u.u) + ' ›</button>' : '') +
    '</div>' +
  '</article>';
}

/** ค้นหาอย่างเดียว (ยังไม่กรองระดับ) — ใช้เป็นฐานนับจำนวนบนชิปกรอง ให้ตัวเลขตรงกับสิ่งที่จะได้เห็นจริง */
function searchOnly(units: UnitRow[]): UnitRow[] {
  const q = state.q.trim().toLowerCase();
  if (!q) return units;
  return units.filter((u) => (u.u || '').toLowerCase().indexOf(q) >= 0 || (u.product || '').toLowerCase().indexOf(q) >= 0);
}

function filterSort(units: UnitRow[]): UnitRow[] {
  let list = searchOnly(units).filter((u) => state.level === 'all' || u.level === state.level);
  if (state.sort === 'attain') {
    list = list.slice().sort((a, b) => (a.attain === null ? 9999 : a.attain) - (b.attain === null ? 9999 : b.attain));
  } else if (state.sort === 'revenue') {
    list = list.slice().sort((a, b) => b.revenue - a.revenue);
  } else if (state.sort === 'profit') {
    list = list.slice().sort((a, b) => (a.profit === null ? 1e15 : a.profit) - (b.profit === null ? 1e15 : b.profit));
  }
  return list;   // 'risk' = ลำดับที่ API เรียงมาให้แล้ว
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
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const key = d.toISOString().slice(0, 7);
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
  const list = filterSort(d.units || []);
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
      '<select class="input" id="up-sort" aria-label="เรียงลำดับ">' +
        '<option value="risk"' + (state.sort === 'risk' ? ' selected' : '') + '>เรียง: ความเสี่ยงสูงสุด</option>' +
        '<option value="attain"' + (state.sort === 'attain' ? ' selected' : '') + '>เรียง: %บรรลุต่ำสุด</option>' +
        '<option value="revenue"' + (state.sort === 'revenue' ? ' selected' : '') + '>เรียง: ยอดขายมากสุด</option>' +
        '<option value="profit"' + (state.sort === 'profit' ? ' selected' : '') + '>เรียง: กำไรน้อยสุด</option>' +
      '</select>' +
    '</div>' +
    levelChips(d.units || []) +
  '</div>';

  container.innerHTML =
    '<div class="sr-head">' +
      '<div>' +
        '<div class="sr-title">🎯 ภาพรวมผลงานราย Unit — ' + esc(monthLabel(d.month)) + '</div>' +
        '<div class="sr-title-sub" aria-live="polite">แสดง ' + fmtNum(list.length) + ' จาก ' + fmtNum((d.units || []).length) + ' ยูนิต • ' + esc(dayNote) + '</div>' +
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
        ' — ยอด ฿0 บนการ์ดแปลว่า “ไม่มีข้อมูล” ไม่ใช่ขายไม่ได้</div>'
      : '') +
    (d.goalYearMismatch ? '<div class="empty-note">⚠️ ชีท KPI ที่ sync มาเป็นของคนละปีกับเดือนที่เลือก — การ์ดจึงไม่มีเป้า</div>' : '') +
    (list.length
      ? '<div class="up-list">' + list.map((u, i) => cardHtml(u, i + 1, d)).join('') + '</div>'
      : '<div class="empty-note">ไม่มียูนิตที่ตรงกับตัวกรองนี้</div>') +
    '<div class="card-sub" style="margin-top:10px">' +
      'ยอดขาย/ออเดอร์/คนทัก/ค่าแอด = กติกาเดียวกับหน้า Sales (ไม่นับออเดอร์ยกเลิก ตีกลับ รอสินค้า และออเดอร์เปล่า) • ' +
      'กำไรมาจากชีทสรุปรายสินค้า • ROAS ต่ำกว่าจุดคุ้มทุนนับวันติดต่อกันถึง' +
      (d.lossThroughDate ? ' ' + esc(d.lossThroughDate) : 'เมื่อวาน') + ' (วันนี้ยังไม่จบ จึงยังไม่ตัดสิน)' +
    '</div>';
}

function bind(container: HTMLElement): void {
  const q = container.querySelector('#up-q') as HTMLInputElement | null;
  if (q) q.addEventListener('input', function () {
    const pos = q.selectionStart === null ? q.value.length : q.selectionStart;
    state.q = q.value;
    render(container, lastData);
    const again = container.querySelector('#up-q') as HTMLInputElement | null;
    // preventScroll: ไม่งั้นหน้าเด้งขึ้นบนสุดทุกครั้งที่พิมพ์ 1 ตัว · คืนเคอร์เซอร์ตำแหน่งเดิม ไม่ดีดไปท้ายช่อง
    if (again) { again.focus({ preventScroll: true }); again.setSelectionRange(pos, pos); }
    bind(container);
  });
  container.querySelectorAll('.up-chip').forEach(function (c) {
    c.addEventListener('click', function () {
      state.level = ((c as HTMLElement).dataset.lv || 'all') as any;
      render(container, lastData);
      bind(container);
      // render ใหม่ทั้งก้อน = ปุ่มที่เพิ่งกดถูกทิ้ง โฟกัสจะตกไปที่ body แล้วต้อง Tab ใหม่ตั้งแต่ต้น
      const again = container.querySelector('.up-chip[data-lv="' + state.level + '"]') as HTMLElement | null;
      if (again) again.focus({ preventScroll: true });
    });
  });
  const sort = container.querySelector('#up-sort') as HTMLSelectElement | null;
  if (sort) sort.addEventListener('change', function () {
    state.sort = sort.value as any;
    render(container, lastData);
    bind(container);
    const again = container.querySelector('#up-sort') as HTMLElement | null;
    if (again) again.focus({ preventScroll: true });
  });
  const mo = container.querySelector('#up-month') as HTMLSelectElement | null;
  if (mo) mo.addEventListener('change', function () {
    state.month = mo.value;
    container.innerHTML = '<div class="loading"><div class="spinner"></div>กำลังโหลดข้อมูล...</div>';
    fetchData(container);
  });
  container.querySelectorAll('.up-daily').forEach(function (b) {
    b.addEventListener('click', function () { openDaily((b as HTMLElement).dataset.u || ''); });
  });
}

/**
 * "ดูรายวันของ Uxx" — สลับไปหน้า Sales แล้วพาไปที่ตาราง 📅 ยอดขายรายวัน พร้อมไฮไลต์คอลัมน์ของยูนิตนั้น
 * หน้า Sales โหลดข้อมูลเอง กว่าตารางจะขึ้นใช้เวลา จึงต้องเฝ้ารอ (ไม่ใช่เลื่อนทันทีแล้วพลาด)
 */
function openDaily(u: string): void {
  App.switchView('sales');
  const t0 = Date.now();
  const tick = function () {
    const card = document.getElementById('sr-daily');
    if (card) {
      card.scrollIntoView({ block: 'start', behavior: 'smooth' });
      if (u) {
        card.querySelectorAll('[data-u]').forEach(function (el) {
          el.classList.toggle('ds-hl', (el as HTMLElement).dataset.u === u);
        });
      }
      return;
    }
    if (Date.now() - t0 < 30000) setTimeout(tick, 400);
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
