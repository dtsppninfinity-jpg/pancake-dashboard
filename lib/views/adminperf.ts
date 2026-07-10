// lib/views/adminperf.ts — Admin Performance (Ranking ยอดขาย • Top 3 🥇🥈🥉)
// port จาก JsAdminPerf.html (GAS) → TS ESM สำหรับ browser
// HTML string / ชื่อ class / ข้อความไทย / esc() / font-size / ตรรกะ render คงเดิมทุกตัวอักษร
//
// ใช้ apiAdminPerf({preset, from, to, channel}) — params ฝั่ง server
// rank mode (sales/close/speed) เรียงฝั่ง client จากข้อมูลแคช

import {
  serverCall,
  esc,
  fmtNum,
  THB,
  pctFmt,
  relTime,
  avatarHtml,
  rangeControlsHtml,
  bindRangeControls,
  toast,
  showError,
  showLoading,
  downloadCSV,
  type RangeState,
} from '@/lib/ui/helpers';

/* ---------- types ---------- */

interface PerfRow {
  id: string | number;
  name: string;
  online: boolean;
  revenue: number;
  orders: number;
  chats: number;
  replies: number;
  phones: number;
  closeRate: number | null;
  avgRespMins: number | null;
  avgOrder: number;
  topProduct: string;
  topPage: string;
  lastOrderAt: string;
}

interface PerfData {
  rangeLabel: string;
  rows: PerfRow[];
}

interface PerfState extends RangeState {
  preset: string;
  from: string;
  to: string;
  channel: string;
  mode: string;
}

let lastData: PerfData | null = null;
let reqSeq = 0;
const state: PerfState = { preset: 'today', from: '', to: '', channel: '', mode: 'sales' };

const RANK_MODES = [
  { key: 'sales', label: '💰 ยอดขายดีที่สุด' },
  { key: 'close', label: '🎯 % ปิดการขายดีที่สุด' },
  { key: 'speed', label: '⚡ ตอบเร็วที่สุด' },
];

const MEDALS = ['🥇', '🥈', '🥉'];

/* ---------- formatting ---------- */

function respRound(v: number | null | undefined): number {
  return Math.round(Number(v) * 10) / 10;
}

function hasResp(r: PerfRow): boolean {
  return r.avgRespMins !== null && r.avgRespMins !== undefined && !isNaN(r.avgRespMins);
}

function respShort(r: PerfRow): string { // '3.5น.' | '-'
  return hasResp(r) ? fmtNum(respRound(r.avgRespMins)) + 'น.' : '-';
}

function respLong(r: PerfRow): string { // '3.5 น.' | '-'
  return hasResp(r) ? fmtNum(respRound(r.avgRespMins)) + ' น.' : '-';
}

function modeLabel(key: string): string {
  for (let i = 0; i < RANK_MODES.length; i++) {
    if (RANK_MODES[i].key === key) return RANK_MODES[i].label;
  }
  return key;
}

function modeValue(r: PerfRow): string {
  if (state.mode === 'close') return pctFmt(r.closeRate);
  if (state.mode === 'speed') return hasResp(r) ? fmtNum(respRound(r.avgRespMins)) + ' นาที' : '-';
  return THB(r.revenue);
}

/* ---------- sorting (client-side ตาม rank mode) ---------- */

function hasClose(r: PerfRow): boolean {
  return r.closeRate !== null && r.closeRate !== undefined && !isNaN(r.closeRate);
}

/** เข้าเกณฑ์จัดอันดับใน mode นี้ไหม — ไม่เข้าเกณฑ์ = ไปท้ายลิสต์ */
function eligible(r: PerfRow, mode: string): boolean {
  if (mode === 'close') return (Number(r.orders) || 0) > 0 && hasClose(r);
  if (mode === 'speed') return (Number(r.replies) || 0) > 0 && hasResp(r);
  return true;
}

function sortRows(rows: PerfRow[], mode: string): PerfRow[] {
  const arr = rows.slice();
  arr.sort(function (a, b) {
    const ea = eligible(a, mode) ? 1 : 0;
    const eb = eligible(b, mode) ? 1 : 0;
    if (ea !== eb) return eb - ea; // คนที่เข้าเกณฑ์มาก่อน
    if (ea === 1) {
      if (mode === 'close' && b.closeRate !== a.closeRate) {
        return (b.closeRate as number) - (a.closeRate as number); // มาก → น้อย
      }
      if (mode === 'speed' && a.avgRespMins !== b.avgRespMins) {
        return (a.avgRespMins as number) - (b.avgRespMins as number); // เร็ว (น้อย) → ช้า
      }
    }
    return (Number(b.revenue) || 0) - (Number(a.revenue) || 0); // default / tiebreak
  });
  return arr;
}

/* ---------- HTML builders ---------- */

function channelSelectHtml(): string {
  const opts = [
    { v: '', t: 'ทุกช่องทาง' },
    { v: 'facebook', t: '📘 Facebook' },
    { v: 'line', t: '🟢 LINE' },
  ];
  return '<select class="input" id="rk-channel">' + opts.map(function (o) {
    return '<option value="' + o.v + '"' + (state.channel === o.v ? ' selected' : '') + '>' +
      o.t + '</option>';
  }).join('') + '</select>';
}

function controlsHtml(data: PerfData | null): string {
  const modeBtns = RANK_MODES.map(function (m) {
    return '<button class="btn-mini' + (state.mode === m.key ? ' primary' : '') +
      '" data-rkmode="' + m.key + '">' + m.label + '</button>';
  }).join('');
  return '<div class="pg-controls">' +
      rangeControlsHtml(state, 'rk') +
      channelSelectHtml() +
      '<div class="spacer"></div>' +
      '<button class="btn" id="rk-csv">📄 CSV</button>' +
    '</div>' +
    '<div class="pg-controls">' +
      modeBtns +
      '<div class="spacer"></div>' +
      '<span class="chip">' + esc((data && data.rangeLabel) || '') + '</span>' +
    '</div>';
}

/** การ์ด podium 1 ใบ — r = แถวข้อมูล, rank = 1|2|3; r ว่าง = ช่องว่าง */
function podiumCard(r: PerfRow | null, rank: number): string {
  if (!r) return '<div></div>';
  const cls = (rank === 1) ? 'gold first' : ((rank === 2) ? 'silver' : 'bronze');
  return '<div class="top3-card ' + cls + '">' +
    '<div class="medal">' + MEDALS[rank - 1] + '</div>' +
    avatarHtml(r.id, r.name, r.online) +
    '<div class="nm">' + esc(r.name) + '</div>' +
    '<div class="val">' + esc(modeValue(r)) + '</div>' +
    '<div class="sub">🛒 ' + esc(fmtNum(r.orders)) + ' • 🎯 ' + esc(pctFmt(r.closeRate)) +
      ' • ⚡ ' + esc(respShort(r)) + '</div>' +
    '</div>';
}

/** podium 3 อันดับแรก — ลำดับ render: อันดับ2 (เงิน) | อันดับ1 (ทอง กลาง) | อันดับ3 (ทองแดง) */
function podiumHtml(sorted: PerfRow[]): string {
  const pod: PerfRow[] = [];
  for (let i = 0; i < sorted.length && pod.length < 3; i++) {
    if (eligible(sorted[i], state.mode)) pod.push(sorted[i]);
  }
  if (!pod.length) return '';
  return '<div class="top3-grid">' +
    podiumCard(pod[1] || null, 2) +
    podiumCard(pod[0] || null, 1) +
    podiumCard(pod[2] || null, 3) +
    '</div>';
}

function rankCardHtml(r: PerfRow, idx: number): string {
  const pos = idx + 1;
  const cardCls = 'rank-card' + (pos <= 3 ? ' top' + pos : '');
  const noHtml = (pos <= 3)
    ? '<div class="rank-no medal">' + MEDALS[pos - 1] + '</div>'
    : '<div class="rank-no">' + pos + '</div>';
  const badge = r.online
    ? '<span class="badge ai">🟢 ออนไลน์</span>'
    : '<span class="badge neutral">⚪ ออฟไลน์</span>';
  const sub1 = '🛒 ' + esc(fmtNum(r.orders)) + ' ออเดอร์ • 💬 ' + esc(fmtNum(r.chats)) +
    ' แชท • ↩ ' + esc(fmtNum(r.replies)) + ' ตอบ • 📞 ' + esc(fmtNum(r.phones)) + ' เบอร์';
  const sub2 = '📦 ' + esc(r.topProduct || '-') + ' • 📄 ' + esc(r.topPage || '-') +
    (r.lastOrderAt ? ' • ออเดอร์ล่าสุด ' + esc(relTime(r.lastOrderAt)) : '');
  const mini = '🎯 ' + esc(pctFmt(r.closeRate)) + ' • ⚡ ' + esc(respLong(r)) +
    ' • เฉลี่ย ' + esc(THB(r.avgOrder));
  return '<div class="' + cardCls + '">' +
    noHtml +
    avatarHtml(r.id, r.name, r.online, 'sm') +
    '<div class="rank-mid">' +
      '<div class="rank-name">' + esc(r.name) + ' ' + badge + '</div>' +
      '<div class="rank-sub">' + sub1 + '</div>' +
      '<div class="rank-sub">' + sub2 + '</div>' +
    '</div>' +
    '<div class="rank-right">' +
      '<div class="rank-big">' + esc(THB(r.revenue)) + '</div>' +
      '<div class="rank-mini">' + mini + '</div>' +
    '</div>' +
    '</div>';
}

/* ---------- render + events ---------- */

function render(container: HTMLElement, data: PerfData | null): void {
  const rows = (data && data.rows) ? data.rows : [];
  let html = controlsHtml(data);

  if (!rows.length) {
    html += '<div class="empty-note">🏆 ยังไม่มีข้อมูลในช่วง/ตัวกรองนี้</div>';
  } else {
    const sorted = sortRows(rows, state.mode);
    html += podiumHtml(sorted);
    html += '<div class="rank-list">' +
      sorted.map(function (r, i) { return rankCardHtml(r, i); }).join('') +
      '</div>';
  }

  container.innerHTML = html;
  bindEvents(container);
}

function bindEvents(container: HTMLElement): void {
  // range preset / custom dates — param ฝั่ง server → fetch ใหม่
  bindRangeControls(container, state, 'rk', function () {
    refetch(container);
  });

  // channel — param ฝั่ง server → fetch ใหม่
  const chSel = container.querySelector('#rk-channel') as HTMLSelectElement | null;
  if (chSel) {
    chSel.addEventListener('change', function () {
      state.channel = chSel.value;
      refetch(container);
    });
  }

  // rank mode — เรียงฝั่ง client → render จากแคชทันที
  container.querySelectorAll('[data-rkmode]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.mode = btn.getAttribute('data-rkmode') || '';
      if (lastData) render(container, lastData);
    });
  });

  // export CSV
  const csvBtn = container.querySelector('#rk-csv');
  if (csvBtn) {
    csvBtn.addEventListener('click', exportCSV);
  }
}

function exportCSV(): void {
  if (!lastData || !lastData.rows || !lastData.rows.length) {
    toast('ยังไม่มีข้อมูลให้ Export');
    return;
  }
  const sorted = sortRows(lastData.rows, state.mode);
  const out: (string | number)[][] = [
    ['Admin Performance Ranking'],
    ['ช่วงเวลา: ' + (lastData.rangeLabel || '-') + ' • โหมดจัดอันดับ: ' + modeLabel(state.mode)],
    ['อันดับ', 'แอดมิน', 'สถานะ', 'ยอดขาย', 'ออเดอร์', 'แชทที่ดูแล', 'ข้อความที่ตอบ',
      '% ปิดการขาย', 'ตอบเฉลี่ย(นาที)', 'เฉลี่ย/ออเดอร์', 'สินค้าขายดี', 'เพจยอดดีสุด'],
  ];
  sorted.forEach(function (r, i) {
    out.push([
      i + 1,
      r.name,
      r.online ? 'ออนไลน์' : 'ออฟไลน์',
      Math.round(Number(r.revenue) || 0),
      Number(r.orders) || 0,
      Number(r.chats) || 0,
      Number(r.replies) || 0,
      hasClose(r) ? respRound(r.closeRate) : '-',
      hasResp(r) ? respRound(r.avgRespMins) : '-',
      Math.round(Number(r.avgOrder) || 0),
      r.topProduct || '-',
      r.topPage || '-',
    ]);
  });
  downloadCSV(out, 'admin-ranking');
}

/* ---------- data loading ---------- */

function fetchData(container: HTMLElement, background: boolean): void {
  const seq = ++reqSeq;
  serverCall<PerfData>('apiAdminPerf', {
    preset: state.preset,
    from: state.from,
    to: state.to,
    channel: state.channel,
  }).then(function (data) {
    if (seq !== reqSeq) return; // มี request ใหม่กว่าแล้ว — ทิ้งผลนี้
    lastData = data;
    render(container, data);
  }).catch(function (err) {
    if (seq !== reqSeq) return;
    if (background) {
      toast('⚠️ โหลดข้อมูล Ranking ใหม่ไม่สำเร็จ');
    } else {
      showError(container, (err && err.message) || 'เรียกข้อมูลไม่สำเร็จ', function () {
        showLoading(container);
        fetchData(container, false);
      });
    }
  });
}

/** เรียกเมื่อ range/channel เปลี่ยน — ข้อมูลเดิมใช้ไม่ได้แล้ว */
function refetch(container: HTMLElement): void {
  lastData = null;
  showLoading(container);
  fetchData(container, false);
}

/* ---------- register view ---------- */

export const adminperf = {
  load: async (container: HTMLElement, force?: boolean): Promise<void> => {
    if (lastData && !force) {
      render(container, lastData);        // แสดงจากแคชทันที
      fetchData(container, true);         // แล้วดึงข้อมูลใหม่เบื้องหลัง
    } else {
      showLoading(container);
      fetchData(container, false);
    }
  },
};
