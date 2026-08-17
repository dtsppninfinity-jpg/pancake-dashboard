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
  openModal,
  closeModal,
  type RangeState,
} from '@/lib/ui/helpers';
import {
  METRIC_BY_KEY,
  normalizeConfig,
  computeScore,
  KPI_TARGET_METRICS,
  DEFAULT_KPI_TARGETS,
  normalizeKpiTargets,
  kpiProgress,
  DEFAULT_RANK_RULES,
  normalizeRankRules,
  type MetricConfig,
  type KpiTargets,
  type RankRules,
} from '@/lib/scoring';
import { hbarRows, svgHourlyLine, bindChartTips, hideChartTip } from '@/lib/ui/charts';
import { adminperfSkel } from '@/lib/ui/skeletons';

/* ---------- types ---------- */

interface PerfRow {
  id: string | number;
  name: string;
  nickname?: string;    // ชื่อเล่น (พิมพ์ทับใน Admin Management > เดาจากคำแรก) — ใช้เป็นชื่อหลักบนหน้านี้
  online: boolean;
  revenue: number;
  orders: number;
  chats: number;
  replies: number;
  phones: number;
  closeRate: number | null;
  newOrders?: number;   // ออเดอร์ที่มาจากแชทใหม่ (ตัวเศษของ %ปิด — ตัดออเดอร์จากแชทวันก่อนออกแล้ว)
  avgRespMins: number | null;
  avgOrder: number;     // "เปอร์บิล" = ยอดขาย ÷ ออเดอร์
  topProduct: string;
  topPage: string;
  lastOrderAt: string;
  productGroups?: string;
  units?: string[];     // ยูนิตที่คนนี้สังกัด — คนเดียวอยู่ได้หลายยูนิต
  unitsGuess?: boolean; // true = เดาจากเพจที่ขายได้ (ทีมยังไม่ได้จับคู่ใน U Map/ชีทค่าคอม)
  adRevenue?: number;   // ยอด POS ที่ผูก ad_id (เฉพาะแอดที่มีค่าแอดจริง)
  adSpend?: number;     // ค่าแอดที่ปันมาให้คนนี้ตามสัดส่วนยอดขายในแต่ละแอด
  roas?: number | null; // null = ไม่มียอดผูกแอดเลย (สาย LINE) → โชว์ "—" ห้ามเดา
  activeNow?: number;   // แชทที่ดูแล (ถูกมอบหมาย) ตอนนี้ 24 ชม. — ไม่ขึ้นกับช่วงที่เลือก
  waitingNow?: number;  // แชทที่ลูกค้ารอตอบตอนนี้ (= แชทค้างตัวจริง)
  waitingCommentNow?: number; // ในนั้นเป็นคอมเมนต์ใต้โพสต์กี่รายการ (ที่เหลือ = อินบ็อกซ์)
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
  waitingTotal?: number;        // แชทรอตอบตอนนี้ทั้งทีม (นับ conversation ไม่ซ้ำ)
  waitingCommentTotal?: number; // ในนั้นเป็นคอมเมนต์กี่รายการ
  slaMins?: number;
  kpiTargets?: KpiTargets;      // เป้าต่อคน/วัน (ตั้งจากหน้านี้ เก็บใน sync_state)
  adSetupNeeded?: boolean;      // ยังไม่มีตาราง ad_daily → ROAS คิดไม่ได้ทั้งกระดาน
}

interface PerfState extends RangeState {
  preset: string;
  from: string;
  to: string;
  channel: string;
  group: string;
  mode: string;
  panelOpen: boolean;
  kpiOpen: boolean;   // แผงตั้งเป้า KPI เปิดอยู่ไหม
  rankTab: 'top' | 'bottom';  // สลับหัวลิสต์: โพเดียมท็อป 3 / โซนเตือน ต่ำสุด 5 (สลับกันเพื่อไม่กินที่)
}

let lastData: PerfData | null = null;
let reqSeq = 0;
let scoreConfig: MetricConfig[] = normalizeConfig(null);
let rankRules: RankRules = { ...DEFAULT_RANK_RULES };   // เกณฑ์เข้าอันดับโหมด "เท่า" (โหลด/บันทึกคู่กับ scoreConfig)
let configLoaded = false;
let kpiTargets: KpiTargets = { ...DEFAULT_KPI_TARGETS }; // sync จาก data ทุกครั้งที่โหลดสำเร็จ
let lastFetchAt: number | null = null;                   // เวลาที่ได้ข้อมูลชุดล่าสุด (ไฟกระพริบ)
/* ---- auto-refresh (เฉพาะช่วง "วันนี้" — ช่วงอื่นข้อมูลปิดวันแล้ว ไม่ต้องดึงซ้ำ) ---- */
const AUTO_MS = 75000;                                   // 75 วิ — ถี่พอสำหรับ realtime แต่ไม่ถล่ม API
let autoOn = true;                                       // ผู้ใช้กดปิด/เปิดได้จากปุ่มบนหน้า
let autoTimer: ReturnType<typeof setInterval> | null = null;
const state: PerfState = { preset: 'today', from: '', to: '', channel: '', group: '', mode: 'roas', panelOpen: false, kpiOpen: false, rankTab: 'top' };

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
  // ทีมขอ 2026-08-10: อันดับหลักใช้ "เท่า" นำ แล้วค่อยดู %ปิด → เปอร์บิล → ตอบเร็ว
  { key: 'roas', label: '🔥 เท่า (ROAS)' },
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

/* ---------- ชื่อเล่น / เปอร์บิล / ROAS ---------- */

/** ชื่อที่ใช้เรียกบนหน้านี้ = ชื่อเล่น (ไม่มีก็ชื่อเต็ม) */
function nickOf(r: PerfRow): string {
  return String(r.nickname || r.name || '');
}

/** ชื่อเต็มที่ต่างจากชื่อเล่นเท่านั้น (ไม่งั้นซ้ำซ้อน) */
function fullNameSub(r: PerfRow): string {
  const full = String(r.name || '');
  return full && full !== nickOf(r) ? full : '';
}

/** ชื่อเล่นตัวหลัก + ชื่อเต็มตัวรอง (คลาส .rank-fullname) */
function nameHtml(r: PerfRow): string {
  const sub = fullNameSub(r);
  return esc(nickOf(r)) +
    (sub ? ' <span class="rank-fullname" title="ชื่อเต็มใน Pancake">' + esc(sub) + '</span>' : '');
}

const ROAS_NA_TIP = 'ยอดขายของคนนี้ไม่ได้มาจากแอด (ออเดอร์ไม่มี ad_id — มักเป็นสาย LINE) จึงคิด ROAS ไม่ได้';
const ROAS_TIP = 'ROAS รายคน = ยอดขายจากออเดอร์ที่ผูกแอด ÷ ค่าแอดที่ปันมาให้ ' +
  '(ค่าแอดของแต่ละแอดถูกหารตามสัดส่วนยอดขายของคนที่ขายในแอดนั้น) • ' +
  'ค่าแอดของแอดที่จ่ายเงินแล้วแต่ยังไม่มีออเดอร์ ถูกเฉลี่ยให้คนที่ขายในเพจเดียวกันด้วย ' +
  '(ตั้งแต่ 17 ส.ค. — เดิมค่าแอดก้อนนี้ 37-40% ไม่มีใครรับ ทำให้ ROAS ทุกคนสูงเกินจริง ~1.6 เท่า) • ' +
  'ในแอดเดียวกันทุกคนได้ ROAS เท่ากันโดยบังคับ — ความต่างจึงมาจาก "ไปอยู่แอดไหน" ไม่ใช่ "ใครปิดเก่งกว่า"';

/** '📣 ROAS 2.59x' หรือ '—' พร้อมเหตุผล (ห้ามเดาเมื่อไม่มียอดผูกแอด) */
function roasHtml(r: PerfRow): string {
  const v = r.roas;
  if (v === null || v === undefined || isNaN(Number(v))) {
    const setup = lastData && lastData.adSetupNeeded;
    return '<span title="' + esc(setup
      ? 'ยังไม่มีข้อมูลค่าแอด (ต้องรัน db/migrations/2026-07-23-ad-daily.sql แล้วรอ sync รอบถัดไป)'
      : ROAS_NA_TIP) + '">📣 ROAS —</span>';
  }
  const tip = ROAS_TIP + ' • ยอดจากแอด ' + THB(Number(r.adRevenue) || 0) +
    ' ÷ ค่าแอด ' + THB(Number(r.adSpend) || 0);
  return '<span title="' + esc(tip) + '">📣 ROAS ' + esc(String(Number(v).toFixed(2))) + 'x</span>';
}

/** เปอร์บิล = ยอดขาย ÷ ออเดอร์ (โชว์ทุกโหมด ไม่ใช่เฉพาะโหมดที่ไม่ใช่ Overall) */
/**
 * ค่า "เท่า" ที่ใช้จัดอันดับ — ปัดเป็น 2 ตำแหน่งเท่ากับที่โชว์บนจอ
 * (ถ้าเทียบค่าดิบ คนที่จอขึ้น 2.29x เท่ากันจะถูกตัดสินด้วยทศนิยมตำแหน่งที่ 3 ที่ไม่มีใครเห็น
 *  → เงื่อนไขที่ 2-4 จะไม่มีวันได้ทำงาน)
 */
function roasOf(r: PerfRow): number | null {
  const v = Number(r.roas);
  if (r.roas === null || r.roas === undefined || !isFinite(v)) return null;
  return Math.round(v * 100) / 100;
}

function roasTxt(r: PerfRow): string {
  const v = roasOf(r);
  return v === null ? '—' : v.toFixed(2);
}

/**
 * คำอธิบาย %ปิด — ต้องบอกด้วยว่าตัวเศษถูกตัดออเดอร์จากแชทเก่าออกแล้ว
 * ไม่งั้นทีมเอา "ออเดอร์" บนการ์ด (ทั้งหมด) ไปหารเองแล้วได้คนละเลข
 */
function closeRateTip(r: PerfRow): string {
  const all = Number(r.orders) || 0;
  const fresh = (r.newOrders === null || r.newOrders === undefined) ? all : Number(r.newOrders);
  const cut = Math.max(0, Math.round((all - fresh) * 10) / 10);
  return '%ปิดการขาย = ออเดอร์ที่มาจากแชทใหม่ ÷ คนทัก (อินบ็อกซ์ใหม่+ความคิดเห็น)' +
    ' • ออเดอร์ทั้งหมด ' + fmtNum(all) + ' ตัดที่มาจากแชทวันก่อนออก ' + fmtNum(cut) +
    ' เหลือเข้าสูตร ' + fmtNum(Math.round(fresh * 10) / 10) + ' ÷ ' + fmtNum(Number(r.chats) || 0) +
    ' • ตัดออกเพราะลูกค้าที่ทักไว้ตั้งแต่วันก่อนไม่ได้อยู่ในตัวหารของวันนี้ ' +
    '(ถ้าไม่ตัด เพจที่หยุดยิงแอดจะได้ %ปิดพุ่งเกินจริง)';
}

function perBillHtml(r: PerfRow): string {
  return '<span title="เปอร์บิล = ยอดขาย ÷ จำนวนออเดอร์ ในช่วงเวลาที่เลือก">🧾 เปอร์บิล ' +
    esc(THB(r.avgOrder)) + '</span>';
}

/* ---------- KPI realtime (เป้าต่อคน/วัน + แถบความคืบหน้า) ---------- */

/** เหลืออีกกี่นาทีจะหมดวัน (เวลาไทย) — เทียบความคืบหน้ากับเวลาที่เหลือจริง */
function minsLeftToday(): number {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date()).reduce(function (a: Record<string, string>, x) {
    a[x.type] = x.value;
    return a;
  }, {});
  const mins = Number(p.hour) * 60 + Number(p.minute);
  return Math.max(0, 1440 - mins);
}

function timeLeftTxt(): string {
  const m = minsLeftToday();
  const h = Math.floor(m / 60);
  return h >= 1 ? 'เหลือ ' + h + ' ชม.' : 'เหลือ ' + m + ' นาที';
}

/** เป้าใช้ได้เฉพาะ preset 'วันนี้' — เป้าเป็น "ต่อคน/ต่อวัน" เทียบกับช่วง 7/30 วันไม่ได้ */
function kpiActive(): boolean {
  return state.preset === 'today';
}

function progCls(pct: number | null): string {
  if (pct === null) return 'na';
  if (pct >= 100) return 'good';
  if (pct >= 60) return 'mid';
  return 'low';
}

// ใครมี "บทบาท" ด้านไหน — กติกาเดียวกับ computeScore (lib/scoring.ts) เพื่อไม่ให้แอดมินสายแชท
// ติดแถบยอดขาย 0% สีแดงทั้งที่ไม่ใช่หน้าที่เขา
function hasSalesRole(r: PerfRow): boolean {
  return (Number(r.orders) || 0) > 0 || (Number(r.revenue) || 0) > 0;
}

function hasChatRole(r: PerfRow): boolean {
  return (Number(r.chats) || 0) > 0 || (Number(r.replies) || 0) > 0;
}

/** แถบความคืบหน้ายอดขาย: "฿57,036 / ฿60,000 (95%)" + สีตามสถานะ */
function kpiBarHtml(r: PerfRow): string {
  const target = Number(kpiTargets.revenue) || 0;
  if (!kpiActive() || !(target > 0) || !hasSalesRole(r)) return '';
  const pct = kpiProgress(Number(r.revenue) || 0, target, 'high');
  const w = Math.max(0, Math.min(100, pct === null ? 0 : pct));
  const tip = 'เป้ายอดขายต่อคนต่อวัน ' + THB(target) + ' • ' + timeLeftTxt() +
    ' (ปรับเป้าได้ที่ปุ่ม 🎯 เป้า KPI ด้านบน)';
  return '<div class="kpi-bar ' + progCls(pct) + '" title="' + esc(tip) + '">' +
      '<div class="kpi-bar-track"><i style="width:' + w + '%"></i></div>' +
      '<div class="kpi-bar-txt">' + esc(THB(r.revenue)) + ' / ' + esc(THB(target)) +
        ' <b>(' + esc(pctFmt(pct)) + ')</b></div>' +
    '</div>';
}

/** บรรทัดเทียบเป้าอีก 3 ตัว (ออเดอร์ / %ปิด / ตอบเฉลี่ย) — สีบอกถึงเป้าหรือยัง */
function kpiChipsHtml(r: PerfRow): string {
  if (!kpiActive()) return '';
  const chips: string[] = [];
  KPI_TARGET_METRICS.forEach(function (m) {
    if (m.key === 'revenue') return; // ตัวนี้เป็นแถบใหญ่ไปแล้ว
    const target = Number(kpiTargets[m.key]) || 0;
    if (!(target > 0)) return;
    if (m.key === 'orders' && !hasSalesRole(r)) return; // สายแชทล้วน ไม่ต้องขึ้นเป้าออเดอร์
    if (m.key !== 'orders' && !hasChatRole(r)) return;  // ไม่มีข้อมูลแชท ก็ไม่มี %ปิด/เวลาตอบ
    const raw = m.key === 'orders' ? Number(r.orders) || 0
      : m.key === 'closeRate' ? r.closeRate
      : r.avgRespMins;
    const pct = kpiProgress(raw as number | null, target, m.dir);
    // หน่วยท้ายตัวเลขให้อ่านแบบคนไทยพูด: 'ออเดอร์' ไม่มีหน่วย, '%' ติดเลข, เวลาใช้ ' น.'
    const suffix = m.key === 'closeRate' ? '%' : (m.key === 'avgRespMins' ? ' น.' : '');
    const val = m.key === 'orders' ? fmtNum(Number(raw) || 0)
      : m.key === 'closeRate' ? pctFmt(raw as number | null)
      : respLong(r);
    const icon = m.key === 'orders' ? '🛒' : (m.key === 'closeRate' ? '🎯' : '⚡');
    chips.push('<span class="kpi-chip ' + progCls(pct) + '" title="' +
      esc('เป้า' + m.label + 'ต่อคน/วัน = ' + target + ' ' + m.unit +
        (m.dir === 'low' ? ' (ยิ่งน้อยยิ่งดี)' : '')) + '">' +
      icon + ' ' + esc(val) + ' / ' + esc(String(target) + suffix) + '</span>');
  });
  return chips.length ? '<div class="kpi-chips">' + chips.join('') + '</div>' : '';
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
  if (state.mode === 'roas') return roasTxt(r) + ' เท่า';
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
  if (mode === 'roas') {
    if (roasOf(r) === null) return false;           // ไม่มียอดผูกแอด = จัดอันดับด้วย "เท่า" ไม่ได้
    // ตัวหารเล็กเกินไป = ตัวเลขเท่าไม่น่าเชื่อถือ ไม่ใช่ผลงาน — ทีมตั้งขั้นต่ำเองได้ (0 = ไม่กัน)
    if ((Number(r.adSpend) || 0) < rankRules.minAdSpend) return false;
    if ((Number(r.orders) || 0) < rankRules.minOrders) return false;
    // ค่าแอดต้องสมเหตุกับยอด — เพจที่หยุดยิงแอดแล้วยอดยังมาจากลูกค้าเก่าจะได้เท่าสูงลอย
    // ทั้งที่วันนั้นแทบไม่ได้ลงเงิน (ของจริง 15 ส.ค.: ค่าแอด 11% ของยอด ได้ 6.74 เท่า = อันดับ 1)
    if (rankRules.minSpendPctOfRev > 0) {
      const rev = Number(r.revenue) || 0;
      if (rev > 0 && ((Number(r.adSpend) || 0) / rev) * 100 < rankRules.minSpendPctOfRev) return false;
    }
    return true;
  }
  return true;
}

/* ---- โหมด "🔥 เท่า" — 4 เงื่อนไขเรียงตามลำดับความสำคัญ (ทีมขอ 2026-08-10) ----
 * เท่า (ROAS) → %ปิด → เปอร์บิล → ตอบเร็ว
 * เป็นการเทียบ "ทีละชั้น" ไม่ใช่คะแนนถ่วงน้ำหนัก: เงื่อนไขถัดไปได้ทำงานเฉพาะตอนชั้นบนเสมอกัน
 * → รับประกันว่าคนอันดับ 1 คือคนที่ "เท่า" สูงสุดเสมอ ตามที่ทีมสั่ง
 * ทุกค่าปัดเท่าที่โชว์บนจอ เพื่อให้ลำดับที่เห็นอธิบายได้จากตัวเลขบนการ์ด
 */
const ROAS_ORDER: { get: (r: PerfRow) => number | null; dir: 'high' | 'low' }[] = [
  { get: roasOf, dir: 'high' },
  { get: (r) => (hasClose(r) ? Math.round(Number(r.closeRate) * 10) / 10 : null), dir: 'high' },
  { get: (r) => (isFinite(Number(r.avgOrder)) ? Math.round(Number(r.avgOrder)) : null), dir: 'high' },
  { get: (r) => (hasResp(r) && Number(r.avgRespMins) > 0 ? respRound(r.avgRespMins) : null), dir: 'low' },
];

function cmpRoas4(a: PerfRow, b: PerfRow): number {
  for (let i = 0; i < ROAS_ORDER.length; i++) {
    const c = ROAS_ORDER[i];
    const va = c.get(a);
    const vb = c.get(b);
    if (va === null && vb === null) continue;
    if (va === null) return 1;        // ไม่มีข้อมูลชั้นนี้ = ลงท้ายชั้นนี้ (ไม่ใช่ 0 คะแนน)
    if (vb === null) return -1;
    if (va !== vb) return c.dir === 'high' ? vb - va : va - vb;
  }
  return 0;
}

function sortRows(rows: PerfRow[], mode: string): PerfRow[] {
  const arr = rows.slice();
  arr.sort(function (a, b) {
    const ea = eligible(a, mode) ? 1 : 0;
    const eb = eligible(b, mode) ? 1 : 0;
    if (ea !== eb) return eb - ea; // คนที่เข้าเกณฑ์มาก่อน
    if (ea === 1) {
      if (mode === 'roas') {
        const c = cmpRoas4(a, b);
        if (c !== 0) return c;
      }
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

/** ไฟกระพริบ + เวลาอัปเดตล่าสุด (เห็นได้ทันทีว่าตัวเลขบนจอสดแค่ไหน) */
function liveChipHtml(): string {
  const t = lastFetchAt
    ? new Date(lastFetchAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })
    : '—';
  const on = autoOn && kpiActive();
  return '<span class="chip live-chip" title="' + esc(on
    ? 'อัปเดตอัตโนมัติทุก ' + Math.round(AUTO_MS / 1000) + ' วินาที (ข้ามรอบเมื่อเปิดหน้าต่างแก้ไข/สลับไปแท็บอื่น)'
    : 'ปิดอัปเดตอัตโนมัติอยู่ — กด ⏸️ เพื่อเปิด') + '">' +
    '<span class="live-dot' + (on ? ' on' : '') + '"></span>อัปเดต ' + esc(t) + '</span>';
}

/** แถบอธิบายลำดับเงื่อนไข + ด่านขั้นต่ำที่ใช้อยู่ — กดแล้วเปิดแผงไปแก้ได้เลย */
function roasHintText(): string {
  const floors: string[] = [];
  if (rankRules.minAdSpend > 0) floors.push('ค่าแอด ≥ ' + THB(rankRules.minAdSpend));
  if (rankRules.minOrders > 0) floors.push('ออเดอร์ ≥ ' + fmtNum(rankRules.minOrders));
  if (rankRules.minSpendPctOfRev > 0) floors.push('ค่าแอด ≥ ' + fmtNum(rankRules.minSpendPctOfRev) + '% ของยอด');
  return '1️⃣ เท่า → 2️⃣ %ปิด → 3️⃣ เปอร์บิล → 4️⃣ ตอบเร็ว' +
    (floors.length ? ' • ขั้นต่ำ ' + floors.join(' + ') : '');
}

function roasHintTip(): string {
  const gated = rankRules.minAdSpend > 0 || rankRules.minOrders > 0 || rankRules.minSpendPctOfRev > 0;
  return 'เทียบทีละชั้น: ดู "เท่า" ก่อนเสมอ — เท่ากัน (ปัด 2 ตำแหน่ง) ค่อยดู %ปิด → เปอร์บิล → ตอบเร็ว ตามลำดับ • ' +
    'อันดับ 1 คือคนที่เท่าสูงสุดเสมอ • คนที่ไม่มียอดผูกแอด (เช่นสาย LINE) จัดอันดับด้วยเท่าไม่ได้ ถูกต่อท้ายลิสต์' +
    (gated ? ' • คนที่ต่ำกว่าขั้นต่ำก็ต่อท้ายเหมือนกัน (กันเลขเท่าพุ่งเพราะค่าแอดนิดเดียว)' : '') +
    ' • กดเพื่อเปิดแผงแก้ขั้นต่ำ';
}

function roasHintChipHtml(): string {
  return '<span class="chip chip-btn" id="rk-roas-hint" title="' + esc(roasHintTip()) + '">' +
    esc(roasHintText()) + '</span>';
}

function controlsHtml(data: PerfData | null): string {
  const modeBtns = RANK_MODES.map(function (m) {
    return '<button class="btn-mini' + (state.mode === m.key ? ' primary' : '') +
      '" data-rkmode="' + m.key + '">' + m.label + '</button>';
  }).join('');
  // ปุ่มอัตโนมัติโชว์เฉพาะ preset 'วันนี้' — ช่วงอื่นเป็นข้อมูลปิดวันแล้ว ไม่ต้องรีเฟรช
  const autoBtn = kpiActive()
    ? '<button class="btn' + (autoOn ? ' primary' : '') + '" id="rk-auto" title="รีเฟรชอัตโนมัติทุก ' +
      Math.round(AUTO_MS / 1000) + ' วินาที (เฉพาะช่วง &quot;วันนี้&quot;)">' +
      (autoOn ? '⏸️ หยุดอัตโนมัติ' : '▶️ อัปเดตอัตโนมัติ') + '</button>'
    : '';
  return '<div class="pg-controls">' +
      rangeControlsHtml(state, 'rk') +
      channelSelectHtml() +
      groupSelectHtml(data) +
      '<div class="spacer"></div>' +
      (kpiActive() ? liveChipHtml() : '') +
      autoBtn +
      '<button class="btn" id="rk-csv">📄 CSV</button>' +
    '</div>' +
    '<div class="pg-controls">' +
      modeBtns +
      (state.mode === 'roas' ? roasHintChipHtml() : '') +
      '<div class="spacer"></div>' +
      '<button class="btn' + (state.kpiOpen ? ' primary' : '') + '" id="rk-kpi-toggle">🎯 เป้า KPI</button>' +
      '<button class="btn' + (state.panelOpen ? ' primary' : '') + '" id="rk-toggle">⚙️ เกณฑ์การให้คะแนน</button>' +
      '<span class="chip">' + esc((data && data.rangeLabel) || '') +
        (kpiActive() ? ' • ⏱️ ' + esc(timeLeftTxt()) : '') + '</span>' +
    '</div>';
}

/* ---------- HTML: แผงตั้งเป้า KPI ต่อคน/วัน ---------- */

function kpiPanelHtml(): string {
  const rows = KPI_TARGET_METRICS.map(function (m) {
    const dirTxt = m.dir === 'low' ? '↓ ยิ่งน้อยยิ่งดี' : '↑ ยิ่งมากยิ่งดี';
    return '<div class="sp-row" data-kpikey="' + m.key + '">' +
      '<label class="sp-metric"><span>' + esc(m.label) + '</span></label>' +
      '<div class="sp-field">เป้าต่อคน/วัน <input type="number" min="0" class="input sp-num kpi-target" value="' +
        esc(String(kpiTargets[m.key])) + '"><span class="sp-u">' + esc(m.unit) + '</span></div>' +
      '<div class="sp-dir">' + dirTxt + '</div>' +
      '</div>';
  }).join('');
  return '<div class="score-panel' + (state.kpiOpen ? '' : ' collapsed') + '" id="rk-kpi-panel">' +
      '<div class="sp-hint">ตั้ง <b>เป้าต่อคน/ต่อวัน</b> — แถบความคืบหน้าบนการ์ดแต่ละคนจะเทียบกับเป้านี้ ' +
        '(0 = ไม่ตั้งเป้าตัวนั้น ไม่ต้องโชว์) • ใช้เฉพาะช่วง "วันนี้" เพราะเป็นเป้ารายวัน • ' +
        'เก็บบนเซิร์ฟเวอร์ ทุกคนเห็นเป้าเดียวกัน • ตอนนี้' + esc(timeLeftTxt()) + 'ของวัน</div>' +
      '<div class="sp-list">' + rows + '</div>' +
      '<div class="sp-foot">' +
        '<div class="spacer" style="flex:1"></div>' +
        '<button class="btn" id="rk-kpi-reset">↺ ค่าเริ่มต้น</button>' +
        '<button class="btn primary" id="rk-kpi-save">💾 บันทึกเป้า</button>' +
      '</div>' +
    '</div>';
}

/* ---------- HTML: KPI ทีมรวม + เปรียบเทียบตอบ ---------- */

function pgsItem(val: string | number, label: string, cls: string, title?: string): string {
  return '<div class="pgs-item' + (cls ? ' ' + cls : '') + '"' +
    (title ? ' title="' + esc(title) + '"' : '') + '>' +
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
    // "แชทรอตอบ" นับเฉพาะอินบ็อกซ์ — บอสสั่งเอาคอมเมนต์ออก (2026-08-03) คอมเมนต์เหลือแค่ใน tooltip/CSV
    const inboxWaitOf = function (r: PerfRow): number {
      return Math.max(0, (Number(r.waitingNow) || 0) - (Number(r.waitingCommentNow) || 0));
    };
    rows.forEach(function (r) {
      if (!busiest || inboxWaitOf(r) > inboxWaitOf(busiest)) busiest = r;
    });
    const b = busiest as PerfRow | null;
    const bN = b ? inboxWaitOf(b) : 0;
    const overSlaN = Number(data && data.overSlaTotal) || 0;
    const slaMins = Number(data && data.slaMins) || 60;
    const waitN = Number(data && data.waitingTotal) || 0;
    const waitCmt = Number(data && data.waitingCommentTotal) || 0;
    nowItems =
      pgsItem(fmtNum(waitN - waitCmt),
        '⏰ แชทรอตอบ (อินบ็อกซ์)',
        waitN - waitCmt > 0 ? 'warn' : '',
        'อินบ็อกซ์ที่ลูกค้ารอตอบตอนนี้ (24 ชม.ล่าสุด) — ไม่รวมคอมเมนต์ใต้โพสต์ ' + fmtNum(waitCmt) +
          ' รายการ (แยกออกตามที่ทีมขอ)') +
      pgsItem(bN > 0 ? esc(nickOf(b as PerfRow).slice(0, 10)) : '—',
        'แชทค้างรอตอบมากสุดตอนนี้' + (bN > 0 ? ' (' + fmtNum(bN) + ')' : ''), bN > 0 ? 'warn' : '') +
      // overSlaTotal เป็นยอดรวมทั้งทีม (ตาม filter ช่องทาง) — ไม่ตามตัวกรองกลุ่มสินค้า จึงติดป้ายให้ชัด
      pgsItem(fmtNum(overSlaN), 'เกิน SLA ' + slaMins + ' น. (ทั้งทีม)', overSlaN > 0 ? 'warn' : '');
  }
  return '<div class="pg-summary">' +
    pgsItem(fmtNum(team.total || 0), 'แอดมินทั้งหมด', '') +
    pgsItem(fmtNum(team.online || 0), 'ออนไลน์', 'ok') +
    pgsItem(fmtNum(team.offline || 0), 'ออฟไลน์', '') +
    pgsItem(fmtNum(disabledN), 'ปิดใช้งาน', disabledN > 0 ? 'warn' : '') +
    pgsItem(fmtNum(chatsSum), 'คนทักในช่วงนี้', '') +
    pgsItem(fmtNum(repliesSum), 'ข้อความที่ตอบ', '') +
    pgsItem(avgResp === null ? '—' : avgResp + ' น.', 'Response เฉลี่ย', '') +
    pgsItem(f ? esc(nickOf(f).slice(0, 10)) : '—',
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
    .map(function (r) { return { label: nickOf(r) || '-', value: Number(r.replies) || 0 }; });
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

/* ---------- HTML: ค่าคอมแอดมินรายเดือน (ตารางประเมินจากชีท Com:Admin) ----------
 * บอสสั่ง (2026-07-30): เอา "คงเหลือ" (ยอดจริงหลังหักตีกลับ/ยกเลิก) + "Commission @Admin"
 * กรองได้ทุกเดือน พร้อม %ปิด กับ ROAS — ส่วนนี้มีตัวกรองเดือนของตัวเอง ไม่ตามช่วงวันที่ด้านบน
 * (ค่าคอมเป็นตัวเลขรายเดือนจากชีท ตัดช่วงกลางเดือนไม่ได้)
 */

interface ComRow {
  admin: string; realName: string; units: string[];
  sales: number; returns: number; cancel: number; remaining: number;
  com: number; comSub: number; comHead: number;
  closeRate: number | null; roas: number | null; adSpend: number;
  note?: string; // หมายเหตุติดตัวแอดมิน (เช่น "ออกแล้ว") — เก็บต่อคน เห็นทุกเดือน
}

interface ComData {
  setupNeeded: boolean;
  months: string[];
  month: string;
  rows: ComRow[];
  totals: { sales: number; returns: number; remaining: number; com: number; admins: number } | null;
  noComAlerts?: Array<{ admin: string; realName: string; months: string[]; sales: number }>;
  hasSystemOrders?: boolean;
}

let comData: ComData | null = null;
let comReq = 0;

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function comMonthLabel(m: string): string {
  const p = String(m).split('-');
  const mo = Number(p[1]);
  return (TH_MONTHS[mo - 1] || m) + ' ' + p[0];
}

function comRoasTxt(r: ComRow): string {
  if (r.roas === null || r.roas === undefined) {
    return '<span title="ไม่มีออเดอร์ที่ผูกแอดของคนนี้ในระบบเดือนนั้น (สาย LINE / เดือนก่อนระบบเริ่มเก็บ 23 พ.ค. 2026)">—</span>';
  }
  return '<span title="' + esc('ROAS จากระบบ = ยอดออเดอร์ที่ผูกแอด ÷ ค่าแอดปันส่วน ' + THB(r.adSpend)) + '">' +
    esc(Number(r.roas).toFixed(2)) + 'x</span>';
}

function comSectionHtml(): string {
  const head = '<div class="card-head" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
    '<h3 style="margin:0">💰 ค่าคอมแอดมินรายเดือน</h3>';
  if (!comData) {
    return head + '</div><div class="loading"><div class="spinner"></div>กำลังโหลดข้อมูลค่าคอม...</div>';
  }
  const d = comData;
  if (d.setupNeeded) {
    return head + '</div><div class="empty-note">⏳ ยังไม่มีข้อมูลค่าคอม — ต้องรัน ' +
      '<code>db/migrations/2026-07-31-admin-commission-v2.sql</code> ใน Supabase แล้วรอ sync รอบถัดไป</div>';
  }
  const opts = d.months.map(function (m) {
    return '<option value="' + esc(m) + '"' + (m === d.month ? ' selected' : '') + '>' +
      esc(comMonthLabel(m)) + '</option>';
  }).join('');
  const body = d.rows.map(function (r, i) {
    const comTip = 'คอมรองหัวหน้า ' + THB(r.comSub) + ' • คอมหัวหน้า ' + THB(r.comHead);
    return '<tr>' +
      '<td>' + (i + 1) + '</td>' +
      '<td><b>' + esc(r.admin) + '</b>' +
        (r.realName ? ' <span class="rank-fullname" title="ชื่อจริงในชีท">' + esc(r.realName) + '</span>' : '') + '</td>' +
      '<td>' + r.units.map(function (u) { return '<span class="badge neutral">' + esc(u) + '</span>'; }).join(' ') + '</td>' +
      '<td class="num">' + THB(r.sales) + '</td>' +
      '<td class="num"' + (r.cancel ? ' title="' + esc('ยกเลิกอีก ' + THB(r.cancel)) + '"' : '') + '>' +
        (r.returns ? THB(r.returns) : '-') + '</td>' +
      '<td class="num"><b>' + THB(r.remaining) + '</b></td>' +
      '<td class="num"' + ((r.comSub || r.comHead) ? ' title="' + esc(comTip) + '"' : '') + '>' +
        (r.com ? '฿' + Number(r.com).toLocaleString('th-TH', { maximumFractionDigits: 2 }) : '<span title="ชีทคิดให้แล้ว: ยอดไม่ถึงเงื่อนไขรับคอม">฿0</span>') + '</td>' +
      '<td class="num">' + pctFmt(r.closeRate) + '</td>' +
      '<td class="num">' + comRoasTxt(r) + '</td>' +
      // หมายเหตุติดตัวคน (บอสขอ 2026-08-03 — ไว้โน้ตเช่น "ออกแล้ว") กดดินสอเพื่อแก้/ลบ
      '<td>' + (r.note ? '<span class="chip chip-note" title="' + esc(r.note) + '">📌 ' + esc(r.note) + '</span> ' : '') +
        '<button class="btn-mini com-note-btn" data-comnote="' + esc(r.admin) + '" title="' +
        (r.note ? 'แก้/ลบหมายเหตุ' : 'เพิ่มหมายเหตุ') + '">' + (r.note ? '✏️' : '➕') + '</button></td>' +
    '</tr>';
  }).join('');
  const t = d.totals;
  const foot = t
    ? '<tr style="font-weight:700;border-top:2px solid var(--border,#ccc)"><td></td><td>รวม ' + fmtNum(t.admins) + ' คน</td><td></td>' +
      '<td class="num">' + THB(t.sales) + '</td>' +
      '<td class="num">' + THB(t.returns) + '</td>' +
      '<td class="num">' + THB(t.remaining) + '</td>' +
      '<td class="num">฿' + Number(t.com).toLocaleString('th-TH', { maximumFractionDigits: 2 }) + '</td>' +
      '<td></td><td></td><td></td></tr>'
    : '';
  // 🔔 คนไม่ได้ค่าคอม 2 เดือนติด (เฉพาะเดือนที่ปิดแล้ว) — บรีฟทีมขอให้ขึ้นเตือน
  const noCom = (d.noComAlerts || []);
  const noComHtml = noCom.length
    ? '<div class="loss-row lv-yellow" style="margin-bottom:10px">' +
        '<div class="loss-icon">🔔</div><div class="loss-body">' +
        '<div class="loss-title">ไม่ได้ค่าคอม <b>2 เดือนติด</b> (' +
          esc(comMonthLabel(noCom[0].months[0])) + ' + ' + esc(comMonthLabel(noCom[0].months[1])) + ') — ' +
          fmtNum(noCom.length) + ' คน</div>' +
        '<div class="loss-reason">' + noCom.map(function (a) {
          return '<span class="chip" title="' + esc((a.realName ? a.realName + ' • ' : '') +
            'ยอดขายรวม 2 เดือน ' + THB(a.sales)) + '">' + esc(a.admin) + '</span>';
        }).join(' ') + '</div>' +
      '</div></div>'
    : '';
  return head +
      '<select class="input" id="rk-com-month">' + opts + '</select>' +
      '<div class="spacer" style="flex:1"></div>' +
      '<button class="btn-mini" id="rk-com-csv">📄 CSV</button>' +
    '</div>' +
    noComHtml +
    '<div class="card-sub">ยอดขาย/ตีกลับ/<b>คงเหลือ</b>/คอม/%ปิดลูกค้าใหม่ = ตารางประเมินในชีท Com:Admin ตรงๆ ' +
      '(คงเหลือ = ยอดจริงหลังหักตีกลับ+ยกเลิก — ตัวที่ทีมใช้ตัดสิน) • ROAS คิดจากระบบ' +
      (d.hasSystemOrders === false ? ' — เดือนนี้ระบบยังไม่มีออเดอร์ (เริ่มเก็บ 23 พ.ค. 2026) ROAS จึงเป็น "—"' : '') + '</div>' +
    (d.rows.length
      ? '<div class="table-scroll"><table class="tbl"><thead><tr>' +
        '<th>#</th><th>แอดมิน</th><th>ยูนิต</th><th class="num">ยอดขาย</th><th class="num">ตีกลับ</th>' +
        '<th class="num">คงเหลือ</th><th class="num">คอม @Admin</th><th class="num">%ปิดใหม่</th><th class="num">ROAS</th>' +
        '<th>📌 หมายเหตุ</th>' +
        '</tr></thead><tbody>' + body + foot + '</tbody></table></div>'
      : '<div class="empty-note">เดือนนี้ยังไม่มีข้อมูลในชีท</div>');
}

function fetchCom(container: HTMLElement, month: string): void {
  const seq = ++comReq;
  serverCall<ComData>('apiAdminCom', { month: month }).then(function (d) {
    if (seq !== comReq) return;
    comData = d;
    const box = container.querySelector('#rk-com') as HTMLElement | null;
    if (box) {
      box.innerHTML = comSectionHtml();
      bindComEvents(container);
    }
  }).catch(function () {
    if (seq !== comReq) return;
    const box = container.querySelector('#rk-com') as HTMLElement | null;
    if (box) {
      box.innerHTML = '<h3>💰 ค่าคอมแอดมินรายเดือน</h3>' +
        '<div class="empty-note">⚠️ โหลดข้อมูลค่าคอมไม่สำเร็จ <button class="btn-mini" id="rk-com-retry">ลองใหม่</button></div>';
      const b = box.querySelector('#rk-com-retry');
      if (b) b.addEventListener('click', function () { fetchCom(container, month); });
    }
  });
}

function bindComEvents(container: HTMLElement): void {
  const sel = container.querySelector('#rk-com-month') as HTMLSelectElement | null;
  if (sel) sel.addEventListener('change', function () {
    const box = container.querySelector('#rk-com') as HTMLElement | null;
    if (box) box.innerHTML = '<h3>💰 ค่าคอมแอดมินรายเดือน</h3>' +
      '<div class="loading"><div class="spinner"></div>กำลังโหลด ' + esc(comMonthLabel(sel.value)) + '...</div>';
    fetchCom(container, sel.value);
  });
  const csv = container.querySelector('#rk-com-csv');
  if (csv) csv.addEventListener('click', function () {
    if (!comData || !comData.rows.length) { toast('ยังไม่มีข้อมูลให้ Export'); return; }
    const out: (string | number)[][] = [
      ['ค่าคอมแอดมิน ' + comMonthLabel(comData.month)],
      ['ชื่อเล่น', 'ชื่อจริง (ชีท)', 'ยูนิต', 'ยอดขาย', 'ตีกลับ', 'ยกเลิก', 'คงเหลือ',
        'คอม @Admin', 'คอมรองหัวหน้า', 'คอมหัวหน้า', '%ปิดลูกค้าใหม่', 'ROAS (ระบบ)', 'หมายเหตุ'],
    ];
    comData.rows.forEach(function (r) {
      out.push([r.admin, r.realName, r.units.join(' '), r.sales, r.returns, r.cancel, r.remaining,
        r.com, r.comSub, r.comHead, r.closeRate === null ? '-' : r.closeRate,
        r.roas === null ? '-' : r.roas, r.note || '']);
    });
    downloadCSV(out, 'admin-commission-' + comData.month);
  });
  // ✏️ หมายเหตุติดตัวแอดมิน (เช่น "ออกแล้ว") — เก็บต่อคน เห็นทุกเดือน แก้/ลบได้
  container.querySelectorAll('[data-comnote]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const admin = btn.getAttribute('data-comnote') || '';
      const row = comData && comData.rows.find(function (r) { return r.admin === admin; });
      const cur = (row && row.note) || '';
      openModal(
        '<div class="modal-head"><h3>📌 หมายเหตุ — ' + esc(admin) + '</h3><button class="modal-close">✕</button></div>' +
        '<div class="card-sub" style="margin-bottom:8px">โน้ตติดตัวแอดมินคนนี้ เห็นทุกเดือนในตารางค่าคอม ' +
          '(เช่น "ออกแล้ว มี.ค. — รอเคลียร์คอมงวดสุดท้าย") • ล้างข้อความแล้วบันทึก = ลบหมายเหตุ</div>' +
        '<textarea class="input" id="com-note-text" maxlength="200" rows="3" style="width:100%" ' +
          'placeholder="พิมพ์หมายเหตุ...">' + esc(cur) + '</textarea>' +
        '<div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">' +
          '<button class="btn-mini modal-close">ยกเลิก</button>' +
          '<button class="btn-mini" id="com-note-save">💾 บันทึก</button></div>'
      );
      const root = document.getElementById('modal-root');
      const save = root && root.querySelector('#com-note-save');
      if (save) save.addEventListener('click', function () {
        const ta = root!.querySelector('#com-note-text') as HTMLTextAreaElement | null;
        const note = (ta && ta.value) || '';
        (save as HTMLButtonElement).disabled = true;
        save.textContent = 'กำลังบันทึก...';
        serverCall('apiAdminCom', { action: 'setNote', admin: admin, note: note })
          .then(function (res: any) {
            if (res && res.ok === false) throw new Error(res.error || 'บันทึกไม่สำเร็จ');
            if (row) row.note = String(note).trim();
            closeModal();
            toast(String(note).trim() ? '✅ บันทึกหมายเหตุแล้ว' : '🗑️ ลบหมายเหตุแล้ว');
            const box = container.querySelector('#rk-com') as HTMLElement | null;
            if (box) { box.innerHTML = comSectionHtml(); bindComEvents(container); }
          })
          .catch(function (e: any) {
            (save as HTMLButtonElement).disabled = false;
            save.textContent = '💾 บันทึก';
            toast('❌ ' + (e && e.message ? e.message : 'บันทึกไม่สำเร็จ'));
          });
      });
    });
  });
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

/** เกณฑ์ "ใครมีสิทธิ์เข้าอันดับ" ของโหมดเท่า — คนละเรื่องกับน้ำหนักคะแนน Overall จึงแยกแถวไว้บนสุด */
function rankRulesRowHtml(): string {
  return '<div class="sp-row" id="rk-rankrules">' +
    '<label class="sp-metric"><span>🔥 เข้าอันดับโหมด &quot;เท่า&quot;</span></label>' +
    '<div class="sp-field">ค่าแอดขั้นต่ำ <input type="number" min="0" step="50" class="input sp-num" id="rk-min-spend" value="' +
      rankRules.minAdSpend + '"><span class="sp-u">฿</span></div>' +
    '<div class="sp-field">ออเดอร์ขั้นต่ำ <input type="number" min="0" step="1" class="input sp-num" id="rk-min-orders" value="' +
      rankRules.minOrders + '"><span class="sp-u">ออเดอร์</span></div>' +
    '<div class="sp-field">ค่าแอดต้องเป็นอย่างน้อย <input type="number" min="0" max="100" step="1" class="input sp-num" id="rk-min-spend-pct" value="' +
      rankRules.minSpendPctOfRev + '"><span class="sp-u">% ของยอดขาย</span></div>' +
    '<div class="sp-dir">0 = ไม่กัน</div>' +
    '</div>';
}

function panelHtml(): string {
  const rows = scoreConfig.map(panelRowHtml).join('');
  return '<div class="score-panel' + (state.panelOpen ? '' : ' collapsed') + '" id="rk-panel">' +
      '<div class="sp-hint">ปรับ <b>น้ำหนัก (%)</b> และ <b>เป้าหมาย</b> ของแต่ละตัวชี้วัดได้เอง — คะแนน Overall = ผลรวมถ่วงน้ำหนัก ' +
        '(ได้ครบ 100 คะแนนของตัวนั้นเมื่อถึงเป้า) • คนที่ไม่มีข้อมูลตัวไหนจะไม่ถูกคิดตัวนั้น • กด "บันทึกเกณฑ์" เพื่อให้ทุกคนใช้เกณฑ์เดียวกัน</div>' +
      '<div class="sp-hint">แถวแรกไม่ใช่คะแนน แต่เป็น <b>ด่านเข้าอันดับของโหมด 🔥 เท่า</b> — ' +
        'เท่า = ยอดจากแอด ÷ ค่าแอด คนที่ค่าแอดปันมานิดเดียวจะได้เลขสูงลิ่วโดยไม่ได้แปลว่าเก่ง ' +
        '(เจอจริง: 3 ออเดอร์ ค่าแอด ฿35 = 27.82 เท่า) • ช่อง <b>% ของยอดขาย</b> ปิดไว้ (0) ' +
        'เพราะตั้งแต่ 17 ส.ค. ค่าแอดถูกปันครบ 100% แล้ว เคสเพจหยุดยิงแอดจึงไม่ทำให้เท่าพุ่งอีก ' +
        '— เปิดเองได้ถ้าอยากกรองเพิ่ม • ใส่ 0 = ไม่กันช่องนั้น</div>' +
      '<div class="sp-list">' + rankRulesRowHtml() + rows + '</div>' +
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
  const full = fullNameSub(r);
  return '<div class="top3-card ' + cls + '">' +
    '<div class="medal">' + MEDALS[rank - 1] + '</div>' +
    avatarHtml(r.id, r.name, r.online) +
    '<div class="nm" title="' + esc(r.name) + '">' + esc(nickOf(r)) + '</div>' +
    (full ? '<div class="nm-full">' + esc(full) + '</div>' : '') +
    '<div class="val">' + esc(modeValue(r)) + '</div>' +
    '<div>' + scoreBadge(r._score) + '</div>' +
    '<div class="sub">🛒 ' + esc(fmtNum(r.orders)) + ' • 🎯 ' + esc(pctFmt(r.closeRate)) +
      ' • ⚡ ' + esc(respShort(r)) + '</div>' +
    // เปอร์บิล + ROAS โชว์ทุกโหมด (บอสใช้ดูคุณภาพบิล/คุ้มค่าแอด ไม่ใช่แค่ตอนจัดอันดับยอดขาย)
    '<div class="sub">' + perBillHtml(r) + ' • ' + roasHtml(r) + '</div>' +
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

/* ---------- 🚨 โซนเตือน "ต่ำสุด 5" (ทีมขอ 2026-08-10) ----------
 * สลับกับโพเดียมด้วยปุ่ม — โชว์ทีละอันเพื่อไม่กินที่หน้าจอ
 * นับเฉพาะคนที่ "เข้าเกณฑ์จัดอันดับในโหมดนี้" เท่านั้น คนที่จัดอันดับไม่ได้ (เช่นสาย LINE
 * ไม่มียอดผูกแอดในโหมดเท่า) กองอยู่ท้ายลิสต์อยู่แล้ว ถ้านับรวมจะกลายเป็นว่าโดนประจานทั้งที่วัดไม่ได้
 */
const BOTTOM_N = 5;

/**
 * ป้ายยูนิตที่คนนี้สังกัด
 * ตัวเดา (`unitsGuess`) ต้องหน้าตาต่างจากตัวที่ทีมประกาศไว้ — ไม่งั้นหัวหน้าจะเชื่อผิดคน
 */
function unitChipsHtml(r: PerfRow): string {
  const us = (r.units || []).filter(function (u) { return !!u; });
  if (!us.length) {
    return '<span class="b5-unit none" title="ยังไม่ได้จับคู่แอดมินคนนี้กับยูนิต (หน้า U Map / ชีทค่าคอม) และเดาจากเพจที่ขายก็ไม่ได้">ไม่ระบุยูนิต</span>';
  }
  const guess = !!r.unitsGuess;
  const tip = guess
    ? 'เดาจากเพจที่คนนี้ขายได้จริงในช่วงนี้ — ทีมยังไม่ได้จับคู่คนนี้กับยูนิตในหน้า U Map'
    : 'ยูนิตที่ทีมจับคู่ไว้ (หน้า U Map หรือชีทค่าคอม)';
  return us.map(function (u) {
    return '<span class="b5-unit' + (guess ? ' guess' : '') + '" title="' + esc(tip) + '">' +
      (guess ? '~' : '') + esc(u) + '</span>';
  }).join('');
}

/**
 * lowNo = ลำดับในกลุ่มต่ำสุด (1 = ต่ำสุดของทั้งทีม) — ทีมบอกว่าเห็นแต่เลขอันดับรวมแล้ว
 * แยกไม่ออกว่าใครหนักกว่าใคร เลยต้องมีเลข 1-5 ของตัวเองอยู่หน้าการ์ด
 * ส่วนอันดับรวม (#27 จาก 27) ยังโชว์ไว้เป็นตัวรอง ให้เทียบกับลิสต์เต็มข้างล่างได้
 */
function b5CardHtml(r: PerfRow, lowNo: number, pos: number, total: number): string {
  const full = fullNameSub(r);
  const stats = '<span title="เท่า (ROAS)">🔥 ' + esc(roasTxt(r)) + '</span> • ' +
    '<span title="%ปิดการขาย">🎯 ' + esc(pctFmt(r.closeRate)) + '</span> • ' +
    '<span title="เปอร์บิล">🧾 ' + esc(THB(r.avgOrder)) + '</span> • ' +
    '<span title="เวลาตอบเฉลี่ย">⚡ ' + esc(respLong(r)) + '</span> • ' +
    '🛒 ' + esc(fmtNum(r.orders)) + ' • 💰 ' + esc(THB(r.revenue));
  return '<div class="b5-card' + (lowNo === 1 ? ' worst' : '') + '">' +
    '<div class="b5-rank" title="' + esc('ต่ำสุดอันดับ ' + lowNo + ' (อันดับ 1 = ต่ำสุดของทีม)') + '">' +
      '<span class="b5-rank-lo">ต่ำสุด</span><span class="b5-rank-n">' + lowNo + '</span></div>' +
    avatarHtml(r.id, r.name, r.online, 'sm') +
    '<div class="b5-mid">' +
      '<div class="b5-name">' + esc(nickOf(r)) +
        (full ? ' <span class="rank-fullname" title="ชื่อเต็มใน Pancake">' + esc(full) + '</span>' : '') +
        ' <span class="b5-overall" title="อันดับรวมของโหมดนี้ ตรงกับเลขในลิสต์เต็มข้างล่าง">อันดับรวม #' +
          pos + '/' + fmtNum(total) + '</span></div>' +
      '<div class="b5-units">' + unitChipsHtml(r) + '</div>' +
      '<div class="b5-stats">' + stats + '</div>' +
    '</div>' +
    '<div class="b5-val">' + esc(modeValue(r)) + '</div>' +
    '</div>';
}

function bottom5Html(sorted: PerfRow[]): string {
  const idx: number[] = [];
  sorted.forEach(function (r, i) { if (eligible(r, state.mode)) idx.push(i); });
  if (!idx.length) {
    return '<div class="empty-note">ยังไม่มีใครเข้าเกณฑ์จัดอันดับในโหมดนี้ — ยังจัด 5 อันดับต่ำสุดไม่ได้</div>';
  }
  const skipped = sorted.length - idx.length;
  // ต่ำสุดขึ้นก่อน — โซนนี้ไว้ไล่ดูว่าใครต้องช่วยด่วนสุด ไม่ใช่ตารางอ่านไล่ลง
  const pick = idx.slice(-BOTTOM_N).reverse();
  const cards = pick.map(function (i, n) {
    return b5CardHtml(sorted[i], n + 1, i + 1, idx.length);
  }).join('');
  const note = '<b>อันดับ 1 = ต่ำสุดของทีม</b> ไล่ขึ้นไปหาอันดับ ' + pick.length +
    ' • เกณฑ์ที่ใช้ตัดสิน: ' + esc(modeLabel(state.mode)) +
    ' • นับจากคนที่จัดอันดับได้ ' + fmtNum(idx.length) + ' คน' +
    (skipped > 0
      ? ' <span title="โหมดนี้วัดคนกลุ่มนี้ไม่ได้ (เช่นไม่มียอดผูกแอด หรือต่ำกว่าขั้นต่ำที่ตั้งไว้) — ไม่เอามาประจาน">' +
        '(ไม่นับอีก ' + fmtNum(skipped) + ' คนที่โหมดนี้วัดไม่ได้)</span>'
      : '');
  return '<div class="b5-zone">' +
      '<div class="b5-head">' +
        '<div class="b5-title">⚠️ ' + fmtNum(pick.length) + ' อันดับต่ำสุด — ต้องเข้าไปดูแล</div>' +
        '<div class="b5-note">' + note + '</div>' +
      '</div>' +
      cards +
    '</div>';
}

/** ปุ่มสลับ ท็อป 3 / ต่ำสุด 5 — โชว์ทีละอัน ประหยัดพื้นที่ */
function rankTabsHtml(): string {
  const btn = function (key: string, label: string, cls: string): string {
    return '<button class="rank-tab ' + cls + (state.rankTab === key ? ' active' : '') +
      '" data-ranktab="' + key + '">' + label + '</button>';
  };
  return '<div class="rank-tabs">' + btn('top', '🥇 ท็อป 3', 'good') + btn('bottom', '⚠️ ต่ำสุด 5', 'warn') + '</div>';
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
  const sub1 = '🛒 ' + esc(fmtNum(r.orders)) + ' ออเดอร์ • 💬 <span title="คนทัก = บทสนทนาอินบ็อกซ์ใหม่ + ความคิดเห็น (ตรงจอสถิติการมีส่วนร่วมของ Pancake) — ใช้เป็นตัวหาร %ปิดการขาย">' +
    esc(fmtNum(r.chats)) + ' คนทัก</span> • ↩ ' + esc(fmtNum(r.replies)) + ' ตอบ • 📞 ' + esc(fmtNum(r.phones)) + ' เบอร์';
  const sub2 = '📦 ' + esc(r.topProduct || '-') + ' • 📄 ' + esc(r.topPage || '-') +
    (r.lastOrderAt ? ' • ออเดอร์ล่าสุด ' + esc(relTime(r.lastOrderAt)) : '');
  // แชทรอตอบตอนนี้ของคนนี้ — เฉพาะอินบ็อกซ์ (บอสสั่งเอาคอมเมนต์ออก 2026-08-03; ยอดคอมเมนต์ยังอยู่ใน CSV)
  const waitN = Number(r.waitingNow) || 0;
  const waitCmt = Number(r.waitingCommentNow) || 0;
  const waitInbox = Math.max(0, waitN - waitCmt);
  const sub3 = waitInbox > 0
    ? '<div class="rank-sub" title="อินบ็อกซ์ที่ลูกค้ารอตอบตอนนี้ (24 ชม.ล่าสุด) — ไม่รวมคอมเมนต์ใต้โพสต์ ' + esc(fmtNum(waitCmt)) + ' รายการ">' +
      '⏰ แชทรอตอบ ' + esc(fmtNum(waitInbox)) + '</div>'
    : '';
  // โหมด Overall โชว์คะแนนเป็นตัวใหญ่ + ยอดขายเป็นตัวรอง; โหมดอื่นโชว์ยอดขายเป็นตัวใหญ่
  const big = (state.mode === 'overall')
    ? '<div class="rank-big">' + esc(scoreFmt(r._score)) + '<span class="rank-big-u"> คะแนน</span></div>'
    : (state.mode === 'roas')
      ? '<div class="rank-big">' + esc(roasTxt(r)) + '<span class="rank-big-u"> เท่า</span></div>'
      : '<div class="rank-big">' + esc(THB(r.revenue)) + '</div>';
  // เปอร์บิล + ROAS อยู่ในทุกโหมด (เดิมเปอร์บิลโผล่เฉพาะโหมดที่ไม่ใช่ Overall)
  const mini = ((state.mode === 'overall' || state.mode === 'roas') ? '💰 ' + esc(THB(r.revenue)) + ' • ' : '') +
    '<span title="' + esc(closeRateTip(r)) + '">🎯 ' + esc(pctFmt(r.closeRate)) + '</span> • ⚡ ' + esc(respLong(r)) +
    '<br>' + perBillHtml(r) + ' • ' + roasHtml(r);
  return '<div class="' + cardCls + '">' +
    noHtml +
    avatarHtml(r.id, r.name, r.online, 'sm') +
    '<div class="rank-mid">' +
      '<div class="rank-name">' + nameHtml(r) + ' ' + badge + ' ' + scoreBadge(r._score) + slaBadge + '</div>' +
      '<div class="rank-sub">' + sub1 + '</div>' +
      '<div class="rank-sub">' + sub2 + '</div>' +
      sub3 +
      kpiBarHtml(r) +
      kpiChipsHtml(r) +
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
  return rankTabsHtml() +
    (state.rankTab === 'bottom' ? bottom5Html(sorted) : podiumHtml(sorted)) +
    '<div class="rank-list">' + sorted.map(function (r, i) { return rankCardHtml(r, i); }).join('') + '</div>';
}

/** ปุ่มสลับหัวลิสต์ — ต้องผูกใหม่ทุกครั้งที่ #rk-ranking ถูกวาดใหม่ (innerHTML ทิ้ง handler เดิม) */
function bindRankTabs(container: HTMLElement): void {
  container.querySelectorAll('[data-ranktab]').forEach(function (b) {
    b.addEventListener('click', function () {
      const key = b.getAttribute('data-ranktab');
      state.rankTab = (key === 'bottom') ? 'bottom' : 'top';
      updateRanking(container);
    });
  });
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
    kpiPanelHtml() +
    panelHtml() +
    dashRow +
    '<div id="rk-ranking">' + rankingHtml(data) + '</div>' +
    // ค่าคอมมีตัวกรองเดือนของตัวเอง — ใช้แคชเดิมตอนวาดใหม่ (auto-refresh 75 วิ ไม่ต้องดึงค่าคอมซ้ำ)
    '<div class="card" id="rk-com" style="margin-top:14px">' + comSectionHtml() + '</div>';
  bindEvents(container);
  if (!comData) fetchCom(container, ''); // ครั้งแรกเท่านั้น — เดือนล่าสุดเป็นค่าเริ่มต้น
  startAuto(container); // ตั้งรอบรีเฟรชใหม่ทุกครั้งที่วาดจอ (นับ 75 วิ จากภาพล่าสุดที่ผู้ใช้เห็น)
}

/** อัปเดตเฉพาะส่วนอันดับ — ไม่แตะแผงเกณฑ์ (กัน focus ในช่องกรอกหลุดตอนพิมพ์) */
function updateRanking(container: HTMLElement): void {
  const box = container.querySelector('#rk-ranking');
  if (!box) return;
  box.innerHTML = rankingHtml(lastData);
  bindRankTabs(container);
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

  // เปิด/ปิดรีเฟรชอัตโนมัติ
  const autoBtn = container.querySelector('#rk-auto');
  if (autoBtn) {
    autoBtn.addEventListener('click', function () {
      autoOn = !autoOn;
      autoBtn.classList.toggle('primary', autoOn);
      autoBtn.textContent = autoOn ? '⏸️ หยุดอัตโนมัติ' : '▶️ อัปเดตอัตโนมัติ';
      const dot = container.querySelector('.live-dot');
      if (dot) dot.classList.toggle('on', autoOn);
      if (autoOn) startAuto(container); else stopAuto();
      toast(autoOn ? '🔄 เปิดอัปเดตอัตโนมัติทุก ' + Math.round(AUTO_MS / 1000) + ' วินาที' : '⏸️ ปิดอัปเดตอัตโนมัติแล้ว');
    });
  }

  // toggle แผงตั้งเป้า KPI
  const kpiTg = container.querySelector('#rk-kpi-toggle');
  if (kpiTg) {
    kpiTg.addEventListener('click', function () {
      state.kpiOpen = !state.kpiOpen;
      const panel = container.querySelector('#rk-kpi-panel');
      if (panel) panel.classList.toggle('collapsed', !state.kpiOpen);
      kpiTg.classList.toggle('primary', state.kpiOpen);
    });
  }

  // ช่องกรอกเป้า KPI — พิมพ์แล้วแถบความคืบหน้าขยับทันที (ยังไม่บันทึกจนกดปุ่ม)
  container.querySelectorAll('#rk-kpi-panel .sp-row').forEach(function (rowEl) {
    const key = rowEl.getAttribute('data-kpikey') as keyof KpiTargets | null;
    const inp = rowEl.querySelector('.kpi-target') as HTMLInputElement | null;
    if (!key || !inp) return;
    inp.addEventListener('input', function () {
      const n = Number(inp.value);
      kpiTargets = normalizeKpiTargets({ ...kpiTargets, [key]: (isFinite(n) && n >= 0) ? n : 0 });
      updateRanking(container);
    });
  });

  const kpiSave = container.querySelector('#rk-kpi-save');
  if (kpiSave) kpiSave.addEventListener('click', function () {
    serverCall('apiAdminSettings', { kpiTargets: kpiTargets })
      .then(function () { toast('💾 บันทึกเป้า KPI แล้ว — ทุกคนจะเห็นเป้าเดียวกัน'); })
      .catch(function () { toast('⚠️ บันทึกเป้า KPI ไม่สำเร็จ'); });
  });

  const kpiReset = container.querySelector('#rk-kpi-reset');
  if (kpiReset) kpiReset.addEventListener('click', function () {
    kpiTargets = { ...DEFAULT_KPI_TARGETS };
    state.kpiOpen = true;
    render(container, lastData);
    toast('↺ กลับไปใช้เป้าเริ่มต้นแล้ว (ยังไม่บันทึก)');
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

  // ด่านเข้าอันดับโหมดเท่า — พิมพ์แล้วอันดับขยับทันที (บันทึกด้วยปุ่มเดียวกับเกณฑ์คะแนน)
  const bindFloor = function (id: string, set: (n: number) => void): void {
    const el = container.querySelector(id) as HTMLInputElement | null;
    if (!el) return;
    el.addEventListener('input', function () {
      const n = Number(el.value);
      set(isFinite(n) && n >= 0 ? Math.round(n) : 0);
      updateRanking(container);
      // อัปเดตข้อความในแถบเดิม ไม่แทน node — ถ้าแทนจะทำให้ handler กดเปิดแผงหลุด
      const chip = container.querySelector('#rk-roas-hint') as HTMLElement | null;
      if (chip) { chip.textContent = roasHintText(); chip.setAttribute('title', roasHintTip()); }
    });
  };
  bindFloor('#rk-min-spend', function (n) { rankRules.minAdSpend = n; });
  bindFloor('#rk-min-orders', function (n) { rankRules.minOrders = n; });
  bindFloor('#rk-min-spend-pct', function (n) { rankRules.minSpendPctOfRev = Math.min(100, n); });

  // แถบอธิบายโหมดเท่า — กดแล้วเปิดแผงเกณฑ์ไปแก้ขั้นต่ำ
  const hintChip = container.querySelector('#rk-roas-hint');
  if (hintChip) hintChip.addEventListener('click', function () {
    state.panelOpen = true;
    render(container, lastData);
  });

  // บันทึกเกณฑ์ (เก็บบนเซิร์ฟเวอร์)
  const saveBtn = container.querySelector('#rk-save');
  if (saveBtn) saveBtn.addEventListener('click', function () {
    serverCall('apiScoreConfig', { config: scoreConfig, rank: rankRules })
      .then(function () { toast('💾 บันทึกเกณฑ์แล้ว — ทุกคนจะเห็นเกณฑ์นี้'); })
      .catch(function () { toast('⚠️ บันทึกเกณฑ์ไม่สำเร็จ'); });
  });

  // รีเซ็ตค่าเริ่มต้น
  const resetBtn = container.querySelector('#rk-reset');
  if (resetBtn) resetBtn.addEventListener('click', function () {
    scoreConfig = normalizeConfig(null);
    rankRules = normalizeRankRules(null);
    state.panelOpen = true;
    render(container, lastData);
    toast('↺ กลับไปใช้ค่าเริ่มต้นแล้ว (ยังไม่บันทึก)');
  });

  // export CSV
  const csvBtn = container.querySelector('#rk-csv');
  if (csvBtn) csvBtn.addEventListener('click', exportCSV);

  bindRankTabs(container);  // ปุ่ม ท็อป 3 / ต่ำสุด 5
  bindComEvents(container); // ตัวกรองเดือน + CSV ของตารางค่าคอม (วาดจากแคช comData)
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
    ['อันดับ', 'ชื่อเล่น', 'แอดมิน (ชื่อเต็ม)', 'สถานะ', 'Overall คะแนน', 'ยอดขาย', 'ออเดอร์',
      'คนทัก(อินบ็อกซ์ใหม่+คอมเมนต์)', 'ข้อความที่ตอบ',
      '% ปิดการขาย', 'ตอบเฉลี่ย(นาที)', 'เปอร์บิล', 'ROAS', 'ยอดจากแอด', 'ค่าแอดที่ปันส่วน',
      'สินค้าขายดี', 'เพจยอดดีสุด',
      'กลุ่มสินค้า', 'แชทที่ดูแลตอนนี้(24ชม.)', 'แชทรอตอบตอนนี้', 'รอตอบ-อินบ็อกซ์', 'รอตอบ-คอมเมนต์',
      'เกิน SLA ตอนนี้'],
  ];
  sorted.forEach(function (r, i) {
    const waitN = Number(r.waitingNow) || 0;
    const waitCmt = Number(r.waitingCommentNow) || 0;
    out.push([
      i + 1,
      nickOf(r),
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
      (r.roas === null || r.roas === undefined) ? '-' : r.roas, // '-' = ยอดไม่ได้มาจากแอด (ห้ามเดา)
      Math.round(Number(r.adRevenue) || 0),
      Math.round(Number(r.adSpend) || 0),
      r.topProduct || '-',
      r.topPage || '-',
      r.productGroups || '',
      Number(r.activeNow) || 0,
      waitN,
      waitN - waitCmt,
      waitCmt,
      Number(r.overSla) || 0,
    ]);
  });
  downloadCSV(out, 'admin-ranking');
}

/* ---------- auto-refresh (realtime เฉพาะช่วง "วันนี้") ---------- */

function stopAuto(): void {
  if (autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
  }
}

/**
 * ตั้งรอบรีเฟรชอัตโนมัติ — เปิดเฉพาะ preset 'วันนี้' และเมื่อผู้ใช้ไม่ได้ปิดไว้
 *
 * โปรเจกต์นี้ไม่มี hook unmount ของ view (App.switchView แค่สลับคลาส .active ของ section
 * ตาม lib/ui/app-core.ts) — ตัวจับเวลาจึงต้อง "เช็คเองแล้ว clearInterval" เมื่อออกจากหน้า
 * ไม่งั้นมันจะยิง API ต่อไปเรื่อยๆ ทั้งที่ผู้ใช้ไปหน้าอื่นแล้ว
 */
function startAuto(container: HTMLElement): void {
  stopAuto();
  if (!autoOn || !kpiActive()) return;
  autoTimer = setInterval(function () {
    // ออกจากหน้านี้ไปแล้ว (view ไม่ active / container หลุด DOM) → เลิกจับเวลา
    if (!container.isConnected || !container.classList.contains('active')) { stopAuto(); return; }
    if (state.preset !== 'today' || !autoOn) { stopAuto(); return; }
    if (document.hidden) return;                       // แท็บถูกซ่อน — ไม่ต้องเสีย quota
    const modalRoot = document.getElementById('modal-root');
    if (modalRoot && modalRoot.innerHTML) return;      // มี modal เปิดอยู่ — วาดใหม่จะกระตุกจอ
    const ae = document.activeElement as HTMLElement | null;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA')) return; // กำลังพิมพ์อยู่
    fetchData(container, true);
  }, AUTO_MS);
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
    lastFetchAt = Date.now();
    // เป้า KPI ที่บันทึกไว้บนเซิร์ฟเวอร์ — แต่ถ้าแผงเปิดอยู่แปลว่าผู้ใช้กำลังปรับค่า ห้ามทับ
    if (data && data.kpiTargets && !state.kpiOpen) kpiTargets = normalizeKpiTargets(data.kpiTargets);
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
    const res = await serverCall<{ config: unknown; rank: unknown }>('apiScoreConfig', {});
    scoreConfig = normalizeConfig(res && res.config);
    rankRules = normalizeRankRules(res && res.rank);
  } catch (e) {
    scoreConfig = normalizeConfig(null);
    rankRules = normalizeRankRules(null);
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
