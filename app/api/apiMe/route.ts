// app/api/apiMe/route.ts — ผลงานของผู้ใช้ที่ล็อกอินอยู่ (ใช้โดย role=admin ที่เห็นเฉพาะของตัวเอง)
import { apiMe } from '@/lib/api/me';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Fluid compute: Hobby ให้ถึง 300s — ช่วงวันยาวหลายหมื่นแถวต้องมีที่หายใจ (เป้าจริงคือจบใน <60s)

export async function POST(req: Request) {
  const params = await req.json().catch(() => ({}));
  try {
    const data = await apiMe(params);
    return Response.json(data);
  } catch (e: any) {
    return Response.json({ error: e?.message || 'ดึงข้อมูลไม่สำเร็จ' }, { status: e?.status || 500 });
  }
}
