// app/api/apiBootstrap/route.ts — endpoint สำหรับ serverCall('apiBootstrap', ...)
import { apiBootstrap } from '@/lib/api/bootstrap';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const params = await req.json().catch(() => ({}));
  const data = await apiBootstrap(params);
  return Response.json(data);
}
