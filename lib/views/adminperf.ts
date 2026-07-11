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
import { hbarRows, svgHourlyLine, bindChartTips, hideChartTip } from '@/lib/ui/charts';
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
  productGroups?: string;
  activeNow?: number;   // แชทที่ดูแล (ถูกมอบหมาย) ตอนนี้ 24 ชม. — ไม่ขึ้นกับช่วงที่เลือก
  waitingNow?: number;  // แชทที่ลูกค้ารอตอบตอนนี้ (= แชทค้างตัวจริง)
  overSla?: number;     // แชทรอเกินเกณฑ์ SLA ตอนนี้ (proxy)
  _score?: number | null;   // คำนวณฝั่ง client
}

interface PerfData {
  rangeLabel: string;
  rows: PerfRow[];
  team?: { total?: number; online?: number; offline?: number; disabled?: number };
  newCustomers?: number;
  teamHourly?: number[];
  overSlaTotal?: number;
  slaMins?: number;
}

interface PerfState extends RangeState {
  preset: string;
  from: string;
  to: string;
  channel: string;
  group: string;
  mode: string;
  panelOpen: boolean;
}

let lastData: PerfData | null = null;
let reqSeq = 0;
let scoreConfig: MetricConfig[] = normalizeConfig(null);
let configLoaded = false;
const state: PerfState = { preset: 'today', from: '', to: '', channel: '', group: '', mode: 'overall', panelOpen: false };

/* ---------- filter กลุ่มสินค้า (จาก admin_settings — client-side) ---------- */

function rowGroups(r: PerfRow): string[] {
  return String(r.productGroups || '').split(',')
    .map(function (g) { return g.trim(); })
    .filter(function (g) { return !!g; });
}

function allGroups(data: PerfData | null): string[] {
  const seen: Record<string, boolean> = {};
  const out: string[] = [];
  ((data && data.rows) || []).forEach(function (r) {
    rowGroups(r).forEach(function (g) {
      if (!seen[g]) { seen[g] = true; out.push(g); }
    });
  });
  out.sort(function (a, b) { return a.localeCompare(b, 'th'); });
  return out;
}

/** แถวที่ผ่าน filter กลุ่มสินค้า — ใช้เป็น input ของ KPI/hbar/ranking/CSV ทุกจุด */
function visRows(data: PerfData | null): PerfRow[] {
  const rows = (data && data.rows) || [];
  if (!state.group) return rows;
  return rows.filter(function (r) { return rowGroups(r).indexOf(state.group) >= 0; });
}

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

function groupSelectHtml(data: PerfData | null): string {
  const groups = allGroups(data);
  if (!groups.length) return '';
  if (state.group && groups.indexOf(state.group) < 0) state.group = '';
  return '<select class="input" id="rk-group">' +
    '<option value=""' + (state.group === '' ? ' selected' : '') + '>ทุกกลุ่มสินค้า</option>' +
    groups.map(function (g) {
      return '<option value="' + esc(g) + '"' + (state.group === g ? ' selected' : '') + '>📦 ' +
        esc(g) + '</option>';
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
      groupSelectHtml(data) +
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

/* ---------- HTML: KPI ทีมรวม + เปรียบเทียบตอบ ---------- */

function pgsItem(val: string | number, label: string, cls: string): string {
  return '<div class="pgs-item' + (cls ? ' ' + cls : '') + '">' +
    '<b>' + val + '</b><span>' + esc(label) + '</span></div>';
}

function kpiStripHtml(data: PerfData | null): string {
  const rows = visRows(data);
  const team = (data && data.team) || {};
  const chatsSum = rows.reduce(function (s, r) { return s + (Number(r.chats) || 0); }, 0);
  const repliesSum = rows.reduce(function (s, r) { return s + (Number(r.replies) || 0); }, 0);
  // Response เฉลี่ยทีม (เฉพาะคนที่มีค่า)
  const resps = rows.filter(function (r) { return r.avgRespMins !== null && r.avgRespMins !== undefined; });
  const avgResp = resps.length
    ? Math.round(resps.reduce(function (s, r) { return s + Number(r.avgRespMins); }, 0) / resps.length * 10) / 10
    : null;
  // ตอบเร็วสุด — นับเฉพาะคนที่ตอบเยอะพอ (กันคนตอบ 2 ข้อความแล้วชนะ)
  let fastest: PerfRow | null = null;
  rows.forEach(function (r) {
    if ((Number(r.replies) || 0) < 20 || r.avgRespMins === null || r.avgRespMins === undefined) return;
    if (!fastest || Number(r.avgRespMins) < Number(fastest.avgRespMins)) fastest = r;
  });
  // TS ไม่ track การ assign ใน callback — ต้อง assert กลับเป็น PerfRow | null
  const f = fastest as PerfRow | null;
  const disabledN = Number(team.disabled) || 0;
  // แชทค้างมากสุด + เกิน SLA เป็นค่า "ตอนนี้" (24 ชม.) — โชว์เฉพาะ preset วันนี้ ไม่ให้ปนกับช่วงอื่น
  let nowItems = '';
  if (state.preset === 'today') {
    // "แชทค้าง" = ลูกค้ารอตอบ (waitingNow) — ไม่ใช่แชทที่ดูแลทั้งหมด (activeNow)
    let busiest: PerfRow | null = null;
    rows.forEach(function (r) {
      if (!busiest || (Number(r.waitingNow) || 0) > (Number(busiest.waitingNow) || 0)) busiest = r;
    });
    const b = busiest as PerfRow | null;
    const bN = b ? Number(b.waitingNow) || 0 : 0;
    const overSlaN = Number(data && data.overSlaTotal) || 0;
    const slaMins = Number(data && data.slaMins) || 60;
    nowItems =
      pgsItem(bN > 0 ? esc(String((b as PerfRow).name).slice(0, 10)) : '—',
        'แชทค้างรอตอบมากสุดตอนนี้' + (bN > 0 ? ' (' + fmtNum(bN) + ')' : ''), bN > 0 ? 'warn' : '') +
      // overSlaTotal เป็นยอดรวมทั้งทีม (ตาม filter ช่องทาง) — ไม่ตามตัวกรองกลุ่มสินค้า จึงติดป้ายให้ชัด
      pgsItem(fmtNum(overSlaN), 'เกิน SLA ' + slaMins + ' น. (ทั้งทีม)', overSlaN > 0 ? 'warn' : '');
  }
  return '<div class="pg-summary">' +
    pgsItem(fmtNum(team.total || 0), 'แอดมินทั้งหมด', '') +
    pgsItem(fmtNum(team.online || 0), 'ออนไลน์', 'ok') +
    pgsItem(fmtNum(team.offline || 0), 'ออฟไลน์', '') +
    pgsItem(fmtNum(disabledN), 'ปิดใช้งาน', disabledN > 0 ? 'warn' : '') +
    pgsItem(fmtNum(chatsSum), 'แชทในช่วงนี้', '') +
    pgsItem(fmtNum(repliesSum), 'ข้อความที่ตอบ', '') +
    pgsItem(avgResp === null ? '—' : avgResp + ' น.', 'Response เฉลี่ย', '') +
    pgsItem(f ? esc(String(f.name).slice(0, 10)) : '—',
      'ตอบเร็วสุด' + (f ? ' (' + f.avgRespMins + ' น.)' : ''), f ? 'ok' : '') +
    pgsItem(fmtNum((data && data.newCustomers) || 0), 'ลูกค้าใหม่ (ทีมรวม)', '') +
    nowItems +
  '</div>';
}

function replyCompareHtml(data: PerfData | null): string {
  const rows = visRows(data)
    .filter(function (r) { return (Number(r.replies) || 0) > 0; })
    .slice()
    .sort(function (a, b) { return (Number(b.replies) || 0) - (Number(a.replies) || 0); })
    .slice(0, 10)
    .map(function (r) { return { label: String(r.name || '-'), value: Number(r.replies) || 0 }; });
  if (!rows.length) return '';
  return '<div class="card">' +
    '<h3>📊 เปรียบเทียบข้อความที่ตอบ (Top 10)</h3>' +
    '<div class="card-sub">รวมตอบแชท + คอมเมนต์ ในช่วงเวลาที่เลือก</div>' +
    hbarRows(rows, { empty: 'ยังไม่มีข้อมูล' }) +
  '</div>';
}

function teamHourlyCardHtml(data: PerfData | null): string {
  const hourly = (data && data.teamHourly) || null;
  if (!hourly || !hourly.some(function (v) { return v > 0; })) return '';
  const chTxt = state.channel === 'facebook' ? 'เฉพาะ 📘 Facebook'
    : state.channel === 'line' ? 'เฉพาะ 🟢 LINE' : 'ทุกช่องทาง';
  return '<div class="card">' +
    '<h3>🕐 ปริมาณลูกค้าทักรายชั่วโมง (ทีมรวม)</h3>' +
    '<div class="card-sub">' + esc((data && data.rangeLabel) || '') +
      ' — ข้อความลูกค้าทัก (' + chTxt + ', ข้อมูลจริงจาก Pancake) • ชี้ที่จุดเพื่อดูราย ชม.</div>' +
    svgHourlyLine(hourly.map(function (v) { return Number(v) || 0; }), null, { fmt: 'num', unit: 'ข้อความ' }) +
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
  const slaBadge = (Number(r.overSla) || 0) > 0
    ? ' <span class="badge urgent" title="แชทที่ลูกค้ารอเกินเกณฑ์ SLA ตอนนี้ (ไม่ขึ้นกับช่วงเวลาที่เลือก)">⏰ ' +
      esc(fmtNum(Number(r.overSla))) + '</span>'
    : '';
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
      '<div class="rank-name">' + esc(r.name) + ' ' + badge + ' ' + scoreBadge(r._score) + slaBadge + '</div>' +
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
  const rows = visRows(data);
  if (!rows.length) return '<div class="empty-note">🏆 ยังไม่มีข้อมูลในช่วง/ตัวกรองนี้</div>';
  scoreRows(rows);
  const sorted = sortRows(rows, state.mode);
  return podiumHtml(sorted) +
    '<div class="rank-list">' + sorted.map(function (r, i) { return rankCardHtml(r, i); }).join('') + '</div>';
}

/* ---------- render + events ---------- */

function render(container: HTMLElement, data: PerfData | null): void {
  // reset filter กลุ่มสินค้าที่หายไปจากข้อมูลชุดใหม่ "ก่อน" คำนวณการ์ดทุกใบ
  // (เดิม reset อยู่ใน groupSelectHtml ซึ่งถูกเรียกทีหลัง — การ์ดบนใช้ filter ผีไปหนึ่งรอบ)
  if (state.group && allGroups(data).indexOf(state.group) < 0) state.group = '';
  // dash-row: hbar เปรียบเทียบ + กราฟลูกค้าทักรายชั่วโมง วางคู่กัน (เรียงเดี่ยวเมื่อจอแคบ)
  const reply = replyCompareHtml(data);
  const hourly = teamHourlyCardHtml(data);
  const dashRow = (reply || hourly)
    ? '<div class="perf-row">' + reply + hourly + '</div>'
    : '';
  container.innerHTML =
    controlsHtml(data) +
    kpiStripHtml(data) +
    panelHtml() +
    dashRow +
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

  // กลุ่มสินค้า — filter ฝั่ง client → วาดใหม่ทั้งหน้า (KPI/hbar/ranking เปลี่ยนหมด)
  const grSel = container.querySelector('#rk-group') as HTMLSelectElement | null;
  if (grSel) {
    grSel.addEventListener('change', function () {
      state.group = grSel.value;
      render(container, lastData);
    });
  }

  bindChartTips(container); // ทูลทิป hover ของกราฟลูกค้าทักรายชั่วโมง

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
  const rows = visRows(lastData);
  if (!rows.length) {
    toast('ยังไม่มีข้อมูลให้ Export');
    return;
  }
  scoreRows(rows);
  const sorted = sortRows(rows, state.mode);
  const out: (string | number)[][] = [
    ['Admin Performance Ranking'],
    ['ช่วงเวลา: ' + (lastData!.rangeLabel || '-') + ' • โหมดจัดอันดับ: ' + modeLabel(state.mode) +
      (state.group ? ' • กลุ่มสินค้า: ' + state.group : '')],
    ['อันดับ', 'แอดมิน', 'สถานะ', 'Overall คะแนน', 'ยอดขาย', 'ออเดอร์', 'แชทที่ดูแล', 'ข้อความที่ตอบ',
      '% ปิดการขาย', 'ตอบเฉลี่ย(นาที)', 'เฉลี่ย/ออเดอร์', 'สินค้าขายดี', 'เพจยอดดีสุด',
      'กลุ่มสินค้า', 'แชทที่ดูแลตอนนี้(24ชม.)', 'แชทรอตอบตอนนี้', 'เกิน SLA ตอนนี้'],
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
      r.productGroups || '',
      Number(r.activeNow) || 0,
      Number(r.waitingNow) || 0,
      Number(r.overSla) || 0,
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
      hideChartTip(); // กราฟถูกแทนด้วยกล่อง error — ซ่อนทูลทิปที่อาจค้าง
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
  hideChartTip(); // กราฟถูกแทนด้วย skeleton — ซ่อนทูลทิปที่อาจค้าง (pointerleave ไม่ยิงเมื่อ node หาย)
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
