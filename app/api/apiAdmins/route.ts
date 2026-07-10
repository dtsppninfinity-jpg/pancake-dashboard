import { apiAdmins } from '@/lib/api/admins';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const params = await req.json().catch(() => ({}));
  const data = await apiAdmins(params);
  return Response.json(data);
}
