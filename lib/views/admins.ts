// lib/views/admins.ts — Admin Management (Views.admins)
// port จาก JsAdmins.html — ข้อมูลจริงจาก apiAdmins() กรอง/เรียงฝั่ง client ทั้งหมด
// ฟังก์ชัน pure รันบน browser เท่านั้น — ห้าม import อะไรจากฝั่ง server
// HTML string / ชื่อ class / ข้อความไทย / esc() / font-size / ตรรกะ render คงเดิมทุกตัวอักษรจากเวอร์ชัน GAS

import {
  serverCall,
  esc,
  fmtNum,
  THB,
  avatarHtml,
  openModal,
  closeModal,
  toast,
  showError,
  downloadCSV,
} from '@/lib/ui/helpers';
import { adminsSkel } from '@/lib/ui/skeletons';

/* ---------------- types ---------------- */

interface AdminToday {
  replies?: number;
  chats?: number;
  phones?: number;
  respMins?: number | null;
  orders?: number;
  revenue?: number;
}

interface Admin {
  id: string | number;
  posId?: string | number;
  name?: string;
  email?: string;
  online?: boolean;
  statusInPage?: string;
  pages?: string;
  pageCount?: number;
  permissions?: string;
  department?: string;
  saleGroup?: string;
  avatar?: string;
  today?: AdminToday;
  waiting?: number;
}

interface AdminsKpis {
  total?: number;
  online?: number;
  offline?: number;
  withSalesToday?: number;
  repliedToday?: number;
  waitingTotal?: number;
  phonesToday?: number;
}

interface AdminsData {
  kpis?: AdminsKpis;
  admins?: Admin[];
}

/* ---------------- state ---------------- */

let lastData: AdminsData | null = null;
const filter = { q: '', status: '', dept: '' };

/* ---------------- helpers ภายใน view ---------------- */

function cut(s: unknown, n: number): string {
  const str = String(s === undefined || s === null ? '' : s);
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

function respFmt(v: number | null | undefined): string {
  if (v === null || v === undefined || isNaN(v)) return '-';
  return (Math.round(Number(v) * 10) / 10) + 'น.';
}

function statusBadge(online: boolean): string {
  return online
    ? '<span class="badge ai">🟢 ออนไลน์</span>'
    : '<span class="badge neutral">⚪ ออฟไลน์</span>';
}

function pgsItem(val: string | number, label: string, cls: string): string {
  return '<div class="pgs-item' + (cls ? ' ' + cls : '') + '">' +
    '<b>' + val + '</b><span>' + esc(label) + '</span></div>';
}

function cellHtml(val: string | number, label: string, cls: string): string {
  return '<div class="cell' + (cls ? ' ' + cls : '') + '">' +
    '<b>' + val + '</b><span>' + esc(label) + '</span></div>';
}

function detailRow(label: string, valueHtml: string): string {
  return '<div style="display:flex;gap:12px;padding:8px 0;border-bottom:1px dashed rgba(38,51,82,.6);font-size:13px">' +
    '<div style="width:120px;flex-shrink:0;color:var(--text-3)">' + esc(label) + '</div>' +
    '<div style="flex:1;min-width:0">' + valueHtml + '</div></div>';
}

function splitList(s: unknown): string[] {
  const out: string[] = [];
  const parts = String(s === undefined || s === null ? '' : s).split(', ');
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].replace(/^\s+|\s+$/g, '');
    if (p) out.push(p);
  }
  return out;
}

/* ---------------- filter / sort ---------------- */

function matches(a: Admin): boolean {
  if (filter.q) {
    const q = filter.q.toLowerCase();
    if (String(a.name || '').toLowerCase().indexOf(q) === -1) return false;
  }
  if (filter.status === 'online' && !a.online) return false;
  if (filter.status === 'offline' && a.online) return false;
  if (filter.dept && String(a.department || '') !== filter.dept) return false;
  return true;
}

function getFiltered(): Admin[] {
  const admins = (lastData && lastData.admins) || [];
  const list = admins.filter(matches);
  list.sort(function (a, b) {
    const oa = a.online ? 1 : 0, ob = b.online ? 1 : 0;
    if (ob !== oa) return ob - oa;
    const ra = (a.today && a.today.revenue) || 0;
    const rb = (b.today && b.today.revenue) || 0;
    if (rb !== ra) return rb - ra;
    return String(a.name || '').localeCompare(String(b.name || ''), 'th');
  });
  return list;
}

function findAdmin(id: string | null): Admin | null {
  const admins = (lastData && lastData.admins) || [];
  for (let i = 0; i < admins.length; i++) {
    if (String(admins[i].id) === String(id)) return admins[i];
  }
  return null;
}

/* ---------------- card ---------------- */

function cardHtml(a: Admin): string {
  const t = a.today || {};
  const meta = (a.department || '—') +
    (a.saleGroup ? ' • ' + a.saleGroup : '') +
    ' • ดูแล ' + fmtNum(a.pageCount || 0) + ' เพจ';
  const waiting = Number(a.waiting) || 0;
  const pages = a.pages || '';
  const cells =
    cellHtml(fmtNum(t.replies || 0), 'ตอบวันนี้', '') +
    cellHtml(fmtNum(t.chats || 0), 'แชทที่ดูแล', '') +
    cellHtml(fmtNum(waiting), 'รอตอบ', waiting > 0 ? 'warn' : '') +
    cellHtml(esc(respFmt(t.respMins)), 'ตอบเฉลี่ย', '') +
    cellHtml(fmtNum(t.orders || 0), 'ออเดอร์วันนี้', '') +
    cellHtml(esc(THB(t.revenue || 0)), 'ยอดขาย', '');
  return '<div class="admin-card">' +
    '<div class="admin-head">' +
      avatarHtml(a.id, a.name, !!a.online) +
      '<div style="flex:1;min-width:0">' +
        '<div class="admin-name">' + esc(a.name) + '</div>' +
        '<div class="admin-meta">' + esc(meta) + '</div>' +
      '</div>' +
      '<div style="margin-left:auto;flex-shrink:0">' + statusBadge(!!a.online) + '</div>' +
    '</div>' +
    '<div class="page-stats">' + cells + '</div>' +
    '<div class="page-status-row">' +
      '<span class="chip" title="' + esc(pages || 'ไม่มีเพจ') + '">📄 ' +
        esc(pages ? cut(pages, 40) : 'ไม่มีเพจ') + '</span>' +
      '<span style="flex:1"></span>' +
      '<button class="btn-mini" data-detail-id="' + esc(String(a.id)) + '">🔎 รายละเอียด</button>' +
    '</div>' +
  '</div>';
}

/* ---------------- modal รายละเอียด ---------------- */

function openDetail(a: Admin): void {
  const t = a.today || {};
  const pageList = splitList(a.pages);
  const pagesHtml = pageList.length
    ? pageList.map(function (p) { return '📄 ' + esc(p); }).join('<br>')
    : '—';
  const perms = splitList(a.permissions);
  const permsHtml = perms.length
    ? '<div class="pill-grid" style="margin-bottom:0">' +
        perms.map(function (p) { return '<span class="badge neutral">' + esc(p) + '</span>'; }).join('') +
      '</div>'
    : '—';
  const html =
    '<div class="modal-head">' +
      '<div style="display:flex;gap:12px;align-items:center;min-width:0">' +
        avatarHtml(a.id, a.name, !!a.online) +
        '<div style="min-width:0">' +
          '<h3>' + esc(a.name) + '</h3>' +
          '<div style="margin-top:5px">' + statusBadge(!!a.online) + '</div>' +
        '</div>' +
      '</div>' +
      '<button class="modal-close">✕</button>' +
    '</div>' +
    detailRow('อีเมล', esc(a.email || '-')) +
    detailRow('แผนก', esc(a.department || '—')) +
    detailRow('กลุ่มขาย', esc(a.saleGroup || '—')) +
    detailRow('เพจที่ดูแล (' + fmtNum(a.pageCount || 0) + ')', pagesHtml) +
    detailRow('สิทธิ์', permsHtml) +
    '<div style="margin:16px 0 10px;font-weight:700;font-size:13px">📊 สถิติวันนี้</div>' +
    '<div class="page-stats">' +
      cellHtml(fmtNum(t.replies || 0), 'ตอบ', '') +
      cellHtml(fmtNum(t.chats || 0), 'แชท', '') +
      cellHtml(fmtNum(t.phones || 0), 'เบอร์โทร', '') +
      cellHtml(fmtNum(t.orders || 0), 'ออเดอร์', '') +
      cellHtml(esc(THB(t.revenue || 0)), 'ยอดขาย', '') +
    '</div>' +
    '<div class="modal-actions">' +
      '<button class="btn" id="adm-dt-close">ปิด</button>' +
    '</div>';
  openModal(html);
  const b = document.getElementById('adm-dt-close');
  if (b) b.addEventListener('click', closeModal);
}

/* ---------------- export CSV ---------------- */

function exportCsv(): void {
  const list = getFiltered();
  if (!list.length) {
    toast('👥 ไม่มีข้อมูลแอดมินให้ Export');
    return;
  }
  const rows: unknown[][] = [[
    'ชื่อ', 'อีเมล', 'แผนก', 'กลุ่มขาย', 'สถานะ', 'เพจ',
    'ตอบวันนี้', 'แชทวันนี้', 'รอตอบ', 'ตอบเฉลี่ย(นาที)', 'ออเดอร์วันนี้', 'ยอดขายวันนี้'
  ]];
  list.forEach(function (a) {
    const t = a.today || {};
    rows.push([
      a.name || '', a.email || '', a.department || '', a.saleGroup || '',
      a.online ? 'ออนไลน์' : 'ออฟไลน์', a.pages || '',
      t.replies || 0, t.chats || 0, Number(a.waiting) || 0,
      (t.respMins === null || t.respMins === undefined) ? '' : t.respMins,
      t.orders || 0, t.revenue || 0
    ]);
  });
  downloadCSV(rows, 'admin-report');
}

/* ---------------- render ---------------- */

function renderGrid(container: HTMLElement): void {
  const wrap = container.querySelector('#adm-grid-wrap');
  if (!wrap) return;
  const admins = (lastData && lastData.admins) || [];
  if (!admins.length) {
    wrap.innerHTML =
      '<div class="empty-note">👥 ยังไม่มีข้อมูลแอดมิน</div>' +
      '<div class="hint-box">💡 ระบบซิงค์รายชื่อแอดมินจาก Pancake อัตโนมัติทุกชั่วโมง — ' +
      'รอสักครู่แล้วกดรีเฟรชหน้านี้อีกครั้ง</div>';
    return;
  }
  const list = getFiltered();
  if (!list.length) {
    wrap.innerHTML = '<div class="empty-note">👥 ไม่พบแอดมินตามเงื่อนไข</div>';
    return;
  }
  wrap.innerHTML = '<div class="admin-grid">' + list.map(cardHtml).join('') + '</div>';
}

function render(container: HTMLElement): void {
  const d = lastData || {};
  const k = d.kpis || {};
  const admins = d.admins || [];

  /* แผนกที่มีจริง (ไม่ว่าง, ไม่ซ้ำ) */
  const depts: string[] = [], seen: Record<string, boolean> = {};
  admins.forEach(function (a) {
    const dep = String(a.department || '').replace(/^\s+|\s+$/g, '');
    if (dep && !seen[dep]) { seen[dep] = true; depts.push(dep); }
  });
  depts.sort(function (a, b) { return a.localeCompare(b, 'th'); });
  if (filter.dept && !seen[filter.dept]) filter.dept = '';

  const waitingTotal = Number(k.waitingTotal) || 0;

  const html =
    '<div class="pg-summary">' +
      pgsItem(fmtNum(k.total || 0), 'แอดมินทั้งหมด', '') +
      pgsItem(fmtNum(k.online || 0), 'ออนไลน์', 'ok') +
      pgsItem(fmtNum(k.offline || 0), 'ออฟไลน์', '') +
      pgsItem(fmtNum(k.withSalesToday || 0), 'มียอดขายวันนี้', 'ok') +
      pgsItem(fmtNum(k.repliedToday || 0), 'ตอบแชทวันนี้', '') +
      pgsItem(fmtNum(waitingTotal), 'แชทรอตอบรวม', waitingTotal > 0 ? 'warn' : '') +
      pgsItem(fmtNum(k.phonesToday || 0), 'เบอร์โทรวันนี้', '') +
    '</div>' +

    '<div class="pg-controls">' +
      '<input class="input" id="adm-q" type="text" placeholder="🔍 ค้นหาชื่อแอดมิน..." ' +
        'value="' + esc(filter.q) + '" style="min-width:220px">' +
      '<select class="input" id="adm-status">' +
        '<option value=""' + (filter.status === '' ? ' selected' : '') + '>ทุกสถานะ</option>' +
        '<option value="online"' + (filter.status === 'online' ? ' selected' : '') + '>🟢 ออนไลน์</option>' +
        '<option value="offline"' + (filter.status === 'offline' ? ' selected' : '') + '>⚪ ออฟไลน์</option>' +
      '</select>' +
      '<select class="input" id="adm-dept">' +
        '<option value=""' + (filter.dept === '' ? ' selected' : '') + '>ทุกแผนก</option>' +
        depts.map(function (dep) {
          return '<option value="' + esc(dep) + '"' + (filter.dept === dep ? ' selected' : '') + '>' +
            esc(dep) + '</option>';
        }).join('') +
      '</select>' +
      '<div class="spacer"></div>' +
      '<button class="btn" id="adm-export">📄 Export CSV</button>' +
    '</div>' +

    '<div id="adm-grid-wrap"></div>';

  container.innerHTML = html;
  renderGrid(container);
  bindEvents(container);
}

function bindEvents(container: HTMLElement): void {
  const q = container.querySelector('#adm-q') as HTMLInputElement | null;
  if (q) q.addEventListener('input', function () {
    filter.q = q.value;
    renderGrid(container);
  });

  const st = container.querySelector('#adm-status') as HTMLSelectElement | null;
  if (st) st.addEventListener('change', function () {
    filter.status = st.value;
    renderGrid(container);
  });

  const dp = container.querySelector('#adm-dept') as HTMLSelectElement | null;
  if (dp) dp.addEventListener('change', function () {
    filter.dept = dp.value;
    renderGrid(container);
  });

  const ex = container.querySelector('#adm-export');
  if (ex) ex.addEventListener('click', exportCsv);

  const wrap = container.querySelector('#adm-grid-wrap');
  if (wrap) wrap.addEventListener('click', function (e) {
    let el = e.target as any;
    while (el && el !== wrap) {
      if (el.getAttribute && el.getAttribute('data-detail-id') !== null) {
        const a = findAdmin(el.getAttribute('data-detail-id'));
        if (a) openDetail(a);
        return;
      }
      el = el.parentNode;
    }
  });
}

/* ---------------- fetch ---------------- */

function fetchData(container: HTMLElement, silent: boolean): void {
  serverCall<AdminsData>('apiAdmins').then(function (data) {
    lastData = data;
    render(container);
  }).catch(function (err) {
    const msg = (err && err.message) || 'เรียกข้อมูลไม่สำเร็จ';
    if (silent && lastData) {
      toast('⚠️ รีเฟรชข้อมูลแอดมินไม่สำเร็จ: ' + msg);
    } else {
      showError(container, msg, function () {
        container.innerHTML = adminsSkel();
        fetchData(container, false);
      });
    }
  });
}

/* ---------------- ลงทะเบียน view ---------------- */

export const admins = {
  load: async (container: HTMLElement, force?: boolean): Promise<void> => {
    if (lastData && !force) {
      render(container);
      fetchData(container, true); /* อัปเดตเบื้องหลัง */
    } else {
      container.innerHTML = adminsSkel();
      fetchData(container, false);
    }
  },
};
