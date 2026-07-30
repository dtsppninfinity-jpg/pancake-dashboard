// app/api/apiDashboard/route.ts — route handler สำหรับ serverCall('apiDashboard', ...)
import { apiDashboard } from '@/lib/api/dashboard';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Fluid compute: Hobby ให้ถึง 300s — ช่วงวันยาวก็ 20-30s แล้ว กันหลุด 60s เริ่มต้น

export async function POST(req: Request) {
  const params = await req.json().catch(() => ({}));
  const data = await apiDashboard(params);
  return Response.json(data);
}
