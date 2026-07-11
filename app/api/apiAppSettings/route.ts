import { apiAppSettings } from '@/lib/api/appsettings';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const params = await req.json().catch(() => ({}));
  const data = await apiAppSettings(params);
  return Response.json(data);
}
