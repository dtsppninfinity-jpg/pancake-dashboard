/* ============================================================
   users — หน้าจัดการผู้ใช้งาน (เฉพาะ superadmin)
   สร้าง/แก้/ปิด/ลบบัญชี • รีเซ็ตรหัส • สร้างยกชุดจากรายชื่อแอดมิน Pancake
   รหัสผ่านแสดง "ครั้งเดียว" ตอนสร้าง/รีเซ็ต — DB เก็บแค่ hash ย้อนดูไม่ได้
   ============================================================ */

import {
  serverCall, esc, fmtNum, relTime, showError, toast, openModal, closeModal, downloadCSV,
} from '@/lib/ui/helpers';

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

const ROLE_ICON: Record<string, string> = { superadmin: '🔧', exec: '👔', admin: '🎧' };

/* ---------------- ชิ้นส่วน HTML ---------------- */

function toolbarHtml(d: UsersData): string {
  const noAcc = (d.admins || []).filter((a) => !a.hasAccount).length;
  return '<div class="pg-controls">' +
    '<input class="input" id="us-search" placeholder="🔎 ค้นหาชื่อ / username..." value="' + esc(search) + '" style="width:240px">' +
    '<button class="btn primary" id="us-add">➕ เพิ่มผู้ใช้</button>' +
    '<button class="btn" id="us-bulk" title="สร้างบัญชีให้แอดมินที่ยังไม่มี">👥 สร้างยกชุดจากแอดมิน' +
      (noAcc ? ' (' + noAcc + ')' : '') + '</button>' +
    '<div class="spacer"></div>' +
    '<button class="btn" id="us-csv">📄 CSV</button>' +
    '</div>';
}

function summaryHtml(d: UsersData): string {
  const u = d.users || [];
  const n = (r: string) => u.filter((x) => x.role === r).length;
  return '<div class="pg-summary">' +
    '<div class="pgs-item"><b>' + fmtNum(u.length) + '</b><span>บัญชีทั้งหมด</span></div>' +
    '<div class="pgs-item"><b>' + fmtNum(n('superadmin')) + '</b><span>ผู้ดูแลระบบ</span></div>' +
    '<div class="pgs-item"><b>' + fmtNum(n('exec')) + '</b><span>ระดับบริหาร</span></div>' +
    '<div class="pgs-item"><b>' + fmtNum(n('admin')) + '</b><span>ระดับแอดมิน</span></div>' +
    '<div class="pgs-item' + (u.filter((x) => !x.enabled).length ? ' warn' : '') + '"><b>' +
      fmtNum(u.filter((x) => !x.enabled).length) + '</b><span>ปิดใช้งาน</span></div>' +
    '</div>';
}

function rowsHtml(d: UsersData): string {
  const q = search.trim().toLowerCase();
  const list = (d.users || []).filter((u) =>
    !q || String(u.username).toLowerCase().indexOf(q) >= 0 || String(u.name).toLowerCase().indexOf(q) >= 0);

  if (!list.length) return '<div class="empty">ไม่พบผู้ใช้ที่ค้นหา</div>';

  const adminName: Record<string, string> = {};
  (d.admins || []).forEach((a) => { adminName[a.id] = a.name; });

  const body = list.map((u) => {
    const isMe = d.me && d.me.username === u.username;
    return '<tr' + (u.enabled ? '' : ' class="row-off"') + '>' +
      '<td><b>' + esc(u.username) + '</b>' + (isMe ? ' <span class="badge neutral">คุณ</span>' : '') +
        (u.must_change_pw ? ' <span class="badge urgent" title="ยังไม่ได้ตั้งรหัสใหม่">รอตั้งรหัส</span>' : '') + '</td>' +
      '<td>' + esc(u.name) + '</td>' +
      '<td>' + (ROLE_ICON[u.role] || '') + ' ' + esc(u.roleLabel || u.role) + '</td>' +
      '<td>' + esc(u.admin_user_id ? (adminName[u.admin_user_id] || u.admin_user_id) : '—') + '</td>' +
      '<td>' + (u.enabled ? '<span class="badge ai">เปิด</span>' : '<span class="badge urgent">ปิด</span>') + '</td>' +
      '<td>' + esc(u.last_login_at ? relTime(u.last_login_at) : 'ยังไม่เคยเข้า') + '</td>' +
      '<td class="us-actions">' +
        '<button class="btn-mini" data-us-edit="' + u.id + '">✏️ แก้ไข</button>' +
        '<button class="btn-mini" data-us-reset="' + u.id + '" title="ตั้งรหัสใหม่แบบสุ่ม">🔑 รีเซ็ตรหัส</button>' +
        '<button class="btn-mini" data-us-toggle="' + u.id + '">' + (u.enabled ? '⏸ ปิด' : '▶ เปิด') + '</button>' +
        (isMe ? '' : '<button class="btn-mini danger" data-us-del="' + u.id + '">🗑 ลบ</button>') +
      '</td></tr>';
  }).join('');

  return '<div class="tbl-wrap"><table class="tbl">' +
    '<thead><tr><th>ชื่อผู้ใช้</th><th>ชื่อ</th><th>ระดับสิทธิ์</th><th>ผูกกับแอดมิน</th>' +
    '<th>สถานะ</th><th>เข้าล่าสุด</th><th>จัดการ</th></tr></thead>' +
    '<tbody>' + body + '</tbody></table></div>';
}

function bodyHtml(d: UsersData): string {
  if (d.error) return '<div class="card"><div class="empty">⛔ ' + esc(d.error) + '</div></div>';
  return toolbarHtml(d) + summaryHtml(d) +
    '<div class="card">' +
      '<h3>🔐 บัญชีผู้ใช้งาน</h3>' +
      '<div class="card-sub">ระดับแอดมิน = เห็นเฉพาะผลงานของตัวเอง • ระดับบริหาร = เห็นทุกหน้า • ผู้ดูแลระบบ = จัดการผู้ใช้ได้</div>' +
      rowsHtml(d) +
    '</div>';
}

/* ---------------- modal ---------------- */

/** โชว์รหัสผ่านครั้งเดียว — ย้ำให้คัดลอกเก็บ เพราะดูย้อนหลังไม่ได้ */
function showPassword(title: string, username: string, password: string): void {
  openModal(
    '<div class="modal-head"><h3>' + esc(title) + '</h3>' +
    '<button class="btn modal-close">✕</button></div>' +
    '<div class="hint-box">⚠️ รหัสนี้แสดง <b>ครั้งเดียว</b> — คัดลอกเก็บก่อนปิดหน้าต่าง (ระบบเก็บแค่ค่าเข้ารหัส ดูย้อนหลังไม่ได้)</div>' +
    '<div class="pw-box">' +
      '<div class="me-kv"><span>ชื่อผู้ใช้</span><b>' + esc(username) + '</b></div>' +
      '<div class="me-kv"><span>รหัสผ่าน</span><b class="pw-val">' + esc(password) + '</b></div>' +
    '</div>' +
    '<div class="card-sub">ผู้ใช้จะถูกบังคับตั้งรหัสใหม่ตอนเข้าครั้งแรก</div>' +
    '<div class="modal-actions">' +
      '<button class="btn" id="pw-copy">📋 คัดลอก</button>' +
      '<button class="btn primary modal-close">เรียบร้อย</button>' +
    '</div>'
  );
  const copy = document.getElementById('pw-copy');
  if (copy) {
    copy.addEventListener('click', () => {
      navigator.clipboard.writeText(username + ' / ' + password)
        .then(() => toast('📋 คัดลอกแล้ว'))
        .catch(() => toast('⚠️ คัดลอกไม่สำเร็จ — เลือกข้อความเอง'));
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

function openEditor(container: HTMLElement, d: UsersData, user: UserRow | null): void {
  const isNew = !user;
  const roles = d.roles || [{ key: 'admin', label: 'ระดับแอดมิน' }];
  openModal(
    '<div class="modal-head"><h3>' + (isNew ? '➕ เพิ่มผู้ใช้' : '✏️ แก้ไข ' + esc(user!.username)) + '</h3>' +
    '<button class="btn modal-close">✕</button></div>' +
    '<div class="adm-form">' +
      (isNew
        ? '<label class="adm-field"><span>ชื่อผู้ใช้ (a-z 0-9 . _ -)</span>' +
          '<input class="input" id="us-f-username" autocapitalize="none" spellcheck="false" placeholder="เช่น somchai"></label>'
        : '') +
      '<label class="adm-field"><span>ชื่อที่แสดง</span>' +
        '<input class="input" id="us-f-name" value="' + esc(user ? user.name : '') + '"></label>' +
      '<label class="adm-field"><span>ระดับสิทธิ์</span><select class="input" id="us-f-role">' +
        roles.map((r) => '<option value="' + esc(r.key) + '"' +
          (user && user.role === r.key ? ' selected' : '') + '>' + esc(r.label) + '</option>').join('') +
      '</select></label>' +
      '<label class="adm-field"><span>ผูกกับแอดมิน (จำเป็นสำหรับระดับแอดมิน)</span>' +
        '<select class="input" id="us-f-admin">' + adminOptions(d, user ? String(user.admin_user_id || '') : '') + '</select></label>' +
    '</div>' +
    '<div class="hint-box">บัญชีใหม่จะได้รหัสผ่านสุ่ม และถูกบังคับตั้งรหัสใหม่ตอนเข้าครั้งแรก</div>' +
    '<div class="modal-actions">' +
      '<button class="btn modal-close">ยกเลิก</button>' +
      '<button class="btn primary" id="us-f-save">บันทึก</button>' +
    '</div>'
  );

  document.getElementById('us-f-save')!.addEventListener('click', async () => {
    if (busy) return;
    const val = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value || '';
    const params: any = {
      action: isNew ? 'create' : 'update',
      name: val('us-f-name'),
      role: val('us-f-role'),
      adminUserId: val('us-f-admin'),
    };
    if (isNew) params.username = val('us-f-username');
    else params.id = user!.id;

    busy = true;
    try {
      const r: any = await serverCall('apiUsers', params);
      closeModal();
      if (isNew && r.password) showPassword('สร้างบัญชีแล้ว', r.username, r.password);
      else toast('✅ บันทึกแล้ว');
      lastData = null;
      users.load(container, true);
    } catch (e: any) {
      toast('❌ ' + ((e && e.message) || 'บันทึกไม่สำเร็จ'));
    }
    busy = false;
  });
}

function openBulk(container: HTMLElement, d: UsersData): void {
  const pool = (d.admins || []).filter((a) => !a.hasAccount);
  if (!pool.length) {
    toast('✅ แอดมินทุกคนมีบัญชีแล้ว');
    return;
  }
  openModal(
    '<div class="modal-head"><h3>👥 สร้างบัญชียกชุด</h3><button class="btn modal-close">✕</button></div>' +
    '<div class="card-sub">แอดมินที่ยังไม่มีบัญชี ' + pool.length + ' คน — เลือกคนที่จะสร้างให้</div>' +
    '<div class="bulk-actions">' +
      '<button class="btn btn-mini" id="us-b-all">เลือกทั้งหมด</button>' +
      '<button class="btn btn-mini" id="us-b-none">ไม่เลือกเลย</button>' +
    '</div>' +
    '<div class="page-pick-list">' +
      pool.map((a) => '<label class="page-pick"><input type="checkbox" class="us-b-chk" value="' + esc(a.id) + '" checked> ' +
        esc(a.name) + (a.email ? ' <span class="card-sub">' + esc(a.email) + '</span>' : '') + '</label>').join('') +
    '</div>' +
    '<div class="hint-box">ทุกบัญชีได้รหัสสุ่ม + ต้องตั้งรหัสใหม่ตอนเข้าครั้งแรก — ระบบจะให้ดาวน์โหลด CSV รายชื่อ+รหัสไปแจก</div>' +
    '<div class="modal-actions">' +
      '<button class="btn modal-close">ยกเลิก</button>' +
      '<button class="btn primary" id="us-b-go">สร้างบัญชี</button>' +
    '</div>'
  );

  const chks = () => Array.from(document.querySelectorAll('.us-b-chk')) as HTMLInputElement[];
  document.getElementById('us-b-all')!.addEventListener('click', () => chks().forEach((c) => { c.checked = true; }));
  document.getElementById('us-b-none')!.addEventListener('click', () => chks().forEach((c) => { c.checked = false; }));

  document.getElementById('us-b-go')!.addEventListener('click', async () => {
    if (busy) return;
    const ids = chks().filter((c) => c.checked).map((c) => c.value);
    if (!ids.length) { toast('⚠️ ยังไม่ได้เลือกใคร'); return; }
    busy = true;
    toast('⏳ กำลังสร้าง ' + ids.length + ' บัญชี...');
    try {
      const r: any = await serverCall('apiUsers', { action: 'createBulk', adminUserIds: ids });
      closeModal();
      const made: any[] = r.created || [];
      toast('✅ สร้างแล้ว ' + made.length + ' บัญชี');
      if (made.length) {
        // ดาวน์โหลดทันที — รหัสดูย้อนหลังไม่ได้ ถ้าไม่โหลดตอนนี้คือต้องรีเซ็ตใหม่ทุกคน
        downloadCSV(
          [['ชื่อ', 'ชื่อผู้ใช้', 'รหัสผ่าน'], ...made.map((m) => [m.name, m.username, m.password])],
          'pn-users-' + new Date().toISOString().slice(0, 10) + '.csv'
        );
        toast('💾 ดาวน์โหลดไฟล์รหัสผ่านแล้ว — แจกเสร็จให้ลบไฟล์ทิ้ง');
      }
      lastData = null;
      users.load(container, true);
    } catch (e: any) {
      toast('❌ ' + ((e && e.message) || 'สร้างไม่สำเร็จ'));
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
        const holder = card.querySelector('.tbl-wrap') || card.querySelector('.empty');
        if (holder) holder.outerHTML = rowsHtml(d);
        bindRowActions(container);
      }
    });
  }

  const add = container.querySelector('#us-add');
  if (add) add.addEventListener('click', () => openEditor(container, d, null));

  const bulk = container.querySelector('#us-bulk');
  if (bulk) bulk.addEventListener('click', () => openBulk(container, d));

  const csv = container.querySelector('#us-csv');
  if (csv) {
    csv.addEventListener('click', () => {
      // ไม่มีรหัสผ่านในไฟล์นี้ — เป็นแค่ทะเบียนบัญชี
      downloadCSV(
        [['ชื่อผู้ใช้', 'ชื่อ', 'ระดับสิทธิ์', 'ผูกกับแอดมิน', 'สถานะ', 'เข้าล่าสุด'],
          ...(d.users || []).map((u) => [u.username, u.name, u.roleLabel || u.role,
            u.admin_user_id || '', u.enabled ? 'เปิด' : 'ปิด', u.last_login_at || ''])],
        'pn-user-list.csv'
      );
    });
  }

  bindRowActions(container);
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
      if (!confirm('รีเซ็ตรหัสผ่านของ "' + u.username + '" เป็นรหัสสุ่มใหม่?\nรหัสเดิมจะใช้ไม่ได้ทันที')) return;
      busy = true;
      try {
        const r: any = await serverCall('apiUsers', { action: 'resetPassword', id: u.id });
        showPassword('รีเซ็ตรหัสผ่านแล้ว', u.username, r.password);
        lastData = null;
        users.load(container, true);
      } catch (e: any) {
        toast('❌ ' + ((e && e.message) || 'รีเซ็ตไม่สำเร็จ'));
      }
      busy = false;
    });
  });

  container.querySelectorAll('[data-us-toggle]').forEach((b) => {
    b.addEventListener('click', async () => {
      const u = find(b.getAttribute('data-us-toggle')!);
      if (!u || busy) return;
      busy = true;
      try {
        await serverCall('apiUsers', { action: 'update', id: u.id, enabled: !u.enabled });
        toast(u.enabled ? '⏸ ปิดใช้งานแล้ว' : '▶ เปิดใช้งานแล้ว');
        lastData = null;
        users.load(container, true);
      } catch (e: any) {
        toast('❌ ' + ((e && e.message) || 'ทำรายการไม่สำเร็จ'));
      }
      busy = false;
    });
  });

  container.querySelectorAll('[data-us-del]').forEach((b) => {
    b.addEventListener('click', async () => {
      const u = find(b.getAttribute('data-us-del')!);
      if (!u || busy) return;
      if (!confirm('ลบบัญชี "' + u.username + '" ถาวร?\nคนนี้จะเข้าระบบไม่ได้อีก')) return;
      busy = true;
      try {
        await serverCall('apiUsers', { action: 'delete', id: u.id });
        toast('🗑 ลบแล้ว');
        lastData = null;
        users.load(container, true);
      } catch (e: any) {
        toast('❌ ' + ((e && e.message) || 'ลบไม่สำเร็จ'));
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
      if (modalRoot && modalRoot.innerHTML) return; // มี modal เปิดอยู่ — อย่าวาดทับ
      const ae = document.activeElement;
      if (ae && container.contains(ae) && ae.tagName === 'INPUT') return;
      render(container);
    })
    .catch((err) => {
      if (seq !== reqSeq) return;
      if (lastData) toast('⚠️ โหลดข้อมูลใหม่ไม่สำเร็จ');
      else showError(container, (err && err.message) || 'เรียกข้อมูลไม่สำเร็จ', () => users.load(container, true));
    });
}

export const users = {
  load: async (container: HTMLElement, force?: boolean): Promise<void> => {
    if (lastData && !force) {
      render(container);
      fetchAndRender(container);
    } else {
      container.innerHTML = '<div class="card"><div class="skel-line"></div><div class="skel-line"></div></div>';
      fetchAndRender(container);
    }
  },
};
