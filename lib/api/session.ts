// lib/api/session.ts — อ่านตัวตนผู้ใช้ใน route handler (มาจาก header ที่ middleware เซ็ตไว้)
//
// middleware ตรวจลายเซ็น cookie แล้วยัด x-pn-user / x-pn-role / x-pn-admin-id ลง request header
// route handler จึงเชื่อค่าเหล่านี้ได้ — browser ปลอมไม่ได้เพราะ middleware เขียนทับทุก request เสมอ
import { headers } from 'next/headers';
import type { Role } from '@/lib/auth-session';

export interface Caller {
  username: string;
  role: Role | '';
  adminUserId: string;
}

export async function caller(): Promise<Caller> {
  const h = await headers();
  return {
    username: h.get('x-pn-user') || '',
    role: (h.get('x-pn-role') || '') as Role | '',
    adminUserId: h.get('x-pn-admin-id') || '',
  };
}

/** โยน error ถ้า role ไม่อยู่ในรายการที่อนุญาต — ใช้เป็นด่านสองถัดจาก middleware */
export async function requireRole(...allowed: Role[]): Promise<Caller> {
  const c = await caller();
  if (!c.role || allowed.indexOf(c.role as Role) < 0) {
    const e: any = new Error('สิทธิ์ของคุณเข้าถึงส่วนนี้ไม่ได้');
    e.status = 403;
    throw e;
  }
  return c;
}
