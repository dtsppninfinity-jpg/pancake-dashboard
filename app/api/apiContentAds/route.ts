import { apiContentAds } from '@/lib/api/contentads';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // สแกน orders ที่ผูก ad_id — กัน 504 (Vercel Hobby เพดาน 60s)

export async function POST(req: Request) {
  const params = await req.json().catch(() => ({}));
  const data = await apiContentAds(params);
  return Response.json(data);
}
