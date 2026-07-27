// app/api/login/route.ts — ตรวจ username/password รายคน แล้วตั้ง cookie session
// (endpoint นี้ไม่ผ่าน middleware — ดู matcher ใน middleware.ts)
import { NextResponse } from 'next/server';
import { findUser, verifyPassword, markLogin, hashPassword, hasAnyUser } from '@/lib/auth';
import { signSession, SESSION_COOKIE, SESSION_DAYS } from '@/lib/auth-session';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // scrypt ใช้ Node crypto — ห้ามรันบน Edge

/** ข้อความเดียวกันทุกกรณีที่ล็อกอินไม่ผ่าน — ไม่บอกว่า username มีจริงหรือรหัสผิด (กันไล่เดาชื่อผู้ใช้) */
const BAD = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const newPassword = String(body.newPassword || ''); // ใช้ตอนถูกบังคับตั้งรหัสใหม่

  if (!process.env.AUTH_SECRET && !process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json({ ok: false, error: 'ยังไม่ได้ตั้ง AUTH_SECRET บนเซิร์ฟเวอร์' }, { status: 503 });
  }
  if (!username || !password) {
    return NextResponse.json({ ok: false, error: 'กรอกชื่อผู้ใช้และรหัสผ่าน' }, { status: 400 });
  }

  const user = await findUser(username);

  // ยังไม่มีบัญชีในระบบเลย → บอกให้ไป seed (เจอเฉพาะตอนติดตั้งครั้งแรก)
  if (!user && !(await hasAnyUser())) {
    return NextResponse.json(
      { ok: false, error: 'ยังไม่มีบัญชีผู้ใช้ในระบบ — รัน `npm run seed:users` ก่อน' },
      { status: 503 }
    );
  }

  // แฮชทิ้งเปล่าๆ เมื่อไม่เจอ user เพื่อให้เวลาตอบสนองใกล้เคียงกรณีเจอ (กัน timing attack ไล่เดาชื่อ)
  if (!user) {
    await verifyPassword(password, 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
    return NextResponse.json({ ok: false, error: BAD }, { status: 401 });
  }
  if (!(await verifyPassword(password, user.password_hash))) {
    return NextResponse.json({ ok: false, error: BAD }, { status: 401 });
  }
  if (!user.enabled) {
    return NextResponse.json({ ok: false, error: 'บัญชีนี้ถูกปิดใช้งาน — ติดต่อผู้ดูแลระบบ' }, { status: 403 });
  }

  // บังคับตั้งรหัสใหม่ตอนเข้าครั้งแรก (บัญชีที่สร้างยกชุดมีรหัสสุ่มที่ผู้ดูแลเห็น)
  if (user.must_change_pw) {
    if (!newPassword) {
      return NextResponse.json({ ok: false, mustChangePw: true, error: 'ตั้งรหัสผ่านใหม่ก่อนเข้าใช้งาน' }, { status: 200 });
    }
    if (newPassword.length < 8) {
      return NextResponse.json({ ok: false, mustChangePw: true, error: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัว' }, { status: 400 });
    }
    if (newPassword === password) {
      return NextResponse.json({ ok: false, mustChangePw: true, error: 'รหัสใหม่ต้องไม่ซ้ำรหัสเดิม' }, { status: 400 });
    }
    await db
      .from('app_users')
      .update({ password_hash: await hashPassword(newPassword), must_change_pw: false, updated_at: new Date().toISOString() })
      .eq('id', user.id);
  }

  await markLogin(user.id);

  const token = await signSession({
    u: user.username,
    r: user.role,
    a: user.admin_user_id || '',
    n: user.name || user.username,
  });

  const res = NextResponse.json({
    ok: true,
    user: { username: user.username, name: user.name, role: user.role },
  });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * SESSION_DAYS,
  });
  // ล้าง cookie ของระบบรหัสรวมทีมเดิมทิ้ง (ไม่ใช้แล้ว)
  res.cookies.set('pn_auth', '', { path: '/', maxAge: 0 });
  return res;
}
