// app/api/apiScoreConfig/route.ts — endpoint สำหรับ serverCall('apiScoreConfig', ...)
// ไม่มี body → คืน config ปัจจุบัน • มี { config } → บันทึก
import { apiScoreConfig } from '@/lib/api/scoreconfig';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const params = await req.json().catch(() => ({}));
  const data = await apiScoreConfig(params);
  return Response.json(data);
}
