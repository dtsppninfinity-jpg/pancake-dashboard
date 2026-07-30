import { apiAdminPerf } from '@/lib/api/adminperf';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Fluid compute: Hobby ให้ถึง 300s — ช่วงวันยาวหลายหมื่นแถวต้องมีที่หายใจ (เป้าจริงคือจบใน <60s)

export async function POST(req: Request) {
  const params = await req.json().catch(() => ({}));
  const data = await apiAdminPerf(params);
  return Response.json(data);
}
