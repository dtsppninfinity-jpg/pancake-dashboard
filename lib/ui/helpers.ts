// lib/ui/helpers.ts — helpers ฝั่ง client (port จาก JsCommon.html)
// ฟังก์ชัน pure รันบน browser เท่านั้น — ห้าม import อะไรจากฝั่ง server
// HTML string / ชื่อ class / ข้อความไทย / esc() คงเดิมทุกตัวอักษรจากเวอร์ชัน GAS

/* ---------------- server call ---------------- */

/** แทน google.script.run เดิม → เรียก route /api/<fn> ด้วย fetch POST */
export async function serverCall<T = any>(fn: string, params?: unknown): Promise<T> {
  const r = await fetch('/api/' + fn, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params || {}),
  });
  if (r.status === 401) {
    // session หมดอายุ / ยังไม่ล็อกอิน → เด้งไปหน้า login
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new Error('unauthorized');
  }
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

/* ---------------- formatting helpers ---------------- */

export function esc(s: unknown): string {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return '-';
  return Number(n).toLocaleString('th-TH');
}

export function THB(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return '-';
  return '฿' + Math.round(Number(n)).toLocaleString('th-TH');
}

export function kFmt(n: number | null | undefined): string {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000000) return (v / 1000000).toFixed(1) + 'M';
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + 'k';
  return String(Math.round(v));
}

export function pctFmt(n: number | null | undefined): string {
  return (n === null || n === undefined || isNaN(n)) ? '-' : (Math.round(n * 10) / 10) + '%';
}

/** iso 'yyyy-MM-ddTHH:mm:ss' → 'x นาทีที่แล้ว' */
export function relTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(String(iso).replace(' ', 'T'));
  if (isNaN(d.getTime())) return '-';
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (mins < 1) return 'เมื่อกี้';
  if (mins < 60) return mins + ' นาทีที่แล้ว';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + ' ชม.ที่แล้ว';
  return Math.floor(hrs / 24) + ' วันที่แล้ว';
}

export function platformIcon(pf: string | null | undefined): string {
  const p = String(pf || '').toLowerCase();
  if (p === 'line') return '🟢';
  if (p === 'instagram') return '📸';
  if (p === 'tiktok') return '🎵';
  if (p === 'shopee') return '🛒';
  return '📘';
}

const AVATAR_COLORS = ['#6c5ce7', '#0984e3', '#00b894', '#e17055', '#d63031', '#e84393', '#fdcb6e', '#00cec9'];
export function avatarColor(id: string | number | null | undefined): string {
  let h = 0;
  const s = String(id || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function initials(name: string | null | undefined): string {
  const s = String(name || '?').trim().replace(/^แอดมิน/, '');
  return s.slice(0, 2) || '?';
}

export function avatarHtml(
  id: string | number | null | undefined,
  name: string | null | undefined,
  online?: boolean,
  size?: string,
): string {
  const cls = 'avatar' + (size === 'sm' ? ' sm' : '');
  const dot = (online === undefined) ? '' :
    '<span class="status-dot ' + (online ? 'online' : 'offline') + '"></span>';
  return '<div class="' + cls + '" style="background:' + avatarColor(id) + '">' +
    esc(initials(name)) + dot + '</div>';
}

/* ---------------- UI helpers ---------------- */

export function toast(msg: string): void {
  const box = document.getElementById('toast-container')!;
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => { t.remove(); }, 3200);
}

export function openModal(html: string): void {
  const root = document.getElementById('modal-root')!;
  root.innerHTML = '<div class="modal-overlay"><div class="modal">' + html + '</div></div>';
  const overlay = root.querySelector('.modal-overlay') as HTMLElement;
  overlay.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  // ต้อง querySelectorAll — modal ส่วนใหญ่มีปุ่มปิด 2 ตัว (✕ มุมบน + "ยกเลิก" ท้ายฟอร์ม)
  // ถ้า bind แค่ตัวแรก ปุ่ม "ยกเลิก" จะกดไม่ติด (เคยเป็นบั๊กจริงบนหน้าจัดการผู้ใช้)
  root.querySelectorAll('.modal-close').forEach((x) => x.addEventListener('click', closeModal));
  bindSheetDrag_(overlay);
}

/* ---------- ลากแผ่นลงเพื่อปิด (bottom sheet) ----------
   ขีดจับด้านบนต้องลากได้จริง ไม่ใช่ขีดตกแต่ง — ของที่หน้าตาเหมือนจับได้แต่จับไม่ได้
   แย่กว่าไม่มีขีดเลย เพราะคนลองแล้วคิดว่าเว็บค้าง
   จับที่ .modal-head เท่านั้น ไม่ใช่ทั้งแผ่น ไม่งั้นจะไปแย่งการเลื่อนเนื้อหาข้างใน
   ⚠️ ผูกที่ .modal-overlay แล้วค่อยเช็คว่าโดน .modal-head ไหม (event delegation)
      ไม่ผูกที่ .modal-head ตรงๆ เพราะบางโมดัลเขียนทับเนื้อหาตัวเองทีหลัง (เช่น กำไรรายวัน
      ที่โหลดเสร็จแล้วแทน innerHTML ทั้งก้อน) หัวแผ่นอันเดิมจะหายไปพร้อม listener */

const SHEET_CLOSE_RATIO = 0.25;   // ลากลงเกิน 1 ใน 4 ของความสูงแผ่น = ปิด
const SHEET_FLING_SPEED = 0.6;    // px ต่อ ms — สะบัดลงเร็วๆ สั้นๆ ก็ต้องปิดได้
const SHEET_ANIM_MS = 180;

function bindSheetDrag_(overlay: HTMLElement): void {
  let id = -1, y0 = 0, t0 = 0, dy = 0;
  let sheet: HTMLElement | null = null;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  overlay.addEventListener('pointerdown', function (e) {
    // จอ ≥600 โมดัลเป็นกล่องลอยกลางจอ ไม่ใช่แผ่น จึงไม่มีอะไรให้ลาก
    if (window.matchMedia('(min-width: 600px)').matches) return;
    const tgt = e.target as Element | null;
    if (!tgt || !tgt.closest || !tgt.closest('.modal-head')) return;
    if (tgt.closest('button, a, input, select')) return;
    sheet = overlay.querySelector('.modal');
    if (!sheet) return;
    id = e.pointerId; y0 = e.clientY; t0 = e.timeStamp; dy = 0;
    overlay.setPointerCapture(id);
    sheet.style.transition = 'none';
  });

  // กันเบราว์เซอร์เอาท่าทางนี้ไปทำ scroll — ต้องเป็น listener แบบ non-passive ถึงจะ preventDefault ได้
  // (ใช้แทน CSS touch-action ซึ่งแก้ปัญหาเดียวกันได้แต่ไปกลืนการแตะครั้งถัดไป — ดูคอมเมนต์ที่ .modal-head)
  overlay.addEventListener('touchmove', function (e) {
    if (id !== -1 && e.cancelable) e.preventDefault();
  }, { passive: false });

  overlay.addEventListener('pointermove', function (e) {
    if (e.pointerId !== id || !sheet) return;
    dy = Math.max(0, e.clientY - y0);   // ลากขึ้นไม่ต้องทำอะไร แผ่นชิดขอบล่างอยู่แล้ว
    sheet.style.transform = 'translateY(' + dy + 'px)';
    // ฉากหลังจางลงตามระยะที่ลาก ให้รู้สึกว่ากำลัง "ปล่อยออก" ไม่ใช่แค่เลื่อนกล่อง
    overlay.style.background = 'rgba(5,8,18,' + (0.7 * Math.max(0, 1 - dy / 400)).toFixed(3) + ')';
  });

  function end(e: PointerEvent): void {
    if (e.pointerId !== id || !sheet) return;
    id = -1;
    const speed = dy / Math.max(1, e.timeStamp - t0);
    if (dy > sheet.offsetHeight * SHEET_CLOSE_RATIO || speed > SHEET_FLING_SPEED) {
      if (reduce) { closeModal(); return; }
      // ⚠️ ระหว่างแอนิเมชันปิด ฉากหลังยังคาอยู่บนจอและยังรับการแตะอยู่ ทั้งที่มองไม่เห็นแล้ว
      //    แตะปุ่มทันทีหลังปัด = โดนฉากหลังกินไปเฉยๆ (วัดได้: elementFromPoint คืน .modal-overlay)
      //    ปิดการรับสัมผัสทันทีที่ตัดสินใจปิด นิ้วจะทะลุไปโดนของจริงข้างล่างได้เลย
      overlay.style.pointerEvents = 'none';
      sheet.style.transition = 'transform ' + SHEET_ANIM_MS + 'ms ease-in';
      sheet.style.transform = 'translateY(100%)';
      overlay.style.background = 'rgba(5,8,18,0)';
      setTimeout(closeModal, SHEET_ANIM_MS - 10);
    } else {
      sheet.style.transition = reduce ? 'none' : 'transform ' + SHEET_ANIM_MS + 'ms ease-out';
      sheet.style.transform = '';
      overlay.style.background = '';
    }
  }
  overlay.addEventListener('pointerup', end);
  // pointercancel = เบราว์เซอร์ยึดท่าทางไปทำอย่างอื่น (เช่น เลื่อนเนื้อหา) ไม่ใช่เจตนาปิดของผู้ใช้
  // จึงเด้งกลับเสมอ ไม่ปิด — ปิดโดยที่ผู้ใช้ไม่ได้ตั้งใจแย่กว่าไม่ปิด
  overlay.addEventListener('pointercancel', function (e) {
    if (e.pointerId !== id || !sheet) return;
    id = -1;
    sheet.style.transition = reduce ? 'none' : 'transform ' + SHEET_ANIM_MS + 'ms ease-out';
    sheet.style.transform = '';
    overlay.style.background = '';
  });
}

/** โมดัลที่โหลดเนื้อหาทีหลังแล้วเขียนทับตัวเอง เรียกอันนี้แทนการผูกปุ่มปิดเอง
    (ปุ่มปิดของ openModal ผูกไว้กับ element เดิมซึ่งหายไปพร้อม innerHTML) */
export function rebindModalClose(): void {
  const root = document.getElementById('modal-root');
  if (!root) return;
  root.querySelectorAll('.modal-close').forEach((x) => x.addEventListener('click', closeModal));
}

export function closeModal(): void {
  document.getElementById('modal-root')!.innerHTML = '';
}

export function showLoading(el: HTMLElement): void {
  el.innerHTML = '<div class="loading"><div class="spinner"></div>กำลังโหลดข้อมูล...</div>';
}

export function showError(el: HTMLElement, msg: string, retryFn?: () => void): void {
  el.innerHTML = '<div class="error-box">❌ ' + esc(msg) +
    '<div style="margin-top:10px"><button class="btn" id="err-retry">ลองใหม่</button></div></div>';
  const b = el.querySelector('#err-retry');
  if (b && retryFn) b.addEventListener('click', retryFn);
}

/** สร้าง CSV แล้วดาวน์โหลด (BOM สำหรับภาษาไทยใน Excel) */
export function downloadCSV(rows: unknown[][], filename?: string): void {
  const csv = rows.map((r) => {
    return r.map((c) => {
      let s = String(c === undefined || c === null ? '' : c);
      // กัน formula injection: ค่าที่ขึ้นต้นด้วย = + - @ ให้เติม ' นำหน้า
      // ยกเว้นตัวเลขจริง (เช่น -12.5) กับ '-' ที่ใช้แทนค่าว่าง เพื่อให้ Excel อ่านเป็นตัวเลขได้
      const isNumeric = /^-?\d+(\.\d+)?$/.test(s);
      if (!isNumeric && s !== '-' && /^[=+\-@]/.test(s)) s = "'" + s;
      return (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0 || s.indexOf('\r') >= 0)
        ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',');
  }).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (filename || 'export') + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('📄 Export CSV แล้ว');
}

/**
 * สร้างไฟล์ .xls (ตาราง HTML ที่ Excel เปิดได้ตรงๆ — วิธีเดียวกับ mockup)
 * ข้อดีกว่า CSV: ไทยไม่เพี้ยนแน่นอน + ตัวเลขจัด format ได้ | escape ทุก cell กัน HTML injection
 */
export function downloadXLS(rows: unknown[][], filename?: string, sheetName?: string): void {
  const body = rows.map((r, ri) => {
    const tag = ri === 0 ? 'th' : 'td';
    return '<tr>' + r.map((c) => {
      const s = String(c === undefined || c === null ? '' : c);
      // เซลล์เป็น "ตัวเลข" ต่อเมื่อ caller ส่ง number จริงมาเท่านั้น — string ทุกตัวบังคับ text
      // (กัน Excel ทำ id ยาวๆ เพี้ยนเป็น 1.2E+17: FB ad_id 16-18 หลักเกิน precision 15 หลักของ Excel)
      const isNumeric = typeof c === 'number' && isFinite(c);
      const style = isNumeric ? '' : ' style="mso-number-format:\'\\@\'"';
      return '<' + tag + style + '>' + esc(s) + '</' + tag + '>';
    }).join('') + '</tr>';
  }).join('');
  const html = '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8">' +
    '<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>' +
    '<x:Name>' + esc(sheetName || 'Report') + '</x:Name>' +
    '<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>' +
    '</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->' +
    '</head><body><table border="1">' + body + '</table></body></html>';
  const blob = new Blob(['﻿' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (filename || 'export') + '.xls';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('📊 Export Excel แล้ว');
}

/** สีประจำแท็ก/ชื่อ — hash ชื่อ → HSL คงที่ (ชื่อเดิมได้สีเดิมเสมอ ทุกหน้า) */
export function tagColor(name: unknown): string {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return 'hsl(' + (h % 360) + ', 62%, 52%)';
}

/* ---------------- range controls (ใช้ร่วมกันหลายหน้า) ---------------- */

export interface RangeState {
  preset: string;
  from?: string;
  to?: string;
}
/* ---------------- ปฏิทินเลือกช่วงวัน (date range picker) ----------------
 * ใช้แทนช่อง <input type="date"> 2 ช่องของโหมด "กำหนดเอง" — ทีมต้องเลือกช่วงวันบ่อย
 * ช่องเดิมกดยาก (ต้องกรอก 2 ช่องแยกกันแล้วกดแสดง) และมองไม่เห็นว่าช่วงที่เลือกกินกี่วัน
 *
 * ⚠️ วันที่ในนี้เป็น "วันตามปฏิทิน" (civil date) เก็บเป็นสตริง 'YYYY-MM-DD' ล้วน
 *    ห้ามแปลงเป็น Date object แล้วอ่านกลับ — new Date('2026-08-27') ตีความเป็น UTC
 *    พอเครื่องอยู่ไทย (+7) จะกลายเป็นวันก่อนหน้า = คลาดไป 1 วันทั้งระบบ
 *    เทียบมาก/น้อยใช้เทียบสตริงตรงๆ ได้เลย เพราะรูปแบบ YYYY-MM-DD เรียงตามตัวอักษร = เรียงตามเวลา
 */

const TH_MON = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const TH_MON_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const TH_DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

const pad2_ = (n: number) => (n < 10 ? '0' + n : String(n));
/** ปี-เดือน-วัน → 'YYYY-MM-DD' (m เริ่มที่ 0 เหมือน Date) */
const ymd_ = (y: number, m: number, d: number) => y + '-' + pad2_(m + 1) + '-' + pad2_(d);
/** 'YYYY-MM-DD' → [ปี, เดือน(0-11), วัน] — คืน null ถ้ารูปแบบไม่ถูก */
function parseYmd_(s: unknown): [number, number, number] | null {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
}
/** วันนี้ตามนาฬิกาเครื่องผู้ใช้ (ไม่ใช่ UTC) */
function todayYmd_(): string {
  const d = new Date();
  return ymd_(d.getFullYear(), d.getMonth(), d.getDate());
}
const daysInMonth_ = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
/** วันในสัปดาห์ของวันที่ 1 ของเดือน (0=อาทิตย์) — สร้าง Date จากตัวเลข ไม่ได้ parse สตริง จึงไม่โดนกับดัก UTC */
const firstDow_ = (y: number, m: number) => new Date(y, m, 1).getDay();
/** เลื่อนเดือน คืน [ปี, เดือน] */
function addMonth_(y: number, m: number, delta: number): [number, number] {
  const t = y * 12 + m + delta;
  return [Math.floor(t / 12), ((t % 12) + 12) % 12];
}
/** บวกวัน (ใช้ Date เป็นตัวคำนวณล้วน ไม่แตะ timezone เพราะสร้างจากตัวเลขและอ่านกลับเป็นตัวเลข) */
function addDays_(s: string, delta: number): string {
  const p = parseYmd_(s);
  if (!p) return s;
  const d = new Date(p[0], p[1], p[2] + delta);
  return ymd_(d.getFullYear(), d.getMonth(), d.getDate());
}
/** '2026-08-27' → '27 ส.ค. 69' (พ.ศ. 2 หลักท้าย — ทีมอ่านแบบนี้ในชีททุกใบ) */
export function thaiDateShort(s: unknown): string {
  const p = parseYmd_(s);
  if (!p) return '—';
  return p[2] + ' ' + TH_MON_SHORT[p[1]] + ' ' + String((p[0] + 543) % 100);
}
/** จำนวนวันในช่วง (นับหัวท้าย) */
function spanDays_(from: string, to: string): number {
  const a = parseYmd_(from), b = parseYmd_(to);
  if (!a || !b) return 0;
  return Math.round((new Date(b[0], b[1], b[2]).getTime() - new Date(a[0], a[1], a[2]).getTime()) / 86400000) + 1;
}

/* ---- สถานะของปฏิทินที่กำลังเปิดอยู่ (มีได้ทีละตัว) ---- */
interface DpCtx {
  state: RangeState;
  idPrefix: string;
  onChange: () => void;
  /** เดือนซ้ายที่กำลังแสดง */
  vy: number; vm: number;
  /** ค่าที่กำลังเลือกอยู่ในปฏิทิน (ยังไม่ยืนยัน) */
  from: string; to: string;
  /** true = คลิกถัดไปคือ "วันจบ" */
  picking: boolean;
  /** วันที่เมาส์ชี้อยู่ ใช้ระบายช่วงล่วงหน้า */
  hover: string;
  /** วันที่คีย์บอร์ดโฟกัสอยู่ */
  focus: string;
}
let dpCtx_: DpCtx | null = null;

/** ปฏิทิน 1 เดือน */
/** ข้อความสรุปหัวปฏิทิน — ระหว่างลากเมาส์บอกช่วงที่กำลังจะได้ให้เห็นก่อนกด */
function dpSummary_(c: DpCtx): string {
  if (c.picking) {
    const hi = c.hover && c.hover > c.from ? c.hover : '';
    return hi
      ? thaiDateShort(c.from) + ' – ' + thaiDateShort(hi) + ' · ' + spanDays_(c.from, hi) + ' วัน'
      : 'เลือกวันสิ้นสุด';
  }
  return c.from && c.to
    ? thaiDateShort(c.from) + ' – ' + thaiDateShort(c.to) + ' · ' + spanDays_(c.from, c.to) + ' วัน'
    : 'เลือกวันเริ่มต้น';
}

function dpMonthHtml_(c: DpCtx, y: number, m: number): string {
  const today = todayYmd_();
  let cells = '';
  const blanks = firstDow_(y, m);
  for (let i = 0; i < blanks; i++) cells += '<div class="dp-cell dp-blank" role="gridcell"></div>';
  const n = daysInMonth_(y, m);
  for (let d = 1; d <= n; d++) {
    const sday = ymd_(y, m, d);
    // ใช้ตัวคำนวณคลาสตัวเดียวกับ dpTint_ — ไม่งั้นสีตอนวาดกับตอนลากเมาส์จะเพี้ยนคนละแบบ
    const cls = dpDayCls_(c, sday, today);
    cells += '<div class="dp-cell" role="gridcell" aria-selected="' + (cls.indexOf('dp-sel') >= 0 ? 'true' : 'false') + '">' +
      '<button type="button" class="' + cls + '" data-d="' + sday + '"' +
      (sday === c.focus ? ' data-focus="1"' : '') +
      ' tabindex="' + (sday === c.focus ? '0' : '-1') + '"' +
      ' aria-label="' + d + ' ' + TH_MON[m] + ' ' + (y + 543) + '">' + d + '</button></div>';
  }
  return '<div class="dp-month">' +
    '<div class="dp-mon-head">' + TH_MON[m] + ' ' + (y + 543) + '</div>' +
    '<div class="dp-dow">' + TH_DOW.map((w) => '<span>' + w + '</span>').join('') + '</div>' +
    '<div class="dp-grid" role="grid">' + cells + '</div>' +
  '</div>';
}

/** ทั้งป๊อปโอเวอร์ */
function dpHtml_(c: DpCtx): string {
  const [ny, nm] = addMonth_(c.vy, c.vm, 1);
  const summary = dpSummary_(c);
  const quick = [
    ['7', '7 วันล่าสุด'], ['14', '14 วันล่าสุด'], ['30', '30 วันล่าสุด'], ['90', '90 วันล่าสุด'],
  ].map(([n, label]) =>
    '<button type="button" class="dp-quick" data-quick="' + n + '">' + label + '</button>').join('');
  return '<div class="dp-pop" role="dialog" aria-modal="false" aria-label="เลือกช่วงวันที่">' +
    '<div class="dp-nav">' +
      '<button type="button" class="dp-arrow" data-mv="-1" aria-label="เดือนก่อนหน้า">‹</button>' +
      '<div class="dp-sum">' + summary + '</div>' +
      '<button type="button" class="dp-arrow" data-mv="1" aria-label="เดือนถัดไป">›</button>' +
    '</div>' +
    '<div class="dp-months">' + dpMonthHtml_(c, c.vy, c.vm) + dpMonthHtml_(c, ny, nm) + '</div>' +
    '<div class="dp-quicks">' + quick + '</div>' +
    '<div class="dp-foot">' +
      '<button type="button" class="btn" data-dp="cancel">ยกเลิก</button>' +
      '<button type="button" class="btn primary" data-dp="apply"' +
        (c.from && c.to && !c.picking ? '' : ' disabled') + '>แสดง</button>' +
    '</div>' +
  '</div>';
}

/** วาดใหม่ทั้งป๊อปโอเวอร์ แล้วผูก event ใหม่ (วิธีเดียวกับวิวอื่นในโปรเจกต์) */
/**
 * ดันกล่องให้อยู่ในจอเสมอ — กล่องเกาะซ้ายของปุ่ม พอปุ่มอยู่ค่อนไปทางขวาของจอ
 * ปฏิทิน 2 เดือน (~500px) จะล้นขอบขวาจนเดือนที่สองโดนตัด (เจอจริงบนจอ 1280)
 * วัดแล้วเลื่อนเอง ไม่ผูกกับ right:0 เพราะบางหน้าปุ่มอยู่ชิดซ้าย จะกลายเป็นล้นซ้ายแทน
 */
function dpPlace_(host: HTMLElement): void {
  host.style.left = '0px';
  host.style.top = '';      // ล้างค่าที่เคยพลิกไว้รอบก่อน ไม่งั้นค้างกางขึ้นบนตลอด
  host.style.bottom = '';
  const pop = host.firstElementChild as HTMLElement | null;
  if (!pop) return;
  const M = 8;   // เว้นขอบจอ
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  // แนวนอน
  const r = pop.getBoundingClientRect();
  let shift = 0;
  if (r.right > vw - M) shift -= (r.right - (vw - M));
  if (r.left + shift < M) shift += M - (r.left + shift);
  if (shift) host.style.left = Math.round(shift) + 'px';

  // แนวตั้ง — ต้องจำกัดสูงตาม "ที่ว่างจริงบนจอ" ไม่ใช่ %ของ viewport เฉยๆ
  // ไม่งั้นบนมือถือกล่องยาวเลยขอบล่าง แถวปุ่ม "แสดง" หลุดออกนอกจอจนกดไม่ได้เลย
  const MIN_H = 260;
  const belowTop = pop.getBoundingClientRect().top;
  const spaceBelow = vh - belowTop - M;
  if (spaceBelow >= MIN_H) {
    pop.style.maxHeight = Math.round(spaceBelow) + 'px';
    return;
  }
  // ที่ว่างข้างล่างไม่พอ → พลิกไปกางขึ้นข้างบนปุ่มแทน (ถ้าข้างบนกว้างกว่า)
  const wrapTop = (host.parentElement || host).getBoundingClientRect().top;
  const spaceAbove = wrapTop - M;
  if (spaceAbove > spaceBelow) {
    host.style.top = 'auto';
    host.style.bottom = 'calc(100% + var(--sp-2))';
    pop.style.maxHeight = Math.round(spaceAbove) + 'px';
  } else {
    pop.style.maxHeight = Math.round(Math.max(MIN_H, spaceBelow)) + 'px';
  }
}

/** คลาสของช่องวันหนึ่งช่อง (ใช้ทั้งตอนวาดครั้งแรกและตอนระบายตามเมาส์) */
function dpDayCls_(c: DpCtx, sday: string, today: string): string {
  const lo = c.from;
  // ระหว่างเลือกวันจบ ให้ระบายตามวันที่เมาส์ชี้ เพื่อให้เห็นช่วงก่อนกดจริง
  const hi = c.picking ? (c.hover && c.hover > c.from ? c.hover : c.from) : c.to;
  const isStart = !!lo && sday === lo;
  const isEnd = !!hi && sday === hi && hi !== lo;
  const cls = ['dp-day'];
  if (isStart || isEnd) cls.push('dp-sel');
  if (isStart && hi && hi !== lo) cls.push('dp-start');
  if (isEnd) cls.push('dp-end');
  if (!!lo && !!hi && sday > lo && sday < hi) cls.push('dp-in');
  if (sday === today) cls.push('dp-today');
  if (sday > today) cls.push('dp-future');
  return cls.join(' ');
}

/**
 * ระบายช่วงใหม่ "โดยไม่วาด HTML ใหม่" — สลับแค่คลาสของปุ่มที่มีอยู่
 *
 * ⚠️ ห้ามวาดใหม่ตอนเมาส์ลากผ่าน: การเขียน innerHTML ทับจะสร้างปุ่มวันชุดใหม่ทั้งหมด
 * ปุ่มที่ผู้ใช้กำลังกดค้างอยู่จะถูกแทนที่ระหว่าง mousedown กับ mouseup
 * เบราว์เซอร์เลยไม่นับเป็น click → กดเลือกวันจบไม่ติดเลยแม้แต่ครั้งเดียว
 * (เทสที่สั่ง .click() ด้วยโค้ดจับบั๊กนี้ไม่ได้ เพราะไม่ได้ผ่านลำดับเมาส์จริง)
 */
function dpTint_(host: HTMLElement): void {
  const c = dpCtx_;
  if (!c) return;
  const today = todayYmd_();
  host.querySelectorAll('[data-d]').forEach((b) => {
    const d = b.getAttribute('data-d') || '';
    const cls = dpDayCls_(c, d, today) + (b.getAttribute('data-focus') === '1' ? '' : '');
    if (b.className !== cls) b.className = cls;
    const cell = b.parentElement;
    if (cell) cell.setAttribute('aria-selected', cls.indexOf('dp-sel') >= 0 ? 'true' : 'false');
  });
  const sum = host.querySelector('.dp-sum');
  if (sum) sum.textContent = dpSummary_(c);
  const apply = host.querySelector('[data-dp="apply"]') as HTMLButtonElement | null;
  if (apply) apply.disabled = !(c.from && c.to && !c.picking);
}

/** ผูก event ครั้งเดียวต่อกล่อง แล้วใช้การมอบหมาย (delegation) — ปุ่มถูกวาดใหม่กี่รอบก็ยังทำงาน */
function dpWire_(host: HTMLElement): void {
  if (host.getAttribute('data-dp-wired')) return;
  host.setAttribute('data-dp-wired', '1');

  host.addEventListener('click', (e) => {
    const c = dpCtx_;
    if (!c) return;
    const t = (e.target as HTMLElement).closest('[data-d],[data-mv],[data-quick],[data-dp]') as HTMLElement | null;
    if (!t) return;

    const mv = t.getAttribute('data-mv');
    if (mv) {
      const [y, m] = addMonth_(c.vy, c.vm, Number(mv));
      c.vy = y; c.vm = m;
      dpPaint_(host);
      return;
    }
    const q = t.getAttribute('data-quick');
    if (q) {
      const today = todayYmd_();
      c.to = today;
      c.from = addDays_(today, -(Number(q) - 1));
      c.picking = false;
      c.focus = c.from;
      const pp = parseYmd_(c.from)!;
      c.vy = pp[0]; c.vm = pp[1];   // เลื่อนปฏิทินไปให้เห็นวันเริ่มต้นที่เพิ่งตั้ง
      dpPaint_(host);
      return;
    }
    const act = t.getAttribute('data-dp');
    if (act) {
      if (act === 'apply') dpApply_(); else dpClose_();
      return;
    }
    const d = t.getAttribute('data-d');
    if (d) {
      if (!c.picking) { c.from = d; c.to = ''; c.hover = ''; c.picking = true; }
      // กดย้อนหลังกว่าวันเริ่ม = เริ่มใหม่ที่วันนั้น ดีกว่าสลับให้เงียบๆ แล้วได้ช่วงที่ไม่ได้ตั้งใจ
      else if (d < c.from) { c.from = d; c.to = ''; c.hover = ''; c.picking = true; }
      else { c.to = d; c.picking = false; }
      c.focus = d;
      dpPaint_(host);
    }
  });

  // ระบายล่วงหน้าตามเมาส์ — แตะแค่คลาส ไม่วาด HTML ใหม่ (ดูคำเตือนใน dpTint_)
  host.addEventListener('mouseover', (e) => {
    const c = dpCtx_;
    if (!c || !c.picking) return;
    const t = (e.target as HTMLElement).closest('[data-d]') as HTMLElement | null;
    if (!t) return;
    const d = t.getAttribute('data-d') || '';
    if (d === c.hover) return;
    c.hover = d;
    dpTint_(host);
  });
}

function dpPaint_(host: HTMLElement): void {
  const c = dpCtx_;
  if (!c) return;
  host.innerHTML = dpHtml_(c);
  dpPlace_(host);
  dpWire_(host);
  // คืนโฟกัสให้วันที่กำลังโฟกัส เพื่อให้ลูกศรเดินต่อได้หลังวาดใหม่
  const f = host.querySelector('[data-focus="1"]') as HTMLElement | null;
  if (f && document.activeElement && host.contains(document.activeElement)) f.focus();
}

function dpMoveFocus_(host: HTMLElement, delta: number, byMonth: boolean): void {
  const c = dpCtx_;
  if (!c) return;
  if (byMonth) {
    const p = parseYmd_(c.focus)!;
    const [y, m] = addMonth_(p[0], p[1], delta);
    c.focus = ymd_(y, m, Math.min(p[2], daysInMonth_(y, m)));
  } else {
    c.focus = addDays_(c.focus, delta);
  }
  const p = parseYmd_(c.focus)!;
  // ให้เดือนที่โฟกัสอยู่ในสองเดือนที่แสดงเสมอ
  const [ry, rm] = addMonth_(c.vy, c.vm, 1);
  if (!((p[0] === c.vy && p[1] === c.vm) || (p[0] === ry && p[1] === rm))) { c.vy = p[0]; c.vm = p[1]; }
  dpPaint_(host);
  const f = host.querySelector('[data-focus="1"]') as HTMLElement | null;
  if (f) f.focus();
}

let dpOutside_: ((e: Event) => void) | null = null;
let dpKey_: ((e: KeyboardEvent) => void) | null = null;

function dpClose_(): void {
  const c = dpCtx_;
  dpCtx_ = null;
  if (dpOutside_) { document.removeEventListener('mousedown', dpOutside_, true); dpOutside_ = null; }
  if (dpKey_) { document.removeEventListener('keydown', dpKey_, true); dpKey_ = null; }
  document.querySelectorAll('.dp-host').forEach((h) => { h.innerHTML = ''; });
  document.querySelectorAll('.dp-trigger[aria-expanded="true"]').forEach((t) => {
    t.setAttribute('aria-expanded', 'false');
    (t as HTMLElement).focus();
  });
  if (c) { /* ปิดเฉยๆ ไม่แตะ state — ค่าที่ยังไม่กด "แสดง" ต้องไม่มีผล */ }
}

/** ย้ายปฏิทินที่เปิดอยู่ไปยังปุ่ม/กล่องชุดใหม่ หลังแถวควบคุมถูกวาดใหม่ (คงค่าที่เลือกค้างไว้) */
function dpRebind_(trig: HTMLElement, host: HTMLElement, state: RangeState, onChange: () => void): void {
  const c = dpCtx_;
  if (!c) return;
  c.state = state;          // state object อาจเป็นตัวเดิม แต่ผูกใหม่ให้ชัวร์
  c.onChange = onChange;
  trig.setAttribute('aria-expanded', 'true');
  dpPaint_(host);
  // ตัวจับคลิกนอกกล่องยังชี้ไป node เก่า → ผูกใหม่ให้ชี้ของใหม่
  if (dpOutside_) document.removeEventListener('mousedown', dpOutside_, true);
  dpOutside_ = (e: Event) => {
    const t = e.target as Node;
    if (host.contains(t) || trig.contains(t)) return;
    dpClose_();
  };
  document.addEventListener('mousedown', dpOutside_, true);
}

function dpApply_(): void {
  const c = dpCtx_;
  if (!c || !c.from || !c.to || c.picking) return;
  c.state.from = c.from;
  c.state.to = c.to;
  const onChange = c.onChange;
  dpClose_();
  onChange();
}

function dpOpen_(trigger: HTMLElement, host: HTMLElement, state: RangeState, idPrefix: string, onChange: () => void): void {
  if (dpCtx_ && dpCtx_.idPrefix === idPrefix) { dpClose_(); return; }   // กดซ้ำที่ปุ่มเดิม = ปิด
  dpClose_();
  const today = todayYmd_();
  const from = parseYmd_(state.from) ? String(state.from) : today;
  const to = parseYmd_(state.to) ? String(state.to) : from;
  const p = parseYmd_(from)!;
  // เปิดค้างไว้ที่เดือนของวันเริ่มต้น แต่ถ้าช่วงกินข้ามเดือนพอดี เดือนขวาจะโชว์วันจบให้เอง
  dpCtx_ = { state, idPrefix, onChange, vy: p[0], vm: p[1], from, to, picking: false, hover: '', focus: from };
  trigger.setAttribute('aria-expanded', 'true');
  dpPaint_(host);

  dpOutside_ = (e: Event) => {
    const t = e.target as Node;
    if (host.contains(t) || trigger.contains(t)) return;
    dpClose_();
  };
  document.addEventListener('mousedown', dpOutside_, true);

  dpKey_ = (e: KeyboardEvent) => {
    if (!dpCtx_) return;
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); dpClose_(); return; }
    if (k === 'Enter') {
      const act = document.activeElement as HTMLElement | null;
      if (act && act.classList.contains('dp-day')) return;   // ปล่อยให้ปุ่มวันจัดการเอง
      if (dpCtx_.from && dpCtx_.to && !dpCtx_.picking) { e.preventDefault(); dpApply_(); }
      return;
    }
    const map: Record<string, [number, boolean]> = {
      ArrowLeft: [-1, false], ArrowRight: [1, false],
      ArrowUp: [-7, false], ArrowDown: [7, false],
      PageUp: [-1, true], PageDown: [1, true],
    };
    if (map[k]) { e.preventDefault(); dpMoveFocus_(host, map[k][0], map[k][1]); }
  };
  document.addEventListener('keydown', dpKey_, true);

  const f = host.querySelector('[data-focus="1"]') as HTMLElement | null;
  if (f) f.focus();
}



// เรียงลำดับตามหน้าเว็บแอด (วันนี้ → เมื่อวาน → 3/7/30 วัน → เดือนนี้ → กำหนดเอง) ตามที่บอสขอ
// ⚠️ ทุก key ที่เพิ่มตรงนี้ ต้องมี case ใน resolveRange_ ของ lib/api/sales.ts และ lib/api/adminperf.ts ด้วย
//    ไม่งั้นมันจะตกไป default: = "วันนี้" เงียบๆ (ปุ่ม active แต่ตัวเลขไม่เปลี่ยน)
// ⚠️ เดิมทุกปุ่มมีอีโมจิปฏิทิน (📅 📆 🗓️ สลับกัน 3 แบบ) ซึ่ง "ทุกปุ่มมีเหมือนกัน" = ไม่ได้บอกอะไร
// แต่ทำให้ปุ่มกว้างขึ้นตัวละ ~22px รวม 7 ปุ่มก็เกินหนึ่งบรรทัดบนมือถือ (แถวปุ่มกินไป 3 บรรทัด)
// เหลือไว้เฉพาะ ⚙️ ของ "กำหนดเอง" ตัวเดียว เพราะอันนั้นทำงานต่างจากพวก — มันเปิดช่องให้กรอก
export const RANGE_PRESETS = [
  { key: 'today', label: 'วันนี้' },
  { key: 'yesterday', label: 'เมื่อวานนี้' },
  { key: '3d', label: '3 วันล่าสุด' },
  { key: '7d', label: '7 วันล่าสุด' },
  { key: '30d', label: '30 วันล่าสุด' },
  { key: 'month', label: 'เดือนนี้' },
  { key: 'custom', label: '⚙️ กำหนดเอง' },
];

/** สร้าง HTML ปุ่ม preset + date input; state = {preset, from, to} */
export function rangeControlsHtml(state: RangeState, idPrefix: string): string {
  const pills = RANGE_PRESETS.map((p) => {
    return '<button class="filter-btn' + (state.preset === p.key ? ' active' : '') +
      '" data-preset="' + p.key + '">' + p.label + '</button>';
  }).join('');
  // โหมดกำหนดเอง: แก้วันที่แล้ว "ยังไม่โหลด" จนกด แสดง/Enter — เดิมโหลดทันทีทุกช่องที่แก้
  // (เปลี่ยนช่วง 1 ครั้ง = แก้ 2 ช่อง = ยิงคิวรีช่วงยาว 2 รอบ ช้าและเปลืองฟรี — ผู้ใช้ขอแก้เอง)
  // โหมดกำหนดเอง: ปุ่มเดียวเปิดปฏิทินเลือกช่วง — เดิมเป็นช่อง <input type="date"> 2 ช่อง
  // ซึ่งกดยากบนมือถือ และไม่เห็นว่าช่วงที่เลือกกินกี่วันจนกว่าจะโหลดเสร็จ
  const label = state.from && state.to
    ? thaiDateShort(state.from) + ' – ' + thaiDateShort(state.to)
    : 'เลือกช่วงวันที่';
  const dates = state.preset === 'custom'
    ? '<div class="dp-wrap">' +
        '<button type="button" class="dp-trigger" id="' + idPrefix + '-dp" aria-haspopup="dialog"' +
          ' aria-expanded="false">📅 ' + esc(label) + '<span class="dp-caret">▾</span></button>' +
        '<div class="dp-host" id="' + idPrefix + '-dphost"></div>' +
      '</div>'
    : '';
  return '<div class="conv-filters" id="' + idPrefix + '-presets" style="margin-bottom:0">' + pills + '</div>' + dates;
}

/** ผูก event ให้ rangeControls; onChange() ถูกเรียกเมื่อ state เปลี่ยน (โหมดกำหนดเอง = ตอนกดแสดง) */
export function bindRangeControls(
  container: HTMLElement,
  state: RangeState,
  idPrefix: string,
  onChange: () => void,
): void {
  const wrap = container.querySelector('#' + idPrefix + '-presets');
  if (!wrap) return;
  wrap.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.preset = btn.getAttribute('data-preset')!;
      if (state.preset === 'custom' && !state.from) {
        // ใช้วันที่ตามเวลาเครื่องผู้ใช้ ไม่ใช่ UTC (toISOString จะถอยไปวันก่อนช่วงก่อน 7 โมงเช้า)
        const d = new Date();
        const today = d.getFullYear() + '-' +
          ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
          ('0' + d.getDate()).slice(-2);
        state.from = today;
        state.to = today;
      }
      onChange();
    });
  });
  // โหมดกำหนดเอง: ปุ่มเดียวเปิดปฏิทิน — ค่าจะมีผลต่อเมื่อกด "แสดง" ในปฏิทินเท่านั้น
  // (เปลี่ยนช่วง 1 ครั้งเคยยิงคิวรีช่วงยาว 2 รอบ เพราะแก้ทีละช่อง)
  const trig = container.querySelector('#' + idPrefix + '-dp') as HTMLElement | null;
  const host = container.querySelector('#' + idPrefix + '-dphost') as HTMLElement | null;
  // หน้าวาดแถวควบคุมใหม่ (โหลดข้อมูลเสร็จ / auto-refresh) = ปุ่มกับกล่องปฏิทินกลายเป็น node ใหม่
  // ตัวที่เปิดค้างอยู่จะชี้ไป node เก่าที่หลุดจากหน้าไปแล้ว → ปฏิทินหายจากจอแต่ระบบยังคิดว่าเปิดอยู่
  // คลิกรอบถัดไปเลยกลายเป็น "สั่งปิด" แทน "เปิด" (อาการ: เปิดไม่ขึ้น ต้องกด 2 ครั้ง)
  // ย้ายไปกล่องใหม่แทนการปิดทิ้ง — ผู้ใช้ที่กำลังเลือกวันอยู่จะได้ไม่โดนปิดใส่หน้ากลางคัน
  if (dpCtx_ && dpCtx_.idPrefix === idPrefix && trig && host) {
    dpRebind_(trig, host, state, onChange);
  }
  // กันผูก event ซ้ำ: บางหน้าเรียก bindRangeControls ใหม่โดยไม่ได้สร้าง DOM ใหม่ (เช่นรอบ
  // auto-refresh) ปุ่มเดิมจะมี listener 2 ตัว → คลิกเดียวสั่ง "เปิด" แล้ว "ปิด" ต่อทันที
  // อาการคือปฏิทินเปิดไม่ขึ้นแบบสุ่ม ไล่ยากมากเพราะครั้งแรกหลังโหลดหน้าใช้ได้ปกติ
  if (trig && host && !trig.getAttribute('data-dp-bound')) {
    trig.setAttribute('data-dp-bound', '1');
    trig.addEventListener('click', () => dpOpen_(trig, host, state, idPrefix, onChange));
  }
}
