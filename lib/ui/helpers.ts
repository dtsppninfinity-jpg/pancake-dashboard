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
  root.querySelector('.modal-overlay')!.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  const x = root.querySelector('.modal-close');
  if (x) x.addEventListener('click', closeModal);
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

export const RANGE_PRESETS = [
  { key: 'today', label: '📅 วันนี้' },
  { key: '7d', label: '🗓 7 วันล่าสุด' },
  { key: '30d', label: '🗓 30 วันล่าสุด' },
  { key: 'month', label: '🗓 เดือนนี้' },
  { key: 'custom', label: '⚙️ กำหนดเอง' },
];

/** สร้าง HTML ปุ่ม preset + date input; state = {preset, from, to} */
export function rangeControlsHtml(state: RangeState, idPrefix: string): string {
  const pills = RANGE_PRESETS.map((p) => {
    return '<button class="filter-btn' + (state.preset === p.key ? ' active' : '') +
      '" data-preset="' + p.key + '">' + p.label + '</button>';
  }).join('');
  const dates = state.preset === 'custom'
    ? '<input type="date" class="input" id="' + idPrefix + '-from" value="' + esc(state.from || '') + '">' +
      '<input type="date" class="input" id="' + idPrefix + '-to" value="' + esc(state.to || '') + '">'
    : '';
  return '<div class="conv-filters" id="' + idPrefix + '-presets" style="margin-bottom:0">' + pills + '</div>' + dates;
}

/** ผูก event ให้ rangeControls; onChange() ถูกเรียกเมื่อ state เปลี่ยน */
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
  (['from', 'to'] as const).forEach((k) => {
    const inp = container.querySelector('#' + idPrefix + '-' + k) as HTMLInputElement | null;
    if (inp) inp.addEventListener('change', () => {
      state[k] = inp.value;
      onChange();
    });
  });
}
