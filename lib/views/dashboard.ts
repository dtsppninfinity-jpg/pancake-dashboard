/* ============================================================
   dashboard — หน้า Dashboard (ภาพรวมแชทตามช่วงที่เลือก)
   ข้อมูลจริงจาก apiDashboard({preset,from,to,channel}) — กรอง/รวมยอดฝั่ง server
   (port จาก JsDashboard.html — โครง HTML/class/ข้อความ/esc คงเดิมทุกตัวอักษร)
   ⚠️ วิดเจ็ตที่มาจากตาราง conversations (สัดส่วนการตอบ/ประเภท/แท็ก/แยกตามเพจ/แชทที่รอตอบ)
      เป็น "ค่าตอนนี้ 24 ชม.ล่าสุด" เสมอ — ตารางนั้นเก็บสถานะล่าสุดของแต่ละแชท ไม่ใช่ประวัติรายวัน
      จึงย้อนหลังตามช่วงที่เลือกไม่ได้ ต้องติดป้าย nowBadge_() กำกับให้ผู้ใช้รู้
   ============================================================ */

import {
  serverCall, esc, fmtNum, pct1, avatarHtml, infoTip, stateHtml,
  showError, toast, tagColor, rangeControlsHtml, bindRangeControls, RangeState,
} from '@/lib/ui/helpers';
import { svgWeekBars, bindChartTips, hideChartTip } from '@/lib/ui/charts';
import { dashboardSkel, dashboardBodySkel } from '@/lib/ui/skeletons';
import { icon, brandIcon, statusPill, ICON_FOR, type StatusKind } from '@/lib/ui/icons';

/* ---------------- data types (apiDashboard) ---------------- */

interface Kpis {
  convsToday?: number;
  custMsgs?: number;
  newCustomers?: number;
  // จาก statistics/customer_engagements (ชุดเดียวกับหน้าสถิติแชท Pancake)
  // null = ยังไม่ได้รัน migration chat_engagement_daily
  engCustomers?: number | null;
  engNewInbox?: number | null;
  engReached?: number | null;  // คนทัก = อินบ็อกซ์ใหม่ + คอมเมนต์
  engComment?: number | null;
  engOrders?: number | null;
  pageReplies?: number;
  phones?: number;
  waiting?: number;
  replyRate?: number;
}

interface DonutData {
  replied?: number;
  waiting?: number;
  ai?: number;
}

interface WeekItem {
  date?: string;
  label: string;
  total: number;
  replied: number;
}

interface ByTypeItem {
  label: string;
  count: number;
}

interface ByPageItem {
  name?: string;
  platform?: string;
  count?: number;
}

interface TagItem {
  name?: string;
  count?: number;
}

interface AttentionItem {
  id?: string | number;
  pageId?: string | number;
  pageName?: string;
  platform?: string;
  customer?: string;
  snippet?: string;
  updatedAt?: string;
  waitMins?: number;
}

interface DashData {
  rangeLabel?: string;   // ป้ายช่วงเวลาจาก server ('วันนี้' | '7 วันล่าสุด' | '2026-07-01 ถึง ...')
  rangeDays?: number;    // จำนวนวันในช่วง — >1 เมื่อไหร่ ตัวเลข engagement เป็นผลรวมรายวัน (นับซ้ำข้ามวัน)
  weekLabel?: string;    // ป้ายของกราฟแท่งรายวัน (กราฟอาจกว้าง/แคบกว่าช่วงที่เลือก)
  weekNote?: string;     // หมายเหตุเมื่อกราฟไม่ได้ครอบทั้งช่วง
  kpis?: Kpis;
  week?: WeekItem[];
  donut?: DonutData;
  byType?: ByTypeItem[];
  byPage?: ByPageItem[];
  commentByPage?: ByPageItem[];
  tags?: TagItem[];
  attention?: AttentionItem[];
}

interface DashState extends RangeState {
  preset: string;
  from: string;
  to: string;
  channel: string;   // '' | 'facebook' | 'line' | 'comment' (server-side param)
}

/* ---------------- closure state ---------------- */

let lastData: DashData | null = null;   // cache ข้อมูลล่าสุด (ต่อ filter ปัจจุบัน)
let reqSeq = 0;                         // กันผลลัพธ์เก่ามาทับผลลัพธ์ใหม่
const state: DashState = { preset: 'today', from: '', to: '', channel: '' };
// ป้ายช่วงเวลาที่ server ตีความให้ — ใช้แทนคำว่า "วันนี้" ที่เคย hard-code ทุกการ์ด
// (ตั้งค่าใหม่ทุกครั้งที่ bodyHtml() ถูกเรียก เหมือน channel ที่ helper อื่นอ่านจากตัวแปรระดับไฟล์)
let rangeLabel = 'วันนี้';
let rangeDays = 1;
/** รายการแชทรอตอบ: false = 10 แถวแรก (รอนานสุด) · true = ทั้งหมดที่โหลดมา (สูงสุด 30) — จำไว้ข้ามรอบรีเฟรช */
let attnAll = false;
const ATTN_FIRST = 10;

// ic = ไอคอนหน้าคำ (HTML) — ช่องทางใช้โลโก้แบรนด์จริง ไม่ใช้ 📘/🟢 แทน Facebook/LINE อีกแล้ว
const CHANNELS: { key: string; label: string; ic?: string }[] = [
  { key: '', label: 'ทั้งหมด' },
  { key: 'facebook', label: 'Facebook', ic: brandIcon('facebook') },
  { key: 'line', label: 'LINE OA', ic: brandIcon('line') },
  { key: 'comment', label: 'คอมเมนต์', ic: icon(ICON_FOR.comment, { size: 14 }) }, // มุมมองเฉพาะคอมเมนต์ (ทุก platform)
];

/** โลโก้ช่องทางของเพจ/แชท (แทน platformIcon() ที่คืนอีโมจิ) — ช่องทางที่ไม่รู้จักถือเป็น Facebook เหมือนของเดิม */
function channelIcon_(pf: string | null | undefined): string {
  const p = String(pf || '').toLowerCase();
  const name = (p === 'line' || p === 'instagram' || p === 'tiktok' || p === 'shopee') ? p : 'facebook';
  return brandIcon(name, { size: 14, label: true });
}

function buildParams() {
  return { preset: state.preset, from: state.from, to: state.to, channel: state.channel };
}

/* ---------------- ป้ายช่วงเวลา ---------------- */

/** เลือก "วันนี้" อยู่ไหม — ใช้ตัดสินว่าจะเขียนป้ายแบบเดิม (คำว่า "วันนี้") หรือแบบมีช่วง */
function isTodayRange_(): boolean {
  return state.preset === 'today';
}

/** ชื่อการ์ดที่เดิมลงท้ายด้วย "วันนี้" → 'คนทักวันนี้' | 'คนทัก (7 วันล่าสุด)' (esc แล้ว) */
function rangeTitle_(base: string): string {
  return esc(isTodayRange_() ? base + 'วันนี้' : base + ' (' + rangeLabel + ')');
}

// ไม่มีคำเทคนิค (ชื่อตาราง) ในข้อความที่ทีมเห็น — ตรวจ UI ข้อ D2
const NOW_TIP = 'ค่าตอนนี้จากแชท 24 ชม.ล่าสุด • ระบบเก็บแค่ "สถานะล่าสุด" ของแต่ละแชท ไม่ใช่ประวัติรายวัน ' +
  'จึงย้อนดูตามช่วงที่เลือกไม่ได้';

/**
 * ป้ายเตือนว่าวิดเจ็ตนี้ไม่ขึ้นกับช่วงที่เลือก (ค่าตอนนี้เสมอ)
 * เลือก "วันนี้" อยู่แล้วไม่ต้องขึ้น — หัวข้อการ์ดเขียน "(24 ชม.)" กำกับไว้อยู่แล้ว
 * ป้ายสั้น + ปุ่ม ⓘ แทนป้ายยาวที่มีคำอธิบายซ่อนใน title (แตะบนมือถือไม่ได้ — D3)
 */
function nowBadge_(): string {
  if (isTodayRange_()) return '';
  return ' <span class="db-now"><span class="badge info">ค่าตอนนี้ ไม่ขึ้นกับช่วงที่เลือก</span>' +
    infoTip(NOW_TIP, 'ค่าตอนนี้ (24 ชม.)') + '</span>';
}

/** หมายเหตุตัวเลขรวมหลายวัน (คนเดิมที่ทักคนละวันถูกนับซ้ำ — endpoint ต้นทางไม่มี unique ข้ามวัน) */
function multiDayNote_(): string {
  return rangeDays > 1 ? ' — รวมรายวัน ' + rangeDays + ' วัน (คนเดิมที่ทักคนละวันนับซ้ำ)' : '';
}

/* ---------------- ชิ้นส่วน HTML ---------------- */

function chipRowHtml(): string {
  const pills = CHANNELS.map((c) => {
    return '<button type="button" class="filter-btn' + (state.channel === c.key ? ' active' : '') +
      '" data-ch="' + esc(c.key) + '">' + (c.ic || '') + esc(c.label) + '</button>';
  }).join('');
  return '<div class="tb-filters" id="dash-channels" role="group" aria-label="ช่องทาง">' + pills + '</div>';
}

/** แถวเครื่องมือมาตรฐาน (C4): ซ้าย = ช่วงเวลา (idPrefix 'db') · ถัดไป = ช่องทาง — หน้านี้ไม่มีไฟล์ให้ดาวน์โหลด */
function controlsHtml(): string {
  return '<div class="toolbar db-toolbar">' +
    '<div class="tb-range" id="dash-range">' + rangeControlsHtml(state, 'db') + '</div>' +
    chipRowHtml() +
  '</div>';
}

/** การ์ดตัวเลขใหญ่ — ic = ชื่อไอคอนจาก ICON_FOR (วาดขนาด 22 ในกรอบสี ไอคอนรับสีจากกรอบเอง) */
function statCard(ic: string, iconCls: string, label: string, valueHtml: string, hintHtml: string): string {
  return '<div class="stat-card">' +
    '<div class="stat-icon ' + iconCls + '">' + icon(ic, { size: 22 }) + '</div>' +
    '<div class="db-stat-txt">' +
    '<div class="stat-label">' + label + '</div>' +
    '<div class="stat-value">' + valueHtml + '</div>' +
    '<div class="stat-hint">' + hintHtml + '</div>' +
    '</div></div>';
}

/** สัดส่วนบทสนทนา 24 ชม. (แอดมินตอบ / อัตโนมัติ / รอตอบ) — ใช้ร่วมทั้งการ์ดตัวเลขและแถบสัดส่วน */
function share_(donut?: DonutData): { replied: number; ai: number; waiting: number; base: number } {
  const d: DonutData = donut || {};
  const replied = Number(d.replied) || 0;
  const ai = Number(d.ai) || 0;
  const waiting = Number(d.waiting) || 0;
  return { replied, ai, waiting, base: replied + ai + waiting };
}

function statGridHtml(k: Kpis, donut?: DonutData): string {
  const waiting = Number(k.waiting) || 0;
  const sh = share_(donut);
  const ai = sh.ai;
  const commentMode = state.channel === 'comment';
  const cards: string[] = [];
  if (commentMode) {
    // มุมคอมเมนต์: ตัวเลขแรกคือ "จำนวนคอมเมนต์" ไม่ใช่บทสนทนา — ป้ายต้องตรงความหมาย
    cards.push(statCard(ICON_FOR.comment, 'purple', rangeTitle_('คอมเมนต์จากลูกค้า'), fmtNum(k.custMsgs),
      'เพจตอบคอมเมนต์ ' + fmtNum(k.pageReplies) + ' ครั้ง'));
  } else {
    // "คนทัก" = คนที่ทักเข้ามาจริง = อินบ็อกซ์ใหม่ + คอมเมนต์ (บอสยืนยันนิยามนี้)
    // ดึงจาก statistics/customer_engagements (chat_engagement_daily) → engReached = new_inbox + comment
    // fallback เป็น new_inbox_count จาก statistics/pages ถ้ายังไม่มีข้อมูล engagement ในช่วง (ไม่รวมคอมเมนต์)
    const hasEng = k.engReached !== null && k.engReached !== undefined;
    const reached = hasEng ? k.engReached : k.convsToday;
    const convTip = ' data-tip-title="' + rangeTitle_('คนทัก') + '"' +
      ' data-tip-formula="อินบ็อกซ์ใหม่ + คอมเมนต์"' +
      ' data-tip="' + esc('จำนวนคนที่ทักเข้ามาใน' + (isTodayRange_() ? 'วันนี้' : 'ช่วง ' + rangeLabel) +
        ' = บทสนทนาอินบ็อกซ์ใหม่ + คอมเมนต์ (คนทักจริง ไม่ใช่ลูกค้าเก่าที่คุยต่อ) จากหน้าสถิติการมีส่วนร่วมของ Pancake' +
        multiDayNote_()) + '"' +
      ' data-tip-src="Pancake · หน้าสถิติการมีส่วนร่วม">';
    const convSub = hasEng
      ? 'อินบ็อกซ์ใหม่ ' + fmtNum(k.engNewInbox || 0) + ' + คอมเมนต์ ' + fmtNum(k.engComment || 0) +
        ' • เบอร์ใหม่ ' + fmtNum(k.phones)
      : 'ข้อความลูกค้า ' + fmtNum(k.custMsgs) + ' • เบอร์ใหม่ ' + fmtNum(k.phones);
    cards.push(statCard(ICON_FOR.chats, 'purple', rangeTitle_('คนทัก'),
      '<span' + convTip + fmtNum(reached) + '</span>', convSub));
  }
  // ⚠️ pageReplies = จำนวน "ข้อความ" ที่เพจส่งในช่วงที่เลือก (รวมบอต/ข้อความอัตโนมัติ/บรอดแคสต์)
  //    ไม่ใช่จำนวนบทสนทนาที่ตอบ — และคนละชุดข้อมูล/คนละช่วงเวลากับ replyRate (24 ชม. จาก conversations)
  //    เดิมเอามาแปะคู่กันในการ์ดเดียว ทำให้ดูเหมือน "ตอบ 94% จาก 47,375 ครั้ง" ซึ่งไม่จริง
  //    สัดส่วนการตอบ 24 ชม. อยู่ในแถบสัดส่วนใต้แถวการ์ดนี้ (ตรวจ UI ข้อ G1)
  cards.push(statCard('send', 'green', rangeTitle_('ข้อความที่เพจส่ง'), fmtNum(k.pageReplies),
    'รวมบอต/ข้อความอัตโนมัติ • ลูกค้าส่ง ' + fmtNum(k.custMsgs) + ' ข้อความ'));
  // 2 ใบนี้มาจาก conversations = ค่าตอนนี้เสมอ ไม่ขึ้นกับช่วงที่เลือก (ดูหมายเหตุหัวไฟล์)
  // %อัตโนมัติ เป็นตัวหนาสีปกติ ไม่ใช่เขียว — สัดส่วนนี้ไม่ได้ตัดสินว่าดีหรือแย่ (E3: เขียว = ดีเท่านั้น)
  cards.push(statCard(ICON_FOR.autoReply, 'purple', 'ตอบอัตโนมัติ (24 ชม.)', fmtNum(ai),
    (sh.base ? '<b class="v-plain">' + pct1((ai / sh.base) * 100) + '</b> ของบทสนทนา 24 ชม.' : 'ยังไม่มีข้อมูล') + nowBadge_()));
  // "(ตอนนี้)" ห้ามแยกบรรทัด — การ์ดแคบแล้วเคยหักเป็น "(ตอน" / "นี้)"
  cards.push(statCard(ICON_FOR.wait, 'amber', 'รอแอดมินตอบ <span class="db-nw">(ตอนนี้)</span>', fmtNum(k.waiting),
    (waiting > 0 ? '<b class="warn">ต้องการความสนใจ</b>' : 'ไม่มีงานค้าง') + nowBadge_()));
  // ตัวเลขบรรทัดล่างมาจาก statistics/customer_engagements = ชุดเดียวกับหน้าสถิติแชทของ Pancake
  // ให้เทียบจอต่อจอได้ (บรรทัดบนมาจาก statistics/pages ซึ่งนับ "ลูกค้าใหม่" คนละนิยามเล็กน้อย)
  const engSub = (k.engNewInbox === null || k.engNewInbox === undefined)
    ? (commentMode ? 'ทุกช่องทางรวมกัน (แยกเฉพาะคอมเมนต์ไม่ได้)' : 'จากทุกเพจที่เชื่อมไว้')
    : 'Pancake นับ <b>' + fmtNum(k.engNewInbox) + '</b> คนเปิดแชทใหม่ • คุยทั้งหมด ' +
      fmtNum(k.engCustomers || 0) + ' คน';
  cards.push(statCard(ICON_FOR.newCustomer, 'blue', rangeTitle_('ลูกค้าใหม่'), fmtNum(k.newCustomers),
    engSub + esc(multiDayNote_())));
  return '<div class="stat-grid">' + cards.join('') + '</div>';
}

function typeLabel(t: string | undefined): string {
  const u = String(t || '').toUpperCase();
  if (u === 'INBOX') return 'ข้อความ';
  if (u === 'COMMENT') return 'คอมเมนต์';
  return String(t || '-');
}

/**
 * แถบสัดส่วนการตอบ 24 ชม. (ตรวจ UI ข้อ G1) — แทนการ์ดโดนัท + การ์ด "ประเภทบทสนทนา"
 * ทำไมเลิกใช้โดนัท: วงวาดแค่ส่วน "ตอบแล้ว" สีเดียว แต่คำอธิบายข้างวงมี 3 สี คนหาสีม่วง/แดงในวงไม่เจอ
 * และการ์ดทั้ง 2 ใบว่างครึ่งกล่อง → รวมเป็นแถบเส้นเดียว 3 ช่วงตามสัดส่วนจริง สีจุดในคำอธิบาย = สีช่วงในแถบเสมอ
 * วางต่อใต้แถวการ์ดตัวเลข (ติดการ์ด "รอแอดมินตอบ") ไม่ได้ยัดเข้าไปในการ์ดนั้น — การ์ดใบเดียวสูงขึ้น
 * ทำให้การ์ดอีก 4 ใบในแถวยืดตามจนมีที่ว่างด้านล่างทุกใบ
 * ประเภทบทสนทนา (ข้อความ/คอมเมนต์) เหลือเป็นบรรทัดเล็กในหัวแถบ — ตัวเลขชุดเดียวกัน (24 ชม.) ไม่ต้องมีการ์ดแยก
 */
function shareStripHtml(donut: DonutData | undefined, byType?: ByTypeItem[]): string {
  const sh = share_(donut);
  const parts: { key: string; label: string; n: number }[] = [
    { key: 'admin', label: 'แอดมินตอบ', n: sh.replied },
    { key: 'ai', label: 'ตอบอัตโนมัติ', n: sh.ai },
    { key: 'wait', label: 'รอตอบ', n: sh.waiting },
  ];
  const pct = (n: number) => (sh.base ? (n / sh.base) * 100 : 0);
  // "ตอบแล้ว" = แอดมินตอบ + ตอบอัตโนมัติ — ตัวเลขหลักของการ์ดนี้ (เดิมอยู่กลางโดนัท) ไม่ให้ทีมต้องบวกเอง
  const replied = '<b class="db-share-rate v-plain">ตอบแล้ว ' + pct1(pct(sh.replied + sh.ai)) + '</b>';
  const types = (byType || []).slice().sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0))
    .map((t) => esc(typeLabel(t.label)) + ' <b>' + fmtNum(Number(t.count) || 0) + '</b>');
  const aria = parts.map((p) => p.label + ' ' + pct1(pct(p.n))).join(' • ');
  // ความกว้างแต่ละช่วงคำนวณจากข้อมูล จึงต้องอยู่ใน style ของช่วงนั้น (แบบเดียวกับ .hbar-fill)
  const bar = '<div class="db-share-bar" role="img" aria-label="' + esc(aria) + '">' +
    parts.map((p) => {
      const w = pct(p.n);
      // ช่วงที่เป็นศูนย์ไม่ต้องวาด — แต่ยังอยู่ในคำอธิบายพร้อม 0.0%
      return w > 0 ? '<i class="db-s-' + p.key + '" style="width:' + w.toFixed(2) + '%"></i>' : '';
    }).join('') +
  '</div>';
  const legend = '<div class="db-share-legend">' + parts.map((p) =>
    '<span class="db-lg db-s-' + p.key + '">' + esc(p.label) + ' <b>' + fmtNum(p.n) + '</b>' +
      '<span class="db-lg-pct">' + pct1(pct(p.n)) + '</span></span>').join('') +
  '</div>';
  return '<div class="card db-share">' +
    '<div class="card-head db-share-head">' +
      '<h3 class="card-title">สัดส่วนการตอบ (24 ชม.)' +
        infoTip('แชททั้งหมดใน 24 ชม.ล่าสุด แบ่งตามสถานะตอนนี้ • แอดมินตอบ = แอดมินตอบแล้ว • ' +
          'ตอบอัตโนมัติ = บอตตอบแล้ว • รอตอบ = ลูกค้าทักมาแล้วยังไม่มีใครตอบ', 'สัดส่วนการตอบ') +
      '</h3>' +
      (sh.base ? replied : '') +
      (types.length ? '<div class="db-share-types">บทสนทนา: ' + types.join(' · ') + '</div>' : '') +
      nowBadge_() +
    '</div>' +
    (sh.base ? bar + legend : stateHtml('wait', { title: 'ยังไม่มีแชทใน 24 ชม.ล่าสุด', body: '' })) +
  '</div>';
}

function weekCardHtml(data: DashData): string {
  const week = data.week;
  const body = (week && week.length)
    ? svgWeekBars(week)
    : stateHtml('nodata', { body: 'ลองเลือกช่วงวันที่อื่น' });
  // กราฟยึดวันท้ายของช่วงที่เลือก แต่กว้าง 7-14 วันเสมอ (server เป็นคนตัดสิน + ส่ง weekLabel มา)
  const note = data.weekNote ? ' • ' + esc(data.weekNote) : '';
  // กราฟเหลือชุดเดียว (ข้อความที่ลูกค้าส่ง) — เพจส่งเป็นอัตราส่วนใต้แต่ละวัน (lib/ui/charts.ts svgWeekBars)
  // จึงไม่มีช่องสีคำอธิบาย 2 สีแบบเดิมอีกแล้ว
  return '<div class="card db-week">' +
    '<div class="card-head"><h3 class="card-title">ปริมาณข้อความ ' + esc(data.weekLabel || '7 วันล่าสุด') +
      infoTip('ตัวเลขเป็นจำนวน "ข้อความ" ไม่ใช่จำนวนบทสนทนา • เพจส่งสคริปต์ขายทีละหลายข้อความ ' +
        '(รวมบอต/บรอดแคสต์) จึงมากกว่าลูกค้าหลายเท่าเป็นปกติ ไม่ใช่ข้อมูลผิด • ' +
        'เพจ 10.5:1 = เพจส่ง 10.5 ข้อความ ต่อลูกค้า 1 ข้อความ', 'ปริมาณข้อความ') +
    '</h3></div>' +
    '<div class="card-sub">แท่ง = ข้อความที่ลูกค้าส่ง · ใต้วัน = เพจส่งกี่ข้อความต่อ 1 ข้อความลูกค้า' + note + '</div>' +
    body + '</div>';
}

function tagsCardHtml(tags?: TagItem[]): string {
  let body: string;
  if (tags && tags.length) {
    // สีจุดของแท็กคำนวณจากชื่อแท็ก (tagColor) — ค่าเปลี่ยนตามข้อมูลจึงต้องอยู่ใน style ของแต่ละจุด
    body = '<div class="tag-cloud">' + tags.map((t) => {
      return '<span class="chip"><span class="tag-dot db-tag-dot" style="background:' + tagColor(t.name) + '"></span>' +
        esc(t.name) + ' <b class="db-tag-n">×' + fmtNum(t.count) + '</b></span>';
    }).join('') + '</div>';
  } else {
    body = stateHtml('nodata', { title: 'ยังไม่มีแท็กใน 24 ชม.ล่าสุด', body: '' });
  }
  return '<div class="card db-tags">' +
    '<div class="card-head"><h3 class="card-title">แท็กที่ใช้บ่อย</h3></div>' +
    '<div class="card-sub">นับจากบทสนทนาใน 24 ชม.ล่าสุด' + nowBadge_() + '</div>' +
    body + '</div>';
}

/**
 * แถบแนวนอนรายเพจ + โลโก้ช่องทางหน้าชื่อเพจ
 * ทำไมไม่ใช้ hbarRows(): มัน escape ป้ายทั้งก้อน ใส่ <svg> โลโก้ไม่ได้ (เดิมเลยใช้อีโมจิในป้ายแทน)
 * จึงประกอบเองด้วยโครง/คลาสเดียวกับ hbarRows ทุกตัว — CSS ของ .hbar-* ใช้ได้เหมือนเดิม
 * ห่อด้วย .hbar-wide (ช่องชื่อยืดได้ถึง 280px) — ชื่อเพจไทยยาว ช่อง 130px เดิมตัดจนทุกแถวหน้าตาเหมือนกัน (G3)
 */
function pageBarRows_(pages: ByPageItem[] | undefined, cls: string, emptyTitle: string): string {
  const items = (pages || []).map((p) => ({ name: String(p.name || '-'), pf: p.platform, value: Number(p.count) || 0 }));
  if (!items.length) return stateHtml('nodata', { title: emptyTitle, body: '' });
  const max = Math.max(...items.map((it) => it.value).concat([1]));
  return '<div class="hbar-wide">' + items.map((it) => {
    const w = Math.round((it.value / max) * 100);
    return '<div class="hbar-row">' +
      '<div class="hbar-label" title="' + esc(it.name) + '">' + channelIcon_(it.pf) + ' ' + esc(it.name) + '</div>' +
      '<div class="hbar-track"><div class="hbar-fill ' + cls + '" style="width:' + w + '%"></div></div>' +
      '<div class="hbar-num">' + esc(fmtNum(it.value)) + '</div></div>';
  }).join('') + '</div>';
}

function byPageCardHtml(byPage?: ByPageItem[]): string {
  return '<div class="card">' +
    '<div class="card-head"><h3 class="card-title">แชทแยกตามเพจ (24 ชม.)</h3></div>' +
    '<div class="card-sub">เพจที่ลูกค้าทักเยอะที่สุด 8 เพจ' + nowBadge_() + '</div>' +
    pageBarRows_(byPage, 'blue', 'ยังไม่มีแชทใน 24 ชม.ล่าสุด') + '</div>';
}

function commentByPageCardHtml(commentByPage?: ByPageItem[]): string {
  return '<div class="card">' +
    '<div class="card-head"><h3 class="card-title">คอมเมนต์แยกตามเพจ (' + esc(rangeLabel) + ')</h3></div>' +
    '<div class="card-sub">เพจที่ลูกค้าคอมเมนต์เยอะที่สุด 8 เพจ — จากสถิติรายชั่วโมงจริง</div>' +
    pageBarRows_(commentByPage, '', isTodayRange_() ? 'วันนี้ยังไม่มีคอมเมนต์' : 'ช่วงนี้ยังไม่มีคอมเมนต์') + '</div>';
}

function waitLabel(mins: number | undefined): string {
  const m2 = Math.max(0, Math.round(Number(mins) || 0));
  if (m2 >= 60) {
    const h = Math.floor(m2 / 60);
    const m = m2 % 60;
    return 'รอ ' + fmtNum(h) + ' ชม.' + (m > 0 ? ' ' + m + ' นาที' : '');
  }
  return 'รอ ' + fmtNum(m2) + ' นาที';
}

/** สีของป้ายเวลารอ (B3 งบสีแดง): เกิน 4 ชม. = แดง · 1–4 ชม. = ส้ม · ไม่ถึงชั่วโมง = เทา
 *  เดิมทุกแถวที่เกิน 1 ชม. ได้ป้าย "ด่วน" สีแดง + แถบแดงทุกแถว — 30 แถวแดงเท่ากันหมด ตาเลยไม่เห็นอะไร */
function waitKind_(mins: number): StatusKind {
  return mins > 240 ? 'bad' : mins >= 60 ? 'warn' : 'muted';
}

/**
 * แชทรอตอบ (B3): หัวข้อบอกจำนวนทั้งหมด + แสดง 10 แชทที่รอนานที่สุด มีปุ่ม "ดูเพิ่ม" (ที่เหลือที่โหลดมา สูงสุด 30)
 * แชทละ 1 แถว (จอคอม) — สีอยู่ที่ป้ายเวลารออย่างเดียว ไม่มีป้าย "ด่วน" และไม่มีแถบแดงทุกแถวแล้ว
 */
function attentionCardHtml(attention: AttentionItem[] | undefined, waitingTotal: number): string {
  const all = attention || [];
  const total = Math.max(waitingTotal, all.length);
  const shown = attnAll ? all : all.slice(0, ATTN_FIRST);
  let body: string;
  if (all.length) {
    body = '<div class="db-attn">' + shown.map((a) => {
      const mins = Number(a.waitMins) || 0;
      // เปิดแชทนี้ใน Pancake web (แท็บใหม่) — id บทสนทนา = "{pageId}_{เลขแชท}"
      const pancakeUrl = 'https://pancake.vn/' + encodeURIComponent(String(a.pageId || '')) +
        '?c_id=' + encodeURIComponent(String(a.id || ''));
      const who = String(a.customer || '-');
      return '<div class="db-attn-row">' +
        avatarHtml(a.id, a.customer, undefined, 'sm') +
        '<div class="db-attn-who">' +
          '<span class="db-attn-name">' + esc(who) + '</span>' + channelIcon_(a.platform) +
        '</div>' +
        '<div class="db-attn-snip">' + esc(a.snippet || '') + '</div>' +
        '<div class="db-attn-page" title="' + esc(a.pageName || '') + '">' + esc(a.pageName || '') + '</div>' +
        '<div class="db-attn-wait">' + statusPill(waitKind_(mins), esc(waitLabel(a.waitMins))) + '</div>' +
        '<a class="btn-text db-attn-open" href="' + esc(pancakeUrl) + '" target="_blank" rel="noopener"' +
          ' aria-label="' + esc('เปิดแชทของ ' + who + ' ใน Pancake (แท็บใหม่)') + '">' +
          icon(ICON_FOR.open, { size: 14 }) + 'เปิดใน Pancake</a>' +
      '</div>';
    }).join('') + '</div>';
    if (all.length > ATTN_FIRST) {
      body += '<div class="db-attn-more"><button type="button" class="btn-text" id="db-attn-more" aria-expanded="' +
        (attnAll ? 'true' : 'false') + '">' +
        (attnAll ? icon(ICON_FOR.collapse, { size: 16 }) + 'ย่อเหลือ ' + ATTN_FIRST + ' แชท'
          : icon(ICON_FOR.expand, { size: 16 }) + 'ดูเพิ่ม (อีก ' + fmtNum(all.length - ATTN_FIRST) + ' แชท)') +
        '</button></div>';
    }
  } else {
    body = stateHtml('nodata', { title: 'ไม่มีแชทค้างรอแอดมิน', body: 'ตอนนี้ตอบครบทุกแชทแล้ว' });
  }
  const meta = all.length
    ? '<span class="db-attn-meta"> • แสดง ' + fmtNum(shown.length) + ' แชทที่รอนานที่สุด</span>'
    : '';
  return '<div class="card db-attn-card" id="db-attn-card">' +
    '<div class="card-head"><h3 class="card-title">แชทรอตอบ ' + fmtNum(total) + meta + '</h3></div>' +
    '<div class="card-sub">กด "เปิดใน Pancake" เพื่อไปตอบในแท็บใหม่ • สีป้ายเวลา: ส้ม = รอ 1–4 ชม. · แดง = เกิน 4 ชม.' +
      nowBadge_() + '</div>' +
    body + '</div>';
}

function bodyHtml(data: DashData): string {
  const k = (data && data.kpis) || {};
  // ป้ายช่วงเวลาที่ helper ด้านล่างใช้ร่วมกัน — ตั้งก่อนประกอบ HTML ทุกครั้ง
  rangeLabel = (data && data.rangeLabel) || 'วันนี้';
  rangeDays = Number(data && data.rangeDays) || 1;
  // ลำดับ: ตัวเลข → แถบสัดส่วนการตอบ → กราฟ 7 วัน (กว้างขึ้น เพราะไม่ต้องแบ่งที่ให้โดนัทแล้ว) คู่แท็ก
  // → แชท/คอมเมนต์แยกเพจ → แชทรอตอบ
  return statGridHtml(k, data.donut) +
    shareStripHtml(data.donut, data.byType) +
    '<div class="dash-row db-row-main">' +
      weekCardHtml(data) +
      tagsCardHtml(data.tags) +
    '</div>' +
    '<div class="dash-row half">' +
      byPageCardHtml(data.byPage) +
      commentByPageCardHtml(data.commentByPage) +
    '</div>' +
    '<div class="dash-row single">' +
      attentionCardHtml(data.attention, Number(k.waiting) || 0) +
    '</div>';
}

/* ---------------- render + events ---------------- */

/** เปลี่ยน filter → โชว์ skeleton เฉพาะเนื้อหา (ปุ่มยังกดได้ต่อ) แล้วดึงข้อมูลใหม่ */
function refetch_(container: HTMLElement): void {
  lastData = null; // ข้อมูลเดิมเป็นของ filter เก่า — ต้องดึงใหม่จาก server
  hideChartTip();  // กราฟกำลังถูกแทนด้วย skeleton — ซ่อนทูลทิปที่อาจค้าง
  const body = container.querySelector<HTMLElement>('#dash-body');
  if (body) body.innerHTML = dashboardBodySkel();
  fetchAndRender(container);
}

function bindControls(container: HTMLElement): void {
  // ช่วงเวลา: กดปุ่มแล้ววาดแถวควบคุมใหม่ทันที (ปุ่ม active + ช่องวันที่ของ "กำหนดเอง" ต้องขยับเลย)
  bindRangeControls(container, state, 'db', () => {
    const ctl = container.querySelector<HTMLElement>('#dash-controls');
    if (ctl) {
      ctl.innerHTML = controlsHtml();
      bindControls(container);
    }
    refetch_(container);
  });

  const wrap = container.querySelector('#dash-channels');
  if (!wrap) return;
  wrap.querySelectorAll('[data-ch]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ch = btn.getAttribute('data-ch') || '';
      if (ch === state.channel) return;
      state.channel = ch;
      wrap.querySelectorAll('[data-ch]').forEach((b) => {
        b.classList.toggle('active', (b.getAttribute('data-ch') || '') === state.channel);
      });
      refetch_(container);
    });
  });
}

/** ปุ่ม "ดูเพิ่ม / ย่อ" ของแชทรอตอบ — วาดใหม่เฉพาะการ์ดนี้ (กราฟข้างบนไม่ต้องวาดใหม่ ทูลทิปกราฟไม่หาย) */
function bindAttnMore(container: HTMLElement): void {
  const btn = container.querySelector<HTMLElement>('#db-attn-more');
  if (!btn) return;
  btn.addEventListener('click', () => {
    attnAll = !attnAll;
    const card = container.querySelector<HTMLElement>('#db-attn-card');
    const d = lastData;
    if (!card || !d) return;
    card.outerHTML = attentionCardHtml(d.attention, Number(d.kpis && d.kpis.waiting) || 0);
    bindAttnMore(container);
    // คืนโฟกัสให้ปุ่มเดิม (ปุ่มถูกวาดใหม่) — คนใช้คีย์บอร์ดกดสลับต่อได้ ไม่หลุดไปบนสุดของหน้า
    const again = container.querySelector<HTMLElement>('#db-attn-more');
    if (again) again.focus({ preventScroll: true });
  });
}

function render(container: HTMLElement, data?: DashData | null): void {
  container.innerHTML = '<div id="dash-controls">' + controlsHtml() + '</div>' +
    '<div id="dash-body">' + bodyHtml(data || {}) + '</div>';
  bindControls(container);
  bindAttnMore(container);
  bindChartTips(container); // ทูลทิป hover ของกราฟแท่งรายวัน
}

function fetchAndRender(container: HTMLElement): void {
  const seq = ++reqSeq;
  serverCall<DashData>('apiDashboard', buildParams()).then((data) => {
    if (seq !== reqSeq) return; // มี request ใหม่กว่าแล้ว
    lastData = data;
    render(container, data);
  }).catch((err) => {
    if (seq !== reqSeq) return;
    if (lastData) {
      // มีข้อมูลเดิมแสดงอยู่ — แจ้งเตือนเฉยๆ ไม่ทำลายหน้า
      // ข้อความดิบจากเซิร์ฟเวอร์ไม่ขึ้นให้ทีมเห็น (D3) — มีปุ่มลองใหม่ในข้อความแทน
      toast('โหลดข้อมูลใหม่ไม่สำเร็จ — ยังแสดงข้อมูลเดิมอยู่', 'error', {
        action: { label: 'ลองใหม่', fn: () => fetchAndRender(container) },
      });
    } else {
      hideChartTip(); // หน้าเปลี่ยนเป็นกล่อง error — ซ่อนทูลทิปที่อาจค้าง
      showError(container, (err && err.message) || 'เรียกข้อมูลไม่สำเร็จ', () => {
        dashboard.load(container, true);
      });
    }
  });
}

/* ---------------- ลงทะเบียน view ---------------- */

export const dashboard = {
  load: async (container: HTMLElement, force?: boolean): Promise<void> => {
    if (lastData && !force) {
      render(container, lastData);      // แสดงจาก cache ทันที
      fetchAndRender(container);        // แล้วดึงข้อมูลใหม่เบื้องหลัง
    } else {
      container.innerHTML = dashboardSkel();
      fetchAndRender(container);
    }
  },
};
