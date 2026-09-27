/* ============================================================
   app-core — App core + view registry (port จาก JsCommon.html)
   รันบน browser เท่านั้น — client TS ESM
   - ลงทะเบียน Views ทั้ง 5 (import จาก @/lib/views/*)
   - แนบ App / VIEW_META ไว้บน globalThis เพื่อให้ไฟล์ view อ้างถึงได้ (กัน import cycle)
   - serverCall / esc / relTime / toast มาจาก helpers
   ============================================================ */

import {
  serverCall, dataEpoch, failEpoch, esc, relTime, openModal, closeTopModal as closeTopModalLayer, modalCloseBtn, thaiDateShort,
  floaterIsOpen, closeTopFloater,
} from '@/lib/ui/helpers';
import { icon, statusPill, ICON_FOR, type StatusKind } from '@/lib/ui/icons';
import { hideChartTip } from '@/lib/ui/charts';
import { bindInfoTips, hideInfoTip, infoTipOpen } from '@/lib/ui/infotip';
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
  /** วาดใหม่จากข้อมูลที่มีอยู่ ไม่ยิง server (หมุนจอข้ามเส้น 600px — กราฟเลือกขนาดตอนวาด) */
  redraw?: (container: HTMLElement) => void;
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
  if (!isFinite(h.ageMins) || h.ageMins >= 999999) return 'ไม่เคยสำเร็จ';
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

/** งานหลักรอบ 15 นาที = ที่มาของตัวเลขหน้า ยอดขาย / ภาพรวมแชท / ค่าแอด (ชื่อตาม scripts/sync/index.ts runFast) */
const CORE_JOBS = ['orders', 'chat-today', 'conversations', 'engagements-today', 'meta-ads-recent'];

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

/** เวลาอัปเดตในลิ้นชักเมนู (มือถือ) — ป้ายบนหัวเว็บซ่อนบนจอแคบเพื่อเว้นที่ให้ชื่อหน้า
    ทีมที่ใช้มือถือเลยไม่มีที่ดูว่าข้อมูลสดถึงไหน (เดิมอยู่ใต้เมนู) → กลับมาโชว์ในลิ้นชัก CSS ซ่อนเองตั้งแต่ 900px */
function renderSideStamp(at: string, late: boolean): void {
  const el = document.getElementById('sync-side');
  if (!el) return;
  el.classList.toggle('is-late', late);
  el.innerHTML = !at ? ''
    : icon(late ? ICON_FOR.time : 'refresh-cw', { size: 12 }) + '<span>' +
      (late ? 'ตัวเลขบางส่วนอาจยังไม่อัปเดต · ล่าสุด ' : 'ข้อมูลอัปเดตล่าสุด ') + esc(at) + '</span>';
}

/** หน้าต่างรายละเอียด "ข้อมูลส่วนไหนไม่อัปเดต" — เปิดได้เฉพาะผู้ดูแลระบบ */
function openSyncProblems(b: Bootstrap): void {
  const byJob: Record<string, SyncLogEntry> = {};
  (b.lastSync || []).forEach(function (l) { byJob[l.job] = l; });
  const items = ((b.syncHealth || []) as SyncHealthItem[]).map(function (h) {
    // บอก "ครั้งล่าสุดที่ทำงาน" จากแถวล่าสุดใน log — ถ้าแถวนั้นล้ม ก็บอกตรงๆ ว่ารอบล่าสุดไม่สำเร็จ
    // ยกเว้นอาการ "เงียบ" และยอดสดรายนาที (orders-delta ลง log เฉพาะตอนล้ม) — แถวล้มเก่าเมื่อวาน
    // จะขัดกับข้อความในการ์ดเดียวกันที่บอกว่าสำเร็จล่าสุดไม่ถึงชั่วโมง → ใช้อายุจาก syncHealth แทน
    const last = h.kind === 'stale' || h.job === 'orders-delta' ? undefined : byJob[h.job];
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

/* ชื่อหน้า + บรรทัดใต้ชื่อบนหัวเว็บ (ตรวจ UI ข้อ D2) — ภาษาไทยสั้นภาษาเดียว เป็นภาษาพูด
   ห้ามมีศัพท์ช่าง (sync / API / POS / ชื่อระบบหลังบ้าน) — ทีมขายอ่านแล้วไม่ได้อะไร
   ⚠️ ต้องตรงกับ NAV_* ใน app/page.tsx (ตัวนั้นใช้วาดเมนู + ชื่อหน้ารอบแรกจากเซิร์ฟเวอร์) */
const VIEW_META: Record<string, { title: string; sub: string }> = {
  dashboard:  { title: 'ภาพรวมแชท', sub: 'ลูกค้าทักเข้ามาเท่าไหร่ ตอบไปแล้วเท่าไหร่ และแชทที่ยังรอตอบ' },
  sales:      { title: 'ยอดขาย', sub: 'ยอดขายเพจและไลน์ แยกตามยูนิต ช่องทาง และสินค้า' },
  contentads: { title: 'โฆษณา & คอนเทนต์', sub: 'แอดที่กำลังยิงอยู่ คุ้มหรือไม่คุ้ม และควรทำอะไรต่อ' },
  admins:     { title: 'จัดการแอดมิน', sub: 'รายชื่อแอดมิน ใครออนไลน์อยู่ และสิทธิ์ของแต่ละคน' },
  adminperf:  { title: 'อันดับแอดมิน', sub: 'อันดับยอดขายและการตอบแชทของแอดมินแต่ละคน' },
  kpi:        { title: 'KPI ทีมขาย', sub: 'คะแนน KPI ของหัวหน้า รองหัวหน้า และแอดมิน' },
  profit:     { title: 'กำไร & ตีกลับ', sub: 'กำไรจริงและยอดตีกลับ รายยูนิต รายเดือน และรายปี' },
  unitperf:   { title: 'ผลงานรายยูนิต', sub: 'แต่ละยูนิตทำได้เท่าไหร่เทียบเป้า และคาดว่าจะจบเดือนที่เท่าไหร่' },
  report:     { title: 'รายงานการตลาด', sub: 'เป้าเทียบยอดจริง รายสัปดาห์ รายเดือน รายปี และลูกค้าซื้อซ้ำ' },
  umap:       { title: 'จับคู่ยูนิต', sub: 'แอดมินและเพจแต่ละตัวอยู่ยูนิตไหน' },
  me:         { title: 'ผลงานของฉัน', sub: 'ยอดขาย KPI และอันดับของคุณ' },
  users:      { title: 'บัญชีผู้ใช้', sub: 'บัญชีเข้าใช้งานเว็บ และระดับสิทธิ์ของแต่ละคน' },
};

/** ชื่อเว็บต่อท้ายชื่อแท็บเบราว์เซอร์ — ประวัติย้อนกลับ (กดค้างปุ่ม back) จะได้เห็นชื่อหน้าแทนชื่อเว็บซ้ำๆ */
const SITE_NAME = 'PN Infinity';

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
  syncNavBtnState();
}

/** บอกโปรแกรมอ่านหน้าจอว่าเมนูตอนนี้ "เปิด" หรือ "ปิด" — ความหมายต่างกันตามขนาดจอ
    จอแคบ = ลิ้นชักเลื่อนออกมาไหม · จอกว้าง = แถบเมนูกางอยู่ไหม */
function syncNavBtnState(): void {
  const btn = document.getElementById('btn-nav');
  const app = document.getElementById('app');
  if (!btn || !app) return;
  const open = wideScreen() ? !app.classList.contains('nav-hidden') : app.classList.contains('nav-open');
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function setNavOpen(open: boolean): void {
  // แตะแท็บในลิ้นชักแล้วลิ้นชักปิด — ตัวที่ถูกแตะหายไปโดยไม่มี mouseout
  // กรอบอธิบายที่เพิ่งเด้งขึ้นมาจึงค้างกลางจอ ต้องสั่งปิดตรงนี้เอง
  hideInfoTip();
  const app = document.getElementById('app');
  const was = !!(app && app.classList.contains('nav-open'));
  if (app) app.classList.toggle('nav-open', open);
  // ล็อกไม่ให้หน้าเลื่อนตอนเมนูเปิด (ไม่งั้นนิ้วปัดแล้วพื้นหลังไหลตาม)
  // ใช้คลาสไม่ใช่ style ตรงๆ เพื่อให้ CSS ปลดล็อกเองได้ตอนจอกว้าง ≥900
  // (หมุนจอเป็นแนวนอนทั้งที่เมนูเปิดค้าง แล้วหน้าเลื่อนไม่ได้ — style ตรงๆ ไม่มีทางแก้ด้วย CSS)
  document.body.classList.toggle('nav-locked', open);
  syncNavBtnState();
  if (was !== open && !wideScreen()) {
    // โฟกัสตามลิ้นชัก (คีย์บอร์ด/โปรแกรมอ่านหน้าจอ): เปิด = ไปที่เมนูหน้าปัจจุบัน
    // ปิด = คืนให้ปุ่ม ☰ ถ้าโฟกัสค้างอยู่ในลิ้นชักที่กำลังหายไป (ไม่งั้นโฟกัสหลุดไปอยู่ในของที่มองไม่เห็น)
    const sb = document.getElementById('sidebar');
    if (open) {
      const cur = document.querySelector('.nav-item.active') as HTMLElement | null;
      if (cur) cur.focus({ preventScroll: true });
    } else if (sb && document.activeElement && sb.contains(document.activeElement)) {
      const nb = document.getElementById('btn-nav');
      if (nb) nb.focus({ preventScroll: true });
    }
  }
  queueOverlaySync();
}

/* ---------------- badge แจ้งเตือนบนเมนูข้าง (แบบแอปมือถือ) ----------------
   "งบสีแดง" (ตรวจ UI ข้อ B3): ป้ายแดงมีไว้สำหรับเรื่องที่ต้องทำวันนี้จริงๆ และมีไม่กี่เรื่อง
   เดิมป้ายแดงติดเกือบตลอดเวลา (ยูนิตขาดทุน 13 ยูนิต, แอดแจ้งเตือนเป็นร้อย) คนเลยชินจนมองข้ามป้ายทั้งหมด
     แดง (.nav-badge)          = ยูนิตขาดทุน ≥2 วันติด (level urgent ของงาน unit-alerts) และมีไม่เกิน RED_BUDGET ยูนิต
     ส้มอ่อน (.nav-badge.soft) = เรื่องที่ควรเข้าไปดู: ยูนิตเฝ้าระวัง (ขาดทุน 1 วัน), แอดที่ควรหยุด/แก้,
                                 และยูนิตขาดทุนติดกันที่มีเยอะเกินงบแดง (เยอะขนาดนั้นคือสภาพทั่วไป ไม่ใช่ "เรื่องด่วนไม่กี่เรื่อง")
   ตัวเลข = จำนวนจริง (เพดาน 99+) · ป้ายอยู่ตราบที่ยังมีเรื่อง — เปิดหน้านั้นแล้วป้ายต้องไม่หาย
   (พีสั่ง 28 ก.ย.: รอบ 2 เคยทำให้เปิดหน้าแล้วป้ายหาย ผิด — เรื่องยังไม่ถูกแก้ ป้ายต้องยังเตือนอยู่แบบเดิม) */

interface BadgeInfo {
  urgent: number; soft: number;       // จำนวนเรื่องแต่ละระดับ
  urgentTip: string; softTip: string; // คำอธิบาย (ต่อท้าย tooltip + ชื่อปุ่มสำหรับโปรแกรมอ่านหน้าจอ)
}
/** key เก่าของรอบ 2 ที่จำ "จำนวนที่เห็นแล้ว" — เลิกใช้ ลบทิ้งจากเครื่องผู้ใช้ */
const OLD_BADGE_SEEN_KEY = 'pn-nav-seen';
/** ป้ายแดงได้ไม่เกินกี่เรื่อง — เกินนี้เป็นส้มอ่อน (ตัวอย่างในรายงานตรวจ UI: "13" ต้องเป็นส้มอ่อน) */
const RED_BUDGET = 3;
/** ผลล่าสุดจาก apiNavBadges */
let lastBadges: Record<string, BadgeInfo> = {};

/** tooltip ของปุ่มเมนู — ถ้ากรอบอธิบาย (infotip) แปลง title ไปเป็น data-tip แล้ว ต้องแก้ที่ data-tip แทน */
function setBtnTip(btn: HTMLElement, text: string): void {
  if (btn.hasAttribute('data-tip')) btn.setAttribute('data-tip', text);
  else btn.title = text;
}

/** วาด/ลบตัวเลขมุมแท็บ — count 0 = เอาออก · tone soft = ส้มอ่อน (ควรเข้าไปดู) / urgent = แดง (ด่วน) */
function setNavBadge(view: string, count: number, tone?: 'urgent' | 'soft', tip?: string): void {
  const btn = document.querySelector('.nav-item[data-view="' + view + '"]') as HTMLElement | null;
  if (!btn) return;
  const baseTip = btn.getAttribute('data-nav-tip') || '';
  let b = btn.querySelector('.nav-badge') as HTMLElement | null;
  if (!count) {
    if (b) b.remove();
    btn.classList.remove('has-badge');
    btn.removeAttribute('aria-label');
    setBtnTip(btn, baseTip);
    return;
  }
  if (!b) {
    b = document.createElement('span');
    // ตัวเลขลอยๆ ไม่มีความหมายสำหรับโปรแกรมอ่านหน้าจอ — ความหมายเต็มไปอยู่ใน aria-label ของปุ่มแทน
    b.setAttribute('aria-hidden', 'true');
    btn.appendChild(b);
  }
  btn.classList.add('has-badge'); // เว้นที่ด้านขวาไม่ให้เลขทับชื่อแท็บ
  b.className = 'nav-badge' + (tone === 'soft' ? ' soft' : '');
  b.textContent = count > 99 ? '99+' : String(count);
  const label = btn.querySelector('.nav-label');
  const name = ((label && label.textContent) || '').trim();
  if (tip) {
    btn.setAttribute('aria-label', name + ' — ' + tip);
    setBtnTip(btn, baseTip ? baseTip + ' • ' + tip : tip);
  }
}

/** วาดป้ายทุกหน้าจากผลล่าสุด — มีเรื่อง = มีป้าย (รวมหน้าที่กำลังเปิดอยู่) */
function applyNavBadges(): void {
  Object.keys(lastBadges).forEach(function (view) {
    const b = lastBadges[view];
    if (b.urgent > 0) setNavBadge(view, b.urgent, b.urgent <= RED_BUDGET ? 'urgent' : 'soft', b.urgentTip);
    else if (b.soft > 0) setNavBadge(view, b.soft, 'soft', b.softTip);
    else setNavBadge(view, 0);
  });
}

/** ดึงจำนวนเรื่องมาแปะแท็บ ยอดขาย / โฆษณา — เงียบเมื่อพลาด (badge ไม่ใช่ของสำคัญพอให้เด้ง error) */
function refreshNavBadges(): void {
  // role ที่ไม่มีสองแท็บนี้ (ระดับแอดมิน) ไม่ต้องยิง API เลย
  if (!document.querySelector('.nav-item[data-view="sales"], .nav-item[data-view="contentads"]')) return;
  serverCall<any>('apiNavBadges').then(function (b) {
    const s = (b && b.sales) || { urgent: 0, warn: 0 };
    const c = (b && b.contentads) || { urgent: 0 };
    const su = Number(s.urgent) || 0, sw = Number(s.warn) || 0, cu = Number(c.urgent) || 0;
    lastBadges = {
      sales: {
        urgent: su, soft: sw,
        urgentTip: 'ยูนิตขาดทุน 2 วันติดขึ้นไป ' + su + ' ยูนิต',
        softTip: 'ยูนิตที่ต้องเฝ้าดู (ขาดทุน 1 วัน) ' + sw + ' ยูนิต',
      },
      // แอดแจ้งเตือน API เรียกว่า urgent แต่มักมีเป็นสิบ และเป็นเรื่อง "ควรเข้าไปดู" ไม่ใช่เรื่องด่วนของทั้งทีม
      // จึงเป็นป้ายส้มอ่อน — แดงเก็บไว้ให้ยูนิตขาดทุนติดกันอย่างเดียว
      contentads: {
        urgent: 0, soft: cu,
        urgentTip: '',
        softTip: 'แอดที่ควรหยุดหรือแก้ ' + cu + ' รายการ',
      },
    };
    applyNavBadges();
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
  // ช่องที่ 2 เป็น "ก้อนเนื้อหา" (รูปย่อ + ชื่อ + บรรทัดรอง เช่นตารางสื่อรายเพจหน้าโฆษณา) — ตรึงแล้วถูกบีบเหลือ 40% ของจอ
  // ข้อความข้างในโดนตัดกลางคำ และเพราะมันตรึงอยู่ เลื่อนไปดูส่วนที่เหลือก็ไม่ได้ (ผู้ตรวจอิสระวัด: เห็น 111 จาก 390px)
  // → ไม่ตรึง ปล่อยเลื่อนตามปกติ · view สั่งปิดเองได้ด้วย data-pin2="off"
  if (tbl.getAttribute('data-pin2') === 'off') return;
  if (tbl.querySelector(':scope > tbody > tr > td:nth-child(2) :is(img, div, table, ul, ol)')) return;
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
        // การย้ายกล่องเลื่อนเข้ากรอบ = ถอดออกแล้วใส่กลับ → โฟกัสหลุดไป body และตำแหน่งเลื่อนแนวนอนกลับเป็น 0
        // (view วาดใหม่ทุกครั้งที่กางแถว/รีเฟรช — ปุ่มที่เพิ่งกดเสียโฟกัส ตารางที่เลื่อนไว้เด้งกลับซ้ายสุด) → จำไว้แล้วคืนให้
        const ae = document.activeElement as HTMLElement | null;
        const keepFocus = ae && sc.contains(ae) ? ae : null;
        const left = sc.scrollLeft;
        const frame = document.createElement('div');
        frame.className = 'sx-frame';
        host.insertBefore(frame, sc);
        frame.appendChild(sc);
        if (left) sc.scrollLeft = left;
        if (keepFocus) keepFocus.focus({ preventScroll: true });
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
      t.setAttribute('data-sxc', '1');
    });
    // ตารางที่ view ตั้ง data-cards="off" มาเอง (ตารางรายวันหน้ายอดขาย 21 คอลัมน์, ตารางผลงานรายยูนิต)
    // ไม่ผ่าน classifyTable จึงไม่เคยได้ขอบจาง + ลูกศร "ขวามือยังมีอีก" ทั้งที่เป็นตารางที่กว้างที่สุดในเว็บ
    // (data-sxc = ตรวจแล้ว — กันเรียก getComputedStyle ซ้ำทุกเฟรมที่หน้าเปลี่ยน)
    document.querySelectorAll('table.tbl[data-cards="off"]:not([data-sxc])').forEach(function (t) {
      t.setAttribute('data-sxc', '1');
      try { bindScrollHint(t as HTMLTableElement); } catch (e) { /* ไม่มีสัญญาณ ก็ยังใช้ตารางได้ */ }
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

/* ============================================================
   ชิปตัวกรอง: บอกโปรแกรมอ่านหน้าจอว่าตัวไหน "ถูกเลือก" (ตรวจ UI ข้อ F5)
   ทุกหน้าใช้ <button class="filter-btn active"> บอกตัวที่เลือกด้วยสีอย่างเดียว คนตาบอดไม่มีทางรู้
   เติม aria-pressed ตามคลาส .active ให้อัตโนมัติจุดเดียว แทนไล่แก้ทุก view (ซึ่งมีหลายสิบจุดและสลับ .active เอง)
   กติกา: ปุ่มที่ view เขียน aria-pressed มาเองอยู่แล้ว → ไม่ยุ่ง (เราติด data-ap="1" เฉพาะตัวที่เราดูแล)
          ปุ่มที่มี role (เช่น role="tab" ใช้ aria-selected) → ไม่ยุ่ง
   ============================================================ */
let pressedQueued = false;
function syncPressed(): void {
  pressedQueued = false;
  document.querySelectorAll('button.filter-btn').forEach(function (el) {
    if (el.hasAttribute('role')) return;
    const mine = el.getAttribute('data-ap') === '1';
    if (!mine && el.hasAttribute('aria-pressed')) return;
    const on = el.classList.contains('active') ? 'true' : 'false';
    if (el.getAttribute('aria-pressed') !== on) el.setAttribute('aria-pressed', on);
    if (!mine) el.setAttribute('data-ap', '1');
  });
}
function watchPressed(): void {
  // ดูทั้งการวาดใหม่ (childList) และการสลับคลาสเฉยๆ (attributes: class) — ที่เราเขียนคือ aria-pressed/data-ap
  // ซึ่งไม่ใช่ class จึงไม่วนกลับมาเรียกตัวเอง · รวบทุกการเปลี่ยนใน 1 เฟรม
  new MutationObserver(function () {
    if (pressedQueued) return;
    pressedQueued = true;
    requestAnimationFrame(syncPressed);
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  syncPressed();
}

/* ============================================================
   ที่อยู่ของแต่ละหน้า + ปุ่มย้อนกลับ (ตรวจ UI ข้อ F3)
   - ทุกหน้ามี # ของตัวเอง (…/#sales) — รีเฟรชแล้วอยู่หน้าเดิม ส่งลิงก์ให้กันแล้วเปิดหน้านั้นได้เลย
   - เปลี่ยนเมนู = เพิ่มประวัติ 1 ขั้น → ปุ่มย้อนกลับของมือถือพากลับหน้าก่อน (เดิมหลุดออกจากเว็บทันที)
   - มีหน้าต่าง (โมดัล/แผ่นล่าง) หรือลิ้นชักเมนูเปิดอยู่ → ย้อนกลับครั้งแรก "ปิดสิ่งนั้น" ไม่ใช่เปลี่ยนหน้า
     ทำโดยเพิ่มประวัติ 1 ขั้นตอนมีของเปิด (ขั้นนี้ URL เท่าเดิม) ปุ่มย้อนกลับจะกินขั้นนี้ไปแทน
     ถ้าของนั้นถูกปิดด้วยวิธีอื่น (กากบาท/แตะฉากหลัง/Esc) เราถอยขั้นที่เพิ่มไว้ออกเอง ประวัติจะได้ไม่รก
   - สิทธิ์ยังตรวจเหมือนเดิม: หน้าที่สิทธิ์นี้เปิดไม่ได้ไม่มีช่อง view อยู่ในหน้าเลย (page.tsx) → พาไปหน้าแรกของเขา
   ============================================================ */

interface HistState { pnView: string; pnOverlay?: 1 }

/** ประวัติขั้นบนสุดตอนนี้คือขั้น "ของเปิดอยู่" ที่เราเพิ่มเอง */
let overlayEntry = false;
/** จำนวน popstate ที่มาจาก history.back() ของเราเอง (ต้องไม่เอาไปตีความเป็นการกดย้อนกลับของผู้ใช้) */
let ignorePops = 0;
let overlaySyncQueued = false;

function hashView(): string {
  try { return decodeURIComponent(location.hash.replace(/^#\/?/, '')).trim(); } catch (e) { return ''; }
}

function canOpenView(v: string): boolean {
  return !!v && !!VIEW_META[v] && !!document.getElementById('view-' + v);
}

function firstViewOf(): string {
  const fv = (document.getElementById('app')?.getAttribute('data-first-view')) || 'dashboard';
  return canOpenView(fv) ? fv : 'dashboard';
}

function modalOpen(): boolean {
  return !!document.querySelector('#modal-root .modal-overlay');
}

function overlayIsOpen(): boolean {
  if (modalOpen()) return true;
  if (floaterIsOpen()) return true;   // ปฏิทิน / เมนู ⋯ / เมนูดาวน์โหลด (helpers.floaterOpened)
  const app = document.getElementById('app');
  // จอกว้างไม่มีลิ้นชัก (แถบเมนูปักซ้าย) — คลาส nav-open ที่ค้างมาจากตอนหมุนจอไม่นับ
  return !!(app && app.classList.contains('nav-open') && !wideScreen());
}

/** ปิดเฉพาะหน้าต่าง "ชั้นบนสุด" (helpers.closeTopModal) — กล่องยืนยันที่ซ้อนบนฟอร์มปิดก่อน ฟอร์มข้างล่างยังอยู่
    และโค้ดตอนปิดของชั้นนั้นได้ทำงาน (กล่องยืนยันตอบ "ไม่ยืนยัน" ให้คนที่รออยู่ + คืนโฟกัสให้ปุ่มที่กดเปิด)
    ถ้ายังเหลือชั้นล่าง ขั้นประวัติ overlay จะถูกเพิ่มใหม่เอง (syncOverlayHistory) กดย้อนกลับอีกครั้งปิดชั้นถัดไป */
function closeTopModal(): void {
  // หน้าต่างที่ไม่ได้เปิดผ่าน openModal (เขียน #modal-root เอง) ไม่มีชั้น — helpers ล้างทิ้งทั้งหมดให้เอง
  closeTopModalLayer();
}

function closeOverlays(): void {
  // ปิดทีละชั้น: หน้าต่าง → ของลอย → ลิ้นชัก (กดย้อนกลับครั้งเดียวปิดชิ้นเดียว)
  if (modalOpen()) { closeTopModal(); return; }
  if (floaterIsOpen()) { closeTopFloater(); return; }
  const app = document.getElementById('app');
  if (app && app.classList.contains('nav-open')) setNavOpen(false);
}

/** ให้ประวัติตรงกับสภาพจอ: มีของเปิด → ต้องมีขั้น overlay · ไม่มีแล้ว → ถอยขั้นนั้นออก
    รวบไว้ทำใน microtask เดียว (ปิดโมดัลเก่า-เปิดใหม่ทันทีในคลิกเดียว จะได้ไม่เพิ่ม/ถอยประวัติไปมา) */
function queueOverlaySync(): void {
  if (overlaySyncQueued) return;
  overlaySyncQueued = true;
  Promise.resolve().then(syncOverlayHistory);
}

function syncOverlayHistory(): void {
  overlaySyncQueued = false;
  // ล็อกหน้าข้างหลังตอนมีหน้าต่าง/แผ่นเปิด (มือถือ/แท็บเล็ต) — เดิมปัดแล้วหน้าข้างหลังไหล ปิดแผ่นแล้วหลงตำแหน่ง
  // จอ ≥900 ไม่ล็อก: หน้าเว็บจะกระตุกซ้ายขวาเท่าความกว้างแถบเลื่อนทุกครั้งที่เปิดหน้าต่าง
  document.documentElement.classList.toggle('modal-locked', modalOpen() && !wideScreen());
  if (ignorePops > 0) return;   // กำลังรอ history.back() ของเราเองจบ — popstate จะเรียกซ้ำให้
  const open = overlayIsOpen();
  if (open && !overlayEntry) {
    try {
      history.pushState({ pnView: App.state.view, pnOverlay: 1 } as HistState, '', location.href);
      overlayEntry = true;
    } catch (e) {}
  } else if (!open && overlayEntry) {
    overlayEntry = false;
    ignorePops++;
    history.back();
  }
}

/** เขียนประวัติหลังเปลี่ยนหน้า — push = เพิ่มขั้นใหม่ (ย้อนกลับได้), replace = แทนขั้นปัจจุบัน */
function writeHistory(view: string, push: boolean): void {
  const url = '#' + view;
  const st: HistState = { pnView: view };
  try {
    if (overlayEntry) {
      // หน้าเดิม (เช่น แตะเมนูหน้าปัจจุบันในลิ้นชัก) — ปล่อยขั้น overlay ไว้ให้ syncOverlayHistory ถอยออกตอนของปิด
      // ไม่งั้นได้ประวัติหน้าเดียวกันซ้อน 2 ขั้น (กดย้อนกลับแล้วจอไม่เปลี่ยน)
      if (!push) return;
      // เปลี่ยนหน้าจากในหน้าต่าง/ลิ้นชัก (เช่น ปุ่ม "ดูรายละเอียด →" ในโมดัล) — ขั้น overlay กลายเป็นขั้นของหน้าใหม่แทน
      // ห้ามปล่อยให้ syncOverlayHistory ถอยทีหลัง ไม่งั้นมันจะถอยทับหน้าใหม่กลับไปหน้าเดิม
      overlayEntry = false;
      history.replaceState(st, '', url);
    } else if (push) {
      history.pushState(st, '', url);
    } else {
      history.replaceState(st, '', url);
    }
  } catch (e) {}
}

function onPopState(e: PopStateEvent): void {
  if (ignorePops > 0) { ignorePops--; queueOverlaySync(); return; }
  if (overlayEntry) {
    // ผู้ใช้กดย้อนกลับตอนมีของเปิด — ขั้น overlay ถูกกินไปแล้ว เหลือแค่ปิดของ อยู่หน้าเดิม
    overlayEntry = false;
    if (overlayIsOpen()) { closeOverlays(); return; }
  }
  const st = (e.state || null) as HistState | null;
  let v = (st && st.pnView) || hashView();
  if (!v) {
    // # ว่าง (ไม่ใช่ขั้นของเรา) — อยู่หน้าเดิม แค่เขียน # คืน
    writeHistory(App.state.view, false);
    return;
  }
  if (!canOpenView(v)) v = firstViewOf();
  // เดินหน้า (forward) เข้าขั้น overlay เก่า ทั้งที่ไม่มีอะไรเปิด → ถือเป็นขั้นธรรมดาของหน้านั้น
  if ((st && st.pnOverlay) || hashView() !== v) writeHistory(v, false);
  if (v !== App.state.view) App.switchView(v, { history: 'none' });
}

function bindHistory(): void {
  // หน้าเว็บวาดเนื้อหาใหม่ทุกครั้งที่สลับหน้า — ให้เบราว์เซอร์พยายามคืนตำแหน่งเลื่อนเองจะกระโดดมั่ว
  try { history.scrollRestoration = 'manual'; } catch (e) {}
  window.addEventListener('popstate', onPopState);
  // โมดัล/แผ่นล่าง/กล่องยืนยันของ helpers เปิด-ปิดด้วยการเพิ่ม/ลบชั้น .modal-overlay ใน #modal-root
  // ดูแค่ลูกชั้นแรก (เนื้อในหน้าต่างเปลี่ยนเองบ่อย ไม่เกี่ยวกับการเปิด-ปิด)
  const mr = document.getElementById('modal-root');
  if (mr) new MutationObserver(queueOverlaySync).observe(mr, { childList: true });
  // ของลอยนอก #modal-root (ปฏิทิน / เมนู ⋯) แจ้งเปิด-ปิดผ่าน event นี้ (helpers.floaterOpened/Closed)
  document.addEventListener('pn:overlay', queueOverlaySync);
}

/* ============================================================
   ปุ่มกลับขึ้นบน (ตรวจ UI ข้อ F3) — โผล่เมื่อเลื่อนลงเกิน 2 จอ "และเริ่มปัดขึ้น"
   (สัญญาณว่ากำลังหาทางกลับขึ้นไป) ซ่อนตอนปัดลง ไม่ให้บังเนื้อหาระหว่างอ่าน
   ============================================================ */
function bindBackTop(): void {
  const btn = document.getElementById('back-top');
  if (!btn) return;
  const b = btn;
  let lastY = window.scrollY;
  let queued = false;
  let quietUntil = 0;   // ระหว่างเลื่อนขึ้นอัตโนมัติหลังกดปุ่ม — อย่าให้ปุ่มโผล่กลับมาเอง
  function set(on: boolean): void {
    if (b.classList.contains('show') === on) return;
    b.classList.toggle('show', on);
    // ตอนซ่อน: กด Tab ไม่ถึง และโปรแกรมอ่านหน้าจอไม่อ่าน (CSS ซ่อนแบบจางหาย ปุ่มยังอยู่ใน DOM)
    if (on) { b.removeAttribute('aria-hidden'); b.removeAttribute('tabindex'); }
    else { b.setAttribute('aria-hidden', 'true'); b.setAttribute('tabindex', '-1'); }
  }
  window.addEventListener('scroll', function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      const y = window.scrollY;
      const dy = y - lastY;
      if (Math.abs(dy) < 6) return;       // สั่นนิดหน่อยจากนิ้ว ไม่นับเป็นการเปลี่ยนทิศ
      lastY = y;
      if (y < window.innerHeight * 2 || Date.now() < quietUntil) { set(false); return; }
      set(dy < 0);
    });
  }, { passive: true });
  b.addEventListener('click', function () {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    quietUntil = Date.now() + 1500;
    set(false);
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    // โฟกัสย้ายไปที่ชื่อหน้า — ไม่งั้นโฟกัสค้างที่ปุ่มที่เพิ่งหายไป กด Tab ต่อแล้วเด้งกลับลงล่าง
    const h = document.getElementById('topbar-title');
    if (h) h.focus({ preventScroll: true });
  });
}

/* ============================================================
   ปุ่มรีเฟรชหมุนระหว่างโหลด (ตรวจ UI ข้อ F4) — แทนข้อความเด้ง "กำลังโหลดข้อมูลใหม่..." ที่เคยขึ้นทุกครั้ง
   view.load() คืน Promise ก่อนข้อมูลมาถึง (ดึงข้อมูลเบื้องหลัง) จึงรอจาก "โครงร่าง (.skel) หายไปจากหน้า"
   แทน — view ที่ force=true วาดโครงร่างก่อนเสมอ แล้วค่อยแทนด้วยของจริงหรือกล่อง error
   ============================================================ */
const REFRESH_MIN_MS = 500;      // หมุนอย่างน้อยครึ่งวิ — หยุดเร็วกว่านี้ตาไม่ทันเห็นว่ากดติด
const REFRESH_MAX_MS = 30000;    // กันหมุนค้างตลอดไปถ้า view ไม่มีโครงร่าง/พังกลางทาง
const LOADING_SEL = '.skel, .loading';
function refreshWithSpinner(view: string): void {
  const btn = document.getElementById('btn-refresh');
  const container = document.getElementById('view-' + view);
  if (!btn || !container) { App.loadView(view, true); return; }
  if (btn.classList.contains('is-busy')) return;   // กำลังโหลดอยู่ — กดซ้ำไม่ยิงซ้ำ
  const b = btn;
  const ic = b.querySelector('svg.ic');
  const t0 = Date.now();
  b.classList.add('is-busy');
  b.setAttribute('aria-busy', 'true');
  // aria-disabled ไม่ใช่ disabled — ปุ่ม disabled จริงทำให้โฟกัสคีย์บอร์ดหลุดไปอยู่ที่ <body>
  b.setAttribute('aria-disabled', 'true');
  if (ic) ic.classList.add('spin');
  let mo: MutationObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let finished = false;
  function done(): void {
    if (finished) return;
    finished = true;
    if (mo) mo.disconnect();
    if (timer) clearTimeout(timer);
    setTimeout(function () {
      b.classList.remove('is-busy');
      b.removeAttribute('aria-busy');
      b.removeAttribute('aria-disabled');
      if (ic) ic.classList.remove('spin');
    }, Math.max(0, REFRESH_MIN_MS - (Date.now() - t0)));
  }
  App.loadView(view, true);
  // บาง view รออย่างอื่นก่อนวาดโครงร่าง (เช่น โหลดค่าตั้งต้น) — ให้เวลาโครงร่างโผล่ 0.8 วิ
  // ไม่โผล่เลย = view นี้ไม่มีโครงร่าง → หมุนสั้นๆ แล้วจบ
  let sawSkel = !!container.querySelector(LOADING_SEL);
  mo = new MutationObserver(function () {
    if (container.querySelector(LOADING_SEL)) sawSkel = true;
    else if (sawSkel) done();
  });
  mo.observe(container, { childList: true, subtree: true });
  setTimeout(function () { if (!sawSkel) done(); }, 800);
  timer = setTimeout(done, REFRESH_MAX_MS);
}

/* ---------------- App core ---------------- */

const App = {
  state: { view: 'dashboard' as string, bootstrap: null as Bootstrap | null },

  init(): void {
    const self = this;
    document.querySelectorAll('.nav-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        // ลำดับสำคัญ: สลับหน้าก่อน (ขั้นประวัติ "ลิ้นชักเปิด" กลายเป็นขั้นของหน้าใหม่ — ดู writeHistory)
        // แล้วค่อยปิดลิ้นชัก ย้อนกลับครั้งเดียวจึงกลับหน้าเดิมพอดี ไม่ต้องกด 2 ครั้ง
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
    // หมุนจอ/ย่อขยายหน้าต่างข้ามเส้น 900px — ความหมายของปุ่ม ☰ เปลี่ยน (ลิ้นชัก ↔ พับแถบ) ต้องอัปเดตสถานะปุ่ม
    try { window.matchMedia('(min-width: 900px)').addEventListener('change', function () { syncNavBtnState(); queueOverlaySync(); }); } catch (e) {}
    // หมุนมือถือข้ามเส้น 600px: กราฟเลือกขนาดตอนวาดครั้งเดียว (charts.vbWidth) — แนวตั้ง→แนวนอน กราฟสูงเกินจอ
    // แนวนอน→แนวตั้ง ตัวหนังสือเหลือ ~6px อ่านไม่ออก → วาดหน้าที่มีกราฟใหม่ (load แบบ force=false = วาดจากแคชทันที)
    try {
      let rt = 0;
      window.matchMedia('(min-width: 600px)').addEventListener('change', function () {
        clearTimeout(rt);
        rt = window.setTimeout(function () {
          // วาดจากข้อมูลเดิมอย่างเดียว — เดิม loadView ดึงใหม่ทุกครั้งที่หมุน (ยอดขาย ~0.5MB/รอบ กินโควตา Supabase)
          const v = self.state.view;
          const mod = Views[v];
          const box = document.getElementById('view-' + v) as HTMLElement | null;
          if (mod && mod.redraw && box) mod.redraw(box);
        }, 300);
      });
    } catch (e) {}
    syncNavBtnState();
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      // ตัวอื่นใช้ Esc ครั้งนี้ไปแล้ว (กรอบอธิบาย ⓘ / ปฏิทินเลือกวัน) — ไม่ปิดหน้าต่างซ้อนตามไปอีกชั้น
      if (e.defaultPrevented || infoTipOpen()) return;
      // Esc ปิดทีละชั้นจากบนสุด: หน้าต่าง → ลิ้นชักเมนู
      if (modalOpen()) { closeTopModal(); return; }
      setNavOpen(false);
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
      // ปุ่มหมุนระหว่างโหลด แทนข้อความเด้ง "กำลังโหลดข้อมูลใหม่..." ที่ขึ้นทุกครั้งที่กด (ตรวจ UI ข้อ F4)
      refreshWithSpinner(self.state.view);
    });
    const themeBtn = document.getElementById('btn-theme');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
    setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
    bindInfoTips(); // tooltip กรอบอธิบายสูตร + ปุ่ม ⓘ — ผูกครั้งเดียว ครอบทุก view
    watchTables();  // ตารางบนมือถือ → การ์ดต่อแถว (ติดป้ายอัตโนมัติทุกครั้งที่ view วาดใหม่)
    watchPressed(); // ชิปตัวกรอง .filter-btn → aria-pressed ตาม .active
    bindHistory();  // # ต่อหน้า + ปุ่มย้อนกลับ
    bindBackTop();  // ปุ่มกลับขึ้นบน
    // หน้าแรก: # ในลิงก์ (รีเฟรช/ลิงก์ที่ส่งต่อกัน) ถ้าสิทธิ์นี้เปิดได้ — ไม่งั้นหน้าแรกของสิทธิ์
    // (page.tsx บอกมาทาง data-first-view · ระดับแอดมินเริ่มที่ "ผลงานของฉัน")
    // # ของหน้าที่เปิดไม่ได้ → เขียน # ใหม่เป็นหน้าแรกของเขา (replace — ไม่เพิ่มประวัติ)
    const fromHash = hashView();
    const start = canOpenView(fromHash) ? fromHash : firstViewOf();
    this.switchView(start, { history: 'replace', initial: true });
    document.documentElement.removeAttribute('data-boot-view');   // ชื่อหน้าถูกแล้ว — โชว์หัวเว็บ (ดู page.tsx)
    // สถานะความสดบนหัวเว็บ + ตัวเลขบนแท็บ ยอดขาย / โฆษณา — ยิงตามหลังหน้าแรก ~1.2 วิ
    // เดิมยิงพร้อมกัน 3 คำขอตอนเปิดเว็บ สองตัวนี้ (sync_log 2,500 แถว + ค่าแอด 7 วัน) แย่งฐานกับข้อมูลหน้าแรกที่ผู้ใช้กำลังรอ
    setTimeout(function () {
      serverCall<Bootstrap>('apiBootstrap').then(function (b) {
        self.state.bootstrap = b;
        self.renderSyncInfo(b);
      }).catch(function () { self.renderSyncInfo(null); });
      refreshNavBadges();
    }, 1200);
    try { localStorage.removeItem(OLD_BADGE_SEEN_KEY); } catch (e) {}
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
      }).catch(function () {
        // ดึงสถานะไม่ได้ (ฐานข้อมูลล่ม/เกินโควตา) — วาดใหม่จากข้อมูลรอบก่อน ให้อายุถูกตรวจกับเวลาปัจจุบัน
        // ไม่งั้นป้ายเทา "อัปเดตล่าสุด 14:59" จะค้างไปตลอดโดยไม่เคยกลายเป็นส้ม
        self.renderSyncInfo(self.state.bootstrap as Bootstrap | null);
      });
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

    // ข้อมูลบนจอสดถึงเวลาไหน = งานหลักตัวที่ "เก่าสุด" (สำเร็จรอบล่าสุด)
    // เดิมเอางานที่สำเร็จล่าสุดของทุกงาน → งานรายชั่วโมงอย่างชีท KPI ทำให้ป้ายขึ้นเวลาสดตลอด
    // ทั้งที่ออเดอร์/แชทค้างมาหลายชั่วโมง ทีมเลยไม่รู้ว่าตัวเลขเก่า (ผู้ตรวจอิสระจับได้)
    // งานหลักที่รอบล่าสุดล้ม ไม่นับในเวลา (รอบก่อนหน้ายังสดอยู่) — ถ้าล้มติดกันจริง syncHealth จะฟ้องเอง
    let latest: SyncLogEntry | null = null;
    let latestMs = Infinity;
    logs.forEach(function (l) {
      const ms = bkkMs(l.ts);
      if (!l.ok || CORE_JOBS.indexOf(l.job) < 0 || !(ms > 0) || ms >= latestMs) return;
      latest = l;
      latestMs = ms;
    });
    // ยังไม่มีงานหลักใน log เลย (เครื่องใหม่/ย้ายระบบ) — ถอยไปใช้งานดึงข้อมูลที่สำเร็จล่าสุดแบบเดิม
    if (!latest) {
      latestMs = 0;
      logs.forEach(function (l) {
        const ms = bkkMs(l.ts);
        if (!l.ok || !isDataJob(l.job) || !(ms > 0) || ms <= latestMs) return;
        latest = l;
        latestMs = ms;
      });
    }
    const ageMins = latest ? (Date.now() - latestMs) / 60000 : Infinity;
    // งานหลักล้มติดกัน/เงียบเกินรอบ (เกณฑ์จาก bootstrap.ts) = ตัวเลขบางส่วนค้าง แม้งานอื่นจะเพิ่งเสร็จ
    const coreProblem = health.some(function (h) {
      return CORE_JOBS.indexOf(h.job) >= 0 && (h.kind === 'fail' || h.kind === 'stale');
    });

    chip.className = 'sync-chip';
    // ล้างทั้ง title และ data-tip เดิม — infotip ย้าย title ไป data-tip ตอน hover ครั้งแรก
    // ถ้าไม่ล้าง กรอบอธิบายจะค้างข้อความของสถานะก่อนหน้า (เช่น "สดอยู่" ทั้งที่ตอนนี้ค้างแล้ว)
    chip.removeAttribute('title');
    chip.removeAttribute('data-tip');
    hideInfoTip();
    renderSideStamp(latest ? stampText((latest as SyncLogEntry).ts) : '', ageMins > STALE_MINS || coreProblem);

    if (role === 'superadmin' && b && health.length) {
      chip.classList.add('is-alert');
      // จอแคบซ่อนคำหน้า (.chip-long) เหลือ "ไม่อัปเดต (N)" — ยังอ่านรู้เรื่อง ไม่ใช่ตัวเลขลอยๆ
      // จอแคบ (<600) เหลือไอคอน + ตัวเลข — คำเต็มกิน 112px จนชื่อหน้าเหลือ "Dashb…" (ผู้ตรวจอิสระวัดได้)
      // ≥600 "ไม่อัปเดต (N)" · ≥900 "ข้อมูลบางส่วนไม่อัปเดต (N)" · คำเต็มอยู่ใน aria-label เสมอ
      const n = health.length;
      chip.innerHTML = '<button type="button" class="chip chip-btn sync-alert" aria-haspopup="dialog"' +
        ' aria-label="ข้อมูลบางส่วนไม่อัปเดต ' + n + ' รายการ — กดดูรายละเอียด"' +
        ' title="กดดูว่าข้อมูลส่วนไหนไม่อัปเดต">' + icon(ICON_FOR.alert, { size: 14 }) +
        '<span aria-hidden="true"><span class="chip-mid"><span class="chip-long">ข้อมูลบางส่วน</span>ไม่อัปเดต (</span>' +
        n + '<span class="chip-mid">)</span></span></button>';
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
    if (ageMins > STALE_MINS || coreProblem) {
      chip.classList.add('is-alert');
      chip.innerHTML = '<span class="sync-stamp sync-late">' + icon(ICON_FOR.time, { size: 14 }) +
        '<span><span class="chip-long">ตัวเลขบางส่วนอาจ</span>ยังไม่อัปเดต</span></span>';
      chip.title = ageMins > STALE_MINS
        ? 'อัปเดตล่าสุด ' + at + ' (' + relTime(bkkIso(ts)) + ') — ปกติระบบดึงข้อมูลใหม่ทุก 15 นาที'
        : 'ข้อมูลบางส่วนดึงไม่สำเร็จ ระบบกำลังลองใหม่ทุก 15 นาที — ตัวเลขบางช่องอาจยังเป็นของรอบก่อน';
      return;
    }
    chip.innerHTML = '<span class="sync-stamp">อัปเดตล่าสุด ' + esc(at) + '</span>';
    chip.title = 'ระบบดึงข้อมูลใหม่อัตโนมัติทุก 15 นาที';
  },

  /**
   * สลับหน้า — เรียกจากเมนู และจาก view อื่น (App.switchView('sales') ฯลฯ)
   * opts.history: 'push' (ค่าเริ่มต้น — ย้อนกลับได้) | 'replace' (แทนขั้นปัจจุบัน) | 'none' (มาจากปุ่มย้อนกลับเอง)
   */
  switchView(view: string, opts?: { history?: 'push' | 'replace' | 'none'; initial?: boolean }): void {
    // ไม่มีช่อง view นี้ในหน้า = สิทธิ์นี้เปิดไม่ได้ (page.tsx render เฉพาะที่อนุญาต) — เงียบไว้
    if (!canOpenView(view)) return;
    const mode = (opts && opts.history) || 'push';
    const same = view === this.state.view && !(opts && opts.initial);
    hideChartTip(); // กันทูลทิปกราฟ (body singleton) ค้างลอยข้ามหน้าเมื่อสลับ view ด้วยคีย์บอร์ด
    hideInfoTip();  // เช่นเดียวกัน — กันกรอบอธิบายค้างข้ามหน้า
    this.state.view = view;
    document.querySelectorAll('.nav-item').forEach(function (b) {
      const on = b.getAttribute('data-view') === view;
      b.classList.toggle('active', on);
      // โปรแกรมอ่านหน้าจออ่าน "หน้าปัจจุบัน" ที่เมนูนี้ (สีพื้นม่วงบอกได้แค่คนที่มองเห็น)
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    document.querySelectorAll('.view').forEach(function (s) {
      s.classList.toggle('active', s.id === 'view-' + view);
    });
    document.getElementById('topbar-title')!.textContent = VIEW_META[view].title;
    document.getElementById('topbar-sub')!.textContent = VIEW_META[view].sub;
    document.title = VIEW_META[view].title + ' · ' + SITE_NAME;
    // เลื่อนกลับขึ้นบนทุกครั้งที่เปลี่ยนหน้า — เดิมค้างที่ตำแหน่งเดิม จากล่างสุดหน้า Sales
    // ไปกด KPI แล้วโผล่กลางหน้าโดยไม่เห็นหัวข้อ (หน้า KPI ถึงกับต้องขึ้นข้อความบอกทางผู้ใช้เอง)
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (mode !== 'none') writeHistory(view, mode === 'push' && !same);
    if (!same && !(opts && opts.initial) && viewIsFresh_(view)) {
      // เพิ่งโหลดไปไม่ถึง 90 วิ และไม่มีการบันทึกอะไรในระหว่างนั้น → ใช้หน้าที่วาดค้างไว้เลย ไม่ดึงใหม่
      // (เดิมกลับมาหน้าไหนก็วาดใหม่ 2 รอบ + ยิง API ทั้งก้อน แม้เพิ่งเปิดเมื่อครู่ — แย่งฐานกับหน้าที่กำลังจะเปิด)
      // จอเปลี่ยนฝั่ง 600px ระหว่างนั้น (หมุนมือถือ) → วาดใหม่จากข้อมูลเดิม เหมือนตอนหมุนจอในหน้านั้นเอง
      if (loadedWide_[view] !== wideNow_()) {
        const mod = Views[view];
        const box = document.getElementById('view-' + view) as HTMLElement | null;
        if (mod && mod.redraw && box) { mod.redraw(box); loadedWide_[view] = wideNow_(); }
        else this.loadView(view, false);
      }
      return;
    }
    this.loadView(view, false);
  },

  loadView(view: string, force: boolean): void {
    const container = document.getElementById('view-' + view) as HTMLElement | null;
    if (!container) return; // view ที่สิทธิ์นี้เปิดไม่ได้ — ไม่มีช่องให้ render
    const v = Views[view];
    if (v && typeof v.load === 'function') {
      v.load(container, force);
      loadedAt_[view] = Date.now();
      loadedEpoch_[view] = dataEpoch();
      loadedFail_[view] = failEpoch();
      loadedWide_[view] = wideNow_();
    }
  },
};

// แนบไว้บน globalThis — ไฟล์ view อ้าง App / VIEW_META ตรง ๆ (ผ่าน ambient var ที่ประกาศใน view)
(globalThis as any).App = App;
(globalThis as any).VIEW_META = VIEW_META;
(globalThis as any).Views = Views;

/* ---- กลับมาหน้าเดิมภายใน 90 วิ ไม่ต้องดึงใหม่ (ดู switchView) ----
 * รีเฟรชอัตโนมัติ 5 นาที / ปุ่มรีเฟรช / เปิดหน้าครั้งแรก ยังดึงใหม่เสมอเหมือนเดิม */
const FRESH_MS = 90 * 1000;
const loadedAt_: Record<string, number> = {};
const loadedEpoch_: Record<string, number> = {};
const loadedFail_: Record<string, number> = {};
/** หน้าที่มีทาง "ตั้งใจไม่วาดผลใหม่" (มีหน้าต่าง/เมนูเปิด กำลังพิมพ์ กำลังบันทึก) หรือมีรอบอัปเดตของตัวเอง
 *  → ผ่าน load ทุกครั้งแบบเดิม (ไม่รู้ว่าผลรอบล่าสุดวาดจริงไหม) */
const NO_FRESH_VIEWS: Record<string, 1> = { adminperf: 1, admins: 1, umap: 1, users: 1, me: 1 };
const loadedWide_: Record<string, boolean> = {};
function wideNow_(): boolean {
  try { return window.matchMedia('(min-width: 600px)').matches; } catch (e) { return true; }
}
function viewIsFresh_(view: string): boolean {
  if (NO_FRESH_VIEWS[view]) return false;
  const t = loadedAt_[view];
  if (!t || Date.now() - t >= FRESH_MS) return false;
  if (loadedEpoch_[view] !== dataEpoch()) return false;     // มีการบันทึก/แก้ข้อมูลหลังโหลด → ดึงใหม่
  if (loadedFail_[view] !== failEpoch()) return false;      // มีคำขอพลาดหลังโหลด (อาจเป็นของหน้านี้) → ดึงใหม่
  const box = document.getElementById('view-' + view);
  if (!box || !box.firstElementChild) return false;
  // ยังโหลดไม่เสร็จ หรือโหลดพลาด → ทำแบบเดิม (ส่วนที่โหลดแยกทีหลังโดยตั้งใจ เช่นซื้อซ้ำ/ค่าคอม ไม่นับ)
  const busy = Array.from(box.querySelectorAll('.skel, .skel-line, .loading, .state-error'))
    .filter(function (x) { return !x.closest('#rp-market, #rk-com'); });
  return busy.length === 0;
}

/** entry point — เรียกครั้งเดียวจาก DashboardClient (แทน App.init() ท้าย body ของ Index.html) */
export function initApp(): void {
  App.init();
}
