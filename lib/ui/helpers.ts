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
  const dates = state.preset === 'custom'
    ? '<input type="date" class="input" id="' + idPrefix + '-from" value="' + esc(state.from || '') + '">' +
      '<span style="align-self:center">ถึง</span>' +
      '<input type="date" class="input" id="' + idPrefix + '-to" value="' + esc(state.to || '') + '">' +
      '<button class="btn primary" id="' + idPrefix + '-apply">แสดง</button>'
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
  // แก้วันที่ = จำค่าไว้เฉยๆ — โหลดจริงเมื่อกดปุ่ม "แสดง" หรือ Enter เท่านั้น
  const apply = () => {
    if (!state.from || !state.to) return;
    if (state.from > state.to) { // สลับให้เองถ้ากรอกกลับด้าน — ดีกว่าโหลดแล้วได้ตารางว่าง
      const t = state.from;
      state.from = state.to;
      state.to = t;
    }
    onChange();
  };
  (['from', 'to'] as const).forEach((k) => {
    const inp = container.querySelector('#' + idPrefix + '-' + k) as HTMLInputElement | null;
    if (!inp) return;
    inp.addEventListener('change', () => { state[k] = inp.value; });
    inp.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') { state[k] = inp.value; apply(); }
    });
  });
  const btn = container.querySelector('#' + idPrefix + '-apply');
  if (btn) btn.addEventListener('click', apply);
}
