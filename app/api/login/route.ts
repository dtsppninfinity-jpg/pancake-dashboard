// app/api/login/route.ts — ตรวจรหัสผ่านทีม แล้วตั้ง cookie (endpoint นี้ไม่ผ่าน middleware)
import { NextResponse } from 'next/server';
import { createHash } from 'crypto';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const pw = process.env.DASHBOARD_PASSWORD || '';
  if (!pw) return NextResponse.json({ ok: false, error: 'ยังไม่ได้ตั้ง DASHBOARD_PASSWORD บนเซิร์ฟเวอร์' }, { status: 503 });
  if (!body.password || String(body.password) !== pw) {
    return NextResponse.json({ ok: false, error: 'รหัสผ่านไม่ถูกต้อง' }, { status: 401 });
  }
  const token = createHash('sha256').update(pw).digest('hex');
  const res = NextResponse.json({ ok: true });
  res.cookies.set('pn_auth', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 วัน
  });
  return res;
}
