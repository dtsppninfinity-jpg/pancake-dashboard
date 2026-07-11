// lib/views/adminperf.ts — Admin Performance (Ranking + Overall Score ปรับเกณฑ์เองได้)
// port จาก JsAdminPerf.html (GAS) → TS ESM สำหรับ browser
//
// ใช้ apiAdminPerf({preset, from, to, channel}) — ดึงตัวเลขดิบต่อแอดมิน
// คะแนน Overall คิดฝั่ง client จาก scoreConfig (ปรับน้ำหนัก/เป้าหมายได้ → เรียงใหม่ทันที)
// scoreConfig เก็บ/โหลดผ่าน apiScoreConfig (บันทึกบนเซิร์ฟเวอร์ ทุกคนเห็นเกณฑ์เดียวกัน)

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
  downloadCSV,
  type RangeState,
} from '@/lib/ui/helpers';
import {
  METRIC_BY_KEY,
  normalizeConfig,
  computeScore,
  type MetricConfig,
} from '@/lib/scoring';
import { adminperfSkel } from '@/lib/ui/skeletons';

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
  _score?: number | null;   // คำนวณฝั่ง client
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
  panelOpen: boolean;
}

let lastData: PerfData | null = null;
let reqSeq = 0;
let scoreConfig: MetricConfig[] = normalizeConfig(null);
let configLoaded = false;
const state: PerfState = { preset: 'today', from: '', to: '', channel: '', mode: 'overall', panelOpen: false };

const RANK_MODES = [
  { key: 'overall', label: '🏆 Overall' },
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

function scoreFmt(v: number | null | undefined): string {
  return (v === null || v === undefined || isNaN(Number(v))) ? '-' : Number(v).toFixed(1);
}

function scoreTier(v: number | null | undefined): string {
  if (v === null || v === undefined || isNaN(Number(v))) return 'na';
  if (v >= 80) return 'good';
  if (v >= 50) return 'mid';
  return 'low';
}

function scoreBadge(v: number | null | undefined): string {
  return '<span class="score-badge ' + scoreTier(v) + '">🏆 ' + scoreFmt(v) + '</span>';
}

function modeLabel(key: string): string {
  for (let i = 0; i < RANK_MODES.length; i++) {
    if (RANK_MODES[i].key === key) return RANK_MODES[i].label;
  }
  return key;
}

function modeValue(r: PerfRow): string {
  if (state.mode === 'overall') return scoreFmt(r._score) + ' คะแนน';
  if (state.mode === 'close') return pctFmt(r.closeRate);
  if (state.mode === 'speed') return hasResp(r) ? fmtNum(respRound(r.avgRespMins)) + ' นาที' : '-';
  return THB(r.revenue);
}

/* ---------- scoring ---------- */

/** คำนวณคะแนน Overall ใส่ลงทุกแถว (ตาม scoreConfig ปัจจุบัน) */
function scoreRows(rows: PerfRow[]): void {
  rows.forEach((r) => { r._score = computeScore(r, scoreConfig).score; });
}

function enabledWeightSum(): number {
  return scoreConfig.reduce((s, c) => s + (c.enabled ? (Number(c.weight) || 0) : 0), 0);
}

/* ---------- sorting (client-side ตาม rank mode) ---------- */

function hasClose(r: PerfRow): boolean {
  return r.closeRate !== null && r.closeRate !== undefined && !isNaN(r.closeRate);
}

/** เข้าเกณฑ์จัดอันดับใน mode นี้ไหม — ไม่เข้าเกณฑ์ = ไปท้ายลิสต์ */
function eligible(r: PerfRow, mode: string): boolean {
  if (mode === 'overall') return r._score !== null && r._score !== undefined;
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
      if (mode === 'overall' && b._score !== a._score) {
        return (b._score as number) - (a._score as number); // มาก → น้อย
      }
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

/* ---------- HTML: controls ---------- */

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
      '<button class="btn' + (state.panelOpen ? ' primary' : '') + '" id="rk-toggle">⚙️ เกณฑ์การให้คะแนน</button>' +
      '<span class="chip">' + esc((data && data.rangeLabel) || '') + '</span>' +
    '</div>';
}

/* ---------- HTML: แผงปรับเกณฑ์ ---------- */

function panelRowHtml(c: MetricConfig): string {
  const m = METRIC_BY_KEY[c.key];
  const dirTxt = m.dir === 'low' ? '↓ ยิ่งน้อยยิ่งดี' : '↑ ยิ่งมากยิ่งดี';
  return '<div class="sp-row' + (c.enabled ? '' : ' off') + '" data-key="' + c.key + '">' +
    '<label class="sp-metric"><input type="checkbox" class="sp-en"' + (c.enabled ? ' checked' : '') + '>' +
      '<span>' + esc(m.label) + '</span></label>' +
    '<div class="sp-field">น้ำหนัก <input type="number" min="0" step="1" class="input sp-num sp-weight" value="' + c.weight + '"><span class="sp-u">%</span></div>' +
    '<div class="sp-field">เป้าหมาย <input type="number" min="0" class="input sp-num sp-target" value="' + c.target + '"><span class="sp-u">' + esc(m.unit) + '</span></div>' +
    '<div class="sp-dir">' + dirTxt + '</div>' +
    '</div>';
}

function panelHtml(): string {
  const rows = scoreConfig.map(panelRowHtml).join('');
  return '<div class="score-panel' + (state.panelOpen ? '' : ' collapsed') + '" id="rk-panel">' +
      '<div class="sp-hint">ปรับ <b>น้ำหนัก (%)</b> และ <b>เป้าหมาย</b> ของแต่ละตัวชี้วัดได้เอง — คะแนน Overall = ผลรวมถ่วงน้ำหนัก ' +
        '(ได้ครบ 100 คะแนนของตัวนั้นเมื่อถึงเป้า) • คนที่ไม่มีข้อมูลตัวไหนจะไม่ถูกคิดตัวนั้น • กด "บันทึกเกณฑ์" เพื่อให้ทุกคนใช้เกณฑ์เดียวกัน</div>' +
      '<div class="sp-list">' + rows + '</div>' +
      '<div class="sp-foot">' +
        '<span class="chip">รวมน้ำหนักที่เปิด <b id="rk-wsum">' + enabledWeightSum() + '</b>%</span>' +
        '<div class="spacer" style="flex:1"></div>' +
        '<button class="btn" id="rk-reset">↺ รีเซ็ตค่าเริ่มต้น</button>' +
        '<button class="btn primary" id="rk-save">💾 บันทึกเกณฑ์</button>' +
      '</div>' +
    '</div>';
}

/* ---------- HTML: podium + rank cards ---------- */

function podiumCard(r: PerfRow | null, rank: number): string {
  if (!r) return '<div></div>';
  const cls = (rank === 1) ? 'gold first' : ((rank === 2) ? 'silver' : 'bronze');
  return '<div class="top3-card ' + cls + '">' +
    '<div class="medal">' + MEDALS[rank - 1] + '</div>' +
    avatarHtml(r.id, r.name, r.online) +
    '<div class="nm">' + esc(r.name) + '</div>' +
    '<div class="val">' + esc(modeValue(r)) + '</div>' +
    '<div>' + scoreBadge(r._score) + '</div>' +
    '<div class="sub">🛒 ' + esc(fmtNum(r.orders)) + ' • 🎯 ' + esc(pctFmt(r.closeRate)) +
      ' • ⚡ ' + esc(respShort(r)) + '</div>' +
    '</div>';
}

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
  // โหมด Overall โชว์คะแนนเป็นตัวใหญ่ + ยอดขายเป็นตัวรอง; โหมดอื่นโชว์ยอดขายเป็นตัวใหญ่
  const big = (state.mode === 'overall')
    ? '<div class="rank-big">' + esc(scoreFmt(r._score)) + '<span class="rank-big-u"> คะแนน</span></div>'
    : '<div class="rank-big">' + esc(THB(r.revenue)) + '</div>';
  const mini = (state.mode === 'overall' ? '💰 ' + esc(THB(r.revenue)) + ' • ' : '') +
    '🎯 ' + esc(pctFmt(r.closeRate)) + ' • ⚡ ' + esc(respLong(r)) +
    (state.mode === 'overall' ? '' : ' • เฉลี่ย ' + esc(THB(r.avgOrder)));
  return '<div class="' + cardCls + '">' +
    noHtml +
    avatarHtml(r.id, r.name, r.online, 'sm') +
    '<div class="rank-mid">' +
      '<div class="rank-name">' + esc(r.name) + ' ' + badge + ' ' + scoreBadge(r._score) + '</div>' +
      '<div class="rank-sub">' + sub1 + '</div>' +
      '<div class="rank-sub">' + sub2 + '</div>' +
    '</div>' +
    '<div class="rank-right">' +
      big +
      '<div class="rank-mini">' + mini + '</div>' +
    '</div>' +
    '</div>';
}

/** ส่วนอันดับ (podium + list) — recompute ได้เร็วโดยไม่แตะแผงเกณฑ์ */
function rankingHtml(data: PerfData | null): string {
  const rows = (data && data.rows) ? data.rows : [];
  if (!rows.length) return '<div class="empty-note">🏆 ยังไม่มีข้อมูลในช่วง/ตัวกรองนี้</div>';
  scoreRows(rows);
  const sorted = sortRows(rows, state.mode);
  return podiumHtml(sorted) +
    '<div class="rank-list">' + sorted.map(function (r, i) { return rankCardHtml(r, i); }).join('') + '</div>';
}

/* ---------- render + events ---------- */

function render(container: HTMLElement, data: PerfData | null): void {
  container.innerHTML =
    controlsHtml(data) +
    panelHtml() +
    '<div id="rk-ranking">' + rankingHtml(data) + '</div>';
  bindEvents(container);
}

/** อัปเดตเฉพาะส่วนอันดับ — ไม่แตะแผงเกณฑ์ (กัน focus ในช่องกรอกหลุดตอนพิมพ์) */
function updateRanking(container: HTMLElement): void {
  const box = container.querySelector('#rk-ranking');
  if (box) box.innerHTML = rankingHtml(lastData);
}

function refreshWsum(container: HTMLElement): void {
  const el = container.querySelector('#rk-wsum');
  if (el) el.textContent = String(enabledWeightSum());
}

function bindEvents(container: HTMLElement): void {
  // range preset / custom dates — param ฝั่ง server → fetch ใหม่
  bindRangeControls(container, state, 'rk', function () { refetch(container); });

  // channel — param ฝั่ง server → fetch ใหม่
  const chSel = container.querySelector('#rk-channel') as HTMLSelectElement | null;
  if (chSel) {
    chSel.addEventListener('change', function () {
      state.channel = chSel.value;
      refetch(container);
    });
  }

  // rank mode — เรียงฝั่ง client → อัปเดตเฉพาะอันดับ
  container.querySelectorAll('[data-rkmode]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.mode = btn.getAttribute('data-rkmode') || '';
      container.querySelectorAll('[data-rkmode]').forEach(function (b) {
        b.classList.toggle('primary', b.getAttribute('data-rkmode') === state.mode);
      });
      if (lastData) updateRanking(container);
    });
  });

  // toggle แผงเกณฑ์
  const tg = container.querySelector('#rk-toggle');
  if (tg) {
    tg.addEventListener('click', function () {
      state.panelOpen = !state.panelOpen;
      const panel = container.querySelector('#rk-panel');
      if (panel) panel.classList.toggle('collapsed', !state.panelOpen);
      tg.classList.toggle('primary', state.panelOpen);
    });
  }

  // ช่องกรอกในแผงเกณฑ์ — แก้แล้วอัปเดตอันดับทันที (ไม่แตะแผง → focus ไม่หลุด)
  container.querySelectorAll('#rk-panel .sp-row').forEach(function (rowEl) {
    const key = rowEl.getAttribute('data-key');
    const c = scoreConfig.find(function (x) { return x.key === key; });
    if (!c) return;
    const en = rowEl.querySelector('.sp-en') as HTMLInputElement | null;
    const w = rowEl.querySelector('.sp-weight') as HTMLInputElement | null;
    const t = rowEl.querySelector('.sp-target') as HTMLInputElement | null;
    if (en) en.addEventListener('change', function () {
      c.enabled = en.checked;
      rowEl.classList.toggle('off', !en.checked);
      refreshWsum(container);
      updateRanking(container);
    });
    if (w) w.addEventListener('input', function () {
      const n = Number(w.value);
      c.weight = (isFinite(n) && n >= 0) ? n : 0;
      refreshWsum(container);
      updateRanking(container);
    });
    if (t) t.addEventListener('input', function () {
      const n = Number(t.value);
      c.target = (isFinite(n) && n >= 0) ? n : 0;
      updateRanking(container);
    });
  });

  // บันทึกเกณฑ์ (เก็บบนเซิร์ฟเวอร์)
  const saveBtn = container.querySelector('#rk-save');
  if (saveBtn) saveBtn.addEventListener('click', function () {
    serverCall('apiScoreConfig', { config: scoreConfig })
      .then(function () { toast('💾 บันทึกเกณฑ์แล้ว — ทุกคนจะเห็นเกณฑ์นี้'); })
      .catch(function () { toast('⚠️ บันทึกเกณฑ์ไม่สำเร็จ'); });
  });

  // รีเซ็ตค่าเริ่มต้น
  const resetBtn = container.querySelector('#rk-reset');
  if (resetBtn) resetBtn.addEventListener('click', function () {
    scoreConfig = normalizeConfig(null);
    state.panelOpen = true;
    render(container, lastData);
    toast('↺ กลับไปใช้ค่าเริ่มต้นแล้ว (ยังไม่บันทึก)');
  });

  // export CSV
  const csvBtn = container.querySelector('#rk-csv');
  if (csvBtn) csvBtn.addEventListener('click', exportCSV);
}

function exportCSV(): void {
  if (!lastData || !lastData.rows || !lastData.rows.length) {
    toast('ยังไม่มีข้อมูลให้ Export');
    return;
  }
  scoreRows(lastData.rows);
  const sorted = sortRows(lastData.rows, state.mode);
  const out: (string | number)[][] = [
    ['Admin Performance Ranking'],
    ['ช่วงเวลา: ' + (lastData.rangeLabel || '-') + ' • โหมดจัดอันดับ: ' + modeLabel(state.mode)],
    ['อันดับ', 'แอดมิน', 'สถานะ', 'Overall คะแนน', 'ยอดขาย', 'ออเดอร์', 'แชทที่ดูแล', 'ข้อความที่ตอบ',
      '% ปิดการขาย', 'ตอบเฉลี่ย(นาที)', 'เฉลี่ย/ออเดอร์', 'สินค้าขายดี', 'เพจยอดดีสุด'],
  ];
  sorted.forEach(function (r, i) {
    out.push([
      i + 1,
      r.name,
      r.online ? 'ออนไลน์' : 'ออฟไลน์',
      (r._score === null || r._score === undefined) ? '-' : r._score,
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
        container.innerHTML = adminperfSkel();
        fetchData(container, false);
      });
    }
  });
}

/** โหลด scoreConfig ที่บันทึกไว้ (ครั้งเดียว) */
async function loadConfig(): Promise<void> {
  try {
    const res = await serverCall<{ config: unknown }>('apiScoreConfig', {});
    scoreConfig = normalizeConfig(res && res.config);
  } catch (e) {
    scoreConfig = normalizeConfig(null);
  }
  configLoaded = true;
}

/** เรียกเมื่อ range/channel เปลี่ยน — ข้อมูลเดิมใช้ไม่ได้แล้ว */
function refetch(container: HTMLElement): void {
  lastData = null;
  container.innerHTML = adminperfSkel();
  fetchData(container, false);
}

/* ---------- register view ---------- */

export const adminperf = {
  load: async (container: HTMLElement, force?: boolean): Promise<void> => {
    if (!configLoaded) await loadConfig();     // ดึงเกณฑ์ที่บันทึกไว้ก่อน render
    if (lastData && !force) {
      render(container, lastData);              // แสดงจากแคชทันที
      fetchData(container, true);               // แล้วดึงข้อมูลใหม่เบื้องหลัง
    } else {
      container.innerHTML = adminperfSkel();
      fetchData(container, false);
    }
  },
};
