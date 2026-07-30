import { apiReport } from '@/lib/api/report';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // ส่วนการตลาดสแกนออเดอร์ทั้งหมดตั้งแต่ 23 พ.ค. — เผื่อเวลา

export async function POST(req: Request) {
  const params = await req.json().catch(() => ({}));
  const data = await apiReport(params);
  return Response.json(data);
}
