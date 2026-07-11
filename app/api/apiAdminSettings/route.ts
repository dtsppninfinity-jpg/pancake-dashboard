import { apiAdminSettings } from '@/lib/api/adminsettings';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const params = await req.json().catch(() => ({}));
  const data = await apiAdminSettings(params);
  return Response.json(data);
}
