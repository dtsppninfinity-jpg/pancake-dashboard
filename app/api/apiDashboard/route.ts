// app/api/apiDashboard/route.ts — route handler สำหรับ serverCall('apiDashboard', ...)
import { apiDashboard } from '@/lib/api/dashboard';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const params = await req.json().catch(() => ({}));
  const data = await apiDashboard(params);
  return Response.json(data);
}
