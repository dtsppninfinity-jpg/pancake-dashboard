/* ============================================================
   dashboard — หน้า Dashboard (ภาพรวมแชทตามช่วงที่เลือก)
   ข้อมูลจริงจาก apiDashboard({preset,from,to,channel}) — กรอง/รวมยอดฝั่ง server
   (port จาก JsDashboard.html — โครง HTML/class/ข้อความ/esc คงเดิมทุกตัวอักษร)
   ⚠️ วิดเจ็ตที่มาจากตาราง conversations (สัดส่วนการตอบ/ประเภท/แท็ก/แยกตามเพจ/แชทที่รอตอบ)
      เป็น "ค่าตอนนี้ 24 ชม.ล่าสุด" เสมอ — ตารางนั้นเก็บสถานะล่าสุดของแต่ละแชท ไม่ใช่ประวัติรายวัน
      จึงย้อนหลังตามช่วงที่เลือกไม่ได้ ต้องติดป้าย nowBadge_() กำกับให้ผู้ใช้รู้
   ============================================================ */

import {
  serverCall, esc, fmtNum, pctFmt, platformIcon, avatarHtml,
  showError, toast, tagColor, rangeControlsHtml, bindRangeControls, RangeState,
} from '@/lib/ui/helpers';
import { svgWeekBars, svgDonut, hbarRows, bindChartTips, hideChartTip } from '@/lib/ui/charts';
import { dashboardSkel, dashboardBodySkel } from '@/lib/ui/skeletons';

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

const CHANNELS: { key: string; label: string }[] = [
  { key: '', label: 'ทั้งหมด' },
  { key: 'facebook', label: '📘 Facebook' },
  { key: 'line', label: '🟢 LINE OA' },
  { key: 'comment', label: '💭 คอมเมนต์' }, // มุมมองเฉพาะคอมเมนต์ (ทุก platform)
];

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

const NOW_TIP = 'ค่าตอนนี้จากบทสนทนา 24 ชม.ล่าสุด — ตาราง conversations เก็บ "สถานะล่าสุด" ' +
  'ของแต่ละแชท ไม่ใช่ประวัติรายวัน จึงย้อนหลังตามช่วงที่เลือกไม่ได้';

/**
 * ป้ายเตือนว่าวิดเจ็ตนี้ไม่ขึ้นกับช่วงที่เลือก (ค่าตอนนี้เสมอ)
 * เลือก "วันนี้" อยู่แล้วไม่ต้องขึ้น — หัวข้อการ์ดเขียน "(24 ชม.)" กำกับไว้อยู่แล้ว
 */
function nowBadge_(): string {
  if (isTodayRange_()) return '';
  return ' <span class="badge info" title="' + esc(NOW_TIP) + '">⏱️ ตอนนี้ (24 ชม.ล่าสุด) — ไม่ขึ้นกับช่วงที่เลือก</span>';
}

/** หมายเหตุตัวเลขรวมหลายวัน (คนเดิมที่ทักคนละวันถูกนับซ้ำ — endpoint ต้นทางไม่มี unique ข้ามวัน) */
function multiDayNote_(): string {
  return rangeDays > 1 ? ' — รวมรายวัน ' + rangeDays + ' วัน (คนเดิมที่ทักคนละวันนับซ้ำ)' : '';
}

/* ---------------- ชิ้นส่วน HTML ---------------- */

function chipRowHtml(): string {
  const pills = CHANNELS.map((c) => {
    return '<button class="filter-btn' + (state.channel === c.key ? ' active' : '') +
      '" data-ch="' + esc(c.key) + '">' + esc(c.label) + '</button>';
  }).join('');
  return '<div class="conv-filters" id="dash-channels">' + pills + '</div>';
}

/** แถวควบคุม: ช่วงเวลา (idPrefix 'db') + ช่องทาง */
function controlsHtml(): string {
  return '<div class="pg-controls" id="dash-range">' + rangeControlsHtml(state, 'db') + '</div>' +
    chipRowHtml();
}

function statCard(icon: string, iconCls: string, label: string, valueHtml: string, hintHtml: string): string {
  return '<div class="stat-card">' +
    '<div class="stat-icon ' + iconCls + '">' + icon + '</div>' +
    '<div style="min-width:0">' +
    '<div class="stat-label">' + label + '</div>' +
    '<div class="stat-value">' + valueHtml + '</div>' +
    '<div class="stat-hint">' + hintHtml + '</div>' +
    '</div></div>';
}

function statGridHtml(k: Kpis, donut?: DonutData): string {
  const waiting = Number(k.waiting) || 0;
  const d: DonutData = donut || {};
  const ai = Number(d.ai) || 0;
  const convBase = (Number(d.replied) || 0) + ai + (Number(d.waiting) || 0);
  const aiPct = convBase ? Math.round((ai / convBase) * 100) : 0;
  const commentMode = state.channel === 'comment';
  const cards: string[] = [];
  if (commentMode) {
    // มุมคอมเมนต์: ตัวเลขแรกคือ "จำนวนคอมเมนต์" ไม่ใช่บทสนทนา — ป้ายต้องตรงความหมาย
    cards.push(statCard('💭', 'purple', rangeTitle_('คอมเมนต์จากลูกค้า'), fmtNum(k.custMsgs),
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
      ' data-tip-src="Pancake · statistics/customer_engagements">';
    const convSub = hasEng
      ? 'อินบ็อกซ์ใหม่ ' + fmtNum(k.engNewInbox || 0) + ' + คอมเมนต์ ' + fmtNum(k.engComment || 0) +
        ' • 📞 เบอร์ใหม่ ' + fmtNum(k.phones)
      : 'ข้อความลูกค้า ' + fmtNum(k.custMsgs) + ' • 📞 เบอร์ใหม่ ' + fmtNum(k.phones);
    cards.push(statCard('💬', 'purple', rangeTitle_('คนทัก'),
      '<span' + convTip + fmtNum(reached) + '</span>', convSub));
  }
  // ⚠️ pageReplies = จำนวน "ข้อความ" ที่เพจส่งในช่วงที่เลือก (รวมบอต/ข้อความอัตโนมัติ/บรอดแคสต์)
  //    ไม่ใช่จำนวนบทสนทนาที่ตอบ — และคนละชุดข้อมูล/คนละช่วงเวลากับ replyRate (24 ชม. จาก conversations)
  //    เดิมเอามาแปะคู่กันในการ์ดเดียว ทำให้ดูเหมือน "ตอบ 94% จาก 47,375 ครั้ง" ซึ่งไม่จริง
  //    replyRate ยังอยู่ในการ์ดโดนัทที่เขียน "(24 ชม.)" กำกับไว้ชัดเจนแล้ว
  cards.push(statCard('📤', 'green', rangeTitle_('ข้อความที่เพจส่ง'), fmtNum(k.pageReplies),
    'รวมบอต/ข้อความอัตโนมัติ • ลูกค้าส่ง ' + fmtNum(k.custMsgs) + ' ข้อความ'));
  // 2 ใบนี้มาจาก conversations = ค่าตอนนี้เสมอ ไม่ขึ้นกับช่วงที่เลือก (ดูหมายเหตุหัวไฟล์)
  cards.push(statCard('🤖', 'purple', 'ตอบอัตโนมัติ (24 ชม.)', fmtNum(ai),
    (convBase ? '<b class="up">' + aiPct + '%</b> ของบทสนทนา 24 ชม.' : 'ยังไม่มีข้อมูล') + nowBadge_()));
  cards.push(statCard('👤', 'amber', 'รอแอดมินตอบ (ตอนนี้)', fmtNum(k.waiting),
    (waiting > 0 ? '<b class="warn">ต้องการความสนใจ</b>' : 'ไม่มีงานค้าง') + nowBadge_()));
  // ตัวเลขบรรทัดล่างมาจาก statistics/customer_engagements = ชุดเดียวกับหน้าสถิติแชทของ Pancake
  // ให้เทียบจอต่อจอได้ (บรรทัดบนมาจาก statistics/pages ซึ่งนับ "ลูกค้าใหม่" คนละนิยามเล็กน้อย)
  const engSub = (k.engNewInbox === null || k.engNewInbox === undefined)
    ? (commentMode ? 'ทุกช่องทางรวมกัน (แยกเฉพาะคอมเมนต์ไม่ได้)' : 'จากทุกเพจที่ sync')
    : 'Pancake นับ <b>' + fmtNum(k.engNewInbox) + '</b> คนเปิดแชทใหม่ • คุยทั้งหมด ' +
      fmtNum(k.engCustomers || 0) + ' คน';
  cards.push(statCard('🆕', 'blue', rangeTitle_('ลูกค้าใหม่'), fmtNum(k.newCustomers),
    engSub + esc(multiDayNote_())));
  return '<div class="stat-grid">' + cards.join('') + '</div>';
}

function weekCardHtml(data: DashData): string {
  const week = data.week;
  const body = (week && week.length)
    ? svgWeekBars(week)
    : '<div class="empty-note">ยังไม่มีข้อมูล</div>';
  // กราฟยึดวันท้ายของช่วงที่เลือก แต่กว้าง 7-14 วันเสมอ (server เป็นคนตัดสิน + ส่ง weekLabel มา)
  const note = data.weekNote
    ? '<span style="margin-left:14px">📌 ' + esc(data.weekNote) + '</span>'
    : '';
  // ป้ายต้องบอกว่าเป็น "จำนวนข้อความ" ไม่ใช่บทสนทนา — เพจส่งสคริปต์ขายทีละหลายบับเบิล
  // แท่งม่วงจึงสูงกว่าแท่งฟ้าหลายเท่าเป็นปกติ (ไม่ใช่ข้อมูลผิด)
  return '<div class="card">' +
    '<h3>ปริมาณข้อความ ' + esc(data.weekLabel || '7 วันล่าสุด') + '</h3>' +
    '<div class="card-sub">' +
    '<span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:#3b82f6;vertical-align:middle;margin-right:5px"></span>ลูกค้าส่ง' +
    '<span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:#6c5ce7;vertical-align:middle;margin:0 5px 0 14px"></span>เพจส่ง (รวมบอต/บรอดแคสต์)' +
    note +
    '</div>' +
    body + '</div>';
}

function legendRow(color: string, label: string, value: number | undefined): string {
  return '<div class="row"><span class="dot" style="background:' + color + '"></span>' +
    esc(label) + '<b>' + fmtNum(value) + '</b></div>';
}

function donutCardHtml(k: Kpis, donut?: DonutData): string {
  const rate = Number(k.replyRate) || 0;
  const d: DonutData = donut || {};
  return '<div class="card">' +
    '<h3>สัดส่วนการตอบ (24 ชม.)</h3>' +
    '<div class="card-sub">แอดมินตอบ vs ตอบอัตโนมัติ vs รอตอบ' + nowBadge_() + '</div>' +
    '<div class="donut-wrap">' +
    svgDonut(rate, esc(pctFmt(k.replyRate)), 'ตอบแล้ว') +
    '<div class="donut-legend">' +
    legendRow('#2dd4a0', 'แอดมินตอบ', d.replied) +
    legendRow('#6c5ce7', 'ตอบอัตโนมัติ', d.ai) +
    legendRow('#ff5d7a', 'รอตอบ', d.waiting) +
    '</div></div></div>';
}

function typeLabel(t: string | undefined): string {
  const u = String(t || '').toUpperCase();
  if (u === 'INBOX') return '💬 ข้อความ';
  if (u === 'COMMENT') return '💭 คอมเมนต์';
  return String(t || '-');
}

function byTypeCardHtml(byType?: ByTypeItem[]): string {
  const items = (byType || []).slice().sort((a, b) => {
    return (Number(b.count) || 0) - (Number(a.count) || 0);
  }).map((t) => {
    return { label: typeLabel(t.label), value: Number(t.count) || 0 };
  });
  return '<div class="card">' +
    '<h3>ประเภทบทสนทนา (24 ชม.)</h3>' +
    '<div class="card-sub">แยกตามช่องทางที่ลูกค้าทักเข้ามา' + nowBadge_() + '</div>' +
    hbarRows(items, { empty: 'ยังไม่มีข้อมูล' }) + '</div>';
}

function tagsCardHtml(tags?: TagItem[]): string {
  let body: string;
  if (tags && tags.length) {
    body = '<div class="tag-cloud">' + tags.map((t) => {
      return '<span class="chip"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;' +
        'background:' + tagColor(t.name) + ';margin-right:5px;vertical-align:middle"></span>' + esc(t.name) +
        ' <b style="opacity:.65">×' + fmtNum(t.count) + '</b></span>';
    }).join('') + '</div>';
  } else {
    body = '<div class="empty-note">ยังไม่มีแท็ก</div>';
  }
  return '<div class="card">' +
    '<h3>แท็กที่ใช้บ่อย</h3>' +
    '<div class="card-sub">นับจากบทสนทนาใน 24 ชม.ล่าสุด' + nowBadge_() + '</div>' +
    body + '</div>';
}

function byPageCardHtml(byPage?: ByPageItem[]): string {
  const items = (byPage || []).map((p) => {
    return {
      label: platformIcon(p.platform) + ' ' + String(p.name || '-'),
      value: Number(p.count) || 0,
      cls: 'blue',
    };
  });
  return '<div class="card">' +
    '<h3>แชทแยกตามเพจ (24 ชม.)</h3>' +
    '<div class="card-sub">เพจที่ลูกค้าทักเยอะที่สุด (top 8)' + nowBadge_() + '</div>' +
    hbarRows(items, { cls: 'blue', empty: 'ยังไม่มีข้อมูล' }) + '</div>';
}

function commentByPageCardHtml(commentByPage?: ByPageItem[]): string {
  const items = (commentByPage || []).map((p) => {
    return {
      label: platformIcon(p.platform) + ' ' + String(p.name || '-'),
      value: Number(p.count) || 0,
    };
  });
  return '<div class="card">' +
    '<h3>💭 คอมเมนต์แยกตามเพจ (' + esc(rangeLabel) + ')</h3>' +
    '<div class="card-sub">เพจที่ลูกค้าคอมเมนต์เยอะที่สุด (top 8) — จากสถิติรายชั่วโมงจริง</div>' +
    hbarRows(items, { empty: isTodayRange_() ? 'วันนี้ยังไม่มีคอมเมนต์' : 'ช่วงนี้ยังไม่มีคอมเมนต์' }) + '</div>';
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

function attentionCardHtml(attention?: AttentionItem[]): string {
  let body: string;
  if (attention && attention.length) {
    body = attention.slice(0, 30).map((a) => {
      const mins = Number(a.waitMins) || 0;
      const urgent = mins >= 60; // รอเกิน 1 ชม. = ด่วน
      // เปิดแชทนี้ใน Pancake web (แท็บใหม่) — id บทสนทนา = "{pageId}_{เลขแชท}"
      const pancakeUrl = 'https://pancake.vn/' + encodeURIComponent(String(a.pageId || '')) +
        '?c_id=' + encodeURIComponent(String(a.id || ''));
      return '<div class="attn-item' + (urgent ? ' urgent' : '') + '">' +
        avatarHtml(a.id, a.customer) +
        '<div class="attn-body">' +
        '<div class="attn-name">' + esc(a.customer || '-') +
        ' <span>' + platformIcon(a.platform) + '</span>' +
        (urgent ? ' <span class="badge urgent">🔥 ด่วน</span>' : '') +
        ' <span class="badge admin">' + esc(waitLabel(a.waitMins)) + '</span></div>' +
        '<div class="attn-snippet">' + esc(a.snippet || '') + '</div>' +
        '</div>' +
        '<div style="text-align:right;flex-shrink:0">' +
        '<a class="btn-mini" href="' + esc(pancakeUrl) + '" target="_blank" rel="noopener" ' +
          'title="เปิดแชทนี้ใน Pancake (แท็บใหม่)">↗ เปิดใน Pancake</a>' +
        '<div style="font-size:10.5px;color:var(--text-3);margin-top:4px">' + esc(a.pageName || '') + '</div>' +
        '</div></div>';
    }).join('');
  } else {
    body = '<div class="empty-note">🎉 ไม่มีแชทค้างรอแอดมิน</div>';
  }
  return '<div class="card">' +
    '<h3>🔔 แชทที่รอแอดมินตอบ</h3>' +
    '<div class="card-sub">เรียงจากรอนานที่สุด — คลิก ↗ เพื่อเปิดตอบใน Pancake' + nowBadge_() + '</div>' +
    body + '</div>';
}

function bodyHtml(data: DashData): string {
  const k = (data && data.kpis) || {};
  // ป้ายช่วงเวลาที่ helper ด้านล่างใช้ร่วมกัน — ตั้งก่อนประกอบ HTML ทุกครั้ง
  rangeLabel = (data && data.rangeLabel) || 'วันนี้';
  rangeDays = Number(data && data.rangeDays) || 1;
  return statGridHtml(k, data.donut) +
    '<div class="dash-row">' +
      weekCardHtml(data) +
      donutCardHtml(k, data.donut) +
    '</div>' +
    '<div class="dash-row">' +
      byTypeCardHtml(data.byType) +
      tagsCardHtml(data.tags) +
    '</div>' +
    '<div class="dash-row">' +
      byPageCardHtml(data.byPage) +
      commentByPageCardHtml(data.commentByPage) +
    '</div>' +
    '<div class="dash-row single">' +
      attentionCardHtml(data.attention) +
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

function render(container: HTMLElement, data?: DashData | null): void {
  container.innerHTML = '<div id="dash-controls">' + controlsHtml() + '</div>' +
    '<div id="dash-body">' + bodyHtml(data || {}) + '</div>';
  bindControls(container);
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
      toast('⚠️ โหลดข้อมูลใหม่ไม่สำเร็จ: ' + ((err && err.message) || 'ไม่ทราบสาเหตุ'));
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
