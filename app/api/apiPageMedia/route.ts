import { apiPageMedia } from '@/lib/api/pagemedia';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // เพจใหญ่ทั้งปี = ad_daily หลายหมื่นแถว

export async function POST(req: Request) {
  const params = await req.json().catch(() => ({}));
  const data = await apiPageMedia(params);
  return Response.json(data);
}
