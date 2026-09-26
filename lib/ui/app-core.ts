/* ============================================================
   app-core — App core + view registry (port จาก JsCommon.html)
   รันบน browser เท่านั้น — client TS ESM
   - ลงทะเบียน Views ทั้ง 5 (import จาก @/lib/views/*)
   - แนบ App / VIEW_META ไว้บน globalThis เพื่อให้ไฟล์ view อ้างถึงได้ (กัน import cycle)
   - serverCall / esc / relTime / toast มาจาก helpers
   ============================================================ */

import { serverCall, esc, relTime, toast, openModal, modalCloseBtn, thaiDateShort } from '@/lib/ui/helpers';
import { icon, statusPill, ICON_FOR, type StatusKind } from '@/lib/ui/icons';
import { hideChartTip } from '@/lib/ui/charts';
import { bindInfoTips, hideInfoTip } from '@/lib/ui/infotip';
import { dashboard } from '@/lib/views/dashboard';
import { sales } from '@/lib/views/sales';
import { contentads } from '@/lib/views/contentads';
import { admins } from '@/lib/views/admins';
import { adminperf } from '@/lib/views/adminperf';
import { kpi } from '@/lib/views/kpi';
import { profit } from '@/lib/views/profit';
import { unitperf } from '@/lib/views/unitperf';
import { report } from '@/lib/views/report';
import { umap } from '@/lib/views/umap';
import { me } from '@/lib/views/me';
import { users } from '@/lib/views/users';

/* ---------------- types ---------------- */

interface ViewModule {
  load: (container: HTMLElement, force: boolean) => void | Promise<void>;
}

interface SyncLogEntry {
  ts: string;
  job: string;
  ok: boolean;
}

type SyncHealthKind = 'fail' | 'skip' | 'stale' | 'partial' | 'invariant';
interface SyncHealthItem { job: string; kind: SyncHealthKind | string; ageMins: number; message: string }

/** คำอธิบายอาการเป็นไทย — ใช้ในหน้าต่างรายละเอียดของผู้ดูแลระบบ */
function healthKindTh(h: SyncHealthItem): string {
  if (h.kind === 'fail') return 'ล้มเหลว';
  if (h.kind === 'skip') return 'ถูกข้าม';
  if (h.kind === 'partial') return 'ข้อมูลไม่ครบ';
  if (h.kind === 'invariant') return 'ตัวเลขผิดปกติ';
  return 'เงียบ ' + Math.round(h.ageMins / 60) + ' ชม.';
}

/** สีป้ายของแต่ละอาการ: ล้ม/ตัวเลขผิด = แดง (หน้าเว็บกำลังโชว์ของผิดหรือไม่ขยับเลย) ที่เหลือ = ส้ม */
function healthTone(h: SyncHealthItem): StatusKind {
  return h.kind === 'fail' || h.kind === 'invariant' ? 'bad' : 'warn';
}

/** ชื่องานดึงข้อมูลเบื้องหลังเป็นภาษาคน — ชื่อจริงมาจาก runJob('ชื่อ', ...) ใน scripts/sync/index.ts
    (+ orders-delta / invariants / env-check ที่ลง log เอง) งานใหม่ที่ยังไม่อยู่ในรายการนี้จะโชว์ชื่อดิบแทน
    ไม่พัง แค่อ่านยาก — เพิ่มงานใหม่เมื่อไหร่ให้เติมชื่อที่นี่ด้วย */
const JOB_LABEL: Record<string, string> = {
  orders: 'ออเดอร์',
  'orders-delta': 'ยอดขายสดรายนาที',
  'chat-today': 'สถิติแชทวันนี้',
  'chat-yesterday': 'สถิติแชทเมื่อวาน',
  conversations: 'รายการแชท',
  'online-status': 'สถานะออนไลน์แอดมิน',
  'engagements-today': 'ยอดคนทักวันนี้',
  'engagements-yesterday': 'ยอดคนทักเมื่อวาน',
  'admin-chat-today': 'สถิติตอบแชทรายแอดมิน',
  'admin-chat-2d': 'สถิติตอบแชทรายแอดมิน (ย้อน 2 วัน)',
  'meta-ads-recent': 'ค่าแอดจาก Meta',
  'meta-ads-yesterday': 'ค่าแอดจาก Meta (เมื่อวาน)',
  pages: 'รายชื่อเพจ',
  ads: 'รายการแอด',
  'admins-roster': 'รายชื่อแอดมิน',
  'ad-creatives': 'ครีเอทีฟแอด',
  'ad-stats-today': 'สถิติแอดจาก Pancake',
  'ad-stats-yesterday': 'สถิติแอดจาก Pancake (เมื่อวาน)',
  'ad-page-fill': 'จับคู่แอดกับเพจ',
  'unit-alerts': 'แจ้งเตือนยูนิตขาดทุน',
  'kpi-sheet': 'ชีท KPI',
  'roster-sheet': 'ชีทยันยอดแอดมิน',
  returns: 'ตีกลับจากชีท',
  'product-sheets': 'กำไรและค่าคอมจากชีทสินค้า',
  prune: 'ล้างข้อมูลเก่า',
  invariants: 'ตรวจความถูกต้องของตัวเลข',
  'env-check': 'ตรวจการตั้งค่าระบบ',
};

/** งานที่ไม่ได้ "ดึงข้อมูล" (ตรวจ/ล้าง/ดีบัก) — ไม่นับเป็นเวลาอัปเดตข้อมูลล่าสุดบนหัวเว็บ */
const NOT_DATA_JOB = ['invariants', 'env-check', 'prune'];
const isDataJob = (job: string) => NOT_DATA_JOB.indexOf(job) < 0 && job.indexOf('trace-') !== 0;

/** เวลาที่ถือว่าข้อมูล "ค้าง" สำหรับทีม — งานหลักรันทุก 15 นาที เกิน 60 นาที = พลาดไปแล้ว ~4 รอบ */
const STALE_MINS = 60;

/** ts จาก apiBootstrap = 'YYYY-MM-DDTHH:mm:ss' เป็นเวลาไทยแต่ไม่มีโซนเวลาติดมา
    ต้องเติม +07:00 เอง ไม่งั้นเครื่องที่ตั้งโซนเวลาอื่นจะคลาดเป็นชั่วโมง */
const bkkIso = (ts: string) => String(ts || '').replace(' ', 'T').slice(0, 19) + '+07:00';
const bkkMs = (ts: string) => Date.parse(bkkIso(ts));

/** 'HH:MM' ถ้าเป็นวันนี้ (เวลาไทย) ไม่งั้น '25 ก.ย. 69 HH:MM' — ts เป็นเวลาไทยอยู่แล้ว ตัดสตริงได้ตรงๆ */
function stampText(ts: string): string {
  const day = String(ts).slice(0, 10);
  const hm = String(ts).slice(11, 16);
  const todayBkk = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  return day === todayBkk ? hm : thaiDateShort(day) + ' ' + hm;
}

/** จำนวนนาที → 'x นาที/ชม./วันที่แล้ว' (ใช้กับงานที่ไม่มีแถวใน log ให้อ่านเวลา เช่น orders-delta) */
function agoText(mins: number): string {
  if (!isFinite(mins) || mins >= 999999) return 'ยังไม่เคยทำงานสำเร็จ';
  if (mins < 60) return Math.max(0, Math.round(mins)) + ' นาทีที่แล้ว';
  if (mins < 24 * 60) return Math.round(mins / 60) + ' ชม.ที่แล้ว';
  return Math.round(mins / 1440) + ' วันที่แล้ว';
}

/** หน้าต่างรายละเอียด "ข้อมูลส่วนไหนไม่อัปเดต" — เปิดได้เฉพาะผู้ดูแลระบบ */
function openSyncProblems(b: Bootstrap): void {
  const byJob: Record<string, SyncLogEntry> = {};
  (b.lastSync || []).forEach(function (l) { byJob[l.job] = l; });
  const items = ((b.syncHealth || []) as SyncHealthItem[]).map(function (h) {
    const last = byJob[h.job];
    // บอก "ครั้งล่าสุดที่ทำงาน" จากแถวล่าสุดใน log — ถ้าแถวนั้นล้ม ก็บอกตรงๆ ว่ารอบล่าสุดไม่สำเร็จ
    const when = last && last.ts
      ? (last.ok ? 'ทำงานสำเร็จล่าสุด ' : 'ทำงานล่าสุด (ไม่สำเร็จ) ') + stampText(last.ts) +
        ' · ' + relTime(bkkIso(last.ts))
      : 'อัปเดตสำเร็จล่าสุด ' + agoText(h.ageMins);
    return '<li class="sync-item">' +
      '<div class="sync-item-top">' +
        '<b>' + esc(JOB_LABEL[h.job] || h.job) + '</b>' +
        (JOB_LABEL[h.job] ? '<code class="sync-job">' + esc(h.job) + '</code>' : '') +
        statusPill(healthTone(h), esc(healthKindTh(h))) +
      '</div>' +
      '<div class="sync-item-when">' + esc(when) + '</div>' +
      (h.message ? '<div class="sync-item-msg">' + esc(h.message) + '</div>' : '') +
    '</li>';
  }).join('');
  openModal(
    '<div class="modal-head"><h3>ข้อมูลที่ไม่อัปเดต</h3>' + modalCloseBtn() + '</div>' +
    '<div class="card-sub">งานดึงข้อมูลเบื้องหลังที่มีปัญหาตอนนี้ — หน้านี้เห็นเฉพาะผู้ดูแลระบบ ' +
      '(ทีมขายเห็นแค่เวลาอัปเดตล่าสุดบนหัวเว็บ)</div>' +
    '<ul class="sync-list">' + items + '</ul>' +
    '<div class="modal-actions"><button type="button" class="btn modal-close">ปิด</button></div>'
  );
}

interface Bootstrap {
  lastSync?: SyncLogEntry[];
  syncHealth?: SyncHealthItem[];
  [k: string]: unknown;
}

/* ---------------- view registry ---------------- */

// แต่ละไฟล์ view export { load } — ผูกเข้า registry ตามชื่อ key เดิม (เทียบ Views.<name> ใน GAS)
const Views: Record<string, ViewModule> = {
  dashboard,
  sales,
  contentads,
  admins,
  adminperf,
  kpi,
  profit,
  unitperf,
  report,
  umap,
  me,
  users,
};

const VIEW_META: Record<string, { title: string; sub: string }> = {
  dashboard:  { title: 'Dashboard', sub: 'ภาพรวมแชทวันนี้ — ข้อมูลจริงจาก Pancake (sync ทุก 15 นาที)' },
  sales:      { title: 'Sales Dashboard', sub: 'ยอดขาย Facebook / LINE จาก Pancake POS' },
  contentads: { title: 'Content & Ads Performance', sub: 'แอดที่กำลังยิง + คำแนะนำจากตัวเลขจริง' },
  admins:     { title: 'Admin Management', sub: 'รายชื่อแอดมิน • สถานะออนไลน์ • สิทธิ์' },
  adminperf:  { title: 'Admin Performance', sub: 'Ranking ยอดขาย • Top 3' },
  kpi:        { title: 'KPI ทีมขาย', sub: 'หัวหน้า • รองหัวหน้า • แอดมิน — คะแนนจากชีท KPI ของทีม' },
  profit:     { title: 'กำไร & ตีกลับ', sub: 'กำไรสุทธิจริงรายยูนิต/เดือน/ปี + ตีกลับ — จากชีททีม' },
  unitperf:   { title: 'ผลงานราย Unit', sub: 'การ์ดรายยูนิต: ยอด vs เป้า • คาดการณ์สิ้นเดือน • สัญญาณเตือน' },
  report:     { title: 'รายงาน & การตลาด', sub: 'เป้า vs จริง รายวีค/เดือน/ปี • ซื้อซ้ำรายยูนิต' },
  umap:       { title: 'U Map', sub: 'แอดมินอยู่ U ไหน — จับคู่ • เพิ่ม/ลบ U • มี API ให้ระบบอื่นดึง' },
  me:         { title: 'ผลงานของฉัน', sub: 'ยอดขาย • KPI • อันดับของคุณ' },
  users:      { title: 'ผู้ใช้งาน', sub: 'บัญชีเข้าระบบ • ระดับสิทธิ์' },
};

/* ---------- สลับธีม สว่าง/มืด (จำค่าไว้ใน localStorage) ---------- */

function setTheme(theme: string): void {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('pn-theme', t); } catch (e) {}
  const btn = document.getElementById('btn-theme');
  if (btn) {
    // ปุ่มบอก "โหมดที่จะสลับไป" (กดแล้วได้อะไร) ไม่ใช่โหมดปัจจุบัน
    // ไอคอนพระอาทิตย์/พระจันทร์อยู่ในปุ่มทั้งคู่แล้ว (page.tsx) CSS สลับให้ตาม data-theme — ที่นี่แก้แค่ชื่อปุ่ม
    const label = t === 'light' ? 'เปลี่ยนเป็นโหมดมืด' : 'เปลี่ยนเป็นโหมดสว่าง';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
  }
}

function toggleTheme(): void {
  const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  setTheme(cur === 'light' ? 'dark' : 'light');
}

/* ---------- เมนูบนมือถือ: sidebar เลื่อนเข้าจากซ้าย + ฉากหลังทึบ ---------- */

/* ---------- พับ/กางแถบเมนูบนจอกว้าง ----------
   แถบเมนูกว้าง 250px คงที่ บน iPad แนวตั้ง (1024px) มันกินไปหนึ่งในสี่ของจอ
   เหลือเนื้อหา 774px ซึ่งแคบจนการ์ดแอดบีบชื่อไทยเหลือ 0px (ตัดทีละตัวอักษร)
   ปุ่ม ☰ จึงใช้ได้ทุกขนาดจอ: จอแคบ = เปิด/ปิดลิ้นชัก, จอกว้าง = พับ/กางแถบเมนู */
const NAV_PREF_KEY = 'pn-nav';
const wideScreen = () => window.matchMedia('(min-width: 900px)').matches;

/** ค่าเริ่มต้นตอนยังไม่เคยเลือก: จอ ≥1200 กางไว้ (มีที่พอ), แคบกว่านั้นพับไว้ก่อน */
function applyNavPref(): void {
  const app = document.getElementById('app');
  if (!app) return;
  let saved: string | null = null;
  try { saved = localStorage.getItem(NAV_PREF_KEY); } catch (e) {}
  const roomy = window.matchMedia('(min-width: 1200px)').matches;
  app.classList.toggle('nav-hidden', saved ? saved === 'hide' : !roomy);
}

function toggleSidebarPinned(): void {
  const app = document.getElementById('app');
  if (!app) return;
  const hide = !app.classList.contains('nav-hidden');
  app.classList.toggle('nav-hidden', hide);
  try { localStorage.setItem(NAV_PREF_KEY, hide ? 'hide' : 'show'); } catch (e) {}
}

function setNavOpen(open: boolean): void {
  // แตะแท็บในลิ้นชักแล้วลิ้นชักปิด — ตัวที่ถูกแตะหายไปโดยไม่มี mouseout
  // กรอบอธิบายที่เพิ่งเด้งขึ้นมาจึงค้างกลางจอ ต้องสั่งปิดตรงนี้เอง
  hideInfoTip();
  const app = document.getElementById('app');
  if (app) app.classList.toggle('nav-open', open);
  // ล็อกไม่ให้หน้าเลื่อนตอนเมนูเปิด (ไม่งั้นนิ้วปัดแล้วพื้นหลังไหลตาม)
  // ใช้คลาสไม่ใช่ style ตรงๆ เพื่อให้ CSS ปลดล็อกเองได้ตอนจอกว้าง ≥900
  // (หมุนจอเป็นแนวนอนทั้งที่เมนูเปิดค้าง แล้วหน้าเลื่อนไม่ได้ — style ตรงๆ ไม่มีทางแก้ด้วย CSS)
  document.body.classList.toggle('nav-locked', open);
}

/* ---------------- badge แจ้งเตือนบนเมนูข้าง (แบบแอปมือถือ) ---------------- */

/** วาด/ลบตัวเลขมุมแท็บ — count 0 = เอาออก */
function setNavBadge(view: string, count: number, warn?: boolean, tip?: string): void {
  const btn = document.querySelector('.nav-item[data-view="' + view + '"]') as HTMLElement | null;
  if (!btn) return;
  let b = btn.querySelector('.nav-badge') as HTMLElement | null;
  if (!count) { if (b) b.remove(); btn.classList.remove('has-badge'); return; }
  if (!b) {
    b = document.createElement('span');
    btn.appendChild(b);
  }
  btn.classList.add('has-badge'); // เว้นที่ด้านขวาไม่ให้เลขทับชื่อแท็บ
  b.className = 'nav-badge' + (warn ? ' warn' : '');
  b.textContent = count > 9 ? '9+' : String(count); // เพดาน 9+ พอ — บอกว่า "เยอะ" ก็พอแล้ว
  if (tip) btn.title = tip;
}

/** ดึงจำนวนเรื่องด่วนมาแปะแท็บ Sales / Content & Ads — เงียบเมื่อพลาด (badge ไม่ใช่ของสำคัญพอให้เด้ง error) */
function refreshNavBadges(): void {
  // role ที่ไม่มีสองแท็บนี้ (ระดับแอดมิน) ไม่ต้องยิง API เลย
  if (!document.querySelector('.nav-item[data-view="sales"], .nav-item[data-view="contentads"]')) return;
  serverCall<any>('apiNavBadges').then(function (b) {
    const s = (b && b.sales) || { urgent: 0, warn: 0 };
    // แดง = ขาดทุน ≥2 วันติด; ไม่มีด่วนแต่มีเฝ้าระวัง → ส้ม
    if (s.urgent > 0) setNavBadge('sales', s.urgent, false, 'ยูนิตขาดทุน ≥2 วันติด ' + s.urgent + ' ยูนิต');
    else setNavBadge('sales', s.warn, true, s.warn ? 'ยูนิตเฝ้าระวังขาดทุน ' + s.warn + ' ยูนิต' : '');
    const c = (b && b.contentads) || { urgent: 0 };
    setNavBadge('contentads', c.urgent, false, c.urgent ? 'แอดที่ควรหยุด/แก้ด่วน ' + c.urgent + ' รายการ' : '');
  }).catch(function () {});
}

/* ============================================================
   📱 ตารางบนมือถือ — ติดป้ายให้ CSS รู้ว่าตารางใบไหนควรกลายเป็นการ์ด
   ทำที่นี่แทนแก้ทั้ง 11 ไฟล์ view เพราะ view เขียน HTML เป็นสตริงและ render ใหม่ทั้งก้อน
   การไล่ใส่ data-label เองในทุกไฟล์จะพังทันทีที่มีคนเพิ่มคอลัมน์แล้วลืมแก้ป้าย
   สไตล์จริงอยู่ใน globals.css หัวข้อ "ตารางบนมือถือ"
   ============================================================ */

/** จำนวนคอลัมน์ที่เหมาะกับการ์ด — น้อยกว่านี้ตารางก็พอดีจออยู่แล้ว มากกว่านี้การ์ดจะยาวกว่าเลื่อน */
const CARD_MIN_COLS = 4;
const CARD_MAX_COLS = 8;
/** หัวคอลัมน์ที่ไม่เหมาะเป็นพาดหัวการ์ด (เป็นแค่ลำดับ/ช่องติ๊ก ไม่ได้บอกว่าแถวนี้ของใคร) */
const NOT_A_TITLE = ['#', '', 'อันดับ', 'ลำดับ', 'ที่', 'เลือก'];

/** ติดป้ายกำกับให้ทุกแถวที่ยังไม่มี — เรียกซ้ำได้ ใช้กับแถวที่ถูกเพิ่มทีหลัง (เช่น กาง "ดูทีม") */
function labelRows(tbl: HTMLTableElement, labels: string[], titleIdx: number): void {
  Array.from(tbl.querySelectorAll(':scope > tbody > tr:not(.tc-done)')).forEach(function (tr) {
    tr.classList.add('tc-done');
    const tds = Array.from(tr.children) as HTMLElement[];
    // แถว colspan (ไม่มีข้อมูล / แถวรวม) จับคู่ป้ายกำกับกับหัวคอลัมน์ไม่ได้ ปล่อยไว้เป็นบล็อกเปล่า
    if (tds.length !== labels.length) { tr.classList.add('tc-plain'); return; }
    tds.forEach(function (td, i) {
      if (labels[i]) td.setAttribute('data-label', labels[i]);
      if (i === titleIdx) td.classList.add('tc-title');
    });
  });
}

/* ---------- ตารางเลื่อนแนวนอน: ตรึง 2 คอลัมน์ + บอกว่ายังเลื่อนต่อได้ ----------
   ปัญหาบนมือถือ: (1) ตารางที่คอลัมน์แรกเป็น "#" พอเลื่อนแล้วชื่อหายไปทั้งแถว
   (2) ไม่มีอะไรบอกว่าขวามือยังมีคอลัมน์อีก คนเลยไม่รู้ว่าต้องเลื่อน
   (เดิมใช้เงาดำจางๆ ที่พื้นหลังกล่อง ซึ่งอยู่ "ใต้" ตัวเลข จึงแทบมองไม่เห็น)
   ความกว้างคอลัมน์แรกไม่ตายตัว (เลข 1 หลัก vs 2 หลัก / ป้ายอันดับ) จึงวัดของจริงแล้วส่งให้ CSS ทาง --pin1-w
   ResizeObserver ตัวเดียวดูทั้ง: หัวคอลัมน์แรก (วัดใหม่เมื่อหมุนจอ/ตารางโผล่จากที่ซ่อน) และกล่องเลื่อน/ตาราง
   (ขนาดเปลี่ยน = ต้องเช็คใหม่ว่ายังเลื่อนต่อได้ไหม) */
let sxObserver: ResizeObserver | null = null;
function sxObs(): ResizeObserver | null {
  if (sxObserver || typeof ResizeObserver === 'undefined') return sxObserver;
  sxObserver = new ResizeObserver(function (entries) {
    entries.forEach(function (en) {
      const el = en.target as HTMLElement;
      // ตารางถูก view เขียนทับไปแล้ว — เลิกดู ไม่งั้นค้างอยู่ในหน่วยความจำทุกรอบรีเฟรช 5 นาที
      if (!el.isConnected) { sxObserver!.unobserve(el); return; }
      if (el.tagName === 'TH') {
        const tbl = el.closest('table') as HTMLElement | null;
        const w = Math.round(el.getBoundingClientRect().width);
        if (tbl && w > 0) tbl.style.setProperty('--pin1-w', w + 'px');
      } else if (el.tagName === 'TABLE') {
        if (el.parentElement) sxUpdate(el.parentElement);
      } else {
        sxUpdate(el);
      }
    });
  });
  return sxObserver;
}

function pinSecondColumn(tbl: HTMLTableElement, firstTh: HTMLElement): void {
  tbl.classList.add('tbl-pin2');
  const w = Math.round(firstTh.getBoundingClientRect().width);
  if (w > 0) tbl.style.setProperty('--pin1-w', w + 'px');
  const ro = sxObs();
  if (ro) ro.observe(firstTh);
}

/** ยังเลื่อนไปทางขวาได้อีกไหม → ติด .sx-more (จางขอบขวา + ลูกศร) · เลื่อนสุดแล้ว/ไม่ล้นจอ = เอาออก */
function sxUpdate(sc: HTMLElement): void {
  if (!sc.hasAttribute('data-sx')) return;
  const more = sc.scrollWidth - sc.clientWidth - sc.scrollLeft > 2;
  sc.classList.toggle('sx-more', more);
  const frame = sc.parentElement;
  if (frame && frame.classList.contains('sx-frame')) frame.classList.toggle('sx-more', more);
}

function bindScrollHint(tbl: HTMLTableElement): void {
  const sc = tbl.parentElement;
  if (!sc) return;
  const ox = getComputedStyle(sc).overflowX;
  if (ox !== 'auto' && ox !== 'scroll') return;   // ไม่ใช่กล่องเลื่อน (ตารางวางลอยๆ) — ไม่มีอะไรให้บอก
  if (!sc.hasAttribute('data-sx')) {
    sc.setAttribute('data-sx', '1');
    sc.classList.add('sx-scroll');
    // passive = ไม่ขวางการเลื่อนของเบราว์เซอร์ (แค่อ่านตำแหน่ง ไม่ preventDefault)
    sc.addEventListener('scroll', function () { sxUpdate(sc); }, { passive: true });
    // ลูกศรต้องอยู่นอกกล่องเลื่อน ไม่งั้นมันเลื่อนหนีไปกับตาราง → ห่อกล่องเลื่อนด้วยกรอบ position:relative
    // ห่อเฉพาะเมื่อแม่เป็นบล็อกธรรมดา: ถ้าแม่เป็น flex/grid การแทรกกรอบจะเปลี่ยนว่าใครเป็นลูกของเลย์เอาต์
    // (กรณีนั้นยังได้ขอบจางจาก mask ของกล่องเลื่อนเอง แค่ไม่มีลูกศร)
    const host = sc.parentElement;
    if (host && !host.classList.contains('sx-frame') && !sc.classList.contains('card')) {
      const d = getComputedStyle(host).display;
      if (d === 'block' || d === 'flow-root') {
        const frame = document.createElement('div');
        frame.className = 'sx-frame';
        host.insertBefore(frame, sc);
        frame.appendChild(sc);
      }
    }
    const ro = sxObs();
    if (ro) ro.observe(sc);
  }
  const ro = sxObs();
  if (ro) ro.observe(tbl);   // แถวงอกเพิ่มทีหลัง (กางดูทีม/โหลดเพิ่ม) ความกว้างตารางเปลี่ยนได้
  sxUpdate(sc);
}

function classifyTable(tbl: HTMLTableElement): void {
  // แถวหัวแรกเท่านั้น — ตารางที่มีหัว 2 ชั้นจะนับคอลัมน์เกินจริง
  const ths = Array.from(tbl.querySelectorAll(':scope > thead > tr:first-child > th')) as HTMLElement[];
  const cols = ths.length;
  const merged = ths.some((th) => th.hasAttribute('colspan') || th.hasAttribute('rowspan'));

  if (!cols || merged || cols > CARD_MAX_COLS) {
    // หัวซับซ้อน/คอลัมน์เยอะ = ปล่อยเป็นตารางเลื่อนแนวนอน ตรึงคอลัมน์แรกไว้
    if (cols > CARD_MAX_COLS || merged) {
      tbl.classList.add('tbl-scroll-x');
      // คอลัมน์แรกเป็นแค่ลำดับ (#) → ตรึงคอลัมน์ที่ 2 (ชื่อ) ด้วย ไม่งั้นเลื่อนแล้วเหลือแต่เลข 1 2 3
      // ไม่รู้ว่าแถวนี้ของใคร (ตารางแอดมิน KPI / สรุปรายปี / ค่าคอม) · หัว 2 ชั้นไม่ทำ เพราะ nth-child ไม่ตรงคอลัมน์
      const first = (ths[0].textContent || '').trim();
      if (!merged && cols > 2 && NOT_A_TITLE.indexOf(first) >= 0) pinSecondColumn(tbl, ths[0]);
      bindScrollHint(tbl);
    }
    tbl.setAttribute('data-cards', 'off');
    return;
  }
  if (cols < CARD_MIN_COLS) { tbl.setAttribute('data-cards', 'off'); return; }

  const labels = ths.map((th) => (th.textContent || '').trim());
  let titleIdx = labels.findIndex((t) => NOT_A_TITLE.indexOf(t) < 0);
  if (titleIdx < 0) titleIdx = 0;
  tbl.setAttribute('data-cards', 'on');
  tbl.setAttribute('data-card-title', String(titleIdx));
  tbl.classList.add('tbl-cards');
  labelRows(tbl, labels, titleIdx);
}

let enhanceQueued = false;
/** ไล่ตารางที่ยังไม่ถูกติดป้าย — รวบทุกการเปลี่ยนแปลงใน 1 เฟรม ไม่ให้ทำซ้ำตอน view วาดหลายก้อน */
function queueTableScan(): void {
  if (enhanceQueued) return;
  enhanceQueued = true;
  requestAnimationFrame(function () {
    enhanceQueued = false;
    document.querySelectorAll('table.tbl:not([data-cards])').forEach(function (t) {
      try { classifyTable(t as HTMLTableElement); }
      catch (e) { t.setAttribute('data-cards', 'off'); } // ตารางแปลกๆ ต้องไม่ทำให้ทั้งหน้าพัง
    });
    // ตารางที่เป็นการ์ดอยู่แล้วแต่มีแถวงอกมาทีหลัง (ปุ่มกางลูกทีม / โหลดเพิ่ม) ต้องได้ป้ายด้วย
    document.querySelectorAll('table.tbl[data-cards="on"]').forEach(function (t) {
      const tbl = t as HTMLTableElement;
      if (!tbl.querySelector(':scope > tbody > tr:not(.tc-done)')) return;
      const labels = Array.from(tbl.querySelectorAll(':scope > thead > tr:first-child > th'))
        .map((th) => (th.textContent || '').trim());
      labelRows(tbl, labels, Number(tbl.getAttribute('data-card-title') || 0));
    });
  });
}

/** เฝ้าทั้งหน้า: view เขียนทับด้วย innerHTML และโมดัลโผล่ทีหลัง จึงไม่มีจุดเดียวที่ hook ได้
    ดู childList อย่างเดียว — การใส่ class/attribute ของเราเองจึงไม่วนกลับมาเรียกตัวเอง */
function watchTables(): void {
  new MutationObserver(queueTableScan).observe(document.body, { childList: true, subtree: true });
  queueTableScan();
}

/* ---------------- App core ---------------- */

const App = {
  state: { view: 'dashboard' as string, bootstrap: null as Bootstrap | null },

  init(): void {
    const self = this;
    document.querySelectorAll('.nav-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        self.switchView(btn.getAttribute('data-view') as string);
        setNavOpen(false); // เลือกเมนูบนมือถือแล้วต้องปิดเมนูเอง ไม่งั้นบังหน้าจอ
      });
    });

    applyNavPref();
    const navBtn = document.getElementById('btn-nav');
    if (navBtn) {
      navBtn.addEventListener('click', function () {
        // จอกว้าง = พับ/กางแถบเมนูที่ปักซ้าย • จอแคบ = เปิด/ปิดลิ้นชัก
        if (wideScreen()) { toggleSidebarPinned(); return; }
        const app = document.getElementById('app');
        setNavOpen(!(app && app.classList.contains('nav-open')));
      });
    }
    const backdrop = document.getElementById('nav-backdrop');
    if (backdrop) backdrop.addEventListener('click', function () { setNavOpen(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setNavOpen(false);
    });

    const logout = document.getElementById('btn-logout');
    if (logout) {
      logout.addEventListener('click', function () {
        fetch('/api/logout', { method: 'POST' })
          .then(function () { window.location.href = '/login'; })
          .catch(function () { window.location.href = '/login'; });
      });
    }
    document.getElementById('btn-refresh')!.addEventListener('click', function () {
      self.loadView(self.state.view, true);
      toast('กำลังโหลดข้อมูลใหม่...', 'busy');
    });
    const themeBtn = document.getElementById('btn-theme');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
    setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
    bindInfoTips(); // tooltip กรอบอธิบายสูตร — ผูกครั้งเดียว ครอบทุก view
    watchTables();  // ตารางบนมือถือ → การ์ดต่อแถว (ติดป้ายอัตโนมัติทุกครั้งที่ view วาดใหม่)
    serverCall<Bootstrap>('apiBootstrap').then(function (b) {
      self.state.bootstrap = b;
      self.renderSyncInfo(b);
    }).catch(function () {});
    // หน้าแรกขึ้นกับสิทธิ์ — page.tsx บอกมาทาง data-first-view (ระดับแอดมินเริ่มที่ "ผลงานของฉัน")
    const first = (document.getElementById('app')?.getAttribute('data-first-view')) || 'dashboard';
    this.state.view = first;
    const meta = VIEW_META[first];
    if (meta) {
      document.getElementById('topbar-title')!.textContent = meta.title;
      document.getElementById('topbar-sub')!.textContent = meta.sub;
    }
    this.loadView(first, false);
    refreshNavBadges(); // ตัวเลขเรื่องด่วนบนแท็บ Sales / Content & Ads
    // รีเฟรชหน้าปัจจุบันอัตโนมัติทุก 5 นาที — แบบเบื้องหลัง (force=false = render จาก cache
    // แล้วค่อยดึงใหม่) และข้ามรอบถ้าแท็บถูกซ่อนหรือผู้ใช้กำลังพิมพ์/เลือกค่าอยู่
    setInterval(function () {
      if (document.hidden) return;
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA')) return;
      self.loadView(self.state.view, false);
      refreshNavBadges();
      serverCall<Bootstrap>('apiBootstrap').then(function (b) {
        self.state.bootstrap = b;
        self.renderSyncInfo(b);
      }).catch(function () {});
    }, 5 * 60 * 1000);
  },

  /**
   * สถานะความสดของข้อมูลบนหัวเว็บ — แยกตามสิทธิ์ (#app[data-role])
   * เดิมทุกคนเห็นชิปแดง "งาน sync มีปัญหา N งาน" + ชื่องานภาษาช่าง (engagements-today, invariants ...)
   * ใต้เมนู ทีมขายอ่านไม่ออกแต่ตกใจ และทำอะไรกับมันไม่ได้อยู่ดี จึงแยกเป็น:
   *   ผู้บริหาร/แอดมิน  → "อัปเดตล่าสุด HH:MM" สีเทาเงียบๆ · เกิน 60 นาที = ส้ม "ตัวเลขบางส่วนอาจยังไม่อัปเดต"
   *   ผู้ดูแลระบบ      → เหมือนกัน แต่ถ้ามีงานที่มีปัญหา = ชิปส้มกดดูรายละเอียดทีละงานได้
   * ⚠️ เกณฑ์ว่าอะไรคือ "มีปัญหา" ยังเป็นของ lib/api/bootstrap.ts (syncHealth) ทั้งหมด ที่นี่แค่เลือกว่าใครเห็นอะไร
   */
  renderSyncInfo(b: Bootstrap | null): void {
    const chip = document.getElementById('sync-chip');
    if (!chip) return;
    const role = document.getElementById('app')?.getAttribute('data-role') || '';
    const logs = (b && b.lastSync) || [];
    const health = ((b && b.syncHealth) || []) as SyncHealthItem[];

    // งานดึงข้อมูลที่ "สำเร็จ" ล่าสุด = ข้อมูลบนจอสดถึงเวลานี้ (ไม่นับงานตรวจ/ล้างข้อมูล)
    let latest: SyncLogEntry | null = null;
    let latestMs = 0;
    logs.forEach(function (l) {
      const ms = bkkMs(l.ts);
      if (!l.ok || !isDataJob(l.job) || !(ms > 0) || ms <= latestMs) return;
      latest = l;
      latestMs = ms;
    });
    const ageMins = latestMs ? (Date.now() - latestMs) / 60000 : Infinity;

    chip.className = 'sync-chip';
    chip.removeAttribute('title');

    if (role === 'superadmin' && b && health.length) {
      chip.classList.add('is-alert');
      // จอแคบซ่อนคำหน้า (.chip-long) เหลือ "ไม่อัปเดต (N)" — ยังอ่านรู้เรื่อง ไม่ใช่ตัวเลขลอยๆ
      chip.innerHTML = '<button type="button" class="chip chip-btn sync-alert" aria-haspopup="dialog"' +
        ' title="กดดูว่าข้อมูลส่วนไหนไม่อัปเดต">' + icon(ICON_FOR.alert, { size: 14 }) +
        '<span><span class="chip-long">ข้อมูลบางส่วน</span>ไม่อัปเดต (' + health.length + ')</span></button>';
      const btn = chip.querySelector('button');
      const snap = b;
      if (btn) btn.addEventListener('click', function () { openSyncProblems(snap); });
      return;
    }
    if (!latest) {
      chip.innerHTML = '<span class="sync-stamp">รอข้อมูล</span>';
      chip.title = 'ยังไม่มีข้อมูลอัปเดต — ระบบดึงข้อมูลใหม่อัตโนมัติทุก 15 นาที';
      return;
    }
    const ts = (latest as SyncLogEntry).ts;
    const at = stampText(ts);
    if (ageMins > STALE_MINS) {
      chip.classList.add('is-alert');
      chip.innerHTML = '<span class="sync-stamp sync-late">' + icon(ICON_FOR.time, { size: 14 }) +
        '<span><span class="chip-long">ตัวเลขบางส่วนอาจ</span>ยังไม่อัปเดต</span></span>';
      chip.title = 'อัปเดตล่าสุด ' + at + ' (' + relTime(bkkIso(ts)) + ') — ปกติระบบดึงข้อมูลใหม่ทุก 15 นาที';
      return;
    }
    chip.innerHTML = '<span class="sync-stamp">อัปเดตล่าสุด ' + esc(at) + '</span>';
    chip.title = 'ระบบดึงข้อมูลใหม่อัตโนมัติทุก 15 นาที';
  },

  switchView(view: string): void {
    if (!VIEW_META[view]) return;
    // ไม่มีช่อง view นี้ในหน้า = สิทธิ์นี้เปิดไม่ได้ (page.tsx render เฉพาะที่อนุญาต) — เงียบไว้
    if (!document.getElementById('view-' + view)) return;
    hideChartTip(); // กันทูลทิปกราฟ (body singleton) ค้างลอยข้ามหน้าเมื่อสลับ view ด้วยคีย์บอร์ด
    hideInfoTip();  // เช่นเดียวกัน — กันกรอบอธิบายค้างข้ามหน้า
    this.state.view = view;
    document.querySelectorAll('.nav-item').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === view);
    });
    document.querySelectorAll('.view').forEach(function (s) {
      s.classList.toggle('active', s.id === 'view-' + view);
    });
    document.getElementById('topbar-title')!.textContent = VIEW_META[view].title;
    document.getElementById('topbar-sub')!.textContent = VIEW_META[view].sub;
    // เลื่อนกลับขึ้นบนทุกครั้งที่เปลี่ยนหน้า — เดิมค้างที่ตำแหน่งเดิม จากล่างสุดหน้า Sales
    // ไปกด KPI แล้วโผล่กลางหน้าโดยไม่เห็นหัวข้อ (หน้า KPI ถึงกับต้องขึ้นข้อความบอกทางผู้ใช้เอง)
    window.scrollTo({ top: 0, behavior: 'auto' });
    this.loadView(view, false);
  },

  loadView(view: string, force: boolean): void {
    const container = document.getElementById('view-' + view) as HTMLElement | null;
    if (!container) return; // view ที่สิทธิ์นี้เปิดไม่ได้ — ไม่มีช่องให้ render
    const v = Views[view];
    if (v && typeof v.load === 'function') {
      v.load(container, force);
    }
  },
};

// แนบไว้บน globalThis — ไฟล์ view อ้าง App / VIEW_META ตรง ๆ (ผ่าน ambient var ที่ประกาศใน view)
(globalThis as any).App = App;
(globalThis as any).VIEW_META = VIEW_META;
(globalThis as any).Views = Views;

/** entry point — เรียกครั้งเดียวจาก DashboardClient (แทน App.init() ท้าย body ของ Index.html) */
export function initApp(): void {
  App.init();
}
