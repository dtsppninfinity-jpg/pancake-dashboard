import { apiAdminPerf } from '@/lib/api/adminperf';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // ดึง orders ช่วงกว้างอาจนาน — กัน 504 (Vercel Hobby เพดาน 60s)

export async function POST(req: Request) {
  const params = await req.json().catch(() => ({}));
  const data = await apiAdminPerf(params);
  return Response.json(data);
}
