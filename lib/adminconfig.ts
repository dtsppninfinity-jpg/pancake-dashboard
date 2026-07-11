// lib/adminconfig.ts — ค่าคงที่ระบบจัดการแอดมิน (Role / สิทธิ์ / สถานะ)
// ไฟล์นี้ browser-safe (มีแต่ค่าคงที่ + pure function) — import ได้ทั้ง API และ view
// ⚠️ Role/สิทธิ์เป็น "ทะเบียนจัดการทีม" ใน dashboard เท่านั้น — ไม่ได้บังคับการเข้าถึงจริง
//    (เว็บใช้รหัสผ่านทีมเดียว) และไม่มีผลใดๆ กับบัญชี Pancake ของแอดมิน

/** 7 role ตามต้นแบบที่บอสเห็น (เรียงจากสิทธิ์มาก → น้อย) */
export const ADMIN_ROLES = [
  'Super Admin', 'Manager', 'Senior Admin', 'Sales Admin', 'Support Admin', 'Read Only', 'Disabled',
] as const;

/** สิทธิ์ 13 ข้อ + ป้ายภาษาไทย (ตามต้นแบบ) */
export const PERM_LABELS: Record<string, string> = {
  viewAllPages: 'เห็นทุกเพจ (ไม่ติ๊ก = เห็นเฉพาะที่ได้รับมอบหมาย)',
  viewAllLines: 'เห็นทุก LINE OA (ไม่ติ๊ก = เฉพาะที่ได้รับมอบหมาย)',
  receiveChats: 'รับแชทใหม่ได้',
  transferChats: 'โอนแชทได้',
  closeSales: 'ปิดการขายได้',
  editTags: 'แก้แท็กได้',
  editKB: 'แก้ Knowledge Base ได้',
  editAutomation: 'แก้ Automation Rules ได้',
  toggleAI: 'เปิด/ปิด AI ได้',
  emergencyStop: 'ใช้ Emergency Stop ได้',
  exportReports: 'Export Report ได้',
  configRouting: 'ตั้งค่า Admin Routing ได้',
  manageAdmins: 'จัดการแอดมินคนอื่นได้',
};

export type RolePerms = Record<string, Record<string, boolean>>;

/** ตารางสิทธิ์เริ่มต้นต่อ role (matrix เดียวกับต้นแบบ) */
export function defaultRolePerms(): RolePerms {
  const P = (over: Record<string, boolean> = {}) => {
    const base: Record<string, boolean> = {};
    Object.keys(PERM_LABELS).forEach((k) => { base[k] = false; });
    base.receiveChats = true;
    return { ...base, ...over };
  };
  const ALL: Record<string, boolean> = {};
  Object.keys(PERM_LABELS).forEach((k) => { ALL[k] = true; });
  return {
    'Super Admin': { ...ALL },
    'Manager': P({
      viewAllPages: true, viewAllLines: true, transferChats: true, closeSales: true, editTags: true,
      editKB: true, toggleAI: true, emergencyStop: true, exportReports: true, configRouting: true, manageAdmins: true,
    }),
    'Senior Admin': P({ viewAllPages: true, viewAllLines: true, transferChats: true, closeSales: true, editTags: true, exportReports: true }),
    'Sales Admin': P({ closeSales: true, editTags: true }),
    'Support Admin': P({ transferChats: true, editTags: true }),
    'Read Only': P({ receiveChats: false }),
    'Disabled': P({ receiveChats: false }),
  };
}

/** ตรวจ matrix สิทธิ์: รับเฉพาะ role/perm ที่รู้จัก ค่าเป็น boolean เท่านั้น (เติม default ที่เหลือ) */
export function normalizeRolePermsShape(raw: any): RolePerms {
  const base = defaultRolePerms();
  if (!raw || typeof raw !== 'object') return base;
  ADMIN_ROLES.forEach((role) => {
    const r = raw[role];
    if (!r || typeof r !== 'object') return;
    Object.keys(PERM_LABELS).forEach((perm) => {
      if (typeof r[perm] === 'boolean') base[role][perm] = r[perm];
    });
  });
  return base;
}

/** สถานะที่แสดงบนการ์ด (คำนวณจาก enabled + override + is_online จริงจาก Pancake) */
export const ADMIN_STATUS_META: Record<string, { label: string; cls: string; dot: string }> = {
  online:   { label: '🟢 ออนไลน์',   cls: 'ai',      dot: 'on' },
  away:     { label: '🟡 พัก',        cls: 'admin',   dot: 'away' },
  busy:     { label: '🔴 ไม่ว่าง',    cls: 'urgent',  dot: 'busy' },
  offline:  { label: '⚪ ออฟไลน์',   cls: 'neutral', dot: 'off' },
  disabled: { label: '⛔ ปิดใช้งาน', cls: 'urgent',  dot: 'disabled' },
};

/** สถานะรวมของแอดมิน 1 คน: ปิดใช้งาน > override (พัก/ไม่ว่าง) > ออนไลน์จริง */
export function effectiveStatus(enabled: boolean, statusOverride: string, online: boolean): string {
  if (!enabled) return 'disabled';
  if (statusOverride === 'away' || statusOverride === 'busy') return statusOverride;
  return online ? 'online' : 'offline';
}

/** เพดานแชทที่ดูแลเริ่มต้น — ทีม PN Infinity ดูแลจริง ~300-560 แชท/24ชม. (boss เลือก 600, 2026-07-11) */
export const DEFAULT_MAX_ACTIVE = 600;

/** ป้าย capacity จากจำนวนแชทที่ดูแล (24 ชม.) เทียบเพดาน */
export function capacityOf(active: number, maxActive: number): { key: string; label: string; cls: string } {
  const max = maxActive > 0 ? maxActive : DEFAULT_MAX_ACTIVE;
  if (active >= max) return { key: 'full', label: 'เต็มแล้ว', cls: 'urgent' };
  if (active / max >= 0.75) return { key: 'near', label: 'ใกล้เต็ม', cls: 'admin' };
  return { key: 'available', label: 'ว่างรับแชท', cls: 'ai' };
}
