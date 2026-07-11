// lib/api/adminsettings.ts — บันทึก/อ่านการตั้งค่าแอดมิน + ตารางสิทธิ์ต่อ role
// ตั้งค่าต่อคนเก็บในตาราง admin_settings (แยกจาก admins ที่โดน sync เขียนทับ)
// ตารางสิทธิ์ (role → perms) เก็บเป็น JSON ใน sync_state — pattern เดียวกับ scoreconfig
import { db } from '@/lib/db';
import { ADMIN_ROLES, defaultRolePerms, normalizeRolePermsShape, RolePerms, DEFAULT_MAX_ACTIVE } from '@/lib/adminconfig';

const ROLE_PERMS_KEY = 'admin_role_permissions';

/** ตาราง admin_settings ยังไม่ถูกสร้าง (migration ยังไม่ได้รัน) */
function isMissingTable(err: any): boolean {
  const m = String((err && err.message) || err || '');
  return m.includes('admin_settings') && (m.includes('does not exist') || m.includes('schema cache'));
}

/** ตรวจ/เติมค่า setting ของแอดมิน 1 คนให้อยู่ในช่วงที่ถูกต้องเสมอ */
export function normalizeAdminSetting(raw: any): {
  user_id: string; enabled: boolean; status_override: string; role: string;
  channels: string; product_groups: string; max_active: number; max_pending: number; note: string;
} | null {
  const userId = String((raw && raw.user_id) || '').trim();
  if (!userId || userId.length > 100) return null;
  const so = String((raw && raw.status_override) || '');
  const ch = String((raw && raw.channels) || 'both');
  const role = String((raw && raw.role) || '');
  let maxActive = Math.round(Number((raw && raw.max_active)));
  if (!isFinite(maxActive) || maxActive < 1) maxActive = DEFAULT_MAX_ACTIVE;
  if (maxActive > 9999) maxActive = 9999;
  let maxPending = Math.round(Number((raw && raw.max_pending)));
  if (!isFinite(maxPending) || maxPending < 0) maxPending = 0; // 0 = ไม่กำหนด
  if (maxPending > 9999) maxPending = 9999;
  return {
    user_id: userId,
    enabled: raw && raw.enabled !== false, // default true
    status_override: so === 'away' || so === 'busy' ? so : '',
    role: (ADMIN_ROLES as readonly string[]).indexOf(role) >= 0 ? role : '',
    channels: ch === 'facebook' || ch === 'line' ? ch : 'both',
    product_groups: String((raw && raw.product_groups) || '').slice(0, 200),
    max_active: maxActive,
    max_pending: maxPending,
    note: String((raw && raw.note) || '').slice(0, 300),
  };
}

/** ตรวจ matrix สิทธิ์ — ใช้ตัวเดียวกับฝั่ง read (adminconfig) กัน logic แตกกัน */
export function normalizeRolePerms(raw: any): RolePerms {
  return normalizeRolePermsShape(raw);
}

export async function apiAdminSettings(params: any) {
  const p = params || {};

  // ---- บันทึกตั้งค่าแอดมิน 1 คน (partial: มาเฉพาะ field ที่แก้) ----
  if (p.admin) {
    const userId = String(p.admin.user_id || '').trim();
    if (!userId) return { ok: false, error: 'ข้อมูลไม่ถูกต้อง (user_id หาย)' };

    // merge กับแถวเดิมก่อน — กัน tab ที่เปิดค้าง (state เก่า) เขียนทับ field ที่คนอื่นเพิ่งแก้
    let existing: any = null;
    {
      const { data, error } = await db.from('admin_settings').select('*').eq('user_id', userId).maybeSingle();
      if (error) {
        if (isMissingTable(error)) {
          return { ok: false, needSetup: true, error: 'ตาราง admin_settings ยังไม่ถูกสร้าง — รัน SQL migration ก่อน' };
        }
        return { ok: false, error: error.message };
      }
      existing = data;
    }
    const provided: Record<string, any> = {};
    ['enabled', 'status_override', 'role', 'channels', 'product_groups', 'max_active', 'max_pending', 'note']
      .forEach((k) => { if (p.admin[k] !== undefined) provided[k] = p.admin[k]; });
    const clean = normalizeAdminSetting({ ...(existing || {}), ...provided, user_id: userId });
    if (!clean) return { ok: false, error: 'ข้อมูลไม่ถูกต้อง' };

    // snapshot ตัวตนจากตาราง admins (pos_user_id + ชื่อ) — ให้ adminperf กันยอดขายของคน
    // ที่ถูกปิดใช้งานโผล่กลับมาเป็นแถว seller หลังเขาหลุดจาก roster ไปแล้ว
    let snap: Record<string, string> = {};
    {
      const { data: adm } = await db.from('admins').select('pos_user_id,name').eq('user_id', userId).maybeSingle();
      if (adm) {
        snap = { pos_user_id: String(adm.pos_user_id || ''), snap_name: String(adm.name || '') };
      }
    }

    const now = new Date().toISOString();
    const payload: Record<string, any> = { ...clean, ...snap, updated_at: now };
    let droppedMaxPending = false;
    let { error } = await db
      .from('admin_settings')
      .upsert(payload, { onConflict: 'user_id' });
    if (error && String(error.message || '').includes('max_pending')) {
      // คอลัมน์ max_pending ยังไม่ถูกสร้าง (migration v3) — ตัดออกแล้วบันทึกส่วนที่เหลือ
      // แต่ต้อง "บอกความจริง" กลับไปด้วย ไม่ใช่ปล่อยให้ user คิดว่าค่านี้ถูกบันทึกแล้ว
      delete payload.max_pending;
      droppedMaxPending = true;
      ({ error } = await db.from('admin_settings').upsert(payload, { onConflict: 'user_id' }));
    }
    if (error && Object.keys(snap).length) {
      // คอลัมน์ snapshot อาจยังไม่ถูกสร้าง (migration v2) — บันทึกส่วนหลักไปก่อน
      const p2: Record<string, any> = { ...clean, updated_at: now };
      if (!('max_pending' in payload)) delete p2.max_pending;
      ({ error } = await db.from('admin_settings').upsert(p2, { onConflict: 'user_id' }));
    }
    if (error) {
      if (isMissingTable(error)) {
        return { ok: false, needSetup: true, error: 'ตาราง admin_settings ยังไม่ถูกสร้าง — รัน SQL migration ก่อน' };
      }
      return { ok: false, error: error.message };
    }
    return {
      ok: true,
      admin: clean,
      warning: droppedMaxPending && p.admin.max_pending !== undefined
        ? 'บันทึกแล้ว ยกเว้น "เพดานแชทรอตอบ" — ต้องรัน migration v3 (max_pending) ใน Supabase ก่อน'
        : undefined,
    };
  }

  // ---- บันทึกตารางสิทธิ์ role ----
  if (p.rolePerms) {
    const clean = normalizeRolePerms(p.rolePerms);
    const { error } = await db
      .from('sync_state')
      .upsert(
        { key: ROLE_PERMS_KEY, value: JSON.stringify(clean), updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );
    if (error) return { ok: false, error: error.message };
    return { ok: true, rolePerms: clean };
  }

  // ---- อ่านทั้งหมด (settings ทุกคน + ตารางสิทธิ์) ----
  let settings: any[] = [];
  let needSetup = false;
  try {
    const { data, error } = await db.from('admin_settings').select('*');
    if (error) throw error;
    settings = data || [];
  } catch (e: any) {
    if (isMissingTable(e)) needSetup = true;
    else throw e;
  }
  const { data: rp } = await db.from('sync_state').select('value').eq('key', ROLE_PERMS_KEY).maybeSingle();
  let rolePerms = defaultRolePerms();
  if (rp && rp.value) {
    try { rolePerms = normalizeRolePerms(JSON.parse(rp.value)); } catch { /* ใช้ default */ }
  }
  return { ok: true, settings, rolePerms, needSetup };
}
