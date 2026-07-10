import { apiAdminPerf } from '@/lib/api/adminperf';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const params = await req.json().catch(() => ({}));
  const data = await apiAdminPerf(params);
  return Response.json(data);
}
