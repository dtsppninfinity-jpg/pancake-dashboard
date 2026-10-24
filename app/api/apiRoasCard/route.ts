import { apiRoasCard } from '@/lib/api/roascard';

export const dynamic = 'force-dynamic';
// รอระบบการ์ด ROAS — แย่สุด 4 คำขอ × 20 วิ (token + ข้อมูล แล้ว token หมดกลางทางขอใหม่อีกรอบ) = 80 วิ ต้องไม่โดน Vercel ตัดก่อน
export const maxDuration = 120;

export async function POST(req: Request) {
  const params = await req.json().catch(() => ({}));
  const data = await apiRoasCard(params);
  return Response.json(data);
}
