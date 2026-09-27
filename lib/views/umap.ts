/* ============================================================
   umap — หน้า "จับคู่ยูนิต" (แอดมินอยู่ยูนิตไหน)
   หน้าอ้างอิงกันลืม สไตล์ "เกมจับคู่": คลิกเลือกแอดมินฝั่งซ้าย
   แล้วคลิกการ์ดยูนิตฝั่งขวาเพื่อจับคู่ — ข้อมูลเก็บใน DB (sync_state)
   มี API สาธารณะ /api/public/umap ให้ระบบภายนอกดึงไปใช้
   (เกม "ทดสอบความจำ" เอาออกแล้ว — พีสั่ง 27 ก.ย. 69 ไม่มีใครใช้)

   ตรวจ UI รอบ 3 (26 ก.ย. 69)
   - F4: ลบยูนิตใช้กล่องยืนยันของเว็บ (ปุ่มแดง "ลบยูนิต Uxx") · ปุ่มบันทึกขึ้น "กำลังบันทึก…" และรอผลจริงก่อนปิด
         ข้อผิดพลาดของฟอร์มขึ้นใต้ช่องนั้น · เอาแอดมินออกจากยูนิต = ทำทันที + "เลิกทำ"
         คัดลอกลิงก์ไม่ได้ → แผ่นที่มีช่องลิงก์ + ปุ่มคัดลอก (copyText) แทน window.prompt
   - D2: "U" ที่เป็นคำนาม → "ยูนิต" (รหัสอย่าง U4 / UN8 คงเดิม) · ไม่มีคำช่าง (sync / API) บนจอ
   ============================================================ */

import {
  serverCall, esc, dash, relTime, showError, toast, undoToast, withBusy, confirmDialog, copyText, stateHtml,
  openModal, closeModal, modalCloseBtn, tagColor,
} from '@/lib/ui/helpers';
import { umapSkel } from '@/lib/ui/skeletons';
import { icon, brandIcon, ICON_FOR } from '@/lib/ui/icons';

/* ---------------- data types (apiUMap) ---------------- */

interface UMember { id: string; name: string }
interface UPage { id: string; name: string; platform?: string }
interface UUnit { u: string; product: string; admins: UMember[]; pages: UMember[] }
interface UMapData {
  ok?: boolean;
  error?: string;
  units?: UUnit[];
  roster?: UMember[];
  pageRoster?: UPage[]; // รายชื่อเพจทั้งหมด ให้จับคู่เพจ→U
  updatedAt?: string;
  publicNeedsKey?: boolean; // server ตั้ง UMAP_PUBLIC_KEY ไว้ → ลิงก์สาธารณะต้องแนบ ?key=
}

/* ---------------- closure state ---------------- */

let lastData: UMapData | null = null;
let selected: UMember | null = null;  // แอดมินที่ถูกเลือกไว้รอจับคู่
let search = '';                      // ค้นหาแอดมินฝั่งซ้าย
let reqSeq = 0;                       // กันผลลัพธ์เก่ามาทับผลลัพธ์ใหม่
let saving = false;                   // มีคำสั่งกำลังยิงอยู่ (คิวกำลังไหล)
// คิว FIFO ของคำสั่งแก้ข้อมูล — hint บอกว่า "คลิกได้หลายการ์ดติดกัน" ดังนั้นคลิกระหว่าง
// รอ server ต้องเข้าคิวยิงตามลำดับ ไม่ใช่ถูกทิ้งเงียบๆ (server ~1-3 วิ/คำสั่ง)
// onOk / onErr = ให้คนสั่งรู้ผล (ฟอร์มที่รอผลจริงก่อนปิด / แถบเลิกทำ) · มี onErr = ไม่ขึ้นข้อความเด้งเอง
interface Job {
  params: Record<string, unknown>;
  okMsg: string;
  onOk?: () => void;
  onErr?: (msg: string) => void;
}
const pending: Job[] = [];
/** คำสั่งที่กำลังยิงอยู่ (ออกจากคิวแล้ว) — ใช้กันแตะการ์ดซ้ำระหว่างรอผล */
let inFlightSig = '';

/** ผู้ดูแลระบบเท่านั้นที่เห็นรายละเอียดเทคนิค — page.tsx ใส่ data-role ไว้ที่ #app */
function isSuperadmin(): boolean {
  const app = document.getElementById('app');
  return !!app && app.dataset.role === 'superadmin';
}

/** เดสก์ท็อปเท่านั้นที่โฟกัสช่องกรอกให้เอง — มือถือโฟกัสแล้วแป้นพิมพ์เด้งบังฟอร์มทันที */
const autoFocusAttr = () => (window.matchMedia('(min-width: 900px)').matches ? ' data-autofocus' : '');

/* ---------------- ชิ้นส่วน HTML ---------------- */

/** จำนวนยูนิตที่แอดมินแต่ละคนถืออยู่ (id → จำนวน) */
function unitCountByAdmin_(units: UUnit[]): Map<string, number> {
  const m = new Map<string, number>();
  units.forEach((x) => x.admins.forEach((a) => m.set(a.id, (m.get(a.id) || 0) + 1)));
  return m;
}

/** C4 แถวเครื่องมือ: ค้นหาแอดมิน → ปุ่มสร้าง/เกม · ขวาสุด = คัดลอกลิงก์ข้อมูล (ตำแหน่งเดียวกับปุ่มดาวน์โหลดหน้าอื่น) */
function toolbarHtml(): string {
  return '<div class="toolbar umap-tb">' +
    '<div class="tb-filters umap-filters">' +
      // ขนาดช่องค้นหาตั้งที่กรอบ .search-box (แว่นขยายวาดซ้อนในกรอบ เพราะ placeholder ใส่รูปไม่ได้)
      '<div class="search-box umap-search">' + icon(ICON_FOR.search) +
        '<input class="input" id="u-search" placeholder="ค้นหาแอดมิน..." aria-label="ค้นหาแอดมิน" value="' + esc(search) + '">' +
      '</div>' +
      '<button type="button" class="btn primary" id="u-add">' + icon(ICON_FOR.add) + 'เพิ่มยูนิต</button>' +
    '</div>' +
    '<div class="tb-actions">' +
      '<button type="button" class="btn" id="u-api" title="ลิงก์ให้ระบบอื่นดึงรายการจับคู่ยูนิตไปใช้">' + icon(ICON_FOR.link) + 'คัดลอกลิงก์ข้อมูล</button>' +
    '</div>' +
  '</div>';
}

/** id แอดมินที่ยังทำงานอยู่จริง (อยู่ใน roster) — ใช้แยก "แอดมินผี" ที่ถูกปิด/ออกไปแล้ว */
function rosterIds_(roster: UMember[]): Set<string> {
  return new Set(roster.map((a) => a.id));
}

function statsHtml(units: UUnit[], roster: UMember[]): string {
  const ids = rosterIds_(roster);
  // นับเฉพาะแอดมินที่ยังทำงานอยู่ — คนที่ถูกปิดใช้งาน/ออกแล้วไม่ถือว่า "ประจำ"
  // (ถ้า roster ว่าง = ข้อมูลรายชื่อยังไม่มา ตรวจไม่ได้ ให้นับตามที่บันทึกไว้)
  const isActive = (m: UMember) => !roster.length || ids.has(m.id);
  const withAdmin = units.filter((x) => x.admins.some(isActive)).length;
  const assigned = new Set<string>();
  units.forEach((x) => x.admins.forEach((a) => assigned.add(a.id)));
  const freeAdmins = roster.filter((a) => !assigned.has(a.id)).length;
  const pagesMapped = units.reduce((s, x) => s + (x.pages || []).length, 0);
  const totalPages = (lastData && lastData.pageRoster || []).length;
  return '<div class="umap-stats">' +
    '<div class="tile">ยูนิตทั้งหมด<b>' + units.length + '</b></div>' +
    '<div class="tile">มีแอดมินประจำแล้ว<b>' + withAdmin + ' / ' + units.length + ' ยูนิต</b></div>' +
    '<div class="tile">แอดมินที่ยังไม่มียูนิต<b>' + freeAdmins + ' คน</b></div>' +
    '<div class="tile" title="ใช้จัดกลุ่มยอดขายตามยูนิตในหน้ายอดขาย">เพจจับคู่แล้ว<b>' +
      pagesMapped + (totalPages ? ' / ' + totalPages : '') + ' เพจ</b></div>' +
    '</div>';
}

function hintHtml(): string {
  if (!selected) return '';
  return '<div class="umap-hint" role="status">' + icon('mouse-pointer-click') + ' กำลังจับคู่: <b>' + esc(selected.name) + '</b>' +
    ' — เลือกการ์ดยูนิตที่จะวางลง (เลือกได้หลายการ์ดติดกัน)' +
    '<button type="button" class="btn-mini umap-cancel" id="u-cancel-sel">' + icon(ICON_FOR.close) + 'เลิกเลือก</button></div>';
}

function adminListHtml(units: UUnit[], roster: UMember[]): string {
  const counts = unitCountByAdmin_(units);
  const q = search.trim().toLowerCase();
  const list = q ? roster.filter((a) => a.name.toLowerCase().includes(q)) : roster;
  if (!roster.length) {
    return stateHtml('wait', { title: 'ยังไม่มีรายชื่อแอดมิน', body: 'รอข้อมูลรอบถัดไปจาก Pancake' });
  }
  if (!list.length) return '<div class="empty-note">ไม่พบแอดมินชื่อ "' + esc(search) + '"</div>';
  return list.map((a) => {
    const n = counts.get(a.id) || 0;
    const sel = !!selected && selected.id === a.id;
    // aria-pressed = บอกโปรแกรมอ่านหน้าจอว่าคนนี้ถูกเลือกรอจับคู่อยู่ (F5)
    return '<button type="button" class="admin-pick' + (sel ? ' selected' : '') + '" data-id="' + esc(a.id) + '"' +
      ' aria-pressed="' + (sel ? 'true' : 'false') + '">' +
      '<span class="pdot" style="background:' + tagColor(a.name) + '"></span>' +
      '<span class="nm">' + esc(a.name) + '</span>' +
      (n > 0
        ? '<span class="cnt">' + n + ' ยูนิต</span>'
        : '<span class="cnt none">ยังไม่มียูนิต</span>') +
      '</button>';
  }).join('');
}

function memberChip_(u: string, m: UMember, ghost: boolean): string {
  // ปุ่มกากบาทเป็นไอคอนล้วน — ชื่อปุ่มบอกชัดว่า "เอา … ออกจาก …" (เดิมเป็น <span> กด Tab ไม่ถึง)
  return '<span class="u-member' + (ghost ? ' ghost" title="ไม่อยู่ในรายชื่อแอดมินแล้ว (ถูกปิดใช้งาน/ออก) — กดกากบาทเพื่อเอาออก' : '') + '">' +
    '<span class="pdot" style="background:' + tagColor(m.name) + '"></span>' +
    (ghost ? '<span class="tx-bad">' + icon('ban', { size: 12, label: 'ออกแล้ว' }) + '</span> ' : '') + esc(m.name) +
    '<button type="button" class="x" data-u="' + esc(u) + '" data-id="' + esc(m.id) + '"' +
      ' aria-label="' + esc('เอา ' + m.name + ' ออกจาก ' + u) + '" title="' + esc('เอา ' + m.name + ' ออกจาก ' + u) + '">' +
      icon(ICON_FOR.close, { size: 12 }) + '</button>' +
    '</span>';
}

function uCardHtml(x: UUnit, ids: Set<string>, hasRoster: boolean): string {
  const droppable = !!selected && !x.admins.some((m) => m.id === selected!.id);
  const members = x.admins.length
    ? x.admins.map((m) => memberChip_(x.u, m, hasRoster && !ids.has(m.id))).join('')
    : '<span class="u-empty">ยังว่าง — ไม่มีแอดมินประจำ</span>';
  const nPages = (x.pages || []).length;
  return '<div class="u-card' + (droppable ? ' droppable' : '') + '" data-u="' + esc(x.u) + '">' +
    // ปุ่มมุมการ์ดมีแต่ไอคอน (ใส่คำไม่พอที่ — จะไปทับรหัสยูนิตตัวใหญ่) จึงต้องมี aria-label + title ครบ
    '<div class="u-tools">' +
      '<button type="button" class="u-tool-btn btn-icon" data-act="edit" data-u="' + esc(x.u) + '" aria-label="แก้ชื่อผลิตภัณฑ์ของ ' + esc(x.u) +
        '" title="แก้ชื่อผลิตภัณฑ์">' + icon(ICON_FOR.edit, { size: 14 }) + '</button>' +
      '<button type="button" class="u-tool-btn btn-icon danger" data-act="del" data-u="' + esc(x.u) + '" aria-label="ลบยูนิต ' + esc(x.u) +
        '" title="ลบยูนิตนี้">' + icon(ICON_FOR.delete, { size: 14 }) + '</button>' +
    '</div>' +
    '<div class="u-code">' + esc(x.u) + '</div>' +
    '<div class="u-product">' + (x.product ? esc(x.product) : dash()) + '</div>' +
    '<div class="u-members">' + members + '</div>' +
    '<button type="button" class="u-pages-btn" data-act="pages" data-u="' + esc(x.u) + '" title="จับคู่เพจของยูนิตนี้ (ใช้จัดกลุ่มยอดขาย)">' +
      icon(ICON_FOR.page, { size: 14 }) + ' ' + (nPages ? nPages + ' เพจ' : 'ยังไม่จับคู่เพจ') + ' • จัดการ' +
    '</button>' +
    '</div>';
}

function boardHtml(units: UUnit[], roster: UMember[]): string {
  if (!units.length) {
    return '<div class="card">' + stateHtml('nodata', {
      title: 'ยังไม่มียูนิต',
      body: 'กดปุ่ม “เพิ่มยูนิต” ด้านบนเพื่อเริ่มต้น',
    }) + '</div>';
  }
  const ids = rosterIds_(roster);
  return '<div class="u-grid">' +
    units.map((x) => uCardHtml(x, ids, roster.length > 0)).join('') + '</div>';
}

function bodyHtml(data: UMapData): string {
  const units = data.units || [];
  const roster = data.roster || [];
  return toolbarHtml() +
    statsHtml(units, roster) +
    hintHtml() +
    '<div class="umap-layout">' +
      '<div class="card umap-side">' +
        '<h3>แอดมิน (' + roster.length + ')</h3>' +
        '<div class="card-sub">เลือกแอดมิน แล้วเลือกการ์ดยูนิตเพื่อจับคู่</div>' +
        '<div id="u-admin-list" class="u-admin-list">' + adminListHtml(units, roster) + '</div>' +
        '<div class="umap-upd">อัปเดตล่าสุด ' + esc(relTime(data.updatedAt)) + '</div>' +
      '</div>' +
      '<div id="u-board">' + boardHtml(units, roster) + '</div>' +
    '</div>';
}

/* ---------------- mutations ---------------- */

/** เข้าคิวคำสั่งแก้ข้อมูล — ยิงตามลำดับทีละคำสั่ง res.units คือความจริงเสมอ (server ตัดสิน) */
function mutate(container: HTMLElement, params: Record<string, unknown>, okMsg: string,
  cb?: { onOk?: () => void; onErr?: (msg: string) => void }): void {
  // กันคำสั่งซ้ำเป๊ะที่ค้างคิวอยู่แล้ว (เช่น ดับเบิลคลิกการ์ดเดิมก่อนผลกลับ) — งานที่รอผล (มี callback) ไม่ตัดทิ้ง
  // เพราะคนสั่งรอฟังผลอยู่ ถ้าตัดทิ้งปุ่ม "กำลังบันทึก…" จะค้างตลอดไป
  const sig = JSON.stringify(params);
  if (!cb && pending.some((p) => JSON.stringify(p.params) === sig)) return;
  pending.push({ params, okMsg, onOk: cb && cb.onOk, onErr: cb && cb.onErr });
  if (!saving) drainQueue_(container);
}

/** แบบรอผล — คืน '' ถ้าสำเร็จ หรือข้อความผิดพลาด (ใช้กับฟอร์มที่ต้องบอกผลใต้ช่องก่อนปิดหน้าต่าง) */
function mutateAsync(container: HTMLElement, params: Record<string, unknown>, okMsg: string): Promise<string> {
  return new Promise<string>((resolve) => {
    mutate(container, params, okMsg, { onOk: () => resolve(''), onErr: (m) => resolve(m || 'บันทึกไม่สำเร็จ') });
  });
}

function drainQueue_(container: HTMLElement): void {
  const next = pending.shift();
  inFlightSig = next ? JSON.stringify(next.params) : '';
  if (!next) { saving = false; return; }
  saving = true;
  const fail = (msg: string) => {
    if (next.onErr) next.onErr(msg);
    else toast(msg, 'error');
  };
  serverCall<UMapData>('apiUMap', next.params).then((res) => {
    if (!res || res.ok === false) {
      fail((res && res.error) || 'บันทึกไม่สำเร็จ');
    } else {
      reqSeq++; // ตัด read เก่าที่ค้างกลางอากาศทิ้ง — กันข้อมูล stale มาทับผลที่เพิ่งบันทึก
      if (lastData) {
        lastData.units = res.units || [];
        lastData.updatedAt = res.updatedAt;
      }
      if (next.okMsg) toast(next.okMsg, 'ok');
      render(container);
      if (next.onOk) next.onOk();
    }
    drainQueue_(container);
  }).catch((err) => {
    fail('บันทึกไม่สำเร็จ: ' + ((err && err.message) || 'ไม่ทราบสาเหตุ'));
    drainQueue_(container);
  });
}

/* ---------------- ข้อผิดพลาดของฟอร์ม (F4 ข้อ 5): ตัวแดงใต้ช่องนั้น ---------------- */

function fieldErrSlot(id: string): string {
  return '<span class="um-field-err" id="' + id + '-err" role="alert" hidden></span>';
}
function setFieldErr(fieldId: string, msg: string): void {
  const inp = document.getElementById(fieldId);
  const slot = document.getElementById(fieldId + '-err');
  if (!slot) return;
  slot.innerHTML = msg ? icon('circle-alert', { size: 14 }) + '<span>' + esc(msg) + '</span>' : '';
  slot.hidden = !msg;
  if (inp) {
    if (msg) { inp.setAttribute('aria-invalid', 'true'); inp.setAttribute('aria-describedby', fieldId + '-err'); }
    else { inp.removeAttribute('aria-invalid'); inp.removeAttribute('aria-describedby'); }
  }
}
/** พิมพ์แก้แล้วข้อความแดงหายเอง */
function clearOnInput(ids: string[]): void {
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => setFieldErr(id, ''));
  });
}

/* ---------------- modals: เพิ่ม / แก้ / ลบยูนิต ---------------- */

function openAddUnit(container: HTMLElement): void {
  openModal(
    '<div class="modal-head"><h3>เพิ่มยูนิตใหม่</h3>' + modalCloseBtn() + '</div>' +
    '<div class="adm-form umap-form">' +
      '<label class="adm-field"><span>รหัสยูนิต (เช่น U27, UN12)</span>' +
        '<input class="input" id="uadd-code" maxlength="12" placeholder="U27" autocapitalize="characters" spellcheck="false"' + autoFocusAttr() + '>' +
        fieldErrSlot('uadd-code') + '</label>' +
      '<label class="adm-field"><span>ชื่อผลิตภัณฑ์</span>' +
        '<input class="input" id="uadd-product" maxlength="120" placeholder="ชื่อสินค้า/แบรนด์">' +
        fieldErrSlot('uadd-product') + '</label>' +
    '</div>' +
    '<div class="modal-actions">' +
      '<button type="button" class="btn modal-close">ยกเลิก</button>' +
      '<button type="button" class="btn primary" id="uadd-save">' + icon(ICON_FOR.add) + 'เพิ่ม</button>' +
    '</div>'
  );
  const root = document.getElementById('modal-root')!;
  clearOnInput(['uadd-code', 'uadd-product']);
  const save = root.querySelector('#uadd-save') as HTMLButtonElement | null;
  if (save) save.addEventListener('click', async () => {
    const u = ((root.querySelector('#uadd-code') as HTMLInputElement | null)?.value || '').trim().toUpperCase();
    const product = ((root.querySelector('#uadd-product') as HTMLInputElement | null)?.value || '').trim();
    let bad = false;
    if (!/^[A-Z0-9-]{1,12}$/.test(u)) { setFieldErr('uadd-code', 'รหัสยูนิตใช้ได้เฉพาะตัวอักษรอังกฤษ/ตัวเลข เช่น U27, UN12'); bad = true; }
    if (!product) { setFieldErr('uadd-product', 'กรอกชื่อผลิตภัณฑ์ด้วย'); bad = true; }
    if (bad) {
      const first = root.querySelector('.umap-form [aria-invalid="true"]') as HTMLElement | null;
      if (first) first.focus();
      return;
    }
    // รอผลจริงก่อนปิด — ถ้าเซิร์ฟเวอร์ไม่รับ (เช่น รหัสซ้ำ) ข้อความขึ้นใต้ช่อง ไม่ต้องกรอกใหม่ทั้งฟอร์ม
    const err = await withBusy(save, 'กำลังบันทึก…', () =>
      mutateAsync(container, { action: 'addUnit', u, product }, 'เพิ่ม ' + u + ' — ' + product + ' แล้ว'));
    if (!err) { closeModal(); return; }
    setFieldErr(/รหัส|ซ้ำ|มีอยู่แล้ว/.test(err) || err.indexOf(u) >= 0 ? 'uadd-code' : 'uadd-product', err);
  });
}

function openEditUnit(container: HTMLElement, u: string): void {
  const unit = (lastData && lastData.units || []).find((x) => x.u === u);
  if (!unit) return;
  openModal(
    '<div class="modal-head"><h3>แก้ชื่อผลิตภัณฑ์ของ ' + esc(u) + '</h3>' + modalCloseBtn() + '</div>' +
    '<div class="adm-form umap-form">' +
      '<label class="adm-field"><span>ชื่อผลิตภัณฑ์</span>' +
        '<input class="input" id="uedit-product" maxlength="120" value="' + esc(unit.product) + '"' + autoFocusAttr() + '>' +
        fieldErrSlot('uedit-product') + '</label>' +
    '</div>' +
    '<div class="modal-actions">' +
      '<button type="button" class="btn modal-close">ยกเลิก</button>' +
      '<button type="button" class="btn primary" id="uedit-save">' + icon(ICON_FOR.save) + 'บันทึก</button>' +
    '</div>'
  );
  const root = document.getElementById('modal-root')!;
  clearOnInput(['uedit-product']);
  const save = root.querySelector('#uedit-save') as HTMLButtonElement | null;
  if (save) save.addEventListener('click', async () => {
    const product = ((root.querySelector('#uedit-product') as HTMLInputElement | null)?.value || '').trim();
    if (!product) {
      setFieldErr('uedit-product', 'กรอกชื่อผลิตภัณฑ์ด้วย');
      const el = root.querySelector('#uedit-product') as HTMLElement | null;
      if (el) el.focus();
      return;
    }
    const err = await withBusy(save, 'กำลังบันทึก…', () =>
      mutateAsync(container, { action: 'editUnit', u, product }, 'แก้ ' + u + ' เป็น "' + product + '" แล้ว'));
    if (!err) { closeModal(); return; }
    setFieldErr('uedit-product', err);
  });
}

/** ลบยูนิต — กล่องยืนยันของเว็บ ปุ่มแดงบอกชัดว่าจะลบอะไร (F4) */
async function openRemoveUnit(container: HTMLElement, u: string): Promise<void> {
  const unit = (lastData && lastData.units || []).find((x) => x.u === u);
  if (!unit) return;
  const ok = await confirmDialog({
    title: 'ลบยูนิต ' + u + '?',
    body: u + ' — ' + (unit.product || '(ไม่มีชื่อผลิตภัณฑ์)') +
      (unit.admins.length
        ? '\nมีแอดมินประจำอยู่ ' + unit.admins.length + ' คน — การจับคู่ของยูนิตนี้จะหายไปด้วย'
        : ''),
    confirmText: 'ลบยูนิต ' + u,
    danger: true,
  });
  if (!ok) return;
  mutate(container, { action: 'removeUnit', u }, 'ลบ ' + u + ' แล้ว');
}

/* ---------------- จับคู่เพจ → ยูนิต (ใช้จัดกลุ่มยอดขายในหน้ายอดขาย) ---------------- */

/** map page_id → รหัสยูนิตที่เพจนั้นถูกจับคู่อยู่ (จาก lastData.units) */
function pageUnitLookup_(): Record<string, string> {
  const m: Record<string, string> = {};
  ((lastData && lastData.units) || []).forEach((x) => (x.pages || []).forEach((p) => { m[p.id] = x.u; }));
  return m;
}

/** ย้ายเพจไปยูนิต u ในหน่วยความจำ (optimistic) — server เป็นตัวตัดสินจริงตอน mutate กลับ */
function localMovePage_(u: string, pageId: string, pageName: string): void {
  if (!lastData || !lastData.units) return;
  lastData.units.forEach((x) => { x.pages = (x.pages || []).filter((p) => p.id !== pageId); });
  const unit = lastData.units.find((x) => x.u === u);
  if (unit) unit.pages.push({ id: pageId, name: pageName });
}
function localRemovePage_(u: string, pageId: string): void {
  const unit = (lastData && lastData.units || []).find((x) => x.u === u);
  if (unit) unit.pages = unit.pages.filter((p) => p.id !== pageId);
}

let pageSearch = '';

function openPageManager(container: HTMLElement, u: string): void {
  pageSearch = '';
  openModal(
    '<div class="modal-head"><h3>จับคู่เพจ — ' + esc(u) + '</h3>' + modalCloseBtn() + '</div>' +
    '<div id="pm-body"></div>'
  );
  const root = document.getElementById('modal-root')!;
  const body = root.querySelector('#pm-body') as HTMLElement | null;
  if (!body) return;

  function listHtml(): string {
    const unit = (lastData && lastData.units || []).find((x) => x.u === u);
    if (!unit) return '<div class="empty-note">ไม่พบยูนิตนี้</div>';
    const lookup = pageUnitLookup_();
    const roster = (lastData && lastData.pageRoster) || [];
    const q = pageSearch.trim().toLowerCase();
    const list = q ? roster.filter((p) => p.name.toLowerCase().includes(q)) : roster;
    // เพจในยูนิตนี้ขึ้นก่อน แล้วเพจที่ยังไม่จับคู่ แล้วเพจของยูนิตอื่น
    list.sort((a, b) => {
      const ra = lookup[a.id] === u ? 0 : (lookup[a.id] ? 2 : 1);
      const rb = lookup[b.id] === u ? 0 : (lookup[b.id] ? 2 : 1);
      return ra !== rb ? ra - rb : a.name.localeCompare(b.name, 'th');
    });
    if (!roster.length) return '<div class="empty-note">ยังไม่มีรายชื่อเพจ (รอข้อมูลรอบถัดไป)</div>';
    const rows = list.map((p) => {
      const cur = lookup[p.id];
      const here = cur === u;
      const other = (cur && cur !== u) ? cur : '';
      // วงติ๊ก = อยู่ในยูนิตนี้แล้ว · วงเปล่า = ยังไม่อยู่ — aria-pressed บอกสถานะเดียวกันให้โปรแกรมอ่านหน้าจอ
      // โลโก้ LINE อยู่นอกช่องชื่อ ไม่งั้นชื่อเพจยาวจะตัด "…" ทับโลโก้หายไป
      return '<button type="button" class="page-pick' + (here ? ' selected' : '') + '" data-pid="' + esc(p.id) +
        '" data-name="' + esc(p.name) + '" aria-pressed="' + (here ? 'true' : 'false') + '">' +
        (here
          ? '<span class="chk tx-brand">' + icon(ICON_FOR.ok, { size: 18 }) + '</span>'
          : '<span class="chk tx-muted">' + icon('circle', { size: 18 }) + '</span>') +
        '<span class="nm">' + esc(p.name) + '</span>' +
        (p.platform === 'line' ? brandIcon('line', { size: 14, label: true }) : '') +
        (other ? '<span class="cnt">อยู่ ' + esc(other) + '</span>' : '') +
        '</button>';
    }).join('');
    return rows || '<div class="empty-note">ไม่พบเพจชื่อ "' + esc(pageSearch) + '"</div>';
  }

  function renderBody(): void {
    const unit = (lastData && lastData.units || []).find((x) => x.u === u);
    const n = unit ? (unit.pages || []).length : 0;
    body!.innerHTML =
      '<div class="card-sub umap-pm-sub">คลิกเพจเพื่อจับคู่/เอาออกจาก <b>' + esc(u) +
        '</b>' + (unit && unit.product ? ' — ' + esc(unit.product) : '') + ' • ตอนนี้ ' + n + ' เพจ • ' +
        '1 เพจอยู่ได้ยูนิตเดียว (จับที่นี่จะย้ายออกจากยูนิตเดิมให้)</div>' +
      '<div class="search-box umap-pm-search">' + icon(ICON_FOR.search) +
        '<input class="input" id="pm-search" placeholder="ค้นหาเพจ..." aria-label="ค้นหาเพจ" value="' + esc(pageSearch) + '">' +
      '</div>' +
      '<div class="page-pick-list">' + listHtml() + '</div>';
    const s = body!.querySelector('#pm-search') as HTMLInputElement | null;
    if (s) s.addEventListener('input', () => {
      pageSearch = s.value;
      const l = body!.querySelector('.page-pick-list') as HTMLElement | null;
      if (l) l.innerHTML = listHtml();
    });
  }

  body.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.page-pick') as HTMLElement | null;
    if (!btn) return;
    const pid = btn.getAttribute('data-pid') || '';
    const name = btn.getAttribute('data-name') || '';
    const here = pageUnitLookup_()[pid] === u;
    if (here) {
      localRemovePage_(u, pid);
      mutate(container, { action: 'unassignPage', u, pageId: pid }, '');
    } else {
      localMovePage_(u, pid, name);
      mutate(container, { action: 'assignPage', u, pageId: pid }, '');
    }
    renderBody(); // สะท้อนผลทันที (optimistic) — server จะยืนยันภายหลัง
  });

  renderBody();
}

/* ---------------- คัดลอกลิงก์ข้อมูล (API สาธารณะ) ---------------- */

function copyApiLink(): void {
  const url = location.origin + '/api/public/umap';
  // ถ้า server ตั้ง UMAP_PUBLIC_KEY ไว้ ลิงก์เปล่าๆ จะโดน 401 — บอกความจริง อย่าโม้ว่าเปิดฟรี
  // ชื่อค่าตั้งระบบ (UMAP_PUBLIC_KEY) เป็นคำช่าง — บอกเฉพาะผู้ดูแลระบบ
  const note = (lastData && lastData.publicNeedsKey)
    ? ' (ต้องแนบรหัสลับต่อท้ายลิงก์' + (isSuperadmin() ? ' ?key= ตามค่า UMAP_PUBLIC_KEY' : '') + ')'
    : '';
  // คัดลอกไม่ได้ (เบราว์เซอร์ไม่ให้สิทธิ์) → copyText เปิดแผ่นที่มีช่องลิงก์เลือกไว้ + ปุ่มคัดลอก
  copyText(url, 'คัดลอกลิงก์แล้ว — ระบบอื่นเปิดลิงก์นี้เพื่อดึงรายการจับคู่ยูนิตได้' + note, 'ลิงก์ข้อมูลจับคู่ยูนิต');
}

/* ---------------- render + events ---------------- */

function bindEvents(container: HTMLElement): void {
  // ค้นหาแอดมิน — วาดเฉพาะ list ฝั่งซ้าย ไม่ทั้งหน้า (โฟกัสช่องพิมพ์ต้องไม่หลุด)
  const searchInp = container.querySelector('#u-search') as HTMLInputElement | null;
  if (searchInp) searchInp.addEventListener('input', () => {
    search = searchInp.value;
    const list = container.querySelector('#u-admin-list') as HTMLElement | null;
    if (list && lastData) list.innerHTML = adminListHtml(lastData.units || [], lastData.roster || []);
  });

  // เลือก/เลิกเลือกแอดมิน (delegate — list ถูกวาดใหม่ได้จากช่องค้นหา)
  const adminList = container.querySelector('#u-admin-list');
  if (adminList) adminList.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.admin-pick') as HTMLElement | null;
    if (!btn || !lastData) return;
    const id = btn.getAttribute('data-id') || '';
    const a = (lastData.roster || []).find((x) => x.id === id) || null;
    // วาดทั้งหน้าใหม่ = รายชื่อเด้งกลับบนสุด และแถบ "กำลังจับคู่" แทรกด้านบนดันทุกอย่างลง
    // มือถือเดิม: ชื่อที่เพิ่งแตะหลุดลงไปใต้ขอบรายชื่อ ไม่รู้ว่าเลือกใครอยู่ (รีวิวมือถือ 27 ก.ย. 69)
    // → คืนตำแหน่งเลื่อนของรายชื่อ แล้วเลื่อนหน้าให้ชื่อที่แตะกลับมาอยู่ที่เดิมใต้นิ้ว
    const oldList = container.querySelector('#u-admin-list') as HTMLElement | null;
    const listTop = oldList ? oldList.scrollTop : 0;
    const y0 = btn.getBoundingClientRect().top;
    selected = (selected && selected.id === id) ? null : a;
    render(container);
    const newList = container.querySelector('#u-admin-list') as HTMLElement | null;
    if (newList && listTop) newList.scrollTop = listTop;
    // วาดทั้งหน้าใหม่ = ปุ่มเดิมหายไป — คืนโฟกัสให้ปุ่มแอดมินคนเดิม (คนใช้คีย์บอร์ดไม่หลุดกลับไปบนสุด)
    const again = container.querySelector('.admin-pick[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]') as HTMLElement | null;
    if (again) {
      again.focus({ preventScroll: true });
      const dy = again.getBoundingClientRect().top - y0;
      if (Math.abs(dy) > 1) window.scrollBy(0, dy);
      // แถบ "กำลังจับคู่" ติดจอ (สูง ~120px) — รายชื่ออยู่ชิดบนจอ ชื่อที่แตะจะจมใต้แถบ → เลื่อนลงให้พ้นแถบ
      const hint = container.querySelector('.umap-hint') as HTMLElement | null;
      if (hint) {
        const gap = again.getBoundingClientRect().top - hint.getBoundingClientRect().bottom - 8;
        if (gap < 0) window.scrollBy(0, gap);
      }
    }
  });

  // กระดานยูนิต: จับคู่ / เอาออก / แก้ / ลบ (delegate)
  const board = container.querySelector('#u-board');
  if (board) board.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const x = t.closest('.x') as HTMLElement | null;
    if (x) {
      const u = x.getAttribute('data-u') || '';
      const userId = x.getAttribute('data-id') || '';
      const unit = (lastData && lastData.units || []).find((it) => it.u === u);
      const m = unit ? unit.admins.find((a) => a.id === userId) : null;
      const name = m ? m.name : 'แอดมิน';
      // เอาออกทันที + แถบ "เลิกทำ" (F4) — กดพลาดแล้วใส่กลับได้ในคลิกเดียว ไม่ต้องไปหาแอดมินคนนั้นใหม่
      mutate(container, { action: 'unassign', u, userId }, '', {
        onOk: () => undoToast('เอา ' + name + ' ออกจาก ' + u + ' แล้ว', () =>
          mutate(container, { action: 'assign', u, userId }, 'ใส่ ' + name + ' กลับเข้า ' + u + ' แล้ว')),
        onErr: (msg) => toast(msg, 'error'),
      });
      return;
    }
    const tool = t.closest('.u-tool-btn') as HTMLElement | null;
    if (tool) {
      const u = tool.getAttribute('data-u') || '';
      if (tool.getAttribute('data-act') === 'edit') openEditUnit(container, u);
      else void openRemoveUnit(container, u);
      return;
    }
    // ปุ่มจัดการเพจ — ต้องดักก่อน .u-card ไม่งั้นจะไปเข้า logic จับคู่แอดมิน
    const pagesBtn = t.closest('.u-pages-btn') as HTMLElement | null;
    if (pagesBtn) {
      openPageManager(container, pagesBtn.getAttribute('data-u') || '');
      return;
    }
    const card = t.closest('.u-card') as HTMLElement | null;
    if (!card) return;
    const u = card.getAttribute('data-u') || '';
    if (!selected) { toast('เลือกแอดมินจากรายการก่อน แล้วค่อยเลือกการ์ดยูนิต', 'info'); return; }
    const unit = (lastData && lastData.units || []).find((it) => it.u === u);
    if (unit && unit.admins.some((m) => m.id === selected!.id)) {
      toast(selected.name + ' อยู่ใน ' + u + ' อยู่แล้ว', 'info');
      return;
    }
    // ทำทันที + แถบ "เลิกทำ" (เหมือนตอนเอาออก) — แตะการ์ดพลาดบนมือถือแก้ได้ในแตะเดียว
    const userId = selected.id;
    const name = selected.name;
    // แตะการ์ดเดิมซ้ำก่อนผลกลับ — ตัวกันซ้ำใน mutate() ข้ามงานที่มี callback จึงกันเองที่นี่ (ทั้งที่รอคิวและที่กำลังยิง)
    const sig = JSON.stringify({ action: 'assign', u, userId });
    if (sig === inFlightSig || pending.some((p) => JSON.stringify(p.params) === sig)) return;
    mutate(container, { action: 'assign', u, userId }, '', {
      onOk: () => undoToast('จับคู่ ' + name + ' ↔ ' + u + ' แล้ว', () =>
        mutate(container, { action: 'unassign', u, userId }, 'เอา ' + name + ' ออกจาก ' + u + ' แล้ว')),
      onErr: (msg) => toast(msg, 'error'),
    });
  });

  const cancelSel = container.querySelector('#u-cancel-sel');
  // เลิกเลือก = แถบหายไป ทุกอย่างข้างล่างกระโดดขึ้น ~130px และรายชื่อเด้งกลับบนสุด → ตรึงการ์ดยูนิตที่เห็นอยู่ไว้ที่เดิม
  if (cancelSel) cancelSel.addEventListener('click', () => {
    keepPlace_(container, () => { selected = null; render(container); });
  });

  const add = container.querySelector('#u-add');
  if (add) add.addEventListener('click', () => openAddUnit(container));
  const api = container.querySelector('#u-api');
  if (api) api.addEventListener('click', copyApiLink);
}

/** วาดใหม่โดยไม่เสียตำแหน่ง: คืนตำแหน่งเลื่อนของรายชื่อ + ตรึงการ์ดยูนิตใบแรกที่เห็นบนจอไว้ที่เดิม */
function keepPlace_(container: HTMLElement, redraw: () => void): void {
  const list = container.querySelector('#u-admin-list') as HTMLElement | null;
  const listTop = list ? list.scrollTop : 0;
  const anchor = Array.from(container.querySelectorAll<HTMLElement>('#u-board .u-card'))
    .find((c) => c.getBoundingClientRect().bottom > 0);
  const u = anchor ? anchor.getAttribute('data-u') || '' : '';
  const y0 = anchor ? anchor.getBoundingClientRect().top : 0;
  redraw();
  const nl = container.querySelector('#u-admin-list') as HTMLElement | null;
  if (nl && listTop) nl.scrollTop = listTop;
  if (!u) return;
  const again = container.querySelector('#u-board .u-card[data-u="' + (window.CSS && CSS.escape ? CSS.escape(u) : u) + '"]');
  if (!again) return;
  const dy = again.getBoundingClientRect().top - y0;
  if (Math.abs(dy) > 1) window.scrollBy(0, dy);
}

function render(container: HTMLElement): void {
  const data = lastData || {};
  // กัน ghost selection: แอดมินที่เลือกไว้อาจหายจาก roster (ถูกปิดใช้งาน) หลัง refetch
  if (selected && !(data.roster || []).some((a) => a.id === selected!.id)) selected = null;
  container.innerHTML = bodyHtml(data);
  bindEvents(container);
}

function fetchAndRender(container: HTMLElement): void {
  const seq = ++reqSeq;
  serverCall<UMapData>('apiUMap').then((data) => {
    if (seq !== reqSeq) return;
    lastData = data;
    // มี modal เปิดอยู่ (กำลังเล่นเกม/กรอกฟอร์ม) — อย่าวาดทับหน้า ข้อมูลใหม่รอรอบถัดไป
    const modalRoot = document.getElementById('modal-root');
    if (modalRoot && modalRoot.innerHTML) return;
    // ผู้ใช้กำลังพิมพ์ในช่องบนหน้านี้ (เช่นช่องค้นหา) — วาดทับตอนนี้จะแย่งโฟกัส/ตัวอักษรหาย
    const ae = document.activeElement;
    if (ae && container.contains(ae) &&
        (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA')) return;
    render(container);
  }).catch((err) => {
    if (seq !== reqSeq) return;
    if (lastData) {
      toast('โหลดข้อมูลใหม่ไม่สำเร็จ', 'error', { action: { label: 'ลองใหม่', fn: () => umap.load(container, true) } });
    } else {
      showError(container, (err && err.message) || 'เรียกข้อมูลไม่สำเร็จ', () => {
        umap.load(container, true);
      });
    }
  });
}

/* ---------------- ลงทะเบียน view ---------------- */

export const umap = {
  load: async (container: HTMLElement, force?: boolean): Promise<void> => {
    if (lastData && !force) {
      render(container);               // แสดงจาก cache ทันที
      fetchAndRender(container);       // แล้วดึงข้อมูลใหม่เบื้องหลัง
    } else {
      container.innerHTML = umapSkel();
      fetchAndRender(container);
    }
  },
};
