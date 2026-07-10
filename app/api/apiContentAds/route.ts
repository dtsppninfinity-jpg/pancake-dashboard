import { apiContentAds } from '@/lib/api/contentads';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const params = await req.json().catch(() => ({}));
  const data = await apiContentAds(params);
  return Response.json(data);
}
