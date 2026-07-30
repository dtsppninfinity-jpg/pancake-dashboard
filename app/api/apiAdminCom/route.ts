import { apiAdminCom } from '@/lib/api/admincom';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // เดือนเต็มดึง orders หลายหมื่นแถว — กัน 504

export async function POST(req: Request) {
  const params = await req.json().catch(() => ({}));
  const data = await apiAdminCom(params);
  return Response.json(data);
}
