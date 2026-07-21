// app/api/public/umap/route.ts — API สาธารณะสำหรับระบบภายนอกดึง U map ไปใช้
// เส้นนี้ "ไม่ผ่านรหัสทีม" (middleware ยกเว้น /api/public/*) — ข้อมูลที่ส่งจึงมีแค่
// รหัส U + ชื่อผลิตภัณฑ์ + ชื่อเล่นแอดมิน (ไม่มี email / user_id / ยอดขาย / PII อื่น)
// ปิดให้แคบลงได้: ตั้ง env UMAP_PUBLIC_KEY บน Vercel → ต้องแนบ ?key=<ค่า> ถึงจะอ่านได้
//
// วิธีใช้ (GET เท่านั้น):
//   /api/public/umap          → ทุก U
//   /api/public/umap?u=U10    → เฉพาะ U10
import { publicUMapPayload } from '@/lib/api/umap';

export const dynamic = 'force-dynamic';

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
  // ให้ CDN แคช 60 วิ — คนนอกยิงถี่แค่ไหนก็ไม่กระทบ DB
  'cache-control': 'public, s-maxage=60, stale-while-revalidate=300',
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const needKey = process.env.UMAP_PUBLIC_KEY || '';
  if (needKey && url.searchParams.get('key') !== needKey) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401, headers: CORS });
  }
  try {
    const data = await publicUMapPayload(url.searchParams.get('u') || '');
    return Response.json(data, { status: data.ok ? 200 : 404, headers: CORS });
  } catch (e: any) {
    // อย่าหลุด stack/รายละเอียด DB สู่สาธารณะ
    return Response.json({ ok: false, error: 'internal error' }, { status: 500, headers: CORS });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
