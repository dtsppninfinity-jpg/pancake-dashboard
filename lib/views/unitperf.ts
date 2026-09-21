// lib/views/unitperf.ts — หน้า "🎯 ผลงานราย Unit" (พีสั่ง 21 ก.ย. 2569)
// การ์ดใบละยูนิต: ยอดเดือนนี้ vs เป้า + คาดการณ์สิ้นเดือน + สัญญาณเตือนที่ระบบตรวจเจอ เรียงตามความเสี่ยง
// ตัวเลขทุกตัวมาจาก apiUnitPerf (lib/api/unitperf.ts) — กติกาเดียวกับหน้า Sales ทุกช่อง

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
  breakEven: number; lossStreak: number; closeStreak: number;
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

/** เงินแบบย่อให้การ์ดอ่านรวดเดียว (฿2.6M / ฿91.3K) — ตัวเต็มอยู่ใน tooltip เสมอ */
function thbShort(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(Number(n))) return '—';
  const v = Number(n);
  const a = Math.abs(v);
  if (a >= 1e6) return '฿' + (v / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (a >= 1e4) return '฿' + (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return THB(Math.round(v));
}

/** วงแหวน %บรรลุ — สีเดียวกับเกณฑ์ที่ใช้ทั้งเว็บ (ถึงเป้าเขียว / 80-99 ส้ม / ต่ำกว่าแดง) */
function ringHtml(pct: number | null, caption: string): string {
  if (pct === null || pct === undefined) {
    return '<div class="up-ring up-ring-none"><span>—</span></div>' +
      (caption ? '<div class="up-ring-cap">' + esc(caption) + '</div>' : '');
  }
  const v = Math.max(0, Math.min(999, pct));
  const deg = Math.round(Math.min(100, v) * 3.6);
  const color = v >= 100 ? 'var(--green)' : v >= 80 ? 'var(--amber)' : 'var(--red)';
  return '<div class="up-ring" style="background:conic-gradient(' + color + ' ' + deg + 'deg, var(--surface-2) 0)">' +
      '<span><b>' + Math.round(v) + '%</b><small>ของเป้า</small></span>' +
    '</div>' + (caption ? '<div class="up-ring-cap">' + esc(caption) + '</div>' : '');
}

function statTile(label: string, value: string, tip: string, cls?: string): string {
  return '<div class="up-stat' + (cls ? ' ' + cls : '') + '" title="' + esc(tip) + '">' +
    '<span>' + esc(label) + '</span><b>' + value + '</b></div>';
}

function cardHtml(u: UnitRow, rank: number, d: PerfData): string {
  const name = u.mapped ? (u.u || '') : '⚠️ ยังไม่จัดกลุ่ม';
  const sub = [u.product, u.mapped ? fmtNum(u.pages) + ' เพจ' : '', u.mapped ? fmtNum(u.admins) + ' แอดมิน' : '']
    .filter(Boolean).join(' • ');
  const gapTxt = u.target === null ? ''
    : (u.gap ? 'ขาดอีก ' + thbShort(u.gap) : 'ถึงเป้าแล้ว');
  const signals = u.signals.length
    ? '<div class="up-sig-title">สิ่งที่ระบบตรวจพบ</div>' +
      u.signals.map((s) => '<div class="up-sig ' + (s.level === 'urgent' ? 'urgent' : 'watch') + '">' + esc(s.text) + '</div>').join('')
    : '<div class="up-sig-title">สิ่งที่ระบบตรวจพบ</div><div class="up-sig ok">ไม่พบสัญญาณผิดปกติ</div>';

  return '<div class="up-card lv-' + u.level + '">' +
    '<div class="up-head">' +
      '<div class="up-rank">' + rank + '</div>' +
      '<div class="up-name">' +
        '<div class="up-u">' + esc(name) + '</div>' +
        '<div class="up-sub">' + esc(sub) + '</div>' +
        '<span class="badge ' + LEVEL_CLS[u.level] + '">' + esc(LEVEL_LABEL[u.level]) + '</span>' +
        (u.note ? '<span class="chip" title="หมายเหตุยูนิต (แก้ที่หน้า Sales → ตั้งค่ายูนิต)">📌 ' + esc(u.note) + '</span>' : '') +
      '</div>' +
    '</div>' +
    '<div class="up-body">' +
      '<div class="up-money">' +
        '<div class="up-money-label">ยอดเดือนนี้ / เป้าเดือน</div>' +
        '<div class="up-money-big" title="' + esc('ยอดจริง ' + THB(u.revenue) + (u.target ? ' • เป้าเดือน ' + THB(u.target) : ' • ยังไม่มีเป้าในชีท KPI')) + '">' +
          '<b>' + thbShort(u.revenue) + '</b>' + (u.target ? ' <span>/ ' + thbShort(u.target) + '</span>' : '') +
        '</div>' +
        '<div class="up-money-sub">' +
          (u.attain === null ? 'ยังไม่มีเป้าเดือนนี้ในชีท KPI' : u.attain + '% ของเป้า' + (gapTxt ? ' • ' + gapTxt : '')) +
        '</div>' +
        '<div class="up-money-sub">ออเดอร์ ' + fmtNum(u.orders) + (u.perBill ? ' • เปอร์บิล ' + THB(u.perBill) : '') + '</div>' +
      '</div>' +
      '<div class="up-ring-wrap" title="' + esc(d.isCurrentMonth && u.projected !== null
        ? 'วงแหวน = คาดการณ์สิ้นเดือน ' + THB(u.projected) + ' เทียบเป้า (ยอดเฉลี่ยของ ' + d.daysDone +
          ' วันที่จบแล้ว × ' + d.daysInMonth + ' วัน — ไม่รวมวันนี้ที่ยังไม่จบ)'
        : d.isCurrentMonth ? 'วันแรกของเดือน ยังไม่มีวันที่จบแล้วให้คาดการณ์ — วงแหวนแสดง %บรรลุจริง'
          : 'ยอดจริงทั้งเดือนเทียบเป้า') + '">' +
        ringHtml(d.isCurrentMonth && u.projected !== null ? u.projAttain : u.attain,
          !d.isCurrentMonth ? 'ยอดจริงทั้งเดือน'
            : u.projected === null ? 'ยังคาดไม่ได้ (วันแรกของเดือน)' : 'คาด ' + thbShort(u.projected)) +
      '</div>' +
      '<div class="up-stats">' +
        statTile('ทัก', fmtNum(u.base), 'รวมคนทัก (อินบ็อกซ์ใหม่ + คอมเมนต์ ของเพจ Facebook) ทั้งเดือน — ตัวหารของ %ปิดและค่าทัก') +
        statTile('%ปิด', u.closeRate === null ? '—' : u.closeRate.toFixed(2) + '%',
          'ออเดอร์ ' + fmtNum(u.orders) + ' ÷ รวมคนทัก ' + fmtNum(u.base) + ' • เป้า ' + d.closeTarget + '% ขึ้นไป',
          u.closeRate === null ? '' : (u.closeRate >= d.closeTarget ? 'good' : 'bad')) +
        statTile('ROAS', u.roas === null ? '—' : u.roas.toFixed(2) + 'x',
          'ยอดขาย ÷ ค่าแอด ' + THB(u.spend) + ' • จุดคุ้มทุนของยูนิตนี้ ' + u.breakEven + 'x',
          u.roas === null ? '' : (u.roas >= u.breakEven ? 'good' : 'bad')) +
        statTile('ค่าทัก', u.costPerMsg === null ? '—' : '฿' + u.costPerMsg.toFixed(2), 'ค่าแอด ÷ รวมคนทัก') +
        statTile('ค่าแอด', thbShort(u.spend), 'ค่าแอดจริงจาก Meta ทั้งเดือน ' + THB(u.spend)) +
        statTile('กำไร', u.profit === null ? '—' : thbShort(u.profit),
          u.profit === null ? 'ยังไม่มีข้อมูลกำไรของยูนิตนี้ในชีทสรุปรายสินค้า' : 'กำไรสุทธิสะสมเดือนนี้จากชีท ' + THB(u.profit),
          u.profit === null ? '' : (u.profit >= 0 ? 'good' : 'bad')) +
      '</div>' +
      '<div class="up-signals">' + signals +
        (u.mapped ? '<button type="button" class="up-daily" data-u="' + esc(u.u) + '">ดูรายวันของ ' + esc(u.u) + ' ›</button>' : '') +
      '</div>' +
    '</div>' +
  '</div>';
}

function filterSort(units: UnitRow[]): UnitRow[] {
  const q = state.q.trim().toLowerCase();
  let list = units.filter((u) => {
    if (state.level !== 'all' && u.level !== state.level) return false;
    if (!q) return true;
    return (u.u || '').toLowerCase().indexOf(q) >= 0 || (u.product || '').toLowerCase().indexOf(q) >= 0;
  });
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

  const controls = '<div class="up-controls">' +
    '<input class="input up-search" id="up-q" placeholder="🔍 ค้นหารหัส U หรือชื่อสินค้า" value="' + esc(state.q) + '">' +
    '<select class="input" id="up-month">' + monthOptions(d.month, d.dataStart) + '</select>' +
    '<select class="input" id="up-level">' +
      '<option value="all"' + (state.level === 'all' ? ' selected' : '') + '>ทั้งหมด</option>' +
      '<option value="urgent"' + (state.level === 'urgent' ? ' selected' : '') + '>เฉพาะต้องแก้ทันที</option>' +
      '<option value="watch"' + (state.level === 'watch' ? ' selected' : '') + '>เฉพาะเฝ้าระวัง</option>' +
      '<option value="ok"' + (state.level === 'ok' ? ' selected' : '') + '>เฉพาะปกติ</option>' +
    '</select>' +
    '<select class="input" id="up-sort">' +
      '<option value="risk"' + (state.sort === 'risk' ? ' selected' : '') + '>ความเสี่ยงสูงสุด</option>' +
      '<option value="attain"' + (state.sort === 'attain' ? ' selected' : '') + '>%บรรลุต่ำสุด</option>' +
      '<option value="revenue"' + (state.sort === 'revenue' ? ' selected' : '') + '>ยอดขายมากสุด</option>' +
      '<option value="profit"' + (state.sort === 'profit' ? ' selected' : '') + '>กำไรน้อยสุด</option>' +
    '</select>' +
  '</div>';

  container.innerHTML =
    '<div class="sr-head">' +
      '<div>' +
        '<div class="sr-title">🎯 ภาพรวมผลงานราย Unit — ' + esc(monthLabel(d.month)) + '</div>' +
        '<div class="sr-title-sub">แสดง ' + fmtNum(list.length) + ' จาก ' + fmtNum((d.units || []).length) + ' ยูนิต • ' + esc(dayNote) + '</div>' +
      '</div>' +
      controls +
    '</div>' +
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
    state.q = q.value;
    render(container, lastData);
    const again = container.querySelector('#up-q') as HTMLInputElement | null;
    if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    bind(container);
  });
  const lv = container.querySelector('#up-level') as HTMLSelectElement | null;
  if (lv) lv.addEventListener('change', function () { state.level = lv.value as any; render(container, lastData); bind(container); });
  const sort = container.querySelector('#up-sort') as HTMLSelectElement | null;
  if (sort) sort.addEventListener('change', function () { state.sort = sort.value as any; render(container, lastData); bind(container); });
  const mo = container.querySelector('#up-month') as HTMLSelectElement | null;
  if (mo) mo.addEventListener('change', function () {
    state.month = mo.value;
    container.innerHTML = '<div class="loading"><div class="spinner"></div>กำลังโหลดข้อมูล...</div>';
    fetchData(container);
  });
  // "ดูรายวันของ Uxx" — พาไปหน้า Sales ที่มีตาราง 📅 ยอดขายรายวัน (ตารางเดียวกับที่ทีมใช้ไล่วัน)
  container.querySelectorAll('.up-daily').forEach(function (b) {
    b.addEventListener('click', function () {
      App.switchView('sales');
    });
  });
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
