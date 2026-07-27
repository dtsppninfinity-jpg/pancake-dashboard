// lib/api/users.ts — จัดการบัญชีผู้ใช้เว็บ (เฉพาะ superadmin)
//
// ทุก action เช็คสิทธิ์ซ้ำที่นี่อีกชั้น ไม่พึ่ง middleware อย่างเดียว — เพราะ session เป็น cookie ที่
// เซ็นไว้ ถ้าลด role ของใครแล้ว cookie ใบเดิมยังใช้ได้จนหมดอายุ การเช็คกับ DB จึงตัดสิทธิ์ได้ทันที
import { db, fetchAll } from '@/lib/db';
import { caller } from '@/lib/api/session';
import { hashPassword, randomPassword, findUser } from '@/lib/auth';
import { ROLE_LABEL, type Role } from '@/lib/auth-session';

const ROLES: Role[] = ['superadmin', 'exec', 'admin'];

function err_(msg: string, status = 400): never {
  const e: any = new Error(msg);
  e.status = status;
  throw e;
}

/** ยืนยันว่าคนเรียกยังเป็น superadmin "ตอนนี้" จริง (อ่านจาก DB ไม่ใช่จาก cookie) */
async function requireSuperadmin_() {
  const c = await caller();
  if (!c.username) err_('ยังไม่ได้เข้าสู่ระบบ', 401);
  const u = await findUser(c.username);
  if (!u || !u.enabled || u.role !== 'superadmin') err_('เฉพาะผู้ดูแลระบบเท่านั้น', 403);
  return u;
}

function cleanUsername_(v: unknown): string {
  const u = String(v || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(u)) {
    err_('ชื่อผู้ใช้ต้องเป็น a-z 0-9 . _ - ยาว 3-32 ตัว');
  }
  return u;
}

function cleanRole_(v: unknown): Role {
  const r = String(v || '') as Role;
  if (ROLES.indexOf(r) < 0) err_('ระดับสิทธิ์ไม่ถูกต้อง');
  return r;
}

export async function apiUsers(params: any) {
  const me = await requireSuperadmin_();
  const action = String((params && params.action) || 'list');

  /* ---------------- อ่านรายชื่อ + รายชื่อแอดมินให้เลือกผูก ---------------- */
  if (action === 'list') {
    const users = await fetchAll<any>(() =>
      db.from('app_users')
        .select('id,username,name,role,admin_user_id,enabled,must_change_pw,last_login_at,created_at'),
      'id'
    );
    // แอดมิน Pancake ทั้งหมด — ใช้เลือกผูกบัญชี + บอกว่าใครยังไม่มีบัญชี
    const admins = await fetchAll<any>(() => db.from('admins').select('user_id,name,email'), 'user_id');
    const linked = new Set(users.map((u) => String(u.admin_user_id || '')));
    return {
      users: users.map((u) => ({ ...u, roleLabel: ROLE_LABEL[u.role as Role] || u.role })),
      admins: admins.map((a) => ({
        id: String(a.user_id),
        name: String(a.name || ''),
        email: String(a.email || ''),
        hasAccount: linked.has(String(a.user_id)),
      })),
      me: { username: me.username, role: me.role },
      roles: ROLES.map((r) => ({ key: r, label: ROLE_LABEL[r] })),
    };
  }

  /* ---------------- สร้างบัญชีใหม่ ---------------- */
  if (action === 'create') {
    const username = cleanUsername_(params.username);
    const role = cleanRole_(params.role);
    const name = String(params.name || '').trim() || username;
    const adminUserId = String(params.adminUserId || '').trim() || null;
    if (role === 'admin' && !adminUserId) err_('บัญชีระดับแอดมินต้องผูกกับแอดมินในระบบ (ไม่งั้นจะไม่มีข้อมูลให้ดู)');
    if (await findUser(username)) err_('ชื่อผู้ใช้นี้ถูกใช้แล้ว');

    const password = String(params.password || '') || randomPassword(10);
    if (password.length < 8) err_('รหัสผ่านต้องยาวอย่างน้อย 8 ตัว');

    const { error } = await db.from('app_users').insert({
      username,
      password_hash: await hashPassword(password),
      name,
      role,
      admin_user_id: adminUserId,
      enabled: true,
      must_change_pw: true, // บังคับตั้งรหัสใหม่ตอนเข้าครั้งแรกเสมอ
      updated_at: new Date().toISOString(),
    });
    if (error) err_('สร้างบัญชีไม่สำเร็จ: ' + error.message, 500);
    // คืนรหัสผ่านครั้งเดียว — DB เก็บแค่ hash ย้อนดูไม่ได้
    return { ok: true, username, password };
  }

  /* ---------------- สร้างยกชุดจากแอดมินที่ยังไม่มีบัญชี ---------------- */
  if (action === 'createBulk') {
    const ids: string[] = Array.isArray(params.adminUserIds) ? params.adminUserIds.map(String) : [];
    if (!ids.length) err_('ยังไม่ได้เลือกแอดมิน');

    const admins = await fetchAll<any>(() => db.from('admins').select('user_id,name,email'), 'user_id');
    const byId: Record<string, any> = {};
    admins.forEach((a) => { byId[String(a.user_id)] = a; });

    const existing = await fetchAll<any>(() => db.from('app_users').select('username,admin_user_id'), 'username');
    const taken = new Set(existing.map((u) => String(u.username).toLowerCase()));
    const linked = new Set(existing.map((u) => String(u.admin_user_id || '')));

    const made: { name: string; username: string; password: string }[] = [];
    let seq = 1;
    for (const id of ids) {
      const a = byId[id];
      if (!a || linked.has(id)) continue; // ไม่มีตัวตน หรือมีบัญชีแล้ว
      // username จาก local part ของอีเมล ถ้าใช้ไม่ได้ค่อย adm01, adm02...
      let base = String(a.email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
      if (base.length < 3) base = 'adm' + String(seq).padStart(2, '0');
      let username = base;
      let n = 2;
      while (taken.has(username)) username = base + n++;
      taken.add(username);
      seq++;

      const password = randomPassword(10);
      const { error } = await db.from('app_users').insert({
        username,
        password_hash: await hashPassword(password),
        name: String(a.name || username),
        role: 'admin',
        admin_user_id: id,
        enabled: true,
        must_change_pw: true,
        updated_at: new Date().toISOString(),
      });
      if (error) continue;
      made.push({ name: String(a.name || ''), username, password });
    }
    return { ok: true, created: made };
  }

  /* ---------------- แก้ไข (ชื่อ / role / ผูกแอดมิน / เปิด-ปิด) ---------------- */
  if (action === 'update') {
    const id = Number(params.id);
    if (!id) err_('ไม่พบบัญชีที่จะแก้');
    const patch: any = { updated_at: new Date().toISOString() };
    if (params.name !== undefined) patch.name = String(params.name || '').trim();
    if (params.role !== undefined) patch.role = cleanRole_(params.role);
    if (params.adminUserId !== undefined) patch.admin_user_id = String(params.adminUserId || '').trim() || null;
    if (params.enabled !== undefined) patch.enabled = !!params.enabled;
    if (patch.role === 'admin' && patch.admin_user_id === null) {
      err_('บัญชีระดับแอดมินต้องผูกกับแอดมินในระบบ');
    }

    // กันล็อกตัวเองออกจากระบบ: superadmin คนสุดท้ายห้ามถูกลดสิทธิ์หรือปิดใช้งาน
    if (patch.role && patch.role !== 'superadmin' || patch.enabled === false) {
      const supers = await fetchAll<any>(() =>
        db.from('app_users').select('id,role,enabled').eq('role', 'superadmin').eq('enabled', true), 'id');
      if (supers.length <= 1 && supers.some((s) => Number(s.id) === id)) {
        err_('ต้องเหลือผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 คน');
      }
    }

    const { error } = await db.from('app_users').update(patch).eq('id', id);
    if (error) err_('บันทึกไม่สำเร็จ: ' + error.message, 500);
    return { ok: true };
  }

  /* ---------------- รีเซ็ตรหัสผ่าน ---------------- */
  if (action === 'resetPassword') {
    const id = Number(params.id);
    if (!id) err_('ไม่พบบัญชีที่จะรีเซ็ต');
    const password = randomPassword(10);
    const { error } = await db
      .from('app_users')
      .update({ password_hash: await hashPassword(password), must_change_pw: true, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) err_('รีเซ็ตไม่สำเร็จ: ' + error.message, 500);
    return { ok: true, password };
  }

  /* ---------------- ลบบัญชี ---------------- */
  if (action === 'delete') {
    const id = Number(params.id);
    if (!id) err_('ไม่พบบัญชีที่จะลบ');
    const { data: target } = await db.from('app_users').select('id,username,role').eq('id', id).maybeSingle();
    if (target && String(target.username) === me.username) err_('ลบบัญชีตัวเองไม่ได้');
    if (target && target.role === 'superadmin') {
      const supers = await fetchAll<any>(() => db.from('app_users').select('id').eq('role', 'superadmin'), 'id');
      if (supers.length <= 1) err_('ต้องเหลือผู้ดูแลระบบอย่างน้อย 1 คน');
    }
    const { error } = await db.from('app_users').delete().eq('id', id);
    if (error) err_('ลบไม่สำเร็จ: ' + error.message, 500);
    return { ok: true };
  }

  err_('ไม่รู้จักคำสั่ง: ' + action);
}
