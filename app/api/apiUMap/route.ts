import { apiUMap } from '@/lib/api/umap';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const params = await req.json().catch(() => ({}));
  const data = await apiUMap(params);
  return Response.json(data);
}
