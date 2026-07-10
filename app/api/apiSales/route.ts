import { apiSales } from '@/lib/api/sales';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const params = await req.json().catch(() => ({}));
  const data = await apiSales(params);
  return Response.json(data);
}
