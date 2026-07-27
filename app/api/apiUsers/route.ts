// app/api/apiUsers/route.ts — endpoint สำหรับ serverCall('apiUsers', ...) — เฉพาะ superadmin
import { apiUsers } from '@/lib/api/users';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // hashPassword ใช้ scrypt ของ Node

export async function POST(req: Request) {
  const params = await req.json().catch(() => ({}));
  try {
    const data = await apiUsers(params);
    return Response.json(data);
  } catch (e: any) {
    // ข้อความ error ตั้งใจให้ผู้ใช้อ่านรู้เรื่อง (ไม่มีรายละเอียดระบบ) จึงส่งกลับได้
    return Response.json({ error: e?.message || 'ทำรายการไม่สำเร็จ' }, { status: e?.status || 500 });
  }
}
