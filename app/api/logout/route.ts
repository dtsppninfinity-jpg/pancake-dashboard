// app/api/logout/route.ts — ล้าง cookie session (ไม่ผ่าน middleware เพื่อให้ออกจากระบบได้เสมอ
// แม้ session จะหมดอายุ/พังไปแล้ว)
import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth-session';

export const dynamic = 'force-dynamic';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  res.cookies.set('pn_auth', '', { path: '/', maxAge: 0 }); // cookie ของระบบเดิม
  return res;
}
