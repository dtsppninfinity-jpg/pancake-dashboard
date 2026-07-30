import { apiKpi } from '@/lib/api/kpi';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const params = await req.json().catch(() => ({}));
  const data = await apiKpi(params);
  return Response.json(data);
}
