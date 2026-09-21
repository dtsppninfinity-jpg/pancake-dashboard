import { apiUnitPerf } from '@/lib/api/unitperf';

export const dynamic = 'force-dynamic';
// อ่านทั้งเดือน (RPC 2 ตัว + ตารางเล็ก) — เผื่อเวลาเหมือน route หนักตัวอื่น
export const maxDuration = 300;

export async function POST(req: Request) {
  const params = await req.json().catch(() => ({}));
  const data = await apiUnitPerf(params);
  return Response.json(data);
}
