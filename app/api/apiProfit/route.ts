import { apiProfit } from '@/lib/api/profit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const params = await req.json().catch(() => ({}));
  const data = await apiProfit(params);
  return Response.json(data);
}
