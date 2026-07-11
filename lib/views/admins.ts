// lib/views/admins.ts — Admin Management (Views.admins)
// ข้อมูลจริงจาก apiAdmins() กรอง/เรียงฝั่ง client ทั้งหมด
// อัปเกรดตามต้นแบบ AI-Pancake-Chat-Automation: ปุ่มปิดใช้งาน / สถานะ override /
// modal สิทธิ์-ตั้งค่า / แท็บ Role Settings / ป้าย capacity / สถิติ + timeline จริง
// การตั้งค่าเก็บจริงใน Supabase (apiAdminSettings) — ไม่มีอะไรถูกส่งไป Pancake
// ฟังก์ชัน pure รันบน browser เท่านั้น — ห้าม import อะไรจากฝั่ง server

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
import {
  ADMIN_ROLES,
  PERM_LABELS,
  ADMIN_STATUS_META,
  effectiveStatus,
  capacityOf,
  RolePerms,
  DEFAULT_MAX_ACTIVE,
} from '@/lib/adminconfig';
import { computeScore, normalizeConfig, type MetricConfig } from '@/lib/scoring';

/* ---------------- types ---------------- */

interface AdminToday {
  replies?: number;
  chats?: number;
  phones?: number;
  respMins?: number | null;
  respMinMins?: number | null;
  respMaxMins?: number | null;
  orders?: number;
  revenue?: number;
}

interface OnlineToday {
  mins: number;
  gapMins: number | null;
  marks: [number, boolean][];
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
  overSla?: number;
  active?: number;
  /* ---- ตั้งค่า (admin_settings) ---- */
  enabled?: boolean;
  statusOverride?: string;
  role?: string;
  channels?: string;
  productGroups?: string;
  maxActive?: number;
  maxPending?: number;
  note?: string;
  status?: string; // effective: online|away|busy|offline|disabled
  capacity?: { key: string; label: string; cls: string };
  onlineToday?: OnlineToday | null;
  orderMarks?: [number, number][];
}

interface AdminsKpis {
  total?: number;
  activeTotal?: number;
  online?: number;
  away?: number;
  offline?: number;
  disabled?: number;
  fullCap?: number;
  withSalesToday?: number;
  repliedToday?: number;
  waitingTotal?: number;
  overSlaTotal?: number;
  phonesToday?: number;
}

interface AdminsData {
  kpis?: AdminsKpis;
  admins?: Admin[];
  rolePerms?: RolePerms;
  setupNeeded?: boolean;
  slaMins?: number;
}

/* ---------------- state ---------------- */

let lastData: AdminsData | null = null;
let tab: 'cards' | 'roles' = 'cards';
const filter = { q: '', status: '', role: '', dept: '', channel: '', group: '', cap: '' };
let saving = false;  // กันกดบันทึกซ้อน
let dataSeq = 0;     // เพิ่มทุกครั้งที่ผู้ใช้แก้อะไรใน state — กัน refetch เบื้องหลัง (ข้อมูลเก่ากว่า) มาทับ

/* ---- เกณฑ์คะแนน Overall (ชุดเดียวกับหน้า Admin Performance — โหลดครั้งเดียว) ---- */
let scoreCfg: MetricConfig[] | null = null;
let scoreCfgLoaded = false;

async function loadScoreCfg(): Promise<void> {
  if (scoreCfgLoaded) return;
  try {
    const res = await serverCall<{ config: unknown }>('apiScoreConfig', {});
    scoreCfg = normalizeConfig(res && res.config);
  } catch (e) {
    scoreCfg = normalizeConfig(null); // ใช้เกณฑ์ default เมื่อโหลดไม่สำเร็จ
  }
  scoreCfgLoaded = true;
}

/** คะแนน Overall ของวันนี้ (เกณฑ์เดียวกับหน้า Admin Performance) — null เมื่อคิดไม่ได้ */
function scoreOf(a: Admin): number | null {
  if (!scoreCfg) return null;
  const t = a.today || {};
  const chats = Number(t.chats) || 0;
  const orders = Number(t.orders) || 0;
  const revenue = Number(t.revenue) || 0;
  return computeScore({
    revenue,
    orders,
    chats,
    replies: Number(t.replies) || 0,
    phones: Number(t.phones) || 0,
    avgRespMins: (t.respMins === null || t.respMins === undefined) ? null : Number(t.respMins),
    closeRate: chats ? Math.min(100, Math.round((orders / chats) * 1000) / 10) : null,
    avgOrder: orders ? Math.round(revenue / orders) : 0,
  }, scoreCfg).score;
}

const CH_LABEL: Record<string, string> = { both: '📘+🟢', facebook: '📘 FB', line: '🟢 LINE' };

/* ---------------- helpers ภายใน view ---------------- */

function cut(s: unknown, n: number): string {
  const str = String(s === undefined || s === null ? '' : s);
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

function respFmt(v: number | null | undefined): string {
  if (v === null || v === undefined || isNaN(v)) return '-';
  return (Math.round(Number(v) * 10) / 10) + 'น.';
}

function hhmm(ts: number): string {
  // ปักโซนไทยเสมอ — ไม่งั้นเปิดจากเครื่อง/ที่ที่โซนอื่นแล้วเวลาใน timeline เพี้ยน
  return new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
}

function hrsFmt(mins: number): string {
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? h + ' ชม. ' + m + ' น.' : m + ' น.';
}

function statusOf(a: Admin): string {
  return a.status || effectiveStatus(a.enabled !== false, String(a.statusOverride || ''), !!a.online);
}

/** เวลาที่ online ครั้งล่าสุดวันนี้ (จาก log จริง) — 'ตอนนี้' ถ้ายังออนไลน์อยู่ */
function lastOnlineStr(a: Admin): string {
  if (a.online) return 'ตอนนี้ 🟢';
  const marks = (a.onlineToday && a.onlineToday.marks) || [];
  for (let i = marks.length - 1; i >= 0; i--) {
    if (!marks[i][1]) return hhmm(marks[i][0]) + ' น.'; // จุดที่เปลี่ยนเป็นออฟไลน์ล่าสุด = เห็นออนไลน์ล่าสุด
  }
  return '—';
}

function statusBadge(a: Admin): string {
  const st = ADMIN_STATUS_META[statusOf(a)] || ADMIN_STATUS_META.offline;
  return '<span class="badge ' + st.cls + '">' + st.label + '</span>';
}

function capOf(a: Admin): { key: string; label: string; cls: string } {
  return a.capacity || capacityOf(Number(a.active) || 0, Number(a.maxActive) || DEFAULT_MAX_ACTIVE);
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

/** กลุ่มสินค้าของแอดมิน 1 คน (คั่นด้วย ,) */
function groupsOf(a: Admin): string[] {
  return String(a.productGroups || '').split(',')
    .map(function (g) { return g.trim(); })
    .filter(function (g) { return !!g; });
}

/** กลุ่มสินค้าทั้งหมดที่มีใครสักคนตั้งไว้ (สำหรับ filter + chip ใน modal) */
function allGroups(): string[] {
  const seen: Record<string, boolean> = {};
  const out: string[] = [];
  ((lastData && lastData.admins) || []).forEach(function (a) {
    groupsOf(a).forEach(function (g) {
      if (!seen[g]) { seen[g] = true; out.push(g); }
    });
  });
  out.sort(function (a, b) { return a.localeCompare(b, 'th'); });
  return out;
}

/* ---------------- persistence ---------------- */

function recomputeLocal(a: Admin): void {
  a.status = effectiveStatus(a.enabled !== false, String(a.statusOverride || ''), !!a.online);
  a.capacity = capacityOf(Number(a.active) || 0, Number(a.maxActive) || DEFAULT_MAX_ACTIVE);
}

/**
 * บันทึกตั้งค่าแอดมิน 1 คน — ส่งเฉพาะ field ที่แก้ (partial; ฝั่ง server merge กับแถวเดิม
 * กัน tab อื่นที่เปิดค้างเขียนทับ field ที่คนอื่นเพิ่งแก้) — ล้มเหลว → คืนค่าเดิม + เตือน
 */
function saveAdmin(
  a: Admin, changed: Record<string, unknown>, revert: () => void,
  container: HTMLElement, okMsg: string
): void {
  if (saving) {
    revert();
    recomputeLocal(a); // ห้ามลืม — ไม่งั้น status/capacity ที่คำนวณจากค่าใหม่ค้างอยู่ทั้งที่ revert แล้ว
    renderBody(container);
    toast('⏳ กำลังบันทึกรายการก่อนหน้า — ลองอีกครั้ง');
    return;
  }
  saving = true;
  dataSeq++; // มีการแก้ state — refetch เบื้องหลังที่เริ่มก่อนหน้านี้ห้ามเอาข้อมูลมาทับ
  serverCall<any>('apiAdminSettings', { admin: { user_id: String(a.id), ...changed } }).then(function (res) {
    saving = false;
    if (res && res.ok) { toast(res.warning ? '⚠️ ' + res.warning : okMsg); return; }
    revert();
    recomputeLocal(a);
    renderBody(container);
    toast(res && res.needSetup
      ? '⚠️ ยังบันทึกไม่ได้ — ตารางตั้งค่ายังไม่ถูกสร้างใน Supabase'
      : '⚠️ บันทึกไม่สำเร็จ: ' + ((res && res.error) || 'ไม่ทราบสาเหตุ'));
  }).catch(function (err) {
    saving = false;
    revert();
    recomputeLocal(a);
    renderBody(container);
    toast('⚠️ บันทึกไม่สำเร็จ: ' + ((err && err.message) || 'เครือข่ายมีปัญหา'));
  });
}

/* ---------------- filter / sort ---------------- */

function matches(a: Admin): boolean {
  if (filter.q) {
    const q = filter.q.toLowerCase();
    if (String(a.name || '').toLowerCase().indexOf(q) === -1) return false;
  }
  if (filter.status && statusOf(a) !== filter.status) return false;
  if (filter.role && String(a.role || '') !== filter.role) return false;
  if (filter.dept && String(a.department || '') !== filter.dept) return false;
  if (filter.channel) {
    const ch = String(a.channels || 'both');
    if (ch !== 'both' && ch !== filter.channel) return false;
  }
  if (filter.group && groupsOf(a).indexOf(filter.group) < 0) return false;
  if (filter.cap === 'slow') {
    const r = a.today && a.today.respMins;
    if (r === null || r === undefined || Number(r) <= 8) return false;
  } else if (filter.cap && capOf(a).key !== filter.cap) return false;
  return true;
}

function getFiltered(): Admin[] {
  const admins = (lastData && lastData.admins) || [];
  const list = admins.filter(matches);
  list.sort(function (a, b) {
    const ea = a.enabled !== false ? 1 : 0, eb = b.enabled !== false ? 1 : 0;
    if (eb !== ea) return eb - ea; // ปิดใช้งานไปท้ายสุด
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
  const enabled = a.enabled !== false;
  const cap = capOf(a);
  const active = Number(a.active) || 0;
  const maxActive = Number(a.maxActive) || DEFAULT_MAX_ACTIVE;
  const waiting = Number(a.waiting) || 0;
  const maxPending = Number(a.maxPending) || 0;
  const overSla = Number(a.overSla) || 0;
  const overPending = maxPending > 0 && waiting > maxPending;
  const groups = String(a.productGroups || '');
  const meta = (a.role ? a.role : (a.department || '—')) +
    ' • ' + (CH_LABEL[String(a.channels || 'both')] || CH_LABEL.both) +
    (groups ? ' • ' + cut(groups, 20) : (a.saleGroup ? ' • ' + a.saleGroup : '')) +
    ' • ' + fmtNum(a.pageCount || 0) + ' เพจ';
  const ot = a.onlineToday;
  const onlineRow = ot
    ? '<span class="badge neutral" title="เวลาออนไลน์รวมวันนี้ (จาก log จริง ความละเอียด ~15 นาที)">🟢 ' +
        esc(hrsFmt(ot.mins)) + '</span>' +
      (ot.gapMins
        ? '<span class="badge ' + (ot.gapMins > 45 ? 'admin' : 'neutral') +
          '" title="ช่วงหายนานสุดวันนี้ (หลังออนไลน์ครั้งแรก)">😴 หาย ' + esc(hrsFmt(ot.gapMins)) + '</span>'
        : '')
    : '<span class="badge neutral" title="เริ่มเก็บประวัติออนไลน์อัตโนมัติ — จะแสดงเมื่อมีข้อมูล">🕐 รอเก็บข้อมูล</span>';
  const pages = a.pages || '';

  const cells =
    cellHtml(fmtNum(t.replies || 0), 'ตอบวันนี้', '') +
    cellHtml(fmtNum(active) + '/' + fmtNum(maxActive), 'แชทดูแล (24ชม.)',
      cap.key === 'full' ? 'warn' : '') +
    cellHtml(fmtNum(waiting) + (maxPending > 0 ? '/' + fmtNum(maxPending) : ''),
      'รอตอบ' + (maxPending > 0 ? ' (เพดาน)' : ''),
      overPending || waiting > 0 ? 'warn' : '') +
    cellHtml(esc(respFmt(t.respMins)), 'ตอบเฉลี่ย', '') +
    cellHtml(fmtNum(t.orders || 0), 'ออเดอร์วันนี้', '') +
    cellHtml(esc(THB(t.revenue || 0)), 'ยอดขาย', '');
  const slaMins = Number(lastData && lastData.slaMins) || 60;
  const slaBadge = overSla > 0
    ? '<span class="badge urgent" title="แชทที่ลูกค้ารอเกิน ' + slaMins +
      ' นาที (เกณฑ์ SLA แบบ proxy จากเวลาข้อความล่าสุด)">⏰ เกิน SLA ' + fmtNum(overSla) + '</span>'
    : '';

  return '<div class="admin-card' + (enabled ? '' : ' off') + '" data-admin-id="' + esc(String(a.id)) + '">' +
    '<div class="admin-head">' +
      avatarHtml(a.id, a.name, !!a.online && enabled) +
      '<div style="flex:1;min-width:0">' +
        '<div class="admin-name">' + esc(a.name) + '</div>' +
        '<div class="admin-meta" title="' + esc(meta) + '">' + esc(meta) + '</div>' +
      '</div>' +
      '<div style="margin-left:auto;flex-shrink:0;display:flex;flex-direction:column;gap:4px;align-items:flex-end">' +
        statusBadge(a) +
        '<span class="badge ' + cap.cls + '">' + esc(cap.label) + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="page-stats">' + cells + '</div>' +
    '<div class="page-status-row">' +
      onlineRow +
      slaBadge +
      '<span style="flex:1"></span>' +
      '<span class="chip" title="' + esc(pages || 'ไม่มีเพจ') + '">📄 ' +
        esc(pages ? cut(pages, 26) : 'ไม่มีเพจ') + '</span>' +
    '</div>' +
    '<div class="admin-actions">' +
      '<button class="btn-mini' + (enabled ? '' : ' primary') + '" data-adtoggle="' + esc(String(a.id)) + '">' +
        (enabled ? '⏸ ปิดใช้งาน' : '▶ เปิดใช้งาน') + '</button>' +
      '<select class="input ad-status-sel" data-adstatus="' + esc(String(a.id)) + '"' + (enabled ? '' : ' disabled') + '>' +
        '<option value=""' + (!a.statusOverride ? ' selected' : '') + '>สถานะอัตโนมัติ</option>' +
        '<option value="away"' + (a.statusOverride === 'away' ? ' selected' : '') + '>🟡 พัก</option>' +
        '<option value="busy"' + (a.statusOverride === 'busy' ? ' selected' : '') + '>🔴 ไม่ว่าง</option>' +
      '</select>' +
      '<button class="btn-mini" data-adedit="' + esc(String(a.id)) + '" title="Role / ช่องทาง / กลุ่มสินค้า / เพดานแชท">✏️ สิทธิ์/ตั้งค่า</button>' +
      '<button class="btn-mini primary" data-adstats="' + esc(String(a.id)) + '">📊 สถิติ</button>' +
    '</div>' +
  '</div>';
}

/* ---------------- modal สิทธิ์/ตั้งค่า ---------------- */

function openSettings(a: Admin, container: HTMLElement): void {
  const groupsVal = String(a.productGroups || '');
  const html =
    '<div class="modal-head">' +
      '<div style="display:flex;gap:12px;align-items:center;min-width:0">' +
        avatarHtml(a.id, a.name, !!a.online) +
        '<div style="min-width:0"><h3>✏️ ' + esc(a.name) + '</h3>' +
        '<div style="margin-top:5px">' + statusBadge(a) + '</div></div>' +
      '</div>' +
      '<button class="modal-close">✕</button>' +
    '</div>' +
    '<div class="hint-box">การตั้งค่านี้เก็บในระบบ dashboard ของเรา (ใช้จัดทีม/กรอง/จัดอันดับ) — ' +
      '<b>ไม่มีผลกับบัญชี Pancake</b> ของแอดมิน • ตารางสิทธิ์ของแต่ละ Role แก้ได้ที่แท็บ 🔐 Role Settings</div>' +
    '<div class="adm-form">' +
      '<label class="adm-field"><span>Role / สิทธิ์</span>' +
        '<select class="input" id="adf-role">' +
          '<option value=""' + (!a.role ? ' selected' : '') + '>— ยังไม่กำหนด —</option>' +
          ADMIN_ROLES.map(function (r) {
            return '<option value="' + esc(r) + '"' + (a.role === r ? ' selected' : '') + '>' + esc(r) + '</option>';
          }).join('') +
        '</select></label>' +
      '<label class="adm-field"><span>ช่องทางที่รับผิดชอบ</span>' +
        '<select class="input" id="adf-channel">' +
          '<option value="both"' + ((a.channels || 'both') === 'both' ? ' selected' : '') + '>📘+🟢 ทั้งสองช่องทาง</option>' +
          '<option value="facebook"' + (a.channels === 'facebook' ? ' selected' : '') + '>📘 Facebook เท่านั้น</option>' +
          '<option value="line"' + (a.channels === 'line' ? ' selected' : '') + '>🟢 LINE เท่านั้น</option>' +
        '</select></label>' +
      '<label class="adm-field" style="grid-column:1/-1"><span>กลุ่มสินค้าที่ดูแล (คั่นด้วย , — เว้นว่าง = ทุกกลุ่ม)</span>' +
        '<input class="input" id="adf-groups" value="' + esc(groupsVal) + '" placeholder="เช่น UN1, UN8">' +
        (allGroups().length
          ? '<div class="pill-grid" id="adf-group-chips" style="margin:6px 0 0">' +
            allGroups().map(function (g) {
              const on = groupsOf(a).indexOf(g) >= 0;
              return '<button type="button" class="filter-btn' + (on ? ' active' : '') +
                '" data-gchip="' + esc(g) + '">' + esc(g) + '</button>';
            }).join('') + '</div>'
          : '') +
      '</label>' +
      '<label class="adm-field"><span>เพดานแชทที่ดูแลพร้อมกัน (ป้าย Capacity)</span>' +
        '<input class="input" id="adf-max" type="number" min="1" max="9999" value="' + esc(String(a.maxActive || DEFAULT_MAX_ACTIVE)) + '"></label>' +
      '<label class="adm-field"><span>เพดานแชทรอตอบ (0 = ไม่กำหนด)</span>' +
        '<input class="input" id="adf-maxpend" type="number" min="0" max="9999" value="' + esc(String(a.maxPending || 0)) + '"></label>' +
      '<label class="adm-field" style="grid-column:1/-1"><span>โน้ต (เห็นเฉพาะทีมเรา)</span>' +
        '<input class="input" id="adf-note" value="' + esc(String(a.note || '')) + '" placeholder="เช่น ถนัดปิดการขาย LINE"></label>' +
    '</div>' +
    '<div class="modal-actions">' +
      '<button class="btn" id="adf-cancel">ยกเลิก</button>' +
      '<button class="btn primary" id="adf-save">💾 บันทึก</button>' +
    '</div>';
  openModal(html);
  const $id = function (id: string) { return document.getElementById(id) as any; };
  const cancel = $id('adf-cancel');
  if (cancel) cancel.addEventListener('click', closeModal);

  // chip กลุ่มสินค้า: คลิกเพื่อเพิ่ม/เอาออกจากช่องกรอก (ช่องกรอกยังพิมพ์เองได้)
  const chipWrap = $id('adf-group-chips');
  if (chipWrap) chipWrap.addEventListener('click', function (e: any) {
    const btn = e.target && e.target.closest ? e.target.closest('[data-gchip]') : null;
    if (!btn) return;
    const g = String(btn.getAttribute('data-gchip') || '');
    const inp = $id('adf-groups');
    if (!g || !inp) return;
    const cur = String(inp.value || '').split(',')
      .map(function (x: string) { return x.trim(); })
      .filter(function (x: string) { return !!x; });
    const idx = cur.indexOf(g);
    if (idx >= 0) cur.splice(idx, 1); else cur.push(g);
    inp.value = cur.join(', ');
    btn.classList.toggle('active', idx < 0);
  });

  const save = $id('adf-save');
  if (save) save.addEventListener('click', function () {
    if (saving) {
      // เช็คก่อนปิดฟอร์ม — ไม่งั้นค่าที่พิมพ์หายหมดทั้งที่ยังไม่ได้บันทึก
      toast('⏳ กำลังบันทึกรายการก่อนหน้า — รอสักครู่แล้วกดบันทึกอีกครั้ง');
      return;
    }
    const before = {
      role: a.role, channels: a.channels, productGroups: a.productGroups,
      maxActive: a.maxActive, maxPending: a.maxPending, note: a.note,
    };
    a.role = String($id('adf-role').value || '');
    a.channels = String($id('adf-channel').value || 'both');
    a.productGroups = String($id('adf-groups').value || '').slice(0, 200);
    let mx = Math.round(Number($id('adf-max').value));
    if (!isFinite(mx) || mx < 1) mx = DEFAULT_MAX_ACTIVE;
    if (mx > 9999) mx = 9999;
    a.maxActive = mx;
    let mp = Math.round(Number($id('adf-maxpend').value));
    if (!isFinite(mp) || mp < 0) mp = 0;
    if (mp > 9999) mp = 9999;
    a.maxPending = mp;
    a.note = String($id('adf-note').value || '').slice(0, 300);
    recomputeLocal(a);
    closeModal();
    renderBody(container);
    saveAdmin(a, {
      role: a.role, channels: a.channels, product_groups: a.productGroups,
      max_active: a.maxActive, max_pending: a.maxPending, note: a.note,
    }, function () { Object.assign(a, before); }, container,
      '💾 บันทึกตั้งค่า "' + String(a.name) + '" แล้ว');
  });
}

/* ---------------- modal สถิติ + timeline ---------------- */

function openStats(a: Admin): void {
  const t = a.today || {};
  const ot = a.onlineToday;
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

  // สิทธิ์ตาม role (จากตาราง Role Settings)
  const rp = (lastData && lastData.rolePerms) || null;
  let rolePermHtml = '—';
  if (a.role && rp && rp[a.role]) {
    const onPerms = Object.keys(PERM_LABELS).filter(function (k) { return rp[a.role as string][k]; });
    rolePermHtml = onPerms.length
      ? '<div class="pill-grid" style="margin-bottom:0">' +
          onPerms.map(function (k) {
            return '<span class="badge ai">' + esc(PERM_LABELS[k].split(' (')[0]) + '</span>';
          }).join('') +
        '</div>'
      : '<span class="badge neutral">ไม่มีสิทธิ์ (ดูอย่างเดียว)</span>';
  }

  // timeline วันนี้: จุดเปลี่ยนออนไลน์ (log จริง) + ออเดอร์ (เวลาจริง)
  type Ev = { ts: number; icon: string; text: string };
  const evs: Ev[] = [];
  if (ot) ot.marks.forEach(function (m) {
    evs.push({ ts: m[0], icon: m[1] ? '🟢' : '⚪', text: m[1] ? 'ออนไลน์' : 'ออฟไลน์' });
  });
  (a.orderMarks || []).forEach(function (m) {
    evs.push({ ts: m[0], icon: '🛒', text: 'ปิดออเดอร์ ' + THB(m[1]) });
  });
  evs.sort(function (x, y) { return y.ts - x.ts; });
  const evHtml = evs.length
    ? '<div style="max-height:30vh;overflow-y:auto">' +
        evs.slice(0, 25).map(function (e) {
          return '<div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px dashed rgba(38,51,82,.5);font-size:12.5px">' +
            '<span>' + e.icon + '</span>' +
            '<span style="flex:1;color:var(--text-2)">' + esc(e.text) + '</span>' +
            '<span style="color:var(--text-3)">' + esc(hhmm(e.ts)) + ' น.</span></div>';
        }).join('') +
      '</div>'
    : '<div class="empty-note" style="padding:14px">🕐 ยังไม่มีเหตุการณ์วันนี้' +
      (ot ? '' : ' (ระบบเพิ่งเริ่มเก็บประวัติออนไลน์ — จะแสดงตั้งแต่วันแรกที่มีข้อมูล)') + '</div>';

  const html =
    '<div class="modal-head">' +
      '<div style="display:flex;gap:12px;align-items:center;min-width:0">' +
        avatarHtml(a.id, a.name, !!a.online) +
        '<div style="min-width:0">' +
          '<h3>' + esc(a.name) + '</h3>' +
          '<div style="margin-top:5px;display:flex;gap:6px;flex-wrap:wrap">' + statusBadge(a) +
            (a.role ? '<span class="badge brand">' + esc(a.role) + '</span>' : '') +
            (function () {
              const sc = scoreOf(a);
              return sc === null ? '' :
                '<span class="badge brand" title="คะแนน Overall จากตัวเลขวันนี้ — เกณฑ์ชุดเดียวกับหน้า Admin Performance (ปรับได้ที่นั่น)">⭐ ' +
                esc(String(sc)) + '</span>';
            })() +
          '</div>' +
        '</div>' +
      '</div>' +
      '<button class="modal-close">✕</button>' +
    '</div>' +
    detailRow('อีเมล', esc(a.email || '-')) +
    detailRow('แผนก', esc(a.department || '—')) +
    detailRow('กลุ่มขาย (POS)', esc(a.saleGroup || '—')) +
    detailRow('กลุ่มสินค้า (ตั้งเอง)', esc(a.productGroups || 'ทุกกลุ่ม')) +
    detailRow('ช่องทาง', esc(CH_LABEL[String(a.channels || 'both')] || 'ทั้งสอง')) +
    (a.note ? detailRow('โน้ต', esc(a.note)) : '') +
    detailRow('เพจที่ดูแล (' + fmtNum(a.pageCount || 0) + ')', pagesHtml) +
    detailRow('สิทธิ์จริงใน Pancake', permsHtml) +
    (a.role ? detailRow('สิทธิ์ตาม Role (ทะเบียนเรา)', rolePermHtml) : '') +
    '<div style="margin:16px 0 10px;font-weight:700;font-size:13px">📊 สถิติวันนี้ (ข้อมูลจริง)</div>' +
    '<div class="page-stats">' +
      cellHtml(fmtNum(t.replies || 0), 'ตอบ', '') +
      cellHtml(fmtNum(t.chats || 0), 'แชท', '') +
      cellHtml(fmtNum(t.phones || 0), 'เบอร์โทร', '') +
      cellHtml(fmtNum(t.orders || 0), 'ออเดอร์', '') +
      cellHtml(esc(THB(t.revenue || 0)), 'ยอดขาย', '') +
    '</div>' +
    '<div class="page-stats" style="margin-top:8px;grid-template-columns:repeat(3,1fr)">' +
      cellHtml(esc(respFmt(t.respMins)), 'ตอบเฉลี่ย', '') +
      cellHtml(
        (t.respMinMins !== null && t.respMinMins !== undefined)
          ? esc(respFmt(t.respMinMins) + ' / ' + respFmt(t.respMaxMins)) : '—',
        'เร็วสุด/ช้าสุด (รายเพจ)', '') +
      cellHtml(lastOnlineStr(a), 'Online ล่าสุด', '') +
    '</div>' +
    '<div class="page-stats" style="margin-top:8px;grid-template-columns:repeat(2,1fr)">' +
      cellHtml(ot ? esc(hrsFmt(ot.mins)) : '—', 'ออนไลน์รวมวันนี้', '') +
      cellHtml(ot && ot.gapMins ? esc(hrsFmt(ot.gapMins)) : '—', 'หายนานสุด',
        ot && ot.gapMins && ot.gapMins > 45 ? 'warn' : '') +
    '</div>' +
    '<div style="margin:16px 0 8px;font-weight:700;font-size:13px">🕐 Timeline วันนี้</div>' +
    evHtml +
    '<div class="modal-actions">' +
      '<button class="btn" id="adm-dt-close">ปิด</button>' +
    '</div>';
  openModal(html);
  const b = document.getElementById('adm-dt-close');
  if (b) b.addEventListener('click', closeModal);
}

/* ---------------- Role Settings tab ---------------- */

function rolesTabHtml(): string {
  const rp = (lastData && lastData.rolePerms) || ({} as RolePerms);
  const rows = Object.keys(PERM_LABELS).map(function (perm) {
    return '<tr><td style="min-width:230px">' + esc(PERM_LABELS[perm]) + '</td>' +
      ADMIN_ROLES.map(function (role) {
        const checked = rp[role] && rp[role][perm];
        return '<td style="text-align:center"><input type="checkbox" class="perm-cb" data-role="' +
          esc(role) + '" data-perm="' + esc(perm) + '"' + (checked ? ' checked' : '') +
          (role === 'Disabled' ? ' disabled' : '') + '></td>';
      }).join('') +
    '</tr>';
  }).join('');
  return '<div class="card">' +
    '<h3>🔐 Role & Permission Settings</h3>' +
    '<div class="card-sub">ติ๊ก = role นั้นทำได้ — บันทึกอัตโนมัติ • เป็น "ทะเบียนทีม" ใน dashboard ' +
      '(ใช้แสดงผล/รายงาน — เว็บยังเข้าด้วยรหัสทีมเดียว และไม่มีผลกับ Pancake)</div>' +
    '<div class="table-scroll"><table class="tbl" style="min-width:880px"><thead><tr>' +
      '<th>สิทธิ์</th>' +
      ADMIN_ROLES.map(function (r) { return '<th style="white-space:normal;text-align:center">' + esc(r) + '</th>'; }).join('') +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
  '</div>';
}

let roleSaveTimer: ReturnType<typeof setTimeout> | null = null;
let roleSaving = false;

function saveRolePerms(): void {
  if (roleSaveTimer) clearTimeout(roleSaveTimer);
  roleSaveTimer = setTimeout(function () {
    roleSaveTimer = null; // เคลียร์ handle — ตัวเช็คใน fetchData จะได้ไม่ค้าง
    const rp = (lastData && lastData.rolePerms) || null;
    if (!rp) return;
    roleSaving = true;
    serverCall<any>('apiAdminSettings', { rolePerms: rp }).then(function (res) {
      roleSaving = false;
      if (res && res.ok) toast('💾 บันทึกตารางสิทธิ์แล้ว');
      else toast('⚠️ บันทึกตารางสิทธิ์ไม่สำเร็จ' + ((res && res.error) ? ': ' + res.error : ''));
    }).catch(function () {
      roleSaving = false;
      toast('⚠️ บันทึกตารางสิทธิ์ไม่สำเร็จ — เครือข่ายมีปัญหา');
    });
  }, 600);
}

/* ---------------- export CSV ---------------- */

function exportCsv(): void {
  const list = getFiltered();
  if (!list.length) {
    toast('👥 ไม่มีข้อมูลแอดมินให้ Export');
    return;
  }
  const rows: unknown[][] = [[
    'ชื่อ', 'อีเมล', 'Role', 'เปิดใช้งาน', 'สถานะ', 'ช่องทาง', 'กลุ่มสินค้า', 'แผนก', 'กลุ่มขาย', 'เพจ',
    'ตอบวันนี้', 'แชทดูแล(24ชม.)', 'เพดาน', 'รอตอบ', 'เพดานรอตอบ', 'เกิน SLA', 'ตอบเฉลี่ย(นาที)',
    'ออเดอร์วันนี้', 'ยอดขายวันนี้', 'คะแนน Overall (วันนี้)', 'ออนไลน์วันนี้(นาที)', 'หายนานสุด(นาที)', 'โน้ต'
  ]];
  list.forEach(function (a) {
    const t = a.today || {};
    const st = ADMIN_STATUS_META[statusOf(a)] || ADMIN_STATUS_META.offline;
    const ot = a.onlineToday;
    const sc = scoreOf(a);
    rows.push([
      a.name || '', a.email || '', a.role || '', a.enabled !== false ? 'ใช่' : 'ไม่',
      st.label.replace(/^[^ ]+ /, ''), a.channels || 'both', a.productGroups || '', a.department || '',
      a.saleGroup || '', a.pages || '',
      t.replies || 0, Number(a.active) || 0, Number(a.maxActive) || DEFAULT_MAX_ACTIVE, Number(a.waiting) || 0,
      Number(a.maxPending) || 0, Number(a.overSla) || 0,
      (t.respMins === null || t.respMins === undefined) ? '' : t.respMins,
      t.orders || 0, t.revenue || 0, sc === null ? '' : sc,
      ot ? ot.mins : '', ot && ot.gapMins ? ot.gapMins : '', a.note || ''
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

/** วาดเฉพาะส่วนใต้ tab (กรอง/กริด หรือ ตารางสิทธิ์) — ใช้หลัง action ที่ไม่แตะ KPI */
function renderBody(container: HTMLElement): void {
  if (tab === 'cards') renderGrid(container);
  else {
    const wrap = container.querySelector('#adm-grid-wrap');
    if (wrap) wrap.innerHTML = rolesTabHtml();
  }
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
  const overSlaTotal = Number(k.overSlaTotal) || 0;
  const slaMins = Number(d.slaMins) || 60;
  const disabledN = Number(k.disabled) || 0;
  const fullN = Number(k.fullCap) || 0;
  const groups = allGroups();
  if (filter.group && groups.indexOf(filter.group) < 0) filter.group = '';

  const controls = tab !== 'cards' ? '' :
      '<input class="input" id="adm-q" type="text" placeholder="🔍 ค้นหาชื่อแอดมิน..." ' +
        'value="' + esc(filter.q) + '" style="min-width:190px">' +
      '<select class="input" id="adm-status">' +
        '<option value=""' + (filter.status === '' ? ' selected' : '') + '>ทุกสถานะ</option>' +
        '<option value="online"' + (filter.status === 'online' ? ' selected' : '') + '>🟢 ออนไลน์</option>' +
        '<option value="away"' + (filter.status === 'away' ? ' selected' : '') + '>🟡 พัก</option>' +
        '<option value="busy"' + (filter.status === 'busy' ? ' selected' : '') + '>🔴 ไม่ว่าง</option>' +
        '<option value="offline"' + (filter.status === 'offline' ? ' selected' : '') + '>⚪ ออฟไลน์</option>' +
        '<option value="disabled"' + (filter.status === 'disabled' ? ' selected' : '') + '>⛔ ปิดใช้งาน</option>' +
      '</select>' +
      '<select class="input" id="adm-role">' +
        '<option value=""' + (filter.role === '' ? ' selected' : '') + '>ทุก Role</option>' +
        ADMIN_ROLES.map(function (r) {
          return '<option value="' + esc(r) + '"' + (filter.role === r ? ' selected' : '') + '>' + esc(r) + '</option>';
        }).join('') +
      '</select>' +
      '<select class="input" id="adm-dept">' +
        '<option value=""' + (filter.dept === '' ? ' selected' : '') + '>ทุกแผนก</option>' +
        depts.map(function (dep) {
          return '<option value="' + esc(dep) + '"' + (filter.dept === dep ? ' selected' : '') + '>' +
            esc(dep) + '</option>';
        }).join('') +
      '</select>' +
      '<select class="input" id="adm-channel">' +
        '<option value=""' + (filter.channel === '' ? ' selected' : '') + '>ทุกช่องทาง</option>' +
        '<option value="facebook"' + (filter.channel === 'facebook' ? ' selected' : '') + '>📘 Facebook</option>' +
        '<option value="line"' + (filter.channel === 'line' ? ' selected' : '') + '>🟢 LINE</option>' +
      '</select>' +
      (groups.length
        ? '<select class="input" id="adm-group">' +
          '<option value=""' + (filter.group === '' ? ' selected' : '') + '>ทุกกลุ่มสินค้า</option>' +
          groups.map(function (g) {
            return '<option value="' + esc(g) + '"' + (filter.group === g ? ' selected' : '') + '>📦 ' +
              esc(g) + '</option>';
          }).join('') +
          '</select>'
        : '') +
      '<select class="input" id="adm-cap">' +
        '<option value=""' + (filter.cap === '' ? ' selected' : '') + '>Capacity: ทั้งหมด</option>' +
        '<option value="available"' + (filter.cap === 'available' ? ' selected' : '') + '>ว่างรับแชท</option>' +
        '<option value="near"' + (filter.cap === 'near' ? ' selected' : '') + '>ใกล้เต็ม</option>' +
        '<option value="full"' + (filter.cap === 'full' ? ' selected' : '') + '>เต็มแล้ว</option>' +
        '<option value="slow"' + (filter.cap === 'slow' ? ' selected' : '') + '>ตอบช้า (>8 นาที)</option>' +
      '</select>' +
      '<div class="spacer"></div>' +
      '<button class="btn" id="adm-sla" title="แชทที่ลูกค้ารอเกินกี่นาทีถือว่าเกิน SLA (ใช้ร่วมกับหน้า Admin Performance)">⏰ SLA ' + slaMins + ' น.</button>' +
      '<button class="btn" id="adm-export">📄 Export CSV</button>';

  const html =
    (d.setupNeeded
      ? '<div class="hint-box" style="border-left-color:var(--amber)">⚠️ <b>ตารางตั้งค่ายังไม่ถูกสร้างใน Supabase</b> — ' +
        'ปุ่มปิดใช้งาน/สถานะ/ตั้งค่าจะยังบันทึกไม่ได้ และสถิติออนไลน์ยังไม่เริ่มเก็บ ' +
        '(รัน SQL migration ตามที่แชทแจ้ง แล้วทุกอย่างจะทำงานอัตโนมัติ)</div>'
      : '') +
    '<div class="pg-summary">' +
      pgsItem(fmtNum(k.total || 0), 'แอดมินทั้งหมด', '') +
      pgsItem(fmtNum(k.online || 0), 'ออนไลน์', 'ok') +
      pgsItem(fmtNum(k.away || 0), 'พัก/ไม่ว่าง', '') +
      pgsItem(fmtNum(k.offline || 0), 'ออฟไลน์', '') +
      pgsItem(fmtNum(disabledN), 'ปิดใช้งาน', disabledN > 0 ? 'warn' : '') +
      pgsItem(fmtNum(fullN), 'เต็ม Capacity', fullN > 0 ? 'warn' : '') +
      pgsItem(fmtNum(k.withSalesToday || 0), 'มียอดขายวันนี้', 'ok') +
      pgsItem(fmtNum(k.activeTotal || 0), 'แชทที่ดูแลรวม (24ชม.)', '') +
      pgsItem(fmtNum(waitingTotal), 'แชทรอตอบรวม', waitingTotal > 0 ? 'warn' : '') +
      pgsItem(fmtNum(overSlaTotal), 'เกิน SLA ' + slaMins + ' น.', overSlaTotal > 0 ? 'warn' : '') +
      pgsItem(fmtNum(k.phonesToday || 0), 'เบอร์โทรวันนี้', '') +
    '</div>' +

    '<div class="pg-controls">' +
      '<button class="btn' + (tab === 'cards' ? ' primary' : '') + '" id="adm-tab-cards">👥 แอดมิน</button>' +
      '<button class="btn' + (tab === 'roles' ? ' primary' : '') + '" id="adm-tab-roles">🔐 Role Settings</button>' +
      controls +
    '</div>' +

    '<div id="adm-grid-wrap"></div>';

  container.innerHTML = html;
  renderBody(container);
  bindEvents(container);
}

/* ---------------- events ---------------- */

function bindEvents(container: HTMLElement): void {
  const tabCards = container.querySelector('#adm-tab-cards');
  if (tabCards) tabCards.addEventListener('click', function () {
    if (tab === 'cards') return;
    tab = 'cards';
    render(container);
  });
  const tabRoles = container.querySelector('#adm-tab-roles');
  if (tabRoles) tabRoles.addEventListener('click', function () {
    if (tab === 'roles') return;
    tab = 'roles';
    render(container);
  });

  const q = container.querySelector('#adm-q') as HTMLInputElement | null;
  if (q) q.addEventListener('input', function () {
    filter.q = q.value;
    renderGrid(container);
  });

  const selMap: [string, keyof typeof filter][] = [
    ['#adm-status', 'status'], ['#adm-role', 'role'], ['#adm-dept', 'dept'],
    ['#adm-channel', 'channel'], ['#adm-group', 'group'], ['#adm-cap', 'cap'],
  ];
  selMap.forEach(function (pair) {
    const el = container.querySelector(pair[0]) as HTMLSelectElement | null;
    if (el) el.addEventListener('change', function () {
      filter[pair[1]] = el.value;
      renderGrid(container);
    });
  });

  const ex = container.querySelector('#adm-export');
  if (ex) ex.addEventListener('click', exportCsv);

  const slaBtn = container.querySelector('#adm-sla');
  if (slaBtn) slaBtn.addEventListener('click', function () { openSlaEditor(container); });

  const wrap = container.querySelector('#adm-grid-wrap');
  if (!wrap) return;

  // คลิกปุ่มบนการ์ด (delegation — การ์ดถูกวาดใหม่บ่อย)
  wrap.addEventListener('click', function (e) {
    let el = e.target as any;
    while (el && el !== wrap) {
      if (el.getAttribute) {
        const idToggle = el.getAttribute('data-adtoggle');
        if (idToggle !== null) {
          const a = findAdmin(idToggle);
          if (a) {
            const before = { enabled: a.enabled, statusOverride: a.statusOverride };
            a.enabled = !(a.enabled !== false);
            if (!a.enabled) a.statusOverride = '';
            recomputeLocal(a);
            renderBody(container);
            saveAdmin(a, { enabled: a.enabled, status_override: String(a.statusOverride || '') },
              function () { Object.assign(a, before); }, container,
              (a.enabled ? '▶ เปิด' : '⏸ ปิด') + 'ใช้งาน "' + String(a.name) + '" แล้ว');
          }
          return;
        }
        const idEdit = el.getAttribute('data-adedit');
        if (idEdit !== null) {
          const a = findAdmin(idEdit);
          if (a) openSettings(a, container);
          return;
        }
        const idStats = el.getAttribute('data-adstats');
        if (idStats !== null) {
          const a = findAdmin(idStats);
          if (a) openStats(a);
          return;
        }
      }
      el = el.parentNode;
    }
  });

  // เปลี่ยนสถานะ override + ติ๊กตารางสิทธิ์ (delegation ผ่าน event change)
  wrap.addEventListener('change', function (e) {
    const el = e.target as any;
    if (!el || !el.getAttribute) return;
    const idStatus = el.getAttribute('data-adstatus');
    if (idStatus !== null) {
      const a = findAdmin(idStatus);
      if (!a) return;
      const before = { statusOverride: a.statusOverride };
      a.statusOverride = String(el.value || '');
      recomputeLocal(a);
      renderBody(container);
      const st = ADMIN_STATUS_META[statusOf(a)] || ADMIN_STATUS_META.offline;
      saveAdmin(a, { status_override: String(a.statusOverride || '') },
        function () { Object.assign(a, before); }, container,
        'เปลี่ยนสถานะ "' + String(a.name) + '" → ' + st.label);
      return;
    }
    if (el.classList && el.classList.contains('perm-cb')) {
      const role = el.getAttribute('data-role');
      const perm = el.getAttribute('data-perm');
      const rp = (lastData && lastData.rolePerms) || null;
      if (rp && role && perm && rp[role]) {
        rp[role][perm] = !!el.checked;
        dataSeq++; // แก้ matrix ใน state แล้ว — กัน refetch เก่ามาทับก่อน save
        saveRolePerms();
      }
    }
  });
}

/* ---------------- modal ตั้งเกณฑ์ SLA (เก็บใน app_settings — ใช้ร่วมทั้งทีม/ทุกหน้า) ---------------- */

function openSlaEditor(container: HTMLElement): void {
  const cur = Number(lastData && lastData.slaMins) || 60;
  openModal(
    '<div class="modal-head"><h3>⏰ ตั้งเกณฑ์ SLA แชทรอตอบ</h3>' +
      '<button class="modal-close">✕</button></div>' +
    '<div style="font-size:12.5px;color:var(--text-2);margin-bottom:12px">' +
      'แชทที่ลูกค้ารอนานเกินกี่นาทีถือว่า <b>เกิน SLA</b> — เป็นค่า proxy จากเวลาข้อความล่าสุด ' +
      '(Pancake ไม่ส่ง event รายข้อความ) • ใช้เกณฑ์เดียวกันที่หน้า Admin Performance ด้วย</div>' +
    '<div style="display:flex;align-items:center;gap:8px">' +
      '<input type="number" class="input" id="sla-input" min="5" max="1440" step="5" value="' + cur +
        '" style="width:110px"><span>นาที</span>' +
    '</div>' +
    '<div class="modal-actions">' +
      '<button class="btn" id="sla-cancel">ยกเลิก</button>' +
      '<button class="btn primary" id="sla-save">💾 บันทึก</button>' +
    '</div>'
  );
  const root = document.getElementById('modal-root')!;
  const cancel = root.querySelector('#sla-cancel');
  if (cancel) cancel.addEventListener('click', closeModal);
  const save = root.querySelector('#sla-save') as HTMLButtonElement | null;
  if (save) save.addEventListener('click', function () {
    const inp = root.querySelector('#sla-input') as HTMLInputElement | null;
    const v = inp ? Math.round(Number(inp.value)) : NaN;
    if (!isFinite(v) || v < 5 || v > 1440) { toast('⚠️ เกณฑ์ SLA ต้องอยู่ระหว่าง 5-1440 นาที'); return; }
    save.disabled = true;
    serverCall('apiAppSettings', { settings: { slaMins: v } }).then(function () {
      closeModal();
      toast('💾 ตั้งเกณฑ์ SLA ' + v + ' นาทีแล้ว — กำลังคำนวณใหม่...');
      dataSeq++; // กัน refetch เบื้องหลังเก่ามาทับ
      container.innerHTML = adminsSkel();
      fetchData(container, false); // ให้ server นับ "เกิน SLA" ด้วยเกณฑ์ใหม่
    }).catch(function () {
      save.disabled = false;
      toast('⚠️ บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง');
    });
  });
}

/* ---------------- fetch ---------------- */

function fetchData(container: HTMLElement, silent: boolean): void {
  const seqAtStart = dataSeq;
  serverCall<AdminsData>('apiAdmins').then(function (data) {
    if (silent) {
      // refetch เบื้องหลัง: ห้ามทับ state ถ้า (ก) ผู้ใช้เพิ่งแก้อะไรไป (ข้อมูลที่ได้มาเก่ากว่า)
      // (ข) มี save ค้างอยู่ (ค) modal เปิดอยู่ (ปิด modal ทิ้งกลางคันไม่ได้ — ถือ object เดิมอยู่)
      const modalRoot = document.getElementById('modal-root');
      const busy = dataSeq !== seqAtStart || saving || roleSaving || roleSaveTimer !== null ||
        !!(modalRoot && modalRoot.innerHTML);
      if (busy) return;
    }
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
    await loadScoreCfg(); // เกณฑ์คะแนน Overall (โหลดครั้งเดียว — ใช้ใน stats modal + CSV)
    if (lastData && !force) {
      render(container);
      fetchData(container, true); /* อัปเดตเบื้องหลัง */
    } else {
      container.innerHTML = adminsSkel();
      fetchData(container, false);
    }
  },
};
