/* ============================================================
   users — หน้าบัญชีผู้ใช้ (เฉพาะผู้ดูแลระบบ)
   สร้าง/แก้/ระงับ/ลบบัญชี • รีเซ็ตรหัส • สร้างยกชุดจากรายชื่อแอดมิน Pancake
   รหัสผ่านแสดง "ครั้งเดียว" ตอนสร้าง/รีเซ็ต — DB เก็บแค่ hash ย้อนดูไม่ได้

   ตรวจ UI รอบ 3 (26 ก.ย. 69)
   - F4: ลบบัญชี / รีเซ็ตรหัส ใช้กล่องยืนยันของเว็บ (ปุ่มแดงบอกชัดว่าจะทำอะไร) แทน confirm() ของเบราว์เซอร์
         ระงับบัญชี = ทำทันที + แถบ "เลิกทำ" 5 วิ · ปุ่มบันทึกขึ้น "กำลังบันทึก…" · ข้อผิดพลาดของฟอร์มขึ้นใต้ช่องนั้น
   - D2: "เปิด/ปิด" → "ใช้งานได้/ระงับอยู่" · ปุ่ม "ปิด" → "ระงับบัญชี"
   - C2/C4: ปุ่มซ้ำทุกแถวเป็นปุ่มแบบข้อความ (จอคอม) · ปุ่มดาวน์โหลดปุ่มเดียวขวาสุดของแถวเครื่องมือ
   ============================================================ */

import {
  serverCall, esc, fmtNum, dash, relTime, showError, toast, undoToast, withBusy, confirmDialog, infoTip, stateHtml,
  openModal, closeModal, downloadCSV, modalCloseBtn, downloadMenuHtml, bindDownloadMenu,
} from '@/lib/ui/helpers';
import { icon, ICON_FOR, statusPill } from '@/lib/ui/icons';
import { usersSkel } from '@/lib/ui/skeletons';

interface UserRow {
  id: number;
  username: string;
  name: string;
  role: string;
  roleLabel?: string;
  admin_user_id: string | null;
  enabled: boolean;
  must_change_pw: boolean;
  last_login_at: string | null;
  created_at: string | null;
}
interface AdminOpt { id: string; name: string; email: string; hasAccount: boolean }
interface UsersData {
  users?: UserRow[];
  admins?: AdminOpt[];
  roles?: { key: string; label: string }[];
  me?: { username: string; role: string };
  error?: string;
}

let lastData: UsersData | null = null;
let reqSeq = 0;
let search = '';
let busy = false;

/** ข้อความผิดพลาดจากเซิร์ฟเวอร์ (อาจเป็น JSON { error }) → ข้อความไทยล้วน */
function errText(e: any, fallback: string): string {
  let m = String((e && e.message) || '').trim();
  if (m.charAt(0) === '{') {
    try { const j = JSON.parse(m); if (j && typeof j.error === 'string') m = j.error; } catch { /* ใช้ข้อความเดิม */ }
  }
  return m || fallback;
}

/* ---------------- ชิ้นส่วน HTML ---------------- */

/** C4 แถวเครื่องมือ: ซ้าย = ค้นหา · ขวาสุด = ดาวน์โหลด (ปุ่มสร้างบัญชีย้ายไปหัวการ์ดตาราง) */
function toolbarHtml(): string {
  return '<div class="toolbar us-tb">' +
    '<div class="tb-filters us-filters">' +
      // ขนาดช่องค้นหาตั้งที่กรอบ .search-box (แว่นขยายวาดซ้อนในกรอบ เพราะ placeholder ใส่รูปไม่ได้)
      '<div class="search-box us-search">' + icon(ICON_FOR.search) +
        '<input class="input" id="us-search" placeholder="ค้นหาชื่อหรือชื่อผู้ใช้" aria-label="ค้นหาชื่อหรือชื่อผู้ใช้" value="' + esc(search) + '">' +
      '</div>' +
    '</div>' +
    '<div class="tb-actions">' + downloadMenuHtml('us-dl') + '</div>' +
  '</div>';
}

function summaryHtml(d: UsersData): string {
  const u = d.users || [];
  const n = (r: string) => u.filter((x) => x.role === r).length;
  const off = u.filter((x) => !x.enabled).length;
  return '<div class="pg-summary">' +
    '<div class="pgs-item"><b>' + fmtNum(u.length) + '</b><span>บัญชีทั้งหมด</span></div>' +
    '<div class="pgs-item"><b>' + fmtNum(n('superadmin')) + '</b><span>ผู้ดูแลระบบ</span></div>' +
    '<div class="pgs-item"><b>' + fmtNum(n('exec')) + '</b><span>ระดับบริหาร</span></div>' +
    '<div class="pgs-item"><b>' + fmtNum(n('admin')) + '</b><span>ระดับแอดมิน</span></div>' +
    '<div class="pgs-item' + (off ? ' warn' : '') + '"><b>' + fmtNum(off) + '</b><span>ระงับอยู่</span></div>' +
    '</div>';
}

function rowsHtml(d: UsersData): string {
  const q = search.trim().toLowerCase();
  const list = (d.users || []).filter((u) =>
    !q || String(u.username).toLowerCase().indexOf(q) >= 0 || String(u.name).toLowerCase().indexOf(q) >= 0);

  if (!list.length) {
    return '<div class="us-empty">' + stateHtml('nodata', { title: 'ไม่พบผู้ใช้ที่ค้นหา', body: 'ลองพิมพ์ชื่อหรือชื่อผู้ใช้ใหม่อีกครั้ง' }) + '</div>';
  }

  const adminName: Record<string, string> = {};
  (d.admins || []).forEach((a) => { adminName[a.id] = a.name; });

  const body = list.map((u) => {
    const isMe = d.me && d.me.username === u.username;
    return '<tr' + (u.enabled ? '' : ' class="row-off"') + '>' +
      '<td><b>' + esc(u.username) + '</b>' + (isMe ? ' <span class="badge neutral">คุณ</span>' : '') +
        // ยังไม่ได้ตั้งรหัสใหม่ = เรื่องที่ต้องจับตา (ส้ม) ไม่ใช่เรื่องด่วน (แดง) — งบสีแดง B3
        (u.must_change_pw ? ' <span title="ยังไม่ได้ตั้งรหัสใหม่หลังได้รหัสชั่วคราว">' + statusPill('warn', 'รอตั้งรหัส') + '</span>' : '') + '</td>' +
      '<td>' + esc(u.name) + '</td>' +
      '<td>' + esc(u.roleLabel || u.role) + '</td>' +
      '<td>' + (u.admin_user_id ? esc(adminName[u.admin_user_id] || u.admin_user_id) : dash()) + '</td>' +
      '<td>' + (u.enabled ? statusPill('good', 'ใช้งานได้') : statusPill('muted', 'ระงับอยู่')) + '</td>' +
      '<td>' + esc(u.last_login_at ? relTime(u.last_login_at) : 'ยังไม่เคยเข้า') + '</td>' +
      // ปุ่มซ้ำทุกแถว = ปุ่มแบบข้อความ (C2) · ลบ = ตัวแดง · ชื่อบัญชีอยู่ใน aria-label ให้โปรแกรมอ่านหน้าจอแยกแถวออก
      '<td class="us-actions">' +
        '<button type="button" class="btn-mini btn-text" data-us-edit="' + u.id + '" aria-label="แก้ไข ' + esc(u.username) + '">' +
          icon(ICON_FOR.edit) + 'แก้ไข</button>' +
        '<button type="button" class="btn-mini btn-text" data-us-reset="' + u.id + '" title="ตั้งรหัสใหม่แบบสุ่ม" aria-label="รีเซ็ตรหัสของ ' + esc(u.username) + '">' +
          icon(ICON_FOR.resetPassword) + 'รีเซ็ตรหัส</button>' +
        (isMe ? '' : '<button type="button" class="btn-mini btn-text" data-us-toggle="' + u.id + '" aria-label="' +
          esc((u.enabled ? 'ระงับบัญชี ' : 'เปิดใช้บัญชี ') + u.username) + '">' +
          (u.enabled ? icon(ICON_FOR.pause) + 'ระงับบัญชี' : icon(ICON_FOR.play) + 'เปิดใช้') + '</button>') +
        (isMe ? '' : '<button type="button" class="btn-mini btn-text danger" data-us-del="' + u.id + '" aria-label="ลบบัญชี ' + esc(u.username) + '">' +
          icon(ICON_FOR.delete) + 'ลบ</button>') +
      '</td></tr>';
  }).join('');

  return '<div class="tbl-wrap"><table class="tbl us-tbl">' +
    '<thead><tr><th>ชื่อผู้ใช้</th><th>ชื่อ</th><th>ระดับสิทธิ์</th><th>ผูกกับแอดมิน</th>' +
    '<th>สถานะ</th><th>เข้าล่าสุด</th><th>จัดการ</th></tr></thead>' +
    '<tbody>' + body + '</tbody></table></div>';
}

function bodyHtml(d: UsersData): string {
  if (d.error) {
    return '<div class="card">' + stateHtml('error', { body: d.error }) + '</div>';
  }
  const noAcc = (d.admins || []).filter((a) => !a.hasAccount).length;
  return toolbarHtml() + summaryHtml(d) +
    '<div class="card">' +
      // C3 หัวการ์ด: หัวข้อซ้าย ปุ่มขวา — ปุ่มหลัก (ม่วงทึบ) มีปุ่มเดียวในส่วนนี้
      '<div class="card-head">' +
        '<h3 class="card-title">บัญชีผู้ใช้งาน' +
          infoTip('ระดับแอดมิน = เห็นเฉพาะผลงานของตัวเอง • ระดับบริหาร = เห็นทุกหน้า • ผู้ดูแลระบบ = เห็นทุกหน้าและจัดการผู้ใช้ได้', 'ระดับสิทธิ์') +
        '</h3>' +
        '<div class="card-actions">' +
          '<button type="button" class="btn" id="us-bulk" title="สร้างบัญชีให้แอดมินที่ยังไม่มี">' + icon(ICON_FOR.admins) + 'สร้างยกชุดจากแอดมิน' +
            (noAcc ? ' (' + noAcc + ')' : '') + '</button>' +
          '<button type="button" class="btn primary" id="us-add">' + icon(ICON_FOR.add) + 'เพิ่มผู้ใช้</button>' +
        '</div>' +
      '</div>' +
      rowsHtml(d) +
    '</div>';
}

/* ---------------- modal ---------------- */

/** โชว์รหัสผ่านครั้งเดียว — ย้ำให้คัดลอกเก็บ เพราะดูย้อนหลังไม่ได้ */
function showPassword(title: string, username: string, password: string): void {
  openModal(
    '<div class="modal-head"><h3>' + esc(title) + '</h3>' + modalCloseBtn() + '</div>' +
    '<div class="hint-box us-pw-warn"><span class="tx-warn">' + icon(ICON_FOR.alert, { size: 14 }) + '</span> รหัสนี้แสดง <b>ครั้งเดียว</b> — คัดลอกเก็บก่อนปิดหน้าต่าง (ระบบเก็บแค่ค่าเข้ารหัส ดูย้อนหลังไม่ได้)</div>' +
    '<div class="pw-box kv">' +
      '<div class="kv-row"><span class="kv-k">ชื่อผู้ใช้</span><span class="kv-v">' + esc(username) + '</span></div>' +
      '<div class="kv-row"><span class="kv-k">รหัสผ่าน</span><span class="kv-v pw-val" id="pw-val">' + esc(password) + '</span></div>' +
    '</div>' +
    '<div class="card-sub">ผู้ใช้จะถูกบังคับตั้งรหัสใหม่ตอนเข้าครั้งแรก</div>' +
    '<div class="modal-actions">' +
      '<button type="button" class="btn" id="pw-copy">' + icon(ICON_FOR.copy) + 'คัดลอก</button>' +
      '<button type="button" class="btn primary modal-close">เรียบร้อย</button>' +
    '</div>'
  );
  const copy = document.getElementById('pw-copy');
  if (copy) {
    copy.addEventListener('click', () => {
      const text = username + ' / ' + password;
      // คัดลอกไม่ได้ (เบราว์เซอร์ไม่ให้สิทธิ์) → เลือกรหัสบนจอไว้ให้ แล้วบอกวิธีคัดลอกเอง
      // ไม่เปิดหน้าต่างใหม่ทับ — หน้าต่างนี้เป็นที่เดียวที่เห็นรหัส ปิดไปแล้วต้องรีเซ็ตใหม่
      const selectPw = () => {
        const el = document.getElementById('pw-val');
        const sel = window.getSelection();
        if (el && sel) {
          const r = document.createRange();
          r.selectNodeContents(el);
          sel.removeAllRanges();
          sel.addRange(r);
        }
        toast('คัดลอกอัตโนมัติไม่ได้ — เลือกรหัสไว้ให้แล้ว กด Ctrl+C หรือกดค้างเพื่อคัดลอก', 'info');
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => toast('คัดลอกแล้ว', 'ok')).catch(selectPw);
      } else selectPw();
    });
  }
}

function adminOptions(d: UsersData, selected: string): string {
  const opts = (d.admins || [])
    .filter((a) => !a.hasAccount || a.id === selected)
    .map((a) => '<option value="' + esc(a.id) + '"' + (a.id === selected ? ' selected' : '') + '>' +
      esc(a.name) + (a.email ? ' (' + esc(a.email) + ')' : '') + '</option>').join('');
  return '<option value="">— ไม่ผูก —</option>' + opts;
}

/* ---- ข้อผิดพลาดของฟอร์ม (F4 ข้อ 5): ตัวแดงใต้ช่องนั้น + บอกโปรแกรมอ่านหน้าจอด้วย aria-invalid ---- */
function fieldErrSlot(id: string): string {
  return '<span class="us-field-err" id="' + id + '-err" role="alert" hidden></span>';
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
function clearFieldErrs(ids: string[]): void { ids.forEach((id) => setFieldErr(id, '')); }

/** ข้อความจากเซิร์ฟเวอร์ → ช่องที่เกี่ยว (ไม่รู้ว่าเป็นช่องไหน = บรรทัดรวมท้ายฟอร์ม) */
function serverErrField(msg: string, isNew: boolean): string {
  if (isNew && /ชื่อผู้ใช้/.test(msg)) return 'us-f-username';
  if (/ผูกกับแอดมิน/.test(msg)) return 'us-f-admin';
  if (/ระดับสิทธิ์|ผู้ดูแลระบบ/.test(msg)) return 'us-f-role';
  return 'us-f-form';
}

function openEditor(container: HTMLElement, d: UsersData, user: UserRow | null): void {
  const isNew = !user;
  const roles = d.roles || [{ key: 'admin', label: 'ระดับแอดมิน' }];
  // บัญชีใหม่เริ่มที่สิทธิ์ต่ำสุด (ระดับแอดมิน) — เดิมตัวเลือกแรกคือ "ผู้ดูแลระบบ" กดบันทึกโดยไม่ดูก็ได้บัญชีสิทธิ์สูงสุด
  const newRole = roles.some((r: { key: string }) => r.key === 'admin') ? 'admin' : (roles[roles.length - 1] || { key: '' }).key;
  openModal(
    '<div class="modal-head"><h3>' + (isNew ? 'เพิ่มผู้ใช้' : 'แก้ไข ' + esc(user!.username)) + '</h3>' +
    modalCloseBtn() + '</div>' +
    '<div class="adm-form us-form">' +
      (isNew
        ? '<label class="adm-field"><span>ชื่อผู้ใช้ (a-z 0-9 . _ - ยาว 3-32 ตัว)</span>' +
          '<input class="input" id="us-f-username" autocapitalize="none" spellcheck="false" placeholder="เช่น somchai">' +
          fieldErrSlot('us-f-username') + '</label>'
        : '') +
      '<label class="adm-field"><span>ชื่อที่แสดง</span>' +
        '<input class="input" id="us-f-name" value="' + esc(user ? user.name : '') + '"></label>' +
      '<label class="adm-field"><span>ระดับสิทธิ์</span><select class="input" id="us-f-role">' +
        roles.map((r) => '<option value="' + esc(r.key) + '"' +
          ((user ? user.role : newRole) === r.key ? ' selected' : '') + '>' + esc(r.label) + '</option>').join('') +
      '</select>' + fieldErrSlot('us-f-role') + '</label>' +
      '<label class="adm-field"><span>ผูกกับแอดมิน (จำเป็นสำหรับระดับแอดมิน)</span>' +
        '<select class="input" id="us-f-admin">' + adminOptions(d, user ? String(user.admin_user_id || '') : '') + '</select>' +
        fieldErrSlot('us-f-admin') + '</label>' +
      fieldErrSlot('us-f-form') +
    '</div>' +
    '<div class="hint-box">บัญชีใหม่จะได้รหัสผ่านสุ่ม และถูกบังคับตั้งรหัสใหม่ตอนเข้าครั้งแรก</div>' +
    '<div class="modal-actions">' +
      '<button type="button" class="btn modal-close">ยกเลิก</button>' +
      '<button type="button" class="btn primary" id="us-f-save">บันทึก</button>' +
    '</div>'
  );

  const FIELDS = ['us-f-username', 'us-f-role', 'us-f-admin', 'us-f-form'];
  const val = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value || '';
  // พิมพ์แก้แล้วข้อความแดงของช่องนั้นหายเอง — ไม่ค้างเตือนเรื่องที่แก้ไปแล้ว
  ['us-f-username', 'us-f-role', 'us-f-admin'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => { setFieldErr(id, ''); setFieldErr('us-f-form', ''); });
  });

  const saveBtn = document.getElementById('us-f-save');
  saveBtn!.addEventListener('click', async () => {
    if (busy) return;
    clearFieldErrs(FIELDS);
    const params: any = {
      action: isNew ? 'create' : 'update',
      name: val('us-f-name'),
      role: val('us-f-role'),
      adminUserId: val('us-f-admin'),
    };
    if (isNew) params.username = val('us-f-username').trim();
    else params.id = user!.id;

    // ตรวจเบื้องต้นก่อนส่ง (กติกาเดียวกับเซิร์ฟเวอร์ — เซิร์ฟเวอร์ยังตรวจซ้ำและเป็นคนตัดสินจริง)
    let bad = false;
    if (isNew && !/^[a-z0-9._-]{3,32}$/.test(String(params.username).toLowerCase())) {
      setFieldErr('us-f-username', 'ชื่อผู้ใช้ต้องเป็น a-z 0-9 . _ - ยาว 3-32 ตัว');
      bad = true;
    }
    if (params.role === 'admin' && !params.adminUserId) {
      setFieldErr('us-f-admin', 'บัญชีระดับแอดมินต้องเลือกแอดมินที่จะผูก (ไม่งั้นจะไม่มีข้อมูลให้ดู)');
      bad = true;
    }
    if (bad) {
      const first = document.querySelector('.us-form [aria-invalid="true"]') as HTMLElement | null;
      if (first) first.focus();
      return;
    }

    busy = true;
    try {
      const r: any = await withBusy(saveBtn, 'กำลังบันทึก…', () => serverCall('apiUsers', params));
      closeModal();
      if (isNew && r.password) showPassword('สร้างบัญชีแล้ว', r.username, r.password);
      else toast('บันทึกแล้ว', 'ok');
      lastData = null;
      users.load(container, true);
    } catch (e: any) {
      const msg = errText(e, 'บันทึกไม่สำเร็จ');
      setFieldErr(serverErrField(msg, isNew), msg);
    }
    busy = false;
  });
}

function openBulk(container: HTMLElement, d: UsersData): void {
  const pool = (d.admins || []).filter((a) => !a.hasAccount);
  if (!pool.length) {
    toast('แอดมินทุกคนมีบัญชีแล้ว', 'info');
    return;
  }
  openModal(
    '<div class="modal-head"><h3>สร้างบัญชียกชุด</h3>' + modalCloseBtn() + '</div>' +
    '<div class="card-sub">แอดมินที่ยังไม่มีบัญชี ' + pool.length + ' คน — เลือกคนที่จะสร้างให้</div>' +
    '<div class="bulk-actions">' +
      '<button type="button" class="btn btn-mini" id="us-b-all">เลือกทั้งหมด</button>' +
      '<button type="button" class="btn btn-mini" id="us-b-none">ไม่เลือกเลย</button>' +
    '</div>' +
    '<div class="page-pick-list">' +
      pool.map((a) => '<label class="page-pick"><input type="checkbox" class="us-b-chk" value="' + esc(a.id) + '" checked> ' +
        esc(a.name) + (a.email ? ' <span class="card-sub">' + esc(a.email) + '</span>' : '') + '</label>').join('') +
    '</div>' +
    fieldErrSlot('us-b-form') +
    '<div class="hint-box">ทุกบัญชีได้รหัสสุ่ม + ต้องตั้งรหัสใหม่ตอนเข้าครั้งแรก — ระบบจะให้ดาวน์โหลดไฟล์ CSV รายชื่อ+รหัสไปแจก</div>' +
    '<div class="modal-actions">' +
      '<button type="button" class="btn modal-close">ยกเลิก</button>' +
      '<button type="button" class="btn primary" id="us-b-go">สร้างบัญชี</button>' +
    '</div>'
  );

  const chks = () => Array.from(document.querySelectorAll('.us-b-chk')) as HTMLInputElement[];
  document.getElementById('us-b-all')!.addEventListener('click', () => { chks().forEach((c) => { c.checked = true; }); setFieldErr('us-b-form', ''); });
  document.getElementById('us-b-none')!.addEventListener('click', () => chks().forEach((c) => { c.checked = false; }));

  const go = document.getElementById('us-b-go');
  go!.addEventListener('click', async () => {
    if (busy) return;
    const ids = chks().filter((c) => c.checked).map((c) => c.value);
    if (!ids.length) { setFieldErr('us-b-form', 'ยังไม่ได้เลือกใคร — ติ๊กชื่อแอดมินอย่างน้อย 1 คน'); return; }
    setFieldErr('us-b-form', '');
    busy = true;
    try {
      const r: any = await withBusy(go, 'กำลังสร้าง ' + ids.length + ' บัญชี…', () =>
        serverCall('apiUsers', { action: 'createBulk', adminUserIds: ids }));
      closeModal();
      const made: any[] = r.created || [];
      toast('สร้างแล้ว ' + made.length + ' บัญชี', 'ok');
      if (made.length) {
        // ดาวน์โหลดทันที — รหัสดูย้อนหลังไม่ได้ ถ้าไม่โหลดตอนนี้คือต้องรีเซ็ตใหม่ทุกคน
        // (downloadCSV เติม .csv ให้เอง — เดิมส่งชื่อที่มี .csv อยู่แล้ว ไฟล์เลยได้ ".csv.csv")
        downloadCSV(
          [['ชื่อ', 'ชื่อผู้ใช้', 'รหัสผ่าน'], ...made.map((m) => [m.name, m.username, m.password])],
          'pn-users-' + new Date().toISOString().slice(0, 10)
        );
        toast('ดาวน์โหลดไฟล์รหัสผ่านแล้ว — แจกเสร็จให้ลบไฟล์ทิ้ง', 'ok');
      }
      lastData = null;
      users.load(container, true);
    } catch (e: any) {
      setFieldErr('us-b-form', errText(e, 'สร้างไม่สำเร็จ'));
    }
    busy = false;
  });
}

/* ---------------- events ---------------- */

function bindEvents(container: HTMLElement): void {
  const d = lastData || {};

  const s = container.querySelector('#us-search') as HTMLInputElement | null;
  if (s) {
    s.addEventListener('input', () => {
      search = s.value;
      const card = container.querySelector('.card');
      if (card) {
        const holder = card.querySelector('.tbl-wrap') || card.querySelector('.us-empty');
        if (holder) holder.outerHTML = rowsHtml(d);
        bindRowActions(container);
      }
    });
  }

  const add = container.querySelector('#us-add');
  if (add) add.addEventListener('click', () => openEditor(container, d, null));

  const bulk = container.querySelector('#us-bulk');
  if (bulk) bulk.addEventListener('click', () => openBulk(container, d));

  // ปุ่มดาวน์โหลดปุ่มเดียว (C4) — ไม่มีรหัสผ่านในไฟล์นี้ เป็นแค่ทะเบียนบัญชี
  bindDownloadMenu(container, 'us-dl', {
    csv: () => {
      downloadCSV(
        [['ชื่อผู้ใช้', 'ชื่อ', 'ระดับสิทธิ์', 'ผูกกับแอดมิน', 'สถานะ', 'เข้าล่าสุด'],
          ...(d.users || []).map((u) => [u.username, u.name, u.roleLabel || u.role,
            u.admin_user_id || '', u.enabled ? 'เปิด' : 'ปิด', u.last_login_at || ''])],
        'pn-user-list'
      );
    },
  });

  bindRowActions(container);
}

/** ระงับ/เปิดใช้บัญชี — ส่งคำสั่งทันที (ไม่ถามก่อน) คืนค่า true ถ้าสำเร็จ */
async function setEnabled(container: HTMLElement, u: UserRow, enabled: boolean, btn: HTMLElement | null): Promise<boolean> {
  try {
    await withBusy(btn, enabled ? 'กำลังเปิดใช้…' : 'กำลังระงับ…', () =>
      serverCall('apiUsers', { action: 'update', id: u.id, enabled }));
    lastData = null;
    users.load(container, true);
    return true;
  } catch (e: any) {
    toast(errText(e, 'ทำรายการไม่สำเร็จ'), 'error', { action: { label: 'ลองใหม่', fn: () => { void setEnabled(container, u, enabled, null); } } });
    return false;
  }
}

function bindRowActions(container: HTMLElement): void {
  const d = lastData || {};
  const find = (id: string) => (d.users || []).find((u) => String(u.id) === id) || null;

  container.querySelectorAll('[data-us-edit]').forEach((b) => {
    b.addEventListener('click', () => openEditor(container, d, find(b.getAttribute('data-us-edit')!)));
  });

  container.querySelectorAll('[data-us-reset]').forEach((b) => {
    b.addEventListener('click', async () => {
      const u = find(b.getAttribute('data-us-reset')!);
      if (!u || busy) return;
      const ok = await confirmDialog({
        title: 'รีเซ็ตรหัสผ่านของ “' + u.username + '”?',
        body: 'ระบบจะตั้งรหัสสุ่มใหม่ให้ รหัสเดิมจะใช้ไม่ได้ทันที\nคนนี้ต้องใช้รหัสใหม่ที่คุณส่งให้ และตั้งรหัสเองตอนเข้าครั้งถัดไป',
        confirmText: 'รีเซ็ตรหัสของ ' + u.username,
        danger: true,
      });
      if (!ok) return;
      busy = true;
      try {
        const r: any = await withBusy(b as HTMLElement, 'กำลังรีเซ็ต…', () => serverCall('apiUsers', { action: 'resetPassword', id: u.id }));
        showPassword('รีเซ็ตรหัสผ่านแล้ว', u.username, r.password);
        lastData = null;
        users.load(container, true);
      } catch (e: any) {
        toast(errText(e, 'รีเซ็ตไม่สำเร็จ'), 'error');
      }
      busy = false;
    });
  });

  // F4: ระงับ = ทำทันที + แถบ "เลิกทำ" (ย้อนได้ ไม่ต้องถามก่อน) · เปิดใช้คืน = ทำทันที + ข้อความสำเร็จ
  container.querySelectorAll('[data-us-toggle]').forEach((b) => {
    b.addEventListener('click', async () => {
      const u = find(b.getAttribute('data-us-toggle')!);
      if (!u || busy) return;
      busy = true;
      const turnOn = !u.enabled;
      const ok = await setEnabled(container, u, turnOn, b as HTMLElement);
      busy = false;
      if (!ok) return;
      if (turnOn) toast('เปิดใช้บัญชี “' + u.username + '” แล้ว', 'ok');
      else undoToast('ระงับบัญชี “' + u.username + '” แล้ว', () => { void setEnabled(container, u, true, null).then((r) => { if (r) toast('ยกเลิกการระงับ “' + u.username + '” แล้ว', 'ok'); }); });
    });
  });

  container.querySelectorAll('[data-us-del]').forEach((b) => {
    b.addEventListener('click', async () => {
      const u = find(b.getAttribute('data-us-del')!);
      if (!u || busy) return;
      const ok = await confirmDialog({
        title: 'ลบบัญชี “' + u.username + '” ถาวร?',
        body: 'คนนี้จะเข้าระบบไม่ได้อีก และย้อนกลับไม่ได้\nถ้าแค่อยากหยุดชั่วคราว ใช้ “ระงับบัญชี” แทน',
        confirmText: 'ลบบัญชี ' + u.username,
        danger: true,
      });
      if (!ok) return;
      busy = true;
      try {
        await withBusy(b as HTMLElement, 'กำลังลบ…', () => serverCall('apiUsers', { action: 'delete', id: u.id }));
        toast('ลบบัญชี “' + u.username + '” แล้ว', 'ok');
        lastData = null;
        users.load(container, true);
      } catch (e: any) {
        toast(errText(e, 'ลบไม่สำเร็จ'), 'error');
      }
      busy = false;
    });
  });
}

/* ---------------- render / fetch ---------------- */

function render(container: HTMLElement): void {
  container.innerHTML = bodyHtml(lastData || {});
  bindEvents(container);
}

function fetchAndRender(container: HTMLElement): void {
  const seq = ++reqSeq;
  serverCall<UsersData>('apiUsers', { action: 'list' })
    .then((data) => {
      if (seq !== reqSeq) return;
      lastData = data;
      const modalRoot = document.getElementById('modal-root');
      if (modalRoot && modalRoot.innerHTML) {
        // มี modal เปิดอยู่ — อย่าวาดทับ แต่วาดทันทีที่ปิด
        // (เดิม return เฉยๆ: หลังรีเซ็ตรหัส/สร้างบัญชี หน้าต่างรหัสผ่านเปิดค้าง ข้อมูลมาถึงระหว่างนั้น
        //  ปิดหน้าต่างแล้วหน้าค้างที่โครงร่างโหลดจนกว่าจะสลับหน้าไปมา)
        const onModal = (ev: Event) => {
          const det = (ev as CustomEvent).detail;
          if (det && det.open) return;
          document.removeEventListener('pn:modal', onModal);
          if (seq === reqSeq && lastData === data) render(container);
        };
        document.addEventListener('pn:modal', onModal);
        return;
      }
      const ae = document.activeElement;
      if (ae && container.contains(ae) && ae.tagName === 'INPUT') return;
      render(container);
    })
    .catch((err) => {
      if (seq !== reqSeq) return;
      if (lastData) toast('โหลดข้อมูลใหม่ไม่สำเร็จ', 'error', { action: { label: 'ลองใหม่', fn: () => users.load(container, true) } });
      else showError(container, (err && err.message) || 'เรียกข้อมูลไม่สำเร็จ', () => users.load(container, true));
    });
}

export const users = {
  load: async (container: HTMLElement, force?: boolean): Promise<void> => {
    if (lastData && !force) {
      render(container);
      fetchAndRender(container);
    } else {
      container.innerHTML = usersSkel();
      fetchAndRender(container);
    }
  },
};
