/* ============================================================
   sales — ภาพรวมยอดขาย (POS-style Sales Dashboard)
   port จาก JsSales.html → ลงทะเบียนเป็น export const sales
   ดึงข้อมูลจริงผ่าน apiSales
   ทุก param (preset/from/to/channel/compare) เป็น server-side
   → เปลี่ยน filter เมื่อไหร่ ต้องเรียก server ใหม่เสมอ
   ============================================================ */

import {
  serverCall,
  esc,
  THB,
  fmtNum,
  pctFmt,
  relTime,
  rangeControlsHtml,
  bindRangeControls,
  showError,
  toast,
  downloadCSV,
  downloadXLS,
  openModal,
} from '@/lib/ui/helpers';
import { svgHourlyLine, miniBars, hbarRows, bindChartTips, hideChartTip } from '@/lib/ui/charts';
import { salesSkel } from '@/lib/ui/skeletons';

declare global {
  // app-core (JsCommon) แนบ App / VIEW_META ไว้บน global — view อ้างถึงตรงๆ (ห้าม import กัน cycle)
  // eslint-disable-next-line no-var
  var App: { switchView: (view: string) => void };
  // eslint-disable-next-line no-var
  var VIEW_META: Record<string, { title: string; sub: string }>;
}

interface SalesState {
  preset: string;
  from: string;
  to: string;
  channel: string;
  compare: string;
}

interface SalesData {
  rangeLabel?: string;
  prevLabel?: string | null;    // ชื่อหน้าต่างเทียบ เช่น '1 วันที่แล้ว' (server คำนวณให้)
  prevWindow?: string | null;   // ช่วงจริงที่เทียบ เช่น '24 ก.ค. 00:00–14:32 น.'
  needCheckOrders?: any[];      // รายออเดอร์ "ต้องตรวจ" ของช่วงที่เลือก (สูงสุด 200 ใบล่าสุด)
  waiting?: { total: number; inbox: number; comment: number } | null;
  kpis?: any;
  trends?: any;
  channels?: any;
  hourly?: number[];
  hourlyPrev?: number[] | null;
  today?: any;
  sources?: any[];
  statusBreakdown?: any[];
  alerts?: any[];
  top?: any;        // { all|facebook|line: { pages: [...], products: [...] } }
  returning?: any;  // { total, returning, pct } | null (null = ยังไม่รัน migration)
  // ค่าแอดจริง + ROAS | null = ยังไม่รัน migration ad_daily → หน้าเว็บโชว์ "—"
  adCost?: {
    spend: number; trend: number | null; activeAds: number;
    syncedAt: string | null; roas: number | null; roasPrev: number | null;
    adRevenueMeta?: number; adCloseRate?: number | null;
    adPurchases?: number; adMsgs?: number;
    roasNew?: number | null; roasAll?: number | null; adPagesRev?: number;
  } | null;
  salesBreak?: { total: number; fb: number; line: number };
}

let lastData: SalesData | null = null;
// default = Facebook: ยอดขายส่วนใหญ่มาจาก FB และแอดทั้งหมดอยู่บน FB (บอสสั่ง 2026-07-24)
// LINE/อื่นๆ ดูได้โดยคลิกช่องช่องทางด้านล่าง
const state: SalesState = { preset: 'today', from: '', to: '', channel: 'facebook', compare: 'prev' };

const CH_LABELS: Record<string, string> = { '': '🌐 ทั้งหมด', 'facebook': '📘 Facebook', 'line': '🟢 LINE OA' };

/* ---------------- data helpers ---------------- */

function buildParams() {
  return {
    preset: state.preset,
    from: state.from,
    to: state.to,
    channel: state.channel,
    compare: state.compare,
  };
}

/** บังคับให้เป็น array ตัวเลข 24 ช่องเสมอ (กันข้อมูลขาด) */
function arr24(a: any): number[] {
  const out: number[] = [];
  a = a || [];
  for (let i = 0; i < 24; i++) out.push(Number(a[i]) || 0);
  return out;
}

/* ---------------- small view helpers ---------------- */

/** chip เทรนด์: ▲ +x% เขียว / ▼ x% แดง / — เทา (null = ไม่เปรียบเทียบ) */
function trendChip(v: any): string {
  if (v === null || v === undefined || isNaN(v)) return '<span class="sr-trend flat">—</span>';
  const r = Math.round(Number(v) * 10) / 10;
  if (r > 0) return '<span class="sr-trend up">▲ +' + r + '%</span>';
  if (r < 0) return '<span class="sr-trend down">▼ ' + Math.abs(r) + '%</span>';
  return '<span class="sr-trend flat">—</span>';
}

function chBoxHtml(key: string, ch: any): string {
  ch = ch || {};
  return '<button type="button" class="sr-chbox' + (state.channel === key ? ' active' : '') +
    '" data-ch="' + key + '">' +
    '<div class="t">' + CH_LABELS[key] + '</div>' +
    '<div class="v">' + THB(ch.revenue || 0) + '</div>' +
    '<div class="s">' + fmtNum(ch.orders || 0) + ' ออเดอร์ • ' +
      fmtNum(ch.customers || 0) + ' ลูกค้า' + trendChip(ch.trend) + '</div>' +
    '</button>';
}

function tileHtml(label: string, value: string, tip?: TipSpec): string {
  return '<div class="tile"' + tipAttrs(tip) + '>' + label + '<b>' + value + '</b></div>';
}

/** สเปกของ tooltip อธิบายสูตร: หัวข้อ / สูตร / คำอธิบาย / แหล่งข้อมูล */
interface TipSpec { title?: string; formula?: string; body?: string; src?: string; }
function tipAttrs(t?: TipSpec): string {
  if (!t) return '';
  let s = '';
  if (t.title) s += ' data-tip-title="' + esc(t.title) + '"';
  if (t.formula) s += ' data-tip-formula="' + esc(t.formula) + '"';
  if (t.src) s += ' data-tip-src="' + esc(t.src) + '"';
  // data-tip เป็นตัวกระตุ้นหลัก — ต้องมีเสมอ (ใช้ body ถ้ามี ไม่งั้นใช้ title)
  s += ' data-tip="' + esc(t.body || t.title || '') + '"';
  return s;
}

/** "ยังไม่ได้ตั้งตาราง ad_daily" — โชว์ "—" ไม่ใช่ 0 (0 จะอ่านเหมือนวัดแล้วได้ศูนย์) */
const AD_SETUP_HINT = 'ต้องรัน db/migrations/2026-07-23-ad-daily.sql ใน Supabase ก่อน ' +
  'แล้วรอ sync รอบถัดไป (ทุก 15 นาที)';

function adSpendTile(d: SalesData): string {
  const a = d.adCost;
  if (!a) return '<div class="tile" title="' + esc(AD_SETUP_HINT) + '">📣 ค่าแอด<b>—</b></div>';
  const when = a.syncedAt ? ' • สดถึง ' + relTime(a.syncedAt) : '';
  return '<div class="tile"' + tipAttrs({
    title: '📣 ค่าแอด', formula: 'Σ spend ทุกแอด (บาทจริง)',
    body: 'แอดที่กำลังยิง ' + fmtNum(a.activeAds || 0) + ' ตัว' + when +
      ' • ไม่ได้แยก FB/LINE จึงไม่เปลี่ยนตามช่องทางที่กรอง',
    src: 'Meta Ads (pages/statistics/ads)',
  }) + '>📣 ค่าแอด<b>' + THB(a.spend) + ' ' + trendChip(a.trend) + '</b></div>';
}

function roasTile(d: SalesData): string {
  const a = d.adCost;
  if (!a) return '<div class="tile" title="' + esc(AD_SETUP_HINT) + '">📊 ROAS<b>—</b></div>';
  if (a.roas === null || a.roas === undefined) {
    return '<div class="tile" title="ช่วงนี้ยังไม่มีค่าแอด — คำนวณ ROAS ไม่ได้">📊 ROAS<b>—</b></div>';
  }
  // ROAS < 1 = ขายได้น้อยกว่าค่าแอด
  const cls = a.roas >= 2 ? 'up' : (a.roas >= 1 ? '' : 'down');
  const prev = (a.roasPrev !== null && a.roasPrev !== undefined)
    ? ' <span style="font-size:11px;font-weight:600;color:var(--text-3)">(ก่อนหน้า ' + a.roasPrev.toFixed(2) + 'x)</span>'
    : '';
  return '<div class="tile"' + tipAttrs({
    title: '📊 ROAS (Meta)', formula: 'ยอดขายที่ Meta ตี ÷ ค่าแอด',
    body: 'ยอดขายจากแอด (Meta) ' + THB(a.adRevenueMeta || 0) + ' ÷ ค่าแอด ' + THB(a.spend) +
      ' • ตรงกับหน้า Meta Ads dashboard (ไม่ใช่ยอดรวมทุกช่องทาง)',
    src: 'Meta Ads (meta_purchase_value)',
  }) + '>📊 ROAS (Meta)<b' +
    (cls ? ' class="sr-' + cls + '"' : '') + '>' + a.roas.toFixed(2) + 'x' + prev + '</b></div>';
}

function adCloseTile(d: SalesData): string {
  const a = d.adCost;
  if (!a || a.adCloseRate === null || a.adCloseRate === undefined) {
    return '<div class="tile"' + tipAttrs({
      title: '🎯 %ปิดจากแอด (Meta)',
      body: 'ต้องรัน migration db/migrations/2026-07-24-ad-daily-meta-purchase.sql ก่อน' }) +
      '>🎯 %ปิดจากแอด<b>—</b></div>';
  }
  return '<div class="tile"' + tipAttrs({
    title: '🎯 %ปิดจากแอด (Meta)', formula: 'ซื้อ ÷ คนทักจากแอด',
    body: 'ซื้อ ' + fmtNum(a.adPurchases || 0) + ' ÷ คนทักจากแอด ' + fmtNum(a.adMsgs || 0) +
      ' • เฉพาะคนที่มาจากแอด (คนละตัวกับ %ปิดด้านบนที่นับลูกค้าทุกคน)',
    src: 'Meta Ads (meta_purchase ÷ messaging_started)',
  }) + '>🎯 %ปิดจากแอด (Meta)<b>' + pctFmt(a.adCloseRate) + '</b></div>';
}

/** ROAS แบบยอดขาย POS จริง — kind='new' (เฉพาะเพจที่ยิงแอด) | 'all' (ทั้ง Facebook) */
function roasPosTile(d: SalesData, kind: 'new' | 'all'): string {
  const a = d.adCost;
  const label = kind === 'new' ? '📊 ROAS ใหม่' : '📊 ROAS รวม';
  if (!a) return '<div class="tile" title="' + esc(AD_SETUP_HINT) + '">' + label + '<b>—</b></div>';
  const v = kind === 'new' ? a.roasNew : a.roasAll;
  if (v === null || v === undefined) {
    return '<div class="tile" title="ช่วงนี้ยังไม่มีค่าแอด — คำนวณ ROAS ไม่ได้">' + label + '<b>—</b></div>';
  }
  const cls = v >= 2 ? 'up' : (v >= 1 ? '' : 'down');
  const tip: TipSpec = kind === 'new'
    ? { title: '📊 ROAS ใหม่', formula: 'ยอดขายเฉพาะเพจที่ยิงแอด ÷ ค่าแอด',
        body: 'ยอดขาย POS ของเพจที่มีค่าแอด ' + THB(a.adPagesRev || 0) + ' ÷ ค่าแอด ' + THB(a.spend) +
          ' • นับเฉพาะเพจที่กำลังยิงแอด (ตัดเพจที่ไม่ได้ยิงออก)',
        src: 'ออเดอร์ POS จริง' }
    : { title: '📊 ROAS รวม', formula: 'ยอดขายทั้งหมดของ Facebook ÷ ค่าแอด',
        body: 'ยอดขาย POS ของ Facebook ทุกเพจ ' + THB((d.salesBreak && d.salesBreak.fb) || 0) +
          ' ÷ ค่าแอด ' + THB(a.spend) + ' • รวมเพจที่ไม่ได้ยิงแอดด้วย (blended / MER)',
        src: 'ออเดอร์ POS จริง' };
  return '<div class="tile"' + tipAttrs(tip) + '>' + label + '<b' +
    (cls ? ' class="sr-' + cls + '"' : '') + '>' + v.toFixed(2) + 'x</b></div>';
}

/**
 * แถว "แชทค้างรอตอบ" ในการ์ดธุรกิจวันนี้ — แยกอินบ็อกซ์/คอมเมนต์ให้เห็นว่าค้างตรงไหน
 * (แถว RATING ถูกรวมไว้ในอินบ็อกซ์ตั้งแต่ฝั่ง server — มีแค่หลักหน่วย ไม่คุ้มตั้งกลุ่มที่ 3)
 * นับจาก 24 ชม.ล่าสุด ไม่ใช่ "ตั้งแต่เที่ยงคืน" — บอกไว้ในทูลทิปกันเข้าใจผิด
 */
function waitingRowHtml(d: SalesData): string {
  const w = d.waiting;
  if (!w) return '';
  return '<div class="sr-today-row"' + tipAttrs({
    title: '⏰ แชทค้างรอตอบ',
    formula: 'บทสนทนาที่ลูกค้าทักล่าสุดแล้วเพจยังไม่ตอบ',
    body: 'อินบ็อกซ์ ' + fmtNum(w.inbox) + ' + คอมเมนต์ ' + fmtNum(w.comment) +
      ' • นับบทสนทนาที่ขยับใน 24 ชม.ล่าสุด (ไม่ใช่เฉพาะวันนี้) • คะแนนรีวิว (RATING) นับรวมในอินบ็อกซ์',
    src: 'ตาราง conversations (waiting=true)',
  }) + '><span>⏰ แชทค้างรอตอบ' +
      '<i class="sr-today-note">💬 อินบ็อกซ์ ' + fmtNum(w.inbox) +
        ' • 💭 คอมเมนต์ ' + fmtNum(w.comment) + '</i>' +
    '</span><b' + (Number(w.total) >= 10 ? ' class="sr-red"' : '') + '>' + fmtNum(w.total) + '</b></div>';
}

/**
 * กราฟรายชั่วโมง + ยัด data-prevlabel ให้ทูลทิป
 * charts.ts อ่าน data-prevlabel จากวง .ch-hit แต่ svgHourlyLine ไม่เคยส่งค่านี้ออกมา
 * → ทูลทิปขึ้นคำ default "ช่วงก่อนหน้า" เสมอ ทั้งที่อาจกำลังเทียบ 7/30 วันอยู่ (อ่านผิดง่ายมาก)
 * แทรก attribute ตรงนี้แทนการแก้ charts.ts เพราะกราฟตัวนั้นใช้ร่วมกับหน้าอื่น
 */
function hourlyChartHtml_(main: number[], prev: number[] | null, prevName: string): string {
  const svg = svgHourlyLine(main, prev);
  if (!prev) return svg;
  return svg.split('class="ch-hit"').join('class="ch-hit" data-prevlabel="' + esc(prevName) + '"');
}

/* ---------------- render ---------------- */

function render(container: HTMLElement, dArg?: SalesData | null): void {
  const d: SalesData = dArg || {};
  const k = d.kpis || {};
  const t = d.trends || {};
  const ch = d.channels || {};
  const fb = ch.facebook || {};
  const ln = ch.line || {};
  const today = d.today || {};
  const sources = d.sources || [];
  const alerts = d.alerts || [];
  const hourly = arr24(d.hourly);
  const hourlyPrev = d.hourlyPrev ? arr24(d.hourlyPrev) : null;
  const todayHourly = arr24(today.hourly);
  const rangeLabel = d.rangeLabel || '';

  /* --- 1. head --- */
  let html = '' +
    '<div class="sr-head">' +
      '<div>' +
        '<div class="sr-title">ภาพรวมยอดขาย</div>' +
        '<div class="sr-title-sub">' + esc(rangeLabel) + ' — ข้อมูลจริงจาก Pancake POS</div>' +
      '</div>' +
      '<div class="pg-controls" style="margin-bottom:0">' +
        rangeControlsHtml(state, 'sr') +
        // prev1/prev3 เพิ่มตามที่บอสสั่ง — เคส "วันนี้ + ช่วงก่อนหน้า" จะเทียบกับเมื่อวานแค่บางช่วง
        // (span = ชม.ที่ผ่านไปวันนี้) ถ้าอยากเทียบวันต่อวันเต็มๆ ให้เลือก "1 วันที่แล้ว"
        '<select class="input" id="sr-compare">' +
          '<option value="prev"' + (state.compare === 'prev' ? ' selected' : '') + '>เปรียบเทียบช่วงก่อนหน้า</option>' +
          '<option value="prev1"' + (state.compare === 'prev1' ? ' selected' : '') + '>เทียบ 1 วันที่แล้ว</option>' +
          '<option value="prev3"' + (state.compare === 'prev3' ? ' selected' : '') + '>เทียบ 3 วันที่แล้ว</option>' +
          '<option value="prev7"' + (state.compare === 'prev7' ? ' selected' : '') + '>เทียบ 7 วันที่แล้ว</option>' +
          '<option value="prev30"' + (state.compare === 'prev30' ? ' selected' : '') + '>เทียบ 30 วันที่แล้ว</option>' +
          '<option value="none"' + (state.compare === 'none' ? ' selected' : '') + '>ไม่เปรียบเทียบ</option>' +
        '</select>' +
        '<button class="btn" id="sr-reload" title="โหลดข้อมูลใหม่">⟳</button>' +
        '<button class="btn" id="sr-csv">📄 CSV</button>' +
        '<button class="btn" id="sr-xls" title="ไฟล์ Excel เปิดแล้วภาษาไทยไม่เพี้ยน">📊 Excel</button>' +
      '</div>' +
    '</div>';

  /* --- 2. KPI cards (2 ใบ — การ์ด "รายได้รวม" ถูกลบตามที่บอสสั่ง) --- */
  const closeRateBig = (k.closeRate === null || k.closeRate === undefined || isNaN(k.closeRate))
    ? '-'
    : (Math.round(Number(k.closeRate) * 10) / 10) +
      '%<span style="font-size:14px;font-weight:600;color:var(--text-2)"> ปิดการขาย</span>';

  // "1,429 (ยืนยันแล้ว 1,391)" — ตัวหลังคือตัวที่ Pancake นับ ให้บอสเทียบจอต่อจอได้
  function confirmedSuffix(kk: any): string {
    if (kk.confirmedOrders === null || kk.confirmedOrders === undefined) return '';
    return '<span style="font-size:13px;font-weight:600;color:var(--text-3)"> • ยืนยันแล้ว ' +
      fmtNum(kk.confirmedOrders) + '</span>';
  }

  function closeRateTip(kk: any): string {
    if (kk.closeBase === null || kk.closeBase === undefined)
      return 'ยังไม่ได้รัน migration db/migrations/2026-07-23-chat-engagement.sql — ตัวเลขนี้ต้องใช้ตาราง chat_engagement_daily';
    return 'ออเดอร์ที่สร้างจากแชท (' + fmtNum(kk.closeOrders || 0) +
      ') ÷ คนทัก (' + fmtNum(kk.closeBase || 0) + ') • ' +
      'คนทัก = อินบ็อกซ์ใหม่ ' + fmtNum(kk.closeNewInbox || 0) + ' + คอมเมนต์ ' + fmtNum(kk.closeComment || 0);
  }

  // แถบบอกช่องทางที่กำลังดู — default = Facebook จึงต้องบอกชัด ไม่ให้เข้าใจผิดว่าเป็นยอดรวมทุกช่องทาง
  if (state.channel) {
    html += '<div class="sr-chan-banner"' + tipAttrs({
      title: 'กำลังกรองช่องทาง',
      body: 'ยอดขาย / ออเดอร์ / %ปิด นับเฉพาะ ' + CH_LABELS[state.channel] +
        ' • ค่าแอด/ROAS เป็นของ Facebook เสมอ (แอดทั้งหมดอยู่บน FB) • คลิกช่องด้านล่าง (หรือ "ทั้งหมด") เพื่อเปลี่ยน',
    }) + '>👁 กำลังดูเฉพาะ <b>' + CH_LABELS[state.channel] + '</b>' +
      '<span class="sr-chan-hint">— ยอดขาย/ออเดอร์/%ปิด นับเฉพาะช่องทางนี้ • เปลี่ยนได้ที่ช่องด้านล่าง</span></div>';
  }
  html += '<div class="sr-cards">' +
    '<div class="sr-card"' + tipAttrs({
      title: '🛒 คำสั่งซื้อ',
      formula: 'นับออเดอร์ที่มีสินค้าจริง',
      body: 'ตัดออเดอร์เปล่าที่ Pancake สร้างให้ทุกแชทจากแอดทิ้งแล้ว • "ยืนยันแล้ว" = ออเดอร์ที่แอดมินกดยืนยัน = ตัวที่ Pancake นับเป็น "สร้างคำสั่งซื้อ"',
      src: 'ออเดอร์ POS จริง',
    }) + '>' +
      '<div class="label">🛒 คำสั่งซื้อ</div>' +
      '<div class="big">' + fmtNum(k.orders || 0) + confirmedSuffix(k) + '</div>' +
      '<div class="foot">📘 ' + THB(fb.revenue || 0) + ' • 🟢 ' + THB(ln.revenue || 0) +
        // "ต้องตรวจ" กดได้ → เปิดตารางรายออเดอร์ (เดิมเป็นตัวเลขเฉยๆ ไม่รู้ว่าใบไหน)
        (Number(k.needCheck) > 0
          ? ' <button type="button" class="sr-needcheck" data-needcheck="range"' +
              ' title="คลิกดูรายออเดอร์ที่ยังไม่ยืนยัน">⚠ ต้องตรวจ ' + fmtNum(k.needCheck) + '</button>'
          : ' ✓ ไม่มีค้างตรวจ') +
        trendChip(t.orders) +
      '</div>' +
    '</div>' +
    '<div class="sr-card"' + tipAttrs({
      title: '🎯 % ปิดการขาย',
      formula: 'ออเดอร์ที่สร้างจากแชท ÷ คนทัก',
      body: closeRateTip(k),
      src: 'Pancake statistics/customer_engagements',
    }) + '>' +
      '<div class="label">🎯 % ปิดการขาย (ต่อคนทัก)</div>' +
      '<div class="big">' + closeRateBig + '</div>' +
      '<div class="foot">ยอดขายจากแอด ' + THB(k.adRevenue || 0) +
        ' • เฉลี่ย ' + THB(k.avgOrder || 0) + '/ออเดอร์</div>' +
    '</div>' +
  '</div>';

  /* --- 3. channel boxes (คลิกเพื่อกรอง — server-side) --- */
  html += '<div class="sr-channels">' +
    chBoxHtml('', ch.all) +
    chBoxHtml('facebook', fb) +
    chBoxHtml('line', ln) +
  '</div>';

  /* --- 4. KPI strip --- */
  const rr = d.returning;
  const retTile = rr
    ? '<div class="tile" title="ลูกค้าในช่วงที่เลือกที่เคยซื้อภายใน 95 วันก่อนหน้า — ' +
        esc(fmtNum(rr.returning) + ' จาก ' + fmtNum(rr.total) + ' คน') + '">🔁 ลูกค้าเก่า (95 วัน)<b>' +
        fmtNum(rr.returning) +
        (rr.pct !== null && rr.pct !== undefined
          ? ' <span style="font-size:11px;font-weight:600;color:var(--text-3)">(' + rr.pct + '%)</span>'
          : '') +
      '</b></div>'
    : '<div class="tile" title="ต้องรัน SQL migration (db/migrations/2026-07-11-sprint2.sql) ใน Supabase ก่อน">🔁 ลูกค้าเก่า (95 วัน)<b>—</b></div>';
  // ยอดขายแยกช่องทาง (ไม่ขึ้นกับ channel filter — โชว์ครบเสมอ ตามที่บอสสั่ง)
  const sb = d.salesBreak || { total: 0, fb: 0, line: 0 };
  html += '<div class="sr-strip">' +
    tileHtml('🧾 ยอดขายรวม (เพจ+ไลน์)', THB(sb.total || 0), {
      title: '🧾 ยอดขายรวม (เพจ+ไลน์)', formula: 'ยอดขายเพจ + ยอดขายไลน์',
      body: 'เพจ (Facebook) ' + THB(sb.fb || 0) + ' + ไลน์ ' + THB(sb.line || 0) +
        ' • เฉพาะยืนยันแล้ว • ไม่ขึ้นกับช่องทางที่กรอง', src: 'ออเดอร์ POS จริง (ยืนยันแล้ว)' }) +
    tileHtml('📘 ยอดขายเพจ', THB(sb.fb || 0), {
      title: '📘 ยอดขายเพจ (Facebook)', formula: 'Σ ยอดขาย FB "ยืนยันแล้ว"',
      body: 'เฉพาะ Facebook ที่ยืนยันแล้ว (ตรง Pancake) • ตัวตั้งของ ROAS รวม', src: 'ออเดอร์ POS จริง (ยืนยันแล้ว)' }) +
    tileHtml('🟢 ยอดขายไลน์', THB(sb.line || 0), {
      title: '🟢 ยอดขายไลน์ (LINE OA)', formula: 'Σ ยอดขาย LINE "ยืนยันแล้ว"',
      body: 'เฉพาะ LINE OA ที่ยืนยันแล้ว', src: 'ออเดอร์ POS จริง (ยืนยันแล้ว)' }) +
    tileHtml('🛒 ออเดอร์', fmtNum(k.orders || 0), {
      title: '🛒 ออเดอร์', formula: 'นับออเดอร์ที่มีสินค้าจริง',
      body: 'ตัดออเดอร์เปล่าที่ Pancake สร้างให้ทุกแชทจากแอด', src: 'ออเดอร์ POS จริง' }) +
    tileHtml('👥 ลูกค้า', fmtNum(k.customers || 0), {
      title: '👥 ลูกค้า', formula: 'นับ customer_id ไม่ซ้ำ',
      body: 'จำนวนลูกค้าที่มีออเดอร์ในช่วงนี้ (คนเดียวสั่งหลายครั้งนับ 1)' }) +
    tileHtml('💵 เฉลี่ย/ออเดอร์', THB(k.avgOrder || 0), {
      title: '💵 เฉลี่ย/ออเดอร์', formula: 'ยอดขายยืนยันแล้ว ÷ ออเดอร์ยืนยันแล้ว',
      body: 'มูลค่าเฉลี่ยต่อ 1 ออเดอร์ที่ปิดการขายแล้ว' }) +
    tileHtml('✅ ยืนยันแล้ว', k.confirmedOrders === null || k.confirmedOrders === undefined ? '—' : fmtNum(k.confirmedOrders), {
      title: '✅ ยืนยันแล้ว', formula: 'ออเดอร์สถานะ "ยืนยันแล้ว" (status=1)',
      body: 'ตัวที่ Pancake นับเป็น "สร้างคำสั่งซื้อ" — เอาไว้เทียบจอ Pancake' }) +
    tileHtml('🎯 %ปิดการขาย', pctFmt(k.closeRate), {
      title: '🎯 %ปิดการขาย', formula: 'ออเดอร์ที่สร้างจากแชท ÷ คนทัก',
      body: 'คนทัก = อินบ็อกซ์ใหม่ + คอมเมนต์ (คนที่ทักเข้ามาจริง ไม่ใช่ลูกค้าเก่าที่คุยต่อ)',
      src: 'Pancake statistics/customer_engagements' }) +
    tileHtml('💬 คนทัก', k.closeBase === null || k.closeBase === undefined ? '—' : fmtNum(k.closeBase), {
      title: '💬 คนทัก', formula: 'อินบ็อกซ์ใหม่ + คอมเมนต์',
      body: 'ตัวหารของ %ปิดการขาย = อินบ็อกซ์ใหม่ ' + fmtNum(k.closeNewInbox || 0) +
        ' + คอมเมนต์ ' + fmtNum(k.closeComment || 0) + ' • ลูกค้าที่คุยทั้งหมด ' + fmtNum(k.engTotal || 0),
      src: 'Pancake statistics/customer_engagements' }) +
    tileHtml('📨 อินบ็อกซ์ใหม่', k.closeNewInbox === null || k.closeNewInbox === undefined ? fmtNum(k.newConvs || 0) : fmtNum(k.closeNewInbox), {
      title: '📨 อินบ็อกซ์ใหม่', formula: 'customer_engagement_new_inbox',
      body: 'ลูกค้าที่เปิดบทสนทนาอินบ็อกซ์ใหม่ในช่วงนี้', src: 'Pancake statistics/customer_engagements' }) +
    retTile +
    adSpendTile(d) +
    roasPosTile(d, 'new') +
    roasPosTile(d, 'all') +
    roasTile(d) +
    adCloseTile(d) +
  '</div>';

  /* --- 5. main: กราฟรายชั่วโมง + ข้อมูลธุรกิจวันนี้ --- */
  // ชื่อ + ช่วงจริงของหน้าต่างเทียบ (server คำนวณให้) — ต้องบอกเสมอ ไม่งั้นคนอ่านนึกว่าเทียบ "เมื่อวานทั้งวัน"
  // ทั้งที่ preset=today + ช่วงก่อนหน้า จะเทียบแค่ "เมื่อวานช่วงเดียวกับที่ผ่านไปวันนี้"
  const prevName = d.prevLabel || 'ช่วงก่อนหน้า';
  const prevWin = d.prevWindow ? ' (' + esc(d.prevWindow) + ')' : '';
  const legend = '<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center;font-size:11.5px;color:var(--text-3);margin-top:8px">' +
    '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#6c5ce7;margin-right:6px;vertical-align:middle"></span>ช่วงที่เลือก</span>' +
    (hourlyPrev
      ? '<span><span style="display:inline-block;width:18px;height:0;border-top:2px dashed #5b6478;margin-right:6px;vertical-align:middle"></span>' +
        esc(prevName) + prevWin + '</span>'
      : '') +
    '<span>ชี้ที่จุดบนเส้นเพื่อดูยอดแต่ละชั่วโมง</span>' +
  '</div>';

  html += '<div class="sr-main">' +
    '<div class="card">' +
      '<h3>📈 ยอดขายรายชั่วโมง</h3>' +
      '<div class="card-sub">' + esc(rangeLabel) +
        (hourlyPrev ? ' — เส้นประ = ' + esc(prevName) + prevWin : '') + '</div>' +
      hourlyChartHtml_(hourly, hourlyPrev, prevName) +
      legend +
    '</div>' +
    '<div class="card sr-live">' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:3px">' +
        '<h3 style="margin:0">🏪 ธุรกิจวันนี้</h3>' +
        '<span class="badge live-now">LIVE วันนี้</span>' +
      '</div>' +
      '<div class="card-sub">ตัวเลขจริงของ<b>วันนี้</b>แบบเรียลไทม์ — <b>ไม่ขึ้นกับตัวกรอง 📅 ด้านบน</b></div>' +
      '<div class="sr-green" style="font-size:26px;font-weight:800;letter-spacing:-0.5px">' + THB(today.revenue || 0) + '</div>' +
      '<div style="font-size:12px;color:var(--text-3)">' + fmtNum(today.orders || 0) + ' ออเดอร์วันนี้</div>' +
      miniBars(todayHourly) +
      '<div class="sr-today-row"><span>📘 Facebook</span><b>' + THB(today.fb || 0) + '</b></div>' +
      '<div class="sr-today-row"><span>🟢 LINE OA</span><b>' + THB(today.line || 0) + '</b></div>' +
      '<div class="sr-today-row"><span>🆕 ลูกค้าใหม่</span><b>' + fmtNum(today.newCust || 0) + ' คน</b></div>' +
      '<div class="sr-today-row"><span>⚠ ออเดอร์ที่ต้องตรวจ</span>' +
        (Number(today.needCheck) > 0
          ? '<button type="button" class="sr-needcheck" data-needcheck="today"' +
            ' title="คลิกดูรายออเดอร์ที่ยังไม่ยืนยัน">' + fmtNum(today.needCheck) + '</button>'
          : '<b>0</b>') +
      '</div>' +
      waitingRowHtml(d) +
    '</div>' +
  '</div>';

  /* --- 5.5 Top 10 สินค้า / เพจ (ตามช่องทางที่กรองอยู่) --- */
  const topCh = d.top ? (state.channel ? d.top[state.channel] : d.top.all) : null;
  if (topCh) {
    const prodRows = (topCh.products || []).map(function (p: any) {
      return {
        label: p.name,
        value: p.value || p.qty,
        display: p.value ? THB(p.value) : fmtNum(p.qty) + ' ชิ้น',
        attr: 'data-drill-prod="' + esc(p.name) + '" title="คลิกดูว่าขายได้เพจไหนบ้าง"',
      };
    });
    // การ์ดขวา = ยอดขายจัดกลุ่มตามยูนิต (U/สินค้า) — เหมือนที่ทีมแอดจัด (แผนที่ใน U Map)
    // เป็นตารางไม่ใช่กราฟแท่ง เพราะทีมต้องเทียบ ยอด/ค่าแอด/ROAS/ค่าทัก/%ปิด พร้อมกันในบรรทัดเดียว
    const units = (topCh.units || []);
    const unitTable = units.map(function (u: any) {
      const label = u.mapped
        ? esc(u.product || u.u) + (u.u ? ' <span class="chip">' + esc(u.u) + '</span>' : '')
        : '⚠️ ยังไม่จัดกลุ่ม';
      // ROAS ต่ำกว่า 1 = ขายได้ไม่คุ้มค่าแอด ต้องเห็นแต่ไกล
      const roasCls = u.roas === null || u.roas === undefined ? '' : (u.roas < 1 ? 'txt-bad' : (u.roas >= 3 ? 'txt-good' : ''));
      return '<tr class="clickable' + (u.mapped ? '' : ' sr-unmapped') + '" data-drill-unit="' + esc(u.key) + '"' +
        ' title="คลิกดูรายเพจ + ยอดรายสัปดาห์ของยูนิตนี้">' +
        '<td>' + label + '</td>' +
        '<td class="num">' + THB(u.revenue) + '</td>' +
        '<td class="num">' + (u.share === null ? '—' : pctFmt(u.share)) + '</td>' +
        '<td class="num">' + (u.spend ? THB(u.spend) : '—') + '</td>' +
        '<td class="num ' + roasCls + '">' + (u.roas === null ? '—' : u.roas.toFixed(2)) + '</td>' +
        '<td class="num">' + (u.costPerMsg === null ? '—' : THB(u.costPerMsg)) + '</td>' +
        '<td class="num">' + (u.closeRate === null ? '—' : pctFmt(u.closeRate)) + '</td>' +
        '</tr>';
    }).join('');
    const pageCount = (topCh.pagesFull || []).length;
    html += '<div class="sr-bottom">' +
      '<div class="card">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">' +
          '<h3>📦 สินค้าขายดี Top 10</h3>' +
          '<button class="btn-mini" id="sr-drill">🔍 ดูรายละเอียด</button>' +
        '</div>' +
        '<div class="card-sub">' + esc(rangeLabel) + ' • ' + CH_LABELS[state.channel] +
          ' — มูลค่า = ราคาขาย × จำนวน (ยังไม่หักส่วนลดท้ายบิล) • 👆 คลิกสินค้าเพื่อดูรายเพจ</div>' +
        '<div class="hbar-wide">' + hbarRows(prodRows, { empty: 'ยังไม่มีข้อมูลสินค้าในช่วงนี้' }) + '</div>' +
      '</div>' +
      '<div class="card">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">' +
          '<h3>🧩 ยอดขายตามยูนิต (สินค้า)</h3>' +
          (pageCount > 0 ? '<button class="btn-mini" id="sr-allpages">📋 ดูทุกเพจ (' + fmtNum(pageCount) + ')</button>' : '') +
        '</div>' +
        '<div class="card-sub">' + esc(rangeLabel) + ' • ' + CH_LABELS[state.channel] +
          ' — ค่าแอดจริงจาก Meta • ค่าทัก = ค่าแอด ÷ บทสนทนาที่แอดเปิดได้ • %ปิด = ออเดอร์จากแชท ÷ คนทัก' +
          ' • 👆 คลิกยูนิตเพื่อดูรายเพจ + ยอดรายสัปดาห์</div>' +
        (unitTable
          ? '<div class="table-scroll"><table class="tbl"><thead><tr><th>ยูนิต</th><th class="num">ยอดขาย</th>' +
            '<th class="num">สัดส่วน</th><th class="num">ค่าแอด</th><th class="num">ROAS</th>' +
            '<th class="num">ค่าทัก</th><th class="num">%ปิด</th></tr></thead><tbody>' + unitTable + '</tbody></table></div>'
          : '<div class="empty-note">ยังไม่มีออเดอร์ในช่วงนี้</div>') +
      '</div>' +
    '</div>';
  }

  /* --- 6. bottom: แหล่งที่มา + แจ้งเตือน --- */
  const srcRows = sources.map(function (s: any) {
    const st = s.status || {};
    return '<tr>' +
      '<td>' + esc(s.label) + '</td>' +
      '<td>' + THB(s.revenue || 0) + '</td>' +
      '<td>' + fmtNum(s.orders || 0) + '</td>' +
      '<td>' + fmtNum(s.customers || 0) + '</td>' +
      '<td>' + pctFmt(s.closeRate) + '</td>' +
      '<td><span class="badge ' + esc(st.cls || 'neutral') + '">' + esc(st.label || '—') + '</span></td>' +
    '</tr>';
  }).join('');

  const statusPills = (d.statusBreakdown || []).map(function (b: any) {
    const nm = String(b.name || '');
    const cls = (nm.indexOf('ยกเลิก') >= 0 || nm.indexOf('ตีกลับ') >= 0) ? 'urgent' : 'neutral';
    return '<span class="badge ' + cls + '">' + esc(nm) + ' ' + fmtNum(b.count || 0) + '</span>';
  }).join('');

  let alertsHtml;
  if (!alerts.length) {
    alertsHtml = '<div class="empty-note">✓ วันนี้ไม่มีอะไรต้องตรวจเป็นพิเศษ</div>';
  } else {
    alertsHtml = '<div class="alert-list">' + alerts.map(function (a: any) {
      const lv = (a.level === 'red' || a.level === 'orange' || a.level === 'yellow' || a.level === 'green')
        ? a.level : 'yellow';
      return '<div class="alert-row lv-' + lv + '">' +
        '<div class="alert-icon">' + esc(a.icon || '🔔') + '</div>' +
        '<div class="alert-body">' +
          '<div class="alert-title">' + esc(a.title) + '</div>' +
          '<div class="alert-reason">' + esc(a.reason) + '</div>' +
          // drill = เปิด modal ในหน้าเดิม (แจ้งเตือนออเดอร์รอตรวจเคยชี้ view:'sales' = หน้าเดียวกัน กดแล้วไม่เกิดอะไร)
          (a.drill === 'needcheck'
            ? '<div style="margin-top:6px"><button class="btn-mini" data-needcheck="today">ดูรายละเอียด →</button></div>'
            : a.view && VIEW_META[a.view]
              ? '<div style="margin-top:6px"><button class="btn-mini" data-goview="' + esc(a.view) + '">ดูรายละเอียด →</button></div>'
              : '') +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  html += '<div class="sr-bottom">' +
    '<div class="card">' +
      '<h3>🧭 แหล่งที่มาของคำสั่งซื้อ</h3>' +
      '<div class="card-sub">รายได้ • ออเดอร์ • สถานะของแต่ละช่องทาง</div>' +
      (sources.length
        ? '<div class="table-scroll"><table class="tbl"><thead><tr>' +
            '<th>แหล่งที่มา</th><th>รายได้</th><th>ออเดอร์</th><th>ลูกค้า</th><th>% ปิด</th><th>สถานะ</th>' +
          '</tr></thead><tbody>' + srcRows + '</tbody></table></div>'
        : '<div class="empty-note">ยังไม่มีคำสั่งซื้อในช่วงเวลานี้</div>') +
      (statusPills
        ? '<div class="pill-grid" style="margin:12px 0 0">' + statusPills + '</div>'
        : '') +
    '</div>' +
    '<div class="card">' +
      '<h3>🔔 สิ่งที่ควรตรวจวันนี้</h3>' +
      '<div class="card-sub">แจ้งเตือนจากตัวเลขจริง (สูงสุด 3 รายการ)</div>' +
      alertsHtml +
    '</div>' +
  '</div>';

  container.innerHTML = html;
  bindEvents(container);
}

/* ---------------- events ---------------- */

function bindEvents(container: HTMLElement): void {
  bindRangeControls(container, state, 'sr', function () {
    refetch(container);
  });

  const cmp = container.querySelector('#sr-compare') as HTMLSelectElement | null;
  if (cmp) cmp.addEventListener('change', function () {
    state.compare = cmp.value;
    refetch(container);
  });

  const csvBtn = container.querySelector('#sr-csv');
  if (csvBtn) csvBtn.addEventListener('click', exportCsv);

  const xlsBtn = container.querySelector('#sr-xls');
  if (xlsBtn) xlsBtn.addEventListener('click', exportXls);

  const reloadBtn = container.querySelector('#sr-reload');
  if (reloadBtn) reloadBtn.addEventListener('click', function () {
    toast('⟳ กำลังโหลดข้อมูลใหม่...');
    refetch(container);
  });

  container.querySelectorAll('[data-ch]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const key = btn.getAttribute('data-ch') || '';
      if (state.channel === key) return;
      state.channel = key;
      toast('🔎 กรองช่องทาง: ' + CH_LABELS[key]);
      refetch(container);
    });
  });

  container.querySelectorAll('[data-goview]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      App.switchView(btn.getAttribute('data-goview')!);
    });
  });

  const drillBtn = container.querySelector('#sr-drill');
  if (drillBtn) drillBtn.addEventListener('click', openDrill);

  // คลิกเจาะรายเพจ/รายสินค้าจากวิดเจ็ต Top 10 (ตามช่องทางที่กรองอยู่)
  bindDrillRows(container, state.channel);
  const allPagesBtn = container.querySelector('#sr-allpages');
  if (allPagesBtn) allPagesBtn.addEventListener('click', function () { openAllPages(state.channel); });

  // "ออเดอร์ที่ต้องตรวจ" กดได้ทุกจุด (การ์ดคำสั่งซื้อ / การ์ดธุรกิจวันนี้ / ปุ่มในแจ้งเตือน)
  container.querySelectorAll('[data-needcheck]').forEach(function (el) {
    el.addEventListener('click', function () {
      openNeedCheckDrill(el.getAttribute('data-needcheck') === 'today' ? 'today' : 'range');
    });
  });

  bindChartTips(container); // ทูลทิป hover ของกราฟยอดขายรายชั่วโมง
}

/* ---------------- drilldown modal (Top 5 เพจ / สินค้า ต่อช่องทาง) ---------------- */

function drillBodyHtml(chKey: string): string {
  const d = lastData || {};
  const top = d.top || {};
  const t = (chKey ? top[chKey] : top.all) || { pages: [], products: [] };
  const chs = d.channels || {};
  const c = (chKey ? chs[chKey] : chs.all) || {};
  const sum = '<div class="pill-grid" style="margin-bottom:12px">' +
    '<span class="chip">💰 ' + THB(c.revenue || 0) + '</span>' +
    '<span class="chip">🛒 ' + fmtNum(c.orders || 0) + ' ออเดอร์</span>' +
    '<span class="chip">👥 ' + fmtNum(c.customers || 0) + ' ลูกค้า</span>' +
  '</div>';
  const pages = t.pages || [];
  const products = t.products || [];
  const pageTbl = pages.length
    ? '<div class="table-scroll"><table class="tbl"><thead><tr>' +
        '<th>#</th><th>เพจ</th><th>รายได้</th><th>ออเดอร์</th></tr></thead><tbody>' +
      pages.slice(0, 5).map(function (p: any, i: number) {
        return '<tr><td>' + (i + 1) + '</td><td>' + esc(p.name) + '</td><td>' + THB(p.revenue) +
          '</td><td>' + fmtNum(p.orders) + '</td></tr>';
      }).join('') + '</tbody></table></div>'
    : '<div class="empty-note">ยังไม่มีออเดอร์ในช่วงนี้</div>';
  const prodTbl = products.length
    ? '<div class="table-scroll"><table class="tbl"><thead><tr>' +
        '<th>#</th><th>สินค้า</th><th>จำนวน</th><th>มูลค่า*</th><th>ในกี่ออเดอร์</th></tr></thead><tbody>' +
      products.slice(0, 5).map(function (p: any, i: number) {
        return '<tr><td>' + (i + 1) + '</td><td>' + esc(p.name) + '</td><td>' + fmtNum(p.qty) +
          '</td><td>' + (p.value ? THB(p.value) : '-') + '</td><td>' + fmtNum(p.orders) + '</td></tr>';
      }).join('') + '</tbody></table></div>'
    : '<div class="empty-note">ยังไม่มีข้อมูลสินค้าในช่วงนี้</div>';
  return sum +
    '<h4 style="margin:8px 0 6px">📄 Top 5 เพจ</h4>' + pageTbl +
    '<h4 style="margin:14px 0 6px">📦 Top 5 สินค้า</h4>' + prodTbl +
    '<div style="font-size:11px;color:var(--text-3);margin-top:10px">' +
      '*มูลค่าสินค้า = ราคาขาย × จำนวน (ยังไม่หักส่วนลดท้ายบิล — รายได้จริงดูที่ระดับออเดอร์)</div>';
}

function openDrill(): void {
  if (!lastData || !lastData.top) { toast('ยังไม่มีข้อมูลสำหรับดูรายละเอียด'); return; }
  let ch = state.channel;
  const chips = ['', 'facebook', 'line'].map(function (k) {
    return '<button class="filter-btn' + (ch === k ? ' active' : '') + '" data-drill-ch="' + k + '">' +
      CH_LABELS[k] + '</button>';
  }).join('');
  openModal(
    '<div class="modal-head"><h3>🔍 รายละเอียดยอดขาย — ' + esc(lastData.rangeLabel || '') + '</h3>' +
      '<button class="modal-close">✕</button></div>' +
    '<div class="conv-filters" style="margin-bottom:12px">' + chips + '</div>' +
    '<div id="drill-body">' + drillBodyHtml(ch) + '</div>'
  );
  const root = document.getElementById('modal-root')!;
  root.querySelectorAll('[data-drill-ch]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      ch = btn.getAttribute('data-drill-ch') || '';
      root.querySelectorAll('[data-drill-ch]').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-drill-ch') === ch);
      });
      const body = root.querySelector('#drill-body');
      if (body) body.innerHTML = drillBodyHtml(ch);
    });
  });
}

/* ---------------- drilldown ไขว้: เพจ↔สินค้า (คลิกจากวิดเจ็ต Top 10) ---------------- */

function topOf(chKey: string): any {
  const t = (lastData && lastData.top) || {};
  return (chKey ? t[chKey] : t.all) || { pagesFull: [], pageProducts: {}, productPages: {}, units: [] };
}

function drillNote(): string {
  return '<div style="font-size:11px;color:var(--text-3);margin-top:10px">' +
    '*มูลค่าสินค้า = ราคาขาย × จำนวน (ยังไม่หักส่วนลดท้ายบิล — รายได้จริงดูที่ระดับออเดอร์)</div>';
}

/** ผูกคลิกให้แถว/แถวตารางที่มี data-drill-page / data-drill-prod (ใช้ทั้งวิดเจ็ตหลักและใน modal) */
function bindDrillRows(root: ParentNode | null, chKey: string): void {
  if (!root) return;
  root.querySelectorAll('[data-drill-prod]').forEach(function (el) {
    el.addEventListener('click', function () {
      openProductDrill(el.getAttribute('data-drill-prod') || '', chKey);
    });
  });
  root.querySelectorAll('[data-drill-page]').forEach(function (el) {
    el.addEventListener('click', function () {
      openPageDrill(el.getAttribute('data-drill-page') || '', chKey);
    });
  });
  root.querySelectorAll('[data-drill-unit]').forEach(function (el) {
    el.addEventListener('click', function () {
      openUnitDrill(el.getAttribute('data-drill-unit') || '', chKey);
    });
  });
}

/** ยูนิต (สินค้า) → เพจในยูนิตนั้นขายได้เท่าไร (คลิกเพจเจาะดูสินค้าต่อได้) */
/** ยอดขายรายสัปดาห์ของยูนิต — แท่งเทียบกันในช่วงที่เลือก (บรีฟ: "ยอดขายรายสัปดาห์ของเดือน") */
function weeklyBlock_(weekly: any[]): string {
  if (!weekly || weekly.length < 2) return '';   // สัปดาห์เดียวไม่มีอะไรให้เทียบ
  const items = weekly.map(function (w: any) {
    const d = String(w.week || '').slice(5).split('-');   // 'YYYY-MM-DD' → ['MM','DD']
    return {
      label: 'สัปดาห์ ' + (d.length === 2 ? d[1] + '/' + d[0] : String(w.week || '')),
      value: w.revenue || 0,
      display: THB(w.revenue),
    };
  });
  return '<h4 style="margin:6px 0">📅 ยอดขายรายสัปดาห์ (วันที่กำกับ = วันจันทร์ต้นสัปดาห์)</h4>' +
    '<div class="hbar-wide" style="margin-bottom:12px">' + hbarRows(items) + '</div>';
}

function openUnitDrill(unitKey: string, chKey: string): void {
  const top = topOf(chKey);
  const unit = (top.units || []).filter(function (u: any) { return String(u.key) === String(unitKey); })[0];
  if (!unit) { toast('ไม่พบยูนิตนี้'); return; }
  const pages = unit.pages || [];
  const title = unit.mapped ? (esc(unit.product || unit.u) + (unit.u ? ' <span class="chip">' + esc(unit.u) + '</span>' : '')) : '⚠️ ยังไม่จัดกลุ่ม';
  const rows = pages.map(function (p: any, i: number) {
    return '<tr class="clickable" data-drill-page="' + esc(p.name) + '" title="คลิกดูสินค้าของเพจนี้">' +
      '<td>' + (i + 1) + '</td><td>' + esc(p.name) + '</td><td>' + THB(p.revenue) +
      '</td><td>' + fmtNum(p.orders) + '</td></tr>';
  }).join('');
  openModal(
    '<div class="modal-head"><h3>🧩 ' + title + '</h3><button class="modal-close">✕</button></div>' +
    '<div class="card-sub" style="margin-bottom:10px">' + esc((lastData && lastData.rangeLabel) || '') +
      ' • ' + CH_LABELS[chKey] + '</div>' +
    '<div class="pill-grid" style="margin-bottom:12px">' +
      '<span class="chip">💰 ' + THB(unit.revenue) + '</span>' +
      '<span class="chip">🛒 ' + fmtNum(unit.orders) + ' ออเดอร์</span>' +
      '<span class="chip">📄 ' + fmtNum(pages.length) + ' เพจ</span>' +
      (unit.share === null ? '' : '<span class="chip">🧮 สัดส่วน ' + pctFmt(unit.share) + '</span>') +
      (unit.spend ? '<span class="chip">📣 ค่าแอด ' + THB(unit.spend) + '</span>' : '') +
      (unit.roas === null ? '' : '<span class="chip">📈 ROAS ' + unit.roas.toFixed(2) + '</span>') +
      (unit.afterAds === null ? '' : '<span class="chip">💵 หลังหักค่าแอด ' + THB(unit.afterAds) + '</span>') +
      (unit.costPerMsg === null ? '' : '<span class="chip">💬 ค่าทัก ' + THB(unit.costPerMsg) + '</span>') +
      (unit.reached ? '<span class="chip">🙋 คนทัก ' + fmtNum(unit.reached) + '</span>' : '') +
      (unit.closeRate === null ? '' : '<span class="chip">🎯 %ปิด ' + pctFmt(unit.closeRate) + '</span>') +
      '</div>' +
    (unit.mapped ? '' : '<div class="hint-box" style="margin-bottom:10px">เพจกลุ่มนี้ยังไม่ถูกจับคู่กับยูนิต — ' +
      'ไปจับคู่ได้ที่หน้า <b>U Map</b> เพื่อให้รวมยอดถูกกลุ่ม</div>') +
    weeklyBlock_(unit.weekly || []) +
    '<h4 style="margin:6px 0">📄 เพจในยูนิตนี้ (คลิกเพจเพื่อดูสินค้าที่ขายได้)</h4>' +
    (pages.length
      ? '<div class="table-scroll"><table class="tbl"><thead><tr><th>#</th><th>เพจ</th><th>รายได้</th>' +
        '<th>ออเดอร์</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<div class="empty-note">ไม่มีเพจในยูนิตนี้</div>')
  );
  bindDrillRows(document.getElementById('modal-root'), chKey);
}

/** สินค้า → ขายได้จากเพจไหนบ้าง (คลิกเพจเจาะต่อได้) */
function openProductDrill(prodName: string, chKey: string): void {
  const top = topOf(chKey);
  const pages = (top.productPages && top.productPages[prodName]) || [];
  const totVal = pages.reduce(function (s: number, p: any) { return s + (p.value || 0); }, 0);
  const totQty = pages.reduce(function (s: number, p: any) { return s + (p.qty || 0); }, 0);
  const totOrd = pages.reduce(function (s: number, p: any) { return s + (p.orders || 0); }, 0);
  const rows = pages.map(function (p: any, i: number) {
    return '<tr class="clickable" data-drill-page="' + esc(p.page) + '" title="คลิกดูสินค้าของเพจนี้">' +
      '<td>' + (i + 1) + '</td><td>' + esc(p.page) + '</td><td>' + THB(p.value) +
      '</td><td>' + fmtNum(p.qty) + '</td><td>' + fmtNum(p.orders) + '</td></tr>';
  }).join('');
  openModal(
    '<div class="modal-head"><h3>📦 ' + esc(prodName) + '</h3><button class="modal-close">✕</button></div>' +
    '<div class="card-sub" style="margin-bottom:10px">' + esc((lastData && lastData.rangeLabel) || '') +
      ' • ' + CH_LABELS[chKey] + '</div>' +
    '<div class="pill-grid" style="margin-bottom:12px">' +
      '<span class="chip">💰 ' + THB(totVal) + '</span>' +
      '<span class="chip">📦 ' + fmtNum(totQty) + ' ชิ้น</span>' +
      '<span class="chip">🛒 ' + fmtNum(totOrd) + ' ออเดอร์</span></div>' +
    '<h4 style="margin:6px 0">🏬 ขายได้จากเพจ (คลิกเพจเพื่อดูสินค้าอื่นของเพจนั้น)</h4>' +
    (pages.length
      ? '<div class="table-scroll"><table class="tbl"><thead><tr><th>#</th><th>เพจ</th><th>มูลค่า*</th>' +
        '<th>จำนวน</th><th>ออเดอร์</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<div class="empty-note">ไม่มีข้อมูลเพจสำหรับสินค้านี้</div>') +
    drillNote()
  );
  bindDrillRows(document.getElementById('modal-root'), chKey);
}

/** เพจ → สินค้าที่ขายได้ (คลิกสินค้าเจาะต่อได้) */
function openPageDrill(pageName: string, chKey: string): void {
  const top = topOf(chKey);
  const prods = (top.pageProducts && top.pageProducts[pageName]) || [];
  const info = (top.pagesFull || []).filter(function (p: any) { return p.name === pageName; })[0] ||
    { revenue: 0, orders: 0 };
  const rows = prods.map(function (p: any, i: number) {
    return '<tr class="clickable" data-drill-prod="' + esc(p.name) + '" title="คลิกดูว่าขายได้เพจไหนอีก">' +
      '<td>' + (i + 1) + '</td><td>' + esc(p.name) + '</td><td>' + THB(p.value) +
      '</td><td>' + fmtNum(p.qty) + '</td><td>' + fmtNum(p.orders) + '</td></tr>';
  }).join('');
  openModal(
    '<div class="modal-head"><h3>📄 ' + esc(pageName) + '</h3><button class="modal-close">✕</button></div>' +
    '<div class="card-sub" style="margin-bottom:10px">' + esc((lastData && lastData.rangeLabel) || '') +
      ' • ' + CH_LABELS[chKey] + '</div>' +
    '<div class="pill-grid" style="margin-bottom:12px">' +
      '<span class="chip">💰 ' + THB(info.revenue) + '</span>' +
      '<span class="chip">🛒 ' + fmtNum(info.orders) + ' ออเดอร์</span></div>' +
    '<h4 style="margin:6px 0">📦 สินค้าที่ขายได้ (คลิกสินค้าเพื่อดูว่าขายเพจไหนอีก)</h4>' +
    (prods.length
      ? '<div class="table-scroll"><table class="tbl"><thead><tr><th>#</th><th>สินค้า</th><th>มูลค่า*</th>' +
        '<th>จำนวน</th><th>ออเดอร์</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<div class="empty-note">ไม่มีข้อมูลสินค้าสำหรับเพจนี้</div>') +
    drillNote()
  );
  bindDrillRows(document.getElementById('modal-root'), chKey);
}

/** รายชื่อทุกเพจที่มียอด (คลิกเพจเจาะต่อ) */
function openAllPages(chKey: string): void {
  const top = topOf(chKey);
  const pages = top.pagesFull || [];
  const rows = pages.map(function (p: any, i: number) {
    return '<tr class="clickable" data-drill-page="' + esc(p.name) + '" title="คลิกดูสินค้าของเพจนี้">' +
      '<td>' + (i + 1) + '</td><td>' + esc(p.name) + '</td><td>' + THB(p.revenue) +
      '</td><td>' + fmtNum(p.orders) + '</td></tr>';
  }).join('');
  openModal(
    '<div class="modal-head"><h3>📄 ทุกเพจที่มียอดขาย (' + fmtNum(pages.length) + ')</h3>' +
      '<button class="modal-close">✕</button></div>' +
    '<div class="card-sub" style="margin-bottom:10px">' + esc((lastData && lastData.rangeLabel) || '') +
      ' • ' + CH_LABELS[chKey] + ' • คลิกเพจเพื่อดูสินค้าที่ขายได้</div>' +
    (pages.length
      ? '<div class="table-scroll"><table class="tbl"><thead><tr><th>#</th><th>เพจ</th><th>รายได้</th>' +
        '<th>ออเดอร์</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<div class="empty-note">ยังไม่มีออเดอร์ในช่วงนี้</div>')
  );
  bindDrillRows(document.getElementById('modal-root'), chKey);
}

/* ---------------- ออเดอร์ที่ต้องตรวจ (สถานะ ใหม่/รอยืนยัน) ---------------- */

/**
 * ตารางรายออเดอร์ที่ยังไม่ยืนยัน
 * scope 'range' = ตามตัวกรอง 📅 + ช่องทางด้านบน | 'today' = การ์ดธุรกิจวันนี้ (ทุกช่องทาง)
 * server ส่งมาสูงสุด 200 ใบล่าสุด — ถ้ามีมากกว่านั้นบอกไว้ท้ายตาราง
 */
function openNeedCheckDrill(scope: 'range' | 'today'): void {
  const d = lastData || {};
  const today = d.today || {};
  const list: any[] = (scope === 'today' ? today.needCheckOrders : d.needCheckOrders) || [];
  const total = Number(scope === 'today' ? today.needCheck : (d.kpis || {}).needCheck) || 0;
  if (!total) { toast('✓ ไม่มีออเดอร์ค้างตรวจ'); return; }
  const where = scope === 'today'
    ? 'วันนี้ • ทุกช่องทาง'
    : esc(d.rangeLabel || '') + ' • ' + CH_LABELS[state.channel];
  const rows = list.map(function (o: any) {
    // 0 = ใหม่ (ยังไม่มีใครแตะ) | 17 = รอยืนยัน (แอดมินคีย์แล้วรอกดยืนยัน)
    const cls = Number(o.status) === 0 ? 'info' : 'admin';
    return '<tr>' +
      '<td style="white-space:nowrap">' + esc(o.at) + '</td>' +
      '<td>' + esc(o.code) + '</td>' +
      '<td>' + esc(o.customer || '—') + '</td>' +
      '<td>' + esc(o.page || '—') + '</td>' +
      '<td style="white-space:nowrap">' + THB(o.total) + '</td>' +
      '<td>' + fmtNum(o.items) + '</td>' +
      '<td><span class="badge ' + cls + '">' + esc(o.statusName) + '</span></td>' +
      '<td>' + esc(o.seller || '—') + '</td>' +
    '</tr>';
  }).join('');
  const sumVal = list.reduce(function (s: number, o: any) { return s + (Number(o.total) || 0); }, 0);
  openModal(
    '<div class="modal-head"><h3>⚠ ออเดอร์ที่ต้องตรวจ (' + fmtNum(total) + ')</h3>' +
      '<button class="modal-close">✕</button></div>' +
    '<div class="card-sub" style="margin-bottom:10px">' + where + '</div>' +
    '<div class="hint-box" style="margin-bottom:10px">ออเดอร์สถานะ <b>ใหม่ / รอยืนยัน</b> จาก Pancake — ' +
      '<b>ยังไม่ถูกนับเป็นรายได้</b> จนกว่าแอดมินจะกดยืนยัน (ยอดขายทุกตัวเลขบนหน้านี้นับเฉพาะ "ยืนยันแล้ว")</div>' +
    '<div class="pill-grid" style="margin-bottom:12px">' +
      '<span class="chip">🧾 ' + fmtNum(total) + ' ใบ</span>' +
      '<span class="chip">💰 ' + THB(sumVal) + ' (ถ้ายืนยันครบ)</span>' +
    '</div>' +
    (list.length
      ? '<div class="table-scroll"><table class="tbl"><thead><tr>' +
          '<th>เวลา</th><th>เลขออเดอร์</th><th>ลูกค้า</th><th>เพจ</th><th>ยอด</th>' +
          '<th>ชิ้น</th><th>สถานะ</th><th>คนขาย</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<div class="empty-note">ไม่มีรายละเอียดออเดอร์ (ลองกด ⟳ โหลดใหม่)</div>') +
    (total > list.length
      ? '<div style="font-size:11px;color:var(--text-3);margin-top:10px">' +
        'แสดง ' + fmtNum(list.length) + ' ใบล่าสุดจากทั้งหมด ' + fmtNum(total) + ' ใบ</div>'
      : '')
  );
}

/* ---------------- fetch ---------------- */

/** filter เปลี่ยน (ทุก param เป็น server-side ตาม contract) → โหลดจาก server ใหม่ */
function refetch(container: HTMLElement): void {
  hideChartTip(); // กราฟกำลังถูกแทนด้วย skeleton — ซ่อนทูลทิปที่อาจค้างอยู่ (pointerleave ไม่ยิงเมื่อ node ถูกลบ)
  container.innerHTML = salesSkel();
  fetchAndRender(container, true);
}

let reqSeq = 0; // กัน response เก่ามาทับ response ใหม่เมื่อกดเปลี่ยน filter รัวๆ

function fetchAndRender(container: HTMLElement, blocking: boolean): void {
  const seq = ++reqSeq;
  serverCall('apiSales', buildParams()).then(function (data: SalesData) {
    if (seq !== reqSeq) return; // มี request ใหม่กว่าออกไปแล้ว — ทิ้งผลลัพธ์นี้
    lastData = data || {};
    render(container, lastData);
  }).catch(function (err: any) {
    if (seq !== reqSeq) return;
    const msg = (err && err.message) || 'เรียกข้อมูลไม่สำเร็จ';
    if (blocking) {
      hideChartTip(); // กราฟถูกแทนด้วยกล่อง error — ซ่อนทูลทิปที่อาจค้าง
      showError(container, msg, function () { refetch(container); });
    } else {
      toast('⚠ รีเฟรชข้อมูลไม่สำเร็จ — แสดงข้อมูลเดิมไว้ก่อน');
    }
  });
}

/* ---------------- CSV export ---------------- */

function exportCsv(): void {
  const rows = buildReportRows();
  if (rows) downloadCSV(rows, 'sales-report-' + state.preset);
}

function exportXls(): void {
  const rows = buildReportRows();
  if (rows) downloadXLS(rows, 'sales-report-' + state.preset, 'Sales Report');
}

/** แถวรายงานชุดเดียว ใช้ทั้ง CSV และ Excel */
function buildReportRows(): unknown[][] | null {
  if (!lastData) {
    toast('ยังไม่มีข้อมูลสำหรับ export');
    return null;
  }
  const d = lastData;
  const k = d.kpis || {};
  const t = d.trends || {};
  const ch = d.channels || {};
  const rows: unknown[][] = [];

  rows.push(['Sales Report — ภาพรวมยอดขาย']);
  rows.push(['ช่วงเวลา', d.rangeLabel || '']);
  rows.push(['ช่องทางที่กรอง', CH_LABELS[state.channel] || 'ทั้งหมด']);
  rows.push(['สร้างเมื่อ', new Date().toLocaleString('th-TH')]);
  rows.push([]);

  rows.push(['— สรุปยอดขาย —']);
  rows.push(['รายได้รวม', Math.round(Number(k.revenue) || 0)]);
  rows.push(['คำสั่งซื้อ (มีสินค้าจริง)', Number(k.orders) || 0]);
  rows.push(['คำสั่งซื้อ (ยืนยันแล้ว)', (k.confirmedOrders === null || k.confirmedOrders === undefined) ? '-' : Number(k.confirmedOrders)]);
  rows.push(['ลูกค้า', Number(k.customers) || 0]);
  rows.push(['เฉลี่ย/ออเดอร์', Math.round(Number(k.avgOrder) || 0)]);
  rows.push(['%ปิดการขาย (ออเดอร์จากแชท ÷ คนทัก)', (k.closeRate === null || k.closeRate === undefined) ? '-' : k.closeRate]);
  rows.push(['คนทัก (อินบ็อกซ์ใหม่ + คอมเมนต์)', (k.closeBase === null || k.closeBase === undefined) ? '-' : Number(k.closeBase)]);
  rows.push(['— อินบ็อกซ์ใหม่', (k.closeNewInbox === null || k.closeNewInbox === undefined) ? '-' : Number(k.closeNewInbox)]);
  rows.push(['— คอมเมนต์', (k.closeComment === null || k.closeComment === undefined) ? '-' : Number(k.closeComment)]);
  rows.push(['ลูกค้าที่คุยทั้งหมด (อ้างอิง)', (k.engTotal === null || k.engTotal === undefined) ? '-' : Number(k.engTotal)]);
  rows.push(['ยอดขายจากแอด', Math.round(Number(k.adRevenue) || 0)]);
  rows.push(['บทสนทนาใหม่ (statistics/pages)', Number(k.newConvs) || 0]);
  rows.push(['ออเดอร์ที่ต้องตรวจ', Number(k.needCheck) || 0]);
  rows.push(['ลูกค้าเก่า (เคยซื้อใน 95 วัน)', d.returning ? Number(d.returning.returning) || 0 : '-']);
  // ระบุหน้าต่างที่เทียบให้ชัด — ไฟล์ที่ export ไปแล้วจะได้ไม่ต้องเดาว่าเทียบกับช่วงไหน
  const cmpName = (d.prevLabel || 'ช่วงก่อนหน้า') + (d.prevWindow ? ' (' + d.prevWindow + ')' : '');
  rows.push(['เทียบ ' + cmpName + ' — รายได้ (%)', (t.revenue === null || t.revenue === undefined) ? '-' : t.revenue]);
  rows.push(['เทียบ ' + cmpName + ' — ออเดอร์ (%)', (t.orders === null || t.orders === undefined) ? '-' : t.orders]);
  rows.push([]);

  rows.push(['— ช่องทาง —']);
  rows.push(['ช่องทาง', 'รายได้', 'ออเดอร์', 'ลูกค้า', 'เปลี่ยนแปลง (%)']);
  [['ทั้งหมด', 'all'], ['Facebook', 'facebook'], ['LINE OA', 'line']].forEach(function (p) {
    const c = ch[p[1]] || {};
    rows.push([
      p[0],
      Math.round(Number(c.revenue) || 0),
      Number(c.orders) || 0,
      Number(c.customers) || 0,
      (c.trend === null || c.trend === undefined) ? '-' : c.trend,
    ]);
  });
  rows.push([]);

  rows.push(['— แหล่งที่มาของคำสั่งซื้อ —']);
  rows.push(['แหล่งที่มา', 'รายได้', 'ออเดอร์', 'ลูกค้า', '% ปิด', 'สถานะ']);
  (d.sources || []).forEach(function (s: any) {
    rows.push([
      s.label || '',
      Math.round(Number(s.revenue) || 0),
      Number(s.orders) || 0,
      Number(s.customers) || 0,
      (s.closeRate === null || s.closeRate === undefined) ? '-' : s.closeRate,
      (s.status && s.status.label) || '',
    ]);
  });

  // Top 10 สินค้า/เพจ ตามช่องทางที่กรองอยู่
  const topT = d.top ? (state.channel ? d.top[state.channel] : d.top.all) : null;
  if (topT) {
    rows.push([]);
    rows.push(['— Top 10 สินค้า (' + (CH_LABELS[state.channel] || 'ทั้งหมด') + ') —']);
    rows.push(['อันดับ', 'สินค้า', 'จำนวน (ชิ้น)', 'มูลค่าตามราคาขาย', 'อยู่ในกี่ออเดอร์']);
    (topT.products || []).forEach(function (p: any, i: number) {
      rows.push([i + 1, p.name || '', Number(p.qty) || 0, Number(p.value) || 0, Number(p.orders) || 0]);
    });
    rows.push([]);
    rows.push(['— Top 10 เพจ —']);
    rows.push(['อันดับ', 'เพจ', 'รายได้', 'ออเดอร์']);
    (topT.pages || []).forEach(function (p: any, i: number) {
      rows.push([i + 1, p.name || '', Number(p.revenue) || 0, Number(p.orders) || 0]);
    });
  }

  return rows;
}

/* ---------------- register view ---------------- */

export const sales = {
  load: async (container: HTMLElement, force: boolean): Promise<void> => {
    if (lastData && !force) {
      // มี cache → แสดงทันที แล้วดึงข้อมูลใหม่เบื้องหลัง
      render(container, lastData);
      fetchAndRender(container, false);
    } else {
      container.innerHTML = salesSkel();
      fetchAndRender(container, true);
    }
  },
};
